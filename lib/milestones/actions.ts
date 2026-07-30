"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/require-user";
import type { EntityStatus } from "@/lib/types";

const STATUSES: EntityStatus[] = ["active", "completed", "archived"];

export async function createMilestone(formData: FormData) {
  const { supabase, user } = await requireUser();
  const title = String(formData.get("title") ?? "").trim();
  if (!title) throw new Error("Title is required.");
  const description = String(formData.get("description") ?? "").trim() || null;
  const projectId = String(formData.get("project_id") ?? "").trim() || null;
  const dueDate = String(formData.get("due_date") ?? "").trim() || null;

  const { error } = await supabase.from("milestones").insert({
    user_id: user.id,
    title,
    description,
    project_id: projectId,
    due_date: dueDate,
  });
  if (error) throw new Error(error.message);

  revalidatePath("/milestones");
}

export async function updateMilestoneStatus(formData: FormData) {
  const { supabase, user } = await requireUser();
  const id = String(formData.get("id") ?? "");
  const status = String(formData.get("status") ?? "");
  if (!id || !STATUSES.includes(status as EntityStatus)) {
    throw new Error("Invalid milestone update.");
  }

  const { error } = await supabase
    .from("milestones")
    .update({ status })
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) throw new Error(error.message);

  revalidatePath("/milestones");
}

export async function deleteMilestone(formData: FormData) {
  const { supabase, user } = await requireUser();
  const id = String(formData.get("id") ?? "");
  if (!id) throw new Error("Missing milestone id.");

  const { error } = await supabase.from("milestones").delete().eq("id", id).eq("user_id", user.id);
  if (error) throw new Error(error.message);

  revalidatePath("/milestones");
}
