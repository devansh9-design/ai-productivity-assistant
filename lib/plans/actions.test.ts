import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { generateDraftPlan } from "@/lib/plans/actions";
import * as authModule from "@/lib/auth/require-user";
import * as oauthModule from "@/lib/google/oauth";
import * as calendarModule from "@/lib/google/calendar";
import { cookies } from "next/headers";

// Mock next/headers
vi.mock("next/headers", () => ({
  cookies: vi.fn(),
}));

// Mock next/cache
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

describe("generateDraftPlan - Timezone Validation (Day 6)", () => {
  const mockSupabase = {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          in: vi.fn(() => ({
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          })),
          not: vi.fn(() => ({
            returns: vi.fn().mockResolvedValue({ data: [], error: null }),
          })),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          returns: vi.fn().mockResolvedValue({ data: [], error: null }),
        })),
        returns: vi.fn().mockResolvedValue({ data: [], error: null }),
      })),
    })),
    rpc: vi.fn(() => ({
      single: vi.fn().mockResolvedValue({ data: { id: "plan-1" }, error: null })
    })),
  };

  beforeEach(() => {
    vi.spyOn(authModule, "requireUser").mockResolvedValue({
      user: { id: "user-1" },
      supabase: mockSupabase,
    } as unknown as never);

    // Default: calendar connected
    vi.spyOn(oauthModule, "getValidAccessToken").mockResolvedValue({ token: "valid-token" });

    // Mock calendar API to return empty events for testing timezone validation success
    vi.spyOn(calendarModule, "fetchCalendarEvents").mockResolvedValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fails safely when calendar is connected but timezone cookie is missing", async () => {
    // Missing timezone cookie
    vi.mocked(cookies).mockResolvedValue({
      get: vi.fn().mockReturnValue(undefined),
    } as unknown as never);

    const result = await generateDraftPlan();
    expect(result).toEqual({
      error: "Timezone could not be determined. Please refresh the page to sync your timezone.",
    });
    
    // Ensure we did not fall back to UTC and proceed
    expect(calendarModule.fetchCalendarEvents).not.toHaveBeenCalled();
    expect(mockSupabase.rpc).not.toHaveBeenCalled();
  });

  it("fails safely when calendar is connected but timezone cookie is invalid", async () => {
    vi.mocked(cookies).mockResolvedValue({
      get: vi.fn().mockReturnValue({ value: "Invalid/Timezone" }),
    } as unknown as never);

    const result = await generateDraftPlan();
    expect(result).toEqual({
      error: "Invalid timezone detected. Please refresh the page to sync your timezone.",
    });

    expect(calendarModule.fetchCalendarEvents).not.toHaveBeenCalled();
  });

  it("succeeds when calendar is connected and timezone is valid (Asia/Kolkata)", async () => {
    vi.mocked(cookies).mockResolvedValue({
      get: vi.fn().mockReturnValue({ value: "Asia/Kolkata" }),
    } as unknown as never);

    await generateDraftPlan();

    expect(calendarModule.fetchCalendarEvents).toHaveBeenCalledWith(
      "valid-token",
      expect.any(String),
      "Asia/Kolkata"
    );
    expect(mockSupabase.rpc).toHaveBeenCalled();
  });

  it("succeeds when calendar is connected and timezone is valid (America/New_York)", async () => {
    vi.mocked(cookies).mockResolvedValue({
      get: vi.fn().mockReturnValue({ value: "America/New_York" }),
    } as unknown as never);

    await generateDraftPlan();

    expect(calendarModule.fetchCalendarEvents).toHaveBeenCalledWith(
      "valid-token",
      expect.any(String),
      "America/New_York"
    );
    expect(mockSupabase.rpc).toHaveBeenCalled();
  });

  it("falls back to UTC silently if calendar is NOT connected and timezone is missing", async () => {
    // Calendar not connected
    vi.spyOn(oauthModule, "getValidAccessToken").mockResolvedValue({ error: "not_connected" });

    // Missing timezone cookie
    vi.mocked(cookies).mockResolvedValue({
      get: vi.fn().mockReturnValue(undefined),
    } as unknown as never);

    await generateDraftPlan();

    // The fetch shouldn't happen, but plan creation SHOULD proceed (using UTC date)
    expect(calendarModule.fetchCalendarEvents).not.toHaveBeenCalled();
    expect(mockSupabase.rpc).toHaveBeenCalled();
  });
});
