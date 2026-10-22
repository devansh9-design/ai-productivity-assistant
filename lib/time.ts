const HHMM = /^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d(?:\.\d+)?)?$/;

/**
 * Minutes after midnight for an "HH:mm" time; Postgres "HH:mm:ss" values are
 * accepted too. Returns null for anything that is not a valid time of day.
 */
export function minutesFromHHMM(value: string): number | null {
  const match = HHMM.exec(value);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}
