import type { GoalMetric, ProgressLog } from "@/lib/types";

export type LogOutcome = "done" | "partial" | "skipped";
export const LOG_OUTCOMES: LogOutcome[] = ["done", "partial", "skipped"];

// Must match the evening_log_items, checkins and journal_entries constraints.
export const REASON_MAX_LENGTH = 500;
export const LESSON_MAX_LENGTH = 2000;
export const NOTE_MAX_LENGTH = 5000;

export interface EveningLogInput {
  items: Array<{ task_id: string; outcome: LogOutcome; reason: string | null }>;
  /** value null removes that day's reading. */
  metrics: Array<{ goal_metric_id: string; value: number | null }>;
  evening: { mood: number | null; lesson: string | null; note: string | null };
}

/** Form field names, shared by the form and the parser. */
export const field = {
  outcome: (taskId: string) => `outcome:${taskId}`,
  reason: (taskId: string) => `reason:${taskId}`,
  metric: (metricId: string) => `metric:${metricId}`,
};

function text(formData: FormData, key: string): string | null {
  const value = String(formData.get(key) ?? "").trim();
  return value || null;
}

function limited(label: string, value: string | null, max: number): string | null {
  if (value && value.length > max) throw new Error(`${label} must be ${max} characters or fewer.`);
  return value;
}

/**
 * Reads the evening log form. Only the tasks and metrics shown on the form
 * are read; a task left unmarked is not sent, so it stays as it is. A skip
 * needs a reason. An empty metric box clears that day's number.
 */
export function resolveEveningLogInput(
  formData: FormData,
  shown: { tasks: Array<{ id: string; title: string }>; metricIds: string[] },
): EveningLogInput {
  const items: EveningLogInput["items"] = [];
  for (const task of shown.tasks) {
    const outcome = text(formData, field.outcome(task.id));
    if (!outcome) continue;
    if (!LOG_OUTCOMES.includes(outcome as LogOutcome)) throw new Error(`Choose done, partly done or skipped for "${task.title}".`);
    const reason = limited(`The note for "${task.title}"`, text(formData, field.reason(task.id)), REASON_MAX_LENGTH);
    if (outcome === "skipped" && !reason) throw new Error(`Say why "${task.title}" was skipped.`);
    items.push({ task_id: task.id, outcome: outcome as LogOutcome, reason });
  }

  const metrics: EveningLogInput["metrics"] = [];
  for (const metricId of shown.metricIds) {
    const key = field.metric(metricId);
    if (!formData.has(key)) continue;
    const raw = text(formData, key);
    if (raw === null) {
      metrics.push({ goal_metric_id: metricId, value: null });
      continue;
    }
    const value = Number(raw);
    if (!Number.isFinite(value) || Math.abs(value) > 1e9) throw new Error("Enter numbers only for today's metrics.");
    metrics.push({ goal_metric_id: metricId, value });
  }

  const moodRaw = text(formData, "mood");
  let mood: number | null = null;
  if (moodRaw) {
    mood = Number(moodRaw);
    if (!Number.isInteger(mood) || mood < 1 || mood > 5) throw new Error("Mood must be a number from 1 to 5.");
  }

  return {
    items,
    metrics,
    evening: {
      mood,
      lesson: limited("Lesson", text(formData, "lesson"), LESSON_MAX_LENGTH),
      note: limited("Note", text(formData, "note"), NOTE_MAX_LENGTH),
    },
  };
}

export interface RoutineMetricSource {
  taskId: string;
  title: string;
  goalMetricId: string;
  amount: number;
}

/**
 * What today's routine sessions add to each metric, from the outcomes marked
 * so far: a session marked done adds its routine's amount (e.g. 2 problems).
 */
export function suggestedMetricValues(
  sources: RoutineMetricSource[],
  outcomes: Record<string, LogOutcome | undefined>,
): Map<string, { value: number; from: string[] }> {
  const suggestions = new Map<string, { value: number; from: string[] }>();
  for (const source of sources) {
    if (outcomes[source.taskId] !== "done") continue;
    const current = suggestions.get(source.goalMetricId) ?? { value: 0, from: [] };
    current.value += source.amount;
    current.from.push(source.title);
    suggestions.set(source.goalMetricId, current);
  }
  return suggestions;
}

export interface MetricProgress {
  /** Baseline plus everything logged for "sum"; the newest reading for "latest". Null when nothing is known. */
  current: number | null;
  /** Share of the way from baseline to target, 0-100; null without both ends. */
  percent: number | null;
  lastLoggedOn: string | null;
}

/** Where a metric stands from its logged values. */
export function metricProgress(
  metric: Pick<GoalMetric, "aggregation" | "baseline_value" | "target_value">,
  logs: Array<Pick<ProgressLog, "log_date" | "value">>,
): MetricProgress {
  const sorted = [...logs].sort((a, b) => a.log_date.localeCompare(b.log_date));
  const lastLoggedOn = sorted.at(-1)?.log_date ?? null;
  const baseline = metric.baseline_value === null ? null : Number(metric.baseline_value);
  let current: number | null;
  if (metric.aggregation === "sum") {
    current = sorted.length === 0 && baseline === null ? null : (baseline ?? 0) + sorted.reduce((total, log) => total + Number(log.value), 0);
  } else {
    current = sorted.length > 0 ? Number(sorted.at(-1)!.value) : baseline;
  }

  let percent: number | null = null;
  const target = metric.target_value === null ? null : Number(metric.target_value);
  const start = baseline ?? (metric.aggregation === "sum" ? 0 : null);
  if (current !== null && target !== null && start !== null && target !== start) {
    percent = Math.round(Math.min(100, Math.max(0, ((current - start) / (target - start)) * 100)));
  }
  return { current, percent, lastLoggedOn };
}

export interface LogTaskCandidate {
  id: string;
  title: string;
  status: string;
  due_date: string | null;
  occurrence_date: string | null;
  routine_id: string | null;
  completed_at: string | null;
}

/**
 * The tasks the evening log asks about: today's plan, today's routine
 * sessions, open work due today or earlier (as Today lists it), anything
 * completed today, and anything already logged today. Planned items come
 * first in plan order, then the rest by title.
 */
export function selectLogTasks<T extends LogTaskCandidate>(
  tasks: T[],
  input: { date: string; completedTodayIds: Set<string>; plannedStart: Map<string, string>; loggedIds: Set<string> },
): T[] {
  const isOpen = (task: T) => task.status !== "completed" && task.status !== "skipped" && task.status !== "deferred";
  const chosen = tasks.filter((task) =>
    input.plannedStart.has(task.id)
    || task.occurrence_date === input.date
    || (isOpen(task) && task.due_date !== null && task.due_date <= input.date)
    || input.completedTodayIds.has(task.id)
    || input.loggedIds.has(task.id));
  return chosen.sort((a, b) => {
    const aStart = input.plannedStart.get(a.id);
    const bStart = input.plannedStart.get(b.id);
    if (aStart && bStart) return aStart.localeCompare(bStart) || a.title.localeCompare(b.title);
    if (aStart) return -1;
    if (bStart) return 1;
    return a.title.localeCompare(b.title);
  });
}
