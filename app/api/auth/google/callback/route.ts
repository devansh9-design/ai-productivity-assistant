import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  exchangeCodeForTokens,
  storeGoogleCredentials,
} from "@/lib/google/oauth";

const OAUTH_STATE_COOKIE = "__google_oauth_state";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const errorParam = searchParams.get("error");

  // Google may redirect with an error (e.g. user denied consent)
  if (errorParam) {
    redirect(`/settings?google_error=${encodeURIComponent(errorParam)}`);
  }

  // ---------------------------------------------------------------------------
  // 1. Validate OAuth state (CSRF protection)
  // ---------------------------------------------------------------------------

  const cookieStore = await cookies();
  const storedState = cookieStore.get(OAUTH_STATE_COOKIE)?.value;

  // Delete the state cookie immediately regardless of validation outcome
  cookieStore.delete({
    name: OAUTH_STATE_COOKIE,
    path: "/api/auth/google/callback",
  });

  if (!code || !state || !storedState || state !== storedState) {
    redirect("/settings?google_error=oauth_state_mismatch");
  }

  // ---------------------------------------------------------------------------
  // 2. Identify the authenticated Supabase user
  // ---------------------------------------------------------------------------

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // ---------------------------------------------------------------------------
  // 3. Exchange authorization code for tokens
  // ---------------------------------------------------------------------------

  try {
    const tokens = await exchangeCodeForTokens(code);

    await storeGoogleCredentials(
      user.id,
      tokens.access_token,
      tokens.refresh_token ?? null,
      tokens.expires_in,
    );
  } catch (error) {
    console.error(
      "Google OAuth callback failed:",
      error instanceof Error ? error.message : "Unknown error",
    );

    redirect("/settings?google_error=token_exchange_failed");
  }

  redirect("/settings?google=connected");
}
