"use client";

import { useEffect, useState } from "react";
import { TIMEZONE_COOKIE_NAME } from "@/lib/tasks/timezone";

/**
 * Client component that synchronizes the browser's IANA timezone
 * (e.g. "Asia/Kolkata") into a cookie so that Server Actions and
 * Server Components can read the user's local timezone.
 *
 * Uses useEffect (runs after first render, before any user interaction).
 * Does NOT URL-encode the value — IANA timezone strings contain only
 * safe cookie characters (alphanumeric, slash, underscore, hyphen).
 *
 * Also exposes a hidden diagnostic element (data-tz-status) that can
 * be inspected in DevTools to confirm the cookie was written.
 */
export function TimezoneSync() {
  const [status, setStatus] = useState<string>("pending");
  const [detectedTz, setDetectedTz] = useState<string>("");

  useEffect(() => {
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (!tz) {
        setStatus("no-timezone-detected");
        return;
      }
      setDetectedTz(tz);

      // Read existing cookie value (raw, no decoding)
      const existing = document.cookie
        .split("; ")
        .find((c) => c.startsWith(`${TIMEZONE_COOKIE_NAME}=`))
        ?.split("=")[1];

      if (existing === tz) {
        setStatus("already-set");
        return;
      }

      // Write cookie WITHOUT encodeURIComponent.
      // IANA timezone strings (e.g. "Asia/Kolkata", "America/New_York")
      // contain only RFC 6265-safe characters.
      document.cookie = `${TIMEZONE_COOKIE_NAME}=${tz}; path=/; max-age=31536000; SameSite=Lax`;
      setStatus("written");
    } catch {
      setStatus("error");
    }
  }, []);

  // Hidden diagnostic element — visible in DevTools, invisible to user.
  // Will be removed after timezone verification passes.
  return (
    <span
      data-tz-status={status}
      data-tz-detected={detectedTz}
      style={{ display: "none" }}
      aria-hidden="true"
    />
  );
}
