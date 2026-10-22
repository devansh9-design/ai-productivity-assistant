import Link from "next/link";
import { cookies } from "next/headers";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { requireUser } from "@/lib/auth/require-user";
import { formatDay } from "@/lib/analytics/format";
import { loadMonth } from "@/lib/month/load";
import { MONTHS_AHEAD, MONTHS_BACK, monthOf, resolveMonth, shiftMonth, type MonthCell } from "@/lib/month/view";
import { EVENT, MonthCalendar, monthLabel } from "@/components/month-calendar";
import { DEFAULT_TIMEZONE, getTodayISODate, TIMEZONE_COOKIE_NAME } from "@/lib/tasks/timezone";
import { errorFields, log } from "@/lib/log";

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
            <MonthCalendar month={month} weeks={weeks} />
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
