"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/require-user";
import { TIMEZONE_COOKIE_NAME } from "@/lib/tasks/timezone";
import { DEFAULT_TIMEZONE, getLocalTimeHHMM, getTodayISODate } from "@/lib/tasks/timezone";
import { type AvailabilityRuleInput, type FixedCommitmentInput, type SchedulerTask } from "@/lib/scheduler/engine";
import { buildDraftPlan, type ExistingManualBlock } from "@/lib/plans/planner";
import { buildReplan, isReplanMode, type ReplanBlock } from "@/lib/plans/replan";
import { loadPersonalization } from "@/lib/preferences/load";
import { loadWeekPriorityIds } from "@/lib/review/load";
import { mondayOf } from "@/lib/review/week";
import { getValidAccessToken } from "@/lib/google/oauth";
import { calendarFailure, calendarSkipNote, classifyCalendarError, CALENDAR_ERROR_MESSAGES, isGoogleFailure, tokenErrorCode, wantsPlanWithoutCalendar } from "@/lib/integrations/calendar";
import { loadCalendarStatus, readCalendarForUser, recordCalendarFailure, recordCalendarSuccess } from "@/lib/integrations/status";
import { createPlannerEvent, deletePlannerEvent, getOrCreatePlannerCalendar, updatePlannerEvent } from "@/lib/google/planner-calendar";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import type { Checkin, DailyPlan, PlanBlock, Task } from "@/lib/types";
import { validatePlanningProposal } from "@/lib/ai/validate-proposal";
import type { PlanningProposal } from "@/lib/ai/proposal";
import { errorFields, log } from "@/lib/log";
import { materializeRoutineTasks } from "@/lib/routines/materialize";
import { minutesFromHHMM } from "@/lib/time";
import { describePlanFit, morningPolicy, weeklyTargetTaskIds } from "@/lib/checkins/morning";
import { loadGoalsBehindWeeklyTarget } from "@/lib/checkins/load";

function timeMinutes(value: string): number {
  return minutesFromHHMM(value) ?? -1;
}

function intervalsOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

function normalizeProposalTime(value: string | undefined): string {
  if (!value) return "";
  return value.length === 5 ? value : value.slice(0, 5);
}

function requiredText(formData: FormData, key: string, label: string): string {
  const value = String(formData.get(key) ?? "").trim();
  if (!value) throw new Error(`${label} is required.`);
  return value;
}

function validTime(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export async function generateDraftPlan(formData?: FormData) {
  const { supabase, user } = await requireUser();
  const cookieStore = await cookies();
  const timeZone = cookieStore.get(TIMEZONE_COOKIE_NAME)?.value || DEFAULT_TIMEZONE;
  const planDate = getTodayISODate(timeZone);
  const weekday = new Date(`${planDate}T00:00:00Z`).getUTCDay();
  // Today's routine sessions become tasks before the plan reads them.
  await materializeRoutineTasks(supabase, planDate);

  const [{ data: rules, error: rulesError }, { data: commitments, error: commitmentsError }, { data: tasks, error: tasksError }, { data: existingActivePlan }, { data: morningCheckin, error: checkinError }] = await Promise.all([
    supabase.from("availability_rules").select("*").eq("weekday", weekday),
    supabase.from("fixed_commitments").select("*").eq("commitment_date", planDate),
    supabase.from("tasks").select("*").returns<Task[]>(),
    supabase.from("daily_plans").select("*").eq("plan_date", planDate).in("status", ["draft", "confirmed"]).maybeSingle<DailyPlan>(),
    supabase.from("checkins").select("*").eq("checkin_date", planDate).eq("type", "morning").maybeSingle<Checkin>(),
  ]);
  if (rulesError || commitmentsError || tasksError || checkinError) {
    return { error: rulesError?.message ?? commitmentsError?.message ?? tasksError?.message ?? checkinError?.message ?? "Could not load scheduling data." };
  }

  let manualBlocks: ExistingManualBlock[] = [];
  if (existingActivePlan?.status === "draft") {
    const { data: blocks } = await supabase.from("plan_blocks").select("*").eq("daily_plan_id", existingActivePlan.id).eq("is_manual", true).not("task_id", "is", null).returns<PlanBlock[]>();
    manualBlocks = (blocks ?? []).map((b) => ({ id: b.id, task_id: b.task_id, kind: b.kind as "task" | "buffer", title: b.title, start_time: b.start_time, end_time: b.end_time, is_manual: b.is_manual }));
  }

  const availabilityRules: AvailabilityRuleInput[] = (rules ?? []).map((rule) => ({ weekday: rule.weekday, kind: rule.kind, startTime: rule.start_time, endTime: rule.end_time }));
  const fixedCommitments: FixedCommitmentInput[] = (commitments ?? []).map((c) => ({ id: c.id, date: c.commitment_date, title: c.title, startTime: c.start_time, endTime: c.end_time }));
  const engineTasks = (tasks ?? []).map((task) => ({ id: task.id, title: task.title, status: task.status, priority: task.priority, urgency: task.urgency, impact: task.impact, mustDo: task.must_do, dueDate: task.due_date, estimatedMinutes: task.estimated_minutes, energyLevel: task.energy_level, createdAt: task.created_at }));

  // Reading the calendar needs the browser's timezone; without a calendar the
  // plan falls back to the default timezone as before.
  const tzCookie = cookieStore.get(TIMEZONE_COOKIE_NAME)?.value;
  let timeZoneError: string | null = null;
  if (!tzCookie) timeZoneError = "Timezone could not be determined. Please refresh the page to sync your timezone.";
  else try { new Intl.DateTimeFormat("en-US", { timeZone: tzCookie }); } catch { timeZoneError = "Invalid timezone detected. Please refresh the page to sync your timezone."; }
  // Returned, not thrown: production builds hide a thrown action's message.
  let calendar;
  try { calendar = await readCalendarForUser(supabase, user.id, planDate, tzCookie ?? timeZone, wantsPlanWithoutCalendar(formData), timeZoneError); }
  catch (statusError) { return { error: errorMessage(statusError, "Your Google Calendar settings could not be loaded. Please try again.") }; }
  if (calendar.kind === "invalid_timezone") return { error: calendar.error };
  if (calendar.kind === "failed") return calendarFailure(calendar.code);
  const calendarEvents = calendar.kind === "events" ? calendar.events : [];

  const [personalization, priorityTaskIds, goalsBehind] = await Promise.all([
    loadPersonalization(supabase, timeZone),
    loadWeekPriorityIds(supabase, mondayOf(planDate)),
    loadGoalsBehindWeeklyTarget(supabase, mondayOf(planDate), planDate),
  ]);
  const planResult = buildDraftPlan({
    date: planDate, weekday, availabilityRules, fixedCommitments, tasks: engineTasks, existingManualBlocks: manualBlocks, calendarEvents,
    policy: {
      bufferPercent: personalization.preferences.bufferPercent,
      durationFactor: personalization.durationFactor,
      // Generating mid-day must not place new work in time that has already passed.
      earliestStartTime: getLocalTimeHHMM(timeZone),
      // This week's chosen priorities rank first among otherwise similar work.
      priorityTaskIds,
      // Work for goals still short of this week's target comes first on a light day.
      weeklyTargetTaskIds: weeklyTargetTaskIds(tasks ?? [], goalsBehind),
      // The morning check-in's free time and energy shape the plan.
      ...morningPolicy(morningCheckin ?? null, personalization.preferences.lowEnergyMaxBlockMinutes),
    },
  });
  const { data: plan, error: planError } = await supabase.rpc("create_draft_plan", {
    p_user_id: user.id,
    p_plan_date: planDate,
    p_buffer_minutes: planResult.bufferMinutes,
    p_generated_at: new Date().toISOString(),
    p_blocks: planResult.blocks.map((b) => ({ task_id: b.taskId, kind: b.kind, title: b.title, start_time: b.startTime, end_time: b.endTime, sort_order: b.sortOrder, is_manual: b.isManual })),
    p_unscheduled: planResult.unscheduled.map((item) => ({ task_id: item.taskId, reason: item.reason })),
  }).single<DailyPlan>();
  if (planError || !plan) return { error: planError?.message ?? "Could not save draft plan." };
  revalidatePath("/today");
  const note = calendarSkipNote(calendar);
  const fit = morningCheckin?.available_minutes != null
    ? describePlanFit({
        availableMinutes: morningCheckin.available_minutes,
        plannedMinutes: planResult.blocks.filter((b) => b.kind === "task").reduce((total, b) => total + timeMinutes(b.endTime) - timeMinutes(b.startTime), 0),
        energy: morningCheckin.energy_level,
        leftOut: planResult.unscheduled.length,
      })
    : null;
  const message = [fit ?? (note ? "Draft plan generated." : null), note].filter(Boolean).join(" ");
  return message ? { message } : undefined;
}

/**
 * Production builds replace a thrown Server Action's message with a generic
 * one, so confirmAIProposal and confirmPlan return expected failures as
 * { error } for the caller to show.
 */
export async function confirmAIProposal(proposal: PlanningProposal, conversationId?: string) {
  try {
    return await applyAIProposal(proposal, conversationId);
  } catch (error) {
    return { ok: false as const, error: errorMessage(error, "Unable to confirm the proposal.") };
  }
}

async function applyAIProposal(proposal: PlanningProposal, conversationId?: string) {
  const { supabase, user } = await requireUser();
  const validation = validatePlanningProposal(proposal);
  if (!validation.ok) throw new Error(validation.error);
  const safeProposal = validation.data;
  if (!["suggest_schedule", "propose_reschedule"].includes(safeProposal.type)) throw new Error("Only schedule proposals can be confirmed.");

  const items = safeProposal.items.filter((item) => item.start_time && item.end_time);
  if (!items.length) throw new Error("The proposal has no scheduled work to confirm.");
  if (items.length !== safeProposal.items.length) throw new Error("Every item in a confirmable schedule proposal must have a start and end time.");
  if (safeProposal.type === "propose_reschedule" && items.length !== 1) throw new Error("A reschedule proposal must contain exactly one task move.");

  const cookieStore = await cookies();
  const timeZone = cookieStore.get(TIMEZONE_COOKIE_NAME)?.value || DEFAULT_TIMEZONE;
  let planDate: string;
  try { new Intl.DateTimeFormat("en-US", { timeZone }); planDate = getTodayISODate(timeZone); } catch { throw new Error("Invalid timezone detected. Please refresh and try again."); }
  const nowMinutes = timeMinutes(getLocalTimeHHMM(timeZone));

  const taskIds = items.map((item) => item.task_id).filter((id): id is string => Boolean(id));
  if (taskIds.length !== items.length || new Set(taskIds).size !== taskIds.length) throw new Error("Each scheduled item must reference a unique task.");

  const [tasksResult, rulesResult, commitmentsResult, activePlanResult] = await Promise.all([
    supabase.from("tasks").select("id,title,status").eq("user_id", user.id).in("id", taskIds),
    supabase.from("availability_rules").select("weekday,kind,start_time,end_time").eq("user_id", user.id),
    supabase.from("fixed_commitments").select("title,start_time,end_time").eq("user_id", user.id).eq("commitment_date", planDate),
    supabase.from("daily_plans").select("id,version,status,buffer_minutes").eq("user_id", user.id).eq("plan_date", planDate).in("status", ["draft", "confirmed"]).order("version", { ascending: false }).limit(1).maybeSingle<DailyPlan>(),
  ]);
  if (tasksResult.error || rulesResult.error || commitmentsResult.error || activePlanResult.error) throw new Error(tasksResult.error?.message ?? rulesResult.error?.message ?? commitmentsResult.error?.message ?? activePlanResult.error?.message ?? "Could not validate the proposal.");

  const taskMap = new Map((tasksResult.data ?? []).map((task) => [task.id, task]));
  for (const id of taskIds) {
    const task = taskMap.get(id);
    if (!task) throw new Error("One or more proposed tasks no longer exist or do not belong to your account.");
    if (["completed", "skipped"].includes(task.status)) throw new Error(`Task "${task.title}" is no longer eligible for scheduling.`);
  }

  const existingPlan = activePlanResult.data;
  if (!existingPlan) throw new Error("There is no active plan to modify.");

  const [{ data: blockRows, error: blockError }, { data: unscheduledRows, error: unscheduledError }] = await Promise.all([
    supabase.from("plan_blocks").select("*").eq("daily_plan_id", existingPlan.id).eq("user_id", user.id).order("start_time", { ascending: true }).returns<PlanBlock[]>(),
    supabase.from("plan_unscheduled_tasks").select("task_id,reason").eq("daily_plan_id", existingPlan.id).returns<Array<{ task_id: string; reason: string }>>(),
  ]);
  if (blockError || unscheduledError) throw new Error(blockError?.message ?? unscheduledError?.message ?? "Could not load today's existing plan.");

  const existingBlocks = blockRows ?? [];
  const existingUnscheduled = unscheduledRows ?? [];
  const existingTaskIds = new Set(existingBlocks.filter((block) => block.kind === "task" && block.task_id).map((block) => block.task_id as string));

  if (safeProposal.type === "suggest_schedule" && taskIds.some((id) => existingTaskIds.has(id))) {
    throw new Error("One or more proposed tasks are already scheduled in today's plan. Use a reschedule request instead.");
  }
  if (safeProposal.type === "propose_reschedule" && !existingTaskIds.has(taskIds[0])) {
    throw new Error("The task to reschedule is not present in today's active plan.");
  }

  // AI proposals are checked against the calendar; there is no "without my
  // calendar" option here. A pause skips the check, and the reply says so.
  const calendar = await readCalendarForUser(supabase, user.id, planDate, timeZone, false);
  if (calendar.kind === "failed") throw new Error(`${CALENDAR_ERROR_MESSAGES[calendar.code]} The proposal was not applied.`);
  if (calendar.kind === "skipped" && calendar.reason === "not_connected") throw new Error("Google Calendar must be connected before a schedule can be confirmed.");
  const calendarEvents = calendar.kind === "events" ? calendar.events : [];

  const weekday = new Date(planDate + "T00:00:00Z").getUTCDay();
  const workingRules = (rulesResult.data ?? []).filter((rule) => rule.weekday === weekday && rule.kind === "working");
  const reservationRules = (rulesResult.data ?? []).filter((rule) => rule.weekday === weekday && !["working", "high_focus"].includes(rule.kind));
  if (!workingRules.length) throw new Error("No working hours are configured for today.");

  const targetTaskIds = new Set(taskIds);
  const removedBufferMinutes = safeProposal.type === "propose_reschedule"
    ? existingBlocks.filter((block) => block.kind === "buffer" && intervalsOverlap(timeMinutes(block.start_time.slice(0, 5)), timeMinutes(block.end_time.slice(0, 5)), timeMinutes(normalizeProposalTime(items[0].start_time)), timeMinutes(normalizeProposalTime(items[0].end_time)))).reduce((total, block) => total + Math.max(0, timeMinutes(block.end_time.slice(0, 5)) - timeMinutes(block.start_time.slice(0, 5))), 0)
    : 0;

  const preservedBlocks = existingBlocks.filter((block) => {
    if (safeProposal.type !== "propose_reschedule") return true;
    if (block.task_id && targetTaskIds.has(block.task_id)) return false;
    if (block.kind === "buffer") {
      const bufferStart = timeMinutes(block.start_time.slice(0, 5));
      const bufferEnd = timeMinutes(block.end_time.slice(0, 5));
      const newStart = timeMinutes(normalizeProposalTime(items[0].start_time));
      const newEnd = timeMinutes(normalizeProposalTime(items[0].end_time));
      if (intervalsOverlap(bufferStart, bufferEnd, newStart, newEnd)) return false;
    }
    return true;
  });

  const occupiedIntervals = preservedBlocks.map((block) => ({ start: timeMinutes(block.start_time.slice(0, 5)), end: timeMinutes(block.end_time.slice(0, 5)), title: block.title }));
  const proposedIntervals: Array<{ start: number; end: number }> = [];

  for (const item of items) {
    const title = taskMap.get(item.task_id!)?.title ?? "Task";
    const start = timeMinutes(normalizeProposalTime(item.start_time));
    const end = timeMinutes(normalizeProposalTime(item.end_time));
    if (start < 0 || end <= start) throw new Error(`Invalid schedule time for "${title}".`);
    if (start < nowMinutes) throw new Error(`"${title}" starts at ${normalizeProposalTime(item.start_time)}, which has already passed. Ask for a new proposal.`);
    if (item.estimated_minutes !== undefined && item.estimated_minutes !== end - start) throw new Error(`The scheduled duration for "${title}" does not match its estimated minutes.`);
    if (!workingRules.some((rule) => start >= timeMinutes(rule.start_time) && end <= timeMinutes(rule.end_time))) throw new Error(`"${title}" falls outside your configured working hours.`);
    if (reservationRules.some((rule) => intervalsOverlap(start, end, timeMinutes(rule.start_time), timeMinutes(rule.end_time)))) throw new Error(`"${title}" overlaps a reserved availability window.`);
    const commitment = (commitmentsResult.data ?? []).find((item) => intervalsOverlap(start, end, timeMinutes(item.start_time), timeMinutes(item.end_time)));
    if (commitment) throw new Error(`"${title}" overlaps the fixed commitment "${commitment.title}".`);
    if (calendarEvents.some((event) => intervalsOverlap(start, end, timeMinutes(event.startTime), timeMinutes(event.endTime)))) throw new Error(`"${title}" overlaps a Google Calendar event.`);
    if (occupiedIntervals.some((existing) => intervalsOverlap(start, end, existing.start, existing.end))) throw new Error(`"${title}" overlaps an existing block in today's plan.`);
    if (proposedIntervals.some((existing) => intervalsOverlap(start, end, existing.start, existing.end))) throw new Error("The proposal contains overlapping work blocks.");
    proposedIntervals.push({ start, end });
  }

  const proposedBlocks = items.map((item) => ({ task_id: item.task_id, kind: "task", title: taskMap.get(item.task_id!)!.title, start_time: normalizeProposalTime(item.start_time), end_time: normalizeProposalTime(item.end_time), sort_order: 0, is_manual: false }));
  const mergedBlocks = [...preservedBlocks.map((block) => ({ task_id: block.task_id, kind: block.kind, title: block.title, start_time: block.start_time, end_time: block.end_time, sort_order: 0, is_manual: block.is_manual })), ...proposedBlocks]
    .sort((a, b) => a.start_time.localeCompare(b.start_time) || a.end_time.localeCompare(b.end_time) || a.title.localeCompare(b.title))
    .map((block, index) => ({ ...block, sort_order: index }));

  const proposedTaskIdSet = new Set(taskIds);
  const mergedUnscheduled = existingUnscheduled.filter((item) => !proposedTaskIdSet.has(item.task_id)).map((item) => ({ task_id: item.task_id, reason: item.reason }));
  const nextBufferMinutes = Math.max(0, (existingPlan.buffer_minutes ?? 0) - removedBufferMinutes);

  const { data: draft, error: draftError } = await supabase.rpc("create_draft_plan", {
    p_user_id: user.id,
    p_plan_date: planDate,
    p_buffer_minutes: nextBufferMinutes,
    p_generated_at: new Date().toISOString(),
    p_blocks: mergedBlocks,
    p_unscheduled: mergedUnscheduled,
  }).single<DailyPlan>();
  if (draftError || !draft) throw new Error(draftError?.message ?? "Could not create the updated schedule draft.");

  if (safeProposal.type === "propose_reschedule") {
    const { data: rescheduledBlock, error: rescheduledBlockError } = await supabase.from("plan_blocks").select("id").eq("daily_plan_id", draft.id).eq("user_id", user.id).eq("task_id", taskIds[0]).maybeSingle<{ id: string }>();
    if (rescheduledBlockError || !rescheduledBlock) throw new Error(rescheduledBlockError?.message ?? "Could not validate the rescheduled task block.");
    const { error: dbValidationError } = await supabase.rpc("edit_draft_plan_block", {
      p_block_id: rescheduledBlock.id,
      p_start_time: normalizeProposalTime(items[0].start_time),
      p_end_time: normalizeProposalTime(items[0].end_time),
    });
    if (dbValidationError) throw new Error(dbValidationError.message);
  }

  if (conversationId) {
    const { error: historyError } = await supabase.from("ai_conversations").update({ confirmed: true, confirmed_plan_id: draft.id }).eq("id", conversationId).eq("user_id", user.id);
    if (historyError) throw new Error(`Draft was created, but the AI proposal could not be recorded as confirmed: ${historyError.message}`);
  }

  revalidatePath("/today");
  const note = calendarSkipNote(calendar);
  return { ok: true as const, plan_id: draft.id, message: `Schedule proposal applied to a draft plan.${note ? ` ${note}` : ""} Review it on Today and use Confirm plan to publish it to AI Planner.` };
}

export async function confirmPlan(formData: FormData) {
  try {
    return await publishPlan(formData);
  } catch (error) {
    return { error: errorMessage(error, "The plan could not be confirmed. Please try again.") };
  }
}

async function publishPlan(formData: FormData) {
  const { supabase, user } = await requireUser();
  const planId = requiredText(formData, "plan_id", "Plan ID");
  const { data: plan, error } = await supabase.rpc("begin_daily_plan_publication", { p_plan_id: planId }).single<DailyPlan>();
  if (error || !plan) throw new Error(error?.message ?? "Could not begin plan publication.");
  const markPublicationFailed = async () => {
    const { error: failureError } = await supabase.rpc("fail_daily_plan_publication", { p_plan_id: plan.id });
    if (failureError) log("error", "plan.mark_publication_failed_failed", { planId: plan.id, message: failureError.message });
  };

  let calendarStatus;
  try { calendarStatus = await loadCalendarStatus(supabase, user.id); } catch (statusError) { await markPublicationFailed(); revalidatePath("/today"); throw statusError; }

  // Publishing paused: confirm the plan without calling Google at all.
  if (!calendarStatus.publishingEnabled) {
    const { error: pausedCompletionError } = await supabase.rpc("complete_daily_plan_publication", { p_plan_id: plan.id });
    if (pausedCompletionError) { await markPublicationFailed(); throw new Error(`The plan could not be confirmed: ${pausedCompletionError.message}`); }
    revalidatePath("/today");
    return { message: "Plan confirmed. Google Calendar was not updated because publishing is paused in Settings; AI Planner events from an earlier version of today's plan, if any, were left as they were." };
  }

  const tokenResult = await getValidAccessToken(user.id);
  if ("error" in tokenResult) {
    await markPublicationFailed();
    const code = tokenErrorCode(tokenResult, calendarStatus.needsReconnect);
    if (code) await recordCalendarFailure(supabase, user.id, "publish", code);
    revalidatePath("/today");
    if (!code) throw new Error("Google Calendar must be connected before the plan can be published. To confirm without it, pause publishing in Settings.");
    throw new Error(CALENDAR_ERROR_MESSAGES[code]);
  }

  const cookieStore = await cookies();
  const timeZone = cookieStore.get(TIMEZONE_COOKIE_NAME)?.value;
  if (!timeZone) { await markPublicationFailed(); throw new Error("Your timezone could not be determined. Please refresh and try again."); }
  try { new Intl.DateTimeFormat("en-US", { timeZone }); } catch { await markPublicationFailed(); throw new Error("Your timezone is invalid. Please refresh and try again."); }

  const { data: blocks, error: blocksError } = await supabase.from("plan_blocks").select("*").eq("daily_plan_id", plan.id).eq("user_id", user.id).eq("kind", "task").returns<PlanBlock[]>();
  if (blocksError) { await markPublicationFailed(); throw new Error(`Its work blocks could not be loaded: ${blocksError.message}`); }

  try {
    const calendarId = await getOrCreatePlannerCalendar(user.id, tokenResult.token);
    const serviceRole = createServiceRoleClient();
    const { data: dayPlans, error: dayPlansError } = await serviceRole.from("daily_plans").select("id").eq("user_id", user.id).eq("plan_date", plan.plan_date);
    if (dayPlansError) throw new Error(`Could not load previous AI Planner mappings: ${dayPlansError.message}`);
    const dayPlanIds = (dayPlans ?? []).map((item) => item.id);
    const { data: existingMappings, error: mappingsError } = await serviceRole
      .from("google_planner_events")
      .select("id,daily_plan_id,plan_block_id,google_event_id")
      .eq("user_id", user.id)
      .in("daily_plan_id", dayPlanIds.length > 0 ? dayPlanIds : [plan.id]);
    if (mappingsError) throw new Error(`Could not load AI Planner mappings: ${mappingsError.message}`);

    const currentBlockIds = new Set((blocks ?? []).map((block) => block.id));
    const currentMappings = new Map(
      (existingMappings ?? [])
        .filter((mapping) => mapping.daily_plan_id === plan.id)
        .map((mapping) => [mapping.plan_block_id, mapping]),
    );

    for (const mapping of existingMappings ?? []) {
      if (mapping.daily_plan_id === plan.id && currentBlockIds.has(mapping.plan_block_id)) continue;
      await deletePlannerEvent(tokenResult.token, calendarId, mapping.google_event_id);
      const { error: mappingDeleteError } = await serviceRole
        .from("google_planner_events")
        .delete()
        .eq("id", mapping.id)
        .eq("user_id", user.id);
      if (mappingDeleteError) throw new Error(`Could not remove stale AI Planner mapping: ${mappingDeleteError.message}`);
    }

    for (const block of blocks ?? []) {
      const input = { planDate: plan.plan_date, timeZone, title: block.title, startTime: block.start_time, endTime: block.end_time, dailyPlanId: plan.id, planBlockId: block.id };
      const existing = currentMappings.get(block.id);
      if (existing) {
        try {
          await updatePlannerEvent(tokenResult.token, calendarId, existing.google_event_id, input);
          continue;
        } catch (updateError) {
          if (!(updateError instanceof Error) || !updateError.message.includes("no longer exists")) throw updateError;
          const recreatedEventId = await createPlannerEvent(tokenResult.token, calendarId, input);
          const { error: mappingUpdateError } = await serviceRole
            .from("google_planner_events")
            .update({ google_event_id: recreatedEventId })
            .eq("id", existing.id)
            .eq("user_id", user.id);
          if (mappingUpdateError) throw new Error(`Google event ${recreatedEventId} was created, but its mapping could not be updated: ${mappingUpdateError.message}`);
          continue;
        }
      }

      const googleEventId = await createPlannerEvent(tokenResult.token, calendarId, input);
      const { error: mappingError } = await serviceRole.from("google_planner_events").insert({ user_id: user.id, daily_plan_id: plan.id, plan_block_id: block.id, google_event_id: googleEventId });
      if (mappingError) {
        try {
          await deletePlannerEvent(tokenResult.token, calendarId, googleEventId);
        } catch (cleanupError) {
          log("error", "plan.unmapped_event_cleanup_failed", { planId: plan.id, ...errorFields(cleanupError) });
        }
        throw new Error(`Google event ${googleEventId} was created, but its local mapping could not be saved: ${mappingError.message}`);
      }
    }
  } catch (publishError) {
    await markPublicationFailed();
    // Google failures show only the app's message for their cause: a
    // GoogleRequestError can carry Google's raw response text. The app's own
    // errors (database mappings) keep their app-written messages.
    let message = publishError instanceof Error ? publishError.message : "Unknown publishing error.";
    if (isGoogleFailure(publishError)) {
      const code = classifyCalendarError(publishError);
      await recordCalendarFailure(supabase, user.id, "publish", code);
      message = CALENDAR_ERROR_MESSAGES[code];
    }
    throw new Error(`Publishing to AI Planner failed: ${message}`);
  }
  const { error: completionError } = await supabase.rpc("complete_daily_plan_publication", { p_plan_id: plan.id });
  if (completionError) {
    await markPublicationFailed();
    throw new Error(`AI Planner published successfully, but the plan status could not be updated: ${completionError.message}`);
  }
  await recordCalendarSuccess(supabase, user.id, "publish");
  revalidatePath("/today");
}

/**
 * Day 9 adaptive replanning. Rebuilds the rest of today with the
 * deterministic engine (see buildReplan) and saves it as a draft; the
 * existing Confirm plan flow is the only path to Google Calendar. Expected
 * failures are returned as { error } so ActionForm can show them inline.
 */
export async function replanToday(formData: FormData) {
  const { supabase, user } = await requireUser();
  const mode = String(formData.get("mode") ?? "");
  if (!isReplanMode(mode)) return { error: "Choose a valid replanning option." };

  const cookieStore = await cookies();
  const timeZone = cookieStore.get(TIMEZONE_COOKIE_NAME)?.value;
  if (!timeZone) return { error: "Timezone could not be determined. Please refresh the page and try again." };
  try { new Intl.DateTimeFormat("en-US", { timeZone }); } catch { return { error: "Invalid timezone detected. Please refresh the page and try again." }; }
  const now = new Date();
  const planDate = getTodayISODate(timeZone, now);
  await materializeRoutineTasks(supabase, planDate);
  const nowTime = getLocalTimeHHMM(timeZone, now);
  const weekday = new Date(`${planDate}T00:00:00Z`).getUTCDay();

  let freeWindow: { startTime: string; endTime: string } | null = null;
  if (mode === "free_time") {
    const startTime = String(formData.get("start_time") ?? "").trim();
    const endTime = String(formData.get("end_time") ?? "").trim();
    if (!validTime(startTime) || !validTime(endTime) || endTime <= startTime) return { error: "Choose a valid free time window: the end must be after the start." };
    if (endTime <= nowTime) return { error: "That free time window has already passed." };
    freeWindow = { startTime, endTime };
  }

  const { data: plan, error: planError } = await supabase
    .from("daily_plans")
    .select("id,status,version")
    .eq("user_id", user.id)
    .eq("plan_date", planDate)
    .in("status", ["draft", "publishing", "publication_failed", "confirmed"])
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle<Pick<DailyPlan, "id" | "status" | "version">>();
  if (planError) return { error: `Could not load today's plan: ${planError.message}` };
  if (!plan) return { error: "Generate today's plan before replanning." };
  if (plan.status === "publishing" || plan.status === "publication_failed") return { error: "Finish or retry publishing today's plan before replanning." };

  const [blocksResult, unscheduledResult, tasksResult, rulesResult, commitmentsResult] = await Promise.all([
    supabase.from("plan_blocks").select("*").eq("daily_plan_id", plan.id).eq("user_id", user.id).returns<PlanBlock[]>(),
    supabase.from("plan_unscheduled_tasks").select("task_id,reason").eq("daily_plan_id", plan.id).eq("user_id", user.id).returns<Array<{ task_id: string; reason: string }>>(),
    supabase.from("tasks").select("*").eq("user_id", user.id).returns<Task[]>(),
    supabase.from("availability_rules").select("weekday,kind,start_time,end_time").eq("user_id", user.id).eq("weekday", weekday),
    supabase.from("fixed_commitments").select("id,commitment_date,title,start_time,end_time").eq("user_id", user.id).eq("commitment_date", planDate),
  ]);
  const loadError = blocksResult.error ?? unscheduledResult.error ?? tasksResult.error ?? rulesResult.error ?? commitmentsResult.error;
  if (loadError) return { error: `Could not load scheduling data: ${loadError.message}` };

  let calendar;
  try { calendar = await readCalendarForUser(supabase, user.id, planDate, timeZone, wantsPlanWithoutCalendar(formData)); }
  catch (statusError) { return { error: errorMessage(statusError, "Your Google Calendar settings could not be loaded. Please try again.") }; }
  if (calendar.kind === "failed") return calendarFailure(calendar.code);
  const calendarEvents = calendar.kind === "events" ? calendar.events : [];

  const personalization = await loadPersonalization(supabase, timeZone, now);
  const tasks: SchedulerTask[] = (tasksResult.data ?? []).map((task) => ({ id: task.id, title: task.title, status: task.status, priority: task.priority, urgency: task.urgency, impact: task.impact, mustDo: task.must_do, dueDate: task.due_date, estimatedMinutes: task.estimated_minutes, energyLevel: task.energy_level, createdAt: task.created_at }));
  const currentBlocks: ReplanBlock[] = (blocksResult.data ?? []).map((block) => ({ taskId: block.task_id, kind: block.kind, title: block.title, startTime: block.start_time, endTime: block.end_time, isManual: block.is_manual }));

  const result = buildReplan({
    mode, date: planDate, weekday, nowTime,
    availabilityRules: (rulesResult.data ?? []).map((rule) => ({ weekday: rule.weekday, kind: rule.kind, startTime: rule.start_time, endTime: rule.end_time })),
    fixedCommitments: (commitmentsResult.data ?? []).map((c) => ({ id: c.id, date: c.commitment_date, title: c.title, startTime: c.start_time, endTime: c.end_time })),
    calendarEvents,
    currentBlocks,
    currentUnscheduled: (unscheduledResult.data ?? []).map((item) => ({ taskId: item.task_id, reason: item.reason })),
    tasks,
    preferences: {
      bufferPercent: personalization.preferences.bufferPercent,
      lowEnergyMaxBlockMinutes: personalization.preferences.lowEnergyMaxBlockMinutes,
      durationFactor: personalization.durationFactor,
    },
    freeWindow,
  });
  const note = calendarSkipNote(calendar);
  if (!result.changed) return { message: note ? `${result.summary} ${note}` : result.summary };

  const { error: draftError } = await supabase.rpc("create_draft_plan", {
    p_user_id: user.id,
    p_plan_date: planDate,
    p_buffer_minutes: result.bufferMinutes,
    p_generated_at: now.toISOString(),
    p_blocks: result.blocks.map((b) => ({ task_id: b.taskId, kind: b.kind, title: b.title, start_time: b.startTime, end_time: b.endTime, sort_order: b.sortOrder, is_manual: b.isManual })),
    p_unscheduled: result.unscheduled.map((item) => ({ task_id: item.taskId, reason: item.reason })),
  }).single<DailyPlan>();
  if (draftError) return { error: `Could not save the replanned draft: ${draftError.message}` };

  revalidatePath("/today");
  return { message: `${result.summary}${note ? ` ${note}` : ""} Review the new draft, then use Confirm plan to update Google Calendar.` };
}

export async function removePlanBlock(formData: FormData) {
  const { supabase } = await requireUser();
  const blockId = requiredText(formData, "block_id", "Block ID");
  const { error } = await supabase.rpc("delete_draft_plan_block", { p_block_id: blockId });
  if (error) throw new Error(error.message);
  revalidatePath("/today");
}

export async function editPlanBlock(formData: FormData) {
  const { supabase } = await requireUser();
  const blockId = requiredText(formData, "block_id", "Block ID");
  const newStart = requiredText(formData, "start_time", "Start time");
  const newEnd = requiredText(formData, "end_time", "End time");
  if (!validTime(newStart) || !validTime(newEnd) || newEnd <= newStart) throw new Error("Choose a valid same-day start and end time.");
  const { error } = await supabase.rpc("edit_draft_plan_block", { p_block_id: blockId, p_start_time: newStart, p_end_time: newEnd });
  if (error) throw new Error(error.message);
  revalidatePath("/today");
}
