import { describe, expect, it } from "vitest";
import { parseWeeklyPlanForm } from "@/lib/review/plan-form";

const open = new Set(["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"]);

function form(fields: Record<string, string>, shortlist: string[] = []) {
  return {
    get: (key: string) => fields[key] ?? null,
    getAll: (key: string) => (key === "shortlist" ? shortlist : []),
  };
}

describe("parseWeeklyPlanForm", () => {
  it("reads existing tasks and new titles in slot order, skipping empty slots", () => {
    expect(parseWeeklyPlanForm(form({ priority_1_task: "a", priority_2_new: "  Write the cover letter  ", priority_3_task: "" }, ["b", "c"]), open)).toEqual({
      priorities: [{ task_id: "a" }, { new_title: "Write the cover letter" }],
      shortlist: [{ task_id: "b" }, { task_id: "c" }],
    });
    expect(parseWeeklyPlanForm(form({}), open)).toEqual({ priorities: [], shortlist: [] });
  });

  it("rejects a slot with both a task and a new title", () => {
    expect(() => parseWeeklyPlanForm(form({ priority_2_task: "a", priority_2_new: "Also this" }), open)).toThrow("Priority 2: choose a task or type a new title, not both.");
  });

  it("rejects duplicates, across priorities and the shortlist", () => {
    expect(() => parseWeeklyPlanForm(form({ priority_1_task: "a", priority_2_task: "a" }), open)).toThrow("only be chosen once");
    expect(() => parseWeeklyPlanForm(form({ priority_1_task: "a" }, ["a"]), open)).toThrow("only be chosen once");
  });

  it("rejects tasks that are not currently open, including another user's", () => {
    expect(() => parseWeeklyPlanForm(form({ priority_1_task: "someone-elses-task" }), open)).toThrow("no longer open");
    expect(() => parseWeeklyPlanForm(form({}, ["completed-task"]), open)).toThrow("no longer open");
  });

  it("enforces the shortlist limit and the title length", () => {
    expect(() => parseWeeklyPlanForm(form({}, ["a", "b", "c", "d", "e", "f", "g", "h"]), open)).toThrow("at most 7");
    expect(() => parseWeeklyPlanForm(form({ priority_1_new: "x".repeat(201) }), open)).toThrow("at most 200 characters");
  });
});
