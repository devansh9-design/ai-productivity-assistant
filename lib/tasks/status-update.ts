import type { TaskStatus } from "@/lib/types";

export const TASK_STATUSES: TaskStatus[] = ["todo", "in_progress", "completed", "skipped", "deferred"];

export interface TaskStatusUpdate {
  status: TaskStatus;
  status_reason: string | null;
  actual_minutes?: number | null;
}

/**
 * Validates a proposed task status transition and produces the exact
 * database update. Kept separate from updateTaskStatus (the Server Action)
 * so this logic — the actual business rule Day 3 cares about — can be unit
 * tested directly instead of only indirectly through a mocked Supabase
 * client.
 *
 * Rules:
 * - status must be one of the known TaskStatus values.
 * - skipping or deferring requires a non-empty reason.
 * - any other transition clears status_reason, so a reopened or completed
 *   task never keeps showing a stale skip/defer explanation.
 * - actual_minutes, when present, must be a non-negative integer.
 */
export function resolveTaskStatusUpdate(
  status: string,
  reason: string | null,
  actualMinutesRaw: string | null,
): TaskStatusUpdate {
  if (!TASK_STATUSES.includes(status as TaskStatus)) {
    throw new Error("Invalid task status.");
  }
  const typedStatus = status as TaskStatus;

  const trimmedReason = reason?.trim() || null;
  if ((typedStatus === "skipped" || typedStatus === "deferred") && !trimmedReason) {
    throw new Error("A reason is required to skip or defer a task.");
  }

  const update: TaskStatusUpdate = {
    status: typedStatus,
    status_reason: typedStatus === "skipped" || typedStatus === "deferred" ? trimmedReason : null,
  };

  const trimmedMinutes = actualMinutesRaw?.trim();
  if (trimmedMinutes) {
    const parsed = Number.parseInt(trimmedMinutes, 10);
    if (Number.isFinite(parsed) && parsed >= 0) {
      update.actual_minutes = parsed;
    }
  }

  return update;
}
