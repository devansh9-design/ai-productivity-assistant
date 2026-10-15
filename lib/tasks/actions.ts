"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/require-user";
import { resolveTaskStatusUpdate, stopsRunningTimer } from "@/lib/tasks/status-update";
import { buildTaskSchedulingMetadataUpdate } from "@/lib/tasks/scheduling-metadata";
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

export async function createTask(formData: FormData) {
  const { supabase, user } = await requireUser();
  const title = String(formData.get("title") ?? "").trim();
  if (!title) throw new Error("Title is required.");

  const priority = String(formData.get("priority") ?? "medium");
  const energyLevel = optionalText(formData, "energy_level");

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
    estimated_minutes: optionalMinutes(formData, "estimated_minutes"),
    due_date: optionalText(formData, "due_date"),
    goal_id: optionalText(formData, "goal_id"),
    project_id: optionalText(formData, "project_id"),
    milestone_id: optionalText(formData, "milestone_id"),
  });
  if (error) throw new Error(error.message);

  revalidatePath("/tasks");
  revalidatePath("/today");
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

  revalidatePath("/tasks");
  revalidatePath("/today");
}

export async function updateTaskSchedulingMetadata(formData: FormData) {
  const { supabase, user } = await requireUser();
  const id = String(formData.get("id") ?? "");
  if (!id) throw new Error("Missing task id.");

  const { error } = await supabase
    .from("tasks")
    .update(buildTaskSchedulingMetadataUpdate(formData))
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) throw new Error(error.message);

  revalidatePath("/tasks");
  revalidatePath("/today");
}

export async function deleteTask(formData: FormData) {
  const { supabase, user } = await requireUser();
  const id = String(formData.get("id") ?? "");
  if (!id) throw new Error("Missing task id.");

  const { error } = await supabase.from("tasks").delete().eq("id", id).eq("user_id", user.id);
  if (error) throw new Error(error.message);

  revalidatePath("/tasks");
  revalidatePath("/today");
}
