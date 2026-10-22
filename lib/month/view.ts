import { mondayOf } from "@/lib/review/week";
import { addDaysToISODate } from "@/lib/tasks/timezone";
import type { WeekDay } from "@/lib/week/view";

export type EventKind = "commitment" | "deadline" | "goal_target" | "phase_start" | "phase_end";

export interface MonthEvent {
  date: string;
  kind: EventKind;
  label: string;
  /** Goal the event belongs to, when there is one, for linking. */
  goalId: string | null;
}

/** 0 = planned but nothing done, 1 = under half, 2 = half or more, 3 = all done; null = no plan or still ahead. */
export type CompletionLevel = 0 | 1 | 2 | 3 | null;

export interface MonthCell {
  date: string;
  inMonth: boolean;
  isToday: boolean;
  level: CompletionLevel;
  planned: number;
  done: number;
  events: MonthEvent[];
}

/** "2026-10" for the month containing a date. */
export function monthOf(date: string): string {
  return date.slice(0, 7);
}

export function firstOfMonth(month: string): string {
  return `${month}-01`;
}

export function lastOfMonth(month: string): string {
  const [year, monthNumber] = month.split("-").map(Number);
  return new Date(Date.UTC(year, monthNumber, 0)).toISOString().slice(0, 10);
}

export function shiftMonth(month: string, by: number): string {
  const [year, monthNumber] = month.split("-").map(Number);
  return new Date(Date.UTC(year, monthNumber - 1 + by, 1)).toISOString().slice(0, 7);
}

/** How far back and ahead the month view goes. */
export const MONTHS_BACK = 12;
export const MONTHS_AHEAD = 3;

/** A `?month=YYYY-MM` from a year back to three months ahead; anything else shows this month. */
export function resolveMonth(param: string | string[] | undefined, today: string): string {
  const current = monthOf(today);
  const value = Array.isArray(param) ? param[0] : param;
  if (!value || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) return current;
  if (value < shiftMonth(current, -MONTHS_BACK) || value > shiftMonth(current, MONTHS_AHEAD)) return current;
  return value;
}

/** Monday on or before the 1st to Sunday on or after the last day: whole weeks. */
export function gridRange(month: string): { start: string; end: string } {
  const start = mondayOf(firstOfMonth(month));
  const end = addDaysToISODate(mondayOf(lastOfMonth(month)), 6);
  return { start, end };
}

export function completionLevel(day: Pick<WeekDay, "planned" | "done" | "isFuture">): CompletionLevel {
  if (day.isFuture || day.planned === 0) return null;
  const share = day.done / day.planned;
  if (share >= 1) return 3;
  if (share >= 0.5) return 2;
  if (share > 0) return 1;
  return 0;
}

const EVENT_ORDER: Record<EventKind, number> = { goal_target: 0, deadline: 1, commitment: 2, phase_start: 3, phase_end: 4 };

/** The month as weeks of seven cells, each with its completion level and events. */
export function buildMonthGrid(month: string, today: string, days: WeekDay[], events: MonthEvent[]): MonthCell[][] {
  const { start, end } = gridRange(month);
  const dayByDate = new Map(days.map((day) => [day.date, day]));
  const weeks: MonthCell[][] = [];
  for (let date = start; date <= end; date = addDaysToISODate(date, 1)) {
    if (weeks.length === 0 || weeks.at(-1)!.length === 7) weeks.push([]);
    const day = dayByDate.get(date);
    weeks.at(-1)!.push({
      date,
      inMonth: monthOf(date) === month,
      isToday: date === today,
      level: day ? completionLevel(day) : null,
      planned: day?.planned ?? 0,
      done: day?.done ?? 0,
      events: events.filter((event) => event.date === date).sort((a, b) => EVENT_ORDER[a.kind] - EVENT_ORDER[b.kind] || a.label.localeCompare(b.label)),
    });
  }
  return weeks;
}
