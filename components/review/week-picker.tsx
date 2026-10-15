import { formatDay } from "@/lib/analytics/format";
import { weekEnd } from "@/lib/review/week";

/** A plain GET form, so the reviewed week lives in the URL and works without client JavaScript. */
export function WeekPicker({ weeks, selected }: { weeks: string[]; selected: string }) {
  return (
    <form method="get" action="/review" className="mt-6 flex flex-wrap items-end gap-3 rounded-2xl border border-slate-200 bg-white p-5">
      <label className="min-w-0 text-sm font-medium text-slate-800">Week to review
        <select name="week" defaultValue={selected} className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-1.5 text-slate-900">
          {weeks.map((week) => <option key={week} value={week}>{formatDay(week)} to {formatDay(weekEnd(week))}</option>)}
        </select>
      </label>
      <button type="submit" className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-sm font-semibold text-indigo-700 hover:bg-indigo-100">Show week</button>
    </form>
  );
}
