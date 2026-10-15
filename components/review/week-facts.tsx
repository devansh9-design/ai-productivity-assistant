import { BarList } from "@/components/analytics/bar-list";
import { EmptyNote } from "@/components/analytics/section";
import { StatGrid } from "@/components/analytics/stat-grid";
import { formatDay, formatMinutes } from "@/lib/analytics/format";
import type { WeekFacts } from "@/lib/review/facts";

function TaskList({ heading, items, empty }: { heading: string; items: Array<{ key: string; title: string; detail: string }>; empty: string }) {
  return (
    <div className="min-w-0">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">{heading}</h3>
      {items.length ? (
        <ul className="mt-2 space-y-1.5">
          {items.map((item) => (
            <li key={item.key} className="flex flex-wrap items-baseline justify-between gap-x-3 rounded-lg bg-slate-50 px-3 py-2 text-sm">
              <span className="min-w-0 truncate font-medium text-slate-800">{item.title}</span>
              <span className="shrink-0 text-slate-500">{item.detail}</span>
            </li>
          ))}
        </ul>
      ) : <p className="mt-2 text-sm text-slate-500">{empty}</p>}
    </div>
  );
}

export function WeekFactsView({ facts }: { facts: WeekFacts }) {
  if (facts.isEmpty) {
    return <EmptyNote>Nothing was recorded for this week: no completed tasks, logged time, confirmed plans, due tasks, or check-ins.</EmptyNote>;
  }
  const metric = (key: keyof WeekFacts["metrics"]) => facts.metrics[key]?.value ?? "—";
  const slipped = [
    ...facts.missedPlanned.map((task) => ({ key: `plan-${task.id}-${task.date}`, title: task.title, detail: `planned ${formatDay(task.date)}` })),
    ...facts.dueNotDone.map((task) => ({ key: `due-${task.id}`, title: task.title, detail: `due ${formatDay(task.dueDate)} · ${task.status.replace("_", " ")}` })),
  ];

  return (
    <div className="space-y-6">
      <StatGrid stats={[
        { label: "Tasks completed", value: metric("completed_tasks"), detail: "Completed during this week." },
        { label: "Logged time", value: metric("logged_time"), detail: `Timer ${formatMinutes(facts.timerMinutes)} · entered on completion ${formatMinutes(facts.manualMinutes)}.` },
        { label: "Planned tasks on time", value: facts.completion.rate === null ? "—" : `${Math.round(facts.completion.rate * 100)}%`, detail: facts.completion.rate === null ? "No finished days with confirmed plans." : `${facts.completion.completedOnTime} of ${facts.completion.planned} from confirmed plans.` },
        { label: "Longest streak", value: metric("longest_streak"), detail: "Consecutive days with a completed task." },
      ]} />

      <div className="grid gap-6 md:grid-cols-2">
        <TaskList heading="Completed" empty="No tasks were completed this week."
          items={facts.completed.map((task) => ({ key: task.id, title: task.title, detail: formatDay(task.date) }))} />
        <TaskList heading="Slipped" empty="Nothing slipped this week." items={slipped} />
      </div>

      {facts.categories.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Top categories</h3>
          <div className="mt-2"><BarList items={facts.categories.map((bar) => ({ label: bar.label, value: bar.value, display: formatMinutes(bar.value) }))} /></div>
        </div>
      )}

      <div>
        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Check-ins</h3>
        {facts.checkins.length ? (
          <ul className="mt-2 space-y-2">
            {facts.checkins.map((checkin) => (
              <li key={checkin.date} className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">
                <p className="font-medium text-slate-800">
                  {formatDay(checkin.date)}
                  {checkin.mood !== null && ` · mood ${checkin.mood}/5`}
                  {checkin.energy_level && ` · ${checkin.energy_level} energy`}
                </p>
                {checkin.wins && <p className="mt-1 break-words"><span className="font-medium">Wins:</span> {checkin.wins}</p>}
                {checkin.lesson && <p className="mt-1 break-words"><span className="font-medium">Lesson:</span> {checkin.lesson}</p>}
              </li>
            ))}
          </ul>
        ) : <p className="mt-2 text-sm text-slate-500">No check-ins were saved this week.</p>}
      </div>
    </div>
  );
}
