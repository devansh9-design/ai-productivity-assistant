import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Goal, GoalMetric, GoalPhase, Routine, WeeklyTarget } from "@/lib/types";

export interface GoalSummary extends Goal {
  metricCount: number;
  phaseCount: number;
  routineCount: number;
}

/** Every goal with how much of its roadmap exists, for the Goals list. */
export async function loadGoalSummaries(supabase: SupabaseClient): Promise<GoalSummary[]> {
  const [goals, metrics, phases, routines] = await Promise.all([
    supabase.from("goals").select("*").order("created_at", { ascending: true }).returns<Goal[]>(),
    supabase.from("goal_metrics").select("goal_id").returns<Array<{ goal_id: string }>>(),
    supabase.from("goal_phases").select("goal_id").returns<Array<{ goal_id: string }>>(),
    supabase.from("routines").select("goal_id").eq("active", true).returns<Array<{ goal_id: string | null }>>(),
  ]);
  const error = goals.error ?? metrics.error ?? phases.error ?? routines.error;
  if (error) throw new Error(`Could not load goals: ${error.message}`);
  const count = (rows: Array<{ goal_id: string | null }> | null, goalId: string) => (rows ?? []).filter((row) => row.goal_id === goalId).length;
  return (goals.data ?? []).map((goal) => ({
    ...goal,
    metricCount: count(metrics.data, goal.id),
    phaseCount: count(phases.data, goal.id),
    routineCount: count(routines.data, goal.id),
  }));
}

export interface GoalDetail {
  goal: Goal;
  metrics: GoalMetric[];
  phases: GoalPhase[];
  targets: WeeklyTarget[];
  routines: Routine[];
}

/** One goal and its whole roadmap, or null when it doesn't exist (or isn't the student's). */
export async function loadGoalDetail(supabase: SupabaseClient, goalId: string): Promise<GoalDetail | null> {
  const goal = await supabase.from("goals").select("*").eq("id", goalId).maybeSingle<Goal>();
  if (goal.error) throw new Error(`Could not load the goal: ${goal.error.message}`);
  if (!goal.data) return null;
  const [metrics, phases, targets, routines] = await Promise.all([
    supabase.from("goal_metrics").select("*").eq("goal_id", goalId).order("position").returns<GoalMetric[]>(),
    supabase.from("goal_phases").select("*").eq("goal_id", goalId).order("start_date").returns<GoalPhase[]>(),
    supabase.from("weekly_targets").select("*").eq("goal_id", goalId).order("week_start").order("created_at").returns<WeeklyTarget[]>(),
    supabase.from("routines").select("*").eq("goal_id", goalId).order("created_at").returns<Routine[]>(),
  ]);
  const error = metrics.error ?? phases.error ?? targets.error ?? routines.error;
  if (error) throw new Error(`Could not load the goal's roadmap: ${error.message}`);
  return { goal: goal.data, metrics: metrics.data ?? [], phases: phases.data ?? [], targets: targets.data ?? [], routines: routines.data ?? [] };
}
