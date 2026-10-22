import Link from "next/link";
import { cookies } from "next/headers";
import { CalendarClock, ChevronLeft, ChevronRight, Flag, Milestone, Target, type LucideIcon } from "lucide-react";
import { requireUser } from "@/lib/auth/require-user";
import { formatDay } from "@/lib/analytics/format";
import { loadMonth } from "@/lib/month/load";
import { MONTHS_AHEAD, MONTHS_BACK, monthOf, resolveMonth, shiftMonth, type CompletionLevel, type EventKind, type MonthCell } from "@/lib/month/view";
import { mondayOf } from "@/lib/review/week";
import { DEFAULT_TIMEZONE, getTodayISODate, TIMEZONE_COOKIE_NAME } from "@/lib/tasks/timezone";
import { errorFields, log } from "@/lib/log";

const EVENT: Record<EventKind, { icon: LucideIcon; label: string }> = {
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

function monthLabel(month: string): string {
  return new Date(`${month}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
}

function describeCell(cell: MonthCell): string {
  const parts = [formatDay(cell.date)];
  if (cell.level !== null) parts.push(`${cell.done} of ${cell.planned} planned done`);
  for (const event of cell.events) parts.push(`${EVENT[event.kind].label}: ${event.label}`);
  return parts.join(". ");
}

function DayCell({ cell }: { cell: MonthCell }) {
  const level = LEVELS.find((item) => item.level === cell.level);
  const kinds = [...new Set(cell.events.map((event) => event.kind))];
  return (
    <td className="p-0.5 align-top">
      <Link href={`/week?week=${mondayOf(cell.date)}`} title={describeCell(cell)} aria-label={describeCell(cell)}
        className={`flex h-16 flex-col rounded-lg border p-1 hover:border-indigo-300 sm:h-24 ${cell.isToday ? "border-indigo-500" : "border-slate-200"} ${cell.inMonth ? "" : "opacity-40"}`}>
        <span className={`text-xs font-semibold ${cell.isToday ? "text-indigo-600" : "text-slate-800"}`}>{Number(cell.date.slice(8))}</span>
        <span className="mt-0.5 flex flex-wrap gap-0.5 sm:hidden" aria-hidden="true">
          {kinds.map((kind) => { const Icon = EVENT[kind].icon; return <Icon key={kind} className="h-3 w-3 text-slate-600" />; })}
        </span>
        <span className="mt-0.5 hidden min-w-0 flex-1 flex-col gap-0.5 overflow-hidden sm:flex" aria-hidden="true">
          {cell.events.slice(0, 2).map((event, index) => {
            const Icon = EVENT[event.kind].icon;
            return <span key={index} className="flex min-w-0 items-center gap-1 text-[11px] text-slate-700"><Icon className="h-3 w-3 shrink-0 text-slate-500" /><span className="truncate">{event.label}</span></span>;
          })}
          {cell.events.length > 2 && <span className="text-[11px] text-slate-500">+{cell.events.length - 2} more</span>}
        </span>
        <span className={`mt-auto h-1.5 w-full rounded-full ${level?.className ?? ""}`} aria-hidden="true" />
      </Link>
    </td>
  );
}

export default async function MonthPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { supabase } = await requireUser();
  const timeZone = (await cookies()).get(TIMEZONE_COOKIE_NAME)?.value || DEFAULT_TIMEZONE;
  const today = getTodayISODate(timeZone);
  const month = resolveMonth((await searchParams).month, today);
  const current = monthOf(today);
  const previous = shiftMonth(month, -1);
  const next = shiftMonth(month, 1);

  let weeks: MonthCell[][] | null = null;
  const started = Date.now();
  try {
    weeks = await loadMonth(supabase, month, today, timeZone);
    // The plan's target is a month view in under a second; this shows where the time goes.
    log("info", "month.loaded", { month, ms: Date.now() - started });
  } catch (error) {
    log("error", "month.load_failed", errorFields(error));
  }
  const monthEvents = (weeks ?? []).flat().filter((cell) => cell.inMonth && cell.events.length > 0);
  const navClass = "inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50";

  return (
    <section aria-labelledby="page-title" className="mx-auto max-w-5xl">
      <p className="text-sm font-semibold uppercase tracking-wide text-indigo-600">{month === current ? "This month" : month < current ? "Past month" : "Coming up"}</p>
      <h1 id="page-title" className="mt-2 text-3xl font-bold tracking-tight text-slate-900">{monthLabel(month)}</h1>
      <p className="mt-2 text-slate-600">How each day went, with exams, deadlines and roadmap phases. Open a day to see its week.</p>

      <nav aria-label="Months" className="mt-4 flex flex-wrap gap-2">
        {previous >= shiftMonth(current, -MONTHS_BACK) && <Link href={`/month?month=${previous}`} className={navClass}><ChevronLeft aria-hidden="true" className="h-4 w-4" />{monthLabel(previous)}</Link>}
        {month !== current && <Link href="/month" className={navClass}>This month</Link>}
        {next <= shiftMonth(current, MONTHS_AHEAD) && <Link href={`/month?month=${next}`} className={navClass}>{monthLabel(next)}<ChevronRight aria-hidden="true" className="h-4 w-4" /></Link>}
      </nav>

      {!weeks ? (
        <p role="alert" className="mt-6 rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-700">This month could not be loaded right now. Please refresh to try again.</p>
      ) : (
        <>
          <div className="mt-6 card p-3 sm:p-5">
            <table className="w-full table-fixed border-separate border-spacing-0">
              <caption className="sr-only">{monthLabel(month)}, one row per week</caption>
              <thead>
                <tr>{WEEKDAYS.map((day) => <th key={day} scope="col" className="pb-1 text-center text-xs font-semibold text-slate-500">{day}</th>)}</tr>
              </thead>
              <tbody>
                {weeks.map((week) => <tr key={week[0].date}>{week.map((cell) => <DayCell key={cell.date} cell={cell} />)}</tr>)}
              </tbody>
            </table>
            <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-xs text-slate-600">
              {LEVELS.map((item) => (
                <span key={item.level} className="inline-flex items-center gap-1.5"><span className={`inline-block h-1.5 w-5 rounded-full ${item.className}`} aria-hidden="true" />{item.label}</span>
              ))}
              {(Object.keys(EVENT) as EventKind[]).filter((kind) => kind !== "phase_end").map((kind) => {
                const Icon = EVENT[kind].icon;
                return <span key={kind} className="inline-flex items-center gap-1.5"><Icon aria-hidden="true" className="h-3.5 w-3.5 text-slate-500" />{kind === "phase_start" ? "Roadmap phase starts or ends" : EVENT[kind].label}</span>;
              })}
            </div>
          </div>

          <section aria-labelledby="events-title" className="mt-6 card p-5">
            <h2 id="events-title" className="text-lg font-semibold text-slate-900">This month&apos;s dates</h2>
            {monthEvents.length === 0 ? (
              <p className="mt-2 text-sm text-slate-600">No exams, deadlines or roadmap dates this month.</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {monthEvents.map((cell) => (
                  <li key={cell.date} className="text-sm">
                    <p className="font-semibold text-slate-900">{formatDay(cell.date)}</p>
                    <ul className="mt-0.5 space-y-0.5">
                      {cell.events.map((event, index) => {
                        const Icon = EVENT[event.kind].icon;
                        const content = <><Icon aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-slate-500" /><span className="sr-only">{EVENT[event.kind].label}: </span>{event.label}</>;
                        return (
                          <li key={index} className="flex items-center gap-1.5 text-slate-700">
                            {event.goalId ? <Link href={`/goals/${event.goalId}`} className="inline-flex items-center gap-1.5 hover:underline">{content}</Link> : content}
                          </li>
                        );
                      })}
                    </ul>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </section>
  );
}
