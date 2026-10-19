"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/require-user";
import { saveCalendarSwitches } from "@/lib/integrations/status";

/**
 * Saves the Google Calendar pause switches. The planning and publishing
 * actions read them from the database on every call, so a change applies at
 * once, including to pages opened before it.
 */
export async function updateCalendarSwitches(formData: FormData) {
  const { supabase, user } = await requireUser();
  const planningEnabled = formData.get("planning_enabled") === "on";
  const publishingEnabled = formData.get("publishing_enabled") === "on";
  try {
    await saveCalendarSwitches(supabase, user.id, { planningEnabled, publishingEnabled });
  } catch (saveError) {
    return { error: saveError instanceof Error ? saveError.message : "Your Google Calendar settings could not be saved." };
  }
  revalidatePath("/settings");
  revalidatePath("/today");
  const reading = planningEnabled ? "Plans will check your calendar events" : "Plans will not read your calendar";
  const publishing = publishingEnabled ? "confirmed plans will be published to AI Planner" : "confirmed plans will not be published";
  return { message: `Saved. ${reading}, and ${publishing}.` };
}
