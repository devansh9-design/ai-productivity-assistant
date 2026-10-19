import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { loadAnalyticsInput } from "@/lib/analytics/load";
import { buildWeekFacts, weekRange, type MetricKey, type ReviewCheckin, type WeekFacts } from "@/lib/review/facts";
import type { SchedulerTask } from "@/lib/scheduler/engine";
import type { EnergyLevel, Task, TaskStatus } from "@/lib/types";
import { errorFields, log } from "@/lib/log";

export async function loadWeekFacts(
  supabase: SupabaseClient,
  userId: string,
  weekStart: string,
  timeZone: string,
  today: string,
): Promise<WeekFacts> {
  const range = weekRange(weekStart);
  const [input, checkinsResult, journalResult] = await Promise.all([
    loadAnalyticsInput(supabase, userId, range, timeZone, today),
    supabase.from("checkins").select("checkin_date,mood,energy_level,wins,lesson,distractions")
      .eq("user_id", userId).eq("type", "evening").gte("checkin_date", range.from).lte("checkin_date", range.to),
    supabase.from("journal_entries").select("entry_date,reflection")
      .eq("user_id", userId).gte("entry_date", range.from).lte("entry_date", range.to),
  ]);
  const loadError = checkinsResult.error ?? journalResult.error;
  if (loadError) throw new Error(loadError.message);

  const reflections = new Map((journalResult.data ?? []).map((entry) => [entry.entry_date as string, entry.reflection as string]));
  const checkins: ReviewCheckin[] = (checkinsResult.data ?? []).map((row) => ({
    date: row.checkin_date as string,
    mood: row.mood as number | null,
    energy_level: row.energy_level as EnergyLevel | null,
    wins: row.wins as string | null,
    lesson: row.lesson as string | null,
    distractions: row.distractions as string | null,
    reflection: reflections.get(row.checkin_date as string) ?? null,
  }));
  return buildWeekFacts(input, checkins);
}

export interface SavedReview {
  source: "ai" | "fallback";
  headline: string;
  suggestion: string | null;
  observations: Array<{ metric: MetricKey; note: string }>;
  fallbackReason: string | null;
  generatedAt: string;
  /** Only highlights whose task still exists; titles come from the tasks table. */
  highlights: Array<{ taskId: string; title: string; note: string | null }>;
}

export async function loadSavedReview(supabase: SupabaseClient, weekStart: string): Promise<SavedReview | null> {
  const { data: review, error } = await supabase
    .from("weekly_reviews")
    .select("id,summary_source,summary_headline,summary_suggestion,observations,fallback_reason,generated_at")
    .eq("review_week_start", weekStart)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!review) return null;

  const { data: highlights, error: highlightsError } = await supabase
    .from("weekly_review_highlights")
    .select("task_id,note,position,tasks(title)")
    .eq("weekly_review_id", review.id)
    .order("position");
  if (highlightsError) throw new Error(highlightsError.message);

  return {
    source: review.summary_source,
    headline: review.summary_headline,
    suggestion: review.summary_suggestion,
    observations: Array.isArray(review.observations) ? review.observations : [],
    fallbackReason: review.fallback_reason,
    generatedAt: review.generated_at,
    highlights: (highlights ?? []).flatMap((row) => {
      const task = (Array.isArray(row.tasks) ? row.tasks[0] : row.tasks) as { title: string } | null;
      return task ? [{ taskId: row.task_id as string, title: task.title, note: row.note as string | null }] : [];
    }),
  };
}

export interface PlannedTask {
  taskId: string;
  title: string;
  status: TaskStatus;
}

export interface SavedWeeklyPlan {
  priorities: PlannedTask[];
  shortlist: PlannedTask[];
  updatedAt: string;
}

export async function loadWeeklyPlan(supabase: SupabaseClient, planningWeekStart: string): Promise<SavedWeeklyPlan | null> {
  const { data: plan, error } = await supabase
    .from("weekly_plans")
    .select("id,updated_at")
    .eq("planning_week_start", planningWeekStart)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!plan) return null;

  const { data: items, error: itemsError } = await supabase
    .from("weekly_plan_items")
    .select("task_id,kind,position,tasks(title,status)")
    .eq("weekly_plan_id", plan.id)
    .order("position");
  if (itemsError) throw new Error(itemsError.message);

  const rows = (items ?? []).flatMap((row) => {
    const task = (Array.isArray(row.tasks) ? row.tasks[0] : row.tasks) as { title: string; status: TaskStatus } | null;
    return task ? [{ kind: row.kind as string, taskId: row.task_id as string, title: task.title, status: task.status }] : [];
  });
  const pick = (kind: string) => rows.filter((row) => row.kind === kind).map(({ taskId, title, status }) => ({ taskId, title, status }));
  return { priorities: pick("priority"), shortlist: pick("shortlist"), updatedAt: plan.updated_at };
}

/**
 * Task IDs chosen as priorities for the week starting `weekStart`. Returns an
 * empty list if they cannot be read, so daily planning never breaks on it.
 */
export async function loadWeekPriorityIds(supabase: SupabaseClient, weekStart: string): Promise<string[]> {
  try {
    const plan = await loadWeeklyPlan(supabase, weekStart);
    return plan?.priorities.map((item) => item.taskId) ?? [];
  } catch (error) {
    log("error", "review.week_priorities_failed", errorFields(error));
    return [];
  }
}

export interface OpenTask extends SchedulerTask {
  title: string;
}

export async function loadOpenTasks(supabase: SupabaseClient, userId: string): Promise<OpenTask[]> {
  const { data, error } = await supabase
    .from("tasks")
    .select("*")
    .eq("user_id", userId)
    .in("status", ["todo", "in_progress", "deferred"])
    .order("created_at")
    .limit(1000)
    .returns<Task[]>();
  if (error) throw new Error(error.message);
  return (data ?? []).map((task) => ({
    id: task.id, title: task.title, status: task.status, priority: task.priority, urgency: task.urgency, impact: task.impact,
    mustDo: task.must_do, dueDate: task.due_date, estimatedMinutes: task.estimated_minutes, energyLevel: task.energy_level, createdAt: task.created_at,
  }));
}
