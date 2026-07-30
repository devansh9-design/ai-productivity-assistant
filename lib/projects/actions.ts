"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { EntityStatus } from "@/lib/types";

const STATUSES: EntityStatus[] = ["active", "completed", "archived"];

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return { supabase, user };
}

export async function createProject(formData: FormData) {
  const { supabase, user } = await requireUser();
  const title = String(formData.get("title") ?? "").trim();
  if (!title) throw new Error("Title is required.");
  const description = String(formData.get("description") ?? "").trim() || null;
  const goalId = String(formData.get("goal_id") ?? "").trim() || null;

  const { error } = await supabase.from("projects").insert({
    user_id: user.id,
    title,
    description,
    goal_id: goalId,
  });
  if (error) throw new Error(error.message);

  revalidatePath("/projects");
}

export async function updateProjectStatus(formData: FormData) {
  const { supabase } = await requireUser();
  const id = String(formData.get("id") ?? "");
  const status = String(formData.get("status") ?? "");
  if (!id || !STATUSES.includes(status as EntityStatus)) {
    throw new Error("Invalid project update.");
  }

  const { error } = await supabase.from("projects").update({ status }).eq("id", id);
  if (error) throw new Error(error.message);

  revalidatePath("/projects");
}

export async function deleteProject(formData: FormData) {
  const { supabase } = await requireUser();
  const id = String(formData.get("id") ?? "");
  if (!id) throw new Error("Missing project id.");

  const { error } = await supabase.from("projects").delete().eq("id", id);
  if (error) throw new Error(error.message);

  revalidatePath("/projects");
}
