import { describe, expect, it } from "vitest";
import {
  buildPreferenceSummary,
  computeDurationFactor,
  DEFAULT_PLANNING_PREFERENCES,
  parsePlanningPreferencesForm,
} from "@/lib/preferences/preferences";

const form = (values: Record<string, string>) => ({ get: (key: string) => values[key] ?? null });
const samples = (pairs: Array<[number, number]>) => pairs.map(([estimated_minutes, actual_minutes]) => ({ estimated_minutes, actual_minutes }));

describe("parsePlanningPreferencesForm", () => {
  it("accepts valid values and reads the checkbox", () => {
    expect(parsePlanningPreferencesForm(form({ buffer_percent: "15", low_energy_max_block_minutes: "30", adapt_to_actual_durations: "on" })))
      .toEqual({ bufferPercent: 15, lowEnergyMaxBlockMinutes: 30, adaptToActualDurations: true });
    expect(parsePlanningPreferencesForm(form({ buffer_percent: "0", low_energy_max_block_minutes: "240" })).adaptToActualDurations).toBe(false);
  });

  it("rejects out-of-range, fractional, and missing values", () => {
    expect(() => parsePlanningPreferencesForm(form({ buffer_percent: "51", low_energy_max_block_minutes: "45" }))).toThrow("Buffer must be between 0 and 50.");
    expect(() => parsePlanningPreferencesForm(form({ buffer_percent: "20", low_energy_max_block_minutes: "10" }))).toThrow("between 15 and 240");
    expect(() => parsePlanningPreferencesForm(form({ buffer_percent: "2.5", low_energy_max_block_minutes: "45" }))).toThrow("whole number");
    expect(() => parsePlanningPreferencesForm(form({ low_energy_max_block_minutes: "45" }))).toThrow("whole number");
  });
});

describe("computeDurationFactor", () => {
  it("returns 1 until there are five usable samples", () => {
    expect(computeDurationFactor(samples([[60, 90], [60, 90], [60, 90], [60, 90]]))).toEqual({ factor: 1, sampleSize: 4 });
    expect(computeDurationFactor([{ estimated_minutes: null, actual_minutes: 30 }, ...samples([[60, 0]])]).sampleSize).toBe(0);
  });

  it("uses total actual over total estimated, rounded to 0.05", () => {
    expect(computeDurationFactor(samples([[60, 78], [60, 78], [60, 78], [60, 78], [60, 78]])).factor).toBe(1.3);
    expect(computeDurationFactor(samples([[100, 123], [100, 123], [100, 123], [100, 123], [100, 123]])).factor).toBe(1.25);
  });

  it("clamps extreme ratios", () => {
    expect(computeDurationFactor(samples([[30, 300], [30, 300], [30, 300], [30, 300], [30, 300]])).factor).toBe(1.5);
    expect(computeDurationFactor(samples([[120, 10], [120, 10], [120, 10], [120, 10], [120, 10]])).factor).toBe(0.75);
  });
});

describe("buildPreferenceSummary", () => {
  it("summarizes settings, today's rules, recent energy, and insights", () => {
    const summary = buildPreferenceSummary({
      preferences: DEFAULT_PLANNING_PREFERENCES,
      durationFactor: 1.25,
      todayRules: [
        { kind: "working", start_time: "09:00:00", end_time: "17:00:00" },
        { kind: "high_focus", start_time: "09:00:00", end_time: "11:00:00" },
        { kind: "exercise", start_time: "18:00:00", end_time: "19:00:00" },
      ],
      recentEnergy: ["low", "low", null, "high"],
      insights: ["Completed tasks took about 1.3x their estimates."],
    });
    expect(summary).toContain("Buffer: 20%");
    expect(summary).toContain("capped at 45 minutes");
    expect(summary).toContain("scaled x1.25");
    expect(summary).toContain("High-focus windows today: 09:00-11:00.");
    expect(summary).toContain("gym/exercise 18:00-19:00");
    expect(summary).toContain("(last 3): 2 low, 0 medium, 1 high");
    expect(summary).toContain("Observed: Completed tasks took about 1.3x their estimates.");
  });

  it("handles a brand-new user with no rules, check-ins, or history", () => {
    const summary = buildPreferenceSummary({ preferences: DEFAULT_PLANNING_PREFERENCES, durationFactor: 1, todayRules: [], recentEnergy: [], insights: [] });
    expect(summary).toContain("Task estimates are used as entered.");
    expect(summary).toContain("No high-focus window is set for today.");
    expect(summary).toContain("No recent check-in energy is recorded.");
    expect(summary).not.toContain("Observed:");
  });
});
