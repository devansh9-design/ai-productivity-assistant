import { isValidISODate } from "@/lib/tasks/date-validation";
import { addDaysToISODate } from "@/lib/tasks/timezone";

export const RANGE_PRESETS = ["7d", "week", "30d"] as const;
export type RangePreset = (typeof RANGE_PRESETS)[number];

export const MAX_RANGE_DAYS = 92;
export const DEFAULT_PRESET: RangePreset = "7d";

export interface AnalyticsRange {
  preset: RangePreset | "custom";
  /** Inclusive local dates, YYYY-MM-DD. */
  from: string;
  to: string;
  /** Every local date from `from` to `to`, inclusive. */
  days: string[];
  label: string;
}

const PRESET_LABELS: Record<RangePreset, string> = {
  "7d": "Last 7 days",
  week: "This week",
  "30d": "Last 30 days",
};

function daysBetween(from: string, to: string): string[] {
  const days: string[] = [];
  for (let day = from; day <= to; day = addDaysToISODate(day, 1)) days.push(day);
  return days;
}

/** Monday of the ISO week containing `date`. */
function startOfWeek(date: string): string {
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  return addDaysToISODate(date, -((weekday + 6) % 7));
}

function presetRange(preset: RangePreset, today: string): AnalyticsRange {
  const from = preset === "week" ? startOfWeek(today) : addDaysToISODate(today, preset === "7d" ? -6 : -29);
  return { preset, from, to: today, days: daysBetween(from, today), label: PRESET_LABELS[preset] };
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Resolves the dashboard's date range from URL search params. A custom
 * from/to pair wins when both are valid dates, from <= to <= today, and the
 * span is at most MAX_RANGE_DAYS. Anything invalid falls back to the default
 * preset rather than erroring, so a hand-edited URL never breaks the page.
 */
export function resolveAnalyticsRange(
  params: Record<string, string | string[] | undefined>,
  today: string,
): AnalyticsRange {
  const from = first(params.from);
  const to = first(params.to);
  if (from && to && isValidISODate(from) && isValidISODate(to) && from <= to && to <= today) {
    const days = daysBetween(from, to);
    if (days.length <= MAX_RANGE_DAYS) return { preset: "custom", from, to, days, label: `${from} to ${to}` };
  }

  const preset = first(params.range);
  return presetRange((RANGE_PRESETS as readonly string[]).includes(preset ?? "") ? (preset as RangePreset) : DEFAULT_PRESET, today);
}
