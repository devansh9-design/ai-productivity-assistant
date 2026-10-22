import { describe, it, expect } from "vitest";
import { defaultWeek, parseOnboarding, weekFromRules, type OnboardingInput } from "@/lib/onboarding/wizard";

const TODAY = "2026-10-21";

function input(overrides: Partial<OnboardingInput> = {}): OnboardingInput {
  return {
    displayName: " Asha ",
    collegeYear: "2",
    timeZone: "Asia/Kolkata",
    saveWeek: true,
    week: defaultWeek(),
    goals: [{ title: "Build muscle", category: "fitness", targetDate: "2026-12-20", weeklyHours: "5" }],
    ...overrides,
  };
}

function errorOf(result: ReturnType<typeof parseOnboarding>) {
  return result.ok ? null : result.error;
}

describe("parseOnboarding", () => {
  it("turns the default week into class and study rules with Sunday as 0", () => {
    const result = parseOnboarding(input(), TODAY);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.displayName).toBe("Asha");
    expect(result.payload.collegeYear).toBe(2);
    expect(result.payload.week?.filter((rule) => rule.kind === "class")).toHaveLength(5);
    expect(result.payload.week?.filter((rule) => rule.kind === "working")).toHaveLength(7);
    expect(result.payload.week).toContainEqual({ weekday: 0, kind: "working", start_time: "10:00", end_time: "13:00" });
    expect(result.payload.goals).toEqual([{ title: "Build muscle", category: "fitness", target_date: "2026-12-20", weekly_hours: 5 }]);
  });

  it("keeps the timetable untouched when re-running for the profile only", () => {
    const result = parseOnboarding(input({ saveWeek: false, week: [], goals: [] }), TODAY);
    expect(result.ok && result.payload.week).toBeNull();
  });

  it("allows skipping goals and leaving optional goal fields empty", () => {
    expect(parseOnboarding(input({ goals: [] }), TODAY).ok).toBe(true);
    const result = parseOnboarding(input({ goals: [{ title: "DSA", category: "placement", targetDate: "", weeklyHours: "" }] }), TODAY);
    expect(result.ok && result.payload.goals[0]).toEqual({ title: "DSA", category: "placement", target_date: null, weekly_hours: null });
  });

  it("explains what is wrong with the profile", () => {
    expect(errorOf(parseOnboarding(input({ displayName: "  " }), TODAY))).toMatch(/name/);
    expect(errorOf(parseOnboarding(input({ collegeYear: "7" }), TODAY))).toMatch(/year/);
    expect(errorOf(parseOnboarding(input({ timeZone: "Mars/Olympus" }), TODAY))).toMatch(/timezone/);
  });

  it("rejects broken timetables, naming the day", () => {
    const week = defaultWeek();
    week[0] = { weekday: 1, classes: [{ start: "12:00", end: "10:00" }], study: null };
    expect(errorOf(parseOnboarding(input({ week }), TODAY))).toBe("Monday: each class must end after it starts.");

    week[0] = { weekday: 1, classes: [{ start: "09:00", end: "11:00" }, { start: "10:30", end: "12:00" }], study: null };
    expect(errorOf(parseOnboarding(input({ week }), TODAY))).toBe("Monday: two classes overlap.");

    week[0] = { weekday: 1, classes: [], study: { start: "", end: "20:00" } };
    expect(errorOf(parseOnboarding(input({ week }), TODAY))).toBe("Monday: give study time a start and end time.");
  });

  it("needs study time somewhere in the week", () => {
    const week = defaultWeek().map((day) => ({ ...day, study: null }));
    expect(errorOf(parseOnboarding(input({ week }), TODAY))).toMatch(/study time on at least one day/);
  });

  it("rejects repeated or unknown days", () => {
    const week = defaultWeek();
    week[1] = { ...week[0] };
    expect(errorOf(parseOnboarding(input({ week }), TODAY))).toMatch(/unknown or repeated day/);
    expect(errorOf(parseOnboarding(input({ week: [{ weekday: 9, classes: [], study: null }] }), TODAY))).toMatch(/unknown or repeated day/);
  });

  it("checks goal fields", () => {
    const goal = { title: "Gym", category: "fitness" as const, targetDate: "2026-12-20", weeklyHours: "5" };
    expect(errorOf(parseOnboarding(input({ goals: [{ ...goal, title: "" }] }), TODAY))).toMatch(/needs a name/);
    expect(errorOf(parseOnboarding(input({ goals: [{ ...goal, targetDate: "2026-10-01" }] }), TODAY))).toMatch(/in the past/);
    expect(errorOf(parseOnboarding(input({ goals: [{ ...goal, targetDate: "next week" }] }), TODAY))).toMatch(/valid target date/);
    expect(errorOf(parseOnboarding(input({ goals: [{ ...goal, weeklyHours: "200" }] }), TODAY))).toMatch(/hours per week/);
    expect(errorOf(parseOnboarding(input({ goals: Array(11).fill(goal) }), TODAY))).toMatch(/at most 10 goals/);
  });
});

describe("weekFromRules", () => {
  it("rebuilds the wizard week from saved rules, Monday first", () => {
    const week = weekFromRules([
      { weekday: 1, kind: "class", start_time: "13:00:00", end_time: "15:00:00" },
      { weekday: 1, kind: "class", start_time: "09:00:00", end_time: "11:00:00" },
      { weekday: 1, kind: "working", start_time: "18:00:00", end_time: "21:00:00" },
      { weekday: 1, kind: "sleep", start_time: "23:00:00", end_time: "23:59:00" },
    ]);
    expect(week[0]).toEqual({ weekday: 1, classes: [{ start: "09:00", end: "11:00" }, { start: "13:00", end: "15:00" }], study: { start: "18:00", end: "21:00" } });
    expect(week[6]).toEqual({ weekday: 0, classes: [], study: null });
  });
});
