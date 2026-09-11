import "server-only";

import { createServiceRoleClient } from "@/lib/supabase/service-role";

// ---------------------------------------------------------------------------
// Configuration (server-only env vars)
// ---------------------------------------------------------------------------

function getGoogleConfig() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error(
      "Missing Google OAuth configuration. Add GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REDIRECT_URI to .env.local.",
    );
  }

  return { clientId, clientSecret, redirectUri };
}

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke";

// Day 6 only needed read access. Day 7 also creates events and a dedicated
// secondary "AI Planner" calendar, so request only the write scopes required
// for those operations.
const CALENDAR_SCOPES = [
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.calendars",
];

// ---------------------------------------------------------------------------
// OAuth URL generation
// ---------------------------------------------------------------------------

export function buildGoogleAuthUrl(state: string): string {
  const { clientId, redirectUri } = getGoogleConfig();

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: CALENDAR_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    state,
  });

  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

// ---------------------------------------------------------------------------
// Token exchange (authorization code → access + refresh tokens)
// ---------------------------------------------------------------------------

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
}

export async function exchangeCodeForTokens(
  code: string,
): Promise<TokenResponse> {
  const { clientId, clientSecret, redirectUri } = getGoogleConfig();

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Google token exchange failed (${response.status}): ${body}`);
  }

  return response.json() as Promise<TokenResponse>;
}

// ---------------------------------------------------------------------------
// Token storage (service-role only)
// ---------------------------------------------------------------------------

export async function storeGoogleCredentials(
  userId: string,
  accessToken: string,
  refreshToken: string | null,
  expiresInSeconds: number,
): Promise<void> {
  const supabase = createServiceRoleClient();
  const expiresAt = new Date(Date.now() + expiresInSeconds * 1000).toISOString();

  let finalRefreshToken = refreshToken;

  // If a new refresh token wasn't provided, try to preserve the existing one
  if (!finalRefreshToken) {
    const { data: existing } = await supabase
      .from("google_credentials")
      .select("refresh_token")
      .eq("user_id", userId)
      .maybeSingle();

    if (existing?.refresh_token) {
      finalRefreshToken = existing.refresh_token;
    }
  }

  const { error } = await supabase.from("google_credentials").upsert(
    {
      user_id: userId,
      access_token: accessToken,
      refresh_token: finalRefreshToken,
      expires_at: expiresAt,
    },
    { onConflict: "user_id" },
  );

  if (error) {
    throw new Error(`Failed to store Google credentials: ${error.message}`);
  }
}

// ---------------------------------------------------------------------------
// Token retrieval + refresh
// ---------------------------------------------------------------------------

export type AccessTokenResult =
  | { token: string }
  | { error: "not_connected" }
  | { error: "reconnect_required" }
  | { error: "calendar_sync_failed" };

export async function getValidAccessToken(
  userId: string,
): Promise<AccessTokenResult> {
  const supabase = createServiceRoleClient();

  const { data: credential, error } = await supabase
    .from("google_credentials")
    .select("access_token, refresh_token, expires_at")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    return { error: "calendar_sync_failed" };
  }

  if (!credential) {
    return { error: "not_connected" };
  }

  const expiresAt = new Date(credential.expires_at).getTime();
  const fiveMinutesFromNow = Date.now() + 5 * 60 * 1000;

  // Token is still valid
  if (expiresAt > fiveMinutesFromNow) {
    return { token: credential.access_token };
  }

  // Token expired or expiring soon — attempt refresh
  if (!credential.refresh_token) {
    // No refresh token available — credentials are unusable
    await supabase.from("google_credentials").delete().eq("user_id", userId);
    return { error: "reconnect_required" };
  }

  try {
    const { clientId, clientSecret } = getGoogleConfig();

    const response = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: credential.refresh_token,
        grant_type: "refresh_token",
      }),
    });

    if (!response.ok) {
      const status = response.status;

      // Parse the error to specifically check for invalid_grant
      if (status === 400 || status === 401) {
        try {
          const errorBody = (await response.json()) as { error?: string };
          if (errorBody?.error === "invalid_grant") {
            await supabase
              .from("google_credentials")
              .delete()
              .eq("user_id", userId);
            return { error: "reconnect_required" };
          }
        } catch {
          // If body parsing fails, fall through to generic error
        }
      }

      // Temporary server/network failures, unknown 400/401 errors, or unparseable errors
      return { error: "calendar_sync_failed" };
    }

    const body = (await response.json()) as {
      access_token: string;
      expires_in: number;
    };
    const newExpiresAt = new Date(
      Date.now() + body.expires_in * 1000,
    ).toISOString();

    await supabase
      .from("google_credentials")
      .update({
        access_token: body.access_token,
        expires_at: newExpiresAt,
      })
      .eq("user_id", userId);

    return { token: body.access_token };
  } catch {
    // Network / timeout error
    return { error: "calendar_sync_failed" };
  }
}

// ---------------------------------------------------------------------------
// Token revocation (POST body, not query string)
// ---------------------------------------------------------------------------

export async function revokeGoogleToken(token: string): Promise<void> {
  try {
    await fetch(GOOGLE_REVOKE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }),
    });
    // Best-effort: ignore errors (token may already be invalid/revoked)
  } catch {
    // Ignore network errors during revocation
  }
}

// ---------------------------------------------------------------------------
// Credential deletion (service-role only)
// ---------------------------------------------------------------------------

export async function deleteGoogleCredentials(userId: string): Promise<void> {
  const supabase = createServiceRoleClient();
  await supabase.from("google_credentials").delete().eq("user_id", userId);
}

// ---------------------------------------------------------------------------
// Connection status check (returns boolean, never exposes tokens)
// ---------------------------------------------------------------------------

export async function isGoogleCalendarConnected(
  userId: string,
): Promise<boolean> {
  const supabase = createServiceRoleClient();
  const { data } = await supabase
    .from("google_credentials")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();
  return !!data;
}
