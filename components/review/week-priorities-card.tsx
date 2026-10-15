import Link from "next/link";
import { StatusBadge } from "@/components/status-badge";
import type { PlannedTask } from "@/lib/review/load";

/** Today's reminder of the priorities chosen for this week in the weekly review. */
export function WeekPrioritiesCard({ priorities }: { priorities: PlannedTask[] }) {
  if (!priorities.length) return null;
  return (
    <section aria-labelledby="week-priorities-title" className="mt-6 rounded-2xl border border-indigo-100 bg-indigo-50/40 p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="week-priorities-title" className="text-lg font-semibold text-slate-900">This week&apos;s priorities</h2>
        <Link href="/review" className="text-sm font-medium text-indigo-700 hover:text-indigo-800">Edit in weekly review</Link>
      </div>
      <ol className="mt-3 space-y-2">
        {priorities.map((task, index) => (
          <li key={task.taskId} className="flex min-w-0 items-center gap-2 rounded-lg bg-white px-3 py-2 text-sm">
            <span className="shrink-0 font-semibold text-indigo-700">{index + 1}.</span>
            <span className="min-w-0 flex-1 truncate font-medium text-slate-800">{task.title}</span>
            <StatusBadge status={task.status} />
          </li>
        ))}
      </ol>
      <p className="mt-2 text-xs text-slate-500">Generated plans this week rank these first among otherwise similar work.</p>
    </section>
  );
}
