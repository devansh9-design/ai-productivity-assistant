import { describe, expect, it } from "vitest";
import { buildDraftPlan, type PlanDraftInput } from "./planner";
import type { SchedulerTask } from "@/lib/scheduler/engine";

const baseTask = (overrides: Partial<SchedulerTask> = {}): SchedulerTask => ({
  id: "task-1",
  title: "Task 1",
  status: "todo",
  priority: "medium",
  urgency: 3,
  impact: 3,
  mustDo: false,
  dueDate: null,
  estimatedMinutes: 60,
  energyLevel: "medium",
  createdAt: "2026-08-01T00:00:00Z",
  ...overrides,
});

const baseInput = (overrides: Partial<PlanDraftInput> = {}): PlanDraftInput => ({
  date: "2026-08-03",
  weekday: 1,
  availabilityRules: [
    { weekday: 1, kind: "working", startTime: "09:00", endTime: "14:00" },
  ],
  fixedCommitments: [],
  tasks: [baseTask()],
  existingManualBlocks: [],
  ...overrides,
});

describe("buildDraftPlan - Day 5 Plan Workflow", () => {
  it("preserves manual task blocks and schedules around them", () => {
    const result = buildDraftPlan(
      baseInput({
        tasks: [
          baseTask({ id: "manual-t", title: "Manual Task", estimatedMinutes: 60 }),
          baseTask({ id: "auto-t", title: "Auto Task", estimatedMinutes: 60 }),
        ],
        existingManualBlocks: [
          {
            id: "mb-1",
            task_id: "manual-t",
            kind: "task",
            title: "Manual Task",
            start_time: "09:00:00",
            end_time: "10:00:00",
            is_manual: true,
          },
        ],
      }),
    );

    const manualBlock = result.blocks.find((b) => b.taskId === "manual-t");
    expect(manualBlock).toMatchObject({
      startTime: "09:00:00",
      endTime: "10:00:00",
      isManual: true,
    });

    const autoBlock = result.blocks.find((b) => b.taskId === "auto-t");
    expect(autoBlock).toBeDefined();
    expect((autoBlock?.startTime ?? "") >= "10:00:00").toBe(true);
  });

  it("does NOT distort 20 percent buffer calculation when manual blocks are present", () => {
    // 09:00 - 14:00 = 300 minutes working time.
    // 20% of 300 minutes = 60 minutes buffer.
    const withoutManual = buildDraftPlan(baseInput());
    expect(withoutManual.availableMinutes).toBe(300);
    expect(withoutManual.bufferMinutes).toBe(60);

    const withManual = buildDraftPlan(
      baseInput({
        existingManualBlocks: [
          {
            id: "mb-1",
            task_id: "task-1",
            kind: "task",
            title: "Task 1",
            start_time: "09:00:00",
            end_time: "10:00:00",
            is_manual: true,
          },
        ],
      }),
    );

    // Buffer calculation must remain un-distorted (60 minutes), matching baseline working availability
    expect(withManual.availableMinutes).toBe(300);
    expect(withManual.bufferMinutes).toBe(60);
  });

  it("handles invalid manual blocks deterministically with a clear reason and allows re-placement", () => {
    // Manual block conflicts with a new fixed commitment from 09:00 to 11:00
    const result = buildDraftPlan(
      baseInput({
        fixedCommitments: [
          {
            id: "fc-1",
            date: "2026-08-03",
            title: "Doctor Appointment",
            startTime: "09:00",
            endTime: "11:00",
          },
        ],
        tasks: [baseTask({ id: "task-1", title: "Task 1", estimatedMinutes: 60 })],
        existingManualBlocks: [
          {
            id: "mb-1",
            task_id: "task-1",
            kind: "task",
            title: "Task 1",
            start_time: "09:30:00",
            end_time: "10:30:00",
            is_manual: true,
          },
        ],
      }),
    );

    // Engine should re-place task-1 after 11:00
    const placedTask = result.blocks.find((b) => b.taskId === "task-1");
    expect(placedTask).toBeDefined();
    expect((placedTask?.startTime ?? "") >= "11:00:00").toBe(true);
    expect(placedTask?.isManual).toBe(false);
  });

  it("reports unscheduled reason if invalid manual block task cannot fit anywhere", () => {
    // 09:00 - 14:00 working hours. Fixed commitment covers 09:00 - 13:30.
    // Task is 120 minutes.
    const result = buildDraftPlan(
      baseInput({
        fixedCommitments: [
          {
            id: "fc-1",
            date: "2026-08-03",
            title: "All Day Workshop",
            startTime: "09:00",
            endTime: "13:30",
          },
        ],
        tasks: [baseTask({ id: "task-1", title: "Big Task", estimatedMinutes: 120 })],
        existingManualBlocks: [
          {
            id: "mb-1",
            task_id: "task-1",
            kind: "task",
            title: "Big Task",
            start_time: "10:00:00",
            end_time: "12:00:00",
            is_manual: true,
          },
        ],
      }),
    );

    expect(result.unscheduled).toHaveLength(1);
    expect(result.unscheduled[0]?.taskId).toBe("task-1");
    expect(result.unscheduled[0]?.reason).toContain("no longer valid");
  });

  it("invalidates manual blocks outside working hours", () => {
    const result = buildDraftPlan(
      baseInput({
        availabilityRules: [
          { weekday: 1, kind: "working", startTime: "10:00", endTime: "16:00" },
        ],
        tasks: [baseTask({ id: "task-1", title: "Task 1", estimatedMinutes: 60 })],
        existingManualBlocks: [
          {
            id: "mb-1",
            task_id: "task-1",
            kind: "task",
            title: "Task 1",
            start_time: "08:00:00",
            end_time: "09:00:00",
            is_manual: true,
          },
        ],
      }),
    );

    // Should be placed inside working hours (10:00+) by the engine
    const block = result.blocks.find((b) => b.taskId === "task-1");
    expect(block).toBeDefined();
    expect((block?.startTime ?? "") >= "10:00:00").toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Day 6: Calendar integration tests
// ---------------------------------------------------------------------------

describe("buildDraftPlan - Calendar Integration", () => {
  it("calendar events block task placement and appear as calendar-kind blocks", () => {
    const result = buildDraftPlan(
      baseInput({
        tasks: [baseTask({ id: "task-1", title: "Task 1", estimatedMinutes: 60 })],
        calendarEvents: [
          {
            googleEventId: "gcal-1",
            title: "Team Standup",
            startTime: "09:00",
            endTime: "09:30",
          },
        ],
      }),
    );

    // Calendar block should be in the output
    const calBlock = result.blocks.find((b) => b.kind === "calendar");
    expect(calBlock).toBeDefined();
    expect(calBlock?.title).toBe("Team Standup");
    expect(calBlock?.startTime).toBe("09:00:00");
    expect(calBlock?.endTime).toBe("09:30:00");
    expect(calBlock?.isManual).toBe(false);

    // Task should be placed after the calendar event
    const taskBlock = result.blocks.find((b) => b.taskId === "task-1");
    expect(taskBlock).toBeDefined();
    expect((taskBlock?.startTime ?? "") >= "09:30:00").toBe(true);
  });

  it("calendar events reduce available minutes and buffer", () => {
    // 09:00 - 14:00 = 300 min working. Calendar event 09:00-10:00 = 60 min blocked.
    // Available = 240 min. Buffer = 20% of 240 = 48 min.
    const result = buildDraftPlan(
      baseInput({
        tasks: [],
        calendarEvents: [
          {
            googleEventId: "gcal-1",
            title: "Long Meeting",
            startTime: "09:00",
            endTime: "10:00",
          },
        ],
      }),
    );

    expect(result.availableMinutes).toBe(240);
    expect(result.bufferMinutes).toBe(48);
  });

  it("invalidates manual blocks that overlap with calendar events", () => {
    const result = buildDraftPlan(
      baseInput({
        tasks: [baseTask({ id: "task-1", title: "Task 1", estimatedMinutes: 60 })],
        calendarEvents: [
          {
            googleEventId: "gcal-1",
            title: "Client Call",
            startTime: "09:00",
            endTime: "10:00",
          },
        ],
        existingManualBlocks: [
          {
            id: "mb-1",
            task_id: "task-1",
            kind: "task",
            title: "Task 1",
            start_time: "09:30:00",
            end_time: "10:30:00",
            is_manual: true,
          },
        ],
      }),
    );

    // Manual block overlaps with calendar event, so it should be invalidated
    // The task should be re-placed by the engine after the calendar event
    const taskBlock = result.blocks.find((b) => b.taskId === "task-1");
    expect(taskBlock).toBeDefined();
    expect(taskBlock?.isManual).toBe(false);
    expect((taskBlock?.startTime ?? "") >= "10:00:00").toBe(true);
  });

  it("generates a normal plan with no calendar events", () => {
    const result = buildDraftPlan(
      baseInput({
        tasks: [baseTask({ id: "task-1", title: "Task 1", estimatedMinutes: 60 })],
        calendarEvents: [],
      }),
    );

    // No calendar blocks
    expect(result.blocks.filter((b) => b.kind === "calendar")).toHaveLength(0);
    // Task should still be placed
    expect(result.blocks.find((b) => b.taskId === "task-1")).toBeDefined();
    // Buffer/available should be the baseline (300 min, 60 buffer)
    expect(result.availableMinutes).toBe(300);
    expect(result.bufferMinutes).toBe(60);
  });
});
