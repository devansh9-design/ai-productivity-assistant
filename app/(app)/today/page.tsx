import Link from "next/link";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { StatusBadge, PriorityBadge, EmptyState } from "@/components/status-badge";
import { TaskActionForm } from "@/components/task-action-form";
import { TIMEZONE_COOKIE_NAME } from "@/components/timezone-sync";
import { getCompletedToday, getTodayTasks, getTopPriorities } from "@/lib/tasks/filters";
import { DEFAULT_TIMEZONE, getTodayISODate } from "@/lib/tasks/timezone";
import type { Task } from "@/lib/types";

function TaskRow({ task }: { task: Task }) {
  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold text-slate-900">{task.title}</h3>
            <StatusBadge status={task.status} />
            <PriorityBadge priority={task.priority} />
            {task.due_date && <span className="text-xs font-medium text-slate-500">Due {task.due_date}</span>}
          </div>
          {task.description && <p className="mt-1 text-sm text-slate-600">{task.description}</p>}
          <p className="mt-1 text-xs text-slate-500">
            {task.estimated_minutes ? `${task.estimated_minutes} min estimated` : "No estimate"}
            {task.actual_minutes ? ` · ${task.actual_minutes} min actual` : ""}
          </p>
          {task.status_reason && (task.status === "skipped" || task.status === "deferred") && (
            <p className="mt-1 text-xs text-amber-700">
              {task.status === "skipped" ? "Skipped" : "Deferred"}: {task.status_reason}
            </p>
          )}
        </div>
        <TaskActionForm task={task} />
      </div>
    </article>
  );
}

export default async function TodayPage() {
  const cookieStore = await cookies();
  const timeZone = cookieStore.get(TIMEZONE_COOKIE_NAME)?.value || DEFAULT_TIMEZONE;
  const todayISODate = getTodayISODate(timeZone);

  const supabase = await createClient();
  const { data: tasks, error } = await supabase
    .from("tasks")
    .select("*")
    .order("due_date", { ascending: true })
    .returns<Task[]>();

  const allTasks = tasks ?? [];
  const todayTasks = getTodayTasks(allTasks, todayISODate);
  const topPriorities = getTopPriorities(todayTasks, 3);
  const topPriorityIds = new Set(topPriorities.map((t) => t.id));
  const restOfToday = todayTasks.filter((t) => !topPriorityIds.has(t.id));
  const completedToday = getCompletedToday(allTasks, todayISODate, timeZone);

  const totalToday = todayTasks.length + completedToday.length;
  const progressPercent = totalToday === 0 ? 0 : Math.round((completedToday.length / totalToday) * 100);

  const formattedDate = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(new Date());

  return (
    <section aria-labelledby="page-title" className="mx-auto max-w-4xl">
      <p className="text-sm font-semibold uppercase tracking-wide text-indigo-600">{formattedDate}</p>
      <h1 id="page-title" className="mt-2 text-3xl font-bold tracking-tight text-slate-900">
        Today
      </h1>

      {error && (
        <p role="alert" className="mt-4 rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-700">
          Could not load today&apos;s tasks: {error.message}
        </p>
      )}

      {!error && totalToday === 0 && (
        <div className="mt-6">
          <EmptyState
            title="Nothing scheduled for today"
            description="Add a task with today's date, or set a due date on something in your backlog, to see it here."
          />
          <div className="mt-4 flex justify-center">
            <Link
              href="/tasks"
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
            >
              Go to Tasks
            </Link>
          </div>
        </div>
      )}

      {!error && totalToday > 0 && (
        <>
          <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-5">
            <div className="flex items-center justify-between text-sm font-medium text-slate-700">
              <span>
                {completedToday.length} of {totalToday} done today
              </span>
              <span>{progressPercent}%</span>
            </div>
            <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full rounded-full bg-emerald-500 transition-all"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>

          {topPriorities.length > 0 && (
            <div className="mt-8">
              <h2 className="text-lg font-semibold text-slate-900">Top priorities</h2>
              <p className="mt-1 text-sm text-slate-600">The highest-priority work due today or overdue.</p>
              <div className="mt-4 space-y-3">
                {topPriorities.map((task) => (
                  <TaskRow key={task.id} task={task} />
                ))}
              </div>
            </div>
          )}

          {restOfToday.length > 0 && (
            <div className="mt-8">
              <h2 className="text-lg font-semibold text-slate-900">Also today</h2>
              <div className="mt-4 space-y-3">
                {restOfToday.map((task) => (
                  <TaskRow key={task.id} task={task} />
                ))}
              </div>
            </div>
          )}

          {completedToday.length > 0 && (
            <div className="mt-8">
              <h2 className="text-lg font-semibold text-slate-900">Done today</h2>
              <div className="mt-4 space-y-3">
                {completedToday.map((task) => (
                  <TaskRow key={task.id} task={task} />
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
