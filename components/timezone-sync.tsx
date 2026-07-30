"use client";

import { useEffect } from "react";

export const TIMEZONE_COOKIE_NAME = "tz";

function readCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

/**
 * Renders nothing. On mount, reads the browser's IANA timezone
 * (e.g. "Asia/Kolkata") and writes it to a cookie once, so Server
 * Components (the Tasks page's "Today"/"Overdue"/"Due soon" filters) can
 * compute the user's local calendar date without guessing the server
 * process's timezone.
 *
 * Only writes when the cookie is missing or stale, so this does not cause
 * a write (and therefore a route revalidation) on every render.
 */
export function TimezoneSync() {
  useEffect(() => {
    try {
      const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (!detected) return;

      if (readCookie(TIMEZONE_COOKIE_NAME) === detected) return;

      document.cookie = `${TIMEZONE_COOKIE_NAME}=${encodeURIComponent(detected)}; path=/; max-age=31536000; SameSite=Lax`;
    } catch {
      // Intl.DateTimeFormat is unsupported in some very old browsers;
      // the server-side default timezone fallback covers this case.
    }
  }, []);

  return null;
}
