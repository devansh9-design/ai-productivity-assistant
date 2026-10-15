import { describe, expect, it } from "vitest";
import { MAX_RANGE_DAYS, resolveAnalyticsRange } from "@/lib/analytics/range";

// 2026-10-15 is a Thursday.
const today = "2026-10-15";

describe("resolveAnalyticsRange", () => {
  it("defaults to the last 7 days including today", () => {
    const range = resolveAnalyticsRange({}, today);
    expect(range).toMatchObject({ preset: "7d", from: "2026-10-09", to: today, label: "Last 7 days" });
    expect(range.days).toEqual(["2026-10-09", "2026-10-10", "2026-10-11", "2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15"]);
  });

  it("supports this week (from Monday) and the last 30 days", () => {
    expect(resolveAnalyticsRange({ range: "week" }, today)).toMatchObject({ from: "2026-10-12", to: today });
    expect(resolveAnalyticsRange({ range: "week" }, "2026-10-12").days).toEqual(["2026-10-12"]);
    expect(resolveAnalyticsRange({ range: "week" }, "2026-10-18").from).toBe("2026-10-12");
    const month = resolveAnalyticsRange({ range: "30d" }, today);
    expect(month.from).toBe("2026-09-16");
    expect(month.days).toHaveLength(30);
  });

  it("accepts a valid custom range, crossing a month boundary", () => {
    const range = resolveAnalyticsRange({ from: "2026-09-28", to: "2026-10-02" }, today);
    expect(range).toMatchObject({ preset: "custom", from: "2026-09-28", to: "2026-10-02", label: "2026-09-28 to 2026-10-02" });
    expect(range.days).toEqual(["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02"]);
  });

  it("falls back to the default for invalid, reversed, future, or over-long custom ranges", () => {
    for (const params of [
      { from: "2026-02-30", to: "2026-03-02" },
      { from: "2026-10-10", to: "2026-10-01" },
      { from: "2026-10-10", to: "2026-10-16" },
      { from: "2026-01-01", to: today },
      { from: "2026-10-01" },
      { from: "not-a-date", to: today },
    ]) {
      expect(resolveAnalyticsRange(params, today).preset).toBe("7d");
    }
    expect(resolveAnalyticsRange({ range: "year" }, today).preset).toBe("7d");
  });

  it("allows exactly the maximum span", () => {
    const range = resolveAnalyticsRange({ from: "2026-07-16", to: today }, today);
    expect(range.preset).toBe("custom");
    expect(range.days).toHaveLength(MAX_RANGE_DAYS);
  });

  it("uses the first value when a param is repeated", () => {
    expect(resolveAnalyticsRange({ range: ["30d", "week"] }, today).preset).toBe("30d");
  });
});
