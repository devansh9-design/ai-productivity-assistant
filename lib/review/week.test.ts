import { describe, expect, it } from "vitest";
import { defaultReviewWeek, mondayOf, planningWeekFor, resolveReviewWeek, reviewableWeeks, weekDays, weekEnd } from "@/lib/review/week";

// October 2026: Mon 12, Thu 15, Sun 18, Mon 19, Tue 20.
describe("review and planning weeks", () => {
  it("finds the Monday of a week, across month and year boundaries", () => {
    expect(mondayOf("2026-10-15")).toBe("2026-10-12");
    expect(mondayOf("2026-10-12")).toBe("2026-10-12");
    expect(mondayOf("2026-10-18")).toBe("2026-10-12");
    expect(mondayOf("2026-11-01")).toBe("2026-10-26");
    expect(mondayOf("2027-01-02")).toBe("2026-12-28");
  });

  it("reviews the current week on Sunday and the last full week otherwise", () => {
    expect(defaultReviewWeek("2026-10-18")).toBe("2026-10-12");
    expect(defaultReviewWeek("2026-10-15")).toBe("2026-10-05");
    expect(defaultReviewWeek("2026-10-19")).toBe("2026-10-12");
  });

  it("plans this week on Monday and next week on any other day", () => {
    expect(planningWeekFor("2026-10-19")).toBe("2026-10-19");
    expect(planningWeekFor("2026-10-15")).toBe("2026-10-19");
    expect(planningWeekFor("2026-10-18")).toBe("2026-10-19");
    expect(planningWeekFor("2026-10-20")).toBe("2026-10-26");
  });

  it("keeps the reviewed week and the planned week separate", () => {
    // Thursday 15 October: review 5-11 October, plan 19-25 October.
    expect([defaultReviewWeek("2026-10-15"), weekEnd(defaultReviewWeek("2026-10-15"))]).toEqual(["2026-10-05", "2026-10-11"]);
    expect([planningWeekFor("2026-10-15"), weekEnd(planningWeekFor("2026-10-15"))]).toEqual(["2026-10-19", "2026-10-25"]);
  });

  it("lists seven days and twelve reviewable weeks", () => {
    expect(weekDays("2026-12-28")).toEqual(["2026-12-28", "2026-12-29", "2026-12-30", "2026-12-31", "2027-01-01", "2027-01-02", "2027-01-03"]);
    const weeks = reviewableWeeks("2026-10-15");
    expect(weeks).toHaveLength(12);
    expect(weeks[0]).toBe("2026-10-05");
    expect(weeks[1]).toBe("2026-09-28");
  });

  it("accepts only a listed Monday from the URL", () => {
    expect(resolveReviewWeek("2026-09-28", "2026-10-15")).toBe("2026-09-28");
    expect(resolveReviewWeek("2026-09-29", "2026-10-15")).toBe("2026-10-05");
    expect(resolveReviewWeek("2026-10-12", "2026-10-15")).toBe("2026-10-05");
    expect(resolveReviewWeek("2025-01-06", "2026-10-15")).toBe("2026-10-05");
    expect(resolveReviewWeek("nonsense", "2026-10-15")).toBe("2026-10-05");
    expect(resolveReviewWeek(undefined, "2026-10-15")).toBe("2026-10-05");
  });
});
