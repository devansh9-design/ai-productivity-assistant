import {
  generateSchedule,
  type AvailabilityRuleInput,
  type FixedCommitmentInput,
  type SchedulerTask,
  type UnscheduledTask,
} from "@/lib/scheduler/engine";

export interface ExistingManualBlock {
  id: string;
  task_id: string | null;
  kind: "task" | "buffer";
  title: string;
  start_time: string;
  end_time: string;
  is_manual: boolean;
}

export interface CalendarEventInput {
  googleEventId: string;
  title: string;
  startTime: string; // "HH:MM"
  endTime: string; // "HH:MM"
}

export interface PlanDraftInput {
  date: string;
  weekday: number;
  availabilityRules: AvailabilityRuleInput[];
  fixedCommitments: FixedCommitmentInput[];
  tasks: SchedulerTask[];
  existingManualBlocks?: ExistingManualBlock[];
  calendarEvents?: CalendarEventInput[];
}

export interface MergedBlock {
  taskId: string | null;
  kind: "task" | "buffer" | "calendar";
  title: string;
  startTime: string;
  endTime: string;
  sortOrder: number;
  isManual: boolean;
}

export interface PlanDraftResult {
  blocks: MergedBlock[];
  unscheduled: UnscheduledTask[];
  bufferMinutes: number;
  availableMinutes: number;
}

function timeToMinutes(t: string): number {
  const match = /^(\d{2}):(\d{2})/.exec(t);
  if (!match) return 0;
  return Number(match[1]) * 60 + Number(match[2]);
}

function intervalsOverlap(
  aStart: string,
  aEnd: string,
  bStart: string,
  bEnd: string,
): boolean {
  return (
    timeToMinutes(aStart) < timeToMinutes(bEnd) &&
    timeToMinutes(bStart) < timeToMinutes(aEnd)
  );
}

/**
 * Pure scheduling orchestrator for Day 5 draft plan generation.
 * Preserves manual blocks while enforcing:
 * 1. Buffer calculation is based on total available working minutes (un-distorted by manual blocks).
 * 2. Invalid manual blocks produce a clear unscheduled reason and allow eligible tasks to be re-placed by the engine.
 */
export function buildDraftPlan(input: PlanDraftInput): PlanDraftResult {
  const {
    date,
    weekday,
    availabilityRules,
    fixedCommitments,
    tasks,
    existingManualBlocks = [],
    calendarEvents = [],
  } = input;

  // Convert calendar events to fixed commitments so the engine blocks out their time
  const calendarAsFixed: FixedCommitmentInput[] = calendarEvents.map((e) => ({
    id: e.googleEventId,
    date,
    title: e.title,
    startTime: e.startTime,
    endTime: e.endTime,
  }));
  const allFixedCommitments = [...fixedCommitments, ...calendarAsFixed];

  // 1. Calculate baseline working availability & buffer from pure schedule rules (no manual blocks as fixed)
  // Calendar events reduce available working time, same as fixed commitments
  const baseSchedule = generateSchedule({
    date,
    weekday,
    availabilityRules,
    fixedCommitments: allFixedCommitments,
    tasks: [],
  });

  const availableMinutes = baseSchedule.availableMinutes;
  const bufferMinutes = baseSchedule.bufferMinutes;

  const workingRules = availabilityRules.filter(
    (r) => r.weekday === weekday && r.kind === "working",
  );
  const reservationRules = availabilityRules.filter(
    (r) =>
      r.weekday === weekday &&
      r.kind !== "working" &&
      r.kind !== "high_focus",
  );
  const dayCommitments = allFixedCommitments.filter((c) => c.date === date);

  const validManualBlocks: ExistingManualBlock[] = [];
  const unscheduled: UnscheduledTask[] = [];

  // Map tasks by ID for validation
  const taskMap = new Map(tasks.map((t) => [t.id, t]));

  // 2. Validate manual blocks
  for (const mb of existingManualBlocks) {
    if (!mb.is_manual || !mb.task_id) continue;

    const task = taskMap.get(mb.task_id);
    if (!task || task.status !== "todo") {
      unscheduled.push({
        taskId: mb.task_id,
        reason: `Preserved manual block (${mb.start_time.slice(0, 5)}-${mb.end_time.slice(0, 5)}) is no longer valid: task is missing or no longer open.`,
      });
      continue;
    }

    const mbStart = mb.start_time.slice(0, 5);
    const mbEnd = mb.end_time.slice(0, 5);

    // Check working hours
    const withinWorking = workingRules.some(
      (w) =>
        timeToMinutes(mbStart) >= timeToMinutes(w.startTime) &&
        timeToMinutes(mbEnd) <= timeToMinutes(w.endTime),
    );
    if (!withinWorking) {
      unscheduled.push({
        taskId: mb.task_id,
        reason: `Preserved manual block for "${mb.title}" (${mbStart}-${mbEnd}) is no longer valid: falls outside working hours.`,
      });
      continue;
    }

    // Check reservations (meal, sleep, travel, break)
    const reservationConflict = reservationRules.find((r) =>
      intervalsOverlap(mbStart, mbEnd, r.startTime, r.endTime),
    );
    if (reservationConflict) {
      unscheduled.push({
        taskId: mb.task_id,
        reason: `Preserved manual block for "${mb.title}" (${mbStart}-${mbEnd}) is no longer valid: overlaps with ${reservationConflict.kind} window.`,
      });
      continue;
    }

    // Check fixed commitments
    const commitmentConflict = dayCommitments.find((fc) =>
      intervalsOverlap(mbStart, mbEnd, fc.startTime, fc.endTime),
    );
    if (commitmentConflict) {
      unscheduled.push({
        taskId: mb.task_id,
        reason: `Preserved manual block for "${mb.title}" (${mbStart}-${mbEnd}) is no longer valid: overlaps with fixed commitment "${commitmentConflict.title}".`,
      });
      continue;
    }

    // Check overlap with previously validated manual blocks
    const manualConflict = validManualBlocks.find((vb) =>
      intervalsOverlap(
        mbStart,
        mbEnd,
        vb.start_time.slice(0, 5),
        vb.end_time.slice(0, 5),
      ),
    );
    if (manualConflict) {
      unscheduled.push({
        taskId: mb.task_id,
        reason: `Preserved manual block for "${mb.title}" (${mbStart}-${mbEnd}) is no longer valid: overlaps with another manual block "${manualConflict.title}".`,
      });
      continue;
    }

    validManualBlocks.push(mb);
  }

  // 3. Prepare remaining tasks and fixed commitments for engine placement
  const manualTaskIds = new Set(validManualBlocks.map((b) => b.task_id!));
  const engineTasks = tasks.filter((t) => !manualTaskIds.has(t.id));

  const manualAsFixed: FixedCommitmentInput[] = validManualBlocks.map((b) => ({
    id: b.id,
    date,
    title: b.title,
    startTime: b.start_time.slice(0, 5),
    endTime: b.end_time.slice(0, 5),
  }));

  // Run engine with manual blocks + calendar events added to fixed commitments for placement collision avoidance
  const engineResult = generateSchedule({
    date,
    weekday,
    availabilityRules,
    fixedCommitments: [...allFixedCommitments, ...manualAsFixed],
    tasks: engineTasks,
  });

  // Combine unscheduled list (invalid manual blocks + engine unscheduled)
  const combinedUnscheduledMap = new Map<string, string>();
  for (const item of unscheduled) {
    combinedUnscheduledMap.set(item.taskId, item.reason);
  }
  for (const item of engineResult.unscheduled) {
    // If an invalid manual block task was successfully placed by the engine, clear its invalid warning
    // Otherwise keep the engine's reason or the invalid manual block warning
    if (!combinedUnscheduledMap.has(item.taskId)) {
      combinedUnscheduledMap.set(item.taskId, item.reason);
    }
  }

  // If a task with an invalid manual block WAS placed by the engine, remove it from unscheduled list
  const placedEngineTaskIds = new Set(
    engineResult.blocks.filter((b) => b.kind === "task").map((b) => b.taskId),
  );
  for (const taskId of placedEngineTaskIds) {
    if (taskId) combinedUnscheduledMap.delete(taskId);
  }

  const finalUnscheduled: UnscheduledTask[] = Array.from(
    combinedUnscheduledMap.entries(),
  ).map(([taskId, reason]) => ({ taskId, reason }));

  // Build calendar blocks for the output timeline (read-only, not stored as tasks)
  const calendarBlocks: MergedBlock[] = calendarEvents.map((e, i) => ({
    taskId: null,
    kind: "calendar" as const,
    title: e.title,
    startTime: e.startTime + ":00",
    endTime: e.endTime + ":00",
    sortOrder: i,
    isManual: false,
  }));

  // Combine blocks: calendar blocks + valid manual blocks + engine blocks
  const mergedBlocks: MergedBlock[] = [
    ...calendarBlocks,
    ...validManualBlocks.map((b, i) => ({
      taskId: b.task_id,
      kind: b.kind,
      title: b.title,
      startTime: b.start_time.slice(0, 5) + ":00",
      endTime: b.end_time.slice(0, 5) + ":00",
      sortOrder: calendarBlocks.length + i,
      isManual: true,
    })),
    ...engineResult.blocks.map((block, i) => ({
      taskId: block.taskId,
      kind: block.kind,
      title: block.title,
      startTime: block.startTime,
      endTime: block.endTime,
      sortOrder: calendarBlocks.length + validManualBlocks.length + i,
      isManual: false,
    })),
  ].sort(
    (a, b) =>
      a.startTime.localeCompare(b.startTime) ||
      a.endTime.localeCompare(b.endTime) ||
      a.kind.localeCompare(b.kind),
  );

  return {
    blocks: mergedBlocks,
    unscheduled: finalUnscheduled.sort((a, b) =>
      a.taskId.localeCompare(b.taskId),
    ),
    bufferMinutes,
    availableMinutes,
  };
}
