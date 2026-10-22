import { describe, expect, it } from "vitest";
import { buildRoutineGrid, buildWeekDays, resolveViewWeek, weekTargetLine } from "./view";
import type { TargetFacts } from "@/lib/feedback/daily";

// Week of Monday 19 Oct 2026; today is Thursday 22 Oct.
const WEEK = "2026-10-19";
const TODAY = "2026-10-22";

describe("buildWeekDays", () => {
  it("judges each day by its newest unreplaced plan, using the evening log first", () => {
    const days = buildWeekDays({
      weekStart: WEEK,
      today: TODAY,
      plans: [
        { date: "2026-10-20", status: "superseded", version: 1, taskIds: ["old"] },
        { date: "2026-10-20", status: "confirmed", version: 2, taskIds: ["a", "b", "c", "c"] },
        { date: "2026-10-21", status: "superseded", version: 3, taskIds: ["x"] },
      ],
      logItems: [
        { date: "2026-10-20", taskId: "a", outcome: "done" },
        { date: "2026-10-20", taskId: "b", outcome: "skipped" },
      ],
      tasks: [{ id: "c", completedOn: "2026-10-20" }, { id: "x", completedOn: "2026-10-22" }],
      loggedDates: ["2026-10-20"],
    });
    expect(days).toHaveLength(7);
    expect(days[0]).toMatchObject({ date: "2026-10-19", plan: null, planned: 0, logged: false });
    expect(days[1]).toMatchObject({ plan: { status: "confirmed", version: 2 }, planned: 3, done: 2, partial: 0, skipped: 1, logged: true });
    // Only a replaced plan that day: it is still shown; the task was completed on another day.
    expect(days[2]).toMatchObject({ plan: { status: "superseded", version: 3 }, planned: 1, done: 0 });
    expect(days[3]).toMatchObject({ isToday: true, isFuture: false });
    expect(days[4]).toMatchObject({ isFuture: true });
  });
});

describe("buildRoutineGrid", () => {
  const routine = { id: "gym", title: "Gym", goalTitle: "Build muscle", daysOfWeek: [1, 3, 5], startDate: "2026-10-01", endDate: null, active: true };

  it("marks each day held, skipped, not marked, not created, coming up or off", () => {
    const [row] = buildRoutineGrid({
      weekStart: WEEK, today: TODAY, routines: [routine],
      routineTasks: [
        { routineId: "gym", occurrenceDate: "2026-10-19", status: "completed" },
        { routineId: "gym", occurrenceDate: "2026-10-22", status: "todo" },
      ],
    });
    expect(row.cells.map((cell) => cell.state)).toEqual(["held", "off", "not_created", "open", "upcoming", "off", "off"]);
    expect(row).toMatchObject({ held: 1, due: 3 });
  });

  it("leaves out a paused routine with nothing this week and a routine that never falls in it", () => {
    expect(buildRoutineGrid({ weekStart: WEEK, today: TODAY, routines: [{ ...routine, active: false }], routineTasks: [] })).toEqual([]);
    expect(buildRoutineGrid({ weekStart: WEEK, today: TODAY, routines: [{ ...routine, startDate: "2026-11-01" }], routineTasks: [] })).toEqual([]);
  });
});

describe("weekTargetLine", () => {
  const target: TargetFacts = { title: "15 problems", metricId: "m", metricName: "Problems solved", unit: "problems", target: 15, logged: 9, expected: 9, status: "on_track" };

  it("says on track or behind during the week, met or missed once it has ended", () => {
    expect(weekTargetLine(target, false)).toEqual({ text: "Problems solved: 9 problems of 15, on track.", tone: "good" });
    expect(weekTargetLine({ ...target, logged: 5, status: "behind" }, false).text).toBe("Problems solved: 5 problems of 15, about 4 problems behind where you'd expect by today.");
    expect(weekTargetLine({ ...target, logged: 12, expected: 15, status: "behind" }, true)).toEqual({ text: "Problems solved: 12 problems of 15, missed by 3 problems.", tone: "bad" });
    expect(weekTargetLine({ ...target, logged: 15, status: "met" }, true).tone).toBe("good");
    expect(weekTargetLine({ ...target, status: "no_number", logged: null }, true)).toEqual({ text: "15 problems: no number to track.", tone: "neutral" });
  });
});

describe("resolveViewWeek", () => {
  it("accepts a recent Monday up to this week, otherwise shows this week", () => {
    expect(resolveViewWeek(undefined, TODAY)).toBe(WEEK);
    expect(resolveViewWeek("2026-10-12", TODAY)).toBe("2026-10-12");
    expect(resolveViewWeek("2026-10-13", TODAY)).toBe(WEEK);
    expect(resolveViewWeek("2026-10-26", TODAY)).toBe(WEEK);
    expect(resolveViewWeek("2026-01-05", TODAY)).toBe(WEEK);
    expect(resolveViewWeek("nonsense", TODAY)).toBe(WEEK);
  });
});
