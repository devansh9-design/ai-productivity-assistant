"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/require-user";
import { generateGeminiJson } from "@/lib/gemini";
import { formatDay } from "@/lib/analytics/format";
import { DEFAULT_TIMEZONE, getTodayISODate, TIMEZONE_COOKIE_NAME } from "@/lib/tasks/timezone";
import { loadOpenTasks, loadWeekFacts } from "@/lib/review/load";
import { parseWeeklyPlanForm } from "@/lib/review/plan-form";
import { buildSummaryPrompt, fallbackSummary, SUMMARY_RESPONSE_SCHEMA, validateAISummary, type WeeklySummary } from "@/lib/review/summary";
import { planningWeekFor, resolveReviewWeek } from "@/lib/review/week";

async function localToday() {
  const cookieTimeZone = (await cookies()).get(TIMEZONE_COOKIE_NAME)?.value || DEFAULT_TIMEZONE;
  let timeZone = DEFAULT_TIMEZONE;
  try { new Intl.DateTimeFormat("en-US", { timeZone: cookieTimeZone }); timeZone = cookieTimeZone; } catch { /* keep UTC */ }
  return { timeZone, today: getTodayISODate(timeZone) };
}

/**
 * Writes and stores the summary for one reviewed week. Nothing is sent to the
 * AI for an empty week. An AI answer is kept only if every reference checks
 * out; otherwise, or if the AI is unavailable, a code-written summary is saved
 * with the reason. Never touches plans, tasks, or Google Calendar.
 */
export async function generateWeeklySummary(formData: FormData) {
  const { supabase, user } = await requireUser();
  const { timeZone, today } = await localToday();
  const week = resolveReviewWeek(String(formData.get("week") ?? ""), today);

  let facts;
  try {
    facts = await loadWeekFacts(supabase, user.id, week, timeZone, today);
  } catch (error) {
    console.error("Weekly facts failed to load:", error instanceof Error ? error.message : error);
    return { error: "Could not load this week's data. Please try again." };
  }

  let summary: WeeklySummary;
  if (facts.isEmpty) {
    summary = fallbackSummary(facts, "Nothing was recorded this week, so the AI was not used.");
  } else {
    try {
      const checked = validateAISummary(await generateGeminiJson({ prompt: buildSummaryPrompt(facts), responseSchema: SUMMARY_RESPONSE_SCHEMA }), facts);
      summary = checked.ok ? checked.summary : fallbackSummary(facts, `The AI summary was not used: ${checked.reason}`);
    } catch (error) {
      console.error("Weekly summary AI call failed:", error instanceof Error ? error.message : error);
      summary = fallbackSummary(facts, "The AI service was unavailable, so this summary was written from your numbers.");
    }
  }

  const { error } = await supabase.rpc("save_weekly_review_summary", {
    p_review_week_start: week,
    p_source: summary.source,
    p_headline: summary.headline,
    p_suggestion: summary.suggestion,
    p_observations: summary.observations,
    p_fallback_reason: summary.fallbackReason,
    p_highlights: summary.highlights.map((item) => ({ task_id: item.taskId, note: item.note })),
  });
  if (error) return { error: `Could not save the summary: ${error.message}` };

  revalidatePath("/review");
  return {
    message: summary.source === "ai"
      ? "Summary generated and checked against your data."
      : `Summary written from your numbers. ${summary.fallbackReason}`,
  };
}

/**
 * Saves next week's priorities and shortlist in one transaction
 * (save_weekly_plan). The planning week always comes from today's date on the
 * server, never from an older review, and nothing is scheduled or published.
 */
export async function saveWeeklyPlan(formData: FormData) {
  const { supabase, user } = await requireUser();
  const { today } = await localToday();
  const planningWeek = planningWeekFor(today);
  if (String(formData.get("planning_week") ?? "") !== planningWeek) {
    return { error: "The planning week has changed since this page was loaded. Refresh the page and save again." };
  }
  const reviewWeek = resolveReviewWeek(String(formData.get("review_week") ?? ""), today);

  let selection;
  try {
    const openTasks = await loadOpenTasks(supabase, user.id);
    selection = parseWeeklyPlanForm(formData, new Set(openTasks.map((task) => task.id)));
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not read your choices." };
  }

  const { error } = await supabase.rpc("save_weekly_plan", {
    p_planning_week_start: planningWeek,
    p_review_week_start: reviewWeek,
    p_priorities: selection.priorities,
    p_shortlist: selection.shortlist,
  });
  if (error) return { error: `Could not save the plan for next week: ${error.message}` };

  revalidatePath("/review");
  revalidatePath("/today");
  revalidatePath("/tasks");
  return {
    message: `Saved for the week starting ${formatDay(planningWeek)}. Daily plans that week rank these priorities first; nothing is scheduled or published until you generate and confirm a plan.`,
  };
}
