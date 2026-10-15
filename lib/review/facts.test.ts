import { describe, expect, it } from "vitest";
import type { AnalyticsInput, AnalyticsTask } from "@/lib/analytics/metrics";
import { buildWeekFacts, weekRange, type ReviewCheckin } from "@/lib/review/facts";

const task = (id: string, overrides: Partial<AnalyticsTask> = {}): AnalyticsTask => ({
  id, title: `Task ${id}`, category: null, status: "todo", status_reason: null, due_date: null,
  completed_at: null, updated_at: "2026-09-01T00:00:00Z", actual_minutes: null,
  goal_id: null, project_id: null, milestone_id: null, ...overrides,
});

const checkin = (date: string, overrides: Partial<ReviewCheckin> = {}): ReviewCheckin => ({
  date, mood: 3, energy_level: "medium", wins: null, lesson: null, distractions: null, reflection: null, ...overrides,
});

const empty = (overrides: Partial<AnalyticsInput> = {}): AnalyticsInput => ({
  range: weekRange("2026-10-05"), today: "2026-10-15", timeZone: "Asia/Kolkata",
  tasks: [], sessions: [], plans: [], planBlocks: [], goals: [], projects: [], milestones: [], ...overrides,
});

/**
 * Review week Mon 5 to Sun 11 October 2026, in Asia/Kolkata (UTC+5:30).
 *   c1 done Tue 6 Oct, 45 min typed in (DSA)           -> manual 45
 *   c2 done Thu 8 Oct, 30 min on the timer (Placements) -> timer 30
 *   c3 done 19:00 UTC on 11 Oct = 00:30 on 12 Oct local -> next week, not counted
 *   Wed 7 Oct confirmed plan: c1 (done the 6th, on time) and m1 (still open, missed)
 *   d1 deferred, due Fri 9 Oct -> due this week, not done; d2 due 1 Oct -> outside the week
 *   gone: a plan block for a task that no longer exists -> ignored, never shown
 */
function busy(): AnalyticsInput {
  return empty({
    tasks: [
      task("c1", { title: "Arrays drill", category: "DSA", status: "completed", completed_at: "2026-10-06T05:00:00Z", actual_minutes: 45 }),
      task("c2", { title: "Mock interview", category: "Placements", status: "completed", completed_at: "2026-10-08T10:00:00Z" }),
      task("c3", { title: "Late night", status: "completed", completed_at: "2026-10-11T19:00:00Z", actual_minutes: 20 }),
      task("m1", { title: "Graphs" }),
      task("d1", { title: "Resume update", status: "deferred", due_date: "2026-10-09" }),
      task("d2", { title: "Old due", due_date: "2026-10-01" }),
    ],
    sessions: [{ id: "s1", task_id: "c2", started_at: "2026-10-08T09:00:00Z", ended_at: "2026-10-08T09:30:00Z", minutes: 30 }],
    plans: [{ id: "p7", plan_date: "2026-10-07", status: "confirmed", version: 1 }],
    planBlocks: [
      { daily_plan_id: "p7", task_id: "c1", kind: "task", start_time: "09:00:00", end_time: "09:45:00" },
      { daily_plan_id: "p7", task_id: "m1", kind: "task", start_time: "10:00:00", end_time: "11:00:00" },
      { daily_plan_id: "p7", task_id: "gone", kind: "task", start_time: "12:00:00", end_time: "13:00:00" },
    ],
  });
}

describe("buildWeekFacts", () => {
  it("summarizes a busy week from the records that exist", () => {
    const facts = buildWeekFacts(busy(), [checkin("2026-10-09", { energy_level: "low", wins: "Finished arrays" }), checkin("2026-10-14")]);

    expect(facts).toMatchObject({ weekStart: "2026-10-05", weekEnd: "2026-10-11", isEmpty: false, loggedMinutes: 75, timerMinutes: 30, manualMinutes: 45, longestStreak: 1 });
    expect(facts.completed.map((item) => [item.title, item.date])).toEqual([["Arrays drill", "2026-10-06"], ["Mock interview", "2026-10-08"]]);
    expect(facts.missedPlanned).toEqual([{ id: "m1", title: "Graphs", date: "2026-10-07" }]);
    // Planned = done on time + slipped, with the orphaned block ignored everywhere.
    expect(facts.completion).toEqual({ planned: 2, completedOnTime: 1, rate: 0.5 });
    expect(facts.dueNotDone).toEqual([{ id: "d1", title: "Resume update", status: "deferred", dueDate: "2026-10-09" }]);
    expect(facts.categories).toEqual([{ label: "DSA", value: 45 }, { label: "Placements", value: 30 }]);
    expect(facts.checkins.map((item) => item.date)).toEqual(["2026-10-09"]);
    expect(facts.metrics).toEqual({
      completed_tasks: { label: "Tasks completed", value: "2" },
      logged_time: { label: "Logged time", value: "1h 15m" },
      completion_rate: { label: "Planned tasks done on time", value: "50% (1 of 2)" },
      longest_streak: { label: "Longest streak", value: "1 day" },
      top_category: { label: "Most logged time", value: "DSA (45m)" },
      missed_planned: { label: "Planned tasks that slipped", value: "1" },
      due_not_done: { label: "Due this week, not done", value: "1" },
      checkins: { label: "Check-ins recorded", value: "1" },
    });
  });

  it("marks an empty week as empty, with inapplicable metrics set to null", () => {
    const facts = buildWeekFacts(empty(), []);
    expect(facts.isEmpty).toBe(true);
    expect(facts.completed).toEqual([]);
    expect(facts.metrics).toMatchObject({ completion_rate: null, top_category: null, missed_planned: null, checkins: null });
    expect(facts.metrics.completed_tasks).toEqual({ label: "Tasks completed", value: "0" });
    expect(facts.metrics.logged_time).toEqual({ label: "Logged time", value: "0m" });
  });

  it("counts a week with only a check-in as not empty", () => {
    expect(buildWeekFacts(empty(), [checkin("2026-10-07")]).isEmpty).toBe(false);
  });
});
