import { describe, expect, it } from "vitest";
import { buildMonthGrid, completionLevel, gridRange, lastOfMonth, resolveMonth, shiftMonth } from "./view";
import type { WeekDay } from "@/lib/week/view";

const TODAY = "2026-10-22";

describe("month helpers", () => {
  it("finds month ends, shifts across years and spans whole weeks", () => {
    expect(lastOfMonth("2026-02")).toBe("2026-02-28");
    expect(lastOfMonth("2028-02")).toBe("2028-02-29");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    // October 2026 starts on a Thursday and ends on a Saturday.
    expect(gridRange("2026-10")).toEqual({ start: "2026-09-28", end: "2026-11-01" });
  });

  it("accepts a month from a year back to three months ahead", () => {
    expect(resolveMonth(undefined, TODAY)).toBe("2026-10");
    expect(resolveMonth("2025-10", TODAY)).toBe("2025-10");
    expect(resolveMonth("2025-09", TODAY)).toBe("2026-10");
    expect(resolveMonth("2027-01", TODAY)).toBe("2027-01");
    expect(resolveMonth("2027-02", TODAY)).toBe("2026-10");
    expect(resolveMonth("2026-13", TODAY)).toBe("2026-10");
  });
});

describe("completionLevel", () => {
  it("grades a planned day by the share done, and leaves unplanned or future days blank", () => {
    expect(completionLevel({ planned: 4, done: 0, isFuture: false })).toBe(0);
    expect(completionLevel({ planned: 4, done: 1, isFuture: false })).toBe(1);
    expect(completionLevel({ planned: 4, done: 2, isFuture: false })).toBe(2);
    expect(completionLevel({ planned: 4, done: 4, isFuture: false })).toBe(3);
    expect(completionLevel({ planned: 0, done: 0, isFuture: false })).toBeNull();
    expect(completionLevel({ planned: 2, done: 0, isFuture: true })).toBeNull();
  });
});

describe("buildMonthGrid", () => {
  it("lays out whole weeks with each day's level and sorted events", () => {
    const day = (date: string, planned: number, done: number): WeekDay => ({ date, isToday: date === TODAY, isFuture: date > TODAY, plan: null, planned, done, partial: 0, skipped: 0, logged: false });
    const weeks = buildMonthGrid("2026-10", TODAY, [day("2026-10-21", 2, 1), day("2026-10-22", 3, 3)], [
      { date: "2026-10-21", kind: "commitment", label: "09:00 Maths exam", goalId: null },
      { date: "2026-10-21", kind: "goal_target", label: "DSA: target date", goalId: "g" },
    ]);
    expect(weeks).toHaveLength(5);
    expect(weeks.every((week) => week.length === 7)).toBe(true);
    expect(weeks[0][0]).toMatchObject({ date: "2026-09-28", inMonth: false });
    const cells = weeks.flat();
    expect(cells.find((cell) => cell.date === "2026-10-21")).toMatchObject({ level: 2, events: [{ kind: "goal_target" }, { kind: "commitment" }] });
    expect(cells.find((cell) => cell.date === TODAY)).toMatchObject({ level: 3, isToday: true });
    expect(cells.find((cell) => cell.date === "2026-10-01")).toMatchObject({ level: null, events: [] });
  });
});
