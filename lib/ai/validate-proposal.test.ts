import { describe, expect, it } from "vitest";
import { dropNullItemFields, validatePlanningProposal } from "./validate-proposal";

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

describe("dropNullItemFields", () => {
  it("removes null item fields so a schedule item validates and an informational item has no times", () => {
    const taskId = "11111111-1111-4111-8111-111111111111";
    const cleaned = dropNullItemFields({
      type: "suggest_schedule", summary: "Plan", reason: "Fits",
      items: [{ task_id: taskId, title: "A", start_time: "13:30", end_time: "14:00", estimated_minutes: 30, reason: "Due" }],
    });
    expect(validatePlanningProposal(cleaned).ok).toBe(true);

    const info = dropNullItemFields({
      type: "summarize_day", summary: "Why", reason: "Because",
      items: [{ task_id: null, title: "A", start_time: null, end_time: null, estimated_minutes: null, reason: "Urgent" }],
    }) as { items: Array<Record<string, unknown>> };
    expect(info.items[0]).toEqual({ title: "A", reason: "Urgent" });
    expect(validatePlanningProposal(info).ok).toBe(true);
  });

  it("leaves anything that is not a proposal for the validator to reject", () => {
    expect(dropNullItemFields(null)).toBeNull();
    expect(dropNullItemFields("text")).toBe("text");
    expect(validatePlanningProposal(dropNullItemFields({ type: "suggest_schedule", items: "x" })).ok).toBe(false);
  });
});
