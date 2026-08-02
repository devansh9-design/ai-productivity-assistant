import { describe, expect, it } from "vitest";
import { generateSchedule, scoreTask, type ScheduleInput, type SchedulerTask } from "@/lib/scheduler/engine";

const baseTask = (overrides: Partial<SchedulerTask> = {}): SchedulerTask => ({
  id: "task-1", title: "Task", status: "todo", priority: "medium", urgency: 3, impact: 3, mustDo: false,
  dueDate: null, estimatedMinutes: 60, energyLevel: "medium", createdAt: "2026-08-01T00:00:00Z", ...overrides,
});

const baseInput = (overrides: Partial<ScheduleInput> = {}): ScheduleInput => ({
  date: "2026-08-03", weekday: 1,
  availabilityRules: [{ weekday: 1, kind: "working", startTime: "09:00", endTime: "14:00" }],
  fixedCommitments: [], tasks: [baseTask()], ...overrides,
});

describe("generateSchedule", () => {
  it("reports active tasks when no availability is configured", () => {
    const result = generateSchedule(baseInput({ availabilityRules: [] }));
    expect(result.blocks).toEqual([]);
    expect(result.unscheduled).toEqual([{ taskId: "task-1", reason: "No working availability is configured for this day." }]);
  });

  it("does not automatically schedule in-progress tasks", () => {
    const result = generateSchedule(baseInput({
      tasks: [
        baseTask({ id: "todo", status: "todo" }),
        baseTask({ id: "doing", status: "in_progress" }),
      ],
    }));

    expect(result.blocks.filter((block) => block.kind === "task").map((block) => block.taskId)).toEqual(["todo"]);
    expect(result.unscheduled.map((item) => item.taskId)).not.toContain("doing");
  });

  it("limits must-do scheduling to three tasks", () => {
    const tasks = [1, 2, 3, 4].map((n) =>
      baseTask({
        id: `task-${n}`,
        title: `Must Do ${n}`,
        mustDo: true,
        estimatedMinutes: 30,
        urgency: 3,
        impact: 3,
        energyLevel: "medium",
      }),
    );
    const result = generateSchedule(
      baseInput({
        availabilityRules: [{ weekday: 1, kind: "working", startTime: "10:00", endTime: "12:00" }],
        tasks,
      }),
    );
    expect(result.blocks.filter((block) => block.kind === "task")).toHaveLength(3);
    expect(result.unscheduled).toContainEqual({
      taskId: "task-4",
      reason: "must_do_limit: only the top three must-do tasks can be scheduled in one day.",
    });
  });

  it("makes deadline urgency affect ranking", () => {
    const dueToday = baseTask({ id: "due", dueDate: "2026-08-03" });
    const later = baseTask({ id: "later", dueDate: "2026-08-10" });
    expect(scoreTask(dueToday, "2026-08-03")).toBeGreaterThan(scoreTask(later, "2026-08-03"));
    const result = generateSchedule(baseInput({ availabilityRules: [{ weekday: 1, kind: "working", startTime: "09:00", endTime: "11:30" }], tasks: [later, dueToday] }));
    expect(result.blocks.find((block) => block.kind === "task")?.taskId).toBe("due");
  });

  it("keeps fixed commitments immutable and never overlaps them", () => {
    const result = generateSchedule(baseInput({ fixedCommitments: [{ id: "event", date: "2026-08-03", title: "Class", startTime: "10:00", endTime: "11:00" }] }));
    const task = result.blocks.find((block) => block.kind === "task");
    expect(task).toBeDefined();
    if (!task) throw new Error("Expected a scheduled task");
    expect(task?.endTime <= "10:00:00" || task?.startTime >= "11:00:00").toBe(true);
    expect(result.blocks.some((block) => block.title === "Class")).toBe(false);
  });

  it("handles overlapping fixed commitments without overlapping planned blocks", () => {
    const result = generateSchedule(baseInput({
      fixedCommitments: [
        { id: "one", date: "2026-08-03", title: "Class", startTime: "10:00", endTime: "11:30" },
        { id: "two", date: "2026-08-03", title: "Meeting", startTime: "11:00", endTime: "12:30" },
      ],
      tasks: [baseTask({ id: "first", estimatedMinutes: 60 }), baseTask({ id: "second", estimatedMinutes: 60 })],
    }));
    const blocks = result.blocks;
    for (let index = 1; index < blocks.length; index += 1) expect(blocks[index - 1]!.endTime <= blocks[index]!.startTime).toBe(true);
    expect(blocks.filter((block) => block.kind === "task").every((block) => block.endTime <= "10:00:00" || block.startTime >= "12:30:00")).toBe(true);
  });

  it("reserves 20 percent of free capacity as buffer", () => {
    const result = generateSchedule(baseInput({ tasks: [] }));
    expect(result.availableMinutes).toBe(300);
    expect(result.bufferMinutes).toBe(60);
    expect(result.blocks).toContainEqual({ kind: "buffer", taskId: null, title: "Scheduling buffer", startTime: "13:00:00", endTime: "14:00:00" });
  });

  it("keeps every task within configured working-hour boundaries", () => {
    const result = generateSchedule(baseInput({ tasks: [baseTask({ estimatedMinutes: 180 })] }));
    const task = result.blocks.find((block) => block.kind === "task");
    expect(task).toMatchObject({ startTime: "09:00:00", endTime: "12:00:00" });
  });

  it("leaves tasks without a contiguous slot unscheduled with a reason", () => {
    const result = generateSchedule(baseInput({ fixedCommitments: [{ id: "event", date: "2026-08-03", title: "Meeting", startTime: "10:00", endTime: "13:00" }], tasks: [baseTask({ estimatedMinutes: 120 })] }));
    expect(result.blocks.filter((block) => block.kind === "task")).toHaveLength(0);
    expect(result.unscheduled[0]?.reason).toContain("No contiguous time");
  });

  it("returns identical output for identical input", () => {
    const input = baseInput({ availabilityRules: [{ weekday: 1, kind: "working", startTime: "09:00", endTime: "17:00" }, { weekday: 1, kind: "high_focus", startTime: "09:00", endTime: "11:00" }], tasks: [baseTask({ id: "high", energyLevel: "high" }), baseTask({ id: "low", energyLevel: "low" })] });
    expect(generateSchedule(input)).toEqual(generateSchedule(input));
  });

  it("prefers a high-focus window for high-energy work", () => {
    const result = generateSchedule(baseInput({
      availabilityRules: [
        { weekday: 1, kind: "working", startTime: "09:00", endTime: "15:00" },
        { weekday: 1, kind: "high_focus", startTime: "10:00", endTime: "12:00" },
      ],
      tasks: [baseTask({ energyLevel: "high", estimatedMinutes: 60 })],
    }));
    expect(result.blocks.find((block) => block.kind === "task")).toMatchObject({ startTime: "10:00:00", endTime: "11:00:00" });
  });
});
