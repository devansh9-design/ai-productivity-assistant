"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/require-user";
import { TIMEZONE_COOKIE_NAME } from "@/components/timezone-sync";
import { DEFAULT_TIMEZONE, getTodayISODate } from "@/lib/tasks/timezone";
import {
  type AvailabilityRuleInput,
  type FixedCommitmentInput,
} from "@/lib/scheduler/engine";
import { buildDraftPlan, type ExistingManualBlock } from "@/lib/plans/planner";
import type { DailyPlan, PlanBlock, Task } from "@/lib/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function requiredText(formData: FormData, key: string, label: string): string {
  const value = String(formData.get(key) ?? "").trim();
  if (!value) throw new Error(`${label} is required.`);
  return value;
}

function validTime(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

// ---------------------------------------------------------------------------
// Generate a draft plan (or regenerate an existing draft)
// ---------------------------------------------------------------------------

export async function generateDraftPlan() {
  const { supabase, user } = await requireUser();
  const cookieStore = await cookies();
  const timeZone =
    cookieStore.get(TIMEZONE_COOKIE_NAME)?.value || DEFAULT_TIMEZONE;
  const planDate = getTodayISODate(timeZone);
  const weekday = new Date(`${planDate}T00:00:00Z`).getUTCDay();

  // Fetch scheduling inputs + existing active plan in parallel
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
    throw new Error(
      rulesError?.message ??
        commitmentsError?.message ??
        tasksError?.message ??
        "Could not load scheduling data.",
    );

  // Collect manual blocks from an existing *draft* only.
  // Confirmed plans get superseded; their blocks are not reused.
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
      kind: b.kind,
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

  // Run pure planner orchestrator
  const planResult = buildDraftPlan({
    date: planDate,
    weekday,
    availabilityRules,
    fixedCommitments,
    tasks: engineTasks,
    existingManualBlocks: manualBlocks,
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
  if (planError || !plan)
    throw new Error(planError?.message ?? "Could not save draft plan.");
  revalidatePath("/today");
}

// ---------------------------------------------------------------------------
// Confirm a draft plan
// ---------------------------------------------------------------------------

export async function confirmPlan(formData: FormData) {
  const { supabase } = await requireUser();
  const planId = requiredText(formData, "plan_id", "Plan ID");

  const { data: plan, error } = await supabase
    .rpc("confirm_daily_plan", { p_plan_id: planId })
    .single<DailyPlan>();
  if (error || !plan)
    throw new Error(error?.message ?? "Could not confirm plan.");
  revalidatePath("/today");
}

// ---------------------------------------------------------------------------
// Remove a block from a draft plan (database-enforced atomic draft check)
// ---------------------------------------------------------------------------

export async function removePlanBlock(formData: FormData) {
  const { supabase } = await requireUser();
  const blockId = requiredText(formData, "block_id", "Block ID");

  const { error } = await supabase.rpc("delete_draft_plan_block", {
    p_block_id: blockId,
  });
  if (error) throw new Error(error.message);
  revalidatePath("/today");
}

// ---------------------------------------------------------------------------
// Edit a block's start/end time in a draft plan (database-enforced atomic check)
// ---------------------------------------------------------------------------

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
