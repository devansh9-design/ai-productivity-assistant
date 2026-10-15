import { cookies } from "next/headers";
import { requireUser } from "@/lib/auth/require-user";
import { loadAnalytics } from "@/lib/analytics/load";
import { formatMinutes, plural } from "@/lib/analytics/format";
import { resolveAnalyticsRange } from "@/lib/analytics/range";
import type { AnalyticsResult } from "@/lib/analytics/metrics";
import { DEFAULT_TIMEZONE, getTodayISODate, TIMEZONE_COOKIE_NAME } from "@/lib/tasks/timezone";
import { AnalyticsSection, EmptyNote } from "@/components/analytics/section";
import { StatGrid } from "@/components/analytics/stat-grid";
import { BarList } from "@/components/analytics/bar-list";
import { PlannedVsLogged } from "@/components/analytics/planned-vs-logged";
import { ProgressList } from "@/components/analytics/progress-list";
import { RangeSelector } from "@/components/analytics/range-selector";

function headlineStats(result: AnalyticsResult) {
  const { completion, streak } = result;
  return [
    {
      label: "Completion rate",
      value: completion.rate === null ? "—" : `${Math.round(completion.rate * 100)}%`,
      detail: completion.rate !== null
        ? `${completion.completedOnTime} of ${plural(completion.planned, "planned task")} done on time, over ${plural(completion.daysCounted, "day")}.`
        : completion.daysCounted
          ? `${plural(completion.daysCounted, "finished day")} with a confirmed plan, but no tasks remain on those plans (deleting a task removes it from plans).`
          : "No finished days with a confirmed plan in this range.",
    },
    {
      label: "Logged time",
      value: formatMinutes(result.loggedMinutes),
      detail: `Timer ${formatMinutes(result.timerMinutes)} · entered on completion ${formatMinutes(result.manualMinutes)}.`,
    },
    {
      label: "Current streak",
      value: plural(streak.current, "day"),
      detail: `Longest in this range: ${plural(streak.longestInRange, "day")}.`,
    },
    {
      label: "Overdue now",
      value: String(result.overdueCount),
      detail: "Open or deferred tasks past their due date, as of today.",
    },
  ];
}

function exclusionNote(excluded: AnalyticsResult["excluded"]): string | null {
  const parts = [
    excluded.open && `${plural(excluded.open, "session")} still running`,
    excluded.empty && `${plural(excluded.empty, "session")} with no minutes`,
    excluded.overlong && `${plural(excluded.overlong, "session")} longer than 12 hours (likely a timer left on)`,
  ].filter(Boolean);
  return parts.length ? `Left out of logged time: ${parts.join(", ")}.` : null;
}

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { supabase, user } = await requireUser();
  const timeZone = (await cookies()).get(TIMEZONE_COOKIE_NAME)?.value || DEFAULT_TIMEZONE;
  const today = getTodayISODate(timeZone);
  const range = resolveAnalyticsRange(await searchParams, today);

  let result: AnalyticsResult | null = null;
  let loadError: string | null = null;
  try {
    result = await loadAnalytics(supabase, user.id, range, timeZone, today);
  } catch (error) {
    console.error("Analytics load failed:", error instanceof Error ? error.message : error);
    loadError = "Analytics could not be loaded right now. Please refresh to try again.";
  }

  const note = result ? exclusionNote(result.excluded) : null;
  const hasDailyData = result?.daily.some((day) => day.loggedMinutes > 0 || day.plannedMinutes !== null) ?? false;

  return (
    <section aria-labelledby="page-title" className="mx-auto max-w-4xl">
      <p className="text-sm font-semibold uppercase tracking-wide text-indigo-600">{range.label}</p>
      <h1 id="page-title" className="mt-2 text-3xl font-bold tracking-tight text-slate-900">Analytics</h1>
      <p className="mt-2 max-w-2xl text-slate-600">How your plans, time, and goals are going. Days follow your local timezone ({timeZone}).</p>

      <RangeSelector range={range} today={today} />

      {loadError && <p role="alert" className="mt-6 rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-700">{loadError}</p>}

      {result && (
        <>
          <AnalyticsSection
            id="summary"
            title="Summary"
            explanation="Completion rate counts each task once per finished day with a confirmed plan (the latest confirmed version), done on or before that day. Today is included once it is over."
          >
            <StatGrid stats={headlineStats(result)} />
          </AnalyticsSection>

          <AnalyticsSection
            id="daily"
            title="Planned vs logged time"
            explanation="Planned is the task time in the plan you confirmed for that day. Logged is timer time, or the minutes you entered when completing a task that has no timer sessions; a task never counts both."
          >
            {hasDailyData ? <PlannedVsLogged days={result.daily} /> : <EmptyNote>No confirmed plans or logged time in this range yet. Confirm a plan on Today, or track time with the task timer.</EmptyNote>}
          </AnalyticsSection>

          <AnalyticsSection
            id="categories"
            title="Logged time by category"
            explanation={`Logged time grouped by task category, ignoring capitalization and spacing. The categories add up to the ${formatMinutes(result.loggedMinutes)} total.`}
          >
            {result.categories.length
              ? <BarList items={result.categories.map((bar) => ({ label: bar.label, value: bar.value, display: formatMinutes(bar.value) }))} />
              : <EmptyNote>No time logged in this range.</EmptyNote>}
          </AnalyticsSection>

          <AnalyticsSection
            id="reasons"
            title="Currently skipped or deferred"
            explanation="Tasks that are skipped or deferred right now and were last updated in this range, grouped by reason. Status changes are not stored as history, so earlier skips or deferrals of tasks that have since changed are not shown."
          >
            {result.reasons.length
              ? <BarList items={result.reasons.map((bar) => ({ label: bar.label, value: bar.value, display: plural(bar.value, "task") }))} />
              : <EmptyNote>No tasks are currently skipped or deferred from this range.</EmptyNote>}
          </AnalyticsSection>

          <AnalyticsSection
            id="progress"
            title="Goal and milestone progress"
            explanation="All-time progress for active goals and milestones, not limited to the date range: completed tasks out of linked tasks, leaving out skipped ones. Goals include tasks linked through their project or milestone."
          >
            {result.goals.length || result.milestones.length ? (
              <div className="space-y-6">
                {result.goals.length > 0 && <ProgressList heading="Goals" items={result.goals} />}
                {result.milestones.length > 0 && <ProgressList heading="Milestones" items={result.milestones} />}
              </div>
            ) : <EmptyNote>No active goals or milestones yet. Add them on the Goals and Milestones pages.</EmptyNote>}
          </AnalyticsSection>

          <p className="mt-4 text-xs text-slate-500">
            {note ? `${note} ` : ""}Deleting a task also removes its timer history.
          </p>
        </>
      )}
    </section>
  );
}
