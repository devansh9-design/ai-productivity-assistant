import { describe, expect, it } from "vitest";
import { filterTasks } from "./filters";
import type { Task } from "@/lib/types";

const NOW = new Date("2026-07-30T09:00:00");

function makeTask(overrides: Partial<Task>): Task {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    user_id: "user-1",
    goal_id: null,
    project_id: null,
    milestone_id: null,
    title: "Task",
    description: null,
    category: null,
    status: "todo",
    priority: "medium",
    estimated_minutes: null,
    actual_minutes: null,
    due_date: null,
    energy_level: null,
    created_at: NOW.toISOString(),
    updated_at: NOW.toISOString(),
    completed_at: null,
    ...overrides,
  };
}

describe("filterTasks", () => {
  const tasks: Task[] = [
    makeTask({ id: "no-date", due_date: null }),
    makeTask({ id: "today", due_date: "2026-07-30" }),
    makeTask({ id: "due-soon", due_date: "2026-08-01" }),
    makeTask({ id: "far-future", due_date: "2026-09-01" }),
    makeTask({ id: "overdue", due_date: "2026-07-20" }),
    makeTask({ id: "completed", due_date: "2026-07-20", status: "completed" }),
    makeTask({ id: "skipped", due_date: "2026-07-20", status: "skipped" }),
  ];

  it("inbox includes every open task regardless of date", () => {
    const result = filterTasks(tasks, "inbox", NOW).map((t) => t.id);
    expect(result).toEqual(["no-date", "today", "due-soon", "far-future", "overdue"]);
  });

  it("today includes only tasks due today", () => {
    const result = filterTasks(tasks, "today", NOW).map((t) => t.id);
    expect(result).toEqual(["today"]);
  });

  it("due-soon includes tasks due within the window, excluding today", () => {
    const result = filterTasks(tasks, "due-soon", NOW).map((t) => t.id);
    expect(result).toEqual(["due-soon"]);
  });

  it("overdue includes only open tasks with a past due date", () => {
    const result = filterTasks(tasks, "overdue", NOW).map((t) => t.id);
    expect(result).toEqual(["overdue"]);
  });

  it("completed includes completed tasks even with a past due date", () => {
    const result = filterTasks(tasks, "completed", NOW).map((t) => t.id);
    expect(result).toEqual(["completed"]);
  });

  it("skipped tasks are excluded from inbox, due windows, and completed", () => {
    const inbox = filterTasks(tasks, "inbox", NOW).map((t) => t.id);
    const completed = filterTasks(tasks, "completed", NOW).map((t) => t.id);
    expect(inbox).not.toContain("skipped");
    expect(completed).not.toContain("skipped");
  });
});
