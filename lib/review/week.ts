import { isValidISODate } from "@/lib/tasks/date-validation";
import { addDaysToISODate } from "@/lib/tasks/timezone";

/** How many past weeks the review page lets you pick from. */
export const REVIEWABLE_WEEKS = 12;

function weekday(isoDate: string): number {
  return new Date(`${isoDate}T00:00:00Z`).getUTCDay(); // 0 = Sunday
}

/** Monday of the Monday-to-Sunday week containing `isoDate`. */
export function mondayOf(isoDate: string): string {
  return addDaysToISODate(isoDate, -((weekday(isoDate) + 6) % 7));
}

export function weekDays(weekStart: string): string[] {
  return Array.from({ length: 7 }, (_, index) => addDaysToISODate(weekStart, index));
}

export function weekEnd(weekStart: string): string {
  return addDaysToISODate(weekStart, 6);
}

/** On Sunday the current week is reviewed; on any other day, the last full week. */
export function defaultReviewWeek(today: string): string {
  const monday = mondayOf(today);
  return weekday(today) === 0 ? monday : addDaysToISODate(monday, -7);
}

/**
 * The week whose priorities are being chosen. On Monday the week has only
 * just started, so it is this week; on any other day it is next week. The
 * server always derives this from today, never from the request, so editing
 * an older review cannot change the upcoming week's priorities.
 */
export function planningWeekFor(today: string): string {
  const monday = mondayOf(today);
  return weekday(today) === 1 ? monday : addDaysToISODate(monday, 7);
}

/** Weeks the user may review, newest first. */
export function reviewableWeeks(today: string): string[] {
  const newest = defaultReviewWeek(today);
  return Array.from({ length: REVIEWABLE_WEEKS }, (_, index) => addDaysToISODate(newest, -7 * index));
}

/** A `?week=` value is accepted only if it is one of the reviewable Mondays; otherwise the default week. */
export function resolveReviewWeek(param: string | string[] | undefined, today: string): string {
  const value = Array.isArray(param) ? param[0] : param;
  if (value && isValidISODate(value) && reviewableWeeks(today).includes(value)) return value;
  return defaultReviewWeek(today);
}
