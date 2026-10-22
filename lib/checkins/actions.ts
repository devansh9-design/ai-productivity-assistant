"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/require-user";
import { resolveCheckinInput } from "@/lib/checkins/validate";
import { resolveMorningCheckinInput } from "@/lib/checkins/morning";
import { generateDraftPlan } from "@/lib/plans/actions";
import { TIMEZONE_COOKIE_NAME } from "@/lib/tasks/timezone";
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

/**
 * Saves (or edits) today's morning check-in, then generates today's plan from
 * it. A special event (exam, travel) becomes a fixed commitment so the plan
 * keeps clear of it; re-sending the same form, as the "plan without my
 * calendar" retry does, never adds it twice. Failures are returned, not
 * thrown, so production builds show the real message.
 */
export async function saveMorningCheckin(formData: FormData) {
  const { supabase, user } = await requireUser();
  let input;
  try { input = resolveMorningCheckinInput(formData); }
  catch (error) { return { error: error instanceof Error ? error.message : "Check the morning check-in and try again." }; }

  const cookieStore = await cookies();
  const timeZone = cookieStore.get(TIMEZONE_COOKIE_NAME)?.value || DEFAULT_TIMEZONE;
  const todayISODate = getTodayISODate(timeZone);

  const { error: checkinError } = await supabase.from("checkins").upsert(
    {
      user_id: user.id,
      checkin_date: todayISODate,
      type: "morning",
      available_minutes: input.available_minutes,
      energy_level: input.energy_level,
      notes: input.notes,
    },
    { onConflict: "user_id,checkin_date,type" },
  );
  if (checkinError) return { error: `Could not save the check-in: ${checkinError.message}` };

  if (input.event) {
    const { data: existing, error: existingError } = await supabase
      .from("fixed_commitments")
      .select("id")
      .eq("commitment_date", todayISODate)
      .eq("title", input.event.title)
      .eq("start_time", input.event.startTime)
      .eq("end_time", input.event.endTime)
      .limit(1);
    if (existingError) return { error: `Could not save the event: ${existingError.message}` };
    if (!existing || existing.length === 0) {
      const { error: eventError } = await supabase.from("fixed_commitments").insert({
        user_id: user.id,
        title: input.event.title,
        commitment_date: todayISODate,
        start_time: input.event.startTime,
        end_time: input.event.endTime,
      });
      if (eventError) return { error: `Could not save the event: ${eventError.message}` };
    }
  }

  revalidatePath("/today");
  return generateDraftPlan(formData);
}
