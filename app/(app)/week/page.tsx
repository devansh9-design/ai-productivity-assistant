import Link from "next/link";
import { cookies } from "next/headers";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { requireUser } from "@/lib/auth/require-user";
import { formatDay } from "@/lib/analytics/format";
import { sessionsLine } from "@/lib/feedback/daily";
import { mondayOf, weekEnd } from "@/lib/review/week";
import { DEFAULT_TIMEZONE, addDaysToISODate, getTodayISODate, TIMEZONE_COOKIE_NAME } from "@/lib/tasks/timezone";
import { loadWeekView, type WeekView } from "@/lib/week/load";
import { resolveViewWeek, VIEWABLE_PAST_WEEKS, weekTargetLine, type SessionCell, type WeekDay } from "@/lib/week/view";
import { materializeRoutineTasks } from "@/lib/routines/materialize";
import { errorFields, log } from "@/lib/log";

const CELL: Record<SessionCell, { label: string; className: string }> = {
  held: { label: "Held", className: "bg-emerald-500 text-white" },
  skipped: { label: "Skipped", className: "bg-rose-100 text-rose-700" },
  open: { label: "Not marked", className: "bg-amber-100 text-amber-800" },
  upcoming: { label: "Coming up", className: "border border-dashed border-slate-300 text-slate-500" },
  not_created: { label: "Day not opened", className: "bg-slate-100 text-slate-500" },
  off: { label: "Not a routine day", className: "text-slate-300" },
};
const CELL_MARK: Record<SessionCell, string> = { held: "✓", skipped: "✕", open: "•", upcoming: "", not_created: "–", off: "" };

const PLAN_LABEL: Record<string, string> = {
  draft: "Draft plan", publishing: "Publishing", publication_failed: "Publish failed", confirmed: "Confirmed plan", completed: "Plan done", superseded: "Replaced plan",
};

function DayCard({ day }: { day: WeekDay }) {
  const marked = day.done + day.partial + day.skipped;
  const percent = day.planned === 0 ? 0 : Math.round((day.done / day.planned) * 100);
  return (
    <li className={`rounded-lg border p-3 ${day.isToday ? "border-indigo-400" : "border-slate-200"}`}>
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-sm font-semibold text-slate-900">{formatDay(day.date)}</p>
        {day.isToday && <span className="text-xs font-semibold text-indigo-600">Today</span>}
      </div>
      {day.isFuture ? (
        <p className="mt-1 text-xs text-slate-500">Not yet</p>
      ) : !day.plan ? (
        <p className="mt-1 text-xs text-slate-500">No plan{day.logged ? " · log saved" : ""}</p>
      ) : (
        <>
          <p className="mt-1 text-xs text-slate-500">{PLAN_LABEL[day.plan.status] ?? day.plan.status} · {day.planned} planned</p>
          <p className="mt-1 text-sm text-slate-800">
            {day.done} done{day.partial ? `, ${day.partial} partly` : ""}{day.skipped ? `, ${day.skipped} skipped` : ""}
            {day.planned > marked && <span className="text-slate-500">, {day.planned - marked} not marked</span>}
          </p>
          {day.planned > 0 && (
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-label={`${formatDay(day.date)} done`} aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
              <div className="h-full rounded-full bg-emerald-500" style={{ width: `${percent}%` }} />
            </div>
          )}
          <p className="mt-1 text-xs text-slate-500">{day.logged ? "Evening log saved" : "No evening log"}</p>
        </>
      )}
    </li>
  );
}

function WeekContent({ view }: { view: WeekView }) {
  return (
    <>
      <section aria-labelledby="days-title" className="mt-6 card p-5">
        <h2 id="days-title" className="text-lg font-semibold text-slate-900">Days</h2>
        <p className="mt-1 text-sm text-slate-600">Each day&apos;s plan and how it went, from the evening log (or tasks completed that day).</p>
        <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {view.days.map((day) => <DayCard key={day.date} day={day} />)}
        </ul>
      </section>

      <section aria-labelledby="goals-title" className="mt-6 card p-5">
        <h2 id="goals-title" className="text-lg font-semibold text-slate-900">Goals this week</h2>
        <p className="mt-1 text-sm text-slate-600">
          {view.finished ? "Each weekly target against what was logged." : "Each weekly target against what was logged so far, and where you'd expect to be by today."}
        </p>
        {view.goals.length === 0 ? (
          <p className="mt-4 rounded-lg bg-slate-50 px-3 py-3 text-sm text-slate-600">No weekly targets or routines this week. Add them on a goal&apos;s page.</p>
        ) : (
          <ul className="mt-4 space-y-3">
            {view.goals.map((goal) => (
              <li key={goal.goalId} className="rounded-lg border border-slate-200 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Link href={`/goals/${goal.goalId}`} className="text-sm font-semibold text-slate-900 hover:underline">{goal.title}</Link>
                  {goal.status !== "no_target" && (
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${goal.status === "behind" ? "bg-rose-100 text-rose-700" : "bg-emerald-100 text-emerald-800"}`}>
                      {goal.status === "behind" ? (view.finished ? "Missed" : "Behind") : view.finished ? "Met" : "On track"}
                    </span>
                  )}
                </div>
                <ul className="mt-1 text-sm">
                  {goal.targets.map((target, index) => {
                    const line = weekTargetLine(target, view.finished);
                    return <li key={index} className={line.tone === "bad" ? "text-rose-700" : line.tone === "good" ? "text-emerald-700" : "text-slate-600"}>{line.text}</li>;
                  })}
                  {goal.sessions && <li className="text-slate-700">{sessionsLine(goal.sessions)}</li>}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="routines-title" className="mt-6 card p-5">
        <h2 id="routines-title" className="text-lg font-semibold text-slate-900">Routines kept</h2>
        <p className="mt-1 text-sm text-slate-600">✓ held · ✕ skipped · • not marked · – the day wasn&apos;t opened, so no session was created.</p>
        {view.routines.length === 0 ? (
          <p className="mt-4 rounded-lg bg-slate-50 px-3 py-3 text-sm text-slate-600">No routines fall in this week.</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[22rem] border-separate border-spacing-1 text-sm">
              <thead>
                <tr>
                  <th scope="col" className="text-left text-xs font-semibold text-slate-500">Routine</th>
                  {view.days.map((day) => (
                    <th key={day.date} scope="col" className="w-8 text-center text-xs font-semibold text-slate-500">{formatDay(day.date).slice(0, 2)}</th>
                  ))}
                  <th scope="col" className="text-right text-xs font-semibold text-slate-500">Held</th>
                </tr>
              </thead>
              <tbody>
                {view.routines.map((row) => (
                  <tr key={row.routineId}>
                    <th scope="row" className="max-w-[10rem] text-left font-medium text-slate-900">
                      <span className="block truncate">{row.title}</span>
                      {row.goalTitle && <span className="block truncate text-xs font-normal text-slate-500">{row.goalTitle}</span>}
                    </th>
                    {row.cells.map((cell) => (
                      <td key={cell.date} className="text-center">
                        <span title={`${formatDay(cell.date)}: ${CELL[cell.state].label}`} aria-label={`${formatDay(cell.date)}: ${CELL[cell.state].label}`}
                          className={`inline-flex h-7 w-7 items-center justify-center rounded-md text-xs font-bold ${CELL[cell.state].className}`}>
                          {CELL_MARK[cell.state]}
                        </span>
                      </td>
                    ))}
                    <td className="whitespace-nowrap text-right text-slate-700">{row.held} of {row.due}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

export default async function WeekPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { supabase } = await requireUser();
  const timeZone = (await cookies()).get(TIMEZONE_COOKIE_NAME)?.value || DEFAULT_TIMEZONE;
  const today = getTodayISODate(timeZone);
  const week = resolveViewWeek((await searchParams).week, today);
  const current = mondayOf(today);
  const previous = addDaysToISODate(week, -7);
  const next = addDaysToISODate(week, 7);
  const canGoBack = previous >= addDaysToISODate(current, -7 * VIEWABLE_PAST_WEEKS);

  // Like Today and Tasks: today's routine sessions exist before the week is read.
  if (week === current) await materializeRoutineTasks(supabase, today);
  let view: WeekView | null = null;
  try {
    view = await loadWeekView(supabase, week, today, timeZone);
  } catch (error) {
    log("error", "week.load_failed", errorFields(error));
  }

  const navClass = "inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50";
  return (
    <section aria-labelledby="page-title" className="mx-auto max-w-5xl">
      <p className="text-sm font-semibold uppercase tracking-wide text-indigo-600">{week === current ? "This week" : "Past week"}</p>
      <h1 id="page-title" className="mt-2 text-3xl font-bold tracking-tight text-slate-900">Week of {formatDay(week)}</h1>
      <p className="mt-2 text-slate-600">{formatDay(week)} to {formatDay(weekEnd(week))}: whether each goal is on track, day by day.</p>

      <nav aria-label="Weeks" className="mt-4 flex flex-wrap gap-2">
        {canGoBack && <Link href={`/week?week=${previous}`} className={navClass}><ChevronLeft aria-hidden="true" className="h-4 w-4" />Previous week</Link>}
        {week !== current && <Link href="/week" className={navClass}>This week</Link>}
        {week < current && <Link href={`/week?week=${next}`} className={navClass}>Next week<ChevronRight aria-hidden="true" className="h-4 w-4" /></Link>}
      </nav>

      {view ? <WeekContent view={view} /> : (
        <p role="alert" className="mt-6 rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-700">This week could not be loaded right now. Please refresh to try again.</p>
      )}
    </section>
  );
}
