import { describe, expect, it } from "vitest";
import {
  buildDayFacts, dayLine, describeCandidate, fallbackFeedback, parseStoredSuggestions, sessionsLine, targetLine, toStoredSuggestions, validateAIFeedback,
  type DayFactsInput,
} from "./daily";

// Thursday 22 Oct 2026: day 4 of the week starting Monday 19 Oct.
const base = (overrides: Partial<DayFactsInput> = {}): DayFactsInput => ({
  date: "2026-10-22",
  logItems: [
    { taskId: "t1", title: "Two problems", outcome: "done", reason: null },
    { taskId: "t2", title: "Lab report", outcome: "skipped", reason: "Lab closed" },
    { taskId: "t3", title: "OS notes", outcome: "partial", reason: null },
  ],
  goals: [{ id: "dsa", title: "DSA" }, { id: "gym", title: "Gym 3x" }],
  metrics: [
    { id: "problems", goalId: "dsa", name: "Problems solved", unit: "problems", aggregation: "sum" },
    { id: "weight", goalId: "gym", name: "Body weight", unit: "kg", aggregation: "latest" },
  ],
  targets: [
    { goalId: "dsa", title: "15 problems", metricId: "problems", targetValue: 15 },
    { goalId: "gym", title: "3 sessions", metricId: null, targetValue: null },
  ],
  logs: [{ metricId: "problems", value: 2 }, { metricId: "problems", value: 3 }],
  routines: [
    { id: "r-dsa", goalId: "dsa", title: "Two problems", daysOfWeek: [1, 2, 3, 4, 5, 6, 7], minutes: 40, metricId: "problems", metricAmount: 2, startDate: "2026-10-01", endDate: null, active: true },
    { id: "r-gym", goalId: "gym", title: "Gym", daysOfWeek: [1, 3, 5], minutes: 60, metricId: null, metricAmount: null, startDate: "2026-10-01", endDate: null, active: true },
  ],
  routineTasks: [
    { routineId: "r-dsa", occurrenceDate: "2026-10-19", status: "completed" },
    { routineId: "r-dsa", occurrenceDate: "2026-10-20", status: "skipped" },
    { routineId: "r-dsa", occurrenceDate: "2026-10-21", status: "completed" },
    { routineId: "r-dsa", occurrenceDate: "2026-10-22", status: "completed" },
    { routineId: "r-gym", occurrenceDate: "2026-10-19", status: "skipped" },
    { routineId: "r-gym", occurrenceDate: "2026-10-21", status: "skipped" },
  ],
  openTasks: [{ id: "t3", title: "OS notes", priority: "medium" }, { id: "t9", title: "Essay", priority: "high" }],
  tomorrowTitles: [],
  ...overrides,
});

describe("buildDayFacts", () => {
  it("works out each target against the pro-rata share for the day", () => {
    const facts = buildDayFacts(base());
    const dsa = facts.goals.find((goal) => goal.goalId === "dsa")!;
    // 15 a week, day 4 of 7: about 9 expected, 5 logged.
    expect(dsa.targets[0]).toMatchObject({ logged: 5, expected: 9, status: "behind" });
    expect(dsa.sessions).toEqual({ held: 3, dueSoFar: 4, plannedWeek: 7 });
    expect(facts.goals.find((goal) => goal.goalId === "gym")!.targets[0].status).toBe("no_number");
    expect(facts.goals.map((goal) => goal.status)).toEqual(["behind", "no_target"]);
    expect(buildDayFacts(base({ logs: [{ metricId: "problems", value: 9 }] })).goals[0].targets[0].status).toBe("on_track");
    expect(buildDayFacts(base({ logs: [{ metricId: "problems", value: 15 }] })).goals[0].targets[0].status).toBe("met");
  });

  it("offers a catch-up for a behind target, moves for open tasks and a lighter routine after repeated skips", () => {
    const facts = buildDayFacts(base());
    expect(facts.candidates.map((candidate) => candidate.id)).toEqual(["catch_up:r-dsa", "move:t9", "move:t3", "lighter:r-gym"]);
    expect(facts.candidates[0]).toMatchObject({ title: "Catch-up: Two problems", minutes: 40, amount: 2, unit: "problems" });
    expect(facts.candidates[3]).toMatchObject({ minutes: 60, newMinutes: 45, skipped: 2 });
  });

  it("does not offer a catch-up already on tomorrow's list, or for a target on track", () => {
    expect(buildDayFacts(base({ tomorrowTitles: ["catch-up: two problems"] })).candidates.some((c) => c.kind === "catch_up")).toBe(false);
    expect(buildDayFacts(base({ logs: [{ metricId: "problems", value: 10 }] })).candidates.some((c) => c.kind === "catch_up")).toBe(false);
  });

  it("is empty with nothing logged and no goal activity", () => {
    expect(buildDayFacts(base({ logItems: [], goals: [] })).isEmpty).toBe(true);
  });
});

describe("number lines", () => {
  it("are written by the app from the facts", () => {
    const facts = buildDayFacts(base());
    expect(dayLine(facts)).toBe("Today: 1 of 3 items done, 1 partly, 1 skipped.");
    expect(targetLine(facts.goals[0].targets[0])).toBe("Problems solved: 5 problems of 15 this week, about 4 problems behind where you'd expect by today.");
    expect(sessionsLine(facts.goals[0].sessions!)).toBe("Routine sessions: 3 of 4 held so far, 7 planned this week.");
    expect(sessionsLine({ held: 0, dueSoFar: 0, plannedWeek: 2 })).toBe("Routine sessions: none due yet, 2 planned this week.");
    expect(describeCandidate(facts.candidates[0], facts.tomorrow)).toBe('Add "Catch-up: Two problems" (40m) for tomorrow (Fri 23 Oct): about +2 problems.');
  });
});

describe("validateAIFeedback", () => {
  const facts = buildDayFacts(base());
  const good = { summary: "Solid effort today. DSA is behind this week, so tomorrow should include an extra session.", picks: [{ candidate_id: "catch_up:r-dsa", reason: "Closes part of the DSA gap." }] };

  it("accepts words-only notes that pick offered changes", () => {
    expect(validateAIFeedback(good, facts)).toEqual({ ok: true, feedback: { source: "ai", summary: good.summary, picks: [{ candidateId: "catch_up:r-dsa", reason: "Closes part of the DSA gap." }] } });
  });

  it("rejects calling a goal on track or behind against its numbers", () => {
    // Gym 3x has no numeric target, so it can't be on track; DSA is behind.
    expect(validateAIFeedback({ ...good, summary: "DSA is behind, while Gym 3x is on track." }, facts)).toMatchObject({ ok: false, reason: expect.stringContaining("Gym 3x") });
    expect(validateAIFeedback({ ...good, summary: "Your DSA goal is on track." }, facts)).toMatchObject({ ok: false, reason: expect.stringContaining("DSA") });
    expect(validateAIFeedback({ ...good, summary: "DSA is behind this week but Gym 3x had steady effort." }, facts).ok).toBe(true);
  });

  it("allows numbers that are part of the student's own titles", () => {
    expect(validateAIFeedback({ ...good, picks: [{ candidate_id: "catch_up:r-dsa", reason: "An extra Two problems session helps DSA catch up." }] }, facts).ok).toBe(true);
  });

  it("allows digits that are part of a goal title", () => {
    expect(validateAIFeedback({ ...good, summary: "Gym 3x is steady this week." }, facts).ok).toBe(true);
  });

  it("rejects numbers, unknown or repeated picks and bad shapes", () => {
    expect(validateAIFeedback({ ...good, summary: "You solved 5 problems." }, facts)).toMatchObject({ ok: false });
    expect(validateAIFeedback({ ...good, summary: "You are four problems behind." }, facts)).toMatchObject({ ok: false });
    expect(validateAIFeedback({ ...good, picks: [{ candidate_id: "delete:everything", reason: "x" }] }, facts)).toMatchObject({ ok: false });
    expect(validateAIFeedback({ ...good, picks: [good.picks[0], good.picks[0]] }, facts)).toMatchObject({ ok: false });
    expect(validateAIFeedback({ summary: "x".repeat(301), picks: [] }, facts)).toMatchObject({ ok: false });
    expect(validateAIFeedback("nope", facts)).toMatchObject({ ok: false });
  });
});

describe("fallbackFeedback", () => {
  it("is written from the facts and offers the first changes", () => {
    const facts = buildDayFacts(base());
    const feedback = fallbackFeedback(facts);
    expect(feedback.source).toBe("fallback");
    expect(feedback.summary).toBe("Today: 1 of 3 items done, 1 partly, 1 skipped. Behind this week: DSA.");
    expect(feedback.picks.map((pick) => pick.candidateId)).toEqual(["catch_up:r-dsa", "move:t9", "move:t3"]);
  });
});

describe("stored suggestions", () => {
  const facts = buildDayFacts(base());

  it("keep applied and dismissed outcomes when the feedback is written again", () => {
    const first = toStoredSuggestions({ source: "ai", summary: "s", picks: [{ candidateId: "catch_up:r-dsa", reason: "a" }, { candidateId: "move:t9", reason: "b" }] }, facts, []);
    const afterApply = first.map((item) => (item.id === "catch_up:r-dsa" ? { ...item, status: "applied" as const } : item));
    const second = toStoredSuggestions({ source: "ai", summary: "s", picks: [{ candidateId: "catch_up:r-dsa", reason: "c" }, { candidateId: "move:t3", reason: "d" }] }, facts, afterApply);
    expect(second.map((item) => `${item.id}:${item.status}`)).toEqual(["catch_up:r-dsa:applied", "move:t3:proposed"]);
  });

  it("drop anything malformed when read back", () => {
    const stored = toStoredSuggestions(fallbackFeedback(facts), facts, []);
    expect(parseStoredSuggestions(JSON.parse(JSON.stringify(stored)))).toEqual(stored);
    expect(parseStoredSuggestions([{ id: "x", kind: "delete_all", title: "t", reason: "r", status: "proposed" }, "junk", null])).toEqual([]);
    expect(parseStoredSuggestions({ not: "a list" })).toEqual([]);
  });
});

describe("routine sessions due", () => {
  it("counts every routine day up to the date, even one whose task was never created", () => {
    const facts = buildDayFacts(base({ routineTasks: [{ routineId: "r-dsa", occurrenceDate: "2026-10-19", status: "completed" }] }));
    // Daily routine, Monday to Thursday: four due, one held.
    expect(facts.goals.find((goal) => goal.goalId === "dsa")!.sessions).toEqual({ held: 1, dueSoFar: 4, plannedWeek: 7 });
    // Gym on Mon/Wed/Fri: two due by Thursday, none created.
    expect(facts.goals.find((goal) => goal.goalId === "gym")!.sessions).toEqual({ held: 0, dueSoFar: 2, plannedWeek: 3 });
  });
});
