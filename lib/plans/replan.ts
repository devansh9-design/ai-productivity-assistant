import {
  effectiveDuration,
  generateSchedule,
  NO_TIME_REASON,
  type AvailabilityRuleInput,
  type FixedCommitmentInput,
  type SchedulePolicy,
  type SchedulerTask,
  type UnscheduledTask,
} from "@/lib/scheduler/engine";
import type { CalendarEventInput, MergedBlock, PlanDraftResult } from "@/lib/plans/planner";

export const REPLAN_MODES = ["low_energy", "behind_schedule", "free_time"] as const;
export type ReplanMode = (typeof REPLAN_MODES)[number];

export function isReplanMode(value: unknown): value is ReplanMode {
  return typeof value === "string" && (REPLAN_MODES as readonly string[]).includes(value);
}

export interface ReplanBlock {
  taskId: string | null;
  kind: "task" | "buffer" | "calendar";
  title: string;
  startTime: string;
  endTime: string;
  isManual: boolean;
}

export interface ReplanInput {
  mode: ReplanMode;
  date: string;
  weekday: number;
  /** Current local wall-clock time, HH:mm. */
  nowTime: string;
  availabilityRules: AvailabilityRuleInput[];
  fixedCommitments: FixedCommitmentInput[];
  calendarEvents?: CalendarEventInput[];
  currentBlocks: ReplanBlock[];
  currentUnscheduled: UnscheduledTask[];
  tasks: SchedulerTask[];
  preferences: { bufferPercent: number; lowEnergyMaxBlockMinutes: number; durationFactor: number };
  /** Required for free_time: the window the user says they have available. */
  freeWindow?: { startTime: string; endTime: string } | null;
}

export interface ReplanResult extends PlanDraftResult {
  summary: string;
  /** False when there was nothing to replan; the caller should not write a new draft. */
  changed: boolean;
}

const OPEN_STATUSES = new Set(["todo", "in_progress"]);
const DAY_END = 24 * 60;

function toMinutes(value: string): number {
  const match = /^(\d{2}):(\d{2})/.exec(value);
  return match ? Number(match[1]) * 60 + Number(match[2]) : 0;
}

function hhmm(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

function blockAsFixed(block: ReplanBlock, date: string, index: number): FixedCommitmentInput {
  return { id: `plan-block-${index}`, date, title: block.title, startTime: block.startTime.slice(0, 5), endTime: block.endTime.slice(0, 5) };
}

function finish(
  input: ReplanInput,
  keptBlocks: ReplanBlock[],
  engine: { blocks: ReturnType<typeof generateSchedule>["blocks"]; availableMinutes: number },
  unscheduled: UnscheduledTask[],
  summary: string,
  changed: boolean,
): ReplanResult {
  const calendarBlocks: ReplanBlock[] = (input.calendarEvents ?? []).map((event) => ({
    taskId: null, kind: "calendar", title: event.title, startTime: `${event.startTime}:00`, endTime: `${event.endTime}:00`, isManual: false,
  }));
  const engineBlocks: ReplanBlock[] = engine.blocks.map((block) => ({
    taskId: block.taskId, kind: block.kind, title: block.title, startTime: block.startTime, endTime: block.endTime, isManual: false,
  }));
  const blocks: MergedBlock[] = [...calendarBlocks, ...keptBlocks, ...engineBlocks]
    .map((block) => ({ ...block, startTime: `${block.startTime.slice(0, 5)}:00`, endTime: `${block.endTime.slice(0, 5)}:00` }))
    .sort((a, b) => a.startTime.localeCompare(b.startTime) || a.endTime.localeCompare(b.endTime) || a.kind.localeCompare(b.kind))
    .map((block, index) => ({ ...block, sortOrder: index }));
  const bufferMinutes = blocks
    .filter((block) => block.kind === "buffer")
    .reduce((total, block) => total + toMinutes(block.endTime) - toMinutes(block.startTime), 0);
  return {
    blocks,
    unscheduled: [...unscheduled].sort((a, b) => a.taskId.localeCompare(b.taskId)),
    bufferMinutes,
    availableMinutes: engine.availableMinutes,
    summary,
    changed,
  };
}

/** Previous unscheduled reasons survive unless the task was placed or given a new reason. */
function mergeUnscheduled(previous: UnscheduledTask[], next: UnscheduledTask[], placedTaskIds: Set<string>): UnscheduledTask[] {
  const merged = new Map(previous.map((item) => [item.taskId, item.reason]));
  for (const item of next) merged.set(item.taskId, item.reason);
  for (const taskId of placedTaskIds) merged.delete(taskId);
  return [...merged.entries()].map(([taskId, reason]) => ({ taskId, reason }));
}

function countMustDos(blocks: ReplanBlock[], taskById: Map<string, SchedulerTask>): number {
  return new Set(blocks.filter((block) => block.taskId && taskById.get(block.taskId)?.mustDo).map((block) => block.taskId)).size;
}

/**
 * Pure mid-day replanning. Blocks for tasks you have started or finished stay
 * exactly as they are; a block whose time has begun while its task is still
 * todo is moved forward. Only the rest of the day changes, and the deterministic engine
 * (never the AI) decides what fits. The caller saves the result as a draft,
 * so nothing reaches Google Calendar until the user confirms it.
 *
 * - behind_schedule: re-places the remaining planned tasks from now, spending
 *   buffer first (no new buffer), and moves whatever no longer fits to Not
 *   scheduled.
 * - low_energy: re-places the remaining planned tasks lighter-first, caps each
 *   session at the low-energy limit, and defers high-energy work.
 * - free_time: keeps every existing block and fills only the stated window
 *   with eligible tasks that are not already on the plan.
 */
export function buildReplan(input: ReplanInput): ReplanResult {
  const { mode, date, weekday, preferences } = input;
  const now = Math.ceil(toMinutes(input.nowTime) / 5) * 5;
  const taskById = new Map(input.tasks.map((task) => [task.id, task]));
  const calendarAsFixed: FixedCommitmentInput[] = (input.calendarEvents ?? []).map((event) => ({
    id: event.googleEventId, date, title: event.title, startTime: event.startTime, endTime: event.endTime,
  }));
  const planBlocks = input.currentBlocks.filter((block) => block.kind !== "calendar");
  const noChange = (summary: string) =>
    finish(input, planBlocks, { blocks: [], availableMinutes: 0 }, input.currentUnscheduled, summary, false);

  if (now >= DAY_END) return noChange("The day is over; there is nothing left to replan.");
  const nowLabel = hhmm(now);

  if (mode === "free_time") {
    const window = input.freeWindow;
    if (!window) return noChange("Choose the free time window to fill.");
    const windowStart = Math.max(toMinutes(window.startTime), now);
    const windowEnd = toMinutes(window.endTime);
    if (windowEnd <= windowStart) return noChange("That free time window has already passed.");

    const rules: AvailabilityRuleInput[] = [
      ...input.availabilityRules.filter((rule) => rule.weekday === weekday && rule.kind !== "working"),
      { weekday, kind: "working", startTime: hhmm(windowStart), endTime: hhmm(windowEnd) },
    ];
    const onPlan = new Set(planBlocks.map((block) => block.taskId).filter((id): id is string => Boolean(id)));
    const policy: SchedulePolicy = {
      bufferPercent: 0,
      durationFactor: preferences.durationFactor,
      mustDoAlreadyScheduled: countMustDos(planBlocks, taskById),
    };
    const engine = generateSchedule({
      date, weekday, availabilityRules: rules,
      fixedCommitments: [...input.fixedCommitments, ...calendarAsFixed, ...planBlocks.map((block, index) => blockAsFixed(block, date, index))],
      tasks: input.tasks.filter((task) => task.status === "todo" && !onPlan.has(task.id)),
      policy,
    });
    const placed = new Set(engine.blocks.filter((block) => block.kind === "task").map((block) => block.taskId as string));
    const range = `${hhmm(windowStart)}-${hhmm(windowEnd)}`;
    const summary = placed.size
      ? `Added ${plural(placed.size, "task")} to your free time ${range}.`
      : `No eligible task fits your free time ${range}.`;
    return finish(input, planBlocks, engine, mergeUnscheduled(input.currentUnscheduled, [], placed), summary, placed.size > 0);
  }

  // A block whose start time has passed (whether it is over or still running)
  // while its task is still todo was never actually started, so it moves
  // forward like upcoming work. Blocks for started or finished tasks stay.
  const isUnstarted = (block: ReplanBlock) =>
    block.kind === "task" && Boolean(block.taskId) && toMinutes(block.startTime) < now && taskById.get(block.taskId as string)?.status === "todo";
  const missed = planBlocks.filter(isUnstarted);
  const started = planBlocks.filter((block) => toMinutes(block.startTime) < now && !isUnstarted(block));
  const upcoming = planBlocks.filter((block) => toMinutes(block.startTime) >= now);

  const replanTaskIds = [...new Set([...missed, ...upcoming].map((block) => block.taskId).filter((id): id is string => Boolean(id)))];
  const candidates = replanTaskIds.map((id) => taskById.get(id)).filter((task): task is SchedulerTask => Boolean(task && OPEN_STATUSES.has(task.status)));
  const finishedCount = replanTaskIds.length - candidates.length;
  if (!candidates.length && !finishedCount) return noChange(`No remaining tasks on the plan after ${nowLabel}, so there is nothing to replan.`);
  const lowEnergy = mode === "low_energy";
  const policy: SchedulePolicy = {
    earliestStartTime: nowLabel,
    eligibleStatuses: [...OPEN_STATUSES],
    bufferPercent: lowEnergy ? preferences.bufferPercent : 0,
    durationFactor: preferences.durationFactor,
    lowEnergy,
    maxBlockMinutes: lowEnergy ? preferences.lowEnergyMaxBlockMinutes : null,
    mustDoAlreadyScheduled: countMustDos(started, taskById),
  };
  const engine = generateSchedule({
    date, weekday, availabilityRules: input.availabilityRules,
    fixedCommitments: [...input.fixedCommitments, ...calendarAsFixed, ...started.map((block, index) => blockAsFixed(block, date, index))],
    tasks: candidates,
    policy,
  });

  const placed = new Set(engine.blocks.filter((block) => block.kind === "task").map((block) => block.taskId as string));
  const deferredReason = lowEnergy
    ? `Did not fit in the rest of today after replanning for low energy from ${nowLabel}.`
    : `Did not fit in the rest of today after replanning from ${nowLabel}.`;
  const deferred = engine.unscheduled.map((item) => ({ taskId: item.taskId, reason: item.reason === NO_TIME_REASON ? deferredReason : item.reason }));

  const parts = lowEnergy
    ? [`Rebuilt the rest of today for low energy: ${plural(placed.size, "session")}, each at most ${preferences.lowEnergyMaxBlockMinutes} minutes.`]
    : [`Rescheduled ${placed.size} of ${plural(candidates.length, "remaining task")} from ${nowLabel}, using buffer time to catch up.`];
  if (lowEnergy) {
    const shortened = engine.blocks.filter((item) => {
      const planned = item.taskId ? taskById.get(item.taskId)?.estimatedMinutes : null;
      return item.kind === "task" && planned && toMinutes(item.endTime) - toMinutes(item.startTime) < effectiveDuration(planned, { durationFactor: preferences.durationFactor });
    });
    if (shortened.length) {
      parts.push(`Shortened ${shortened.map((item) => `"${item.title}"`).join(", ")} to ${preferences.lowEnergyMaxBlockMinutes} minutes; the rest of that work stays open for later.`);
    }
  }
  if (missed.length) parts.push(`This includes ${plural(missed.length, "earlier block")} whose task was not started yet.`);
  if (deferred.length) parts.push(`${plural(deferred.length, "task")} moved to Not scheduled.`);
  if (finishedCount) parts.push(`Removed ${plural(finishedCount, "block")} for tasks that are already done.`);

  return finish(input, started, engine, mergeUnscheduled(input.currentUnscheduled, deferred, placed), parts.join(" "), true);
}
