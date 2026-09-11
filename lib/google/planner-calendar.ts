import "server-only";

import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { getUtcBoundsForLocalDate } from "@/lib/google/calendar";

const GOOGLE_CALENDAR_API = "https://www.googleapis.com/calendar/v3";
const PLANNER_SUMMARY = "AI Planner";
const PLANNER_DESCRIPTION = "Dedicated calendar for confirmed plans from AI Productivity Assistant.";

interface GoogleCalendarResource {
  id: string;
  summary?: string;
  description?: string;
}

interface GoogleCalendarListResponse {
  items?: GoogleCalendarResource[];
  nextPageToken?: string;
}

interface GoogleApiError {
  error?: {
    code?: number;
    message?: string;
  };
}

export interface PlannerEventInput {
  planDate: string;
  timeZone: string;
  title: string;
  startTime: string;
  endTime: string;
  dailyPlanId: string;
  planBlockId: string;
}

interface GoogleEventResource {
  id?: string;
}

interface GoogleEventListResource {
  items?: Array<{
    id?: string;
    extendedProperties?: {
      private?: Record<string, string>;
    };
  }>;
  nextPageToken?: string;
}

async function googleRequest<T>(
  accessToken: string,
  path: string,
  init?: RequestInit,
): Promise<{ status: number; body: T | null }> {
  const response = await fetch(`${GOOGLE_CALENDAR_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  const text = await response.text();
  let body: T | null = null;
  if (text) {
    try {
      body = JSON.parse(text) as T;
    } catch {
      body = null;
    }
  }

  return { status: response.status, body };
}

function googleTime(value: string): string {
  // PostgreSQL time columns commonly arrive as HH:mm:ss, while callers/tests
  // may provide HH:mm. Google Calendar accepts a complete local time without
  // adding an extra seconds component.
  return value.length === 5 ? `${value}:00` : value;
}

async function findExistingPlannerCalendar(
  accessToken: string,
): Promise<string | null> {
  let pageToken: string | undefined;

  do {
    const query = new URLSearchParams({
      maxResults: "250",
      showDeleted: "false",
    });
    if (pageToken) query.set("pageToken", pageToken);

    const result = await googleRequest<GoogleCalendarListResponse>(
      accessToken,
      `/users/me/calendarList?${query.toString()}`,
    );

    if (result.status !== 200) {
      const apiError = result.body as GoogleApiError | null;
      throw new Error(
        apiError?.error?.message ??
          `Could not list Google calendars (${result.status}).`,
      );
    }

    const match = result.body?.items?.find(
      (calendar) =>
        calendar.summary === PLANNER_SUMMARY &&
        calendar.description === PLANNER_DESCRIPTION,
    );
    if (match?.id) return match.id;

    pageToken = result.body?.nextPageToken;
  } while (pageToken);

  return null;
}

/**
 * Returns the user's persisted AI Planner calendar, verifying that it still
 * exists in Google. If it was deleted externally, the stale mapping is removed.
 */
async function getPersistedPlannerCalendar(
  userId: string,
  accessToken: string,
): Promise<string | null> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("google_planner_calendars")
    .select("calendar_id")
    .eq("user_id", userId)
    .maybeSingle<{ calendar_id: string }>();

  if (error || !data) return null;

  const result = await googleRequest<GoogleCalendarResource>(
    accessToken,
    `/calendars/${encodeURIComponent(data.calendar_id)}`,
  );

  if (result.status === 200 && result.body?.id) return result.body.id;

  if (result.status === 404) {
    await supabase
      .from("google_planner_calendars")
      .delete()
      .eq("user_id", userId);
    return null;
  }

  throw new Error(
    `Could not verify AI Planner calendar (${result.status}).`,
  );
}

/**
 * Gets or creates one dedicated secondary Google Calendar named AI Planner.
 * The calendar id is persisted per user so repeated calls are idempotent.
 * If the local mapping is missing, an existing matching calendar is reused
 * before creating a new one.
 */
export async function getOrCreatePlannerCalendar(
  userId: string,
  accessToken: string,
): Promise<string> {
  const existingCalendarId = await getPersistedPlannerCalendar(
    userId,
    accessToken,
  );
  if (existingCalendarId) return existingCalendarId;

  const matchingCalendarId = await findExistingPlannerCalendar(accessToken);
  if (matchingCalendarId) {
    const supabase = createServiceRoleClient();
    const { error } = await supabase.from("google_planner_calendars").upsert(
      {
        user_id: userId,
        calendar_id: matchingCalendarId,
        summary: PLANNER_SUMMARY,
      },
      { onConflict: "user_id" },
    );

    if (error) {
      throw new Error(
        `AI Planner calendar exists but could not be saved: ${error.message}`,
      );
    }

    return matchingCalendarId;
  }

  const created = await googleRequest<GoogleCalendarResource>(
    accessToken,
    "/calendars",
    {
      method: "POST",
      body: JSON.stringify({
        summary: PLANNER_SUMMARY,
        description: PLANNER_DESCRIPTION,
      }),
    },
  );

  if (created.status !== 200 && created.status !== 201) {
    const apiError = created.body as GoogleApiError | null;
    throw new Error(
      apiError?.error?.message ??
        `Could not create AI Planner calendar (${created.status}).`,
    );
  }

  const calendarId = created.body?.id;
  if (!calendarId) {
    throw new Error("Google did not return an AI Planner calendar ID.");
  }

  const supabase = createServiceRoleClient();
  const { error } = await supabase.from("google_planner_calendars").upsert(
    {
      user_id: userId,
      calendar_id: calendarId,
      summary: PLANNER_SUMMARY,
    },
    { onConflict: "user_id" },
  );

  if (error) {
    throw new Error(
      `AI Planner calendar was created but could not be saved: ${error.message}`,
    );
  }

  return calendarId;
}

/**
 * Deletes only events previously created by this application for one local plan date.
 *
 * This identifies events by the private extended property written by
 * createPlannerEvent, so normal Google Calendar events are never touched.
 * It also cleans up orphaned events from a previous partial publish.
 */
export async function deletePlannerEventsForDate(
  accessToken: string,
  calendarId: string,
  planDate: string,
  timeZone: string,
): Promise<void> {
  const { timeMin, timeMax } = getUtcBoundsForLocalDate(planDate, timeZone);
  let pageToken: string | undefined;
  const eventIds: string[] = [];

  do {
    const params = new URLSearchParams({
      timeMin,
      timeMax,
      singleEvents: "true",
      showDeleted: "false",
      maxResults: "2500",
    });
    if (pageToken) params.set("pageToken", pageToken);

    const result = await googleRequest<GoogleEventListResource>(
      accessToken,
      `/calendars/${encodeURIComponent(calendarId)}/events?${params.toString()}`,
    );

    if (result.status !== 200) {
      const apiError = result.body as GoogleApiError | null;
      throw new Error(
        apiError?.error?.message ??
          `Could not list AI Planner events (${result.status}).`,
      );
    }

    for (const event of result.body?.items ?? []) {
      if (
        event.id &&
        event.extendedProperties?.private?.app === "ai-productivity-assistant"
      ) {
        eventIds.push(event.id);
      }
    }

    pageToken = result.body?.nextPageToken;
  } while (pageToken);

  for (const eventId of eventIds) {
    const result = await googleRequest<unknown>(
      accessToken,
      `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
      { method: "DELETE" },
    );

    if (result.status !== 204 && result.status !== 200 && result.status !== 404 && result.status !== 410) {
      const apiError = result.body as GoogleApiError | null;
      throw new Error(
        apiError?.error?.message ??
          `Could not delete AI Planner event ${eventId} (${result.status}).`,
      );
    }
  }
}
/**
 * Creates one timed Google Calendar event for a confirmed plan block.
 * Only callers that have already filtered plan blocks to task work should use this.
 */
export async function createPlannerEvent(
  accessToken: string,
  calendarId: string,
  input: PlannerEventInput,
): Promise<string> {
  const result = await googleRequest<GoogleEventResource>(
    accessToken,
    `/calendars/${encodeURIComponent(calendarId)}/events`,
    {
      method: "POST",
      body: JSON.stringify({
        summary: input.title,
        description: `AI Planner work block. Plan: ${input.dailyPlanId}. Block: ${input.planBlockId}.`,
        start: {
          dateTime: `${input.planDate}T${googleTime(input.startTime)}`,
          timeZone: input.timeZone,
        },
        end: {
          dateTime: `${input.planDate}T${googleTime(input.endTime)}`,
          timeZone: input.timeZone,
        },
        extendedProperties: {
          private: {
            app: "ai-productivity-assistant",
            dailyPlanId: input.dailyPlanId,
            planBlockId: input.planBlockId,
          },
        },
      }),
    },
  );

  if (result.status !== 200 && result.status !== 201) {
    const apiError = result.body as GoogleApiError | null;
    throw new Error(
      apiError?.error?.message ??
        `Could not publish AI Planner event (${result.status}).`,
    );
  }

  if (!result.body?.id) {
    throw new Error("Google did not return an AI Planner event ID.");
  }

  return result.body.id;
}
