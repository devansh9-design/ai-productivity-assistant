import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { storeGoogleCredentials, getValidAccessToken } from "@/lib/google/oauth";
import * as serviceRoleModule from "@/lib/supabase/service-role";

// Mock the environment variables needed by oauth.ts
vi.stubEnv("GOOGLE_CLIENT_ID", "test-client-id");
vi.stubEnv("GOOGLE_CLIENT_SECRET", "test-client-secret");
vi.stubEnv("GOOGLE_REDIRECT_URI", "http://localhost/callback");
vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://localhost");
vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-key");

// Mock fetch globally
const originalFetch = global.fetch;
beforeEach(() => {
  global.fetch = vi.fn();
});
afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("Google OAuth - Refresh Token Preservation", () => {
  it("preserves existing refresh token when new token payload omits it", async () => {
    // Mock the Supabase client chain for `maybeSingle` and `upsert`
    const maybeSingleMock = vi.fn().mockResolvedValue({ data: { refresh_token: "old-refresh" } });
    const eqMock = vi.fn().mockReturnValue({ maybeSingle: maybeSingleMock });
    const selectMock = vi.fn().mockReturnValue({ eq: eqMock });
    
    const upsertMock = vi.fn().mockResolvedValue({ error: null });
    
    const fromMock = vi.fn().mockImplementation((table) => {
      if (table === "google_credentials") {
        return { select: selectMock, upsert: upsertMock };
      }
      return {};
    });

    vi.spyOn(serviceRoleModule, "createServiceRoleClient").mockReturnValue({
      from: fromMock,
    } as unknown as ReturnType<typeof serviceRoleModule.createServiceRoleClient>);

    await storeGoogleCredentials("user-1", "new-access", null, 3600);

    // Verify it tried to fetch the existing token
    expect(fromMock).toHaveBeenCalledWith("google_credentials");
    expect(selectMock).toHaveBeenCalledWith("refresh_token");
    expect(eqMock).toHaveBeenCalledWith("user_id", "user-1");

    // Verify it preserved the old token in the upsert
    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        access_token: "new-access",
        refresh_token: "old-refresh", // Preserved!
      }),
      expect.objectContaining({ onConflict: "user_id" })
    );
  });

  it("replaces existing refresh token when Google provides a new one", async () => {
    const upsertMock = vi.fn().mockResolvedValue({ error: null });
    const fromMock = vi.fn().mockReturnValue({ upsert: upsertMock });
    vi.spyOn(serviceRoleModule, "createServiceRoleClient").mockReturnValue({
      from: fromMock,
    } as unknown as ReturnType<typeof serviceRoleModule.createServiceRoleClient>);

    await storeGoogleCredentials("user-1", "new-access", "new-refresh", 3600);

    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        refresh_token: "new-refresh",
      }),
      expect.objectContaining({ onConflict: "user_id" })
    );
  });
});

describe("Google OAuth - Refresh Error Classification", () => {
  let deleteMock: ReturnType<typeof vi.fn>;
  let eqMockDelete: ReturnType<typeof vi.fn>;
  let updateMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // Setup Supabase mock for getValidAccessToken (which reads an expired token)
    const maybeSingleMock = vi.fn().mockResolvedValue({
      data: {
        access_token: "expired",
        refresh_token: "valid-refresh",
        expires_at: new Date(Date.now() - 1000).toISOString(), // Expired
      },
    });
    
    const eqMockSelect = vi.fn().mockReturnValue({ maybeSingle: maybeSingleMock });
    const selectMock = vi.fn().mockReturnValue({ eq: eqMockSelect });
    
    eqMockDelete = vi.fn().mockResolvedValue({ error: null });
    deleteMock = vi.fn().mockReturnValue({ eq: eqMockDelete });
    
    const eqMockUpdate = vi.fn().mockResolvedValue({ error: null });
    updateMock = vi.fn().mockReturnValue({ eq: eqMockUpdate });

    const fromMock = vi.fn().mockImplementation((table) => {
      if (table === "google_credentials") {
        return { select: selectMock, delete: deleteMock, update: updateMock };
      }
      return {};
    });

    vi.spyOn(serviceRoleModule, "createServiceRoleClient").mockReturnValue({
      from: fromMock,
    } as unknown as ReturnType<typeof serviceRoleModule.createServiceRoleClient>);
  });

  it("invalid_grant deletes unusable credentials and returns reconnect_required", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({ error: "invalid_grant" }),
    } as unknown as Response);

    const result = await getValidAccessToken("user-1");

    expect(result).toEqual({ error: "reconnect_required" });
    expect(deleteMock).toHaveBeenCalled();
    expect(eqMockDelete).toHaveBeenCalledWith("user_id", "user-1");
  });

  it("generic HTTP 400 does NOT delete credentials and returns calendar_sync_failed", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({ error: "some_other_error" }),
    } as unknown as Response);

    const result = await getValidAccessToken("user-1");

    expect(result).toEqual({ error: "calendar_sync_failed" });
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it("unparseable HTTP 400 does NOT delete credentials and returns calendar_sync_failed", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => { throw new Error("Parse error"); },
    } as unknown as Response);

    const result = await getValidAccessToken("user-1");

    expect(result).toEqual({ error: "calendar_sync_failed" });
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it("HTTP 5xx returns calendar_sync_failed without deleting credentials", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ error: "internal_error" }),
    } as unknown as Response);

    const result = await getValidAccessToken("user-1");

    expect(result).toEqual({ error: "calendar_sync_failed" });
    expect(deleteMock).not.toHaveBeenCalled();
  });
});
