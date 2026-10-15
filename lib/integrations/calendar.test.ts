import { describe, expect, it, vi } from "vitest";
import { GoogleRequestError } from "@/lib/google/errors";
import {
  CALENDAR_ERROR_MESSAGES,
  DEFAULT_CALENDAR_STATUS,
  calendarSkipNote,
  classifyCalendarError,
  describeCalendarState,
  isGoogleFailure,
  readCalendarForPlanning,
  tokenErrorCode,
  wantsPlanWithoutCalendar,
} from "@/lib/integrations/calendar";

const event = { googleEventId: "e1", title: "Standup", startTime: "09:00", endTime: "09:30" };

function deps(overrides: Partial<Parameters<typeof readCalendarForPlanning>[0]> = {}) {
  return {
    status: { planningEnabled: true, needsReconnect: false },
    withoutCalendar: false,
    getToken: vi.fn().mockResolvedValue({ token: "t" }),
    fetchEvents: vi.fn().mockResolvedValue([event]),
    ...overrides,
  };
}

describe("readCalendarForPlanning", () => {
  it("reads events when planning is enabled", async () => {
    expect(await readCalendarForPlanning(deps())).toEqual({ kind: "events", events: [event] });
  });

  it("makes no Google call while paused, even if the form asks for the calendar", async () => {
    const input = deps({ status: { planningEnabled: false, needsReconnect: true } });
    expect(await readCalendarForPlanning(input)).toEqual({ kind: "skipped", reason: "paused" });
    expect(input.getToken).not.toHaveBeenCalled();
    expect(input.fetchEvents).not.toHaveBeenCalled();
  });

  it("makes no Google call when the user chose to plan without the calendar", async () => {
    const input = deps({ withoutCalendar: true });
    expect(await readCalendarForPlanning(input)).toEqual({ kind: "skipped", reason: "without_calendar" });
    expect(input.getToken).not.toHaveBeenCalled();
  });

  it("treats a never-connected calendar as skipped", async () => {
    const input = deps({ getToken: vi.fn().mockResolvedValue({ error: "not_connected" }) });
    expect(await readCalendarForPlanning(input)).toEqual({ kind: "skipped", reason: "not_connected" });
  });

  it("reports a revoked calendar as needing reconnection, before and after its credentials are removed", async () => {
    expect(await readCalendarForPlanning(deps({ getToken: vi.fn().mockResolvedValue({ error: "reconnect_required" }) })))
      .toEqual({ kind: "failed", code: "reconnect_required" });
    expect(await readCalendarForPlanning(deps({
      status: { planningEnabled: true, needsReconnect: true },
      getToken: vi.fn().mockResolvedValue({ error: "not_connected" }),
    }))).toEqual({ kind: "failed", code: "reconnect_required" });
  });

  it("reports token and API failures instead of returning an empty calendar", async () => {
    expect(await readCalendarForPlanning(deps({ getToken: vi.fn().mockResolvedValue({ error: "calendar_sync_failed" }) })))
      .toEqual({ kind: "failed", code: "unavailable" });
    expect(await readCalendarForPlanning(deps({ fetchEvents: vi.fn().mockRejectedValue(new GoogleRequestError("x", 403)) })))
      .toEqual({ kind: "failed", code: "permission_denied" });
    expect(await readCalendarForPlanning(deps({ fetchEvents: vi.fn().mockRejectedValue(new TypeError("fetch failed")) })))
      .toEqual({ kind: "failed", code: "unavailable" });
  });

  it("asks for the timezone only when the calendar would actually be read", async () => {
    const input = deps({ timeZoneError: "Timezone missing" });
    expect(await readCalendarForPlanning(input)).toEqual({ kind: "invalid_timezone", error: "Timezone missing" });
    expect(input.fetchEvents).not.toHaveBeenCalled();
    expect(await readCalendarForPlanning(deps({ timeZoneError: "Timezone missing", getToken: vi.fn().mockResolvedValue({ error: "not_connected" }) })))
      .toEqual({ kind: "skipped", reason: "not_connected" });
  });
});

describe("classifyCalendarError", () => {
  it("names the cause from the HTTP status only", () => {
    expect(classifyCalendarError(new GoogleRequestError("a", 401))).toBe("reconnect_required");
    expect(classifyCalendarError(new GoogleRequestError("b", 403))).toBe("permission_denied");
    expect(classifyCalendarError(new GoogleRequestError("c", 429))).toBe("unavailable");
    expect(classifyCalendarError(new GoogleRequestError("d", 500))).toBe("unavailable");
    expect(classifyCalendarError(new Error("anything"))).toBe("unavailable");
  });

  it("separates Google failures from the app's own errors", () => {
    expect(isGoogleFailure(new GoogleRequestError("a", 500))).toBe(true);
    expect(isGoogleFailure(new TypeError("fetch failed"))).toBe(true);
    expect(isGoogleFailure(new Error("mapping insert failed"))).toBe(false);
  });

  it("maps token results", () => {
    expect(tokenErrorCode({ token: "t" }, true)).toBeNull();
    expect(tokenErrorCode({ error: "not_connected" }, false)).toBeNull();
    expect(tokenErrorCode({ error: "not_connected" }, true)).toBe("reconnect_required");
  });

  it("uses short app-written messages that fit the database limit", () => {
    for (const message of Object.values(CALENDAR_ERROR_MESSAGES)) expect(message.length).toBeLessThanOrEqual(200);
  });
});

describe("describeCalendarState", () => {
  const status = (fields: Partial<typeof DEFAULT_CALENDAR_STATUS>) => ({ ...DEFAULT_CALENDAR_STATUS, ...fields });

  it("puts needing reconnection first", () => {
    expect(describeCalendarState(status({ needsReconnect: true }), false)).toBe("needs_reconnect");
    expect(describeCalendarState(status({ needsReconnect: true }), true)).toBe("needs_reconnect");
  });

  it("shows a failure only until a later success", () => {
    const failed = { lastErrorAt: "2026-10-16T10:00:00Z", lastErrorCode: "unavailable" as const };
    expect(describeCalendarState(status({ ...failed, lastReadAt: "2026-10-16T09:00:00Z" }), true)).toBe("failing");
    expect(describeCalendarState(status({ ...failed, lastPublishedAt: "2026-10-16T11:00:00Z" }), true)).toBe("connected");
  });

  it("is paused when either switch is off, unless the connection itself needs attention", () => {
    const failed = { lastErrorAt: "2026-10-16T10:00:00Z", lastErrorCode: "unavailable" as const };
    expect(describeCalendarState(status({ planningEnabled: false }), true)).toBe("paused");
    expect(describeCalendarState(status({ publishingEnabled: false }), true)).toBe("paused");
    expect(describeCalendarState(status({ planningEnabled: false, publishingEnabled: false, ...failed }), true)).toBe("paused");
    expect(describeCalendarState(status({ publishingEnabled: false }), false)).toBe("not_connected");
    expect(describeCalendarState(status({ publishingEnabled: false, needsReconnect: true }), true)).toBe("needs_reconnect");
  });

  it("is not connected without credentials", () => {
    expect(describeCalendarState(DEFAULT_CALENDAR_STATUS, false)).toBe("not_connected");
    expect(describeCalendarState(DEFAULT_CALENDAR_STATUS, true)).toBe("connected");
  });
});

describe("plan notes", () => {
  it("reads the explicit choice only from the form", () => {
    const form = new FormData();
    expect(wantsPlanWithoutCalendar(undefined)).toBe(false);
    expect(wantsPlanWithoutCalendar(form)).toBe(false);
    form.set("without_calendar", "1");
    expect(wantsPlanWithoutCalendar(form)).toBe(true);
  });

  it("explains every plan made without the calendar", () => {
    expect(calendarSkipNote({ kind: "skipped", reason: "paused" })).toContain("paused");
    expect(calendarSkipNote({ kind: "skipped", reason: "without_calendar" })).toContain("meetings are not included");
    expect(calendarSkipNote({ kind: "skipped", reason: "not_connected" })).toBeNull();
    expect(calendarSkipNote({ kind: "events", events: [] })).toBeNull();
  });
});
