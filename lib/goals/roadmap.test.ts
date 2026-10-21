import { describe, it, expect } from "vitest";
import { daysBetween, formatMinutes, mondayOf, parseGoal, parseMetric, parsePhase, parseRoutine, parseWeeklyTarget, weeklyMinutes } from "@/lib/goals/roadmap";

/** FormData stand-in: values may repeat (e.g. checked days). */
function form(values: Record<string, string | string[]>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) for (const item of [value].flat()) data.append(key, item);
  return data;
}

const errorOf = (result: { ok: boolean; error?: string }) => (result.ok ? null : result.error);
const gymGoal = { start_date: "2026-10-19", target_date: "2026-12-18", weekly_hours: 5 };
const TODAY = "2026-10-21";

describe("parseGoal", () => {
  it("reads a full goal and rounds hours", () => {
    const result = parseGoal(form({ title: " Build muscle ", category: "fitness", start_date: "2026-10-19", target_date: "2026-12-18", weekly_hours: "5.25", level: "beginner" }));
    expect(result).toEqual({ ok: true, value: { title: "Build muscle", description: null, category: "fitness", status: "active", start_date: "2026-10-19", target_date: "2026-12-18", weekly_hours: 5.3, level: "beginner" } });
  });

  it("rejects bad goals with a clear message", () => {
    expect(errorOf(parseGoal(form({ title: "" })))).toMatch(/name/);
    expect(errorOf(parseGoal(form({ title: "X", category: "sleep" })))).toMatch(/type/);
    expect(errorOf(parseGoal(form({ title: "X", start_date: "2026-12-01", target_date: "2026-11-01" })))).toMatch(/on or after/);
    expect(errorOf(parseGoal(form({ title: "X", target_date: "2026-02-30" })))).toMatch(/valid target date/);
    expect(errorOf(parseGoal(form({ title: "X", weekly_hours: "200" })))).toMatch(/between 0.5 and 112/);
  });
});

describe("parseMetric", () => {
  it("reads a metric and refuses duplicate names", () => {
    expect(parseMetric(form({ name: "Body weight", unit: "kg", aggregation: "latest", baseline_value: "60", target_value: "65" }), []))
      .toEqual({ ok: true, value: { name: "Body weight", unit: "kg", aggregation: "latest", baseline_value: 60, target_value: 65 } });
    expect(errorOf(parseMetric(form({ name: "body weight" }), ["Body weight"]))).toMatch(/already tracks/);
  });
});

describe("parsePhase", () => {
  const phases = [{ title: "Foundations", start_date: "2026-10-19", end_date: "2026-11-08" }];

  it("accepts a phase that fits the goal and the other phases", () => {
    expect(parsePhase(form({ title: "Volume", start_date: "2026-11-09", end_date: "2026-11-29" }), gymGoal, phases).ok).toBe(true);
  });

  it("keeps phases inside the goal and apart from each other", () => {
    expect(errorOf(parsePhase(form({ title: "Early", start_date: "2026-10-01", end_date: "2026-10-20" }), gymGoal, []))).toMatch(/before the goal/);
    expect(errorOf(parsePhase(form({ title: "Late", start_date: "2026-12-10", end_date: "2026-12-31" }), gymGoal, []))).toMatch(/after the goal's target/);
    expect(errorOf(parsePhase(form({ title: "Clash", start_date: "2026-11-01", end_date: "2026-11-15" }), gymGoal, phases))).toBe('These dates overlap "Foundations" (2026-10-19 to 2026-11-08).');
    expect(errorOf(parsePhase(form({ title: "Backwards", start_date: "2026-11-20", end_date: "2026-11-10" }), gymGoal, []))).toMatch(/end on or after/);
  });

  it("works for goals without dates", () => {
    expect(parsePhase(form({ title: "Any", start_date: "2027-01-01", end_date: "2027-01-31" }), { start_date: null, target_date: null }, []).ok).toBe(true);
  });
});

describe("parseWeeklyTarget", () => {
  const metrics = [{ id: "m1" }];

  it("stores any picked day as its Monday", () => {
    const result = parseWeeklyTarget(form({ week: "2026-10-22", title: "20 problems", goal_metric_id: "m1", target_value: "20" }), gymGoal, metrics);
    expect(result.ok && result.value.week_start).toBe("2026-10-19");
  });

  it("needs a metric for an amount, and a week inside the goal", () => {
    expect(errorOf(parseWeeklyTarget(form({ week: "2026-10-22", title: "x", target_value: "5" }), gymGoal, metrics))).toMatch(/which metric/);
    expect(errorOf(parseWeeklyTarget(form({ week: "2026-10-22", title: "x", goal_metric_id: "other" }), gymGoal, metrics))).toMatch(/this goal's metrics/);
    expect(errorOf(parseWeeklyTarget(form({ week: "2027-01-05", title: "x" }), gymGoal, metrics))).toMatch(/after the goal's target/);
  });
});

describe("parseRoutine", () => {
  const gym = { title: "Gym", days: ["1", "3", "5", "6"], minutes: "75" };

  it("reads days, defaults dates to the goal, and fits the weekly hours", () => {
    const result = parseRoutine(form(gym), gymGoal, [], 0, TODAY);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.days_of_week).toEqual([1, 3, 5, 6]);
    expect(result.value.start_date).toBe(TODAY);
    expect(result.value.end_date).toBe("2026-12-18");
    expect(weeklyMinutes(result.value)).toBe(300);
  });

  it("refuses routines that exceed the goal's weekly hours, with the numbers", () => {
    expect(errorOf(parseRoutine(form(gym), gymGoal, [], 60, TODAY)))
      .toBe("Routines would take 6 h a week, more than this goal's 5 h. Shorten a routine or raise the goal's hours.");
  });

  it("does not count paused routines against the budget", () => {
    expect(parseRoutine(form({ ...gym, active: "false" }), gymGoal, [], 60, TODAY).ok).toBe(true);
  });

  it("checks days, length, window and metric", () => {
    expect(errorOf(parseRoutine(form({ ...gym, days: [] }), gymGoal, [], 0, TODAY))).toMatch(/at least one day/);
    expect(errorOf(parseRoutine(form({ ...gym, days: ["8"] }), gymGoal, [], 0, TODAY))).toMatch(/valid days/);
    expect(errorOf(parseRoutine(form({ ...gym, minutes: "2" }), gymGoal, [], 0, TODAY))).toMatch(/5 to 600/);
    expect(errorOf(parseRoutine(form({ ...gym, preferred_start: "19:00", preferred_end: "18:00" }), gymGoal, [], 0, TODAY))).toMatch(/end after it starts/);
    expect(errorOf(parseRoutine(form({ ...gym, metric_amount: "2" }), gymGoal, [], 0, TODAY))).toMatch(/which metric/);
  });
});

describe("date and time helpers", () => {
  it("finds Mondays and spans", () => {
    expect(mondayOf("2026-10-19")).toBe("2026-10-19");
    expect(mondayOf("2026-10-25")).toBe("2026-10-19");
    expect(daysBetween("2026-10-19", "2026-10-25")).toBe(7);
    expect(formatMinutes(90)).toBe("1 h 30 min");
    expect(formatMinutes(45)).toBe("45 min");
  });
});
