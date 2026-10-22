"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/require-user";
import { generateGeminiJson } from "@/lib/gemini";
import { claimAIRequest, describeWait, type AIRequestClaim } from "@/lib/ai/rate-limit";
import {
  buildFeedbackPrompt, fallbackFeedback, FEEDBACK_RESPONSE_SCHEMA, parseStoredSuggestions, toStoredSuggestions, validateAIFeedback,
  type Feedback, type StoredSuggestion,
} from "@/lib/feedback/daily";
import { loadDayFacts } from "@/lib/feedback/load";
import { DEFAULT_TIMEZONE, TIMEZONE_COOKIE_NAME, addDaysToISODate, getTodayISODate } from "@/lib/tasks/timezone";
import type { DailyFeedback } from "@/lib/types";
import { errorFields, log } from "@/lib/log";

async function localToday() {
  const cookieTimeZone = (await cookies()).get(TIMEZONE_COOKIE_NAME)?.value || DEFAULT_TIMEZONE;
  let timeZone = DEFAULT_TIMEZONE;
  try { new Intl.DateTimeFormat("en-US", { timeZone: cookieTimeZone }); timeZone = cookieTimeZone; } catch { /* keep the default */ }
  return getTodayISODate(timeZone);
}

/**
 * Writes today's feedback after the evening log. The AI writes words only and
 * picks from changes the code offers; its answer is kept only if it passes
 * validateAIFeedback, otherwise (or if the AI is unavailable or over the
 * limit) a code-written note is saved. Proposals already applied or
 * dismissed keep their outcome. Never changes tasks, routines or plans.
 */
export async function generateDailyFeedback() {
  const { supabase, user } = await requireUser();
  const today = await localToday();

  let facts;
  let previous: StoredSuggestion[] = [];
  try {
    facts = await loadDayFacts(supabase, today);
    const { data, error } = await supabase.from("daily_feedback").select("suggestions").eq("feedback_date", today).maybeSingle<Pick<DailyFeedback, "suggestions">>();
    if (error) throw new Error(error.message);
    previous = parseStoredSuggestions(data?.suggestions);
  } catch (error) {
    log("error", "feedback.facts_failed", errorFields(error));
    return { error: "Could not load today's numbers for feedback. Please try again." };
  }

  let feedback: Feedback;
  if (facts.isEmpty) {
    feedback = fallbackFeedback(facts);
  } else {
    // Shares the AI chat's per-user limit; over it, the note is written from the numbers.
    let claim: AIRequestClaim;
    try {
      claim = await claimAIRequest(supabase);
    } catch (limitError) {
      log("error", "ai.rate_limit_check_failed", { userId: user.id, ...errorFields(limitError) });
      claim = { allowed: false, retryAfterSeconds: 0 };
    }
    if (!claim.allowed) {
      if (claim.retryAfterSeconds > 0) log("warn", "ai.rate_limited", { userId: user.id, retryAfterSeconds: claim.retryAfterSeconds, wait: describeWait(claim.retryAfterSeconds) });
      feedback = fallbackFeedback(facts);
    } else try {
      const checked = validateAIFeedback(await generateGeminiJson({ prompt: buildFeedbackPrompt(facts), responseSchema: FEEDBACK_RESPONSE_SCHEMA }), facts);
      if (!checked.ok) log("warn", "feedback.ai_rejected", { userId: user.id, reason: checked.reason });
      feedback = checked.ok ? checked.feedback : fallbackFeedback(facts);
    } catch (error) {
      log("error", "feedback.ai_failed", errorFields(error));
      feedback = fallbackFeedback(facts);
    }
  }

  const { error } = await supabase.from("daily_feedback").upsert({
    user_id: user.id,
    feedback_date: today,
    source: feedback.source,
    summary: feedback.summary,
    suggestions: toStoredSuggestions(feedback, facts, previous),
    generated_at: new Date().toISOString(),
  }, { onConflict: "user_id,feedback_date" });
  if (error) return { error: `Could not save today's feedback: ${error.message}` };

  revalidatePath("/today");
  return { message: feedback.source === "ai" ? "Feedback written and checked against your numbers." : "Feedback written from your numbers." };
}

async function loadSuggestion(formData: FormData) {
  const { supabase, user } = await requireUser();
  const today = await localToday();
  const id = String(formData.get("id") ?? "");
  const { data, error } = await supabase.from("daily_feedback").select("id,suggestions").eq("feedback_date", today).maybeSingle<Pick<DailyFeedback, "id" | "suggestions">>();
  if (error) return { error: `Could not load today's feedback: ${error.message}` } as const;
  if (!data) return { error: "Today's feedback is gone. Refresh the page." } as const;
  const suggestions = parseStoredSuggestions(data.suggestions);
  const suggestion = suggestions.find((item) => item.id === id);
  if (!suggestion) return { error: "That change is no longer offered. Refresh the page." } as const;
  if (suggestion.status !== "proposed") return { error: `That change was already ${suggestion.status}.` } as const;
  return { supabase, user, today, feedbackId: data.id, suggestions, suggestion } as const;
}

async function setStatus(context: Exclude<Awaited<ReturnType<typeof loadSuggestion>>, { error: string }>, status: "applied" | "dismissed") {
  const suggestions = context.suggestions.map((item) => (item.id === context.suggestion.id ? { ...item, status } : item));
  const { error } = await context.supabase.from("daily_feedback").update({ suggestions }).eq("id", context.feedbackId).eq("user_id", context.user.id);
  return error ? `Could not record the change: ${error.message}` : null;
}

/** Applies one proposal from today's feedback, after checking it still makes sense. */
export async function applyFeedbackSuggestion(formData: FormData) {
  const context = await loadSuggestion(formData);
  if ("error" in context) return { error: context.error };
  const { supabase, user, today, suggestion } = context;
  const tomorrow = addDaysToISODate(today, 1);

  if (suggestion.kind === "catch_up") {
    const { data: existing, error: existingError } = await supabase.from("tasks").select("id").eq("due_date", tomorrow).eq("title", suggestion.title).limit(1);
    if (existingError) return { error: existingError.message };
    if (!existing?.length) {
      const { error } = await supabase.from("tasks").insert({
        user_id: user.id,
        goal_id: suggestion.goalId,
        title: suggestion.title,
        description: "Extra session added from your daily feedback.",
        estimated_minutes: suggestion.minutes,
        due_date: tomorrow,
        priority: "medium",
      });
      if (error) return { error: `Could not add the session: ${error.message}` };
    }
  } else if (suggestion.kind === "move_to_tomorrow") {
    const { data, error } = await supabase.from("tasks").update({ due_date: tomorrow })
      .eq("id", suggestion.taskId).eq("user_id", user.id).in("status", ["todo", "in_progress"]).select("id");
    if (error) return { error: `Could not move the task: ${error.message}` };
    if (!data?.length) return { error: "That task is already done, skipped or deleted, so it was not moved." };
  } else {
    // Only if the routine still has the length the proposal was made for.
    const { data, error } = await supabase.from("routines").update({ minutes: suggestion.newMinutes })
      .eq("id", suggestion.routineId).eq("user_id", user.id).eq("minutes", suggestion.minutes).select("id");
    if (error) return { error: `Could not change the routine: ${error.message}` };
    if (!data?.length) return { error: "The routine has changed or been deleted since this was suggested, so it was left as it is." };
  }

  const statusError = await setStatus(context, "applied");
  if (statusError) return { error: statusError };
  revalidatePath("/today");
  revalidatePath("/goals", "layout");
  return { message: "Applied." };
}

/** Marks one proposal from today's feedback as dismissed; nothing else changes. */
export async function dismissFeedbackSuggestion(formData: FormData) {
  const context = await loadSuggestion(formData);
  if ("error" in context) return { error: context.error };
  const statusError = await setStatus(context, "dismissed");
  if (statusError) return { error: statusError };
  revalidatePath("/today");
  return { message: "Dismissed." };
}
