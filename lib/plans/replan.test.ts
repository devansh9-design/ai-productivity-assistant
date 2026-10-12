import { describe, expect, it } from "vitest";
import { buildReplan, type ReplanBlock, type ReplanInput } from "@/lib/plans/replan";
import { LOW_ENERGY_DEFERRAL_REASON, type SchedulerTask } from "@/lib/scheduler/engine";

const task = (id: string, overrides: Partial<SchedulerTask> = {}): SchedulerTask => ({
  id, title: `Task ${id}`, status: "todo", priority: "medium", urgency: 3, impact: 3, mustDo: false,
  dueDate: null, estimatedMinutes: 60, energyLevel: "medium", createdAt: "2026-08-01T00:00:00Z", ...overrides,
});

const block = (taskId: string | null, startTime: string, endTime: string, kind: ReplanBlock["kind"] = "task"): ReplanBlock => ({
  taskId, kind, title: taskId ? `Task ${taskId}` : kind === "buffer" ? "Scheduling buffer" : "Event", startTime: `${startTime}:00`, endTime: `${endTime}:00`, isManual: false,
});

const baseInput = (overrides: Partial<ReplanInput> = {}): ReplanInput => ({
  mode: "behind_schedule",
  date: "2026-08-03",
  weekday: 1,
  nowTime: "09:30",
  availabilityRules: [{ weekday: 1, kind: "working", startTime: "09:00", endTime: "17:00" }],
  fixedCommitments: [],
  calendarEvents: [],
  currentBlocks: [block("a", "09:00", "10:00"), block("b", "10:30", "11:30"), block("c", "13:00", "14:00"), block(null, "16:00", "17:00", "buffer")],
  currentUnscheduled: [],
  tasks: [task("a", { status: "in_progress" }), task("b"), task("c")],
  preferences: { bufferPercent: 20, lowEnergyMaxBlockMinutes: 45, durationFactor: 1 },
  freeWindow: null,
  ...overrides,
});

const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));

function expectNoOverlaps(blocks: Array<{ kind: string; startTime: string; endTime: string }>) {
  const placed = blocks.filter((item) => item.kind !== "calendar").sort((x, y) => x.startTime.localeCompare(y.startTime));
  for (let i = 1; i < placed.length; i += 1) expect(minutes(placed[i].startTime)).toBeGreaterThanOrEqual(minutes(placed[i - 1].endTime));
}

const taskBlock = (result: ReturnType<typeof buildReplan>, taskId: string) => result.blocks.find((item) => item.taskId === taskId);

describe("buildReplan: behind_schedule", () => {
  it("keeps started blocks and re-places the remaining tasks from now without new buffer", () => {
    const result = buildReplan(baseInput());
    expect(result.changed).toBe(true);
    expect(taskBlock(result, "a")).toMatchObject({ startTime: "09:00:00", endTime: "10:00:00" });
    expect(minutes(taskBlock(result, "b")!.startTime)).toBeGreaterThanOrEqual(minutes("09:30"));
    expect(minutes(taskBlock(result, "c")!.startTime)).toBeGreaterThanOrEqual(minutes("09:30"));
    expect(result.blocks.some((item) => item.kind === "buffer")).toBe(false);
    expect(result.bufferMinutes).toBe(0);
    expectNoOverlaps(result.blocks);
  });

  it("moves work that no longer fits to Not scheduled with a clear reason", () => {
    const result = buildReplan(baseInput({
      nowTime: "11:00",
      availabilityRules: [{ weekday: 1, kind: "working", startTime: "09:00", endTime: "12:00" }],
      currentBlocks: [block("a", "09:00", "10:00"), block("b", "11:00", "12:00"), block("c", "11:30", "12:00")],
    }));
    expect(result.unscheduled).toEqual([{ taskId: "c", reason: "Did not fit in the rest of today after replanning from 11:00." }]);
    expect(result.summary).toContain("1 task moved to Not scheduled");
    expectNoOverlaps(result.blocks);
  });

  it("drops upcoming blocks for tasks that are already done", () => {
    const result = buildReplan(baseInput({ tasks: [task("a", { status: "in_progress" }), task("b"), task("c", { status: "completed" })] }));
    expect(taskBlock(result, "c")).toBeUndefined();
    expect(result.summary).toContain("Removed 1 block");
  });

  it("does not add tasks that were not on the plan", () => {
    const result = buildReplan(baseInput({ tasks: [task("a", { status: "in_progress" }), task("b"), task("c"), task("extra", { urgency: 5 })] }));
    expect(taskBlock(result, "extra")).toBeUndefined();
  });

  it("moves a missed block forward when its time passed and the task was never started", () => {
    // A plan generated in the morning, opened at noon: the 09:00 block was missed.
    const result = buildReplan(baseInput({
      nowTime: "12:03",
      availabilityRules: [{ weekday: 1, kind: "working", startTime: "09:00", endTime: "22:00" }],
      currentBlocks: [block("a", "09:00", "10:00"), block(null, "20:48", "22:00", "buffer")],
      tasks: [task("a")],
    }));
    expect(result.changed).toBe(true);
    expect(result.blocks.filter((item) => item.taskId === "a")).toHaveLength(1);
    expect(taskBlock(result, "a")).toMatchObject({ startTime: "12:05:00", endTime: "13:05:00" });
    expect(result.summary).toContain("1 missed block");
    expectNoOverlaps(result.blocks);
  });

  it("keeps a past block whose task was started or finished", () => {
    const result = buildReplan(baseInput({
      nowTime: "12:00",
      tasks: [task("a", { status: "completed" }), task("b", { status: "in_progress" }), task("c")],
    }));
    expect(taskBlock(result, "a")).toMatchObject({ startTime: "09:00:00" });
    expect(taskBlock(result, "b")).toMatchObject({ startTime: "10:30:00" });
    expect(minutes(taskBlock(result, "c")!.startTime)).toBeGreaterThanOrEqual(minutes("12:00"));
  });

  it("reports no change when no task remains, leaving the plan and its buffer intact", () => {
    const done = { tasks: [task("a", { status: "completed" }), task("b", { status: "completed" }), task("c", { status: "skipped" })] };
    const late = buildReplan(baseInput({ nowTime: "16:30", ...done }));
    expect(late.changed).toBe(false);
    expect(late.summary).toContain("nothing to replan");

    const onlyBuffer = buildReplan(baseInput({ nowTime: "12:00", currentBlocks: [block("a", "09:00", "10:00"), block(null, "16:00", "17:00", "buffer")], tasks: [task("a", { status: "completed" })] }));
    expect(onlyBuffer.changed).toBe(false);
    expect(onlyBuffer.blocks.some((item) => item.kind === "buffer")).toBe(true);
  });

  it("keeps re-placed work clear of calendar events and fixed commitments", () => {
    const result = buildReplan(baseInput({
      calendarEvents: [{ googleEventId: "evt", title: "Standup", startTime: "10:00", endTime: "10:30" }],
      fixedCommitments: [{ id: "fc", date: "2026-08-03", title: "Lunch with Sam", startTime: "11:00", endTime: "12:00" }],
    }));
    for (const id of ["b", "c"]) {
      const placed = taskBlock(result, id)!;
      const [start, end] = [minutes(placed.startTime), minutes(placed.endTime)];
      expect(start < minutes("10:30") && end > minutes("10:00")).toBe(false);
      expect(start < minutes("12:00") && end > minutes("11:00")).toBe(false);
    }
    expect(result.blocks.filter((item) => item.kind === "calendar")).toHaveLength(1);
  });
});

describe("buildReplan: low_energy", () => {
  it("defers high-energy work and caps each session at the low-energy limit", () => {
    const result = buildReplan(baseInput({
      mode: "low_energy",
      tasks: [task("a", { status: "in_progress" }), task("b", { energyLevel: "high" }), task("c", { energyLevel: "low", estimatedMinutes: 90 })],
    }));
    expect(result.unscheduled).toContainEqual({ taskId: "b", reason: LOW_ENERGY_DEFERRAL_REASON });
    const light = taskBlock(result, "c")!;
    expect(minutes(light.endTime) - minutes(light.startTime)).toBe(45);
    expect(taskBlock(result, "a")).toMatchObject({ startTime: "09:00:00" });
    expectNoOverlaps(result.blocks);
  });
});

describe("buildReplan: free_time", () => {
  const freeInput = (overrides: Partial<ReplanInput> = {}) => baseInput({
    mode: "free_time",
    nowTime: "17:30",
    freeWindow: { startTime: "18:00", endTime: "20:00" },
    tasks: [task("a", { status: "in_progress" }), task("b"), task("c"), task("d", { urgency: 5 }), task("e", { estimatedMinutes: 90 })],
    currentUnscheduled: [{ taskId: "d", reason: "No contiguous time remains within working hours after commitments and buffer." }],
    ...overrides,
  });

  it("fills only the free window, keeps every existing block, and never duplicates planned tasks", () => {
    const result = buildReplan(freeInput());
    const added = result.blocks.filter((item) => item.kind === "task" && !["a", "b", "c"].includes(item.taskId as string));
    expect(added.length).toBeGreaterThan(0);
    for (const item of added) {
      expect(minutes(item.startTime)).toBeGreaterThanOrEqual(minutes("18:00"));
      expect(minutes(item.endTime)).toBeLessThanOrEqual(minutes("20:00"));
    }
    expect(result.blocks.filter((item) => item.taskId === "b")).toHaveLength(1);
    expect(result.blocks.some((item) => item.kind === "buffer" && item.startTime === "16:00:00")).toBe(true);
    expect(taskBlock(result, "d")).toBeDefined();
    expect(result.unscheduled.find((item) => item.taskId === "d")).toBeUndefined();
    expectNoOverlaps(result.blocks);
  });

  it("still respects reserved time such as gym inside the free window", () => {
    const result = buildReplan(freeInput({
      availabilityRules: [
        { weekday: 1, kind: "working", startTime: "09:00", endTime: "17:00" },
        { weekday: 1, kind: "exercise", startTime: "18:00", endTime: "19:00" },
      ],
    }));
    const added = result.blocks.filter((item) => item.kind === "task" && !["a", "b", "c"].includes(item.taskId as string));
    expect(added.every((item) => minutes(item.startTime) >= minutes("19:00"))).toBe(true);
  });

  it("starts from now when the window has partly passed, and reports a window that has fully passed", () => {
    const partial = buildReplan(freeInput({ nowTime: "18:40" }));
    expect(partial.blocks.filter((item) => item.kind === "task" && item.taskId === "d").every((item) => minutes(item.startTime) >= minutes("18:40"))).toBe(true);
    const passed = buildReplan(freeInput({ nowTime: "20:30" }));
    expect(passed.changed).toBe(false);
  });
});
