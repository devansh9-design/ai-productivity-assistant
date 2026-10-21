import Link from "next/link";
import { cookies } from "next/headers";
import { CalendarRange, ChevronRight, Clock, Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { createGoal } from "@/lib/goals/actions";
import { daysBetween } from "@/lib/goals/roadmap";
import { loadGoalSummaries, type GoalSummary } from "@/lib/goals/load";
import { DEFAULT_TIMEZONE, getTodayISODate, TIMEZONE_COOKIE_NAME } from "@/lib/tasks/timezone";
import { ActionForm } from "@/components/action-form";
import { ActionSubmitButton } from "@/components/action-submit-button";
import { CategoryBadge, GoalFields } from "@/components/goals/goal-fields";
import { EmptyState, StatusBadge } from "@/components/status-badge";

function dateLabel(value: string) {
  return new Date(`${value}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

function GoalCard({ goal, today }: { goal: GoalSummary; today: string }) {
  const daysLeft = goal.target_date ? daysBetween(today, goal.target_date) - 1 : null;
  const missing = [!goal.target_date && "a target date", !goal.metricCount && "a metric", !goal.phaseCount && "a roadmap", !goal.routineCount && "a routine"].filter(Boolean);
  return (
    <Link href={`/goals/${goal.id}`} className="group block card p-5 transition-colors hover:border-indigo-300">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold text-slate-900">{goal.title}</h2>
            <CategoryBadge category={goal.category} />
            {goal.status !== "active" && <StatusBadge status={goal.status} />}
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-600">
            {goal.target_date && (
              <span className="inline-flex items-center gap-1.5">
                <CalendarRange aria-hidden="true" className="h-4 w-4 text-slate-400" />
                {goal.start_date ? `${dateLabel(goal.start_date)} → ` : "By "}{dateLabel(goal.target_date)}
                {daysLeft !== null && goal.status === "active" && (
                  <span className={daysLeft < 0 ? "font-medium text-rose-600" : "text-slate-500"}>
                    · {daysLeft < 0 ? `${-daysLeft} days over` : daysLeft === 0 ? "due today" : `${daysLeft} days left`}
                  </span>
                )}
              </span>
            )}
            {goal.weekly_hours && <span className="inline-flex items-center gap-1.5"><Clock aria-hidden="true" className="h-4 w-4 text-slate-400" />{goal.weekly_hours} h / week</span>}
          </div>
          <p className="mt-2 text-xs text-slate-500">
            {goal.phaseCount} phases · {goal.metricCount} metrics · {goal.routineCount} active routines
            {missing.length > 0 && goal.status === "active" && <span className="text-amber-700"> · Add {missing.join(", ")}</span>}
          </p>
        </div>
        <ChevronRight aria-hidden="true" className="mt-1 h-5 w-5 shrink-0 text-slate-400 transition-transform group-hover:translate-x-0.5" />
      </div>
    </Link>
  );
}

export default async function GoalsPage() {
  const supabase = await createClient();
  const today = getTodayISODate((await cookies()).get(TIMEZONE_COOKIE_NAME)?.value || DEFAULT_TIMEZONE);
  let goals: GoalSummary[] = [];
  let loadError: string | null = null;
  try {
    goals = await loadGoalSummaries(supabase);
  } catch (error) {
    loadError = error instanceof Error ? error.message : "Could not load goals.";
  }
  const active = goals.filter((goal) => goal.status === "active");
  const others = goals.filter((goal) => goal.status !== "active");

  return (
    <section aria-labelledby="page-title" className="mx-auto max-w-4xl">
      <p className="text-sm font-semibold uppercase tracking-wide text-indigo-600">Long-term</p>
      <h1 id="page-title" className="mt-2 text-3xl font-bold tracking-tight text-slate-900">Goals</h1>
      <p className="mt-2 max-w-2xl text-slate-600">
        What you&apos;re working towards, with a deadline. Open a goal to build its roadmap: the numbers you&apos;ll track, phases, weekly targets and routines.
      </p>

      <details className="group mt-8 card">
        <summary className="flex cursor-pointer list-none items-center gap-2 p-5 text-base font-semibold text-slate-900">
          <Plus aria-hidden="true" className="h-5 w-5 text-indigo-600 transition-transform group-open:rotate-45" />New goal
        </summary>
        <ActionForm action={createGoal} className="border-t border-slate-200 p-5">
          <GoalFields idPrefix="new-goal" />
          <ActionSubmitButton pendingLabel="Adding…" className="mt-4 btn-primary">Add goal</ActionSubmitButton>
        </ActionForm>
      </details>

      {loadError && <p role="alert" className="mt-6 rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-700">{loadError}</p>}
      {!loadError && goals.length === 0 && (
        <div className="mt-6"><EmptyState title="No goals yet" description="Add your first goal above, for example getting fit or preparing for placements." /></div>
      )}

      {active.length > 0 && <div className="mt-6 space-y-3">{active.map((goal) => <GoalCard key={goal.id} goal={goal} today={today} />)}</div>}
      {others.length > 0 && (
        <>
          <h2 className="mt-10 text-sm font-semibold uppercase tracking-wide text-slate-500">Completed and archived</h2>
          <div className="mt-3 space-y-3">{others.map((goal) => <GoalCard key={goal.id} goal={goal} today={today} />)}</div>
        </>
      )}
    </section>
  );
}
