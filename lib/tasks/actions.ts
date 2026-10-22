"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/require-user";
import { resolveTaskStatusUpdate, stopsRunningTimer } from "@/lib/tasks/status-update";
import { isValidISODate } from "@/lib/tasks/date-validation";
import type { TaskPriority, EnergyLevel } from "@/lib/types";

const PRIORITIES: TaskPriority[] = ["low", "medium", "high", "urgent"];
const ENERGY_LEVELS: EnergyLevel[] = ["low", "medium", "high"];

function scoreValue(formData: FormData, key: string) {
  const parsed = Number.parseInt(String(formData.get(key) ?? ""), 10);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 5 ? parsed : 3;
}

function optionalText(formData: FormData, key: string) {
  const value = String(formData.get(key) ?? "").trim();
  return value || null;
}

function optionalMinutes(formData: FormData, key: string) {
  const raw = String(formData.get(key) ?? "").trim();
  if (!raw) return null;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

/**
 * Adds a one-off task from Today's "Add a task" form (title, goal, time
 * estimate, priority, must do, due date). Errors are returned, not thrown, so
 * production builds show the real message.
 */
export async function createTask(formData: FormData) {
  const { supabase, user } = await requireUser();
  const title = String(formData.get("title") ?? "").trim();
  if (!title) return { error: "Give the task a title." };
  if (title.length > 200) return { error: "Keep the title to 200 characters or fewer." };

  const priority = String(formData.get("priority") ?? "medium");
  const energyLevel = optionalText(formData, "energy_level");
  const estimateRaw = optionalText(formData, "estimated_minutes");
  const estimatedMinutes = optionalMinutes(formData, "estimated_minutes");
  if (estimateRaw && (estimatedMinutes === null || estimatedMinutes < 1 || estimatedMinutes > 1440)) {
    return { error: "The time estimate must be a whole number of minutes between 1 and 1440." };
  }
  const dueDate = optionalText(formData, "due_date");
  if (dueDate && !isValidISODate(dueDate)) return { error: "Choose a valid due date." };

  const { error } = await supabase.from("tasks").insert({
    user_id: user.id,
    title,
    description: optionalText(formData, "description"),
    category: optionalText(formData, "category"),
    priority: PRIORITIES.includes(priority as TaskPriority) ? priority : "medium",
    urgency: scoreValue(formData, "urgency"),
    impact: scoreValue(formData, "impact"),
    must_do: formData.get("must_do") === "on",
    energy_level:
      energyLevel && ENERGY_LEVELS.includes(energyLevel as EnergyLevel) ? energyLevel : null,
    estimated_minutes: estimatedMinutes,
    due_date: dueDate,
    goal_id: optionalText(formData, "goal_id"),
  });
  if (error) return { error: `Could not add the task: ${error.message}` };

  revalidatePath("/today");
  revalidatePath("/week");
  revalidatePath("/month");
  return { message: `Added "${title}".` };
}

export async function updateTaskStatus(formData: FormData) {
  const { supabase, user } = await requireUser();
  const id = String(formData.get("id") ?? "");
  if (!id) throw new Error("Missing task id.");

  const status = String(formData.get("status") ?? "");
  const reason = optionalText(formData, "reason");
  const actualMinutesRaw = formData.get("actual_minutes");
  const update = resolveTaskStatusUpdate(
    status,
    reason,
    actualMinutesRaw === null ? null : String(actualMinutesRaw),
  );

  // Stop running timers first so their time ends when the work ended. If this
  // fails, the status is left unchanged and the user can simply try again.
  if (stopsRunningTimer(update.status)) {
    const { data: openSessions, error: sessionsError } = await supabase
      .from("task_sessions")
      .select("id")
      .eq("task_id", id)
      .eq("user_id", user.id)
      .is("ended_at", null);
    if (sessionsError) throw new Error(sessionsError.message);
    for (const session of openSessions ?? []) {
      const { error: stopError } = await supabase.rpc("stop_task_session", { p_task_session_id: session.id });
      if (stopError) throw new Error(`Could not stop the running timer: ${stopError.message}`);
    }
  }

  const { error } = await supabase.from("tasks").update(update).eq("id", id).eq("user_id", user.id);
  if (error) throw new Error(error.message);

  revalidatePath("/today");
}

/**
 * Deletes a one-off task from Today, after the student confirms. A routine's
 * session is skipped instead, because deleting it would only let the routine
 * create it again. Errors are returned, not thrown, so production shows them.
 */
export async function deleteTask(formData: FormData) {
  const { supabase, user } = await requireUser();
  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "Missing task id." };

  const { data: task, error: readError } = await supabase.from("tasks").select("routine_id").eq("id", id).eq("user_id", user.id).maybeSingle<{ routine_id: string | null }>();
  if (readError) return { error: `Could not delete the task: ${readError.message}` };
  if (!task) return { error: "That task no longer exists. Refresh the page." };
  const { error } = task.routine_id
    ? await supabase.from("tasks").update({ status: "skipped", status_reason: "Skipped this session of the routine." }).eq("id", id).eq("user_id", user.id)
    : await supabase.from("tasks").delete().eq("id", id).eq("user_id", user.id);
  if (error) return { error: `Could not delete the task: ${error.message}` };

  revalidatePath("/today");
  revalidatePath("/week");
  revalidatePath("/month");
  return { message: task.routine_id ? "Skipped this session of the routine." : "Task deleted." };
}
