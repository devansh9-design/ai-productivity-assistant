"use server";

import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/require-user";
import {
  buildGoogleAuthUrl,
  deleteGoogleCredentials,
  getValidAccessToken,
  isGoogleCalendarConnected,
  revokeGoogleToken,
} from "@/lib/google/oauth";

const OAUTH_STATE_COOKIE = "__google_oauth_state";

// ---------------------------------------------------------------------------
// Connect: generate OAuth URL with CSRF state protection
// ---------------------------------------------------------------------------

export async function getGoogleConnectUrl(): Promise<string> {
  await requireUser(); // ensure authenticated

  const state = randomBytes(32).toString("hex");
  const cookieStore = await cookies();

  cookieStore.set(OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/auth/google/callback",
    maxAge: 600, // 10 minutes
  });

  return buildGoogleAuthUrl(state);
}

// ---------------------------------------------------------------------------
// Disconnect: revoke token and delete credentials
// ---------------------------------------------------------------------------

export async function disconnectGoogleCalendar(): Promise<void> {
  const { user } = await requireUser();

  // Fetch token for revocation via the token result
  const tokenResult = await getValidAccessToken(user.id);
  if ("token" in tokenResult) {
    await revokeGoogleToken(tokenResult.token);
  }

  await deleteGoogleCredentials(user.id);
  revalidatePath("/settings");
  revalidatePath("/today");
}

// ---------------------------------------------------------------------------
// Connection status check (for Settings UI)
// ---------------------------------------------------------------------------

export async function getGoogleCalendarStatus(): Promise<boolean> {
  const { user } = await requireUser();
  return isGoogleCalendarConnected(user.id);
}
