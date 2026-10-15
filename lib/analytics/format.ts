/** 0 -> "0m", 45 -> "45m", 60 -> "1h", 205 -> "3h 25m". */
export function formatMinutes(minutes: number): string {
  const whole = Math.max(0, Math.round(minutes));
  const hours = Math.floor(whole / 60);
  const rest = whole % 60;
  if (!hours) return `${rest}m`;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

/** "2026-10-12" -> "Mon 12 Oct". Date-only strings are formatted in UTC so they never shift a day. */
export function formatDay(isoDate: string): string {
  return new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })
    .format(new Date(`${isoDate}T00:00:00Z`))
    .replace(",", "");
}

export function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

/** Bar width as a percentage of the largest value; 0 when there is nothing to compare. */
export function barPercent(value: number, max: number): number {
  return max > 0 ? Math.round((value / max) * 100) : 0;
}
