export type SchedulerRuleKind = "working" | "high_focus" | "sleep" | "meal" | "travel" | "break";
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

export interface ScheduleInput {
  date: string;
  weekday: number;
  availabilityRules: AvailabilityRuleInput[];
  fixedCommitments: FixedCommitmentInput[];
  tasks: SchedulerTask[];
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
const ELIGIBLE_STATUSES = new Set(["todo"]);

function timeToMinutes(value: string): number | null {
  const match = /^(\d{2}):(\d{2})/.exec(value);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours <= 23 && minutes <= 59 ? hours * 60 + minutes : null;
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

function sortTasks(tasks: SchedulerTask[], date: string): SchedulerTask[] {
  return [...tasks].sort((a, b) =>
    scoreTask(b, date) - scoreTask(a, date)
    || (a.dueDate ?? "9999-12-31").localeCompare(b.dueDate ?? "9999-12-31")
    || (a.estimatedMinutes ?? Number.MAX_SAFE_INTEGER) - (b.estimatedMinutes ?? Number.MAX_SAFE_INTEGER)
    || a.createdAt.localeCompare(b.createdAt)
    || a.id.localeCompare(b.id),
  );
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
  const rules = input.availabilityRules.filter((rule) => rule.weekday === input.weekday);
  const working = rules.filter((rule) => rule.kind === "working").map((rule) => makeInterval(rule.startTime, rule.endTime)).filter((rule): rule is Interval => Boolean(rule));
  const reservations = rules.filter((rule) => !["working", "high_focus"].includes(rule.kind)).map((rule) => makeInterval(rule.startTime, rule.endTime)).filter((rule): rule is Interval => Boolean(rule));
  const fixed = input.fixedCommitments.filter((commitment) => commitment.date === input.date).map((commitment) => makeInterval(commitment.startTime, commitment.endTime)).filter((commitment): commitment is Interval => Boolean(commitment));
  const highFocus = rules.filter((rule) => rule.kind === "high_focus").map((rule) => makeInterval(rule.startTime, rule.endTime)).filter((rule): rule is Interval => Boolean(rule));
  const schedulableTasks = input.tasks.filter((task) => ELIGIBLE_STATUSES.has(task.status));
  const unscheduled: UnscheduledTask[] = [];

  if (working.length === 0) {
    return { blocks: [], unscheduled: schedulableTasks.map((task) => ({ taskId: task.id, reason: "No working availability is configured for this day." })), bufferMinutes: 0, availableMinutes: 0 };
  }

  const freeBeforeBuffer = subtractIntervals(working, [...reservations, ...fixed]);
  const availableMinutes = totalMinutes(freeBeforeBuffer);
  const bufferMinutes = Math.ceil(availableMinutes * 0.2);
  const buffer = reserveBuffer(freeBeforeBuffer, bufferMinutes);
  let freeSlots = buffer.available;
  const blocks: ScheduledBlock[] = buffer.blocks.map((block) => ({ kind: "buffer", taskId: null, title: "Scheduling buffer", startTime: minutesToTime(block.start), endTime: minutesToTime(block.end) }));

  const withEstimate: SchedulerTask[] = [];
  for (const task of schedulableTasks) {
    if (!task.estimatedMinutes || task.estimatedMinutes <= 0) unscheduled.push({ taskId: task.id, reason: "An estimated duration is required to schedule this task." });
    else withEstimate.push(task);
  }
  const rankedMustDos = sortTasks(withEstimate.filter((task) => task.mustDo), input.date);
  const candidates = [...rankedMustDos.slice(0, 3), ...sortTasks(withEstimate.filter((task) => !task.mustDo), input.date)];
  for (const task of rankedMustDos.slice(3)) unscheduled.push({ taskId: task.id, reason: "must_do_limit: only the top three must-do tasks can be scheduled in one day." });

  for (const task of candidates) {
    const focusSlots = intersectIntervals(freeSlots, highFocus);
    const nonFocusSlots = subtractIntervals(freeSlots, highFocus);
    const preferred = task.energyLevel === "high" ? focusSlots : task.energyLevel === "low" ? nonFocusSlots : freeSlots;
    const placement = findPlacement(freeSlots, task.estimatedMinutes as number, preferred);
    if (!placement) {
      unscheduled.push({ taskId: task.id, reason: "No contiguous time remains within working hours after commitments and buffer." });
      continue;
    }
    blocks.push({ kind: "task", taskId: task.id, title: task.title, startTime: minutesToTime(placement.start), endTime: minutesToTime(placement.end) });
    freeSlots = removePlacement(freeSlots, placement);
  }

  return { blocks: blocks.sort((a, b) => a.startTime.localeCompare(b.startTime) || a.endTime.localeCompare(b.endTime) || a.kind.localeCompare(b.kind)), unscheduled: unscheduled.sort((a, b) => a.taskId.localeCompare(b.taskId)), bufferMinutes, availableMinutes };
}
