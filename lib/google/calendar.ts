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
}

interface GoogleCalendarListResponse {
  items?: GoogleCalendarEvent[];
}

// ---------------------------------------------------------------------------
// Timezone-aware time extraction (exported for testing)
// ---------------------------------------------------------------------------

/**
 * Converts an ISO 8601 datetime string to { date: "YYYY-MM-DD", time: "HH:MM" }
 * in the specified timezone using Intl.DateTimeFormat.
 */
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
  // Intl may return "24" for midnight in some locales; normalize to "00"
  const rawHour = get("hour");
  const hour = rawHour === "24" ? "00" : rawHour;
  const minute = get("minute");

  return {
    date: `${year}-${month}-${day}`,
    time: `${hour}:${minute}`,
  };
}

/**
 * Computes the exact UTC time range for a given local date in a specific IANA timezone.
 * Handles DST transitions implicitly by determining the exact UTC time where the
 * target local time hits 00:00:00.
 */
export function getUtcBoundsForLocalDate(
  planDate: string,
  timeZone: string,
): { timeMin: string; timeMax: string } {
  const getUtcForLocal = (localDateStr: string, localTimeStr: string) => {
    // Initial guess: treat the local date/time as UTC
    let utcTime = new Date(`${localDateStr}T${localTimeStr}Z`).getTime();
    
    // Iteratively adjust until formatting the UTC time in the target timezone
    // matches the requested local date/time exactly.
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

  // timeMin: Start of the target plan date
  const timeMin = getUtcForLocal(planDate, "00:00");
  
  // timeMax: Start of the following day
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
 * Policy: All-day events (those with start.date instead of start.dateTime)
 * are intentionally skipped to prevent full-day lockouts. This avoids blocking
 * all task scheduling on days with all-day calendar markers (e.g. birthdays,
 * holidays, multi-day conferences). Revisit when partial-day handling or
 * user-configurable all-day behavior is implemented.
 */
export function normalizeCalendarEvents(
  rawEvents: GoogleCalendarEvent[],
  planDate: string,
  timeZone: string,
): CalendarEvent[] {
  const results: CalendarEvent[] = [];

  for (const event of rawEvents) {
    // Skip cancelled events
    if (event.status === "cancelled") continue;

    // Skip all-day events (start.date without start.dateTime).
    // See docstring above for rationale.
    if (!event.start.dateTime || !event.end.dateTime) continue;

    const startLocal = toLocalParts(event.start.dateTime, timeZone);
    const endLocal = toLocalParts(event.end.dateTime, timeZone);

    // Only include events that overlap with the plan date
    // If event starts after plan date or ends before plan date, skip it
    if (startLocal.date > planDate && endLocal.date > planDate) continue;
    if (endLocal.date < planDate && startLocal.date < planDate) continue;

    // Clamp to plan date boundaries
    // If event starts before plan date (spans from previous day), clamp start to 00:00
    const startTime = startLocal.date < planDate ? "00:00" : startLocal.time;
    // If event ends after plan date (spans into next day), clamp end to 23:59
    const endTime = endLocal.date > planDate ? "23:59" : endLocal.time;

    // Skip zero-duration or negative-duration events within the plan date
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
 * Fetches events from the user's primary Google Calendar for the given plan date.
 * Returns normalized CalendarEvent[] in the user's timezone.
 *
 * @throws Error on API failure (caller should handle as calendar_sync_failed)
 */
export async function fetchCalendarEvents(
  accessToken: string,
  planDate: string,
  timeZone: string,
): Promise<CalendarEvent[]> {
  // Build exact UTC bounds for the local day to avoid missing events due to UTC shift
  const { timeMin, timeMax } = getUtcBoundsForLocalDate(planDate, timeZone);

  const params = new URLSearchParams({
    timeMin,
    timeMax,
    timeZone,
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: "250",
  });

  const response = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params.toString()}`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  );

  if (!response.ok) {
    throw new Error(
      `Google Calendar API request failed (${response.status}): ${await response.text()}`,
    );
  }

  const body = (await response.json()) as GoogleCalendarListResponse;
  return normalizeCalendarEvents(body.items ?? [], planDate, timeZone);
}
