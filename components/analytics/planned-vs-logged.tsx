import { barPercent, formatDay, formatMinutes } from "@/lib/analytics/format";
import type { DailyPoint } from "@/lib/analytics/metrics";

/** One row per day: planned and logged minutes as paired bars on a shared scale, with both values in text. */
export function PlannedVsLogged({ days }: { days: DailyPoint[] }) {
  const max = Math.max(0, ...days.flatMap((day) => [day.plannedMinutes ?? 0, day.loggedMinutes]));
  return (
    <div>
      <div aria-hidden="true" className="mb-3 flex gap-4 text-xs text-slate-600">
        <span className="flex items-center gap-1.5"><span className="inline-block h-2 w-4 rounded-full bg-slate-400" />Planned</span>
        <span className="flex items-center gap-1.5"><span className="inline-block h-2 w-4 rounded-full bg-indigo-500" />Logged</span>
      </div>
      <ul className="space-y-3">
        {days.map((day) => (
          <li key={day.date}>
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
              <span className="font-medium text-slate-800">{formatDay(day.date)}</span>
              <span className="text-slate-600">
                Planned {day.plannedMinutes === null ? "no confirmed plan" : formatMinutes(day.plannedMinutes)} · Logged {formatMinutes(day.loggedMinutes)}
              </span>
            </div>
            <div aria-hidden="true" className="mt-1 space-y-1">
              <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                <div className="h-full rounded-full bg-slate-400" style={{ width: `${barPercent(day.plannedMinutes ?? 0, max)}%` }} />
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                <div className="h-full rounded-full bg-indigo-500" style={{ width: `${barPercent(day.loggedMinutes, max)}%` }} />
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
