import type { SchedulePolicy } from "@/lib/scheduler/engine";
import type { EnergyLevel, MetricAggregation } from "@/lib/types";

const ENERGY_LEVELS: EnergyLevel[] = ["low", "medium", "high"];

// Must match the checkins table's available_minutes and notes constraints.
export const MAX_AVAILABLE_MINUTES = 1440;
export const NOTES_MAX_LENGTH = 1000;
export const EVENT_TITLE_MAX_LENGTH = 200;

/** Choices offered for "free time today", in minutes. */
export const AVAILABLE_MINUTE_OPTIONS = [30, 60, 90, 120, 180, 240, 300, 360, 480, 600] as const;

export interface MorningCheckinInput {
  available_minutes: number;
  energy_level: EnergyLevel;
  notes: string | null;
  /** Something special today, such as an exam or travel, kept as a fixed commitment. */
  event: { title: string; startTime: string; endTime: string } | null;
}

function optionalText(value: FormDataEntryValue | null) {
  const text = String(value ?? "").trim();
  return text || null;
}

function validTime(value: string) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

export function formatMinutes(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest} min`;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

/**
 * Validates the morning check-in form. Free time and energy are required;
 * the notes and the special event are optional, but an event needs a title,
 * a start and an end together.
 */
export function resolveMorningCheckinInput(formData: FormData): MorningCheckinInput {
  const minutesRaw = String(formData.get("available_minutes") ?? "").trim();
  const available_minutes = Number(minutesRaw);
  if (!minutesRaw || !Number.isInteger(available_minutes) || available_minutes < 0 || available_minutes > MAX_AVAILABLE_MINUTES) {
    throw new Error("Choose how much free time you have today.");
  }

  const energyRaw = String(formData.get("energy_level") ?? "").trim();
  if (!ENERGY_LEVELS.includes(energyRaw as EnergyLevel)) throw new Error("Choose your energy level.");

  const notes = optionalText(formData.get("notes"));
  if (notes && notes.length > NOTES_MAX_LENGTH) throw new Error(`Notes must be ${NOTES_MAX_LENGTH} characters or fewer.`);

  const title = optionalText(formData.get("event_title"));
  const startTime = optionalText(formData.get("event_start"));
  const endTime = optionalText(formData.get("event_end"));
  let event: MorningCheckinInput["event"] = null;
  if (title || startTime || endTime) {
    if (!title || !startTime || !endTime) throw new Error("A special event needs a title, a start time and an end time.");
    if (title.length > EVENT_TITLE_MAX_LENGTH) throw new Error(`The event title must be ${EVENT_TITLE_MAX_LENGTH} characters or fewer.`);
    if (!validTime(startTime) || !validTime(endTime) || endTime <= startTime) {
      throw new Error("Choose a valid same-day start and end time for the event.");
    }
    event = { title, startTime, endTime };
  }

  return { available_minutes, energy_level: energyRaw as EnergyLevel, notes, event };
}

/**
 * Turns the check-in into scheduling rules: the stated free time caps the
 * task minutes, and low energy defers high-energy work and shortens sessions.
 */
export function morningPolicy(
  checkin: { available_minutes: number | null; energy_level: EnergyLevel | null } | null,
  lowEnergyMaxBlockMinutes: number,
): Pick<SchedulePolicy, "taskMinutesBudget" | "lowEnergy" | "maxBlockMinutes"> {
  if (!checkin) return {};
  const lowEnergy = checkin.energy_level === "low";
  return {
    taskMinutesBudget: checkin.available_minutes,
    lowEnergy,
    maxBlockMinutes: lowEnergy ? lowEnergyMaxBlockMinutes : null,
  };
}

export interface WeeklyTargetProgressInput {
  targets: Array<{ goal_id: string; goal_metric_id: string | null; target_value: number | null }>;
  metrics: Array<{ id: string; aggregation: MetricAggregation }>;
  /** This week's logged values so far. */
  logs: Array<{ goal_metric_id: string; value: number }>;
}

/**
 * Goals with a weekly target this week that is not met yet. A target counts
 * as met only when it has a number on a summed metric and this week's logs
 * reach it; any other target keeps its goal on the list.
 */
export function goalsBehindWeeklyTarget({ targets, metrics, logs }: WeeklyTargetProgressInput): string[] {
  const aggregation = new Map(metrics.map((metric) => [metric.id, metric.aggregation]));
  const loggedThisWeek = new Map<string, number>();
  for (const entry of logs) loggedThisWeek.set(entry.goal_metric_id, (loggedThisWeek.get(entry.goal_metric_id) ?? 0) + Number(entry.value));

  const behind = new Set<string>();
  for (const target of targets) {
    const met = target.goal_metric_id !== null
      && target.target_value !== null
      && aggregation.get(target.goal_metric_id) === "sum"
      && (loggedThisWeek.get(target.goal_metric_id) ?? 0) >= Number(target.target_value);
    if (!met) behind.add(target.goal_id);
  }
  return [...behind].sort();
}

/** Open tasks that belong to a goal still behind its weekly target. */
export function weeklyTargetTaskIds(
  tasks: Array<{ id: string; goal_id: string | null; status: string }>,
  goalIds: string[],
): string[] {
  const goals = new Set(goalIds);
  return tasks.filter((task) => task.status === "todo" && task.goal_id !== null && goals.has(task.goal_id)).map((task) => task.id);
}

/** One line on how the new plan fits the check-in, shown after Generate. */
export function describePlanFit(input: {
  availableMinutes: number;
  plannedMinutes: number;
  energy: EnergyLevel | null;
  leftOut: number;
}): string {
  const energy = input.energy === "low" ? " Energy is low, so sessions are shorter and high-energy work waits." : "";
  const leftOut = input.leftOut === 0
    ? " Nothing was left out."
    : ` ${input.leftOut} ${input.leftOut === 1 ? "task was" : "tasks were"} left out; the reasons are under Not scheduled.`;
  return `Draft plan: ${formatMinutes(input.plannedMinutes)} of your ${formatMinutes(input.availableMinutes)} free time planned.${energy}${leftOut}`;
}
