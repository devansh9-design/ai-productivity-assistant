import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { TIMEZONE_COOKIE_NAME } from "@/lib/tasks/timezone";

/**
 * TEMPORARY diagnostic endpoint.
 * Reports ONLY the timezone cookie value — no secrets, no tokens, no env vars.
 * Remove after manual verification passes.
 */
export async function GET(request: NextRequest) {
  const cookieStore = await cookies();
  
  // Layer A: Raw header
  const rawCookieHeader = request.headers.get("cookie") || "";
  const tzMatch = rawCookieHeader.match(new RegExp(`(?:^|; )${TIMEZONE_COOKIE_NAME}=([^;]*)`));
  
  // Layer B: request.cookies
  const requestCookiesTz = request.cookies.get(TIMEZONE_COOKIE_NAME);
  
  // Layer C: cookies()
  const serverCookiesTz = cookieStore.get(TIMEZONE_COOKIE_NAME);

  return NextResponse.json({
    requestCookieHeaderContainsTz: tzMatch !== null,
    requestCookieHeaderValue: tzMatch ? tzMatch[1] : null,
    requestCookiesValue: requestCookiesTz?.value ?? null,
    serverCookiesApiValue: serverCookiesTz?.value ?? null,
    isValid: (() => {
      if (!serverCookiesTz?.value) return false;
      try {
        new Intl.DateTimeFormat("en-US", { timeZone: serverCookiesTz.value });
        return true;
      } catch {
        return false;
      }
    })(),
  });
}
