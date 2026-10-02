import "server-only";

// ---------------------------------------------------------------------------
// Google Calendar event types
// ---------------------------------------------------------------------------

export interface CalendarEvent {
  googleEventId: string;
  title: string;
  startTime: string; // "HH:MM"
  endTime: string; // "HH:MM"
}

// ---------------------------------------------------------------------------
// Raw Google Calendar API response types
// ---------------------------------------------------------------------------

interface GoogleCalendarEventDateTime {
  dateTime?: string; // ISO 8601 with timezone offset
  date?: string; // YYYY-MM-DD (all-day events)
  timeZone?: string;
}

interface GoogleCalendarEvent {
  id: string;
  summary?: string;
  start: GoogleCalendarEventDateTime;
  end: GoogleCalendarEventDateTime;
  status?: string;
  extendedProperties?: {
    private?: Record<string, string>;
  };
}

interface GoogleCalendarListResponse {
  items?: GoogleCalendarEvent[];
  nextPageToken?: string;
}

interface GoogleCalendarResource {
  id: string;
  summary?: string;
  description?: string;
}

interface GoogleCalendarResourcesResponse {
  items?: GoogleCalendarResource[];
  nextPageToken?: string;
}

// ---------------------------------------------------------------------------
// Timezone-aware time extraction (exported for testing)
// ---------------------------------------------------------------------------

export function toLocalParts(
  isoDatetime: string,
  timeZone: string,
): { date: string; time: string } {
  const d = new Date(isoDatetime);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);

  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "00";

  const year = get("year");
  const month = get("month");
  const day = get("day");
  const rawHour = get("hour");
  const hour = rawHour === "24" ? "00" : rawHour;
  const minute = get("minute");

  return {
    date: `${year}-${month}-${day}`,
    time: `${hour}:${minute}`,
  };
}

export function getUtcBoundsForLocalDate(
  planDate: string,
  timeZone: string,
): { timeMin: string; timeMax: string } {
  const getUtcForLocal = (localDateStr: string, localTimeStr: string) => {
    let utcTime = new Date(`${localDateStr}T${localTimeStr}Z`).getTime();

    for (let i = 0; i < 5; i++) {
      const parts = toLocalParts(new Date(utcTime).toISOString(), timeZone);
      const formattedLocal = `${parts.date}T${parts.time}:00Z`;
      const targetLocal = `${localDateStr}T${localTimeStr}:00Z`;

      const diff = new Date(targetLocal).getTime() - new Date(formattedLocal).getTime();
      if (diff === 0) break;
      utcTime += diff;
    }
    return new Date(utcTime).toISOString();
  };

  const timeMin = getUtcForLocal(planDate, "00:00");
  const d = new Date(`${planDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  const nextDayStr = d.toISOString().split("T")[0];
  const timeMax = getUtcForLocal(nextDayStr, "00:00");

  return { timeMin, timeMax };
}

// ---------------------------------------------------------------------------
// Event normalization (pure function, exported for testing)
// ---------------------------------------------------------------------------

/**
 * Normalizes raw Google Calendar events for a specific plan date and timezone.
 *
 * All-day events are intentionally skipped so a birthday/holiday does not
 * block the entire working day. Events created by this application are also
 * skipped because they are already represented by the planner's own plan
 * blocks; otherwise a confirmed AI Planner event would block the same slot
 * when a plan is regenerated.
 */
export function normalizeCalendarEvents(
  rawEvents: GoogleCalendarEvent[],
  planDate: string,
  timeZone: string,
): CalendarEvent[] {
  const results: CalendarEvent[] = [];

  for (const event of rawEvents) {
    if (event.status === "cancelled") continue;

    if (event.extendedProperties?.private?.app === "ai-productivity-assistant") {
      continue;
    }

    if (!event.start.dateTime || !event.end.dateTime) continue;

    const startLocal = toLocalParts(event.start.dateTime, timeZone);
    const endLocal = toLocalParts(event.end.dateTime, timeZone);

    if (startLocal.date > planDate && endLocal.date > planDate) continue;
    if (endLocal.date < planDate && startLocal.date < planDate) continue;

    const startTime = startLocal.date < planDate ? "00:00" : startLocal.time;
    const endTime = endLocal.date > planDate ? "23:59" : endLocal.time;

    if (startTime >= endTime) continue;

    results.push({
      googleEventId: event.id,
      title: event.summary ?? "(No title)",
      startTime,
      endTime,
    });
  }

  return results.sort((a, b) => a.startTime.localeCompare(b.startTime));
}

// ---------------------------------------------------------------------------
// Fetch events from Google Calendar API
// ---------------------------------------------------------------------------

/**
 * Fetches timed events from every calendar visible to the connected Google
 * account for the given local plan date. This includes secondary calendars,
 * including the app's dedicated "AI Planner" calendar.
 *
 * Manually-created events on the AI Planner calendar are treated as real
 * commitments. Events created by this app are filtered out because they are
 * already represented by the app's own plan blocks.
 */
export async function fetchCalendarEvents(
  accessToken: string,
  planDate: string,
  timeZone: string,
): Promise<CalendarEvent[]> {
  const { timeMin, timeMax } = getUtcBoundsForLocalDate(planDate, timeZone);
  const authHeaders = { Authorization: `Bearer ${accessToken}` };

  const calendars: GoogleCalendarResource[] = [];
  let calendarPageToken: string | undefined;

  do {
    const calendarParams = new URLSearchParams({
      maxResults: "250",
      showHidden: "false",
    });
    if (calendarPageToken) calendarParams.set("pageToken", calendarPageToken);

    const calendarResponse = await fetch(
      `https://www.googleapis.com/calendar/v3/users/me/calendarList?${calendarParams.toString()}`,
      { headers: authHeaders },
    );

    if (!calendarResponse.ok) {
      throw new Error(
        `Google Calendar list request failed (${calendarResponse.status}): ${await calendarResponse.text()}`,
      );
    }

    const calendarBody = (await calendarResponse.json()) as GoogleCalendarResourcesResponse;
    calendars.push(...(calendarBody.items ?? []));
    calendarPageToken = calendarBody.nextPageToken;
  } while (calendarPageToken);

  const allEvents: GoogleCalendarEvent[] = [];

  for (const calendar of calendars) {
    let pageToken: string | undefined;

    do {
      const params = new URLSearchParams({
        timeMin,
        timeMax,
        timeZone,
        singleEvents: "true",
        orderBy: "startTime",
        maxResults: "2500",
      });
      if (pageToken) params.set("pageToken", pageToken);

      const response = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendar.id)}/events?${params.toString()}`,
        { headers: authHeaders },
      );

      if (!response.ok) {
        throw new Error(
          `Google Calendar API request failed for ${calendar.summary ?? calendar.id} (${response.status}): ${await response.text()}`,
        );
      }

      const body = (await response.json()) as GoogleCalendarListResponse;
      allEvents.push(...(body.items ?? []));
      pageToken = body.nextPageToken;
    } while (pageToken);
  }

  return normalizeCalendarEvents(allEvents, planDate, timeZone);
}
