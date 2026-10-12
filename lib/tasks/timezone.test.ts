import { describe, expect, it } from "vitest";
import { getLocalTimeHHMM } from "@/lib/tasks/timezone";

describe("getLocalTimeHHMM", () => {
  const instant = new Date("2026-08-15T18:45:00Z");

  it("formats wall-clock time in the given timezone", () => {
    expect(getLocalTimeHHMM("UTC", instant)).toBe("18:45");
    expect(getLocalTimeHHMM("Asia/Kolkata", instant)).toBe("00:15");
    expect(getLocalTimeHHMM("America/New_York", instant)).toBe("14:45");
  });

  it("falls back to UTC for an unknown timezone", () => {
    expect(getLocalTimeHHMM("Not/AZone", instant)).toBe("18:45");
  });
});
