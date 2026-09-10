import "server-only";

import { createServiceRoleClient } from "@/lib/supabase/service-role";

const GOOGLE_CALENDAR_API = "https://www.googleapis.com/calendar/v3";
const PLANNER_SUMMARY = "AI Planner";
const PLANNER_DESCRIPTION = "Dedicated calendar for confirmed plans from AI Productivity Assistant.";

interface GoogleCalendarResource {
  id: string;
  summary?: string;
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
          dateTime: `${input.planDate}T${input.startTime}:00`,
          timeZone: input.timeZone,
        },
        end: {
          dateTime: `${input.planDate}T${input.endTime}:00`,
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
