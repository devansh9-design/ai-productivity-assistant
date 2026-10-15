import { describe, expect, it } from "vitest";
import { barPercent, formatDay, formatMinutes, plural } from "@/lib/analytics/format";

describe("analytics formatting", () => {
  it("formats minutes as hours and minutes", () => {
    expect(formatMinutes(0)).toBe("0m");
    expect(formatMinutes(45)).toBe("45m");
    expect(formatMinutes(60)).toBe("1h");
    expect(formatMinutes(205)).toBe("3h 25m");
    expect(formatMinutes(-5)).toBe("0m");
  });

  it("formats a date-only string without shifting the day", () => {
    expect(formatDay("2026-10-12")).toBe("Mon 12 Oct");
    expect(formatDay("2026-03-01")).toBe("Sun 1 Mar");
  });

  it("pluralizes and sizes bars safely", () => {
    expect(plural(1, "day")).toBe("1 day");
    expect(plural(0, "day")).toBe("0 days");
    expect(barPercent(30, 120)).toBe(25);
    expect(barPercent(0, 0)).toBe(0);
  });
});
