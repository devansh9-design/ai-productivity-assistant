import type { Task } from "@/lib/types";
import { addDaysToISODate } from "@/lib/tasks/timezone";

export const TASK_FILTERS = ["inbox", "today", "due-soon", "overdue", "completed"] as const;
export type TaskFilter = (typeof TASK_FILTERS)[number];

export const DEFAULT_TASK_FILTER: TaskFilter = "inbox";

export function isTaskFilter(value: string | null | undefined): value is TaskFilter {
  return !!value && (TASK_FILTERS as readonly string[]).includes(value);
}

const DUE_SOON_WINDOW_DAYS = 3;

/**
 * Applies the Today workflow's filter semantics to a list of tasks.
 * - inbox: everything not completed or skipped, regardless of date.
 * - today: open tasks due today.
 * - due-soon: open tasks due within the next few days (excludes today/overdue).
 * - overdue: open tasks whose due date has passed.
 * - completed: tasks marked completed.
 *
 * `todayISODate` must be a YYYY-MM-DD string representing "today" in the
 * *user's* timezone (see lib/tasks/timezone.ts) — never a `Date` object.
 * `due_date` is already stored as a YYYY-MM-DD string, so every comparison
 * here is a plain string comparison. ISO-formatted date strings of equal
 * length compare correctly with standard `<`/`>`/`===`, which sidesteps the
 * server-local-timezone bugs that `new Date(...)` wall-clock construction
 * introduced (a task due "today" could show as tomorrow or yesterday
 * depending on where the server process happened to be running).
 */
export function filterTasks(tasks: Task[], filter: TaskFilter, todayISODate: string): Task[] {
  const dueSoonCutoff = addDaysToISODate(todayISODate, DUE_SOON_WINDOW_DAYS);

  return tasks.filter((task) => {
    const isOpen = task.status !== "completed" && task.status !== "skipped";
    const dueDate = task.due_date;

    switch (filter) {
      case "inbox":
        return isOpen;
      case "completed":
        return task.status === "completed";
      case "today":
        return isOpen && !!dueDate && dueDate === todayISODate;
      case "overdue":
        return isOpen && !!dueDate && dueDate < todayISODate;
      case "due-soon":
        return isOpen && !!dueDate && dueDate > todayISODate && dueDate <= dueSoonCutoff;
      default:
        return true;
    }
  });
}
