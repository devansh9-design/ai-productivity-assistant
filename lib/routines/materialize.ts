import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { log } from "@/lib/log";

/**
 * Makes sure today's routine sessions exist as tasks (materialize_routine_tasks),
 * and marks earlier unfinished sessions as missed. Safe to call on every page
 * load: a routine can only ever create one task per day. A failure is logged
 * and the page carries on with the tasks that already exist.
 */
export async function materializeRoutineTasks(supabase: SupabaseClient, date: string): Promise<number> {
  const { data, error } = await supabase.rpc("materialize_routine_tasks", { p_date: date });
  if (error) {
    log("error", "routines.materialize_failed", { date, code: error.code, message: error.message });
    return 0;
  }
  return typeof data === "number" ? data : 0;
}
