"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { EntityStatus } from "@/lib/types";

const STATUSES: EntityStatus[] = ["active", "completed", "archived"];

function requireTitle(formData: FormData) {
  const title = String(formData.get("title") ?? "").trim();
  if (!title) throw new Error("Title is required.");
  return title;
}

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return { supabase, user };
}

export async function createGoal(formData: FormData) {
  const { supabase, user } = await requireUser();
  const title = requireTitle(formData);
  const description = String(formData.get("description") ?? "").trim() || null;

  const { error } = await supabase.from("goals").insert({
    user_id: user.id,
    title,
    description,
  });
  if (error) throw new Error(error.message);

  revalidatePath("/goals");
}

export async function updateGoalStatus(formData: FormData) {
  const { supabase } = await requireUser();
  const id = String(formData.get("id") ?? "");
  const status = String(formData.get("status") ?? "");
  if (!id || !STATUSES.includes(status as EntityStatus)) {
    throw new Error("Invalid goal update.");
  }

  const { error } = await supabase.from("goals").update({ status }).eq("id", id);
  if (error) throw new Error(error.message);

  revalidatePath("/goals");
}

export async function deleteGoal(formData: FormData) {
  const { supabase } = await requireUser();
  const id = String(formData.get("id") ?? "");
  if (!id) throw new Error("Missing goal id.");

  const { error } = await supabase.from("goals").delete().eq("id", id);
  if (error) throw new Error(error.message);

  revalidatePath("/goals");
}
