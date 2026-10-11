import { describe, expect, it } from "vitest";
import { validatePlanningProposal } from "./validate-proposal";

const valid = {
  type: "suggest_schedule",
  summary: "Schedule two hours of focused work.",
  reason: "The user has two hours available tonight.",
  items: [
    {
      task_id: "458ce27c-d4c2-4da7-b80f-ae2518c4a40b",
      title: "Finish project",
      reason: "High-priority incomplete task.",
      start_time: "19:00",
      end_time: "21:00",
      estimated_minutes: 120,
    },
  ],
};

describe("validatePlanningProposal", () => {
  it("accepts a valid proposal", () => {
    expect(validatePlanningProposal(valid).ok).toBe(true);
  });

  it("rejects unknown proposal types", () => {
    expect(validatePlanningProposal({ ...valid, type: "delete_everything" }).ok).toBe(false);
  });

  it("rejects malformed task IDs", () => {
    expect(
      validatePlanningProposal({
        ...valid,
        items: [{ ...valid.items[0], task_id: "not-a-uuid" }],
      }).ok,
    ).toBe(false);
  });

  it("rejects missing reasons", () => {
    expect(
      validatePlanningProposal({
        ...valid,
        reason: "",
      }).ok,
    ).toBe(false);
  });

  it("rejects unsafe duration values", () => {
    expect(
      validatePlanningProposal({
        ...valid,
        items: [{ ...valid.items[0], estimated_minutes: 0 }],
      }).ok,
    ).toBe(false);
  });

  it("rejects oversized item lists", () => {
    expect(
      validatePlanningProposal({
        ...valid,
        items: Array.from({ length: 51 }, () => valid.items[0]),
      }).ok,
    ).toBe(false);
  });
});
