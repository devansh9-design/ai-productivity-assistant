import { GoogleRequestError } from "@/lib/google/errors";
import type { AccessTokenResult } from "@/lib/google/oauth";
import type { CalendarEvent } from "@/lib/google/calendar";

export type CalendarErrorCode = "reconnect_required" | "permission_denied" | "unavailable";
export type CalendarOperation = "read" | "publish";

/**
 * The only error text ever stored or shown for a calendar failure. Messages
 * are written by the app per cause; Google's own response text is never kept.
 */
export const CALENDAR_ERROR_MESSAGES: Record<CalendarErrorCode, string> = {
  reconnect_required: "Google Calendar needs reconnecting: Google no longer accepts this app's access. Reconnect it in Settings.",
  permission_denied: "Google Calendar refused the request (missing permission or a usage limit). Try again later, or reconnect it in Settings.",
  unavailable: "Google Calendar didn't respond. Try again in a moment.",
};

export const PLAN_WITHOUT_CALENDAR_WARNING =
  "The plan will not include your Google Calendar events, so it may overlap meetings. Check for clashes before you confirm it.";

/** Matches the integration_status row; defaults apply when no row exists yet. */
export interface CalendarIntegrationStatus {
  planningEnabled: boolean;
  publishingEnabled: boolean;
  needsReconnect: boolean;
  lastReadAt: string | null;
  lastPublishedAt: string | null;
  lastErrorAt: string | null;
  lastErrorOperation: CalendarOperation | null;
  lastErrorCode: CalendarErrorCode | null;
  lastErrorMessage: string | null;
}

export const DEFAULT_CALENDAR_STATUS: CalendarIntegrationStatus = {
  planningEnabled: true, publishingEnabled: true, needsReconnect: false,
  lastReadAt: null, lastPublishedAt: null,
  lastErrorAt: null, lastErrorOperation: null, lastErrorCode: null, lastErrorMessage: null,
};

/** Names the cause of a failed Google request from its HTTP status only. */
export function classifyCalendarError(error: unknown): CalendarErrorCode {
  if (error instanceof GoogleRequestError) {
    if (error.status === 401) return "reconnect_required";
    if (error.status === 403) return "permission_denied";
  }
  return "unavailable";
}

/** Maps a failed access-token lookup to a cause; null when simply not connected. */
export function tokenErrorCode(result: AccessTokenResult, needsReconnect: boolean): CalendarErrorCode | null {
  if (!("error" in result)) return null;
  if (result.error === "reconnect_required") return "reconnect_required";
  if (result.error === "calendar_sync_failed") return "unavailable";
  // Credentials are deleted when Google revokes them, so "not connected" after
  // a revocation still means the user must reconnect (or disconnect on purpose).
  return needsReconnect ? "reconnect_required" : null;
}

export type CalendarRead =
  | { kind: "events"; events: CalendarEvent[] }
  | { kind: "skipped"; reason: "paused" | "not_connected" | "without_calendar" }
  | { kind: "failed"; code: CalendarErrorCode }
  | { kind: "invalid_timezone"; error: string };

/**
 * Decides whether and how to read Google Calendar for planning. A pause or the
 * user's explicit "plan without my calendar" choice returns before any Google
 * call. Any failure is reported, never turned into an empty calendar.
 */
export async function readCalendarForPlanning(input: {
  status: Pick<CalendarIntegrationStatus, "planningEnabled" | "needsReconnect">;
  withoutCalendar: boolean;
  /** Set when the browser timezone is missing or invalid; only matters if the calendar would be read. */
  timeZoneError?: string | null;
  getToken: () => Promise<AccessTokenResult>;
  fetchEvents: (token: string) => Promise<CalendarEvent[]>;
}): Promise<CalendarRead> {
  if (!input.status.planningEnabled) return { kind: "skipped", reason: "paused" };
  if (input.withoutCalendar) return { kind: "skipped", reason: "without_calendar" };
  const tokenResult = await input.getToken();
  if ("error" in tokenResult) {
    const code = tokenErrorCode(tokenResult, input.status.needsReconnect);
    return code ? { kind: "failed", code } : { kind: "skipped", reason: "not_connected" };
  }
  if (input.timeZoneError) return { kind: "invalid_timezone", error: input.timeZoneError };
  try {
    return { kind: "events", events: await input.fetchEvents(tokenResult.token) };
  } catch (error) {
    return { kind: "failed", code: classifyCalendarError(error) };
  }
}

export type CalendarState = "not_connected" | "needs_reconnect" | "failing" | "connected";

/** The headline state for the Settings card. */
export function describeCalendarState(status: CalendarIntegrationStatus, connected: boolean): CalendarState {
  if (status.needsReconnect) return "needs_reconnect";
  if (!connected) return "not_connected";
  const lastSuccess = Math.max(Date.parse(status.lastReadAt ?? "") || 0, Date.parse(status.lastPublishedAt ?? "") || 0);
  if (status.lastErrorAt && Date.parse(status.lastErrorAt) > lastSuccess) return "failing";
  return "connected";
}

export const WITHOUT_CALENDAR_FIELD = "without_calendar";

/** True only when the user pressed "Plan without my calendar" (never by default). */
export function wantsPlanWithoutCalendar(formData: Pick<FormData, "get"> | undefined): boolean {
  return formData?.get(WITHOUT_CALENDAR_FIELD) === "1";
}

/**
 * An action result that ActionForm shows as an error with a second, explicit
 * "Plan without my calendar" button and its warning.
 */
export function calendarFailure(code: CalendarErrorCode) {
  return {
    error: CALENDAR_ERROR_MESSAGES[code],
    retryWith: { field: WITHOUT_CALENDAR_FIELD, label: "Plan without my calendar", warning: PLAN_WITHOUT_CALENDAR_WARNING },
  };
}

/** Says why calendar events were left out of a plan; null when they were included or never connected. */
export function calendarSkipNote(read: CalendarRead): string | null {
  if (read.kind !== "skipped") return null;
  if (read.reason === "paused") return "Google Calendar was not read because calendar planning is paused in Settings, so meetings are not included.";
  if (read.reason === "without_calendar") return "As you chose, Google Calendar was not read, so meetings are not included. Check for clashes before you confirm it.";
  return null;
}

/** A failure that came from Google (an API error status or a network error), not from the app's own database. */
export function isGoogleFailure(error: unknown): boolean {
  return error instanceof GoogleRequestError || error instanceof TypeError;
}
