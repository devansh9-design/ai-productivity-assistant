import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { buildDayFacts, parseStoredSuggestions, type DayFacts, type StoredSuggestion } from "@/lib/feedback/daily";
import type { LogOutcome } from "@/lib/evening/log";
import { mondayOf } from "@/lib/review/week";
import { addDaysToISODate } from "@/lib/tasks/timezone";
import type { DailyFeedback, GoalMetric, Routine, Task } from "@/lib/types";

function check<T>(result: { data: T | null; error: { message: string } | null }): T {
  if (result.error) throw new Error(result.error.message);
  return result.data as T;
}

/** The facts for one day's feedback, through the student's own RLS-scoped client. */
export async function loadDayFacts(supabase: SupabaseClient, date: string): Promise<DayFacts> {
  const weekStart = mondayOf(date);
  const tomorrow = addDaysToISODate(date, 1);
  const [items, goals, targets, routines, routineTasks, openTasks, tomorrowTasks] = await Promise.all([
    supabase.from("evening_log_items").select("task_id,outcome,reason").eq("log_date", date)
      .returns<Array<{ task_id: string; outcome: LogOutcome; reason: string | null }>>(),
    supabase.from("goals").select("id,title").eq("status", "active").order("created_at").returns<Array<{ id: string; title: string }>>(),
    supabase.from("weekly_targets").select("goal_id,title,goal_metric_id,target_value").eq("week_start", weekStart)
      .returns<Array<{ goal_id: string; title: string; goal_metric_id: string | null; target_value: number | null }>>(),
    supabase.from("routines").select("*").returns<Routine[]>(),
    supabase.from("tasks").select("routine_id,occurrence_date,status").not("routine_id", "is", null)
      .gte("occurrence_date", weekStart).lte("occurrence_date", date)
      .returns<Array<Pick<Task, "routine_id" | "occurrence_date" | "status">>>(),
    supabase.from("tasks").select("id,title,priority").is("routine_id", null).in("status", ["todo", "in_progress"]).lte("due_date", date)
      .returns<Array<Pick<Task, "id" | "title" | "priority">>>(),
    supabase.from("tasks").select("title").eq("due_date", tomorrow).returns<Array<{ title: string }>>(),
  ]);
  const itemRows = check(items) ?? [];
  const goalRows = check(goals) ?? [];
  const activeGoalIds = new Set(goalRows.map((goal) => goal.id));

  const taskIds = itemRows.map((item) => item.task_id);
  const [titles, metrics] = await Promise.all([
    taskIds.length > 0
      ? supabase.from("tasks").select("id,title").in("id", taskIds).returns<Array<{ id: string; title: string }>>()
      : Promise.resolve({ data: [] as Array<{ id: string; title: string }>, error: null }),
    goalRows.length > 0
      ? supabase.from("goal_metrics").select("*").in("goal_id", [...activeGoalIds]).returns<GoalMetric[]>()
      : Promise.resolve({ data: [] as GoalMetric[], error: null }),
  ]);
  const titleById = new Map((check(titles) ?? []).map((task) => [task.id, task.title]));
  const metricRows = check(metrics) ?? [];
  const logs = metricRows.length > 0
    ? check(await supabase.from("progress_logs").select("goal_metric_id,value").in("goal_metric_id", metricRows.map((metric) => metric.id))
      .gte("log_date", weekStart).lte("log_date", date).returns<Array<{ goal_metric_id: string; value: number }>>()) ?? []
    : [];

  return buildDayFacts({
    date,
    logItems: itemRows.map((item) => ({ taskId: item.task_id, title: titleById.get(item.task_id) ?? "Task", outcome: item.outcome, reason: item.reason })),
    goals: goalRows,
    metrics: metricRows.map((metric) => ({ id: metric.id, goalId: metric.goal_id, name: metric.name, unit: metric.unit, aggregation: metric.aggregation })),
    targets: (check(targets) ?? []).filter((target) => activeGoalIds.has(target.goal_id))
      .map((target) => ({ goalId: target.goal_id, title: target.title, metricId: target.goal_metric_id, targetValue: target.target_value === null ? null : Number(target.target_value) })),
    logs: logs.map((log) => ({ metricId: log.goal_metric_id, value: Number(log.value) })),
    routines: (check(routines) ?? []).filter((routine) => routine.goal_id !== null && activeGoalIds.has(routine.goal_id)).map((routine) => ({
      id: routine.id, goalId: routine.goal_id, title: routine.title, daysOfWeek: routine.days_of_week, minutes: routine.minutes,
      metricId: routine.goal_metric_id, metricAmount: routine.metric_amount === null ? null : Number(routine.metric_amount),
      startDate: routine.start_date, endDate: routine.end_date, active: routine.active,
    })),
    routineTasks: (check(routineTasks) ?? []).map((task) => ({ routineId: task.routine_id!, occurrenceDate: task.occurrence_date!, status: task.status })),
    openTasks: check(openTasks) ?? [],
    tomorrowTitles: (check(tomorrowTasks) ?? []).map((task) => task.title),
  });
}

export interface FeedbackState {
  feedback: (Omit<DailyFeedback, "suggestions"> & { suggestions: StoredSuggestion[] }) | null;
  /** The evening log has been saved and the feedback is missing or older than the last save. */
  needsFeedback: boolean;
}

/** Today's stored feedback, and whether the evening log has changed since it was written. */
export async function loadFeedbackState(supabase: SupabaseClient, date: string): Promise<FeedbackState> {
  const [feedback, items, checkin, journal, logs] = await Promise.all([
    supabase.from("daily_feedback").select("*").eq("feedback_date", date).maybeSingle<DailyFeedback>(),
    supabase.from("evening_log_items").select("updated_at").eq("log_date", date).order("updated_at", { ascending: false }).limit(1).returns<Array<{ updated_at: string }>>(),
    supabase.from("checkins").select("updated_at").eq("checkin_date", date).eq("type", "evening").limit(1).returns<Array<{ updated_at: string }>>(),
    supabase.from("journal_entries").select("updated_at").eq("entry_date", date).limit(1).returns<Array<{ updated_at: string }>>(),
    supabase.from("progress_logs").select("updated_at").eq("log_date", date).order("updated_at", { ascending: false }).limit(1).returns<Array<{ updated_at: string }>>(),
  ]);
  const row = check(feedback);
  const lastSaved = [check(items), check(checkin), check(journal), check(logs)]
    .map((rows) => rows?.[0]?.updated_at)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1) ?? null;
  return {
    feedback: row ? { ...row, suggestions: parseStoredSuggestions(row.suggestions) } : null,
    needsFeedback: lastSaved !== null && (!row || Date.parse(row.generated_at) < Date.parse(lastSaved)),
  };
}
