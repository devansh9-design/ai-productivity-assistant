import type { LogOutcome } from "@/lib/evening/log";
import { routineRunsOn, type TargetFacts } from "@/lib/feedback/daily";
import { mondayOf, weekDays } from "@/lib/review/week";
import { isValidISODate } from "@/lib/tasks/date-validation";
import { addDaysToISODate } from "@/lib/tasks/timezone";

// ---------------------------------------------------------------------------
// Days: each day's plan and how it went
// ---------------------------------------------------------------------------

export interface WeekDay {
  date: string;
  isToday: boolean;
  isFuture: boolean;
  plan: { status: string; version: number } | null;
  /** Distinct tasks on the day's plan. */
  planned: number;
  done: number;
  partial: number;
  skipped: number;
  /** The evening log was saved for the day. */
  logged: boolean;
}

export interface WeekDaysInput {
  weekStart: string;
  today: string;
  plans: Array<{ date: string; status: string; version: number; taskIds: string[] }>;
  logItems: Array<{ date: string; taskId: string; outcome: LogOutcome }>;
  /** Tasks on the week's plans, with the local day they were completed (if they were). */
  tasks: Array<{ id: string; completedOn: string | null }>;
  loggedDates: string[];
}

/** The plan a day is judged by: its newest version that was not replaced, else its newest version. */
function dayPlan<T extends { status: string; version: number }>(plans: T[]): T | null {
  const sorted = [...plans].sort((a, b) => b.version - a.version);
  return sorted.find((plan) => plan.status !== "superseded") ?? sorted[0] ?? null;
}

/**
 * How each planned task went: the evening log's outcome when there is one,
 * otherwise done if the task was completed that day. Tasks not marked
 * either way count only as planned.
 */
export function buildWeekDays(input: WeekDaysInput): WeekDay[] {
  const completedOn = new Map(input.tasks.map((task) => [task.id, task.completedOn]));
  const logged = new Set(input.loggedDates);
  return weekDays(input.weekStart).map((date) => {
    const plan = dayPlan(input.plans.filter((item) => item.date === date));
    const taskIds = [...new Set(plan?.taskIds ?? [])];
    const outcomes = new Map(input.logItems.filter((item) => item.date === date).map((item) => [item.taskId, item.outcome]));
    let done = 0;
    let partial = 0;
    let skipped = 0;
    for (const taskId of taskIds) {
      const outcome = outcomes.get(taskId) ?? (completedOn.get(taskId) === date ? "done" : null);
      if (outcome === "done") done += 1;
      else if (outcome === "partial") partial += 1;
      else if (outcome === "skipped") skipped += 1;
    }
    return {
      date,
      isToday: date === input.today,
      isFuture: date > input.today,
      plan: plan ? { status: plan.status, version: plan.version } : null,
      planned: taskIds.length,
      done,
      partial,
      skipped,
      logged: logged.has(date),
    };
  });
}

// ---------------------------------------------------------------------------
// Routines: which sessions were kept
// ---------------------------------------------------------------------------

export type SessionCell = "held" | "skipped" | "open" | "upcoming" | "not_created" | "off";

export interface RoutineRow {
  routineId: string;
  title: string;
  goalTitle: string | null;
  cells: Array<{ date: string; state: SessionCell }>;
  held: number;
  /** Sessions that fell on a day up to today. */
  due: number;
}

export interface RoutineGridInput {
  weekStart: string;
  today: string;
  routines: Array<{ id: string; title: string; goalTitle: string | null; daysOfWeek: number[]; startDate: string; endDate: string | null; active: boolean }>;
  routineTasks: Array<{ routineId: string; occurrenceDate: string; status: string }>;
}

/** One row per routine that falls in the week, one cell per day. */
export function buildRoutineGrid(input: RoutineGridInput): RoutineRow[] {
  const days = weekDays(input.weekStart);
  const rows: RoutineRow[] = [];
  for (const routine of input.routines) {
    const tasks = new Map(input.routineTasks.filter((task) => task.routineId === routine.id).map((task) => [task.occurrenceDate, task.status]));
    const cells = days.map((date) => {
      const status = tasks.get(date);
      let state: SessionCell;
      if (status === "completed") state = "held";
      else if (status === "skipped") state = "skipped";
      else if (status) state = date > input.today ? "upcoming" : "open";
      else if (!routineRunsOn(routine, date)) state = "off";
      else state = date > input.today ? "upcoming" : "not_created";
      return { date, state };
    });
    // A paused routine is shown only if it has sessions this week.
    if (cells.every((cell) => cell.state === "off" || (cell.state === "upcoming" && !routine.active))) continue;
    rows.push({
      routineId: routine.id,
      title: routine.title,
      goalTitle: routine.goalTitle,
      cells,
      held: cells.filter((cell) => cell.state === "held").length,
      due: cells.filter((cell) => cell.date <= input.today && cell.state !== "off").length,
    });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Targets: the week's result in words and numbers
// ---------------------------------------------------------------------------

function amount(value: number, unit: string | null): string {
  return `${Number(value).toLocaleString("en-US", { maximumFractionDigits: 1 })}${unit ? ` ${unit}` : ""}`;
}

/** A target against what was logged; a finished week says met or missed rather than on track or behind. */
export function weekTargetLine(target: TargetFacts, finished: boolean): { text: string; tone: "good" | "bad" | "neutral" } {
  if (target.status === "no_number" || target.logged === null || target.target === null) {
    return { text: `${target.title}: no number to track.`, tone: "neutral" };
  }
  const base = `${target.metricName}: ${amount(target.logged, target.unit)} of ${amount(target.target, null)}`;
  if (target.status === "met") return { text: `${base}, target met.`, tone: "good" };
  if (finished) return { text: `${base}, missed by ${amount(Math.round((target.target - target.logged) * 10) / 10, target.unit)}.`, tone: "bad" };
  if (target.status === "on_track") return { text: `${base}, on track.`, tone: "good" };
  const gap = Math.round(((target.expected ?? 0) - target.logged) * 10) / 10;
  return { text: `${base}, about ${amount(gap, target.unit)} behind where you'd expect by today.`, tone: "bad" };
}

// ---------------------------------------------------------------------------
// Which week to show
// ---------------------------------------------------------------------------

/** How many past weeks the week view goes back. */
export const VIEWABLE_PAST_WEEKS = 12;

/** A `?week=` Monday from the last few weeks up to this one; anything else shows this week. */
export function resolveViewWeek(param: string | string[] | undefined, today: string): string {
  const current = mondayOf(today);
  const value = Array.isArray(param) ? param[0] : param;
  if (!value || !isValidISODate(value) || mondayOf(value) !== value) return current;
  if (value > current || value < addDaysToISODate(current, -7 * VIEWABLE_PAST_WEEKS)) return current;
  return value;
}
