import { describe, expect, it } from "vitest";
import { parseTargetsPayload, proposeTargets, validateAITargets, type GoalPlanning } from "./targets";
import type { TargetFacts } from "@/lib/feedback/daily";

const PLANNING = "2026-10-26";
const fact = (overrides: Partial<TargetFacts>): TargetFacts => ({
  title: "Problems", metricId: "problems", metricName: "Problems solved", unit: "problems", target: 15, logged: 15, expected: 15, status: "met", ...overrides,
});
const goal = (overrides: Partial<GoalPlanning> = {}): GoalPlanning => ({
  goalId: "dsa",
  title: "DSA",
  lastWeek: [fact({})],
  metrics: [
    { id: "problems", name: "Problems solved", unit: "problems", aggregation: "sum", targetValue: 300 },
    { id: "hours", name: "Hours studied", unit: "h", aggregation: "sum", targetValue: null },
  ],
  routines: [{ title: "Two problems", metricId: "problems", metricAmount: 2, daysOfWeek: [1, 2, 3, 4, 5], startDate: "2026-10-01", endDate: null, active: true }],
  existing: [],
  ...overrides,
});

describe("proposeTargets", () => {
  it("keeps a met target, grows one beaten comfortably and eases a missed one", () => {
    expect(proposeTargets(goal(), PLANNING)).toEqual([{ title: "Problems", metricId: "problems", value: 15 }]);
    expect(proposeTargets(goal({ lastWeek: [fact({ logged: 20 })] }), PLANNING)[0].value).toBe(17);
    // Missed with 9: eases to 80% (12), never below what was done or above the old target.
    expect(proposeTargets(goal({ lastWeek: [fact({ logged: 9, status: "behind" })] }), PLANNING)[0].value).toBe(12);
    expect(proposeTargets(goal({ lastWeek: [fact({ logged: 14, status: "behind" })] }), PLANNING)[0].value).toBe(14);
    expect(proposeTargets(goal({ lastWeek: [fact({ target: 2.5, logged: 1, status: "behind" })] }), PLANNING)[0].value).toBe(2);
  });

  it("carries over a target without a number", () => {
    expect(proposeTargets(goal({ lastWeek: [fact({ title: "Three gym sessions", metricId: null, target: null, logged: null, status: "no_number" })] }), PLANNING))
      .toEqual([{ title: "Three gym sessions", metricId: null, value: null }]);
  });

  it("works out a target from routines when last week had none", () => {
    // Two problems on each of five weekdays.
    expect(proposeTargets(goal({ lastWeek: [] }), PLANNING)).toEqual([{ title: "Problems solved", metricId: "problems", value: 10 }]);
    expect(proposeTargets(goal({ lastWeek: [], routines: [] }), PLANNING)).toEqual([]);
  });
});

describe("validateAITargets", () => {
  const goals = [goal(), goal({ goalId: "gym", title: "Gym", lastWeek: [], metrics: [], routines: [] })];
  const answer = (targets: unknown[], extra: Record<string, unknown> = {}) => ({ goals: [{ goal_id: "dsa", reason: "A steady week, so keep the pace.", targets, ...extra }] });

  it("accepts values near code's proposal and keeps code's proposal for goals left out", () => {
    const result = validateAITargets(answer([{ metric_id: "problems", title: "Trees and graphs", value: 18 }, { metric_id: "", title: "Mock interview", value: null }]), goals, PLANNING);
    expect(result).toEqual({ ok: true, proposals: [
      { goalId: "dsa", rows: [{ title: "Trees and graphs", metricId: "problems", value: 18 }, { title: "Mock interview", metricId: null, value: null }], reason: "A steady week, so keep the pace." },
      { goalId: "gym", rows: [], reason: null },
    ] });
  });

  it("rejects values far from last week, foreign metrics, unknown goals and numbers in reasons", () => {
    expect(validateAITargets(answer([{ metric_id: "problems", title: "Push", value: 40 }]), goals, PLANNING)).toMatchObject({ ok: false });
    expect(validateAITargets(answer([{ metric_id: "problems", title: "Rest", value: 5 }]), goals, PLANNING)).toMatchObject({ ok: false });
    expect(validateAITargets(answer([{ metric_id: "weight", title: "Bulk", value: 1 }]), goals, PLANNING)).toMatchObject({ ok: false });
    expect(validateAITargets({ goals: [{ goal_id: "other", reason: "", targets: [] }] }, goals, PLANNING)).toMatchObject({ ok: false });
    expect(validateAITargets(answer([], { reason: "Do 18 problems." }), goals, PLANNING)).toMatchObject({ ok: false });
    expect(validateAITargets(answer([{ metric_id: "", title: "Gym", value: 3 }]), goals, PLANNING)).toMatchObject({ ok: false });
    const weightGoal = [goal({ metrics: [...goal().metrics, { id: "weight", name: "Body weight", unit: "kg", aggregation: "latest", targetValue: 65 }] })];
    expect(validateAITargets(answer([{ metric_id: "weight", title: "Bulk", value: 61 }]), weightGoal, PLANNING)).toMatchObject({ ok: false, reason: expect.stringContaining("added up") });
    // A metric code had no proposal for: bounded by the metric's overall target (none here, so the global cap).
    expect(validateAITargets(answer([{ metric_id: "hours", title: "Study", value: 6 }]), goals, PLANNING)).toMatchObject({ ok: true });
  });
});

describe("parseTargetsPayload", () => {
  const goals = [goal()];

  it("reads ticked goals with their rows", () => {
    expect(parseTargetsPayload(JSON.stringify([{ goalId: "dsa", rows: [{ title: " Trees ", metricId: "problems", value: 12 }, { title: "Mock", metricId: null, value: 5 }] }]), goals))
      .toEqual([{ goalId: "dsa", rows: [{ title: "Trees", metricId: "problems", value: 12 }, { title: "Mock", metricId: null, value: null }] }]);
  });

  it("refuses unknown goals, foreign metrics, missing numbers or titles, and an empty save", () => {
    expect(() => parseTargetsPayload("[]", goals)).toThrow("Tick at least one goal");
    expect(() => parseTargetsPayload("not json", goals)).toThrow("could not be read");
    expect(() => parseTargetsPayload(JSON.stringify([{ goalId: "nope", rows: [] }]), goals)).toThrow("changed");
    expect(() => parseTargetsPayload(JSON.stringify([{ goalId: "dsa", rows: [] }]), goals)).toThrow("at least one target");
    expect(() => parseTargetsPayload(JSON.stringify([{ goalId: "dsa", rows: [{ title: "x", metricId: "weight", value: 1 }] }]), goals)).toThrow("metric it doesn't have");
    expect(() => parseTargetsPayload(JSON.stringify([{ goalId: "dsa", rows: [{ title: "x", metricId: "problems", value: null }] }]), goals)).toThrow('Enter a number for "x"');
    expect(() => parseTargetsPayload(JSON.stringify([{ goalId: "dsa", rows: [{ title: " ", metricId: null, value: null }] }]), goals)).toThrow("needs a title");
  });
});
