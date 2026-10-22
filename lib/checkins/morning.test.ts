import { describe, expect, it } from "vitest";
import { describePlanFit, formatMinutes, goalsBehindWeeklyTarget, morningPolicy, resolveMorningCheckinInput, weeklyTargetTaskIds } from "./morning";

function makeFormData(fields: Record<string, string>): FormData {
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) formData.set(key, value);
  return formData;
}

describe("resolveMorningCheckinInput", () => {
  it("requires free time and energy", () => {
    expect(() => resolveMorningCheckinInput(makeFormData({ energy_level: "low" }))).toThrow("Choose how much free time you have today.");
    expect(() => resolveMorningCheckinInput(makeFormData({ available_minutes: "120" }))).toThrow("Choose your energy level.");
    expect(() => resolveMorningCheckinInput(makeFormData({ available_minutes: "1441", energy_level: "low" }))).toThrow("Choose how much free time");
    expect(() => resolveMorningCheckinInput(makeFormData({ available_minutes: "1.5", energy_level: "low" }))).toThrow("Choose how much free time");
  });

  it("returns a minimal check-in with no event", () => {
    expect(resolveMorningCheckinInput(makeFormData({ available_minutes: "0", energy_level: "medium", notes: "  " }))).toEqual({
      available_minutes: 0, energy_level: "medium", notes: null, event: null,
    });
  });

  it("needs the whole event or none of it", () => {
    const base = { available_minutes: "180", energy_level: "high" };
    expect(() => resolveMorningCheckinInput(makeFormData({ ...base, event_title: "Exam" }))).toThrow("needs a title, a start time and an end time");
    expect(() => resolveMorningCheckinInput(makeFormData({ ...base, event_title: "Exam", event_start: "11:00", event_end: "10:00" }))).toThrow("valid same-day");
    expect(resolveMorningCheckinInput(makeFormData({ ...base, event_title: " Exam ", event_start: "10:00", event_end: "12:00", notes: "Travel later" }))).toEqual({
      available_minutes: 180, energy_level: "high", notes: "Travel later", event: { title: "Exam", startTime: "10:00", endTime: "12:00" },
    });
  });

  it("enforces the notes limit", () => {
    expect(() => resolveMorningCheckinInput(makeFormData({ available_minutes: "60", energy_level: "low", notes: "x".repeat(1001) }))).toThrow("1000 characters");
  });
});

describe("morningPolicy", () => {
  it("changes nothing without a check-in", () => {
    expect(morningPolicy(null, 45)).toEqual({});
  });

  it("caps task time, and shortens sessions only on low energy", () => {
    expect(morningPolicy({ available_minutes: 120, energy_level: "low" }, 45)).toEqual({ taskMinutesBudget: 120, lowEnergy: true, maxBlockMinutes: 45 });
    expect(morningPolicy({ available_minutes: 240, energy_level: "high" }, 45)).toEqual({ taskMinutesBudget: 240, lowEnergy: false, maxBlockMinutes: null });
  });
});

describe("goalsBehindWeeklyTarget", () => {
  const metrics = [{ id: "problems", aggregation: "sum" as const }, { id: "weight", aggregation: "latest" as const }];

  it("drops a goal whose summed target is already met this week", () => {
    const targets = [{ goal_id: "dsa", goal_metric_id: "problems", target_value: 15 }];
    expect(goalsBehindWeeklyTarget({ targets, metrics, logs: [{ goal_metric_id: "problems", value: 9 }] })).toEqual(["dsa"]);
    expect(goalsBehindWeeklyTarget({ targets, metrics, logs: [{ goal_metric_id: "problems", value: 9 }, { goal_metric_id: "problems", value: 6 }] })).toEqual([]);
  });

  it("keeps goals whose target has no number or is not a summed metric", () => {
    const targets = [
      { goal_id: "gym", goal_metric_id: null, target_value: null },
      { goal_id: "bulk", goal_metric_id: "weight", target_value: 61 },
    ];
    expect(goalsBehindWeeklyTarget({ targets, metrics, logs: [{ goal_metric_id: "weight", value: 62 }] })).toEqual(["bulk", "gym"]);
  });
});

describe("weeklyTargetTaskIds", () => {
  it("picks open tasks of the listed goals only", () => {
    const tasks = [
      { id: "t1", goal_id: "gym", status: "todo" },
      { id: "t2", goal_id: "gym", status: "completed" },
      { id: "t3", goal_id: "dsa", status: "todo" },
      { id: "t4", goal_id: null, status: "todo" },
    ];
    expect(weeklyTargetTaskIds(tasks, ["gym"])).toEqual(["t1"]);
  });
});

describe("describePlanFit", () => {
  it("states planned time against free time and what was left out", () => {
    expect(formatMinutes(90)).toBe("1 h 30 min");
    expect(describePlanFit({ availableMinutes: 180, plannedMinutes: 150, energy: "medium", leftOut: 0 }))
      .toBe("Draft plan: 2 h 30 min of your 3 h free time planned. Nothing was left out.");
    expect(describePlanFit({ availableMinutes: 60, plannedMinutes: 45, energy: "low", leftOut: 2 }))
      .toBe("Draft plan: 45 min of your 1 h free time planned. Energy is low, so sessions are shorter and high-energy work waits. 2 tasks were left out; the reasons are under Not scheduled.");
  });
});
