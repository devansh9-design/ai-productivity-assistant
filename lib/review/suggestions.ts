import { scoreTask, type SchedulerTask } from "@/lib/scheduler/engine";

export const MAX_PRIORITIES = 3;
export const MAX_SHORTLIST = 7;
const OPEN_STATUSES = new Set(["todo", "in_progress", "deferred"]);

export interface WeeklySuggestion {
  /** Suggested priorities, best first (at most three). */
  priorities: string[];
  /** Suggested shortlist, after the priorities (at most seven). */
  shortlist: string[];
  /** Every open task in suggestion order, for the pickers. */
  ranked: SchedulerTask[];
}

/**
 * Deterministic next-week suggestions; the AI is not involved. Open tasks
 * that slipped in the reviewed week or are overdue by the start of the
 * planning week come first, then the scheduler's own ranking for that week.
 */
export function suggestWeeklyPlan(tasks: SchedulerTask[], slippedTaskIds: ReadonlySet<string>, planningWeekStart: string): WeeklySuggestion {
  const needsAttention = (task: SchedulerTask) =>
    slippedTaskIds.has(task.id) || (task.dueDate !== null && task.dueDate < planningWeekStart);

  const ranked = tasks
    .filter((task) => OPEN_STATUSES.has(task.status))
    .sort((a, b) =>
      Number(needsAttention(b)) - Number(needsAttention(a))
      || scoreTask(b, planningWeekStart) - scoreTask(a, planningWeekStart)
      || (a.dueDate ?? "9999-12-31").localeCompare(b.dueDate ?? "9999-12-31")
      || a.createdAt.localeCompare(b.createdAt)
      || a.id.localeCompare(b.id));

  const ids = ranked.map((task) => task.id);
  return {
    priorities: ids.slice(0, MAX_PRIORITIES),
    shortlist: ids.slice(MAX_PRIORITIES, MAX_PRIORITIES + MAX_SHORTLIST),
    ranked,
  };
}
