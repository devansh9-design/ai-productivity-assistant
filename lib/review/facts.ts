import { formatMinutes, plural } from "@/lib/analytics/format";
import { computeAnalytics, type AnalyticsInput, type Bar } from "@/lib/analytics/metrics";
import type { AnalyticsRange } from "@/lib/analytics/range";
import { getTodayISODate } from "@/lib/tasks/timezone";
import type { EnergyLevel } from "@/lib/types";
import { weekDays, weekEnd } from "@/lib/review/week";

/** The only metric names the AI summary may refer to. Values are always rendered from these facts. */
export const METRIC_KEYS = [
  "completed_tasks",
  "logged_time",
  "completion_rate",
  "longest_streak",
  "top_category",
  "missed_planned",
  "due_not_done",
  "checkins",
] as const;
export type MetricKey = (typeof METRIC_KEYS)[number];

export function isMetricKey(value: unknown): value is MetricKey {
  return typeof value === "string" && (METRIC_KEYS as readonly string[]).includes(value);
}

export interface ReviewCheckin {
  date: string;
  mood: number | null;
  energy_level: EnergyLevel | null;
  wins: string | null;
  lesson: string | null;
  distractions: string | null;
  reflection: string | null;
}

export interface MetricValue {
  label: string;
  value: string;
}

export interface WeekFacts {
  weekStart: string;
  weekEnd: string;
  completed: Array<{ id: string; title: string; category: string | null; date: string }>;
  missedPlanned: Array<{ id: string; title: string; date: string }>;
  dueNotDone: Array<{ id: string; title: string; status: string; dueDate: string }>;
  loggedMinutes: number;
  timerMinutes: number;
  manualMinutes: number;
  completion: { planned: number; completedOnTime: number; rate: number | null };
  longestStreak: number;
  categories: Bar[];
  checkins: ReviewCheckin[];
  /** Null when a metric does not apply this week; the AI may not comment on it. */
  metrics: Record<MetricKey, MetricValue | null>;
  /** Nothing was recorded: no AI call is made for an empty week. */
  isEmpty: boolean;
}

export function weekRange(weekStart: string): AnalyticsRange {
  const end = weekEnd(weekStart);
  return { preset: "custom", from: weekStart, to: end, days: weekDays(weekStart), label: `${weekStart} to ${end}` };
}

/**
 * The reviewed week's facts, calculated from the records that still exist.
 * Status changes are not stored as history and deleting a task removes it
 * from plans, so these cannot reconstruct every past completion or slip.
 */
export function buildWeekFacts(input: AnalyticsInput, checkins: ReviewCheckin[]): WeekFacts {
  const { range, timeZone } = input;
  const inWeek = new Set(range.days);
  const analytics = computeAnalytics(input);
  const taskById = new Map(input.tasks.map((task) => [task.id, task]));

  const completed = input.tasks
    .filter((task) => task.status === "completed" && task.completed_at)
    .map((task) => ({ id: task.id, title: task.title, category: task.category, date: getTodayISODate(timeZone, new Date(task.completed_at as string)) }))
    .filter((task) => inWeek.has(task.date))
    .sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));

  const missedPlanned = analytics.missedPlanned
    .map(({ taskId, date }) => ({ id: taskId, title: taskById.get(taskId)?.title, date }))
    .filter((item): item is { id: string; title: string; date: string } => Boolean(item.title));

  const dueNotDone = input.tasks
    .filter((task) => task.status !== "completed" && task.due_date !== null && inWeek.has(task.due_date))
    .map((task) => ({ id: task.id, title: task.title, status: task.status, dueDate: task.due_date as string }))
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.title.localeCompare(b.title));

  const weekCheckins = checkins.filter((checkin) => inWeek.has(checkin.date)).sort((a, b) => a.date.localeCompare(b.date));
  const { completion } = analytics;
  const top = analytics.categories[0];

  const metrics: Record<MetricKey, MetricValue | null> = {
    completed_tasks: { label: "Tasks completed", value: String(completed.length) },
    logged_time: { label: "Logged time", value: formatMinutes(analytics.loggedMinutes) },
    completion_rate: completion.rate === null ? null : {
      label: "Planned tasks done on time",
      value: `${Math.round(completion.rate * 100)}% (${completion.completedOnTime} of ${completion.planned})`,
    },
    longest_streak: { label: "Longest streak", value: plural(analytics.streak.longestInRange, "day") },
    top_category: top ? { label: "Most logged time", value: `${top.label} (${formatMinutes(top.value)})` } : null,
    missed_planned: completion.planned ? { label: "Planned tasks that slipped", value: String(missedPlanned.length) } : null,
    due_not_done: { label: "Due this week, not done", value: String(dueNotDone.length) },
    checkins: weekCheckins.length ? { label: "Check-ins recorded", value: String(weekCheckins.length) } : null,
  };

  return {
    weekStart: range.from,
    weekEnd: range.to,
    completed,
    missedPlanned,
    dueNotDone,
    loggedMinutes: analytics.loggedMinutes,
    timerMinutes: analytics.timerMinutes,
    manualMinutes: analytics.manualMinutes,
    completion: { planned: completion.planned, completedOnTime: completion.completedOnTime, rate: completion.rate },
    longestStreak: analytics.streak.longestInRange,
    categories: analytics.categories.slice(0, 3),
    checkins: weekCheckins,
    metrics,
    isEmpty: !completed.length && !analytics.loggedMinutes && !completion.planned && !dueNotDone.length && !weekCheckins.length,
  };
}
