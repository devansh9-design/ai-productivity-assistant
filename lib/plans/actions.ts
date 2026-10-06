"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/require-user";
import { TIMEZONE_COOKIE_NAME } from "@/lib/tasks/timezone";
import { DEFAULT_TIMEZONE, getTodayISODate } from "@/lib/tasks/timezone";
import { type AvailabilityRuleInput, type FixedCommitmentInput } from "@/lib/scheduler/engine";
import { buildDraftPlan, type ExistingManualBlock } from "@/lib/plans/planner";
import { getValidAccessToken } from "@/lib/google/oauth";
import { fetchCalendarEvents } from "@/lib/google/calendar";
import { createPlannerEvent, deletePlannerEventsForDate, getOrCreatePlannerCalendar } from "@/lib/google/planner-calendar";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import type { DailyPlan, PlanBlock, Task } from "@/lib/types";
import { validatePlanningProposal } from "@/lib/ai/validate-proposal";
import type { PlanningProposal } from "@/lib/ai/proposal";

function timeMinutes(value: string): number {
  const match = /^(\d{2}):(\d{2})(?::\d{2})?$/.exec(value);
  if (!match) return -1;
  return Number(match[1]) * 60 + Number(match[2]);
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

export async function generateDraftPlan() {
  const { supabase, user } = await requireUser();
  const cookieStore = await cookies();
  const timeZone = cookieStore.get(TIMEZONE_COOKIE_NAME)?.value || DEFAULT_TIMEZONE;
  const planDate = getTodayISODate(timeZone);
  const weekday = new Date(`${planDate}T00:00:00Z`).getUTCDay();

  const [{ data: rules, error: rulesError }, { data: commitments, error: commitmentsError }, { data: tasks, error: tasksError }, { data: existingActivePlan }] = await Promise.all([
    supabase.from("availability_rules").select("*").eq("weekday", weekday),
    supabase.from("fixed_commitments").select("*").eq("commitment_date", planDate),
    supabase.from("tasks").select("*").returns<Task[]>(),
    supabase.from("daily_plans").select("*").eq("plan_date", planDate).in("status", ["draft", "confirmed"]).maybeSingle<DailyPlan>(),
  ]);
  if (rulesError || commitmentsError || tasksError) {
    return { error: rulesError?.message ?? commitmentsError?.message ?? tasksError?.message ?? "Could not load scheduling data." };
  }

  let manualBlocks: ExistingManualBlock[] = [];
  if (existingActivePlan?.status === "draft") {
    const { data: blocks } = await supabase.from("plan_blocks").select("*").eq("daily_plan_id", existingActivePlan.id).eq("is_manual", true).not("task_id", "is", null).returns<PlanBlock[]>();
    manualBlocks = (blocks ?? []).map((b) => ({ id: b.id, task_id: b.task_id, kind: b.kind as "task" | "buffer", title: b.title, start_time: b.start_time, end_time: b.end_time, is_manual: b.is_manual }));
  }

  const availabilityRules: AvailabilityRuleInput[] = (rules ?? []).map((rule) => ({ weekday: rule.weekday, kind: rule.kind, startTime: rule.start_time, endTime: rule.end_time }));
  const fixedCommitments: FixedCommitmentInput[] = (commitments ?? []).map((c) => ({ id: c.id, date: c.commitment_date, title: c.title, startTime: c.start_time, endTime: c.end_time }));
  const engineTasks = (tasks ?? []).map((task) => ({ id: task.id, title: task.title, status: task.status, priority: task.priority, urgency: task.urgency, impact: task.impact, mustDo: task.must_do, dueDate: task.due_date, estimatedMinutes: task.estimated_minutes, energyLevel: task.energy_level, createdAt: task.created_at }));

  const tokenResult = await getValidAccessToken(user.id);
  let calendarEvents: { googleEventId: string; title: string; startTime: string; endTime: string }[] = [];
  if ("error" in tokenResult) {
    if (tokenResult.error === "reconnect_required") return { error: "Google Calendar credentials are no longer valid. Please reconnect Google Calendar in Settings." };
    if (tokenResult.error === "calendar_sync_failed") return { error: "Could not sync Google Calendar events. Please try again." };
  } else {
    const tzCookie = cookieStore.get(TIMEZONE_COOKIE_NAME)?.value;
    if (!tzCookie) return { error: "Timezone could not be determined. Please refresh the page to sync your timezone." };
    try { new Intl.DateTimeFormat("en-US", { timeZone: tzCookie }); } catch { return { error: "Invalid timezone detected. Please refresh the page to sync your timezone." }; }
    try { calendarEvents = await fetchCalendarEvents(tokenResult.token, planDate, tzCookie); } catch { return { error: "Could not sync Google Calendar events. Please try again." }; }
  }

  const planResult = buildDraftPlan({ date: planDate, weekday, availabilityRules, fixedCommitments, tasks: engineTasks, existingManualBlocks: manualBlocks, calendarEvents });
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
}

export async function confirmAIProposal(proposal: PlanningProposal, conversationId?: string) {
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

  const tokenResult = await getValidAccessToken(user.id);
  if ("error" in tokenResult) throw new Error("Google Calendar must be connected before a schedule can be confirmed.");

  let calendarEvents: { startTime: string; endTime: string; title: string }[];
  try { calendarEvents = await fetchCalendarEvents(tokenResult.token, planDate, timeZone); } catch { throw new Error("Could not refresh Google Calendar. The proposal was not applied."); }

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
  return { ok: true, plan_id: draft.id, message: "Schedule proposal applied to a draft plan. Review it on Today and use Confirm plan to publish it to AI Planner." };
}

export async function confirmPlan(formData: FormData) {
  const { supabase, user } = await requireUser();
  const planId = requiredText(formData, "plan_id", "Plan ID");
  const { data: plan, error } = await supabase.rpc("confirm_daily_plan", { p_plan_id: planId }).single<DailyPlan>();
  if (error || !plan) throw new Error(error?.message ?? "Could not confirm plan.");

  const tokenResult = await getValidAccessToken(user.id);
  if ("error" in tokenResult) {
    if (tokenResult.error === "not_connected") { revalidatePath("/today"); return; }
    if (tokenResult.error === "reconnect_required") throw new Error("Plan confirmed, but Google Calendar needs to be reconnected before it can be published.");
    throw new Error("Plan confirmed, but Google Calendar could not be accessed. Please try again.");
  }

  const cookieStore = await cookies();
  const timeZone = cookieStore.get(TIMEZONE_COOKIE_NAME)?.value;
  if (!timeZone) throw new Error("Plan confirmed, but your timezone could not be determined. Please refresh and try again.");
  try { new Intl.DateTimeFormat("en-US", { timeZone }); } catch { throw new Error("Plan confirmed, but your timezone is invalid. Please refresh and try again."); }

  const { data: blocks, error: blocksError } = await supabase.from("plan_blocks").select("*").eq("daily_plan_id", plan.id).eq("user_id", user.id).eq("kind", "task").returns<PlanBlock[]>();
  if (blocksError) throw new Error(`Plan confirmed, but its work blocks could not be loaded: ${blocksError.message}`);

  try {
    const calendarId = await getOrCreatePlannerCalendar(user.id, tokenResult.token);
    const serviceRole = createServiceRoleClient();
    await deletePlannerEventsForDate(tokenResult.token, calendarId, plan.plan_date, timeZone);

    const { data: dayPlans, error: dayPlansError } = await serviceRole.from("daily_plans").select("id").eq("user_id", user.id).eq("plan_date", plan.plan_date);
    if (dayPlansError) throw new Error(`Could not clear previous AI Planner mappings: ${dayPlansError.message}`);
    const dayPlanIds = (dayPlans ?? []).map((item) => item.id);
    if (dayPlanIds.length > 0) {
      const { error: mappingDeleteError } = await serviceRole.from("google_planner_events").delete().eq("user_id", user.id).in("daily_plan_id", dayPlanIds);
      if (mappingDeleteError) throw new Error(`Could not clear previous AI Planner mappings: ${mappingDeleteError.message}`);
    }

    for (const block of blocks ?? []) {
      const googleEventId = await createPlannerEvent(tokenResult.token, calendarId, { planDate: plan.plan_date, timeZone, title: block.title, startTime: block.start_time, endTime: block.end_time, dailyPlanId: plan.id, planBlockId: block.id });
      const { error: mappingError } = await serviceRole.from("google_planner_events").insert({ user_id: user.id, daily_plan_id: plan.id, plan_block_id: block.id, google_event_id: googleEventId });
      if (mappingError) throw new Error(`Google event ${googleEventId} was created, but its local mapping could not be saved: ${mappingError.message}`);
    }
  } catch (publishError) {
    const message = publishError instanceof Error ? publishError.message : "Unknown publishing error.";
    throw new Error(`Plan confirmed, but publishing to AI Planner failed: ${message}`);
  }
  revalidatePath("/today");
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
