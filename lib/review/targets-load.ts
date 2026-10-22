import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { loadDayFacts } from "@/lib/feedback/load";
import type { GoalPlanning } from "@/lib/review/targets";
import { weekEnd } from "@/lib/review/week";
import type { GoalMetric, Routine, WeeklyTarget } from "@/lib/types";

function check<T>(result: { data: T | null; error: { message: string } | null }): T {
  if (result.error) throw new Error(result.error.message);
  return result.data as T;
}

/** Every active goal with how the reviewed week went and what is already set for the planning week. */
export async function loadTargetPlanning(supabase: SupabaseClient, reviewWeek: string, planningWeek: string): Promise<GoalPlanning[]> {
  const [goals, metrics, routines, existing, facts] = await Promise.all([
    supabase.from("goals").select("id,title").eq("status", "active").order("created_at").returns<Array<{ id: string; title: string }>>(),
    supabase.from("goal_metrics").select("*").order("position").returns<GoalMetric[]>(),
    supabase.from("routines").select("*").returns<Routine[]>(),
    supabase.from("weekly_targets").select("*").eq("week_start", planningWeek).order("created_at").returns<WeeklyTarget[]>(),
    // The reviewed week's last day: each target is judged against its whole week.
    loadDayFacts(supabase, weekEnd(reviewWeek)),
  ]);
  const metricRows = check(metrics) ?? [];
  const routineRows = check(routines) ?? [];
  const existingRows = check(existing) ?? [];
  return (check(goals) ?? []).map((goal) => ({
    goalId: goal.id,
    title: goal.title,
    lastWeek: facts.goals.find((item) => item.goalId === goal.id)?.targets ?? [],
    metrics: metricRows.filter((metric) => metric.goal_id === goal.id).map((metric) => ({
      id: metric.id, name: metric.name, unit: metric.unit, aggregation: metric.aggregation,
      targetValue: metric.target_value === null ? null : Number(metric.target_value),
    })),
    routines: routineRows.filter((routine) => routine.goal_id === goal.id).map((routine) => ({
      title: routine.title, metricId: routine.goal_metric_id, metricAmount: routine.metric_amount === null ? null : Number(routine.metric_amount),
      daysOfWeek: routine.days_of_week, startDate: routine.start_date, endDate: routine.end_date, active: routine.active,
    })),
    existing: existingRows.filter((target) => target.goal_id === goal.id).map((target) => ({
      title: target.title, metricId: target.goal_metric_id, value: target.target_value === null ? null : Number(target.target_value),
    })),
  }));
}
