"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/require-user";
import { resolveCheckinInput } from "@/lib/checkins/validate";
import { TIMEZONE_COOKIE_NAME } from "@/components/timezone-sync";
import { DEFAULT_TIMEZONE, getTodayISODate } from "@/lib/tasks/timezone";

/**
 * Saves (or edits, if one already exists) today's evening check-in.
 * Structured signals go to checkins; the free-text reflection goes to
 * journal_entries. Both are upserted on the user's local calendar date so
 * re-submitting the form the same evening edits today's entry instead of
 * creating a duplicate.
 */
export async function saveEveningCheckin(formData: FormData) {
  const { supabase, user } = await requireUser();
  const input = resolveCheckinInput(formData);

  const cookieStore = await cookies();
  const timeZone = cookieStore.get(TIMEZONE_COOKIE_NAME)?.value || DEFAULT_TIMEZONE;
  const todayISODate = getTodayISODate(timeZone);

  const { data: checkin, error: checkinError } = await supabase
    .from("checkins")
    .upsert(
      {
        user_id: user.id,
        checkin_date: todayISODate,
        type: "evening",
        mood: input.mood,
        energy_level: input.energy_level,
        distractions: input.distractions,
        wins: input.wins,
        lesson: input.lesson,
      },
      { onConflict: "user_id,checkin_date,type" },
    )
    .select()
    .single();
  if (checkinError) throw new Error(checkinError.message);

  const { error: journalError } = await supabase.from("journal_entries").upsert(
    {
      user_id: user.id,
      entry_date: todayISODate,
      checkin_id: checkin.id,
      reflection: input.reflection,
    },
    { onConflict: "user_id,entry_date" },
  );
  if (journalError) throw new Error(journalError.message);

  revalidatePath("/today");
}
