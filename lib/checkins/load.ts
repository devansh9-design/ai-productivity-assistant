import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { goalsBehindWeeklyTarget } from "@/lib/checkins/morning";
import type { MetricAggregation } from "@/lib/types";
import { log } from "@/lib/log";

/**
 * Goals still behind a weekly target for the week starting weekStart, using
 * logs up to and including date. A read failure is logged and returns no
 * goals, so the plan is still generated, just without that priority.
 */
export async function loadGoalsBehindWeeklyTarget(supabase: SupabaseClient, weekStart: string, date: string): Promise<string[]> {
  const { data: targets, error: targetsError } = await supabase
    .from("weekly_targets")
    .select("goal_id,goal_metric_id,target_value")
    .eq("week_start", weekStart)
    .returns<Array<{ goal_id: string; goal_metric_id: string | null; target_value: number | null }>>();
  if (targetsError) {
    log("error", "plans.weekly_targets_failed", { message: targetsError.message });
    return [];
  }
  if (!targets || targets.length === 0) return [];

  const metricIds = [...new Set(targets.map((target) => target.goal_metric_id).filter((id): id is string => id !== null))];
  if (metricIds.length === 0) return goalsBehindWeeklyTarget({ targets, metrics: [], logs: [] });

  const [metricsResult, logsResult] = await Promise.all([
    supabase.from("goal_metrics").select("id,aggregation").in("id", metricIds).returns<Array<{ id: string; aggregation: MetricAggregation }>>(),
    supabase
      .from("progress_logs")
      .select("goal_metric_id,value")
      .in("goal_metric_id", metricIds)
      .gte("log_date", weekStart)
      .lte("log_date", date)
      .returns<Array<{ goal_metric_id: string; value: number }>>(),
  ]);
  const readError = metricsResult.error ?? logsResult.error;
  if (readError) {
    log("error", "plans.weekly_target_progress_failed", { message: readError.message });
    return goalsBehindWeeklyTarget({ targets, metrics: [], logs: [] });
  }
  return goalsBehindWeeklyTarget({ targets, metrics: metricsResult.data ?? [], logs: logsResult.data ?? [] });
}
