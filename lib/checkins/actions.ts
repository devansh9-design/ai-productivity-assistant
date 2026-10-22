"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/require-user";
import { resolveEveningLogInput } from "@/lib/evening/log";
import { loadEveningLog } from "@/lib/evening/load";
import { resolveMorningCheckinInput } from "@/lib/checkins/morning";
import { generateDraftPlan } from "@/lib/plans/actions";
import { TIMEZONE_COOKIE_NAME } from "@/lib/tasks/timezone";
import { DEFAULT_TIMEZONE, getTodayISODate } from "@/lib/tasks/timezone";

/**
 * Saves (or edits) today's evening log: what happened to each item, the day's
 * metric numbers, and the optional mood, lesson and note, all in one
 * transaction (save_evening_log). Only the tasks and metrics the log shows
 * can be written. Failures are returned, not thrown, so production builds
 * show the real message.
 */
export async function saveEveningLog(formData: FormData) {
  const { supabase } = await requireUser();
  const cookieStore = await cookies();
  const timeZone = cookieStore.get(TIMEZONE_COOKIE_NAME)?.value || DEFAULT_TIMEZONE;
  const todayISODate = getTodayISODate(timeZone);

  let input;
  try {
    const shown = await loadEveningLog(supabase, todayISODate, timeZone);
    input = resolveEveningLogInput(formData, { tasks: shown.tasks, metricIds: shown.metrics.map((metric) => metric.id) });
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Check the evening log and try again." };
  }

  const { error } = await supabase.rpc("save_evening_log", {
    p_date: todayISODate,
    p_items: input.items,
    p_metrics: input.metrics,
    p_evening: input.evening,
  });
  if (error) return { error: `Could not save the evening log: ${error.message}` };

  revalidatePath("/today");
  revalidatePath("/goals", "layout");
  const logged = input.items.length;
  const numbers = input.metrics.filter((metric) => metric.value !== null).length;
  return { message: `Evening log saved: ${logged} ${logged === 1 ? "item" : "items"} and ${numbers} ${numbers === 1 ? "number" : "numbers"}.` };
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
