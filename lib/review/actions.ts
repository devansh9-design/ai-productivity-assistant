"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/require-user";
import { generateGeminiJson } from "@/lib/gemini";
import { formatDay, plural } from "@/lib/analytics/format";
import { DEFAULT_TIMEZONE, getTodayISODate, TIMEZONE_COOKIE_NAME } from "@/lib/tasks/timezone";
import { loadOpenTasks, loadWeekFacts } from "@/lib/review/load";
import { parseWeeklyPlanForm } from "@/lib/review/plan-form";
import { buildSummaryPrompt, fallbackSummary, SUMMARY_RESPONSE_SCHEMA, validateAISummary, type WeeklySummary } from "@/lib/review/summary";
import { planningWeekFor, resolveReviewWeek } from "@/lib/review/week";
import { errorFields, log } from "@/lib/log";
import { claimAIRequest, describeWait, type AIRequestClaim } from "@/lib/ai/rate-limit";
import { buildTargetsPrompt, parseTargetsPayload, proposeTargets, TARGETS_RESPONSE_SCHEMA, validateAITargets, type GoalPlanning, type TargetProposal } from "@/lib/review/targets";
import { loadTargetPlanning } from "@/lib/review/targets-load";

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
    log("error", "review.facts_failed", errorFields(error));
    return { error: "Could not load this week's data. Please try again." };
  }

  let summary: WeeklySummary;
  if (facts.isEmpty) {
    summary = fallbackSummary(facts, "Nothing was recorded this week, so the AI was not used.");
  } else {
    // Shares the AI chat's per-user limit; over it, the summary is written from the numbers.
    let claim: AIRequestClaim;
    try {
      claim = await claimAIRequest(supabase);
    } catch (limitError) {
      log("error", "ai.rate_limit_check_failed", { userId: user.id, ...errorFields(limitError) });
      claim = { allowed: false, retryAfterSeconds: 0 };
    }
    if (!claim.allowed) {
      if (claim.retryAfterSeconds > 0) log("warn", "ai.rate_limited", { userId: user.id, retryAfterSeconds: claim.retryAfterSeconds });
      summary = fallbackSummary(facts, claim.retryAfterSeconds > 0
        ? `The AI request limit was reached, so this summary was written from your numbers. The AI can be used again in ${describeWait(claim.retryAfterSeconds)}.`
        : "The AI service was unavailable, so this summary was written from your numbers.");
    } else try {
      const checked = validateAISummary(await generateGeminiJson({ prompt: buildSummaryPrompt(facts), responseSchema: SUMMARY_RESPONSE_SCHEMA }), facts);
      summary = checked.ok ? checked.summary : fallbackSummary(facts, `The AI summary was not used: ${checked.reason}`);
    } catch (error) {
      log("error", "review.summary_ai_failed", errorFields(error));
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
  return {
    message: `Saved for the week starting ${formatDay(planningWeek)}. Daily plans that week rank these priorities first; nothing is scheduled or published until you generate and confirm a plan.`,
  };
}

/**
 * Asks the AI to propose next week's targets for every goal that has none
 * yet. Nothing is saved: the proposals fill the form for the student to edit.
 * An answer outside validateAITargets' bounds, or no AI at all, leaves
 * code's proposals in place with the reason.
 */
export async function proposeNextWeekTargets(reviewWeekInput: string): Promise<{ error: string } | { source: "ai" | "code"; proposals: TargetProposal[]; message: string }> {
  const { supabase, user } = await requireUser();
  const { today } = await localToday();
  const planningWeek = planningWeekFor(today);
  const reviewWeek = resolveReviewWeek(reviewWeekInput, today);

  let goals: GoalPlanning[];
  try {
    goals = (await loadTargetPlanning(supabase, reviewWeek, planningWeek)).filter((goal) => goal.existing.length === 0);
  } catch (error) {
    log("error", "review.targets_load_failed", errorFields(error));
    return { error: "Could not load your goals. Please try again." };
  }
  if (goals.length === 0) return { error: "Every goal already has targets for next week." };
  const fromCode = (message: string) => ({
    source: "code" as const,
    proposals: goals.map((goal) => ({ goalId: goal.goalId, rows: proposeTargets(goal, planningWeek), reason: null })),
    message,
  });

  let claim: AIRequestClaim;
  try {
    claim = await claimAIRequest(supabase);
  } catch (limitError) {
    log("error", "ai.rate_limit_check_failed", { userId: user.id, ...errorFields(limitError) });
    return fromCode("The AI service was unavailable, so the proposals below are worked out from last week.");
  }
  if (!claim.allowed) {
    return fromCode(`The AI request limit was reached, so the proposals below are worked out from last week. The AI can be used again in ${describeWait(claim.retryAfterSeconds)}.`);
  }
  // Only goals with a history or a metric give the AI something to work with; a shorter prompt also answers faster.
  const aiGoals = goals.filter((goal) => goal.lastWeek.length > 0 || goal.metrics.some((metric) => metric.aggregation === "sum"));
  if (aiGoals.length === 0) return fromCode("None of these goals has last week's targets or a metric that adds up, so there is nothing for the AI to work from.");
  try {
    const checked = validateAITargets(await generateGeminiJson({ prompt: buildTargetsPrompt(aiGoals, planningWeek), responseSchema: TARGETS_RESPONSE_SCHEMA }), aiGoals, planningWeek);
    if (!checked.ok) {
      log("warn", "review.targets_ai_rejected", { userId: user.id, reason: checked.reason });
      return fromCode(`The AI's proposals were not used (${checked.reason}), so the ones below are worked out from last week.`);
    }
    const byGoal = new Map(checked.proposals.map((proposal) => [proposal.goalId, proposal]));
    return {
      source: "ai",
      proposals: goals.map((goal) => byGoal.get(goal.goalId) ?? { goalId: goal.goalId, rows: proposeTargets(goal, planningWeek), reason: null }),
      message: "AI proposals, checked against last week. Edit anything, then save.",
    };
  } catch (error) {
    log("error", "review.targets_ai_failed", errorFields(error));
    return fromCode("The AI service was unavailable, so the proposals below are worked out from last week.");
  }
}

/**
 * Saves next week's targets for the goals the student ticked, replacing what
 * those goals had for that week. The new targets are inserted before the old
 * ones are removed, so a failed save never leaves a goal without targets.
 * The planning week always comes from today's date on the server.
 */
export async function saveNextWeekTargets(formData: FormData) {
  const { supabase, user } = await requireUser();
  const { today } = await localToday();
  const planningWeek = planningWeekFor(today);
  if (String(formData.get("planning_week") ?? "") !== planningWeek) {
    return { error: "The planning week has changed since this page was loaded. Refresh the page and save again." };
  }
  const reviewWeek = resolveReviewWeek(String(formData.get("review_week") ?? ""), today);

  let payload;
  try {
    const goals = await loadTargetPlanning(supabase, reviewWeek, planningWeek);
    payload = parseTargetsPayload(String(formData.get("targets") ?? ""), goals);
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not read the targets." };
  }

  const goalIds = payload.map((item) => item.goalId);
  const { data: old, error: oldError } = await supabase.from("weekly_targets").select("id").eq("week_start", planningWeek).in("goal_id", goalIds);
  if (oldError) return { error: `Could not load next week's targets: ${oldError.message}` };

  const rows = payload.flatMap((item) => item.rows.map((row) => ({
    user_id: user.id, goal_id: item.goalId, week_start: planningWeek, title: row.title, goal_metric_id: row.metricId, target_value: row.value,
  })));
  const { error: insertError } = await supabase.from("weekly_targets").insert(rows);
  if (insertError) return { error: `Could not save the targets: ${insertError.message}` };

  const oldIds = (old ?? []).map((row) => row.id as string);
  if (oldIds.length > 0) {
    const { error: deleteError } = await supabase.from("weekly_targets").delete().in("id", oldIds).eq("user_id", user.id);
    if (deleteError) {
      log("error", "review.targets_replace_failed", { userId: user.id, message: deleteError.message });
      return { error: "The new targets were saved, but the previous ones for those goals could not be removed. Remove them on the goal pages." };
    }
  }

  revalidatePath("/review");
  revalidatePath("/week");
  revalidatePath("/today");
  revalidatePath("/goals", "layout");
  return { message: `Saved ${plural(rows.length, "target")} for the week starting ${formatDay(planningWeek)}.` };
}
