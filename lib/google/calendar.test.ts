import { describe, it, expect } from "vitest";
import { toLocalParts, normalizeCalendarEvents, getUtcBoundsForLocalDate } from "@/lib/google/calendar";

// ---------------------------------------------------------------------------
// toLocalParts — timezone conversion
// ---------------------------------------------------------------------------

describe("toLocalParts", () => {
  it("converts UTC datetime to IST (Asia/Kolkata, UTC+5:30)", () => {
    const result = toLocalParts("2026-08-06T10:00:00Z", "Asia/Kolkata");
    expect(result.date).toBe("2026-08-06");
    expect(result.time).toBe("15:30");
  });

  it("converts UTC datetime to US Eastern (America/New_York, UTC-4 in summer)", () => {
    const result = toLocalParts("2026-08-06T14:00:00Z", "America/New_York");
    expect(result.date).toBe("2026-08-06");
    expect(result.time).toBe("10:00");
  });

  it("handles timezone offset crossing midnight forward", () => {
    const result = toLocalParts("2026-08-06T23:00:00Z", "Asia/Kolkata");
    expect(result.date).toBe("2026-08-07");
    expect(result.time).toBe("04:30");
  });

  it("handles timezone offset crossing midnight backward", () => {
    const result = toLocalParts("2026-08-07T02:00:00Z", "America/New_York");
    expect(result.date).toBe("2026-08-06");
    expect(result.time).toBe("22:00");
  });

  it("handles ISO strings with timezone offsets", () => {
    const result = toLocalParts("2026-08-06T15:30:00+05:30", "UTC");
    expect(result.date).toBe("2026-08-06");
    expect(result.time).toBe("10:00");
  });
});

// ---------------------------------------------------------------------------
// normalizeCalendarEvents
// ---------------------------------------------------------------------------

describe("normalizeCalendarEvents", () => {
  const planDate = "2026-08-06";
  const tz = "Asia/Kolkata";

  it("returns empty array for empty input", () => {
    expect(normalizeCalendarEvents([], planDate, tz)).toEqual([]);
  });

  it("normalizes a simple timed event", () => {
    const events = [
      {
        id: "evt-1",
        summary: "Team standup",
        start: { dateTime: "2026-08-06T04:30:00Z" },
        end: { dateTime: "2026-08-06T05:00:00Z" },
      },
    ];
    const result = normalizeCalendarEvents(events, planDate, tz);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      googleEventId: "evt-1",
      title: "Team standup",
      startTime: "10:00",
      endTime: "10:30",
    });
  });

  it("skips events created by the AI Productivity Assistant", () => {
    const events = [
      {
        id: "evt-app",
        summary: "AI Planner task",
        start: { dateTime: "2026-08-06T04:30:00Z" },
        end: { dateTime: "2026-08-06T05:00:00Z" },
        extendedProperties: {
          private: {
            app: "ai-productivity-assistant",
          },
        },
      },
    ];
    expect(normalizeCalendarEvents(events, planDate, tz)).toEqual([]);
  });

  it("keeps a manually-created event on the AI Planner calendar", () => {
    const events = [
      {
        id: "evt-manual-ai-planner",
        summary: "Manual AI Planner commitment",
        start: { dateTime: "2026-08-06T04:30:00Z" },
        end: { dateTime: "2026-08-06T05:30:00Z" },
      },
    ];
    const result = normalizeCalendarEvents(events, planDate, tz);
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe("Manual AI Planner commitment");
  });

  it("skips all-day events (start.date without start.dateTime)", () => {
    const events = [
      {
        id: "evt-allday",
        summary: "Public Holiday",
        start: { date: "2026-08-06" },
        end: { date: "2026-08-07" },
      },
    ];
    expect(normalizeCalendarEvents(events, planDate, tz)).toHaveLength(0);
  });

  it("skips cancelled events", () => {
    const events = [
      {
        id: "evt-cancelled",
        summary: "Cancelled meeting",
        status: "cancelled",
        start: { dateTime: "2026-08-06T04:30:00Z" },
        end: { dateTime: "2026-08-06T05:00:00Z" },
      },
    ];
    expect(normalizeCalendarEvents(events, planDate, tz)).toHaveLength(0);
  });

  it("clamps event spanning midnight (starts previous day, ends on plan date)", () => {
    const events = [
      {
        id: "evt-span",
        summary: "Late night session",
        start: { dateTime: "2026-08-05T21:00:00Z" },
        end: { dateTime: "2026-08-06T01:00:00Z" },
      },
    ];
    const result = normalizeCalendarEvents(events, planDate, tz);
    expect(result).toHaveLength(1);
    expect(result[0].startTime).toBe("02:30");
    expect(result[0].endTime).toBe("06:30");
  });

  it("clamps event spanning into the next day", () => {
    const events = [
      {
        id: "evt-overnight",
        summary: "Overnight work",
        start: { dateTime: "2026-08-06T15:00:00Z" },
        end: { dateTime: "2026-08-06T19:30:00Z" },
      },
    ];
    const result = normalizeCalendarEvents(events, planDate, tz);
    expect(result).toHaveLength(1);
    expect(result[0].startTime).toBe("20:30");
    expect(result[0].endTime).toBe("23:59");
  });

  it("clamps event starting before plan date to 00:00", () => {
    const events = [
      {
        id: "evt-prev-day",
        summary: "Carried over",
        start: { dateTime: "2026-08-05T16:30:00Z" },
        end: { dateTime: "2026-08-05T20:30:00Z" },
      },
    ];
    const result = normalizeCalendarEvents(events, planDate, tz);
    expect(result).toHaveLength(1);
    expect(result[0].startTime).toBe("00:00");
    expect(result[0].endTime).toBe("02:00");
  });

  it("preserves order by start time across multiple events", () => {
    const events = [
      {
        id: "evt-b",
        summary: "Afternoon",
        start: { dateTime: "2026-08-06T09:30:00Z" },
        end: { dateTime: "2026-08-06T10:00:00Z" },
      },
      {
        id: "evt-a",
        summary: "Morning",
        start: { dateTime: "2026-08-06T04:30:00Z" },
        end: { dateTime: "2026-08-06T05:00:00Z" },
      },
    ];
    const result = normalizeCalendarEvents(events, planDate, tz);
    expect(result).toHaveLength(2);
    expect(result[0].title).toBe("Morning");
    expect(result[1].title).toBe("Afternoon");
  });

  it("skips events entirely outside the plan date", () => {
    const events = [
      {
        id: "evt-outside",
        summary: "Tomorrow",
        start: { dateTime: "2026-08-07T04:30:00Z" },
        end: { dateTime: "2026-08-07T05:00:00Z" },
      },
    ];
    expect(normalizeCalendarEvents(events, planDate, tz)).toHaveLength(0);
  });

  it("uses '(No title)' for events without summary", () => {
    const events = [
      {
        id: "evt-notitle",
        start: { dateTime: "2026-08-06T04:30:00Z" },
        end: { dateTime: "2026-08-06T05:00:00Z" },
      },
    ];
    const result = normalizeCalendarEvents(events, planDate, tz);
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe("(No title)");
  });
});

// ---------------------------------------------------------------------------
// getUtcBoundsForLocalDate
// ---------------------------------------------------------------------------

describe("getUtcBoundsForLocalDate", () => {
  it("computes accurate UTC bounds for Asia/Kolkata local-day boundaries (UTC+5:30)", () => {
    const result = getUtcBoundsForLocalDate("2026-08-06", "Asia/Kolkata");
    expect(result.timeMin).toBe("2026-08-05T18:30:00.000Z");
    expect(result.timeMax).toBe("2026-08-06T18:30:00.000Z");
  });

  it("handles America/New_York local-day boundaries in Summer (EDT UTC-4)", () => {
    const result = getUtcBoundsForLocalDate("2026-08-06", "America/New_York");
    expect(result.timeMin).toBe("2026-08-06T04:00:00.000Z");
    expect(result.timeMax).toBe("2026-08-07T04:00:00.000Z");
  });

  it("handles America/New_York local-day boundaries in Winter (EST UTC-5)", () => {
    const result = getUtcBoundsForLocalDate("2026-02-06", "America/New_York");
    expect(result.timeMin).toBe("2026-02-06T05:00:00.000Z");
    expect(result.timeMax).toBe("2026-02-07T05:00:00.000Z");
  });

  it("handles America/New_York DST correctness across the spring forward transition", () => {
    const result = getUtcBoundsForLocalDate("2026-03-08", "America/New_York");
    expect(result.timeMin).toBe("2026-03-08T05:00:00.000Z");
    expect(result.timeMax).toBe("2026-03-09T04:00:00.000Z");
  });

  it("handles America/New_York DST correctness across the fall back transition", () => {
    const result = getUtcBoundsForLocalDate("2026-11-01", "America/New_York");
    expect(result.timeMin).toBe("2026-11-01T04:00:00.000Z");
    expect(result.timeMax).toBe("2026-11-02T05:00:00.000Z");
  });

  it("ensures an early-morning IST event missed by old UTC query is caught", () => {
    const result = getUtcBoundsForLocalDate("2026-08-06", "Asia/Kolkata");
    const earlyEventUtcStr = "2026-08-05T21:30:00.000Z";
    expect(new Date(earlyEventUtcStr).getTime()).toBeGreaterThanOrEqual(new Date(result.timeMin).getTime());
    expect(new Date(earlyEventUtcStr).getTime()).toBeLessThan(new Date(result.timeMax).getTime());
    const oldTimeMin = "2026-08-06T00:00:00.000Z";
    expect(new Date(earlyEventUtcStr).getTime()).toBeLessThan(new Date(oldTimeMin).getTime());
  });
});
