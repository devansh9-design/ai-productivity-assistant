import Link from "next/link";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createTask, deleteTask, updateTaskStatus } from "@/lib/tasks/actions";
import { StatusBadge, PriorityBadge, EmptyState } from "@/components/status-badge";
import { SubmitButton } from "@/components/submit-button";
import { TIMEZONE_COOKIE_NAME } from "@/components/timezone-sync";
import { DEFAULT_TASK_FILTER, TASK_FILTERS, filterTasks, isTaskFilter, type TaskFilter } from "@/lib/tasks/filters";
import { DEFAULT_TIMEZONE, getTodayISODate } from "@/lib/tasks/timezone";
import type { Goal, Milestone, Project, Task } from "@/lib/types";

const FILTER_LABELS: Record<TaskFilter, string> = {
  inbox: "Inbox",
  today: "Today",
  "due-soon": "Due soon",
  overdue: "Overdue",
  completed: "Completed",
};

export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  const { filter: rawFilter } = await searchParams;
  const filter: TaskFilter = isTaskFilter(rawFilter) ? rawFilter : DEFAULT_TASK_FILTER;

  const cookieStore = await cookies();
  const timeZone = cookieStore.get(TIMEZONE_COOKIE_NAME)?.value || DEFAULT_TIMEZONE;
  const todayISODate = getTodayISODate(timeZone);

  const supabase = await createClient();
  const [{ data: tasks, error }, { data: goals }, { data: projects }, { data: milestones }] = await Promise.all([
    supabase.from("tasks").select("*").order("due_date", { ascending: true }).returns<Task[]>(),
    supabase.from("goals").select("*").order("title", { ascending: true }).returns<Goal[]>(),
    supabase.from("projects").select("*").order("title", { ascending: true }).returns<Project[]>(),
    supabase.from("milestones").select("*").order("title", { ascending: true }).returns<Milestone[]>(),
  ]);

  const allTasks = tasks ?? [];
  const visibleTasks = filterTasks(allTasks, filter, todayISODate);
  const goalTitleById = new Map((goals ?? []).map((g) => [g.id, g.title]));

  return (
    <section aria-labelledby="page-title" className="mx-auto max-w-4xl">
      <p className="text-sm font-semibold uppercase tracking-wide text-indigo-600">Personal workspace</p>
      <h1 id="page-title" className="mt-2 text-3xl font-bold tracking-tight text-slate-900">
        Tasks
      </h1>
      <p className="mt-2 max-w-lg text-slate-600">Every task can link to a goal, project, and milestone.</p>

      <form action={createTask} className="mt-8 rounded-2xl border border-slate-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-slate-900">New task</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="block text-sm font-medium text-slate-800 sm:col-span-2" htmlFor="task-title">
            Title
            <input
              className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900"
              id="task-title"
              name="title"
              required
              maxLength={200}
            />
          </label>

          <label className="block text-sm font-medium text-slate-800" htmlFor="task-category">
            Category
            <input
              className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900"
              id="task-category"
              name="category"
              placeholder="e.g. DSA, gym, coursework"
            />
          </label>

          <label className="block text-sm font-medium text-slate-800" htmlFor="task-priority">
            Priority
            <select
              className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900"
              id="task-priority"
              name="priority"
              defaultValue="medium"
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
            </select>
          </label>

          <label className="block text-sm font-medium text-slate-800" htmlFor="task-energy">
            Energy level
            <select
              className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900"
              id="task-energy"
              name="energy_level"
              defaultValue=""
            >
              <option value="">Not set</option>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </label>

          <label className="block text-sm font-medium text-slate-800" htmlFor="task-estimate">
            Estimated minutes
            <input
              className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900"
              id="task-estimate"
              name="estimated_minutes"
              type="number"
              min={1}
              step={1}
            />
          </label>

          <label className="block text-sm font-medium text-slate-800" htmlFor="task-due-date">
            Due date
            <input
              className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900"
              id="task-due-date"
              name="due_date"
              type="date"
            />
          </label>

          <label className="block text-sm font-medium text-slate-800" htmlFor="task-goal">
            Goal
            <select
              className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900"
              id="task-goal"
              name="goal_id"
              defaultValue=""
            >
              <option value="">No goal</option>
              {(goals ?? []).map((goal) => (
                <option key={goal.id} value={goal.id}>
                  {goal.title}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-sm font-medium text-slate-800" htmlFor="task-project">
            Project
            <select
              className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900"
              id="task-project"
              name="project_id"
              defaultValue=""
            >
              <option value="">No project</option>
              {(projects ?? []).map((project) => (
                <option key={project.id} value={project.id}>
                  {project.title}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-sm font-medium text-slate-800" htmlFor="task-milestone">
            Milestone
            <select
              className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900"
              id="task-milestone"
              name="milestone_id"
              defaultValue=""
            >
              <option value="">No milestone</option>
              {(milestones ?? []).map((milestone) => (
                <option key={milestone.id} value={milestone.id}>
                  {milestone.title}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-sm font-medium text-slate-800 sm:col-span-2" htmlFor="task-description">
            Description
            <textarea
              className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900"
              id="task-description"
              name="description"
              rows={2}
            />
          </label>
        </div>
        <SubmitButton
          pendingLabel="Adding…"
          className="mt-4 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
        >
          Add task
        </SubmitButton>
      </form>

      <nav aria-label="Task filters" className="mt-8 flex flex-wrap gap-2">
        {TASK_FILTERS.map((option) => (
          <Link
            key={option}
            href={`/tasks?filter=${option}`}
            aria-current={filter === option ? "page" : undefined}
            className={`rounded-full px-4 py-1.5 text-sm font-medium ${
              filter === option
                ? "bg-indigo-600 text-white"
                : "bg-white text-slate-700 border border-slate-300 hover:bg-slate-100"
            }`}
          >
            {FILTER_LABELS[option]}
          </Link>
        ))}
      </nav>

      <div className="mt-4 space-y-3">
        {error && (
          <p role="alert" className="rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-700">
            Could not load tasks: {error.message}
          </p>
        )}

        {!error && visibleTasks.length === 0 && (
          <EmptyState
            title={`Nothing in ${FILTER_LABELS[filter]}`}
            description="Add a task above, or switch filters to see other work."
          />
        )}

        {visibleTasks.map((task) => (
          <article key={task.id} className="rounded-2xl border border-slate-200 bg-white p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-base font-semibold text-slate-900">{task.title}</h3>
                  <StatusBadge status={task.status} />
                  <PriorityBadge priority={task.priority} />
                  {task.due_date && <span className="text-xs font-medium text-slate-500">Due {task.due_date}</span>}
                  {task.goal_id && (
                    <span className="text-xs font-medium text-slate-500">
                      {goalTitleById.get(task.goal_id) ?? "Linked goal"}
                    </span>
                  )}
                </div>
                {task.description && <p className="mt-1 text-sm text-slate-600">{task.description}</p>}
                <p className="mt-1 text-xs text-slate-500">
                  {task.estimated_minutes ? `${task.estimated_minutes} min estimated` : "No estimate"}
                  {task.actual_minutes ? ` · ${task.actual_minutes} min actual` : ""}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {task.status !== "completed" && (
                  <form action={updateTaskStatus}>
                    <input type="hidden" name="id" value={task.id} />
                    <input type="hidden" name="status" value="completed" />
                    <button
                      type="submit"
                      className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1 text-sm font-medium text-emerald-700 hover:bg-emerald-100"
                    >
                      Complete
                    </button>
                  </form>
                )}
                {task.status !== "skipped" && task.status !== "completed" && (
                  <form action={updateTaskStatus}>
                    <input type="hidden" name="id" value={task.id} />
                    <input type="hidden" name="status" value="skipped" />
                    <button
                      type="submit"
                      className="rounded-lg border border-slate-300 px-3 py-1 text-sm font-medium text-slate-700 hover:bg-slate-100"
                    >
                      Skip
                    </button>
                  </form>
                )}
                {task.status !== "deferred" && task.status !== "completed" && (
                  <form action={updateTaskStatus}>
                    <input type="hidden" name="id" value={task.id} />
                    <input type="hidden" name="status" value="deferred" />
                    <button
                      type="submit"
                      className="rounded-lg border border-slate-300 px-3 py-1 text-sm font-medium text-slate-700 hover:bg-slate-100"
                    >
                      Defer
                    </button>
                  </form>
                )}
                {task.status === "completed" && (
                  <form action={updateTaskStatus}>
                    <input type="hidden" name="id" value={task.id} />
                    <input type="hidden" name="status" value="todo" />
                    <button
                      type="submit"
                      className="rounded-lg border border-slate-300 px-3 py-1 text-sm font-medium text-slate-700 hover:bg-slate-100"
                    >
                      Reopen
                    </button>
                  </form>
                )}
                <form action={deleteTask}>
                  <input type="hidden" name="id" value={task.id} />
                  <button
                    type="submit"
                    className="rounded-lg border border-slate-300 px-3 py-1 text-sm font-medium text-slate-700 hover:bg-slate-100"
                  >
                    Delete
                  </button>
                </form>
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
