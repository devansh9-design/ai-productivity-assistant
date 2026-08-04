import Link from "next/link";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { StatusBadge, PriorityBadge, EmptyState } from "@/components/status-badge";
import { TaskActionForm } from "@/components/task-action-form";
import { TaskTimer } from "@/components/task-timer";
import { EveningCheckinForm } from "@/components/evening-checkin-form";
import { RecentReflections } from "@/components/recent-reflections";
import { ActionForm } from "@/components/action-form";
import { ActionSubmitButton } from "@/components/action-submit-button";
import { TIMEZONE_COOKIE_NAME } from "@/components/timezone-sync";
import { getCompletedToday, getTodayTasks, getTopPriorities } from "@/lib/tasks/filters";
import { DEFAULT_TIMEZONE, getTodayISODate } from "@/lib/tasks/timezone";
import { generateDraftPlan } from "@/lib/plans/actions";
import { PlanTimeline } from "@/components/plan-timeline";
import { PlanHistory } from "@/components/plan-history";
import type { Checkin, DailyPlan, FixedCommitment, JournalEntry, PlanBlock, PlanUnscheduledTask, Task, TaskSession } from "@/lib/types";

const RECENT_REFLECTIONS_LIMIT = 7;

function TaskRow({ task, activeSession }: { task: Task; activeSession: TaskSession | null }) {
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
          {task.status !== "completed" && (
            <div className="mt-2">
              <TaskTimer taskId={task.id} activeSession={activeSession} />
            </div>
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
  const [
    { data: tasks, error: tasksError },
    { data: activeSessions },
    { data: todayCheckin },
    { data: todayJournalEntry },
    { data: recentJournalEntries },
    { data: recentCheckins },
    { data: allPlans },
    { data: fixedCommitments },
  ] = await Promise.all([
    supabase.from("tasks").select("*").order("due_date", { ascending: true }).returns<Task[]>(),
    supabase.from("task_sessions").select("*").is("ended_at", null).returns<TaskSession[]>(),
    supabase
      .from("checkins")
      .select("*")
      .eq("checkin_date", todayISODate)
      .eq("type", "evening")
      .maybeSingle<Checkin>(),
    supabase.from("journal_entries").select("*").eq("entry_date", todayISODate).maybeSingle<JournalEntry>(),
    supabase
      .from("journal_entries")
      .select("*")
      .order("entry_date", { ascending: false })
      .limit(RECENT_REFLECTIONS_LIMIT)
      .returns<JournalEntry[]>(),
    supabase
      .from("checkins")
      .select("*")
      .eq("type", "evening")
      .order("checkin_date", { ascending: false })
      .limit(RECENT_REFLECTIONS_LIMIT)
      .returns<Checkin[]>(),
    supabase.from("daily_plans").select("*").eq("plan_date", todayISODate).order("version", { ascending: false }).returns<DailyPlan[]>(),
    supabase.from("fixed_commitments").select("*").eq("commitment_date", todayISODate).order("start_time").returns<FixedCommitment[]>(),
  ]);

  const plans = allPlans ?? [];
  const activePlan = plans.find((p) => p.status === "draft" || p.status === "confirmed") ?? null;
  const historyPlans = plans.filter((p) => p.status === "superseded" || p.status === "completed");
  const planIds = plans.map((p) => p.id);

  const [{ data: allBlocks }, { data: allUnscheduled }] = planIds.length > 0
    ? await Promise.all([
        supabase.from("plan_blocks").select("*").in("daily_plan_id", planIds).order("start_time").returns<PlanBlock[]>(),
        supabase.from("plan_unscheduled_tasks").select("*").in("daily_plan_id", planIds).returns<PlanUnscheduledTask[]>(),
      ])
    : [{ data: [] as PlanBlock[] }, { data: [] as PlanUnscheduledTask[] }];

  const blocksByPlan = new Map<string, PlanBlock[]>();
  const unscheduledByPlan = new Map<string, PlanUnscheduledTask[]>();
  for (const b of allBlocks ?? []) {
    const list = blocksByPlan.get(b.daily_plan_id) ?? [];
    list.push(b);
    blocksByPlan.set(b.daily_plan_id, list);
  }
  for (const u of allUnscheduled ?? []) {
    const list = unscheduledByPlan.get(u.daily_plan_id) ?? [];
    list.push(u);
    unscheduledByPlan.set(u.daily_plan_id, list);
  }

  const allTasks = tasks ?? [];
  const todayTasks = getTodayTasks(allTasks, todayISODate);
  const topPriorities = getTopPriorities(todayTasks, 3);
  const topPriorityIds = new Set(topPriorities.map((t) => t.id));
  const restOfToday = todayTasks.filter((t) => !topPriorityIds.has(t.id));
  const completedToday = getCompletedToday(allTasks, todayISODate, timeZone);

  const totalToday = todayTasks.length + completedToday.length;
  const progressPercent = totalToday === 0 ? 0 : Math.round((completedToday.length / totalToday) * 100);

  const activeSessionByTaskId = new Map((activeSessions ?? []).map((session) => [session.task_id, session]));
  const checkinsByDate = new Map((recentCheckins ?? []).map((checkin) => [checkin.checkin_date, checkin]));

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

      <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div><h2 className="text-lg font-semibold text-slate-900">Daily schedule</h2><p className="mt-1 text-sm text-slate-600">{activePlan ? `Plan v${activePlan.version} with ${activePlan.buffer_minutes} minutes of protected buffer.` : "Generate a deterministic plan from your settings, commitments, and open tasks."}</p></div>
          <ActionForm action={generateDraftPlan} resetOnSuccess={false}><ActionSubmitButton pendingLabel="Generating..." className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700">{activePlan ? "Regenerate plan" : "Generate plan"}</ActionSubmitButton></ActionForm>
        </div>
      </div>

      {activePlan && (
        <PlanTimeline
          plan={activePlan}
          blocks={blocksByPlan.get(activePlan.id) ?? []}
          unscheduledTasks={unscheduledByPlan.get(activePlan.id) ?? []}
          allTasks={allTasks}
          fixedCommitments={fixedCommitments ?? []}
        />
      )}

      <PlanHistory
        entries={historyPlans.map((plan) => ({
          plan,
          blocks: blocksByPlan.get(plan.id) ?? [],
        }))}
      />

      {tasksError && (
        <p role="alert" className="mt-4 rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-700">
          Could not load today&apos;s tasks: {tasksError.message}
        </p>
      )}

      {!tasksError && totalToday === 0 && (
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

      {!tasksError && totalToday > 0 && (
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
                  <TaskRow key={task.id} task={task} activeSession={activeSessionByTaskId.get(task.id) ?? null} />
                ))}
              </div>
            </div>
          )}

          {restOfToday.length > 0 && (
            <div className="mt-8">
              <h2 className="text-lg font-semibold text-slate-900">Also today</h2>
              <div className="mt-4 space-y-3">
                {restOfToday.map((task) => (
                  <TaskRow key={task.id} task={task} activeSession={activeSessionByTaskId.get(task.id) ?? null} />
                ))}
              </div>
            </div>
          )}

          {completedToday.length > 0 && (
            <div className="mt-8">
              <h2 className="text-lg font-semibold text-slate-900">Done today</h2>
              <div className="mt-4 space-y-3">
                {completedToday.map((task) => (
                  <TaskRow key={task.id} task={task} activeSession={null} />
                ))}
              </div>
            </div>
          )}
        </>
      )}

      <EveningCheckinForm existingCheckin={todayCheckin ?? null} existingReflection={todayJournalEntry ?? null} />
      <RecentReflections entries={recentJournalEntries ?? []} checkinsByDate={checkinsByDate} />
    </section>
  );
}
