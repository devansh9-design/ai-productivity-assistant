"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/require-user";
import { log } from "@/lib/log";
import { parseOnboarding, type OnboardingInput } from "@/lib/onboarding/wizard";
import { getTodayISODate } from "@/lib/tasks/timezone";

/**
 * Saves the onboarding wizard in one transaction (complete_onboarding).
 * Returns { error } for anything the student can fix; the wizard moves on to
 * Today only after { ok: true }.
 */
export async function completeOnboarding(input: OnboardingInput): Promise<{ ok: true } | { error: string }> {
  const { supabase, user } = await requireUser();

  let today: string;
  try {
    today = getTodayISODate(input.timeZone);
  } catch {
    return { error: "Choose your timezone." };
  }
  const parsed = parseOnboarding(input, today);
  if (!parsed.ok) return { error: parsed.error };

  const { payload } = parsed;
  const { error } = await supabase.rpc("complete_onboarding", {
    p_display_name: payload.displayName,
    p_college_year: payload.collegeYear,
    p_timezone: payload.timeZone,
    p_week: payload.week,
    p_goals: payload.goals.length ? payload.goals : null,
  });
  if (error) {
    log("error", "onboarding.save_failed", { userId: user.id, code: error.code, message: error.message });
    return { error: "Your setup could not be saved. Please try again." };
  }

  log("info", "onboarding.completed", { userId: user.id, rules: payload.week?.length ?? null, goals: payload.goals.length });
  revalidatePath("/", "layout");
  return { ok: true };
}
