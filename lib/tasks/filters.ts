import type { Task } from "@/lib/types";

export const TASK_FILTERS = ["inbox", "today", "due-soon", "overdue", "completed"] as const;
export type TaskFilter = (typeof TASK_FILTERS)[number];

export const DEFAULT_TASK_FILTER: TaskFilter = "inbox";

export function isTaskFilter(value: string | null | undefined): value is TaskFilter {
  return !!value && (TASK_FILTERS as readonly string[]).includes(value);
}

const DUE_SOON_WINDOW_DAYS = 3;

function toDateOnly(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function parseDueDate(dueDate: string | null): Date | null {
  if (!dueDate) return null;
  const parsed = new Date(`${dueDate}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Applies the Today workflow's filter semantics to a list of tasks.
 * - inbox: everything not completed or skipped, regardless of date.
 * - today: open tasks due today.
 * - due-soon: open tasks due within the next few days (excludes today/overdue).
 * - overdue: open tasks whose due date has passed.
 * - completed: tasks marked completed.
 */
export function filterTasks(tasks: Task[], filter: TaskFilter, now: Date = new Date()): Task[] {
  const today = toDateOnly(now);
  const dueSoonCutoff = new Date(today);
  dueSoonCutoff.setDate(dueSoonCutoff.getDate() + DUE_SOON_WINDOW_DAYS);

  return tasks.filter((task) => {
    const isOpen = task.status !== "completed" && task.status !== "skipped";
    const dueDate = parseDueDate(task.due_date);

    switch (filter) {
      case "inbox":
        return isOpen;
      case "completed":
        return task.status === "completed";
      case "today":
        return isOpen && !!dueDate && dueDate.getTime() === today.getTime();
      case "overdue":
        return isOpen && !!dueDate && dueDate.getTime() < today.getTime();
      case "due-soon":
        return (
          isOpen &&
          !!dueDate &&
          dueDate.getTime() > today.getTime() &&
          dueDate.getTime() <= dueSoonCutoff.getTime()
        );
      default:
        return true;
    }
  });
}
