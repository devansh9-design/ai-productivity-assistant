import Link from "next/link";
import { RANGE_PRESETS, type AnalyticsRange, type RangePreset } from "@/lib/analytics/range";

const LABELS: Record<RangePreset, string> = { "7d": "Last 7 days", week: "This week", "30d": "Last 30 days" };

/** Plain links and a GET form, so the range lives in the URL and works without client JavaScript. */
export function RangeSelector({ range, today }: { range: AnalyticsRange; today: string }) {
  return (
    <div className="mt-6 card p-5">
      <nav aria-label="Date range" className="flex flex-wrap gap-2">
        {RANGE_PRESETS.map((preset) => {
          const active = range.preset === preset;
          return (
            <Link
              key={preset}
              href={`/analytics?range=${preset}`}
              aria-current={active ? "page" : undefined}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium ${active ? "bg-indigo-600 text-white" : "border border-slate-300 text-slate-700 hover:bg-slate-50"}`}
            >
              {LABELS[preset]}
            </Link>
          );
        })}
      </nav>
      <form method="get" action="/analytics" className="mt-4 flex flex-wrap items-end gap-3">
        <label className="text-sm font-medium text-slate-800">From
          <input type="date" name="from" required max={today} defaultValue={range.from} className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-1.5 text-slate-900" />
        </label>
        <label className="text-sm font-medium text-slate-800">To
          <input type="date" name="to" required max={today} defaultValue={range.to} className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-1.5 text-slate-900" />
        </label>
        <button type="submit" className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-sm font-semibold text-indigo-700 hover:bg-indigo-100">
          Apply custom range
        </button>
      </form>
      <p className="mt-2 text-xs text-slate-500">Custom ranges can cover up to 92 days and cannot end after today.</p>
    </div>
  );
}
