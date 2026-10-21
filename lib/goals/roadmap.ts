import { minutesFromHHMM } from "@/lib/time";
import type { EntityStatus, Goal, GoalCategory, GoalLevel, GoalMetric, GoalPhase, IsoWeekday, MetricAggregation, Routine, TaskPriority } from "@/lib/types";

/**
 * Validation for building a goal by hand (Step 3) and, later, for checking
 * AI-drafted roadmaps (Step 4) with the same rules. Every function takes
 * plain form values and returns either the row to save or one message that
 * says what to fix.
 */
export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

type Fields = Pick<FormData, "get"> & Partial<Pick<FormData, "getAll">>;

const ok = <T,>(value: T): Parsed<T> => ({ ok: true, value });
const fail = <T,>(error: string): Parsed<T> => ({ ok: false, error });

const CATEGORIES: GoalCategory[] = ["fitness", "academics", "placement", "skill", "other"];
const LEVELS: GoalLevel[] = ["beginner", "intermediate", "advanced"];
const STATUSES: EntityStatus[] = ["active", "completed", "archived"];
const AGGREGATIONS: MetricAggregation[] = ["sum", "latest"];
const PRIORITIES: TaskPriority[] = ["low", "medium", "high", "urgent"];
export const ISO_DAYS: Array<{ value: IsoWeekday; short: string }> = [
  { value: 1, short: "Mon" }, { value: 2, short: "Tue" }, { value: 3, short: "Wed" }, { value: 4, short: "Thu" },
  { value: 5, short: "Fri" }, { value: 6, short: "Sat" }, { value: 7, short: "Sun" },
];
export const MAX_PHASES = 52;

function text(fields: Fields, key: string): string {
  return String(fields.get(key) ?? "").trim();
}

function optionalText(fields: Fields, key: string, max: number, label: string): Parsed<string | null> {
  const value = text(fields, key);
  if (!value) return ok(null);
  return value.length > max ? fail(`${label} must be at most ${max} characters.`) : ok(value);
}

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
    && new Date(`${value}T00:00:00Z`).toISOString().startsWith(value);
}

function optionalDate(fields: Fields, key: string, label: string): Parsed<string | null> {
  const value = text(fields, key);
  if (!value) return ok(null);
  return isIsoDate(value) ? ok(value) : fail(`Choose a valid ${label}.`);
}

function optionalNumber(fields: Fields, key: string, label: string, min: number, max: number): Parsed<number | null> {
  const value = text(fields, key);
  if (!value) return ok(null);
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) return fail(`${label} must be between ${min} and ${max}.`);
  return ok(number);
}

/** Monday of the ISO week containing `date` (YYYY-MM-DD). */
export function mondayOf(date: string): string {
  const day = new Date(`${date}T00:00:00Z`);
  const offset = (day.getUTCDay() + 6) % 7;
  day.setUTCDate(day.getUTCDate() - offset);
  return day.toISOString().slice(0, 10);
}

/** Inclusive number of days from start to end. */
export function daysBetween(start: string, end: string): number {
  return Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000) + 1;
}

export interface GoalInput {
  title: string;
  description: string | null;
  category: GoalCategory;
  status: EntityStatus;
  start_date: string | null;
  target_date: string | null;
  weekly_hours: number | null;
  level: GoalLevel | null;
}

/** The goal itself. `status` is only read when present (edit form). */
export function parseGoal(fields: Fields): Parsed<GoalInput> {
  const title = text(fields, "title");
  if (!title || title.length > 200) return fail("Give the goal a name (up to 200 characters).");
  const description = optionalText(fields, "description", 2000, "Description");
  if (!description.ok) return description;
  const category = (text(fields, "category") || "other") as GoalCategory;
  if (!CATEGORIES.includes(category)) return fail("Choose a goal type.");
  const status = (text(fields, "status") || "active") as EntityStatus;
  if (!STATUSES.includes(status)) return fail("Choose a valid status.");
  const start = optionalDate(fields, "start_date", "start date");
  if (!start.ok) return start;
  const target = optionalDate(fields, "target_date", "target date");
  if (!target.ok) return target;
  if (start.value && target.value && target.value < start.value) return fail("The target date must be on or after the start date.");
  const hours = optionalNumber(fields, "weekly_hours", "Hours per week", 0.5, 112);
  if (!hours.ok) return hours;
  const levelText = text(fields, "level");
  if (levelText && !LEVELS.includes(levelText as GoalLevel)) return fail("Choose a valid level.");
  return ok({
    title, description: description.value, category, status, start_date: start.value, target_date: target.value,
    weekly_hours: hours.value === null ? null : Math.round(hours.value * 10) / 10, level: (levelText || null) as GoalLevel | null,
  });
}

export interface MetricInput {
  name: string;
  unit: string | null;
  aggregation: MetricAggregation;
  baseline_value: number | null;
  target_value: number | null;
}

/** A measurable number for the goal; names are unique within the goal. */
export function parseMetric(fields: Fields, otherNames: string[]): Parsed<MetricInput> {
  const name = text(fields, "name");
  if (!name || name.length > 80) return fail("Give the metric a name (up to 80 characters).");
  if (otherNames.some((other) => other.toLowerCase() === name.toLowerCase())) return fail(`This goal already tracks "${name}".`);
  const unit = optionalText(fields, "unit", 20, "Unit");
  if (!unit.ok) return unit;
  const aggregation = (text(fields, "aggregation") || "sum") as MetricAggregation;
  if (!AGGREGATIONS.includes(aggregation)) return fail("Choose how the metric adds up.");
  const baseline = optionalNumber(fields, "baseline_value", "Starting value", -1_000_000, 1_000_000);
  if (!baseline.ok) return baseline;
  const target = optionalNumber(fields, "target_value", "Target value", -1_000_000, 1_000_000);
  if (!target.ok) return target;
  return ok({ name, unit: unit.value, aggregation, baseline_value: baseline.value, target_value: target.value });
}

export interface PhaseInput {
  title: string;
  focus: string | null;
  start_date: string;
  end_date: string;
  target_note: string | null;
}

/**
 * A roadmap phase. Phases are ordered by date, so they must not overlap one
 * another and must sit within the goal's dates when the goal has them.
 */
export function parsePhase(
  fields: Fields,
  goal: Pick<Goal, "start_date" | "target_date">,
  otherPhases: Array<Pick<GoalPhase, "title" | "start_date" | "end_date">>,
): Parsed<PhaseInput> {
  const title = text(fields, "title");
  if (!title || title.length > 200) return fail("Give the phase a name (up to 200 characters).");
  const focus = optionalText(fields, "focus", 1000, "Focus");
  if (!focus.ok) return focus;
  const targetNote = optionalText(fields, "target_note", 500, "Target");
  if (!targetNote.ok) return targetNote;
  const start = text(fields, "start_date");
  const end = text(fields, "end_date");
  if (!isIsoDate(start) || !isIsoDate(end)) return fail("Give the phase a start and end date.");
  if (end < start) return fail("A phase must end on or after the day it starts.");
  if (goal.start_date && start < goal.start_date) return fail(`The phase starts before the goal does (${goal.start_date}).`);
  if (goal.target_date && end > goal.target_date) return fail(`The phase ends after the goal's target date (${goal.target_date}).`);
  const clash = otherPhases.find((other) => start <= other.end_date && other.start_date <= end);
  if (clash) return fail(`These dates overlap "${clash.title}" (${clash.start_date} to ${clash.end_date}).`);
  if (otherPhases.length >= MAX_PHASES) return fail(`A goal can have at most ${MAX_PHASES} phases.`);
  return ok({ title, focus: focus.value, start_date: start, end_date: end, target_note: targetNote.value });
}

export interface WeeklyTargetInput {
  week_start: string;
  title: string;
  goal_metric_id: string | null;
  target_value: number | null;
  note: string | null;
}

/** What one week should achieve. Any day of the week can be picked; it is stored as that week's Monday. */
export function parseWeeklyTarget(
  fields: Fields,
  goal: Pick<Goal, "start_date" | "target_date">,
  metrics: Array<Pick<GoalMetric, "id">>,
): Parsed<WeeklyTargetInput> {
  const day = text(fields, "week");
  if (!isIsoDate(day)) return fail("Choose the week for this target.");
  const weekStart = mondayOf(day);
  if (goal.target_date && weekStart > goal.target_date) return fail("That week is after the goal's target date.");
  if (goal.start_date && mondayOf(goal.start_date) > weekStart) return fail("That week is before the goal starts.");
  const title = text(fields, "title");
  if (!title || title.length > 200) return fail("Describe the target (up to 200 characters).");
  const metricId = text(fields, "goal_metric_id") || null;
  if (metricId && !metrics.some((metric) => metric.id === metricId)) return fail("Choose one of this goal's metrics.");
  const value = optionalNumber(fields, "target_value", "Target amount", 0, 1_000_000);
  if (!value.ok) return value;
  if (value.value !== null && !metricId) return fail("Choose which metric the target amount is for.");
  const note = optionalText(fields, "note", 500, "Note");
  if (!note.ok) return note;
  return ok({ week_start: weekStart, title, goal_metric_id: metricId, target_value: value.value, note: note.value });
}

export interface RoutineInput {
  title: string;
  days_of_week: IsoWeekday[];
  minutes: number;
  preferred_start: string | null;
  preferred_end: string | null;
  priority: TaskPriority;
  goal_metric_id: string | null;
  metric_amount: number | null;
  start_date: string;
  end_date: string | null;
  active: boolean;
}

/** Minutes a routine takes in a week. */
export function weeklyMinutes(routine: Pick<Routine, "days_of_week" | "minutes">): number {
  return routine.days_of_week.length * routine.minutes;
}

/**
 * Recurring work for the goal. Active routines must fit the goal's weekly
 * hours when the goal sets them; `otherActiveMinutes` is the weekly total of
 * the goal's other active routines.
 */
export function parseRoutine(
  fields: Required<Fields>,
  goal: Pick<Goal, "start_date" | "target_date" | "weekly_hours">,
  metrics: Array<Pick<GoalMetric, "id">>,
  otherActiveMinutes: number,
  today: string,
): Parsed<RoutineInput> {
  const title = text(fields, "title");
  if (!title || title.length > 200) return fail("Give the routine a name (up to 200 characters).");
  const days = [...new Set(fields.getAll("days").map(Number))].sort((a, b) => a - b);
  if (!days.length) return fail("Pick at least one day for the routine.");
  if (days.some((day) => !ISO_DAYS.some((known) => known.value === day))) return fail("Pick valid days.");
  const minutes = Number(text(fields, "minutes"));
  if (!Number.isInteger(minutes) || minutes < 5 || minutes > 600) return fail("Each session must be 5 to 600 minutes.");
  const startTime = text(fields, "preferred_start") || null;
  const endTime = text(fields, "preferred_end") || null;
  if ((startTime && minutesFromHHMM(startTime) === null) || (endTime && minutesFromHHMM(endTime) === null)) return fail("Choose valid preferred times.");
  if (startTime && endTime && (minutesFromHHMM(endTime) ?? 0) <= (minutesFromHHMM(startTime) ?? 0)) return fail("The preferred window must end after it starts.");
  const priority = (text(fields, "priority") || "medium") as TaskPriority;
  if (!PRIORITIES.includes(priority)) return fail("Choose a valid priority.");
  const metricId = text(fields, "goal_metric_id") || null;
  if (metricId && !metrics.some((metric) => metric.id === metricId)) return fail("Choose one of this goal's metrics.");
  const amount = optionalNumber(fields, "metric_amount", "Amount per session", 0.01, 1_000_000);
  if (!amount.ok) return amount;
  if (amount.value !== null && !metricId) return fail("Choose which metric each session adds to.");
  const startDate = text(fields, "start_date") || (goal.start_date && goal.start_date > today ? goal.start_date : today);
  if (!isIsoDate(startDate)) return fail("Choose a valid start date.");
  const endInput = optionalDate(fields, "end_date", "end date");
  if (!endInput.ok) return endInput;
  const endDate = endInput.value ?? goal.target_date;
  if (endDate && endDate < startDate) return fail("The routine must end on or after it starts.");
  const active = text(fields, "active") !== "false";

  const routine = {
    title, days_of_week: days as IsoWeekday[], minutes, preferred_start: startTime, preferred_end: endTime, priority,
    goal_metric_id: metricId, metric_amount: amount.value, start_date: startDate, end_date: endDate, active,
  };
  if (active && goal.weekly_hours) {
    const budget = Math.round(goal.weekly_hours * 60);
    const total = otherActiveMinutes + weeklyMinutes(routine);
    if (total > budget) {
      return fail(`Routines would take ${formatMinutes(total)} a week, more than this goal's ${formatMinutes(budget)}. Shorten a routine or raise the goal's hours.`);
    }
  }
  return ok(routine);
}

/** "5 h", "1 h 30 min", "45 min". */
export function formatMinutes(total: number): string {
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  if (!hours) return `${minutes} min`;
  return minutes ? `${hours} h ${minutes} min` : `${hours} h`;
}
