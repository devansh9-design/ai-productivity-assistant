import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getOrCreatePlannerCalendar, updatePlannerEvent, deletePlannerEvent } from "@/lib/google/planner-calendar";
import * as serviceRoleModule from "@/lib/supabase/service-role";

const originalFetch = global.fetch;

beforeEach(() => {
  global.fetch = vi.fn();
  vi.restoreAllMocks();
});

afterEach(() => {
  global.fetch = originalFetch;
});

function mockSupabase(existing: { calendar_id: string } | null = null) {
  const maybeSingle = vi.fn().mockResolvedValue({ data: existing, error: null });
  const eqSelect = vi.fn().mockReturnValue({ maybeSingle });
  const select = vi.fn().mockReturnValue({ eq: eqSelect });
  const deleteEq = vi.fn().mockResolvedValue({ error: null });
  const deleteFn = vi.fn().mockReturnValue({ eq: deleteEq });
  const upsert = vi.fn().mockResolvedValue({ error: null });
  const from = vi.fn().mockReturnValue({ select, delete: deleteFn, upsert });

  vi.spyOn(serviceRoleModule, "createServiceRoleClient").mockReturnValue({
    from,
  } as unknown as ReturnType<typeof serviceRoleModule.createServiceRoleClient>);

  return { from, upsert, deleteFn, deleteEq };
}

describe("getOrCreatePlannerCalendar", () => {
  it("returns a persisted calendar after verifying it still exists", async () => {
    const db = mockSupabase({ calendar_id: "planner@example.com" });
    vi.mocked(global.fetch).mockResolvedValueOnce({
      status: 200,
      text: async () => JSON.stringify({ id: "planner@example.com", summary: "AI Planner" }),
    } as Response);

    const result = await getOrCreatePlannerCalendar("user-1", "access-token");

    expect(result).toBe("planner@example.com");
    expect(global.fetch).toHaveBeenCalledWith(
      "https://www.googleapis.com/calendar/v3/calendars/planner%40example.com",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer access-token" }),
      }),
    );
    expect(db.upsert).not.toHaveBeenCalled();
  });

  it("reuses an existing matching Google calendar when no mapping exists", async () => {
    const db = mockSupabase(null);
    vi.mocked(global.fetch).mockResolvedValueOnce({
      status: 200,
      text: async () =>
        JSON.stringify({
          items: [
            {
              id: "existing-planner@group.calendar.google.com",
              summary: "AI Planner",
              description: "Dedicated calendar for confirmed plans from AI Productivity Assistant.",
            },
          ],
        }),
    } as Response);

    const result = await getOrCreatePlannerCalendar("user-1", "access-token");

    expect(result).toBe("existing-planner@group.calendar.google.com");
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(db.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: "user-1",
        calendar_id: "existing-planner@group.calendar.google.com",
        summary: "AI Planner",
      }),
      { onConflict: "user_id" },
    );
  });

  it("creates and persists the planner calendar when no mapping or matching calendar exists", async () => {
    const db = mockSupabase(null);
    vi.mocked(global.fetch)
      .mockResolvedValueOnce({
        status: 200,
        text: async () => JSON.stringify({ items: [] }),
      } as Response)
      .mockResolvedValueOnce({
        status: 200,
        text: async () => JSON.stringify({ id: "new-planner@group.calendar.google.com" }),
      } as Response);

    const result = await getOrCreatePlannerCalendar("user-1", "access-token");

    expect(result).toBe("new-planner@group.calendar.google.com");
    expect(global.fetch).toHaveBeenNthCalledWith(
      1,
      "https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=250&showDeleted=false",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer access-token" }),
      }),
    );
    expect(global.fetch).toHaveBeenNthCalledWith(
      2,
      "https://www.googleapis.com/calendar/v3/calendars",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          summary: "AI Planner",
          description: "Dedicated calendar for confirmed plans from AI Productivity Assistant.",
        }),
      }),
    );
    expect(db.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: "user-1",
        calendar_id: "new-planner@group.calendar.google.com",
        summary: "AI Planner",
      }),
      { onConflict: "user_id" },
    );
  });

  it("removes a stale mapping and reuses an existing matching calendar", async () => {
    const db = mockSupabase({ calendar_id: "deleted@group.calendar.google.com" });
    vi.mocked(global.fetch)
      .mockResolvedValueOnce({ status: 404, text: async () => "not found" } as Response)
      .mockResolvedValueOnce({
        status: 200,
        text: async () =>
          JSON.stringify({
            items: [
              {
                id: "replacement@group.calendar.google.com",
                summary: "AI Planner",
                description: "Dedicated calendar for confirmed plans from AI Productivity Assistant.",
              },
            ],
          }),
      } as Response);

    const result = await getOrCreatePlannerCalendar("user-1", "access-token");

    expect(result).toBe("replacement@group.calendar.google.com");
    expect(db.deleteFn).toHaveBeenCalledWith();
    expect(db.deleteEq).toHaveBeenCalledWith("user_id", "user-1");
    expect(db.upsert).toHaveBeenCalled();
  });

  it("does not silently create a replacement when calendar verification fails", async () => {
    const db = mockSupabase({ calendar_id: "planner@group.calendar.google.com" });
    vi.mocked(global.fetch).mockResolvedValueOnce({
      status: 500,
      text: async () => JSON.stringify({ error: { message: "temporary failure" } }),
    } as Response);

    await expect(
      getOrCreatePlannerCalendar("user-1", "access-token"),
    ).rejects.toThrow("Could not verify AI Planner calendar (500).");
    expect(db.upsert).not.toHaveBeenCalled();
  });
});


describe("planner event reconciliation", () => {
  it("updates an existing event in place", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce({
      status: 200,
      text: async () => JSON.stringify({ id: "google-event-1" }),
    } as Response);

    await updatePlannerEvent("access-token", "planner-calendar", "google-event-1", {
      planDate: "2026-09-11",
      timeZone: "Asia/Kolkata",
      title: "DSA",
      startTime: "09:00:00",
      endTime: "10:00:00",
      dailyPlanId: "plan-1",
      planBlockId: "block-1",
    });

    expect(global.fetch).toHaveBeenCalledWith(
      "https://www.googleapis.com/calendar/v3/calendars/planner-calendar/events/google-event-1",
      expect.objectContaining({ method: "PATCH" }),
    );
  });

  it("treats a missing external event as recoverable by the caller", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce({
      status: 404,
      text: async () => "not found",
    } as Response);

    await expect(
      updatePlannerEvent("access-token", "planner-calendar", "missing-event", {
        planDate: "2026-09-11",
        timeZone: "Asia/Kolkata",
        title: "DSA",
        startTime: "09:00",
        endTime: "10:00",
        dailyPlanId: "plan-1",
        planBlockId: "block-1",
      }),
    ).rejects.toThrow("no longer exists");
  });

  it("deletes only the requested planner event", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce({
      status: 204,
      text: async () => "",
    } as Response);

    await deletePlannerEvent("access-token", "planner-calendar", "google-event-1");

    expect(global.fetch).toHaveBeenCalledWith(
      "https://www.googleapis.com/calendar/v3/calendars/planner-calendar/events/google-event-1",
      expect.objectContaining({ method: "DELETE" }),
    );
  });
});
