import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  COMMITTED_PLAN_STATUSES,
  computeAnalytics,
  type AnalyticsGoal,
  type AnalyticsMilestone,
  type AnalyticsPlan,
  type AnalyticsPlanBlock,
  type AnalyticsProject,
  type AnalyticsResult,
  type AnalyticsSession,
  type AnalyticsTask,
} from "@/lib/analytics/metrics";
import type { AnalyticsRange } from "@/lib/analytics/range";
import { addDaysToISODate } from "@/lib/tasks/timezone";

/** PostgREST returns at most this many rows per request by default. */
const PAGE_SIZE = 1000;
/** Keeps `in (...)` filters well within URL length limits. */
const ID_CHUNK = 150;

type Page<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>;

/** Reads every page so results are never silently truncated at the row limit. */
async function fetchAll<T>(query: (from: number, to: number) => Page<T>): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await query(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE_SIZE) return rows;
  }
}

async function fetchByIds<T>(ids: string[], query: (chunk: string[], from: number, to: number) => Page<T>): Promise<T[]> {
  const rows: T[] = [];
  for (let index = 0; index < ids.length; index += ID_CHUNK) {
    const chunk = ids.slice(index, index + ID_CHUNK);
    rows.push(...(await fetchAll((from, to) => query(chunk, from, to))));
  }
  return rows;
}

const TASK_COLUMNS = "id,title,category,status,status_reason,due_date,completed_at,updated_at,actual_minutes,goal_id,project_id,milestone_id";
const SESSION_COLUMNS = "id,task_id,started_at,ended_at,minutes";

/**
 * Loads one user's rows through their RLS-scoped client and computes the
 * dashboard. Sessions are read for a window one day wider than the range on
 * each side (local days never differ from UTC by more than 14 hours); the
 * metrics then keep only those that fall on a local day in range. Sessions of
 * tasks that may use manual minutes are read in full, because any valid
 * timer session, even outside the range, means that task's manual minutes are
 * not counted.
 */
export async function loadAnalytics(
  supabase: SupabaseClient,
  userId: string,
  range: AnalyticsRange,
  timeZone: string,
  today: string,
): Promise<AnalyticsResult> {
  const windowStart = `${addDaysToISODate(range.from, -1)}T00:00:00Z`;
  const windowEnd = `${addDaysToISODate(range.to, 2)}T00:00:00Z`;

  const [tasks, rangeSessions, plans, goals, projects, milestones] = await Promise.all([
    fetchAll<AnalyticsTask>((from, to) => supabase.from("tasks").select(TASK_COLUMNS).eq("user_id", userId).order("id").range(from, to)),
    fetchAll<AnalyticsSession>((from, to) => supabase.from("task_sessions").select(SESSION_COLUMNS).eq("user_id", userId)
      .gte("started_at", windowStart).lt("started_at", windowEnd).order("id").range(from, to)),
    fetchAll<AnalyticsPlan>((from, to) => supabase.from("daily_plans").select("id,plan_date,status,version").eq("user_id", userId)
      .gte("plan_date", range.from).lte("plan_date", range.to).in("status", [...COMMITTED_PLAN_STATUSES]).order("id").range(from, to)),
    fetchAll<AnalyticsGoal>((from, to) => supabase.from("goals").select("id,title,status").eq("user_id", userId).order("id").range(from, to)),
    fetchAll<AnalyticsProject>((from, to) => supabase.from("projects").select("id,goal_id").eq("user_id", userId).order("id").range(from, to)),
    fetchAll<AnalyticsMilestone>((from, to) => supabase.from("milestones").select("id,title,status,due_date,project_id").eq("user_id", userId).order("id").range(from, to)),
  ]);

  const [startMs, endMs] = [Date.parse(windowStart), Date.parse(windowEnd)];
  const manualCandidates = tasks
    .filter((task) => {
      const completedMs = task.completed_at ? Date.parse(task.completed_at) : NaN;
      return task.status === "completed" && (task.actual_minutes ?? 0) > 0 && completedMs >= startMs && completedMs < endMs;
    })
    .map((task) => task.id);

  const [candidateSessions, planBlocks] = await Promise.all([
    fetchByIds<AnalyticsSession>(manualCandidates, (chunk, from, to) =>
      supabase.from("task_sessions").select(SESSION_COLUMNS).eq("user_id", userId).in("task_id", chunk).order("id").range(from, to)),
    fetchByIds<AnalyticsPlanBlock>(plans.map((plan) => plan.id), (chunk, from, to) =>
      supabase.from("plan_blocks").select("daily_plan_id,task_id,kind,start_time,end_time").eq("user_id", userId)
        .in("daily_plan_id", chunk).eq("kind", "task").order("id").range(from, to)),
  ]);

  return computeAnalytics({
    range, today, timeZone, tasks,
    sessions: [...rangeSessions, ...candidateSessions],
    plans, planBlocks, goals, projects, milestones,
  });
}
