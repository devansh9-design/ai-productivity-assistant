import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { computeInsights, type Insight, type InsightSession, type InsightTask } from "@/lib/preferences/insights";
import {
  computeDurationFactor,
  DEFAULT_PLANNING_PREFERENCES,
  type PlanningPreferenceValues,
} from "@/lib/preferences/preferences";
import type { PlanningPreferences } from "@/lib/types";
import { log } from "@/lib/log";

export interface Personalization {
  preferences: PlanningPreferenceValues;
  /** 1 when adaptation is off or history is too thin. */
  durationFactor: number;
  durationSamples: number;
  insights: Insight[];
}

const DAY_MS = 86_400_000;

/**
 * Loads the signed-in user's planning preferences and derived history through
 * their own RLS-scoped client. A read failure falls back to defaults so the
 * planner keeps working (for example before the Day 9 migration is applied).
 */
export async function loadPersonalization(
  supabase: SupabaseClient,
  timeZone: string,
  now: Date = new Date(),
): Promise<Personalization> {
  const [preferencesResult, tasksResult, sessionsResult] = await Promise.all([
    supabase.from("planning_preferences").select("*").maybeSingle<PlanningPreferences>(),
    supabase
      .from("tasks")
      .select("status,estimated_minutes,actual_minutes,completed_at,updated_at")
      .gte("updated_at", new Date(now.getTime() - 30 * DAY_MS).toISOString())
      .limit(500)
      .returns<InsightTask[]>(),
    supabase
      .from("task_sessions")
      .select("started_at,minutes")
      .gte("started_at", new Date(now.getTime() - 14 * DAY_MS).toISOString())
      .not("ended_at", "is", null)
      .limit(1000)
      .returns<InsightSession[]>(),
  ]);

  if (preferencesResult.error) log("error", "preferences.load_failed", { message: preferencesResult.error.message });
  if (tasksResult.error) log("error", "preferences.task_history_failed", { message: tasksResult.error.message });
  if (sessionsResult.error) log("error", "preferences.task_sessions_failed", { message: sessionsResult.error.message });

  const row = preferencesResult.error ? null : preferencesResult.data;
  const preferences: PlanningPreferenceValues = row
    ? {
        bufferPercent: row.buffer_percent,
        lowEnergyMaxBlockMinutes: row.low_energy_max_block_minutes,
        adaptToActualDurations: row.adapt_to_actual_durations,
      }
    : DEFAULT_PLANNING_PREFERENCES;

  const tasks = tasksResult.error ? [] : tasksResult.data ?? [];
  const sessions = sessionsResult.error ? [] : sessionsResult.data ?? [];
  const calibration = computeDurationFactor(tasks.filter((task) => task.status === "completed"));

  return {
    preferences,
    durationFactor: preferences.adaptToActualDurations ? calibration.factor : 1,
    durationSamples: calibration.sampleSize,
    insights: computeInsights({ tasks, sessions, timeZone, now }),
  };
}
