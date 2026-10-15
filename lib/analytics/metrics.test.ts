import { describe, expect, it } from "vitest";
import {
  computeAnalytics,
  sessionValidity,
  type AnalyticsInput,
  type AnalyticsPlan,
  type AnalyticsPlanBlock,
  type AnalyticsSession,
  type AnalyticsTask,
} from "@/lib/analytics/metrics";
import { resolveAnalyticsRange } from "@/lib/analytics/range";

const today = "2026-10-15";

const task = (id: string, overrides: Partial<AnalyticsTask> = {}): AnalyticsTask => ({
  id, title: `Task ${id}`, category: null, status: "todo", status_reason: null, due_date: null,
  completed_at: null, updated_at: "2026-09-01T00:00:00Z", actual_minutes: null,
  goal_id: null, project_id: null, milestone_id: null, ...overrides,
});
const session = (id: string, taskId: string, startedAt: string, minutes: number | null, open = false): AnalyticsSession => ({
  id, task_id: taskId, started_at: startedAt, ended_at: open ? null : startedAt, minutes,
});
const plan = (id: string, planDate: string, status: string, version: number): AnalyticsPlan => ({ id, plan_date: planDate, status, version });
const block = (planId: string, taskId: string | null, start: string, end: string, kind = "task"): AnalyticsPlanBlock => ({
  daily_plan_id: planId, task_id: taskId, kind, start_time: `${start}:00`, end_time: `${end}:00`,
});

/**
 * Hand-checked sample: Mon 2026-10-12 to Thu 2026-10-15 (today), in UTC.
 *
 * Logged time (timer when a task has any valid session, else actual_minutes):
 *   10-12  t1 timer 60                         = 60
 *   10-13  t1 timer 30 + t2 manual 45          = 75
 *   10-14  t3 timer 20 + t4 manual 50          = 70   (t4's only session is invalid)
 *   10-15  nothing                             = 0
 *   total 205 = timer 110 + manual 95. t1's actual 999 and t11's actual 40 are
 *   ignored because both tasks have valid timer sessions.
 * Categories: DSA 60+30+45 = 135 ("DSA" and " dsa " group), Research 50,
 *   Uncategorized 20; 135 + 50 + 20 = 205.
 * Excluded sessions in range: 1 open, 1 empty, 1 over 12 hours.
 * Plans: 10-12 latest committed is v2 (t1, t2 = 105 min; buffer ignored);
 *   10-13 latest committed is superseded v1 (t3, t4 = 80 min; v2 is a draft);
 *   10-14 has only a draft and a failed publish (no planned time);
 *   10-15 v1 (t10 = 60 min) is today, so it is left out of the completion rate.
 * Completion: t1 done 10-12 (on time), t2 done 10-13 (late), t3 open, t4 done
 *   10-14 (late) => 1 of 4 = 25% over 2 days.
 * Streak: completions on 10-12, 13, 14, 15 => current 4, longest in range 4.
 * Overdue: t6 todo due 10-10 and t7 deferred due 10-01 => 2 (t8 is skipped).
 * Reasons: "Too tired" and "too  tired" group => 2; t9 is outside the range.
 * Goals: Placements = t1, t2 (via project), t3 (via milestone) => 2 of 3; the
 *   skipped t8 is left out. Gym has no tasks. The archived goal is hidden.
 */
function sample(): AnalyticsInput {
  return {
    range: resolveAnalyticsRange({ from: "2026-10-12", to: today }, today),
    today,
    timeZone: "UTC",
    tasks: [
      task("t1", { category: "DSA", status: "completed", completed_at: "2026-10-12T15:00:00Z", actual_minutes: 999, goal_id: "g1" }),
      task("t2", { category: " dsa ", status: "completed", completed_at: "2026-10-13T12:00:00Z", actual_minutes: 45, project_id: "p1" }),
      task("t3", { milestone_id: "m1" }),
      task("t4", { category: "Research", status: "completed", completed_at: "2026-10-14T20:00:00Z", actual_minutes: 50, milestone_id: "m3" }),
      task("t5", { status: "completed", completed_at: "2026-10-05T10:00:00Z", actual_minutes: 30 }),
      task("t6", { due_date: "2026-10-10" }),
      task("t7", { status: "deferred", status_reason: "Too tired", due_date: "2026-10-01", updated_at: "2026-10-13T21:00:00Z" }),
      task("t8", { status: "skipped", status_reason: "too  tired", due_date: "2026-10-01", updated_at: "2026-10-14T10:00:00Z", goal_id: "g1" }),
      task("t9", { status: "skipped", updated_at: "2026-10-02T10:00:00Z" }),
      task("t10", { status: "completed", completed_at: "2026-10-15T08:00:00Z" }),
      task("t11", { category: "DSA", status: "completed", completed_at: "2026-10-14T09:00:00Z", actual_minutes: 40 }),
    ],
    sessions: [
      session("s1", "t1", "2026-10-12T09:00:00Z", 60),
      session("s2", "t1", "2026-10-13T09:00:00Z", 30),
      session("s3", "t1", "2026-10-13T10:00:00Z", null, true),
      session("s4", "t3", "2026-10-14T07:00:00Z", 20),
      session("s5", "t3", "2026-10-14T08:00:00Z", 800),
      session("s6", "t3", "2026-10-14T09:00:00Z", 0),
      session("s7", "t4", "2026-10-01T09:00:00Z", 900),
      session("s8", "t11", "2026-10-01T09:00:00Z", 25),
      session("s1", "t1", "2026-10-12T09:00:00Z", 60), // duplicate row from overlapping queries
    ],
    plans: [
      plan("p11", "2026-10-11", "confirmed", 1),
      plan("p12a", "2026-10-12", "superseded", 1),
      plan("p12b", "2026-10-12", "confirmed", 2),
      plan("p13a", "2026-10-13", "superseded", 1),
      plan("p13b", "2026-10-13", "draft", 2),
      plan("p14a", "2026-10-14", "draft", 1),
      plan("p14b", "2026-10-14", "publication_failed", 2),
      plan("p15", "2026-10-15", "confirmed", 1),
    ],
    planBlocks: [
      block("p11", "t5", "09:00", "10:00"),
      block("p12a", "t1", "09:00", "10:00"), block("p12a", "t3", "10:00", "10:30"),
      block("p12b", "t1", "09:00", "10:00"), block("p12b", "t2", "11:00", "11:45"), block("p12b", null, "12:00", "12:30", "buffer"),
      block("p13a", "t3", "09:00", "09:20"), block("p13a", "t4", "10:00", "11:00"),
      block("p13b", "t3", "09:00", "12:00"),
      block("p14a", "t6", "09:00", "10:00"),
      block("p14b", "t6", "09:00", "10:00"),
      block("p15", "t10", "08:00", "09:00"),
    ],
    goals: [
      { id: "g1", title: "Placements", status: "active" },
      { id: "g2", title: "Archived goal", status: "archived" },
      { id: "g3", title: "Gym", status: "active" },
    ],
    projects: [{ id: "p1", goal_id: "g1" }],
    milestones: [
      { id: "m1", title: "Mock interviews", status: "active", due_date: "2026-10-20", project_id: "p1" },
      { id: "m2", title: "Old milestone", status: "archived", due_date: "2026-09-01", project_id: null },
      { id: "m3", title: "No date", status: "active", due_date: null, project_id: null },
    ],
  };
}

describe("computeAnalytics: hand-checked sample week", () => {
  const result = computeAnalytics(sample());

  it("totals logged time, timer first and manual minutes only as a fallback", () => {
    expect(result).toMatchObject({ loggedMinutes: 205, timerMinutes: 110, manualMinutes: 95 });
  });

  it("keeps the invariants: categories and days both add up to the total", () => {
    expect(result.categories.reduce((total, bar) => total + bar.value, 0)).toBe(result.loggedMinutes);
    expect(result.daily.reduce((total, day) => total + day.loggedMinutes, 0)).toBe(result.loggedMinutes);
  });

  it("groups categories regardless of case and spacing", () => {
    expect(result.categories).toEqual([
      { label: "DSA", value: 135 },
      { label: "Research", value: 50 },
      { label: "Uncategorized", value: 20 },
    ]);
  });

  it("reports planned vs logged per day from the latest committed plan", () => {
    expect(result.daily).toEqual([
      { date: "2026-10-12", plannedMinutes: 105, loggedMinutes: 60 },
      { date: "2026-10-13", plannedMinutes: 80, loggedMinutes: 75 },
      { date: "2026-10-14", plannedMinutes: null, loggedMinutes: 70 },
      { date: "2026-10-15", plannedMinutes: 60, loggedMinutes: 0 },
    ]);
  });

  it("counts each planned task once per finished day, completed on or before that day", () => {
    expect(result.completion).toEqual({ planned: 4, completedOnTime: 1, rate: 0.25, daysCounted: 2 });
    expect(result.missedPlanned).toEqual([
      { taskId: "t2", date: "2026-10-12" },
      { taskId: "t3", date: "2026-10-13" },
      { taskId: "t4", date: "2026-10-13" },
    ]);
  });

  it("computes streaks, overdue tasks, reasons, and excluded sessions", () => {
    expect(result.streak).toEqual({ current: 4, longestInRange: 4 });
    expect(result.overdueCount).toBe(2);
    expect(result.reasons).toEqual([{ label: "Too tired", value: 2 }]);
    expect(result.reasonTaskCount).toBe(2);
    expect(result.excluded).toEqual({ open: 1, empty: 1, overlong: 1 });
  });

  it("shows progress for active goals and milestones only, through the hierarchy", () => {
    expect(result.goals).toEqual([
      { id: "g3", title: "Gym", completed: 0, total: 0, percent: null },
      { id: "g1", title: "Placements", completed: 2, total: 3, percent: 67 },
    ]);
    expect(result.milestones).toEqual([
      { id: "m1", title: "Mock interviews", completed: 0, total: 1, percent: 0, dueDate: "2026-10-20" },
      { id: "m3", title: "No date", completed: 1, total: 1, percent: 100, dueDate: null },
    ]);
  });
});

describe("computeAnalytics edge cases", () => {
  it("returns zeros and nulls, never NaN, for an empty account", () => {
    const range = resolveAnalyticsRange({}, today);
    const result = computeAnalytics({ range, today, timeZone: "UTC", tasks: [], sessions: [], plans: [], planBlocks: [], goals: [], projects: [], milestones: [] });
    expect(result).toEqual({
      loggedMinutes: 0, timerMinutes: 0, manualMinutes: 0,
      daily: range.days.map((date) => ({ date, plannedMinutes: null, loggedMinutes: 0 })),
      completion: { planned: 0, completedOnTime: 0, rate: null, daysCounted: 0 },
      missedPlanned: [],
      categories: [], overdueCount: 0, streak: { current: 0, longestInRange: 0 },
      reasons: [], reasonTaskCount: 0, goals: [], milestones: [], excluded: { open: 0, empty: 0, overlong: 0 },
    });
  });

  it("anchors the current streak on yesterday when nothing is done yet today, and resets on a gap", () => {
    const input = sample();
    input.tasks = input.tasks.filter((item) => item.id !== "t10");
    expect(computeAnalytics(input).streak).toEqual({ current: 3, longestInRange: 3 });

    input.tasks = input.tasks.filter((item) => item.id !== "t4" && item.id !== "t11");
    expect(computeAnalytics(input).streak).toEqual({ current: 0, longestInRange: 2 });
  });

  it("uses the user's local day, not UTC, for a session late in the evening", () => {
    // 23:30 in New York on 10-12 is 03:30 UTC on 10-13.
    const input: AnalyticsInput = {
      ...sample(),
      timeZone: "America/New_York",
      tasks: [task("late")],
      sessions: [session("x", "late", "2026-10-13T03:30:00Z", 40)],
      plans: [], planBlocks: [],
    };
    const result = computeAnalytics(input);
    expect(result.daily.find((day) => day.date === "2026-10-12")?.loggedMinutes).toBe(40);
    expect(result.daily.find((day) => day.date === "2026-10-13")?.loggedMinutes).toBe(0);
    expect(computeAnalytics({ ...input, timeZone: "UTC" }).daily.find((day) => day.date === "2026-10-13")?.loggedMinutes).toBe(40);
  });

  it("falls back to manual minutes when a task's only sessions are invalid", () => {
    const input: AnalyticsInput = {
      ...sample(),
      tasks: [task("m", { status: "completed", completed_at: "2026-10-13T10:00:00Z", actual_minutes: 35 })],
      sessions: [session("open", "m", "2026-10-13T08:00:00Z", null, true), session("zero", "m", "2026-10-13T09:00:00Z", 0)],
    };
    expect(computeAnalytics(input)).toMatchObject({ loggedMinutes: 35, timerMinutes: 0, manualMinutes: 35 });
  });

  it("folds reasons beyond the top five into Other", () => {
    const input: AnalyticsInput = {
      ...sample(),
      tasks: ["a", "b", "c", "d", "e", "f", "g"].map((reason, index) =>
        task(`r${index}`, { status: "deferred", status_reason: reason, updated_at: "2026-10-13T10:00:00Z" })),
    };
    const { reasons, reasonTaskCount } = computeAnalytics(input);
    expect(reasons).toHaveLength(6);
    expect(reasons[5]).toEqual({ label: "Other", value: 2 });
    expect(reasonTaskCount).toBe(7);
  });

  it("classifies session validity", () => {
    expect(sessionValidity(session("a", "t", "2026-10-13T09:00:00Z", 720))).toBe("valid");
    expect(sessionValidity(session("b", "t", "2026-10-13T09:00:00Z", 721))).toBe("overlong");
    expect(sessionValidity(session("c", "t", "2026-10-13T09:00:00Z", 0))).toBe("empty");
    expect(sessionValidity(session("d", "t", "2026-10-13T09:00:00Z", null))).toBe("empty");
    expect(sessionValidity(session("e", "t", "2026-10-13T09:00:00Z", 30, true))).toBe("open");
  });
});
