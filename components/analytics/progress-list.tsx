import { formatDay, plural } from "@/lib/analytics/format";
import type { ProgressItem } from "@/lib/analytics/metrics";

export function ProgressList({ heading, items }: { heading: string; items: ProgressItem[] }) {
  return (
    <div>
      <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">{heading}</h3>
      <ul className="mt-2 space-y-3">
        {items.map((item) => (
          <li key={item.id}>
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
              <span className="min-w-0 truncate font-medium text-slate-800">
                {item.title}
                {item.dueDate && <span className="ml-2 font-normal text-slate-500">due {formatDay(item.dueDate)}</span>}
              </span>
              <span className="shrink-0 text-slate-600">
                {item.percent === null ? "No linked tasks yet" : `${item.percent}% · ${item.completed} of ${plural(item.total, "task")}`}
              </span>
            </div>
            <div aria-hidden="true" className="mt-1 h-2 w-full overflow-hidden rounded-full bg-slate-100">
              <div className="h-full rounded-full bg-emerald-500" style={{ width: `${item.percent ?? 0}%` }} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
