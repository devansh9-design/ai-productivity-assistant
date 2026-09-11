"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/require-user";
import { TIMEZONE_COOKIE_NAME } from "@/lib/tasks/timezone";
import { DEFAULT_TIMEZONE, getTodayISODate } from "@/lib/tasks/timezone";
import {
  type AvailabilityRuleInput,
  type FixedCommitmentInput,
} from "@/lib/scheduler/engine";
import { buildDraftPlan, type ExistingManualBlock } from "@/lib/plans/planner";
import { getValidAccessToken } from "@/lib/google/oauth";
import { fetchCalendarEvents } from "@/lib/google/calendar";
import {
  createPlannerEvent,
  deletePlannerEvent,
  getOrCreatePlannerCalendar,
  updatePlannerEvent,
} from "@/lib/google/planner-calendar";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import type { DailyPlan, PlanBlock, Task } from "@/lib/types";

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
  const timeZone =
    cookieStore.get(TIMEZONE_COOKIE_NAME)?.value || DEFAULT_TIMEZONE;
  const planDate = getTodayISODate(timeZone);
  const weekday = new Date(`${planDate}T00:00:00Z`).getUTCDay();

  const [
    { data: rules, error: rulesError },
    { data: commitments, error: commitmentsError },
    { data: tasks, error: tasksError },
    { data: existingActivePlan },
  ] = await Promise.all([
    supabase.from("availability_rules").select("*").eq("weekday", weekday),
    supabase
      .from("fixed_commitments")
      .select("*")
      .eq("commitment_date", planDate),
    supabase.from("tasks").select("*").returns<Task[]>(),
    supabase
      .from("daily_plans")
      .select("*")
      .eq("plan_date", planDate)
      .in("status", ["draft", "confirmed"])
      .maybeSingle<DailyPlan>(),
  ]);
  if (rulesError || commitmentsError || tasksError)
    return {
      error:
        rulesError?.message ??
        commitmentsError?.message ??
        tasksError?.message ??
        "Could not load scheduling data.",
    };

  let manualBlocks: ExistingManualBlock[] = [];
  if (existingActivePlan?.status === "draft") {
    const { data: blocks } = await supabase
      .from("plan_blocks")
      .select("*")
      .eq("daily_plan_id", existingActivePlan.id)
      .eq("is_manual", true)
      .not("task_id", "is", null)
      .returns<PlanBlock[]>();
    manualBlocks = (blocks ?? []).map((b) => ({
      id: b.id,
      task_id: b.task_id,
      kind: b.kind as "task" | "buffer",
      title: b.title,
      start_time: b.start_time,
      end_time: b.end_time,
      is_manual: b.is_manual,
    }));
  }

  const availabilityRules: AvailabilityRuleInput[] = (rules ?? []).map(
    (rule) => ({
      weekday: rule.weekday,
      kind: rule.kind,
      startTime: rule.start_time,
      endTime: rule.end_time,
    }),
  );
  const fixedCommitments: FixedCommitmentInput[] = (commitments ?? []).map(
    (c) => ({
      id: c.id,
      date: c.commitment_date,
      title: c.title,
      startTime: c.start_time,
      endTime: c.end_time,
    }),
  );

  const engineTasks = (tasks ?? []).map((task) => ({
    id: task.id,
    title: task.title,
    status: task.status,
    priority: task.priority,
    urgency: task.urgency,
    impact: task.impact,
    mustDo: task.must_do,
    dueDate: task.due_date,
    estimatedMinutes: task.estimated_minutes,
    energyLevel: task.energy_level,
    createdAt: task.created_at,
  }));

  const tokenResult = await getValidAccessToken(user.id);
  let calendarEvents: { googleEventId: string; title: string; startTime: string; endTime: string }[] = [];

  if ("error" in tokenResult) {
    if (tokenResult.error === "reconnect_required") {
      return { error: "Google Calendar credentials are no longer valid. Please reconnect Google Calendar in Settings." };
    }
    if (tokenResult.error === "calendar_sync_failed") {
      return { error: "Could not sync Google Calendar events. Please try again." };
    }
  } else {
    const tzCookie = cookieStore.get(TIMEZONE_COOKIE_NAME)?.value;
    if (!tzCookie) {
      return { error: "Timezone could not be determined. Please refresh the page to sync your timezone." };
    }
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: tzCookie });
    } catch {
      return { error: "Invalid timezone detected. Please refresh the page to sync your timezone." };
    }

    try {
      calendarEvents = await fetchCalendarEvents(tokenResult.token, planDate, tzCookie);
    } catch {
      return { error: "Could not sync Google Calendar events. Please try again." };
    }
  }

  const planResult = buildDraftPlan({
    date: planDate,
    weekday,
    availabilityRules,
    fixedCommitments,
    tasks: engineTasks,
    existingManualBlocks: manualBlocks,
    calendarEvents,
  });

  const { data: plan, error: planError } = await supabase
    .rpc("create_draft_plan", {
      p_user_id: user.id,
      p_plan_date: planDate,
      p_buffer_minutes: planResult.bufferMinutes,
      p_generated_at: new Date().toISOString(),
      p_blocks: planResult.blocks.map((b) => ({
        task_id: b.taskId,
        kind: b.kind,
        title: b.title,
        start_time: b.startTime,
        end_time: b.endTime,
        sort_order: b.sortOrder,
        is_manual: b.isManual,
      })),
      p_unscheduled: planResult.unscheduled.map((item) => ({
        task_id: item.taskId,
        reason: item.reason,
      })),
    })
    .single<DailyPlan>();
  if (planError || !plan) {
    return { error: planError?.message ?? "Could not save draft plan." };
  }
  revalidatePath("/today");
}

export async function confirmPlan(formData: FormData) {
  const { supabase, user } = await requireUser();
  const planId = requiredText(formData, "plan_id", "Plan ID");

  const { data: plan, error } = await supabase
    .rpc("confirm_daily_plan", { p_plan_id: planId })
    .single<DailyPlan>();
  if (error || !plan) throw new Error(error?.message ?? "Could not confirm plan.");

  const tokenResult = await getValidAccessToken(user.id);
  if ("error" in tokenResult) {
    if (tokenResult.error === "not_connected") {
      revalidatePath("/today");
      return;
    }
    if (tokenResult.error === "reconnect_required") {
      throw new Error("Plan confirmed, but Google Calendar needs to be reconnected before it can be published.");
    }
    throw new Error("Plan confirmed, but Google Calendar could not be accessed. Please try again.");
  }

  const cookieStore = await cookies();
  const timeZone = cookieStore.get(TIMEZONE_COOKIE_NAME)?.value;
  if (!timeZone) throw new Error("Plan confirmed, but your timezone could not be determined. Please refresh and try again.");
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
  } catch {
    throw new Error("Plan confirmed, but your timezone is invalid. Please refresh and try again.");
  }

  const { data: blocks, error: blocksError } = await supabase
    .from("plan_blocks")
    .select("*")
    .eq("daily_plan_id", plan.id)
    .eq("user_id", user.id)
    .eq("kind", "task")
    .returns<PlanBlock[]>();
  if (blocksError) throw new Error(`Plan confirmed, but its work blocks could not be loaded: ${blocksError.message}`);

  try {
    const calendarId = await getOrCreatePlannerCalendar(user.id, tokenResult.token);
    const serviceRole = createServiceRoleClient();

    // Reconcile the confirmed plan against stored Google event IDs. Existing
    // AI Planner events are updated in place; missing ones are created. This
    // makes retries idempotent and preserves external event IDs.
    const serviceRole = createServiceRoleClient();

    const { data: dayPlans, error: dayPlansError } = await serviceRole
      .from("daily_plans")
      .select("id")
      .eq("user_id", user.id)
      .eq("plan_date", plan.plan_date);
    if (dayPlansError) {
      throw new Error(`Could not load AI Planner mappings: ${dayPlansError.message}`);
    }

    const dayPlanIds = (dayPlans ?? []).map((item) => item.id);
    const { data: existingMappings, error: mappingsError } = await serviceRole
      .from("google_planner_events")
      .select("id,daily_plan_id,plan_block_id,google_event_id")
      .eq("user_id", user.id)
      .in("daily_plan_id", dayPlanIds.length ? dayPlanIds : [plan.id]);

    if (mappingsError) {
      throw new Error(`Could not load existing AI Planner mappings: ${mappingsError.message}`);
    }

    const currentBlockIds = new Set((blocks ?? []).map((block) => block.id));
    const currentMappings = new Map(
      (existingMappings ?? [])
        .filter((mapping) => mapping.daily_plan_id === plan.id)
        .map((mapping) => [mapping.plan_block_id, mapping]),
    );

    // Remove mappings/events belonging to superseded plan versions or blocks
    // that are no longer part of the confirmed plan.
    for (const mapping of existingMappings ?? []) {
      if (mapping.daily_plan_id === plan.id && currentBlockIds.has(mapping.plan_block_id)) {
        continue;
      }

      await deletePlannerEvent(tokenResult.token, calendarId, mapping.google_event_id);
      const { error: deleteMappingError } = await serviceRole
        .from("google_planner_events")
        .delete()
        .eq("id", mapping.id)
        .eq("user_id", user.id);
      if (deleteMappingError) {
        throw new Error(`Could not remove stale AI Planner mapping: ${deleteMappingError.message}`);
      }
    }

    for (const block of blocks ?? []) {
      const input = {
        planDate: plan.plan_date,
        timeZone,
        title: block.title,
        startTime: block.start_time,
        endTime: block.end_time,
        dailyPlanId: plan.id,
        planBlockId: block.id,
      };

      const existing = currentMappings.get(block.id);
      if (existing) {
        try {
          await updatePlannerEvent(tokenResult.token, calendarId, existing.google_event_id, input);
          continue;
        } catch (updateError) {
          // A deleted external event can be recreated and remapped without
          // creating a duplicate when Google reports the stored ID is gone.
          if (!(updateError instanceof Error) || !updateError.message.includes("no longer exists")) {
            throw updateError;
          }

          const googleEventId = await createPlannerEvent(tokenResult.token, calendarId, input);
          const { error: mappingUpdateError } = await serviceRole
            .from("google_planner_events")
            .update({ google_event_id: googleEventId })
            .eq("id", existing.id)
            .eq("user_id", user.id);
          if (mappingUpdateError) {
            throw new Error(`Google event ${googleEventId} was created, but its mapping could not be updated: ${mappingUpdateError.message}`);
          }
          continue;
        }
      }

      const googleEventId = await createPlannerEvent(tokenResult.token, calendarId, input);
      const { error: mappingInsertError } = await serviceRole
        .from("google_planner_events")
        .insert({
          user_id: user.id,
          daily_plan_id: plan.id,
          plan_block_id: block.id,
          google_event_id: googleEventId,
        });
      if (mappingInsertError) {
        throw new Error(`Google event ${googleEventId} was created, but its local mapping could not be saved: ${mappingInsertError.message}`);
      }
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
  if (!validTime(newStart) || !validTime(newEnd) || newEnd <= newStart)
    throw new Error("Choose a valid same-day start and end time.");

  const { error } = await supabase.rpc("edit_draft_plan_block", {
    p_block_id: blockId,
    p_start_time: newStart,
    p_end_time: newEnd,
  });
  if (error) throw new Error(error.message);
  revalidatePath("/today");
}
