import Link from "next/link";
import { CalendarClock, Flag, Milestone, Target, type LucideIcon } from "lucide-react";
import { formatDay } from "@/lib/analytics/format";
import { mondayOf } from "@/lib/review/week";
import type { CompletionLevel, EventKind, MonthCell } from "@/lib/month/view";

export const EVENT: Record<EventKind, { icon: LucideIcon; label: string }> = {
  goal_target: { icon: Target, label: "Goal target date" },
  deadline: { icon: Flag, label: "Task due" },
  commitment: { icon: CalendarClock, label: "Fixed commitment (class, exam, travel)" },
  phase_start: { icon: Milestone, label: "Roadmap phase starts" },
  phase_end: { icon: Milestone, label: "Roadmap phase ends" },
};

const LEVELS: Array<{ level: Exclude<CompletionLevel, null>; label: string; className: string }> = [
  { level: 0, label: "Planned, nothing done", className: "border border-dashed border-slate-400" },
  { level: 1, label: "Under half done", className: "day-level-1" },
  { level: 2, label: "Half or more done", className: "day-level-2" },
  { level: 3, label: "All done", className: "day-level-3" },
];
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function monthLabel(month: string): string {
  return new Date(`${month}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
}

function describeCell(cell: MonthCell): string {
  const parts = [formatDay(cell.date)];
  if (cell.level !== null) parts.push(`${cell.done} of ${cell.planned} planned done`);
  for (const event of cell.events) parts.push(`${EVENT[event.kind].label}: ${event.label}`);
  return parts.join(". ");
}

function DayCell({ cell, compact }: { cell: MonthCell; compact: boolean }) {
  const level = LEVELS.find((item) => item.level === cell.level);
  const kinds = [...new Set(cell.events.map((event) => event.kind))];
  // Compact: date, icons and the strip only. Full: event names on wider screens.
  const height = compact ? "h-12" : "h-16 sm:h-24";
  return (
    <td className="p-0.5 align-top">
      <Link href={`/week?week=${mondayOf(cell.date)}`} title={describeCell(cell)} aria-label={describeCell(cell)}
        className={`flex ${height} flex-col rounded-lg border p-1 hover:border-indigo-300 ${cell.isToday ? "border-indigo-500" : "border-slate-200"} ${cell.inMonth ? "" : "opacity-40"}`}>
        <span className={`text-xs font-semibold ${cell.isToday ? "text-indigo-600" : "text-slate-800"}`}>{Number(cell.date.slice(8))}</span>
        <span className={`mt-0.5 flex flex-wrap gap-0.5 ${compact ? "" : "sm:hidden"}`} aria-hidden="true">
          {kinds.map((kind) => { const Icon = EVENT[kind].icon; return <Icon key={kind} className="h-3 w-3 text-slate-600" />; })}
        </span>
        {!compact && (
          <span className="mt-0.5 hidden min-w-0 flex-1 flex-col gap-0.5 overflow-hidden sm:flex" aria-hidden="true">
            {cell.events.slice(0, 2).map((event, index) => {
              const Icon = EVENT[event.kind].icon;
              return <span key={index} className="flex min-w-0 items-center gap-1 text-[11px] text-slate-700"><Icon className="h-3 w-3 shrink-0 text-slate-500" /><span className="truncate">{event.label}</span></span>;
            })}
            {cell.events.length > 2 && <span className="text-[11px] text-slate-500">+{cell.events.length - 2} more</span>}
          </span>
        )}
        <span className={`mt-auto h-1.5 w-full rounded-full ${level?.className ?? ""}`} aria-hidden="true" />
      </Link>
    </td>
  );
}

/**
 * The month as a calendar of whole weeks: a strip under each day for how much
 * of its plan was done, icons for exams, deadlines and roadmap dates, and a
 * key. `compact` fits a side column (Today); the full size is the Month page.
 */
export function MonthCalendar({ month, weeks, compact = false }: { month: string; weeks: MonthCell[][]; compact?: boolean }) {
  return (
    <div>
      <table className="w-full table-fixed border-separate border-spacing-0">
        <caption className="sr-only">{monthLabel(month)}, one row per week</caption>
        <thead>
          <tr>{WEEKDAYS.map((day) => <th key={day} scope="col" className="pb-1 text-center text-xs font-semibold text-slate-500">{compact ? day.slice(0, 2) : day}</th>)}</tr>
        </thead>
        <tbody>
          {weeks.map((week) => <tr key={week[0].date}>{week.map((cell) => <DayCell key={cell.date} cell={cell} compact={compact} />)}</tr>)}
        </tbody>
      </table>
      <div className={`mt-4 flex flex-wrap gap-x-4 gap-y-2 text-slate-600 ${compact ? "text-[11px]" : "text-xs"}`}>
        {LEVELS.map((item) => (
          <span key={item.level} className="inline-flex items-center gap-1.5"><span className={`inline-block h-1.5 w-5 rounded-full ${item.className}`} aria-hidden="true" />{item.label}</span>
        ))}
        {(Object.keys(EVENT) as EventKind[]).filter((kind) => kind !== "phase_end").map((kind) => {
          const Icon = EVENT[kind].icon;
          return <span key={kind} className="inline-flex items-center gap-1.5"><Icon aria-hidden="true" className="h-3.5 w-3.5 text-slate-500" />{kind === "phase_start" ? "Roadmap phase starts or ends" : EVENT[kind].label}</span>;
        })}
      </div>
    </div>
  );
}
