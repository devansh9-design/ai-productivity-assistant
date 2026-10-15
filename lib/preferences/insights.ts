import { MIN_DURATION_SAMPLES } from "@/lib/preferences/preferences";

export interface InsightTask {
  status: string;
  estimated_minutes: number | null;
  actual_minutes: number | null;
  completed_at: string | null;
  updated_at: string;
}

export interface InsightSession {
  started_at: string;
  minutes: number | null;
}

export interface Insight {
  id: "estimate_accuracy" | "late_deferrals" | "focus_hours";
  text: string;
}

export interface InsightInput {
  tasks: InsightTask[];
  sessions: InsightSession[];
  timeZone: string;
  now: Date;
}

const DAY_MS = 86_400_000;
const LONG_TASK_MINUTES = 60;
const LATE_HOUR = 21;
const MIN_LATE_DEFERRALS = 2;
const MIN_FOCUS_MINUTES = 120;
const MIN_FOCUS_SHARE = 0.4;
const FOCUS_BAND_HOURS = 3;

function localHour(iso: string, timeZone: string): number {
  const hour = new Intl.DateTimeFormat("en-US", { timeZone, hour: "2-digit", hourCycle: "h23" })
    .formatToParts(new Date(iso))
    .find((part) => part.type === "hour")?.value;
  return Number(hour === "24" ? "0" : hour);
}

function withinDays(iso: string | null, days: number, now: Date): boolean {
  if (!iso) return false;
  const time = Date.parse(iso);
  return Number.isFinite(time) && time <= now.getTime() && now.getTime() - time <= days * DAY_MS;
}

function hourLabel(hour: number): string {
  if (hour % 24 === 0) return "midnight";
  if (hour === 12) return "noon";
  return hour < 12 ? `${hour} AM` : `${hour - 12} PM`;
}

function estimateAccuracy(tasks: InsightTask[], now: Date): Insight | null {
  const samples = tasks.filter((task) =>
    task.status === "completed" && withinDays(task.completed_at, 30, now) &&
    (task.estimated_minutes ?? 0) > 0 && (task.actual_minutes ?? 0) > 0);
  if (samples.length < MIN_DURATION_SAMPLES) return null;
  const ratio = samples.reduce((sum, task) => sum + (task.actual_minutes as number), 0) /
    samples.reduce((sum, task) => sum + (task.estimated_minutes as number), 0);
  const basis = `(${samples.length} completed tasks, last 30 days)`;
  if (ratio >= 1.15) return { id: "estimate_accuracy", text: `Completed tasks took about ${ratio.toFixed(1)}x their estimates ${basis}.` };
  if (ratio <= 0.85) return { id: "estimate_accuracy", text: `Completed tasks took about ${ratio.toFixed(1)}x their estimates, so you tend to overestimate ${basis}.` };
  return { id: "estimate_accuracy", text: `Your estimates are within 15% of actual time ${basis}.` };
}

/**
 * Deferral time comes from the task's updated_at, the closest record of when
 * it was deferred or skipped (there is no status history table), so the
 * wording says "deferred or skipped" rather than claiming an exact moment.
 */
function lateDeferrals(tasks: InsightTask[], timeZone: string, now: Date): Insight | null {
  const late = tasks.filter((task) =>
    (task.status === "deferred" || task.status === "skipped") &&
    (task.estimated_minutes ?? 0) >= LONG_TASK_MINUTES &&
    withinDays(task.updated_at, 14, now) &&
    localHour(task.updated_at, timeZone) >= LATE_HOUR);
  if (late.length < MIN_LATE_DEFERRALS) return null;
  return {
    id: "late_deferrals",
    text: `You deferred or skipped ${late.length} long tasks (${LONG_TASK_MINUTES}+ min) after 9 PM in the last two weeks. Long work may fit better earlier in the day.`,
  };
}

function focusHours(sessions: InsightSession[], timeZone: string, now: Date): Insight | null {
  const recent = sessions.filter((session) => (session.minutes ?? 0) > 0 && withinDays(session.started_at, 14, now));
  const total = recent.reduce((sum, session) => sum + (session.minutes as number), 0);
  if (total < MIN_FOCUS_MINUTES) return null;
  const bands = new Map<number, number>();
  for (const session of recent) {
    const band = Math.floor(localHour(session.started_at, timeZone) / FOCUS_BAND_HOURS);
    bands.set(band, (bands.get(band) ?? 0) + (session.minutes as number));
  }
  const [band, minutes] = [...bands.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0];
  const share = minutes / total;
  if (share < MIN_FOCUS_SHARE) return null;
  const start = band * FOCUS_BAND_HOURS;
  return {
    id: "focus_hours",
    text: `${Math.round(share * 100)}% of your tracked focus time in the last two weeks started between ${hourLabel(start)} and ${hourLabel(start + FOCUS_BAND_HOURS)}.`,
  };
}

/** Pure, read-only observations. Returns an empty list when history is too thin to say anything. */
export function computeInsights({ tasks, sessions, timeZone, now }: InsightInput): Insight[] {
  return [estimateAccuracy(tasks, now), lateDeferrals(tasks, timeZone, now), focusHours(sessions, timeZone, now)]
    .filter((insight): insight is Insight => insight !== null);
}
