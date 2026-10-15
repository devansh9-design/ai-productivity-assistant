"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/require-user";
import { parsePlanningPreferencesForm } from "@/lib/preferences/preferences";

export async function savePlanningPreferences(formData: FormData) {
  const { supabase, user } = await requireUser();
  let values;
  try {
    values = parsePlanningPreferencesForm(formData);
  } catch (validationError) {
    return { error: validationError instanceof Error ? validationError.message : "Invalid preferences." };
  }

  const { error } = await supabase.from("planning_preferences").upsert(
    {
      user_id: user.id,
      buffer_percent: values.bufferPercent,
      low_energy_max_block_minutes: values.lowEnergyMaxBlockMinutes,
      adapt_to_actual_durations: values.adaptToActualDurations,
    },
    { onConflict: "user_id" },
  );
  if (error) return { error: `Could not save preferences: ${error.message}` };

  revalidatePath("/settings");
  revalidatePath("/today");
  return { message: "Preferences saved. They apply to the next plan you generate or replan." };
}
