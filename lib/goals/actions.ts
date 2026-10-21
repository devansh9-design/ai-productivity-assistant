"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/require-user";
import { errorFields, log } from "@/lib/log";
import { parseGoal, parseMetric, parsePhase, parseRoutine, parseWeeklyTarget, weeklyMinutes } from "@/lib/goals/roadmap";
import { DEFAULT_TIMEZONE, getTodayISODate, TIMEZONE_COOKIE_NAME } from "@/lib/tasks/timezone";
import type { EntityStatus, Goal, GoalMetric, GoalPhase, Routine } from "@/lib/types";

/**
 * Goal builder actions. Every action returns { message } or { error } for
 * ActionForm to show (a thrown message is hidden in production builds), and
 * filters by user_id on top of row-level security.
 */
type Result = { message?: string; error?: string };

const STATUSES: EntityStatus[] = ["active", "completed", "archived"];

function id(formData: FormData, key = "id"): string {
  return String(formData.get(key) ?? "").trim();
}

function refresh(goalId?: string) {
  revalidatePath("/goals");
  if (goalId) revalidatePath(`/goals/${goalId}`);
}

/** Runs an action body, turning unexpected failures into a plain message. */
async function guarded(event: string, body: () => Promise<Result>): Promise<Result> {
  try {
    return await body();
  } catch (error) {
    log("error", event, errorFields(error));
    return { error: "Something went wrong. Please try again." };
  }
}

async function localToday(): Promise<string> {
  return getTodayISODate((await cookies()).get(TIMEZONE_COOKIE_NAME)?.value || DEFAULT_TIMEZONE);
}

/** The signed-in student's goal, or null. */
async function ownGoal(goalId: string) {
  const { supabase, user } = await requireUser();
  if (!goalId) return { supabase, user, goal: null };
  const { data } = await supabase.from("goals").select("*").eq("id", goalId).eq("user_id", user.id).maybeSingle<Goal>();
  return { supabase, user, goal: data };
}

// ---------------------------------------------------------------------------
// Goals
// ---------------------------------------------------------------------------

export async function createGoal(formData: FormData): Promise<Result> {
  return guarded("goals.create_failed", async () => {
    const { supabase, user } = await requireUser();
    const parsed = parseGoal(formData);
    if (!parsed.ok) return { error: parsed.error };
    const { error } = await supabase.from("goals").insert({ user_id: user.id, plan_source: "manual", ...parsed.value });
    if (error) return { error: `Could not add the goal: ${error.message}` };
    refresh();
    return { message: `Added "${parsed.value.title}". Open it to build the roadmap.` };
  });
}

export async function updateGoal(formData: FormData): Promise<Result> {
  return guarded("goals.update_failed", async () => {
    const { supabase, user, goal } = await ownGoal(id(formData));
    if (!goal) return { error: "That goal no longer exists." };
    const parsed = parseGoal(formData);
    if (!parsed.ok) return { error: parsed.error };
    const { error } = await supabase.from("goals").update(parsed.value).eq("id", goal.id).eq("user_id", user.id);
    if (error) return { error: `Could not save the goal: ${error.message}` };
    refresh(goal.id);
    return { message: "Goal saved." };
  });
}

export async function updateGoalStatus(formData: FormData): Promise<Result> {
  return guarded("goals.status_failed", async () => {
    const { supabase, user } = await requireUser();
    const status = String(formData.get("status") ?? "") as EntityStatus;
    if (!id(formData) || !STATUSES.includes(status)) return { error: "Choose a valid status." };
    const { error } = await supabase.from("goals").update({ status }).eq("id", id(formData)).eq("user_id", user.id);
    if (error) return { error: `Could not update the goal: ${error.message}` };
    refresh(id(formData));
    return {};
  });
}

/** Deleting a goal also removes its metrics, phases, targets and routines (database cascade). */
export async function deleteGoal(formData: FormData): Promise<Result> {
  return guarded("goals.delete_failed", async () => {
    const { supabase, user } = await requireUser();
    if (!id(formData)) return { error: "Missing goal." };
    const { error } = await supabase.from("goals").delete().eq("id", id(formData)).eq("user_id", user.id);
    if (error) return { error: `Could not delete the goal: ${error.message}` };
    refresh();
    return { message: "Goal deleted." };
  });
}

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

export async function saveMetric(formData: FormData): Promise<Result> {
  return guarded("goals.metric_failed", async () => {
    const { supabase, user, goal } = await ownGoal(id(formData, "goal_id"));
    if (!goal) return { error: "That goal no longer exists." };
    const metricId = id(formData);
    const { data: metrics } = await supabase.from("goal_metrics").select("id,name").eq("goal_id", goal.id).returns<Pick<GoalMetric, "id" | "name">[]>();
    const parsed = parseMetric(formData, (metrics ?? []).filter((metric) => metric.id !== metricId).map((metric) => metric.name));
    if (!parsed.ok) return { error: parsed.error };
    const { error } = metricId
      ? await supabase.from("goal_metrics").update(parsed.value).eq("id", metricId).eq("user_id", user.id)
      : await supabase.from("goal_metrics").insert({ user_id: user.id, goal_id: goal.id, position: Math.min((metrics?.length ?? 0) + 1, 20), ...parsed.value });
    if (error) return { error: `Could not save the metric: ${error.message}` };
    refresh(goal.id);
    return { message: metricId ? "Metric saved." : `Now tracking "${parsed.value.name}".` };
  });
}

export async function deleteMetric(formData: FormData): Promise<Result> {
  return guarded("goals.metric_delete_failed", async () => {
    const { supabase, user } = await requireUser();
    const { error } = await supabase.from("goal_metrics").delete().eq("id", id(formData)).eq("user_id", user.id);
    if (error) return { error: `Could not delete the metric: ${error.message}` };
    refresh(id(formData, "goal_id"));
    return { message: "Metric deleted, with its logged values." };
  });
}

// ---------------------------------------------------------------------------
// Roadmap phases (ordered by date; positions only need to be unique)
// ---------------------------------------------------------------------------

export async function savePhase(formData: FormData): Promise<Result> {
  return guarded("goals.phase_failed", async () => {
    const { supabase, user, goal } = await ownGoal(id(formData, "goal_id"));
    if (!goal) return { error: "That goal no longer exists." };
    const phaseId = id(formData);
    const { data: phases } = await supabase.from("goal_phases").select("id,title,start_date,end_date,position").eq("goal_id", goal.id)
      .returns<Pick<GoalPhase, "id" | "title" | "start_date" | "end_date" | "position">[]>();
    const others = (phases ?? []).filter((phase) => phase.id !== phaseId);
    const parsed = parsePhase(formData, goal, others);
    if (!parsed.ok) return { error: parsed.error };
    let result;
    if (phaseId) {
      result = await supabase.from("goal_phases").update(parsed.value).eq("id", phaseId).eq("user_id", user.id);
    } else {
      const used = new Set((phases ?? []).map((phase) => phase.position));
      let position = 1;
      while (used.has(position)) position += 1;
      result = await supabase.from("goal_phases").insert({ user_id: user.id, goal_id: goal.id, position, ...parsed.value });
    }
    if (result.error) return { error: `Could not save the phase: ${result.error.message}` };
    refresh(goal.id);
    return { message: phaseId ? "Phase saved." : `Added "${parsed.value.title}" to the roadmap.` };
  });
}

export async function deletePhase(formData: FormData): Promise<Result> {
  return guarded("goals.phase_delete_failed", async () => {
    const { supabase, user } = await requireUser();
    const { error } = await supabase.from("goal_phases").delete().eq("id", id(formData)).eq("user_id", user.id);
    if (error) return { error: `Could not delete the phase: ${error.message}` };
    refresh(id(formData, "goal_id"));
    return { message: "Phase deleted." };
  });
}

// ---------------------------------------------------------------------------
// Weekly targets
// ---------------------------------------------------------------------------

export async function saveWeeklyTarget(formData: FormData): Promise<Result> {
  return guarded("goals.target_failed", async () => {
    const { supabase, user, goal } = await ownGoal(id(formData, "goal_id"));
    if (!goal) return { error: "That goal no longer exists." };
    const { data: metrics } = await supabase.from("goal_metrics").select("id").eq("goal_id", goal.id).returns<Pick<GoalMetric, "id">[]>();
    const parsed = parseWeeklyTarget(formData, goal, metrics ?? []);
    if (!parsed.ok) return { error: parsed.error };
    const targetId = id(formData);
    const { error } = targetId
      ? await supabase.from("weekly_targets").update(parsed.value).eq("id", targetId).eq("user_id", user.id)
      : await supabase.from("weekly_targets").insert({ user_id: user.id, goal_id: goal.id, ...parsed.value });
    if (error) return { error: `Could not save the target: ${error.message}` };
    refresh(goal.id);
    return { message: `Target set for the week of ${parsed.value.week_start}.` };
  });
}

export async function deleteWeeklyTarget(formData: FormData): Promise<Result> {
  return guarded("goals.target_delete_failed", async () => {
    const { supabase, user } = await requireUser();
    const { error } = await supabase.from("weekly_targets").delete().eq("id", id(formData)).eq("user_id", user.id);
    if (error) return { error: `Could not delete the target: ${error.message}` };
    refresh(id(formData, "goal_id"));
    return { message: "Target deleted." };
  });
}

// ---------------------------------------------------------------------------
// Routines
// ---------------------------------------------------------------------------

export async function saveRoutine(formData: FormData): Promise<Result> {
  return guarded("goals.routine_failed", async () => {
    const { supabase, user, goal } = await ownGoal(id(formData, "goal_id"));
    if (!goal) return { error: "That goal no longer exists." };
    const routineId = id(formData);
    const [{ data: metrics }, { data: routines }] = await Promise.all([
      supabase.from("goal_metrics").select("id").eq("goal_id", goal.id).returns<Pick<GoalMetric, "id">[]>(),
      supabase.from("routines").select("id,days_of_week,minutes,active").eq("goal_id", goal.id).returns<Pick<Routine, "id" | "days_of_week" | "minutes" | "active">[]>(),
    ]);
    const otherActive = (routines ?? []).filter((routine) => routine.id !== routineId && routine.active)
      .reduce((total, routine) => total + weeklyMinutes(routine), 0);
    const parsed = parseRoutine(formData, goal, metrics ?? [], otherActive, await localToday());
    if (!parsed.ok) return { error: parsed.error };
    const { error } = routineId
      ? await supabase.from("routines").update(parsed.value).eq("id", routineId).eq("user_id", user.id)
      : await supabase.from("routines").insert({ user_id: user.id, goal_id: goal.id, ...parsed.value });
    if (error) return { error: `Could not save the routine: ${error.message}` };
    refresh(goal.id);
    return { message: routineId ? "Routine saved." : `Added "${parsed.value.title}". It will show up on its days from ${parsed.value.start_date}.` };
  });
}

/** Pauses or resumes a routine; resuming checks it still fits the goal's weekly hours. */
export async function setRoutineActive(formData: FormData): Promise<Result> {
  return guarded("goals.routine_toggle_failed", async () => {
    const { supabase, user, goal } = await ownGoal(id(formData, "goal_id"));
    if (!goal) return { error: "That goal no longer exists." };
    const active = String(formData.get("active")) === "true";
    const { data: routines } = await supabase.from("routines").select("id,days_of_week,minutes,active").eq("goal_id", goal.id)
      .returns<Pick<Routine, "id" | "days_of_week" | "minutes" | "active">[]>();
    const routine = routines?.find((item) => item.id === id(formData));
    if (!routine) return { error: "That routine no longer exists." };
    if (active && goal.weekly_hours) {
      const total = (routines ?? []).filter((item) => item.active || item.id === routine.id).reduce((sum, item) => sum + weeklyMinutes(item), 0);
      if (total > goal.weekly_hours * 60) return { error: "Resuming this routine would go over the goal's weekly hours. Raise the hours or pause another routine first." };
    }
    const { error } = await supabase.from("routines").update({ active }).eq("id", routine.id).eq("user_id", user.id);
    if (error) return { error: `Could not update the routine: ${error.message}` };
    refresh(goal.id);
    return { message: active ? "Routine resumed." : "Routine paused; it won't add tasks until you resume it." };
  });
}

/** Deletes a routine. Tasks it already created stay, as history. */
export async function deleteRoutine(formData: FormData): Promise<Result> {
  return guarded("goals.routine_delete_failed", async () => {
    const { supabase, user } = await requireUser();
    const { error } = await supabase.from("routines").delete().eq("id", id(formData)).eq("user_id", user.id);
    if (error) return { error: `Could not delete the routine: ${error.message}` };
    refresh(id(formData, "goal_id"));
    return { message: "Routine deleted. Tasks it already created are kept." };
  });
}
