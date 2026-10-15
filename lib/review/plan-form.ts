import { MAX_PRIORITIES, MAX_SHORTLIST } from "@/lib/review/suggestions";

export type PriorityChoice = { task_id: string } | { new_title: string };

export interface WeeklyPlanSelection {
  priorities: PriorityChoice[];
  shortlist: Array<{ task_id: string }>;
}

const MAX_TITLE_LENGTH = 200;

function text(formData: Pick<FormData, "get">, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

/**
 * Validates the next-week form. Each priority slot takes an existing open task
 * or a new title (not both; an empty slot is skipped). Every chosen task must
 * be one of `openTaskIds`, and no task may be chosen twice. Throws a
 * user-facing message on invalid input.
 */
export function parseWeeklyPlanForm(formData: Pick<FormData, "get" | "getAll">, openTaskIds: ReadonlySet<string>): WeeklyPlanSelection {
  const chosen = new Set<string>();
  const claimTask = (taskId: string) => {
    if (!openTaskIds.has(taskId)) throw new Error("One of the chosen tasks is no longer open. Refresh the page and choose again.");
    if (chosen.has(taskId)) throw new Error("A task can only be chosen once, as a priority or on the shortlist.");
    chosen.add(taskId);
    return { task_id: taskId };
  };

  const priorities: PriorityChoice[] = [];
  for (let slot = 1; slot <= MAX_PRIORITIES; slot += 1) {
    const taskId = text(formData, `priority_${slot}_task`);
    const newTitle = text(formData, `priority_${slot}_new`);
    if (taskId && newTitle) throw new Error(`Priority ${slot}: choose a task or type a new title, not both.`);
    if (newTitle.length > MAX_TITLE_LENGTH) throw new Error(`Priority ${slot}: the new task title must be at most ${MAX_TITLE_LENGTH} characters.`);
    if (taskId) priorities.push(claimTask(taskId));
    else if (newTitle) priorities.push({ new_title: newTitle });
  }

  const shortlistIds = formData.getAll("shortlist").map(String).filter(Boolean);
  if (shortlistIds.length > MAX_SHORTLIST) throw new Error(`Choose at most ${MAX_SHORTLIST} shortlist tasks.`);
  return { priorities, shortlist: shortlistIds.map(claimTask) };
}
