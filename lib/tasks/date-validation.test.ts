import { describe, expect, it } from "vitest";
import { isValidISODate } from "./date-validation";

describe("isValidISODate", () => {
  it("accepts real calendar dates", () => {
    expect(isValidISODate("2026-02-28")).toBe(true);
    expect(isValidISODate("2028-02-29")).toBe(true);
  });

  it("rejects impossible dates", () => {
    expect(isValidISODate("2026-02-30")).toBe(false);
    expect(isValidISODate("2026-13-01")).toBe(false);
    expect(isValidISODate("2026-00-10")).toBe(false);
  });

  it("rejects malformed values", () => {
    expect(isValidISODate("2026-2-3")).toBe(false);
    expect(isValidISODate("not-a-date")).toBe(false);
  });
});
