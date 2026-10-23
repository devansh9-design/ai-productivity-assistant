import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Every table holding the user's own data, with a stable column to page by.
 * Left out on purpose: google_credentials (OAuth tokens), the Google planner
 * mapping tables (internal IDs, server-only), ai_request_log (rate-limit
 * bookkeeping) and the deferred Telegram mapping.
 */
export const EXPORT_TABLES: ReadonlyArray<{ table: string; orderBy: string }> = [
  { table: "profiles", orderBy: "id" },
  { table: "goals", orderBy: "id" },
  { table: "tasks", orderBy: "id" },
  { table: "task_dependencies", orderBy: "id" },
  { table: "task_sessions", orderBy: "id" },
  { table: "checkins", orderBy: "id" },
  { table: "journal_entries", orderBy: "id" },
  { table: "availability_rules", orderBy: "id" },
  { table: "fixed_commitments", orderBy: "id" },
  { table: "planning_preferences", orderBy: "user_id" },
  { table: "daily_plans", orderBy: "id" },
  { table: "plan_blocks", orderBy: "id" },
  { table: "plan_unscheduled_tasks", orderBy: "id" },
  { table: "weekly_reviews", orderBy: "id" },
  { table: "weekly_review_highlights", orderBy: "id" },
  { table: "weekly_plans", orderBy: "id" },
  { table: "weekly_plan_items", orderBy: "id" },
  { table: "ai_conversations", orderBy: "id" },
  { table: "integration_status", orderBy: "provider" },
  { table: "goal_metrics", orderBy: "id" },
  { table: "goal_phases", orderBy: "id" },
  { table: "weekly_targets", orderBy: "id" },
  { table: "routines", orderBy: "id" },
  { table: "progress_logs", orderBy: "id" },
  { table: "evening_log_items", orderBy: "id" },
  { table: "daily_feedback", orderBy: "id" },
];

const PAGE_SIZE = 1000;

export interface UserDataExport {
  format: "personal-productivity-assistant/export";
  version: 1;
  exported_at: string;
  user: { id: string; email: string | null };
  tables: Record<string, unknown[]>;
}

/**
 * Reads every exported table in full through the user's own client, so RLS
 * limits it to their rows. Any failed read throws: a partial backup must
 * never look complete.
 */
export async function buildUserDataExport(
  supabase: SupabaseClient,
  user: { id: string; email?: string | null },
  now: Date = new Date(),
): Promise<UserDataExport> {
  const tables: Record<string, unknown[]> = {};
  for (const { table, orderBy } of EXPORT_TABLES) {
    const rows: unknown[] = [];
    for (let from = 0; ; from += PAGE_SIZE) {
      const { data, error } = await supabase.from(table).select("*").order(orderBy, { ascending: true }).range(from, from + PAGE_SIZE - 1);
      if (error) throw new Error(`Could not export ${table}: ${error.message}`);
      rows.push(...(data ?? []));
      if (!data || data.length < PAGE_SIZE) break;
    }
    tables[table] = rows;
  }
  return {
    format: "personal-productivity-assistant/export",
    version: 1,
    exported_at: now.toISOString(),
    user: { id: user.id, email: user.email ?? null },
    tables,
  };
}
