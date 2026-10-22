import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { confirmAIProposal, generateDraftPlan } from "@/lib/plans/actions";
import * as authModule from "@/lib/auth/require-user";
import * as oauthModule from "@/lib/google/oauth";
import * as calendarModule from "@/lib/google/calendar";
import * as personalizationModule from "@/lib/preferences/load";
import * as materializeModule from "@/lib/routines/materialize";
import { DEFAULT_PLANNING_PREFERENCES } from "@/lib/preferences/preferences";
import { cookies } from "next/headers";
import { GoogleRequestError } from "@/lib/google/errors";
import { CALENDAR_ERROR_MESSAGES, PLAN_WITHOUT_CALENDAR_WARNING } from "@/lib/integrations/calendar";

// Mock next/headers
// Creating routine tasks has its own database tests (scripts/db-tests/routine-tasks.sql).
vi.mock("@/lib/routines/materialize", () => ({
  materializeRoutineTasks: vi.fn().mockResolvedValue(0),
}));

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
          // integration_status: .eq("user_id").eq("provider").maybeSingle(); no row means defaults.
          eq: vi.fn(() => ({ maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }) })),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          returns: vi.fn().mockResolvedValue({ data: [], error: null }),
        })),
        returns: vi.fn().mockResolvedValue({ data: [], error: null }),
      })),
      upsert: vi.fn().mockResolvedValue({ error: null }),
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

    // Personalization has its own tests; these cases only exercise timezone handling.
    vi.spyOn(personalizationModule, "loadPersonalization").mockResolvedValue({
      preferences: DEFAULT_PLANNING_PREFERENCES, durationFactor: 1, durationSamples: 0, insights: [],
    });
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

describe("generateDraftPlan with the Day 12 calendar switches", () => {
  let statusWrites: Array<Record<string, unknown>>;

  function signInWith(statusRow: Record<string, unknown> | null) {
    statusWrites = [];
    const query = (data: unknown) => {
      const chain: Record<string, unknown> = {};
      for (const method of ["select", "eq", "in", "not"]) chain[method] = vi.fn(() => chain);
      chain.maybeSingle = vi.fn().mockResolvedValue({ data, error: null });
      chain.returns = vi.fn().mockResolvedValue({ data: [], error: null });
      chain.then = (resolve: (value: unknown) => unknown) => resolve({ data: [], error: null });
      return chain;
    };
    const supabase = {
      from: vi.fn((table: string) => table === "integration_status"
        ? { ...query(statusRow), upsert: vi.fn((row: Record<string, unknown>) => { statusWrites.push(row); return Promise.resolve({ error: null }); }) }
        : query(null)),
      rpc: vi.fn(() => ({ single: vi.fn().mockResolvedValue({ data: { id: "plan-1" }, error: null }) })),
    };
    vi.spyOn(authModule, "requireUser").mockResolvedValue({ user: { id: "user-1" }, supabase } as unknown as never);
    return supabase;
  }

  function form(withoutCalendar = false) {
    const data = new FormData();
    if (withoutCalendar) data.set("without_calendar", "1");
    return data;
  }

  beforeEach(() => {
    vi.mocked(cookies).mockResolvedValue({ get: vi.fn().mockReturnValue({ value: "Asia/Kolkata" }) } as unknown as never);
    vi.spyOn(oauthModule, "getValidAccessToken").mockResolvedValue({ token: "valid-token" });
    vi.spyOn(calendarModule, "fetchCalendarEvents").mockResolvedValue([]);
    vi.spyOn(personalizationModule, "loadPersonalization").mockResolvedValue({
      preferences: DEFAULT_PLANNING_PREFERENCES, durationFactor: 1, durationSamples: 0, insights: [],
    });
  });

  afterEach(() => vi.restoreAllMocks());

  it("creates today's routine tasks before planning, for the student's local date", async () => {
    const supabase = signInWith({ planning_enabled: false, publishing_enabled: true, needs_reconnect: false });
    await generateDraftPlan(form());
    expect(materializeModule.materializeRoutineTasks).toHaveBeenCalledWith(supabase, expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/));
  });

  it("makes no Google call while calendar planning is paused, and says so", async () => {
    const supabase = signInWith({ planning_enabled: false, publishing_enabled: true, needs_reconnect: false });
    const result = await generateDraftPlan(form());
    expect(oauthModule.getValidAccessToken).not.toHaveBeenCalled();
    expect(calendarModule.fetchCalendarEvents).not.toHaveBeenCalled();
    expect(supabase.rpc).toHaveBeenCalled();
    expect(result).toEqual({ message: expect.stringContaining("calendar planning is paused") });
  });

  it("does not create a plan when the calendar cannot be read, and offers the explicit choice", async () => {
    const supabase = signInWith(null);
    vi.mocked(calendarModule.fetchCalendarEvents).mockRejectedValue(new GoogleRequestError("backend error body", 503));
    const result = await generateDraftPlan(form());
    expect(supabase.rpc).not.toHaveBeenCalled();
    expect(result).toEqual({
      error: CALENDAR_ERROR_MESSAGES.unavailable,
      retryWith: { field: "without_calendar", label: "Plan without my calendar", warning: PLAN_WITHOUT_CALENDAR_WARNING },
    });
    expect(statusWrites).toEqual([expect.objectContaining({ last_error_operation: "read", last_error_code: "unavailable" })]);
    expect(JSON.stringify(statusWrites)).not.toContain("backend error body");
  });

  it("plans without the calendar only when the user chose it, and says meetings are not included", async () => {
    const supabase = signInWith(null);
    const result = await generateDraftPlan(form(true));
    expect(oauthModule.getValidAccessToken).not.toHaveBeenCalled();
    expect(calendarModule.fetchCalendarEvents).not.toHaveBeenCalled();
    expect(supabase.rpc).toHaveBeenCalled();
    expect(result).toEqual({ message: expect.stringContaining("meetings are not included") });
  });

  it("keeps asking to reconnect after Google revoked access, instead of planning without the calendar", async () => {
    const supabase = signInWith({ planning_enabled: true, publishing_enabled: true, needs_reconnect: true });
    vi.mocked(oauthModule.getValidAccessToken).mockResolvedValue({ error: "not_connected" });
    const result = await generateDraftPlan(form());
    expect(supabase.rpc).not.toHaveBeenCalled();
    expect(result).toMatchObject({ error: CALENDAR_ERROR_MESSAGES.reconnect_required });
  });

  it("records a successful read", async () => {
    signInWith(null);
    await generateDraftPlan(form());
    expect(statusWrites).toEqual([expect.objectContaining({ provider: "google_calendar", last_read_at: expect.any(String), needs_reconnect: false })]);
  });

  it("stops with an error when the switches cannot be read, rather than guessing", async () => {
    const supabase = signInWith(null);
    const original = supabase.from.getMockImplementation()!;
    supabase.from.mockImplementation((table: string) => table === "integration_status"
      ? { select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: { message: "relation does not exist" } }) }) }) }) }
      : original(table));
    expect(await generateDraftPlan(form())).toEqual({ error: expect.stringContaining("Google Calendar settings could not be loaded") });
    expect(oauthModule.getValidAccessToken).not.toHaveBeenCalled();
    expect(supabase.rpc).not.toHaveBeenCalled();
  });
});

describe("confirmAIProposal", () => {
  afterEach(() => vi.restoreAllMocks());

  it("returns a failure as { error } instead of throwing, so production builds still show the message", async () => {
    vi.spyOn(authModule, "requireUser").mockResolvedValue({ supabase: {}, user: { id: "user-1" } } as never);
    const result = await confirmAIProposal({ type: "suggest_schedule", items: [] } as never);
    expect(result).toEqual({ ok: false, error: expect.any(String) });
  });
});
