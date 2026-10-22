import { daysBetween } from "@/lib/goals/roadmap";
import { addDaysToISODate } from "@/lib/tasks/timezone";
import type { MetricAggregation, PhaseStatus } from "@/lib/types";

export interface SeriesPoint {
  date: string;
  value: number;
}

export interface MetricSeries {
  /** Running total for "sum" metrics (baseline plus every log so far), each reading for "latest". */
  logged: SeriesPoint[];
  /** Straight line from the baseline at the start to the target at the target date. */
  targetLine: { from: SeriesPoint; to: SeriesPoint } | null;
  /** The dates the chart spans. */
  start: string;
  end: string;
}

export interface MetricInput {
  aggregation: MetricAggregation;
  baseline: number | null;
  target: number | null;
}

/** The chart data for one metric. Logs may be in any order; dates are YYYY-MM-DD. */
export function buildMetricSeries(
  metric: MetricInput,
  logs: SeriesPoint[],
  goal: { startDate: string | null; targetDate: string | null },
  today: string,
): MetricSeries | null {
  const sorted = [...logs].sort((a, b) => a.date.localeCompare(b.date));
  if (sorted.length === 0) return null;
  const startValue = metric.baseline ?? (metric.aggregation === "sum" ? 0 : null);
  let running = startValue ?? 0;
  const logged = sorted.map((log) => {
    running = metric.aggregation === "sum" ? running + Number(log.value) : Number(log.value);
    return { date: log.date, value: Math.round(running * 100) / 100 };
  });

  const start = goal.startDate && goal.startDate < sorted[0].date ? goal.startDate : sorted[0].date;
  const lastLog = sorted.at(-1)!.date;
  const end = [goal.targetDate, lastLog, today].filter((date): date is string => Boolean(date)).sort().at(-1)!;
  const targetLine = startValue !== null && metric.target !== null && goal.targetDate && goal.startDate && goal.targetDate > goal.startDate
    ? { from: { date: goal.startDate, value: startValue }, to: { date: goal.targetDate, value: Number(metric.target) } }
    : null;
  // A sum metric starts from its baseline on the start day, so the line begins where the target line does.
  if (metric.aggregation === "sum" && startValue !== null && goal.startDate && goal.startDate < logged[0].date) {
    logged.unshift({ date: goal.startDate, value: startValue });
  }
  return { logged, targetLine, start, end };
}

/** The target line's value on a date (straight line between its ends). */
export function targetOn(line: NonNullable<MetricSeries["targetLine"]>, date: string): number {
  const span = daysBetween(line.from.date, line.to.date) - 1;
  const elapsed = daysBetween(line.from.date, date) - 1;
  const value = line.from.value + ((line.to.value - line.from.value) * elapsed) / span;
  return Math.round(value * 10) / 10;
}

export type FinishEstimate =
  | { kind: "done" }
  | { kind: "not_moving" }
  | { kind: "estimate"; date: string; daysVsTarget: number | null }
  | { kind: "unknown"; reason: string };

/**
 * When the target would be reached at the pace so far: the share of the way
 * from baseline to target covered per day since the start, carried forward.
 * Works whichever way the target lies (gaining or losing).
 */
export function estimateFinish(series: MetricSeries | null, metric: MetricInput, goal: { startDate: string | null; targetDate: string | null }, today: string): FinishEstimate {
  if (!series) return { kind: "unknown", reason: "Nothing logged yet." };
  const startValue = metric.baseline ?? (metric.aggregation === "sum" ? 0 : null);
  if (startValue === null || metric.target === null || Number(metric.target) === startValue) return { kind: "unknown", reason: "Needs a baseline and a target." };
  const latest = series.logged.at(-1)!;
  const firstDate = goal.startDate ?? series.logged[0].date;
  const elapsed = daysBetween(firstDate, latest.date) - 1;
  const progress = (latest.value - startValue) / (Number(metric.target) - startValue);
  if (progress >= 1) return { kind: "done" };
  if (elapsed < 3 || series.logged.length < 2) return { kind: "unknown", reason: "A few more days of logs are needed for an estimate." };
  if (progress <= 0) return { kind: "not_moving" };
  const daysNeeded = Math.ceil(((1 - progress) * elapsed) / progress);
  const from = latest.date > today ? latest.date : today;
  const date = addDaysToISODate(from, daysNeeded);
  return { kind: "estimate", date, daysVsTarget: goal.targetDate ? daysBetween(goal.targetDate, date) - 1 : null };
}

/** "about 2 weeks late", "about 3 days early", "on time", for an estimate. */
export function describeFinish(estimate: FinishEstimate): string {
  if (estimate.kind === "done") return "Target reached.";
  if (estimate.kind === "not_moving") return "At this pace: not moving towards the target yet.";
  if (estimate.kind === "unknown") return estimate.reason;
  if (estimate.daysVsTarget === null) return `At this pace: reached around ${estimate.date}.`;
  const days = Math.abs(estimate.daysVsTarget);
  if (days <= 2) return "At this pace: on time.";
  const amount = days >= 14 ? `about ${Math.round(days / 7)} weeks` : `about ${days} days`;
  return `At this pace: ${amount} ${estimate.daysVsTarget > 0 ? "late" : "early"}.`;
}

/** A phase's status from its dates; the stored status column is not kept up to date. */
export function phaseStatusOn(phase: { start_date: string; end_date: string }, today: string): PhaseStatus {
  if (phase.end_date < today) return "completed";
  if (phase.start_date <= today) return "active";
  return "upcoming";
}
