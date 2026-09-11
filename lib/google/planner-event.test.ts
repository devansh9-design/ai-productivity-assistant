import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPlannerEvent } from "@/lib/google/planner-calendar";

const originalFetch = global.fetch;

beforeEach(() => {
  global.fetch = vi.fn();
});

afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("createPlannerEvent", () => {
  it("creates a timed event in the dedicated planner calendar", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce({
      status: 200,
      text: async () => JSON.stringify({ id: "google-event-1" }),
    } as Response);

    const result = await createPlannerEvent("access-token", "planner@group.calendar.google.com", {
      planDate: "2026-09-10",
      timeZone: "Asia/Kolkata",
      title: "Deep Work",
      startTime: "09:30",
      endTime: "10:30",
      dailyPlanId: "plan-1",
      planBlockId: "block-1",
    });

    expect(result).toBe("google-event-1");
    expect(global.fetch).toHaveBeenCalledWith(
      "https://www.googleapis.com/calendar/v3/calendars/planner%40group.calendar.google.com/events",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer access-token" }),
        body: JSON.stringify({
          summary: "Deep Work",
          description: "AI Planner work block. Plan: plan-1. Block: block-1.",
          start: { dateTime: "2026-09-10T09:30:00", timeZone: "Asia/Kolkata" },
          end: { dateTime: "2026-09-10T10:30:00", timeZone: "Asia/Kolkata" },
          extendedProperties: {
            private: {
              app: "ai-productivity-assistant",
              dailyPlanId: "plan-1",
              planBlockId: "block-1",
            },
          },
        }),
      }),
    );
  });

  it("surfaces Google API errors", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce({
      status: 403,
      text: async () => JSON.stringify({ error: { message: "Insufficient Permission" } }),
    } as Response);

    await expect(
      createPlannerEvent("access-token", "planner-id", {
        planDate: "2026-09-10",
        timeZone: "Asia/Kolkata",
        title: "Deep Work",
        startTime: "09:30",
        endTime: "10:30",
        dailyPlanId: "plan-1",
        planBlockId: "block-1",
      }),
    ).rejects.toThrow("Insufficient Permission");
  });
});
