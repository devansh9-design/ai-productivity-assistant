"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/require-user";
import { claimAIRequest, limitMessage } from "@/lib/ai/rate-limit";
import { generateGeminiJson } from "@/lib/gemini";
import { buildRoadmapPrompt, checkDraft, DRAFT_SECTIONS, ROADMAP_RESPONSE_SCHEMA, type DraftSection, type DraftSettings, type RoadmapDraft } from "@/lib/goals/ai-roadmap";
import { weeklyMinutes } from "@/lib/goals/roadmap";
import { errorFields, log } from "@/lib/log";
import { minutesFromHHMM } from "@/lib/time";
import { DEFAULT_TIMEZONE, getTodayISODate, TIMEZONE_COOKIE_NAME } from "@/lib/tasks/timezone";
import type { Goal, GoalLevel, GoalPhase, Routine } from "@/lib/types";

type DraftResult = { ok: true; draft: RoadmapDraft } | { ok: false; error: string };

const LEVELS: GoalLevel[] = ["beginner", "intermediate", "advanced"];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

async function localToday(): Promise<string> {
  return getTodayISODate((await cookies()).get(TIMEZONE_COOKIE_NAME)?.value || DEFAULT_TIMEZONE);
}

/** The frame the roadmap is drafted in; the AI builder needs all of it. */
function checkSettings(settings: DraftSettings, today: string): string | null {
  if (!ISO_DATE.test(settings.start_date) || !ISO_DATE.test(settings.target_date)) return "Set the goal's start and target dates first.";
  if (settings.target_date <= settings.start_date) return "The target date must be after the start date.";
  if (settings.target_date < today) return "The target date has already passed.";
  if (!Number.isFinite(settings.weekly_hours) || settings.weekly_hours < 0.5 || settings.weekly_hours > 112) return "Hours per week must be between 0.5 and 112.";
  if (settings.level && !LEVELS.includes(settings.level)) return "Choose a valid level.";
  if (settings.constraints.length > 1000) return "Keep the notes for the AI under 1000 characters.";
  return null;
}

function minutes(start: string, end: string): number {
  return Math.max(0, (minutesFromHHMM(end) ?? 0) - (minutesFromHHMM(start) ?? 0));
}

/**
 * Asks the AI for a roadmap (or a revision of the current draft), checks it
 * with the builder's rules, and gives the AI one chance to fix a failed
 * check. Nothing is saved: the student reviews the draft first.
 */
export async function draftRoadmap(input: {
  goalId: string;
  settings: DraftSettings;
  revise?: { draft: RoadmapDraft; request: string };
}): Promise<DraftResult> {
  const { supabase, user } = await requireUser();
  try {
    const today = await localToday();
    const settings: DraftSettings = { ...input.settings, constraints: input.settings.constraints.trim() };
    const problem = checkSettings(settings, today);
    if (problem) return { ok: false, error: problem };
    if (input.revise && (!input.revise.request.trim() || input.revise.request.length > 500)) return { ok: false, error: "Say what to change (up to 500 characters)." };

    const { data: goal } = await supabase.from("goals").select("*").eq("id", input.goalId).eq("user_id", user.id).maybeSingle<Goal>();
    if (!goal) return { ok: false, error: "That goal no longer exists." };

    const [rules, otherRoutines, metrics] = await Promise.all([
      supabase.from("availability_rules").select("kind,start_time,end_time").eq("user_id", user.id).in("kind", ["working", "class"])
        .returns<Array<{ kind: string; start_time: string; end_time: string }>>(),
      supabase.from("routines").select("days_of_week,minutes").eq("user_id", user.id).eq("active", true).neq("goal_id", goal.id)
        .returns<Pick<Routine, "days_of_week" | "minutes">[]>(),
      supabase.from("goal_metrics").select("name").eq("goal_id", goal.id).returns<Array<{ name: string }>>(),
    ]);
    const loadError = rules.error ?? otherRoutines.error ?? metrics.error;
    if (loadError) return { ok: false, error: "Your schedule could not be loaded. Please try again." };
    const existingMetrics = (metrics.data ?? []).map((metric) => metric.name);
    const context = {
      goal, settings, today, existingMetrics,
      studyMinutesPerWeek: (rules.data ?? []).filter((rule) => rule.kind === "working").reduce((sum, rule) => sum + minutes(rule.start_time, rule.end_time), 0),
      classMinutesPerWeek: (rules.data ?? []).filter((rule) => rule.kind === "class").reduce((sum, rule) => sum + minutes(rule.start_time, rule.end_time), 0),
      otherGoalsMinutesPerWeek: (otherRoutines.data ?? []).reduce((sum, routine) => sum + weeklyMinutes(routine), 0),
      previous: input.revise ? { draft: input.revise.draft, request: input.revise.request.trim() } : undefined,
    };

    let fixError: string | undefined;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const claim = await claimAIRequest(supabase);
      if (!claim.allowed) {
        return { ok: false, error: limitMessage(claim) };
      }
      const answer = await generateGeminiJson({ prompt: buildRoadmapPrompt({ ...context, fixError }), responseSchema: ROADMAP_RESPONSE_SCHEMA });
      const checked = checkDraft(answer, settings, existingMetrics, today);
      if (checked.ok) {
        log("info", "roadmap.drafted", { userId: user.id, goalId: goal.id, attempt, revised: Boolean(input.revise), phases: checked.draft.phases.length, routines: checked.draft.routines.length });
        return checked;
      }
      log("warn", "roadmap.draft_rejected", { userId: user.id, goalId: goal.id, attempt, reason: checked.error });
      fixError = checked.error;
    }
    return { ok: false, error: `The AI's draft didn't pass the plan checks (${fixError}). Try again, or adjust the hours or dates.` };
  } catch (error) {
    log("error", "roadmap.draft_failed", { userId: user.id, ...errorFields(error) });
    return { ok: false, error: "The AI couldn't draft a roadmap right now. Please try again in a moment." };
  }
}

/**
 * Saves the reviewed draft in one transaction (save_goal_roadmap). With
 * `replace`, the goal's current phases, targets and routines are swapped out;
 * otherwise the draft is added, so it must fit around what is already there.
 */
export async function saveRoadmap(input: {
  goalId: string;
  settings: DraftSettings;
  draft: RoadmapDraft;
  sections: DraftSection[];
  replace: boolean;
}): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
  const { supabase, user } = await requireUser();
  try {
    const today = await localToday();
    const problem = checkSettings(input.settings, today);
    if (problem) return { ok: false, error: problem };
    const sections = DRAFT_SECTIONS.filter((section) => input.sections.includes(section));
    if (!sections.length) return { ok: false, error: "Choose at least one part of the draft to save." };

    const { data: goal } = await supabase.from("goals").select("id").eq("id", input.goalId).eq("user_id", user.id).maybeSingle<Pick<Goal, "id">>();
    if (!goal) return { ok: false, error: "That goal no longer exists." };
    const [metrics, phases, routines] = await Promise.all([
      supabase.from("goal_metrics").select("name").eq("goal_id", goal.id).returns<Array<{ name: string }>>(),
      supabase.from("goal_phases").select("title,start_date,end_date").eq("goal_id", goal.id).returns<Pick<GoalPhase, "title" | "start_date" | "end_date">[]>(),
      supabase.from("routines").select("days_of_week,minutes").eq("goal_id", goal.id).eq("active", true).returns<Pick<Routine, "days_of_week" | "minutes">[]>(),
    ]);
    const existingMetrics = (metrics.data ?? []).map((metric) => metric.name);

    const checked = checkDraft(input.draft, input.settings, existingMetrics, today, sections);
    if (!checked.ok) return { ok: false, error: checked.error };
    const { draft } = checked;

    if (!input.replace) {
      for (const phase of sections.includes("phases") ? draft.phases : []) {
        const clash = (phases.data ?? []).find((other) => phase.start_date <= other.end_date && other.start_date <= phase.end_date);
        if (clash) return { ok: false, error: `Phase "${phase.title}" overlaps your existing phase "${clash.title}". Choose "Replace my current roadmap", or adjust the dates.` };
      }
      if (sections.includes("routines")) {
        const total = [...(routines.data ?? []), ...draft.routines].reduce((sum, routine) => sum + weeklyMinutes(routine), 0);
        if (total > input.settings.weekly_hours * 60) {
          return { ok: false, error: "Together with your current routines, this goes over the goal's weekly hours. Choose \"Replace my current roadmap\", or remove a routine." };
        }
      }
    }

    const { error } = await supabase.rpc("save_goal_roadmap", {
      p_goal_id: goal.id,
      p_goal: { start_date: input.settings.start_date, target_date: input.settings.target_date, weekly_hours: input.settings.weekly_hours, level: input.settings.level },
      p_metrics: sections.includes("metrics") ? draft.metrics : null,
      p_phases: sections.includes("phases") ? draft.phases : null,
      p_targets: sections.includes("targets") ? draft.targets : null,
      p_routines: sections.includes("routines") ? draft.routines : null,
      p_replace: input.replace,
    });
    if (error) {
      log("error", "roadmap.save_failed", { userId: user.id, goalId: goal.id, code: error.code, message: error.message });
      return { ok: false, error: "The roadmap could not be saved. Nothing was changed; please try again." };
    }
    log("info", "roadmap.saved", { userId: user.id, goalId: goal.id, sections, replace: input.replace });
    revalidatePath("/goals");
    revalidatePath(`/goals/${goal.id}`);
    return { ok: true, message: "Roadmap saved. Routines start showing up on their days." };
  } catch (error) {
    log("error", "roadmap.save_failed", { userId: user.id, ...errorFields(error) });
    return { ok: false, error: "The roadmap could not be saved. Nothing was changed; please try again." };
  }
}
