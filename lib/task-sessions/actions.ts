"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/require-user";
import type { TaskSession } from "@/lib/types";

export async function startTaskSession(formData: FormData): Promise<TaskSession> {
  const { supabase, user } = await requireUser();
  const taskId = String(formData.get("task_id") ?? "");
  if (!taskId) throw new Error("Missing task id.");

  const { data, error } = await supabase
    .from("task_sessions")
    .insert({ user_id: user.id, task_id: taskId })
    .select()
    .single<TaskSession>();
  if (error) throw new Error(error.message);

  revalidatePath("/today");
  return data;
}

export async function stopTaskSession(formData: FormData): Promise<TaskSession> {
  const { supabase } = await requireUser();
  const sessionId = String(formData.get("session_id") ?? "");
  if (!sessionId) throw new Error("Missing task session id.");

  const { data, error } = await supabase
    .rpc("stop_task_session", { p_task_session_id: sessionId })
    .single<TaskSession>();
  if (error) throw new Error(error.message);

  revalidatePath("/today");
  return data;
}
