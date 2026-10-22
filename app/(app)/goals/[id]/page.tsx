import Link from "next/link";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { ArrowLeft, Pencil } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { updateGoal } from "@/lib/goals/actions";
import { loadGoalDetail } from "@/lib/goals/load";
import { daysBetween } from "@/lib/goals/roadmap";
import { DEFAULT_TIMEZONE, getTodayISODate, TIMEZONE_COOKIE_NAME } from "@/lib/tasks/timezone";
import { ActionForm } from "@/components/action-form";
import { ActionSubmitButton } from "@/components/action-submit-button";
import { CategoryBadge, GoalFields } from "@/components/goals/goal-fields";
import { DeleteGoalButton } from "@/components/goals/delete-goal-button";
import { AIRoadmapBuilder } from "@/components/goals/ai-roadmap-builder";
import { MetricsSection, RoadmapSection, RoutinesSection, TargetsSection } from "@/components/goals/sections";
import { StatusBadge } from "@/components/status-badge";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function longDate(value: string) {
  return new Date(`${value}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

export default async function GoalPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const supabase = await createClient();
  const detail = await loadGoalDetail(supabase, id);
  if (!detail) notFound();
  const { goal, metrics, phases, targets, routines, progress } = detail;
  const today = getTodayISODate((await cookies()).get(TIMEZONE_COOKIE_NAME)?.value || DEFAULT_TIMEZONE);
  const daysLeft = goal.target_date ? daysBetween(today, goal.target_date) - 1 : null;

  return (
    <article aria-labelledby="page-title" className="mx-auto max-w-4xl">
      <Link href="/goals" className="inline-flex items-center gap-1 text-sm font-medium text-indigo-600 hover:underline">
        <ArrowLeft aria-hidden="true" className="h-4 w-4" />All goals
      </Link>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <CategoryBadge category={goal.category} />
        {goal.status !== "active" && <StatusBadge status={goal.status} />}
        {goal.level && <span className="text-xs font-medium capitalize text-slate-500">{goal.level}</span>}
      </div>
      <h1 id="page-title" className="mt-2 text-3xl font-bold tracking-tight text-slate-900">{goal.title}</h1>
      <p className="mt-2 text-slate-600">
        {goal.target_date
          ? <>{goal.start_date ? `${longDate(goal.start_date)} → ` : "By "}{longDate(goal.target_date)}{daysLeft !== null && goal.status === "active" && ` · ${daysLeft < 0 ? `${-daysLeft} days past the target` : `${daysLeft} days left`}`}</>
          : "No target date yet. Add one to plan the roadmap."}
        {goal.weekly_hours && ` · ${goal.weekly_hours} h a week`}
      </p>
      {goal.description && <p className="mt-2 max-w-2xl text-sm text-slate-600">{goal.description}</p>}

      <details className="group mt-4">
        <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 text-sm font-semibold text-indigo-600 hover:underline">
          <Pencil aria-hidden="true" className="h-3.5 w-3.5" />Edit goal details
        </summary>
        <div className="mt-3 card p-5">
          <ActionForm action={updateGoal} resetOnSuccess={false}>
            <input type="hidden" name="id" value={goal.id} />
            <GoalFields goal={goal} idPrefix="edit-goal" />
            <ActionSubmitButton pendingLabel="Saving…" className="mt-4 btn-primary">Save goal</ActionSubmitButton>
          </ActionForm>
          <div className="mt-6 border-t border-slate-200 pt-4">
            <p className="text-sm text-slate-600">Deleting removes this goal with its metrics, logged values, roadmap, targets and routines. Tasks already created are kept.</p>
            <DeleteGoalButton goalId={goal.id} title={goal.title} />
          </div>
        </div>
      </details>

      <div className="mt-8 space-y-6">
        {goal.status === "active" && (
          <AIRoadmapBuilder
            goal={{ id: goal.id, title: goal.title, start_date: goal.start_date, target_date: goal.target_date, weekly_hours: goal.weekly_hours, level: goal.level }}
            existingMetrics={metrics.map((metric) => metric.name)}
            hasRoadmap={phases.length > 0 || targets.length > 0 || routines.length > 0}
            today={today}
          />
        )}
        <MetricsSection goal={goal} metrics={metrics} progress={progress} />
        <RoadmapSection goal={goal} phases={phases} today={today} />
        <TargetsSection goal={goal} targets={targets} metrics={metrics} today={today} />
        <RoutinesSection goal={goal} routines={routines} metrics={metrics} />
      </div>
    </article>
  );
}
