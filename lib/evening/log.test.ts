import { describe, expect, it } from "vitest";
import { field, metricProgress, resolveEveningLogInput, selectLogTasks, suggestedMetricValues, type LogTaskCandidate } from "./log";

function makeFormData(fields: Record<string, string>): FormData {
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) formData.set(key, value);
  return formData;
}

const shown = { tasks: [{ id: "t1", title: "Lab report" }, { id: "t2", title: "Gym" }, { id: "t3", title: "Read" }], metricIds: ["m1", "m2", "m3"] };

describe("resolveEveningLogInput", () => {
  it("reads outcomes, reasons, numbers and the optional fields", () => {
    const input = resolveEveningLogInput(makeFormData({
      [field.outcome("t1")]: "done",
      [field.outcome("t2")]: "skipped", [field.reason("t2")]: " Rained ",
      [field.outcome("t3")]: "partial",
      [field.metric("m1")]: "3", [field.metric("m2")]: "61.4", [field.metric("m3")]: "",
      mood: "4", lesson: " Start earlier ", note: "",
    }), shown);
    expect(input).toEqual({
      items: [
        { task_id: "t1", outcome: "done", reason: null },
        { task_id: "t2", outcome: "skipped", reason: "Rained" },
        { task_id: "t3", outcome: "partial", reason: null },
      ],
      metrics: [
        { goal_metric_id: "m1", value: 3 },
        { goal_metric_id: "m2", value: 61.4 },
        { goal_metric_id: "m3", value: null },
      ],
      evening: { mood: 4, lesson: "Start earlier", note: null },
    });
  });

  it("leaves unmarked tasks and missing metric boxes out", () => {
    const input = resolveEveningLogInput(makeFormData({ [field.outcome("t1")]: "done" }), shown);
    expect(input.items).toEqual([{ task_id: "t1", outcome: "done", reason: null }]);
    expect(input.metrics).toEqual([]);
  });

  it("ignores tasks and metrics the log does not show", () => {
    const input = resolveEveningLogInput(makeFormData({ [field.outcome("other")]: "done", [field.metric("other")]: "5" }), shown);
    expect(input.items).toEqual([]);
    expect(input.metrics).toEqual([]);
  });

  it("refuses a skip without a reason, bad outcomes, numbers and moods", () => {
    expect(() => resolveEveningLogInput(makeFormData({ [field.outcome("t2")]: "skipped" }), shown)).toThrow('Say why "Gym" was skipped.');
    expect(() => resolveEveningLogInput(makeFormData({ [field.outcome("t2")]: "maybe" }), shown)).toThrow("Choose done, partly done or skipped");
    expect(() => resolveEveningLogInput(makeFormData({ [field.metric("m1")]: "abc" }), shown)).toThrow("Enter numbers only");
    expect(() => resolveEveningLogInput(makeFormData({ mood: "6" }), shown)).toThrow("Mood must be a number from 1 to 5.");
    expect(() => resolveEveningLogInput(makeFormData({ [field.outcome("t3")]: "partial", [field.reason("t3")]: "x".repeat(501) }), shown)).toThrow("500 characters");
  });
});

describe("suggestedMetricValues", () => {
  const sources = [
    { taskId: "a", title: "Two problems", goalMetricId: "problems", amount: 2 },
    { taskId: "b", title: "Evening problems", goalMetricId: "problems", amount: 3 },
    { taskId: "c", title: "Gym", goalMetricId: "workouts", amount: 1 },
  ];

  it("adds up the routine sessions marked done", () => {
    const result = suggestedMetricValues(sources, { a: "done", b: "done", c: "partial" });
    expect(result.get("problems")).toEqual({ value: 5, from: ["Two problems", "Evening problems"] });
    expect(result.has("workouts")).toBe(false);
  });
});

describe("metricProgress", () => {
  it("adds daily amounts onto the baseline for summed metrics", () => {
    const result = metricProgress({ aggregation: "sum", baseline_value: 0, target_value: 300 }, [
      { log_date: "2026-10-21", value: 4 }, { log_date: "2026-10-22", value: 2 },
    ]);
    expect(result).toEqual({ current: 6, percent: 2, lastLoggedOn: "2026-10-22" });
  });

  it("uses the newest reading for latest metrics, whichever direction the target is", () => {
    const gain = metricProgress({ aggregation: "latest", baseline_value: 60, target_value: 65 }, [
      { log_date: "2026-10-22", value: 62 }, { log_date: "2026-10-20", value: 61 },
    ]);
    expect(gain).toEqual({ current: 62, percent: 40, lastLoggedOn: "2026-10-22" });
    const loss = metricProgress({ aggregation: "latest", baseline_value: 80, target_value: 70 }, [{ log_date: "2026-10-22", value: 77.5 }]);
    expect(loss.percent).toBe(25);
  });

  it("knows nothing without logs or a baseline, and clamps past the target", () => {
    expect(metricProgress({ aggregation: "latest", baseline_value: null, target_value: 65 }, [])).toEqual({ current: null, percent: null, lastLoggedOn: null });
    expect(metricProgress({ aggregation: "sum", baseline_value: null, target_value: 10 }, [{ log_date: "2026-10-22", value: 12 }]).percent).toBe(100);
  });
});

describe("selectLogTasks", () => {
  const task = (overrides: Partial<LogTaskCandidate>): LogTaskCandidate => ({
    id: "x", title: "X", status: "todo", due_date: null, occurrence_date: null, routine_id: null, completed_at: null, ...overrides,
  });

  it("asks about planned, routine, due, completed and already-logged tasks, plan order first", () => {
    const tasks = [
      task({ id: "backlog", title: "Backlog" }),
      task({ id: "due", title: "Due today", due_date: "2026-10-22" }),
      task({ id: "late", title: "Overdue", due_date: "2026-10-20" }),
      task({ id: "future", title: "Next week", due_date: "2026-10-29" }),
      task({ id: "gym", title: "Gym", routine_id: "r1", occurrence_date: "2026-10-22", status: "completed" }),
      task({ id: "plan2", title: "Planned later" }),
      task({ id: "plan1", title: "Planned first" }),
      task({ id: "done", title: "Finished today", status: "completed" }),
      task({ id: "logged", title: "Logged", status: "skipped" }),
      task({ id: "deferred", title: "Deferred", status: "deferred", due_date: "2026-10-22" }),
    ];
    const result = selectLogTasks(tasks, {
      date: "2026-10-22",
      completedTodayIds: new Set(["done"]),
      plannedStart: new Map([["plan1", "09:00:00"], ["plan2", "14:00:00"]]),
      loggedIds: new Set(["logged"]),
    });
    expect(result.map((t) => t.id)).toEqual(["plan1", "plan2", "due", "done", "gym", "logged", "late"]);
  });
});
