import { minutesFromHHMM } from "@/lib/time";

export type SchedulerRuleKind = "working" | "high_focus" | "sleep" | "meal" | "travel" | "break" | "exercise" | "class";
export type SchedulerEnergyLevel = "low" | "medium" | "high" | null;
export type SchedulerPriority = "low" | "medium" | "high" | "urgent";

export interface SchedulerTask {
  id: string;
  title: string;
  status: string;
  priority: SchedulerPriority;
  urgency: number;
  impact: number;
  mustDo: boolean;
  dueDate: string | null;
  estimatedMinutes: number | null;
  energyLevel: SchedulerEnergyLevel;
  createdAt: string;
}

export interface AvailabilityRuleInput {
  weekday: number;
  kind: SchedulerRuleKind;
  startTime: string;
  endTime: string;
}

export interface FixedCommitmentInput {
  id: string;
  date: string;
  title: string;
  startTime: string;
  endTime: string;
}

/**
 * Optional knobs layered on the Day 4 rules. Every field defaults to the
 * original behavior, so callers that pass no policy get identical plans.
 */
export interface SchedulePolicy {
  /** Share of free working time reserved as buffer, 0-50. Defaults to 20. */
  bufferPercent?: number;
  /** Multiplier applied to estimates, learned from actual durations. Defaults to 1. */
  durationFactor?: number;
  /** Longest single task block; longer tasks get a partial session of this length. */
  maxBlockMinutes?: number | null;
  /** HH:mm local time; nothing is placed before it (used when replanning mid-day). */
  earliestStartTime?: string | null;
  /** Defer high-energy tasks and place lighter work first. */
  lowEnergy?: boolean;
  /** Task statuses that may be scheduled. Defaults to todo only. */
  eligibleStatuses?: string[];
  /** Must-do tasks already on the plan; they count against the three-per-day limit. */
  mustDoAlreadyScheduled?: number;
  /** This week's chosen priorities. They get a bounded ranking boost; eligibility and every other rule still apply. */
  priorityTaskIds?: string[];
}

export interface ScheduleInput {
  date: string;
  weekday: number;
  availabilityRules: AvailabilityRuleInput[];
  fixedCommitments: FixedCommitmentInput[];
  tasks: SchedulerTask[];
  policy?: SchedulePolicy;
}

export interface ScheduledBlock {
  kind: "task" | "buffer";
  taskId: string | null;
  title: string;
  startTime: string;
  endTime: string;
}

export interface UnscheduledTask {
  taskId: string;
  reason: string;
}

export interface ScheduleResult {
  blocks: ScheduledBlock[];
  unscheduled: UnscheduledTask[];
  bufferMinutes: number;
  availableMinutes: number;
}

interface Interval {
  start: number;
  end: number;
}

const PRIORITY_POINTS: Record<SchedulerPriority, number> = { low: 10, medium: 20, high: 30, urgent: 40 };
const DEFAULT_ELIGIBLE_STATUSES = ["todo"];
const DEFAULT_BUFFER_PERCENT = 20;
const MUST_DO_LIMIT = 3;
export const NO_TIME_REASON ="No contiguous time remains within working hours after commitments and buffer.";
export const LOW_ENERGY_DEFERRAL_REASON = "low_energy: high-energy work is deferred while your energy is low.";
/**
 * Ranking points for a weekly priority. Deliberately smaller than one urgency
 * level (100 points) and than being overdue (100 deadline points), so it only
 * reorders tasks that were otherwise close.
 */
export const WEEKLY_PRIORITY_BOOST = 50;

function timeToMinutes(value: string): number | null {
  return minutesFromHHMM(value);
}

function minutesToTime(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}:00`;
}

function makeInterval(startTime: string, endTime: string): Interval | null {
  const start = timeToMinutes(startTime);
  const end = timeToMinutes(endTime);
  return start !== null && end !== null && end > start ? { start, end } : null;
}

function mergeIntervals(intervals: Interval[]): Interval[] {
  const sorted = [...intervals].sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: Interval[] = [];
  for (const interval of sorted) {
    const previous = merged[merged.length - 1];
    if (previous && interval.start <= previous.end) previous.end = Math.max(previous.end, interval.end);
    else merged.push({ ...interval });
  }
  return merged;
}

function subtractIntervals(source: Interval[], blocked: Interval[]): Interval[] {
  let remaining = mergeIntervals(source);
  for (const block of mergeIntervals(blocked)) {
    remaining = remaining.flatMap((slot) => {
      if (block.end <= slot.start || block.start >= slot.end) return [slot];
      const pieces: Interval[] = [];
      if (block.start > slot.start) pieces.push({ start: slot.start, end: block.start });
      if (block.end < slot.end) pieces.push({ start: block.end, end: slot.end });
      return pieces;
    });
  }
  return remaining;
}

function intersectIntervals(source: Interval[], preferred: Interval[]): Interval[] {
  const intersections: Interval[] = [];
  for (const slot of source) for (const window of preferred) {
    const start = Math.max(slot.start, window.start);
    const end = Math.min(slot.end, window.end);
    if (end > start) intersections.push({ start, end });
  }
  return mergeIntervals(intersections);
}

function totalMinutes(intervals: Interval[]): number {
  return intervals.reduce((total, interval) => total + interval.end - interval.start, 0);
}

function reserveBuffer(slots: Interval[], bufferMinutes: number): { available: Interval[]; blocks: Interval[] } {
  let remaining = bufferMinutes;
  const available: Interval[] = [];
  const blocks: Interval[] = [];
  for (const slot of [...slots].reverse()) {
    const length = slot.end - slot.start;
    const used = Math.min(remaining, length);
    if (used > 0) blocks.push({ start: slot.end - used, end: slot.end });
    if (used < length) available.push({ start: slot.start, end: slot.end - used });
    remaining -= used;
  }
  return { available: available.reverse(), blocks: blocks.reverse() };
}

function deadlinePoints(dueDate: string | null, date: string): number {
  if (!dueDate) return 0;
  const dayDifference = Math.round((Date.parse(`${dueDate}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) / 86_400_000);
  if (dayDifference < 0) return 100;
  if (dayDifference === 0) return 80;
  if (dayDifference === 1) return 60;
  if (dayDifference <= 3) return 35;
  if (dayDifference <= 7) return 15;
  return 0;
}

export function scoreTask(task: SchedulerTask, date: string): number {
  const durationPoints = task.estimatedMinutes ? Math.max(0, 30 - Math.floor(task.estimatedMinutes / 10)) : 0;
  return task.urgency * 100 + task.impact * 40 + PRIORITY_POINTS[task.priority] + deadlinePoints(task.dueDate, date) + durationPoints + (task.mustDo ? 1_000 : 0);
}

function sortTasks(tasks: SchedulerTask[], date: string, boosted: ReadonlySet<string> = new Set()): SchedulerTask[] {
  const rank = (task: SchedulerTask) => scoreTask(task, date) + (boosted.has(task.id) ? WEEKLY_PRIORITY_BOOST : 0);
  return [...tasks].sort((a, b) =>
    rank(b) - rank(a)
    || (a.dueDate ?? "9999-12-31").localeCompare(b.dueDate ?? "9999-12-31")
    || (a.estimatedMinutes ?? Number.MAX_SAFE_INTEGER) - (b.estimatedMinutes ?? Number.MAX_SAFE_INTEGER)
    || a.createdAt.localeCompare(b.createdAt)
    || a.id.localeCompare(b.id),
  );
}

/** Scaled estimate (rounded up to 5 minutes), capped by maxBlockMinutes when set. */
export function effectiveDuration(estimatedMinutes: number, policy: SchedulePolicy = {}): number {
  const factor = policy.durationFactor ?? 1;
  let minutes = factor === 1 ? estimatedMinutes : Math.max(5, Math.ceil((estimatedMinutes * factor) / 5) * 5);
  if (policy.maxBlockMinutes && minutes > policy.maxBlockMinutes) minutes = policy.maxBlockMinutes;
  return minutes;
}

function lighterFirst(tasks: SchedulerTask[]): SchedulerTask[] {
  const rank = (task: SchedulerTask) => (task.energyLevel === "low" ? 0 : 1);
  return [...tasks].sort((a, b) => rank(a) - rank(b));
}

function findPlacement(slots: Interval[], duration: number, preferred: Interval[]): Interval | null {
  const candidates = [...preferred, ...slots];
  const seen = new Set<string>();
  for (const slot of candidates) {
    const key = `${slot.start}-${slot.end}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (slot.end - slot.start >= duration) return { start: slot.start, end: slot.start + duration };
  }
  return null;
}

function removePlacement(slots: Interval[], placement: Interval): Interval[] {
  return slots.flatMap((slot) => {
    if (placement.start < slot.start || placement.end > slot.end) return [slot];
    const pieces: Interval[] = [];
    if (placement.start > slot.start) pieces.push({ start: slot.start, end: placement.start });
    if (placement.end < slot.end) pieces.push({ start: placement.end, end: slot.end });
    return pieces;
  });
}

/** Pure, deterministic policy engine. It never reads time, storage, UI, or external services. */
export function generateSchedule(input: ScheduleInput): ScheduleResult {
  const policy = input.policy ?? {};
  const bufferPercent = Math.min(50, Math.max(0, policy.bufferPercent ?? DEFAULT_BUFFER_PERCENT));
  const eligibleStatuses = new Set(policy.eligibleStatuses ?? DEFAULT_ELIGIBLE_STATUSES);
  const rules = input.availabilityRules.filter((rule) => rule.weekday === input.weekday);
  const configuredWorking = rules.filter((rule) => rule.kind === "working").map((rule) => makeInterval(rule.startTime, rule.endTime)).filter((rule): rule is Interval => Boolean(rule));
  const reservations = rules.filter((rule) => !["working", "high_focus"].includes(rule.kind)).map((rule) => makeInterval(rule.startTime, rule.endTime)).filter((rule): rule is Interval => Boolean(rule));
  const fixed = input.fixedCommitments.filter((commitment) => commitment.date === input.date).map((commitment) => makeInterval(commitment.startTime, commitment.endTime)).filter((commitment): commitment is Interval => Boolean(commitment));
  const highFocus = rules.filter((rule) => rule.kind === "high_focus").map((rule) => makeInterval(rule.startTime, rule.endTime)).filter((rule): rule is Interval => Boolean(rule));
  const schedulableTasks = input.tasks.filter((task) => eligibleStatuses.has(task.status));
  const unscheduled: UnscheduledTask[] = [];

  if (configuredWorking.length === 0) {
    return { blocks: [], unscheduled: schedulableTasks.map((task) => ({ taskId: task.id, reason: "No working availability is configured for this day." })), bufferMinutes: 0, availableMinutes: 0 };
  }

  const earliest = policy.earliestStartTime ? timeToMinutes(policy.earliestStartTime) : null;
  const working = earliest ? subtractIntervals(configuredWorking, [{ start: 0, end: earliest }]) : configuredWorking;

  const freeBeforeBuffer = subtractIntervals(working, [...reservations, ...fixed]);
  const availableMinutes = totalMinutes(freeBeforeBuffer);
  const bufferMinutes = Math.ceil(availableMinutes * (bufferPercent / 100));
  const buffer = reserveBuffer(freeBeforeBuffer, bufferMinutes);
  let freeSlots = buffer.available;
  const blocks: ScheduledBlock[] = buffer.blocks.map((block) => ({ kind: "buffer", taskId: null, title: "Scheduling buffer", startTime: minutesToTime(block.start), endTime: minutesToTime(block.end) }));

  const withEstimate: SchedulerTask[] = [];
  for (const task of schedulableTasks) {
    if (!task.estimatedMinutes || task.estimatedMinutes <= 0) unscheduled.push({ taskId: task.id, reason: "An estimated duration is required to schedule this task." });
    else if (policy.lowEnergy && task.energyLevel === "high") unscheduled.push({ taskId: task.id, reason: LOW_ENERGY_DEFERRAL_REASON });
    else withEstimate.push(task);
  }
  const mustDoCapacity = Math.max(0, MUST_DO_LIMIT - (policy.mustDoAlreadyScheduled ?? 0));
  const boosted = new Set(policy.priorityTaskIds ?? []);
  const rankedMustDos = sortTasks(withEstimate.filter((task) => task.mustDo), input.date, boosted);
  const others = sortTasks(withEstimate.filter((task) => !task.mustDo), input.date, boosted);
  const candidates = [...rankedMustDos.slice(0, mustDoCapacity), ...(policy.lowEnergy ? lighterFirst(others) : others)];
  for (const task of rankedMustDos.slice(mustDoCapacity)) unscheduled.push({ taskId: task.id, reason: "must_do_limit: only the top three must-do tasks can be scheduled in one day." });

  for (const task of candidates) {
    const focusSlots = intersectIntervals(freeSlots, highFocus);
    const nonFocusSlots = subtractIntervals(freeSlots, highFocus);
    const preferred = task.energyLevel === "high" ? focusSlots : task.energyLevel === "low" ? nonFocusSlots : freeSlots;
    const placement = findPlacement(freeSlots, effectiveDuration(task.estimatedMinutes as number, policy), preferred);
    if (!placement) {
      unscheduled.push({ taskId: task.id, reason: NO_TIME_REASON });
      continue;
    }
    blocks.push({ kind: "task", taskId: task.id, title: task.title, startTime: minutesToTime(placement.start), endTime: minutesToTime(placement.end) });
    freeSlots = removePlacement(freeSlots, placement);
  }

  return { blocks: blocks.sort((a, b) => a.startTime.localeCompare(b.startTime) || a.endTime.localeCompare(b.endTime) || a.kind.localeCompare(b.kind)), unscheduled: unscheduled.sort((a, b) => a.taskId.localeCompare(b.taskId)), bufferMinutes, availableMinutes };
}
