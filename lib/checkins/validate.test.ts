import { describe, expect, it } from "vitest";
import { resolveCheckinInput } from "./validate";

function makeFormData(fields: Record<string, string>): FormData {
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) formData.set(key, value);
  return formData;
}

describe("resolveCheckinInput", () => {
  it("requires a non-empty reflection", () => {
    expect(() => resolveCheckinInput(makeFormData({}))).toThrow(
      "A reflection is required to save the check-in.",
    );
    expect(() => resolveCheckinInput(makeFormData({ reflection: "   " }))).toThrow(
      "A reflection is required to save the check-in.",
    );
  });

  it("trims and returns a valid reflection", () => {
    const result = resolveCheckinInput(makeFormData({ reflection: "  Good focus today.  " }));
    expect(result.reflection).toBe("Good focus today.");
  });

  it("accepts no mood as null", () => {
    const result = resolveCheckinInput(makeFormData({ reflection: "ok" }));
    expect(result.mood).toBeNull();
  });

  it("accepts a valid mood 1-5", () => {
    for (const value of [1, 2, 3, 4, 5]) {
      const result = resolveCheckinInput(makeFormData({ reflection: "ok", mood: String(value) }));
      expect(result.mood).toBe(value);
    }
  });

  it("rejects a mood outside 1-5", () => {
    expect(() => resolveCheckinInput(makeFormData({ reflection: "ok", mood: "0" }))).toThrow(
      "Mood must be a number from 1 to 5.",
    );
    expect(() => resolveCheckinInput(makeFormData({ reflection: "ok", mood: "6" }))).toThrow(
      "Mood must be a number from 1 to 5.",
    );
  });

  it("rejects a non-numeric mood", () => {
    expect(() => resolveCheckinInput(makeFormData({ reflection: "ok", mood: "great" }))).toThrow(
      "Mood must be a number from 1 to 5.",
    );
  });

  it("accepts a valid energy level and rejects an unrecognized one", () => {
    const valid = resolveCheckinInput(makeFormData({ reflection: "ok", energy_level: "high" }));
    expect(valid.energy_level).toBe("high");

    const invalid = resolveCheckinInput(makeFormData({ reflection: "ok", energy_level: "bogus" }));
    expect(invalid.energy_level).toBeNull();
  });

  it("normalizes blank optional fields to null", () => {
    const result = resolveCheckinInput(
      makeFormData({ reflection: "ok", distractions: "  ", wins: "", lesson: "   " }),
    );
    expect(result.distractions).toBeNull();
    expect(result.wins).toBeNull();
    expect(result.lesson).toBeNull();
  });

  it("trims optional text fields when present", () => {
    const result = resolveCheckinInput(
      makeFormData({ reflection: "ok", distractions: "  phone  ", wins: " shipped part 1 " }),
    );
    expect(result.distractions).toBe("phone");
    expect(result.wins).toBe("shipped part 1");
  });
});
