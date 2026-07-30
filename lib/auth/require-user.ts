import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/**
 * Shared Server Action guard: resolves the current Supabase client + user,
 * redirecting to /login when there is no authenticated session.
 *
 * Centralizing this avoids drift between action files (goals, projects,
 * milestones, tasks) that previously each declared their own copy.
 */
export async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return { supabase, user };
}
