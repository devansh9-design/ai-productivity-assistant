import { barPercent } from "@/lib/analytics/format";

export interface BarListItem {
  label: string;
  value: number;
  /** Text shown for the value, e.g. "2h 15m" or "3 tasks". */
  display: string;
}

/** Horizontal bars scaled to the largest value. The value is always written out as text. */
export function BarList({ items }: { items: BarListItem[] }) {
  const max = Math.max(0, ...items.map((item) => item.value));
  return (
    <ul className="space-y-3">
      {items.map((item) => (
        <li key={item.label}>
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 truncate font-medium text-slate-800">{item.label}</span>
            <span className="shrink-0 text-slate-600">{item.display}</span>
          </div>
          <div aria-hidden="true" className="mt-1 h-2 w-full overflow-hidden rounded-full bg-slate-100">
            <div className="h-full rounded-full bg-indigo-500" style={{ width: `${barPercent(item.value, max)}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}
