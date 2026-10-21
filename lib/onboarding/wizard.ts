import { minutesFromHHMM } from "@/lib/time";
import type { GoalCategory } from "@/lib/types";

/** Days as shown in the wizard, Monday first; `weekday` is the stored value (0 = Sunday). */
export const WIZARD_DAYS = [
  { weekday: 1, label: "Monday", short: "Mon" },
  { weekday: 2, label: "Tuesday", short: "Tue" },
  { weekday: 3, label: "Wednesday", short: "Wed" },
  { weekday: 4, label: "Thursday", short: "Thu" },
  { weekday: 5, label: "Friday", short: "Fri" },
  { weekday: 6, label: "Saturday", short: "Sat" },
  { weekday: 0, label: "Sunday", short: "Sun" },
] as const;

export interface TimeRange { start: string; end: string }

/** One day of the weekly timetable: lecture times, and when the student can work on goals. */
export interface WizardDay {
  weekday: number;
  classes: TimeRange[];
  study: TimeRange | null;
}

export interface WizardGoal {
  title: string;
  category: GoalCategory;
  targetDate: string;
  weeklyHours: string;
}

export interface OnboardingInput {
  displayName: string;
  collegeYear: string;
  timeZone: string;
  /** False when re-running onboarding without touching the timetable. */
  saveWeek: boolean;
  week: WizardDay[];
  goals: WizardGoal[];
}

export interface OnboardingPayload {
  displayName: string;
  collegeYear: number;
  timeZone: string;
  week: Array<{ weekday: number; kind: "class" | "working"; start_time: string; end_time: string }> | null;
  goals: Array<{ title: string; category: GoalCategory; target_date: string | null; weekly_hours: number | null }>;
}

export const GOAL_CATEGORIES: Array<{ value: GoalCategory; label: string }> = [
  { value: "fitness", label: "Fitness" },
  { value: "placement", label: "Placements" },
  { value: "academics", label: "College / exams" },
  { value: "skill", label: "Skill / project" },
  { value: "other", label: "Other" },
];

/** Quick picks for the first goal; the student can change every field. */
export const GOAL_TEMPLATES: Array<{ title: string; category: GoalCategory; weeklyHours: number; hint: string }> = [
  { title: "Build muscle", category: "fitness", weeklyHours: 5, hint: "Gym 4–5 days a week" },
  { title: "DSA for placements", category: "placement", weeklyHours: 8, hint: "Daily problems by topic" },
  { title: "Score well in exams", category: "academics", weeklyHours: 6, hint: "Revision before exams" },
  { title: "Build a full-stack project", category: "skill", weeklyHours: 5, hint: "Ship something real" },
];

export const MAX_CLASSES_PER_DAY = 8;
export const MAX_GOALS = 10;

/** A typical college week to start from: classes on weekdays, study time every evening. */
export function defaultWeek(): WizardDay[] {
  return WIZARD_DAYS.map(({ weekday }) => weekday >= 1 && weekday <= 5
    ? { weekday, classes: [{ start: "09:00", end: "16:00" }], study: { start: "18:00", end: "21:00" } }
    : { weekday, classes: [], study: { start: "10:00", end: "13:00" } });
}

/** Rebuilds the wizard's week from saved class and study rules (for re-running onboarding). */
export function weekFromRules(rules: Array<{ weekday: number; kind: string; start_time: string; end_time: string }>): WizardDay[] {
  return WIZARD_DAYS.map(({ weekday }) => {
    const today = rules.filter((rule) => rule.weekday === weekday);
    const classes = today.filter((rule) => rule.kind === "class")
      .map((rule) => ({ start: rule.start_time.slice(0, 5), end: rule.end_time.slice(0, 5) }))
      .sort((a, b) => a.start.localeCompare(b.start));
    const study = today.find((rule) => rule.kind === "working");
    return { weekday, classes, study: study ? { start: study.start_time.slice(0, 5), end: study.end_time.slice(0, 5) } : null };
  });
}

function isValidTimeZone(value: string): boolean {
  if (!value) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

function dayName(weekday: number): string {
  return WIZARD_DAYS.find((day) => day.weekday === weekday)?.label ?? "That day";
}

/** "HH:MM" for both ends, end after start; returns an error message or null. */
function rangeError(range: TimeRange, what: string, day: string): string | null {
  const start = minutesFromHHMM(range.start);
  const end = minutesFromHHMM(range.end);
  if (start === null || end === null) return `${day}: give ${what} a start and end time.`;
  if (end <= start) return `${day}: ${what} must end after it starts.`;
  return null;
}

/**
 * Checks everything the wizard collected and turns it into the shape
 * complete_onboarding expects. `today` is the student's local date, used so a
 * goal's target date is never in the past.
 */
export function parseOnboarding(input: OnboardingInput, today: string): { ok: true; payload: OnboardingPayload } | { ok: false; error: string } {
  const displayName = input.displayName.trim();
  if (!displayName || displayName.length > 80) return { ok: false, error: "Enter your name (up to 80 characters)." };

  const collegeYear = Number(input.collegeYear);
  if (!Number.isInteger(collegeYear) || collegeYear < 1 || collegeYear > 6) return { ok: false, error: "Choose your year of college." };

  if (!isValidTimeZone(input.timeZone)) return { ok: false, error: "Choose your timezone." };

  let week: OnboardingPayload["week"] = null;
  if (input.saveWeek) {
    week = [];
    const seen = new Set<number>();
    for (const day of input.week) {
      if (!WIZARD_DAYS.some((known) => known.weekday === day.weekday) || seen.has(day.weekday)) return { ok: false, error: "The timetable has an unknown or repeated day." };
      seen.add(day.weekday);
      const name = dayName(day.weekday);
      if (day.classes.length > MAX_CLASSES_PER_DAY) return { ok: false, error: `${name}: add at most ${MAX_CLASSES_PER_DAY} classes.` };
      const sorted = [...day.classes].sort((a, b) => a.start.localeCompare(b.start));
      for (const [index, slot] of sorted.entries()) {
        const error = rangeError(slot, "each class", name);
        if (error) return { ok: false, error };
        if (index > 0 && (minutesFromHHMM(slot.start) ?? 0) < (minutesFromHHMM(sorted[index - 1].end) ?? 0)) {
          return { ok: false, error: `${name}: two classes overlap.` };
        }
        week.push({ weekday: day.weekday, kind: "class", start_time: slot.start, end_time: slot.end });
      }
      if (day.study) {
        const error = rangeError(day.study, "study time", name);
        if (error) return { ok: false, error };
        week.push({ weekday: day.weekday, kind: "working", start_time: day.study.start, end_time: day.study.end });
      }
    }
    if (!week.some((rule) => rule.kind === "working")) return { ok: false, error: "Add study time on at least one day, so plans have somewhere to go." };
  }

  if (input.goals.length > MAX_GOALS) return { ok: false, error: `Add at most ${MAX_GOALS} goals now; you can add more later.` };
  const goals: OnboardingPayload["goals"] = [];
  for (const goal of input.goals) {
    const title = goal.title.trim();
    if (!title || title.length > 200) return { ok: false, error: "Every goal needs a name (up to 200 characters)." };
    if (!GOAL_CATEGORIES.some((category) => category.value === goal.category)) return { ok: false, error: `Choose a type for "${title}".` };
    const targetDate = goal.targetDate.trim();
    if (targetDate && (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate) || Number.isNaN(Date.parse(`${targetDate}T00:00:00Z`)))) return { ok: false, error: `"${title}": choose a valid target date.` };
    if (targetDate && targetDate < today) return { ok: false, error: `"${title}": the target date is in the past.` };
    const hoursText = goal.weeklyHours.trim();
    const weeklyHours = hoursText ? Number(hoursText) : null;
    if (weeklyHours !== null && (!Number.isFinite(weeklyHours) || weeklyHours <= 0 || weeklyHours > 112)) return { ok: false, error: `"${title}": hours per week must be between 0.5 and 112.` };
    goals.push({ title, category: goal.category, target_date: targetDate || null, weekly_hours: weeklyHours === null ? null : Math.round(weeklyHours * 10) / 10 });
  }

  return { ok: true, payload: { displayName, collegeYear, timeZone: input.timeZone, week, goals } };
}
