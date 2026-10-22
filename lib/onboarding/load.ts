import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { log } from "@/lib/log";
import type { StudentProfile } from "@/lib/types";

/** Whether the student has finished onboarding; read on every signed-in page load. */
export async function isOnboarded(supabase: SupabaseClient, userId: string): Promise<boolean> {
  const { data, error } = await supabase.from("profiles").select("onboarded_at").eq("id", userId).maybeSingle<{ onboarded_at: string | null }>();
  if (error) {
    // Never trap a student in the wizard because of a read error; the page itself will report problems.
    log("error", "onboarding.status_failed", { userId, message: error.message });
    return true;
  }
  return Boolean(data?.onboarded_at);
}

/** What the wizard needs to prefill, so re-running it from Settings starts from the saved setup. */
export async function loadOnboardingState(supabase: SupabaseClient, userId: string) {
  const [profile, rules] = await Promise.all([
    supabase.from("profiles").select("id,email,display_name,college_year,timezone,onboarded_at").eq("id", userId).maybeSingle<StudentProfile>(),
    supabase.from("availability_rules").select("weekday,kind,start_time,end_time").eq("user_id", userId).in("kind", ["class", "working"])
      .returns<Array<{ weekday: number; kind: string; start_time: string; end_time: string }>>(),
  ]);
  if (profile.error || rules.error) {
    log("error", "onboarding.load_failed", { userId, message: (profile.error ?? rules.error)?.message });
    throw new Error("Your profile could not be loaded. Please refresh the page.");
  }
  return { profile: profile.data, rules: rules.data ?? [] };
}
