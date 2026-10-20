import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getValidAccessToken } from "@/lib/google/oauth";
import { fetchCalendarEvents } from "@/lib/google/calendar";
import {
  CALENDAR_ERROR_MESSAGES,
  DEFAULT_CALENDAR_STATUS,
  readCalendarForPlanning,
  type CalendarErrorCode,
  type CalendarIntegrationStatus,
  type CalendarOperation,
  type CalendarRead,
} from "@/lib/integrations/calendar";
import { errorFields, log } from "@/lib/log";

const PROVIDER = "google_calendar";

interface StatusRow {
  planning_enabled: boolean;
  publishing_enabled: boolean;
  needs_reconnect: boolean;
  last_read_at: string | null;
  last_published_at: string | null;
  last_error_at: string | null;
  last_error_operation: CalendarOperation | null;
  last_error_code: CalendarErrorCode | null;
  last_error_message: string | null;
}

/**
 * Loads the user's Google Calendar status fresh from the database, so a pause
 * applies even to a page that was opened before it. Throws when the status
 * cannot be read: callers must not guess whether the calendar is paused.
 */
export async function loadCalendarStatus(supabase: SupabaseClient, userId: string): Promise<CalendarIntegrationStatus> {
  const { data, error } = await supabase.from("integration_status")
    .select("planning_enabled,publishing_enabled,needs_reconnect,last_read_at,last_published_at,last_error_at,last_error_operation,last_error_code,last_error_message")
    .eq("user_id", userId).eq("provider", PROVIDER).maybeSingle<StatusRow>();
  if (error) throw new Error("Your Google Calendar settings could not be loaded. Please try again.");
  if (!data) return DEFAULT_CALENDAR_STATUS;
  return {
    planningEnabled: data.planning_enabled,
    publishingEnabled: data.publishing_enabled,
    needsReconnect: data.needs_reconnect,
    lastReadAt: data.last_read_at,
    lastPublishedAt: data.last_published_at,
    lastErrorAt: data.last_error_at,
    lastErrorOperation: data.last_error_operation,
    lastErrorCode: data.last_error_code,
    lastErrorMessage: data.last_error_message,
  };
}

async function upsertStatus(supabase: SupabaseClient, userId: string, fields: Record<string, unknown>) {
  const { error } = await supabase.from("integration_status")
    .upsert({ user_id: userId, provider: PROVIDER, ...fields }, { onConflict: "user_id,provider" });
  return error;
}

// Recording is best effort: a status write must never undo or block the
// calendar operation it describes.
async function record(supabase: SupabaseClient, userId: string, fields: Record<string, unknown>) {
  try {
    const error = await upsertStatus(supabase, userId, fields);
    if (error) log("error", "calendar.status_record_failed", { message: error.message });
  } catch (error) {
    log("error", "calendar.status_record_failed", errorFields(error));
  }
}

/** A successful read or publish also proves the connection works again. */
export function recordCalendarSuccess(supabase: SupabaseClient, userId: string, operation: CalendarOperation) {
  const at = new Date().toISOString();
  return record(supabase, userId, operation === "read"
    ? { last_read_at: at, needs_reconnect: false }
    : { last_published_at: at, needs_reconnect: false });
}

/** Stores only the app's code and message for the failure, with its time. */
export function recordCalendarFailure(supabase: SupabaseClient, userId: string, operation: CalendarOperation, code: CalendarErrorCode) {
  return record(supabase, userId, {
    last_error_at: new Date().toISOString(),
    last_error_operation: operation,
    last_error_code: code,
    last_error_message: CALENDAR_ERROR_MESSAGES[code],
    ...(code === "reconnect_required" ? { needs_reconnect: true } : {}),
  });
}

/** Connecting again or disconnecting on purpose ends the "needs reconnecting" state. */
export function clearCalendarReconnect(supabase: SupabaseClient, userId: string) {
  return record(supabase, userId, { needs_reconnect: false });
}

/** Saves the pause switches; unlike recording, a failure here is reported to the user. */
export async function saveCalendarSwitches(supabase: SupabaseClient, userId: string, switches: { planningEnabled: boolean; publishingEnabled: boolean }) {
  const error = await upsertStatus(supabase, userId, {
    planning_enabled: switches.planningEnabled,
    publishing_enabled: switches.publishingEnabled,
  });
  if (error) throw new Error("Your Google Calendar settings could not be saved. Please try again.");
}

/**
 * Reads today's Google Calendar events for planning, honouring the pause
 * switch and the user's explicit choice to plan without the calendar, and
 * records the outcome on the status card.
 */
export async function readCalendarForUser(
  supabase: SupabaseClient,
  userId: string,
  planDate: string,
  timeZone: string,
  withoutCalendar: boolean,
  timeZoneError: string | null = null,
): Promise<CalendarRead> {
  const status = await loadCalendarStatus(supabase, userId);
  const result = await readCalendarForPlanning({
    status,
    withoutCalendar,
    timeZoneError,
    getToken: () => getValidAccessToken(userId),
    fetchEvents: (token) => fetchCalendarEvents(token, planDate, timeZone),
  });
  if (result.kind === "events") await recordCalendarSuccess(supabase, userId, "read");
  if (result.kind === "failed") await recordCalendarFailure(supabase, userId, "read", result.code);
  return result;
}
