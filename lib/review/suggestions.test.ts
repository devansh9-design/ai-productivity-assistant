import { describe, expect, it } from "vitest";
import type { SchedulerTask } from "@/lib/scheduler/engine";
import { suggestWeeklyPlan } from "@/lib/review/suggestions";

const task = (id: string, overrides: Partial<SchedulerTask> = {}): SchedulerTask => ({
  id, title: id, status: "todo", priority: "medium", urgency: 3, impact: 3, mustDo: false,
  dueDate: null, estimatedMinutes: 30, energyLevel: "medium", createdAt: "2026-10-01T00:00:00Z", ...overrides,
});

const planningWeek = "2026-10-19";

describe("suggestWeeklyPlan", () => {
  it("puts slipped and overdue work first, then the scheduler's ranking", () => {
    const tasks = [
      task("top-score", { urgency: 5, impact: 5 }),
      task("slipped"),
      task("overdue", { dueDate: "2026-10-16" }),
      task("next-week", { dueDate: "2026-10-20" }),
      task("plain"),
    ];
    const result = suggestWeeklyPlan(tasks, new Set(["slipped"]), planningWeek);
    expect(result.priorities).toEqual(["overdue", "slipped", "top-score"]);
    expect(result.shortlist).toEqual(["next-week", "plain"]);
  });

  it("only suggests open tasks, never the same task twice, and respects the limits", () => {
    const tasks = [
      task("done", { status: "completed" }),
      task("skipped", { status: "skipped" }),
      task("deferred", { status: "deferred" }),
      task("doing", { status: "in_progress" }),
      ...Array.from({ length: 12 }, (_, index) => task(`t${String(index).padStart(2, "0")}`)),
    ];
    const result = suggestWeeklyPlan(tasks, new Set(), planningWeek);
    const suggested = [...result.priorities, ...result.shortlist];
    expect(result.priorities).toHaveLength(3);
    expect(result.shortlist).toHaveLength(7);
    expect(new Set(suggested).size).toBe(suggested.length);
    expect(suggested).not.toContain("done");
    expect(suggested).not.toContain("skipped");
    expect(result.ranked.map((item) => item.id)).toEqual(expect.arrayContaining(["deferred", "doing"]));
  });

  it("returns empty suggestions when there are no open tasks", () => {
    expect(suggestWeeklyPlan([task("done", { status: "completed" })], new Set(), planningWeek)).toEqual({ priorities: [], shortlist: [], ranked: [] });
  });
});
