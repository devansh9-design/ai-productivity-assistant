"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { TaskPriority, TaskStatus, EnergyLevel } from "@/lib/types";

const STATUSES: TaskStatus[] = ["todo", "in_progress", "completed", "skipped", "deferred"];
const PRIORITIES: TaskPriority[] = ["low", "medium", "high", "urgent"];
const ENERGY_LEVELS: EnergyLevel[] = ["low", "medium", "high"];

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return { supabase, user };
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
  const { supabase } = await requireUser();
  const id = String(formData.get("id") ?? "");
  const status = String(formData.get("status") ?? "");
  if (!id || !STATUSES.includes(status as TaskStatus)) {
    throw new Error("Invalid task status.");
  }

  const update: { status: TaskStatus; actual_minutes?: number | null } = {
    status: status as TaskStatus,
  };
  const actualMinutes = optionalMinutes(formData, "actual_minutes");
  if (actualMinutes !== null) update.actual_minutes = actualMinutes;

  const { error } = await supabase.from("tasks").update(update).eq("id", id);
  if (error) throw new Error(error.message);

  revalidatePath("/tasks");
  revalidatePath("/today");
}

export async function deleteTask(formData: FormData) {
  const { supabase } = await requireUser();
  const id = String(formData.get("id") ?? "");
  if (!id) throw new Error("Missing task id.");

  const { error } = await supabase.from("tasks").delete().eq("id", id);
  if (error) throw new Error(error.message);

  revalidatePath("/tasks");
  revalidatePath("/today");
}
