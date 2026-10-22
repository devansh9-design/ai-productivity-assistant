import Link from "next/link";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { StatusBadge, PriorityBadge, EmptyState, RoutineBadge } from "@/components/status-badge";
import { TaskActionForm } from "@/components/task-action-form";
import { TaskTimer } from "@/components/task-timer";
import { EveningLogForm } from "@/components/evening-log-form";
import { DailyFeedbackCard, type FeedbackCardData } from "@/components/daily-feedback-card";
import { loadDayFacts, loadFeedbackState } from "@/lib/feedback/load";
import { dayLine, describeCandidate, sessionsLine, targetLine } from "@/lib/feedback/daily";
import { loadEveningLog, type EveningLogData } from "@/lib/evening/load";
import { MorningCheckinForm, morningSummary } from "@/components/morning-checkin-form";
import { RecentReflections } from "@/components/recent-reflections";
import { ActionForm } from "@/components/action-form";
import { ActionSubmitButton } from "@/components/action-submit-button";
import { TIMEZONE_COOKIE_NAME } from "@/lib/tasks/timezone";
import { getCompletedToday, getTodayTasks, getTopPriorities } from "@/lib/tasks/filters";
import { DEFAULT_TIMEZONE, getTodayISODate } from "@/lib/tasks/timezone";
import { generateDraftPlan } from "@/lib/plans/actions";
import { PlanTimeline } from "@/components/plan-timeline";
import { PlanHistory } from "@/components/plan-history";
import { ReplanPanel } from "@/components/replan-panel";
import { InsightsCard } from "@/components/insights-card";
import { loadPersonalization } from "@/lib/preferences/load";
import { loadWeeklyPlan, type SavedWeeklyPlan } from "@/lib/review/load";
import { mondayOf } from "@/lib/review/week";
import { WeekPrioritiesCard } from "@/components/review/week-priorities-card";
import type { Checkin, DailyPlan, FixedCommitment, JournalEntry, PlanBlock, PlanUnscheduledTask, Task, TaskSession } from "@/lib/types";
import { errorFields, log } from "@/lib/log";
import { materializeRoutineTasks } from "@/lib/routines/materialize";

const RECENT_REFLECTIONS_LIMIT = 7;

function TaskRow({ task, activeSession }: { task: Task; activeSession: TaskSession | null }) {
  return (
    <article className="card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold text-slate-900">{task.title}</h3>
            <StatusBadge status={task.status} />
            <PriorityBadge priority={task.priority} />
            {task.routine_id && <RoutineBadge />}
            {task.due_date && <span className="text-xs font-medium text-slate-500">Due {task.due_date}</span>}
          </div>
          {task.description && <p className="mt-1 text-sm text-slate-600">{task.description}</p>}
          <p className="mt-1 text-xs text-slate-500">
            {task.estimated_minutes ? `${task.estimated_minutes} min estimated` : "No estimate"}
            {task.actual_minutes ? ` · ${task.actual_minutes} min actual` : ""}
            {task.energy_level ? ` · ${task.energy_level} energy` : " · energy not set"}
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
  // Today's routine sessions become tasks before the page reads them.
  await materializeRoutineTasks(supabase, todayISODate);
  const [
    { data: tasks, error: tasksError },
    { data: activeSessions },
    { data: recentJournalEntries },
    { data: recentCheckins },
    { data: allPlans },
    { data: fixedCommitments },
    { data: calendarSwitches },
    { data: morningCheckin },
  ] = await Promise.all([
    supabase.from("tasks").select("*").order("due_date", { ascending: true }).returns<Task[]>(),
    supabase.from("task_sessions").select("*").is("ended_at", null).returns<TaskSession[]>(),
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
    // Display only; the plan actions re-read the switches before any Google call.
    supabase.from("integration_status").select("planning_enabled,publishing_enabled").eq("provider", "google_calendar").maybeSingle<{ planning_enabled: boolean; publishing_enabled: boolean }>(),
    supabase.from("checkins").select("*").eq("checkin_date", todayISODate).eq("type", "morning").maybeSingle<Checkin>(),
  ]);

  const personalization = await loadPersonalization(supabase, timeZone);
  let weekPlan: SavedWeeklyPlan | null = null;
  try {
    weekPlan = await loadWeeklyPlan(supabase, mondayOf(todayISODate));
  } catch (error) {
    log("error", "today.week_priorities_failed", errorFields(error));
  }
  let eveningLog: EveningLogData | null = null;
  try {
    eveningLog = await loadEveningLog(supabase, todayISODate, timeZone);
  } catch (error) {
    log("error", "today.evening_log_failed", errorFields(error));
  }
  // Numbers are worked out here from live data on every load; the stored note never carries them.
  let feedbackCard: FeedbackCardData | null = null;
  try {
    const [facts, state] = await Promise.all([loadDayFacts(supabase, todayISODate), loadFeedbackState(supabase, todayISODate)]);
    const today = dayLine(facts);
    feedbackCard = {
      source: state.feedback?.source ?? null,
      summary: state.feedback?.summary ?? null,
      numbers: [
        ...(today ? [{ heading: null, lines: [today] }] : []),
        ...facts.goals.map((goal) => ({
          heading: goal.title,
          lines: [...goal.targets.map(targetLine), ...(goal.sessions ? [sessionsLine(goal.sessions)] : [])],
        })),
      ],
      suggestions: (state.feedback?.suggestions ?? []).map((item) => ({
        id: item.id, description: describeCandidate(item, facts.tomorrow), reason: item.reason, status: item.status,
      })),
      needsFeedback: state.needsFeedback,
    };
  } catch (error) {
    log("error", "today.feedback_failed", errorFields(error));
  }
  const calendarPauseNote = [
    calendarSwitches?.planning_enabled === false && "Calendar planning is paused: plans do not include your Google Calendar events.",
    calendarSwitches?.publishing_enabled === false && "Publishing is paused: confirmed plans are not added to Google Calendar.",
  ].filter(Boolean).join(" ");
  const plans = allPlans ?? [];
  const activePlan = plans.find((p) => ["draft", "publishing", "publication_failed", "confirmed"].includes(p.status)) ?? null;
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

      <MorningCheckinForm existingCheckin={morningCheckin ?? null} hasPlan={activePlan !== null} />

      <div className="mt-6 card p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div><h2 className="text-lg font-semibold text-slate-900">Daily schedule</h2><p className="mt-1 text-sm text-slate-600">{activePlan ? `Plan v${activePlan.version} with ${activePlan.buffer_minutes} minutes of protected buffer.` : morningCheckin ? "Generate a plan from your check-in, routines, weekly targets and deadlines." : "Start with the morning check-in above, and your plan is built from it."}</p>
            {morningCheckin && <p className="mt-1 text-sm text-slate-600">Today&apos;s check-in: {morningSummary(morningCheckin)}.</p>}
            {calendarPauseNote && <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">{calendarPauseNote} <Link href="/settings" className="font-semibold underline">Change in Settings</Link></p>}</div>
          {(morningCheckin || activePlan) && <ActionForm action={generateDraftPlan} resetOnSuccess={false}><ActionSubmitButton pendingLabel="Generating..." className="btn-primary">{activePlan ? "Regenerate plan" : "Generate plan"}</ActionSubmitButton></ActionForm>}
        </div>
      </div>

      <WeekPrioritiesCard priorities={weekPlan?.priorities ?? []} />

      {activePlan && (
        <PlanTimeline
          plan={activePlan}
          blocks={blocksByPlan.get(activePlan.id) ?? []}
          unscheduledTasks={unscheduledByPlan.get(activePlan.id) ?? []}
          allTasks={allTasks}
          fixedCommitments={fixedCommitments ?? []}
        />
      )}

      {activePlan && (activePlan.status === "draft" || activePlan.status === "confirmed") && (
        <ReplanPanel lowEnergyMaxBlockMinutes={personalization.preferences.lowEnergyMaxBlockMinutes} />
      )}

      <InsightsCard insights={personalization.insights} durationFactor={personalization.durationFactor} />

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
              className="btn-primary"
            >
              Go to Tasks
            </Link>
          </div>
        </div>
      )}

      {!tasksError && totalToday > 0 && (
        <>
          <div className="mt-6 card p-5">
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

      {eveningLog ? (
        <EveningLogForm data={eveningLog} />
      ) : (
        <p role="alert" className="mt-8 rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-700">
          The evening log could not be loaded. Refresh the page to try again.
        </p>
      )}
      {feedbackCard && <DailyFeedbackCard data={feedbackCard} />}
      <RecentReflections entries={recentJournalEntries ?? []} checkinsByDate={checkinsByDate} />
    </section>
  );
}
