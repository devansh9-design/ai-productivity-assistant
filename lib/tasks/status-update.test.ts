import { describe, expect, it } from "vitest";
import { resolveTaskStatusUpdate } from "./status-update";

describe("resolveTaskStatusUpdate", () => {
  it("rejects an unknown status", () => {
    expect(() => resolveTaskStatusUpdate("bogus", null, null)).toThrow("Invalid task status.");
  });

  it("requires a reason to skip a task", () => {
    expect(() => resolveTaskStatusUpdate("skipped", null, null)).toThrow(
      "A reason is required to skip or defer a task.",
    );
    expect(() => resolveTaskStatusUpdate("skipped", "   ", null)).toThrow(
      "A reason is required to skip or defer a task.",
    );
  });

  it("requires a reason to defer a task", () => {
    expect(() => resolveTaskStatusUpdate("deferred", "", null)).toThrow(
      "A reason is required to skip or defer a task.",
    );
  });

  it("stores a trimmed reason when skipping", () => {
    const update = resolveTaskStatusUpdate("skipped", "  waiting on review  ", null);
    expect(update).toEqual({ status: "skipped", status_reason: "waiting on review" });
  });

  it("stores a trimmed reason when deferring", () => {
    const update = resolveTaskStatusUpdate("deferred", "low energy today", null);
    expect(update).toEqual({ status: "deferred", status_reason: "low energy today" });
  });

  it("does not require a reason to complete a task", () => {
    const update = resolveTaskStatusUpdate("completed", null, null);
    expect(update).toEqual({ status: "completed", status_reason: null });
  });

  it("clears status_reason when a task is reopened to todo", () => {
    const update = resolveTaskStatusUpdate("todo", null, null);
    expect(update.status_reason).toBeNull();
  });

  it("clears status_reason even if a stray reason value is submitted for a non-skip/defer status", () => {
    const update = resolveTaskStatusUpdate("completed", "irrelevant leftover text", null);
    expect(update.status_reason).toBeNull();
  });

  it("includes actual_minutes when a valid non-negative integer is provided", () => {
    const update = resolveTaskStatusUpdate("completed", null, "45");
    expect(update.actual_minutes).toBe(45);
  });

  it("omits actual_minutes when not provided", () => {
    const update = resolveTaskStatusUpdate("completed", null, null);
    expect(update.actual_minutes).toBeUndefined();
  });

  it("omits actual_minutes when blank", () => {
    const update = resolveTaskStatusUpdate("completed", null, "   ");
    expect(update.actual_minutes).toBeUndefined();
  });

  it("omits actual_minutes when negative or non-numeric", () => {
    expect(resolveTaskStatusUpdate("completed", null, "-5").actual_minutes).toBeUndefined();
    expect(resolveTaskStatusUpdate("completed", null, "not-a-number").actual_minutes).toBeUndefined();
  });

  it("accepts zero as a valid actual_minutes value", () => {
    const update = resolveTaskStatusUpdate("completed", null, "0");
    expect(update.actual_minutes).toBe(0);
  });
});
