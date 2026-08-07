"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/require-user";
import { TIMEZONE_COOKIE_NAME } from "@/lib/tasks/timezone";
import { DEFAULT_TIMEZONE, getTodayISODate } from "@/lib/tasks/timezone";
import { generateSchedule, type AvailabilityRuleInput, type FixedCommitmentInput } from "@/lib/scheduler/engine";
import { isValidISODate } from "@/lib/tasks/date-validation";
import type { AvailabilityRuleKind, DailyPlan, Task } from "@/lib/types";

const RULE_KINDS: AvailabilityRuleKind[] = ["working", "high_focus", "sleep", "meal", "travel", "break"];

function requiredText(formData: FormData, key: string, label: string) {
  const value = String(formData.get(key) ?? "").trim();
  if (!value) throw new Error(`${label} is required.`);
  return value;
}

function validTime(value: string) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function validateTimeRange(startTime: string, endTime: string) {
  if (!validTime(startTime) || !validTime(endTime) || endTime <= startTime) {
    throw new Error("Choose a valid same-day start and end time.");
  }
}

export async function createAvailabilityRule(formData: FormData) {
  const { supabase, user } = await requireUser();
  const weekday = Number.parseInt(requiredText(formData, "weekday", "Weekday"), 10);
  const kind = requiredText(formData, "kind", "Rule type");
  const startTime = requiredText(formData, "start_time", "Start time");
  const endTime = requiredText(formData, "end_time", "End time");
  if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6 || !RULE_KINDS.includes(kind as AvailabilityRuleKind)) throw new Error("Choose a valid schedule rule.");
  validateTimeRange(startTime, endTime);
  const { error } = await supabase.from("availability_rules").insert({ user_id: user.id, weekday, kind, start_time: startTime, end_time: endTime });
  if (error) throw new Error(error.message);
  revalidatePath("/settings");
}

export async function deleteAvailabilityRule(formData: FormData) {
  const { supabase, user } = await requireUser();
  const id = requiredText(formData, "id", "Rule id");
  const { error } = await supabase.from("availability_rules").delete().eq("id", id).eq("user_id", user.id);
  if (error) throw new Error(error.message);
  revalidatePath("/settings");
}

export async function createFixedCommitment(formData: FormData) {
  const { supabase, user } = await requireUser();
  const title = requiredText(formData, "title", "Title");
  const commitmentDate = requiredText(formData, "commitment_date", "Date");
  const startTime = requiredText(formData, "start_time", "Start time");
  const endTime = requiredText(formData, "end_time", "End time");
  if (!isValidISODate(commitmentDate) || title.length > 200) throw new Error("Enter a valid commitment.");
  validateTimeRange(startTime, endTime);
  const { error } = await supabase.from("fixed_commitments").insert({ user_id: user.id, title, commitment_date: commitmentDate, start_time: startTime, end_time: endTime });
  if (error) throw new Error(error.message);
  revalidatePath("/settings");
  revalidatePath("/today");
}

export async function deleteFixedCommitment(formData: FormData) {
  const { supabase, user } = await requireUser();
  const id = requiredText(formData, "id", "Commitment id");
  const { error } = await supabase.from("fixed_commitments").delete().eq("id", id).eq("user_id", user.id);
  if (error) throw new Error(error.message);
  revalidatePath("/settings");
  revalidatePath("/today");
}

/** @deprecated Use generateDraftPlan from lib/plans/actions.ts for Day 5+ workflow. */
export async function generateTodayPlan() {
  const { supabase, user } = await requireUser();
  const cookieStore = await cookies();
  const timeZone = cookieStore.get(TIMEZONE_COOKIE_NAME)?.value || DEFAULT_TIMEZONE;
  const planDate = getTodayISODate(timeZone);
  const weekday = new Date(`${planDate}T00:00:00Z`).getUTCDay();
  const [{ data: rules, error: rulesError }, { data: commitments, error: commitmentsError }, { data: tasks, error: tasksError }] = await Promise.all([
    supabase.from("availability_rules").select("*").eq("weekday", weekday),
    supabase.from("fixed_commitments").select("*").eq("commitment_date", planDate),
    supabase.from("tasks").select("*").returns<Task[]>(),
  ]);
  if (rulesError || commitmentsError || tasksError) throw new Error(rulesError?.message ?? commitmentsError?.message ?? tasksError?.message ?? "Could not load scheduling data.");

  const result = generateSchedule({
    date: planDate,
    weekday,
    availabilityRules: (rules ?? []).map((rule): AvailabilityRuleInput => ({ weekday: rule.weekday, kind: rule.kind, startTime: rule.start_time, endTime: rule.end_time })),
    fixedCommitments: (commitments ?? []).map((commitment): FixedCommitmentInput => ({ id: commitment.id, date: commitment.commitment_date, title: commitment.title, startTime: commitment.start_time, endTime: commitment.end_time })),
    tasks: (tasks ?? []).map((task) => ({ id: task.id, title: task.title, status: task.status, priority: task.priority, urgency: task.urgency, impact: task.impact, mustDo: task.must_do, dueDate: task.due_date, estimatedMinutes: task.estimated_minutes, energyLevel: task.energy_level, createdAt: task.created_at })),
  });

  const { data: plan, error: planError } = await supabase
    .rpc("replace_daily_plan", {
      p_user_id: user.id,
      p_plan_date: planDate,
      p_buffer_minutes: result.bufferMinutes,
      p_generated_at: new Date().toISOString(),
      p_blocks: result.blocks.map((block) => ({
        task_id: block.taskId,
        kind: block.kind,
        title: block.title,
        start_time: block.startTime,
        end_time: block.endTime,
      })),
      p_unscheduled: result.unscheduled.map((item) => ({
        task_id: item.taskId,
        reason: item.reason,
      })),
    })
    .single<DailyPlan>();
  if (planError || !plan) throw new Error(planError?.message ?? "Could not save daily plan.");
  revalidatePath("/today");
}
