const DATE_FORMATTER_CACHE = new Map<string, Intl.DateTimeFormat>();

function getFormatter(timeZone: string): Intl.DateTimeFormat {
  const cached = DATE_FORMATTER_CACHE.get(timeZone);
  if (cached) return cached;

  // en-CA formats as YYYY-MM-DD, matching the due_date column's format,
  // so callers never need to parse the result back through `Date`.
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  DATE_FORMATTER_CACHE.set(timeZone, formatter);
  return formatter;
}

/**
 * Returns "today" as a YYYY-MM-DD string in the given IANA timezone,
 * independent of the server process's local timezone. Falls back to UTC
 * for an invalid/unrecognized timezone identifier rather than throwing,
 * since a bad cookie value should never break the Tasks page.
 */
export function getTodayISODate(timeZone: string, now: Date = new Date()): string {
  try {
    return getFormatter(timeZone).format(now);
  } catch {
    return getFormatter("UTC").format(now);
  }
}

/**
 * Adds `days` calendar days to a YYYY-MM-DD string using UTC arithmetic
 * (never the server's local timezone), returning a YYYY-MM-DD string.
 */
export function addDaysToISODate(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  const asUTC = new Date(Date.UTC(year, month - 1, day));
  asUTC.setUTCDate(asUTC.getUTCDate() + days);
  return asUTC.toISOString().slice(0, 10);
}

export const DEFAULT_TIMEZONE = "UTC";
