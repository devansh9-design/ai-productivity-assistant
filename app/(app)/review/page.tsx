import { cookies } from "next/headers";
import { requireUser } from "@/lib/auth/require-user";
import { formatDay } from "@/lib/analytics/format";
import { loadOpenTasks, loadSavedReview, loadWeekFacts, loadWeeklyPlan } from "@/lib/review/load";
import { suggestWeeklyPlan } from "@/lib/review/suggestions";
import { planningWeekFor, resolveReviewWeek, reviewableWeeks, weekEnd } from "@/lib/review/week";
import { DEFAULT_TIMEZONE, getTodayISODate, TIMEZONE_COOKIE_NAME } from "@/lib/tasks/timezone";
import { AnalyticsSection } from "@/components/analytics/section";
import { PlanForm } from "@/components/review/plan-form";
import { SummaryCard } from "@/components/review/summary-card";
import { WeekFactsView } from "@/components/review/week-facts";
import { WeekPicker } from "@/components/review/week-picker";
import { NextWeekTargets, type NextWeekGoal } from "@/components/review/next-week-targets";
import { loadTargetPlanning } from "@/lib/review/targets-load";
import { proposeTargets } from "@/lib/review/targets";
import { weekTargetLine } from "@/lib/week/view";
import { errorFields, log } from "@/lib/log";

function weekLabel(weekStart: string): string {
  return `${formatDay(weekStart)} to ${formatDay(weekEnd(weekStart))}`;
}

export default async function WeeklyReviewPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { supabase, user } = await requireUser();
  const timeZone = (await cookies()).get(TIMEZONE_COOKIE_NAME)?.value || DEFAULT_TIMEZONE;
  const today = getTodayISODate(timeZone);
  const reviewWeek = resolveReviewWeek((await searchParams).week, today);
  const planningWeek = planningWeekFor(today);

  let data;
  try {
    const [facts, saved, plan, openTasks, targetGoals] = await Promise.all([
      loadWeekFacts(supabase, user.id, reviewWeek, timeZone, today),
      loadSavedReview(supabase, reviewWeek),
      loadWeeklyPlan(supabase, planningWeek),
      loadOpenTasks(supabase, user.id),
      loadTargetPlanning(supabase, reviewWeek, planningWeek),
    ]);
    data = { facts, saved, plan, openTasks, targetGoals };
  } catch (error) {
    log("error", "review.load_failed", errorFields(error));
  }

  const header = (
    <>
      <p className="text-sm font-semibold uppercase tracking-wide text-indigo-600">Look back, then plan ahead</p>
      <h1 id="page-title" className="mt-2 text-3xl font-bold tracking-tight text-slate-900">Weekly review</h1>
      <p className="mt-2 max-w-2xl text-slate-600">Weeks run Monday to Sunday in your timezone ({timeZone}).</p>
    </>
  );

  if (!data) {
    return (
      <section aria-labelledby="page-title" className="mx-auto max-w-4xl">
        {header}
        <p role="alert" className="mt-6 rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-700">The weekly review could not be loaded right now. Please refresh to try again.</p>
      </section>
    );
  }

  const { facts, saved, plan, openTasks, targetGoals } = data;
  const reviewFinished = weekEnd(reviewWeek) < today;
  const nextWeekGoals: NextWeekGoal[] = targetGoals.map((goal) => ({
    goalId: goal.goalId,
    title: goal.title,
    lastWeek: goal.lastWeek.map((target) => weekTargetLine(target, reviewFinished)),
    metrics: goal.metrics.map((metric) => ({ id: metric.id, name: metric.name, unit: metric.unit })),
    existing: goal.existing,
    proposal: proposeTargets(goal, planningWeek),
  }));
  const suggestion = suggestWeeklyPlan(openTasks, new Set(facts.missedPlanned.map((task) => task.id)), planningWeek);
  const ranked = suggestion.ranked.map((task) => openTasks.find((open) => open.id === task.id)!);
  const openIds = new Set(openTasks.map((task) => task.id));
  // A saved plan pre-fills the form; tasks finished since then are left out.
  const savedPriorities = plan?.priorities.map((item) => item.taskId).filter((id) => openIds.has(id));
  const savedShortlist = plan?.shortlist.map((item) => item.taskId).filter((id) => openIds.has(id));
  const generatedLabel = saved
    ? `generated ${new Intl.DateTimeFormat("en-GB", { timeZone, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(saved.generatedAt))}`
    : null;

  return (
    <section aria-labelledby="page-title" className="mx-auto max-w-4xl">
      {header}
      <WeekPicker weeks={reviewableWeeks(today)} selected={reviewWeek} />

      <AnalyticsSection
        id="reviewed-week"
        title={`Reviewing ${weekLabel(reviewWeek)}`}
        explanation="Calculated from the records that still exist. Status changes are not stored as history and deleting a task removes it from plans, so earlier completions or slips of changed or deleted tasks may not appear."
      >
        <WeekFactsView facts={facts} />
      </AnalyticsSection>

      <AnalyticsSection
        id="summary"
        title="Summary"
        explanation="Generated only when you ask. The AI may only point to tasks completed this week and to the metrics above, and may not state numbers; anything else is rejected and a summary is written from your numbers instead."
      >
        <SummaryCard week={reviewWeek} saved={saved} facts={facts} generatedLabel={generatedLabel} />
      </AnalyticsSection>

      <AnalyticsSection
        id="next-week-targets"
        title={`Targets for ${weekLabel(planningWeek)}`}
        explanation={`Goal by goal: how ${weekLabel(reviewWeek)} went, and a proposal for the week ahead. A met target stays (or grows a little if beaten comfortably); a missed one eases towards what you managed. Tick the goals to save; goals already set for that week are left alone unless ticked.`}
      >
        <NextWeekTargets planningWeek={planningWeek} reviewWeek={reviewWeek} goals={nextWeekGoals} />
      </AnalyticsSection>

      <AnalyticsSection
        id="planning-week"
        title={`Planning ${weekLabel(planningWeek)}`}
        explanation={`Priorities are saved for ${weekLabel(planningWeek)}, whichever week you are reviewing above. Suggestions put work that slipped or is overdue first, then rank the rest the same way daily plans do.${plan ? " Your saved choices are filled in below." : ""}`}
      >
        <PlanForm
          planningWeek={planningWeek}
          reviewWeek={reviewWeek}
          ranked={ranked}
          priorities={savedPriorities ?? suggestion.priorities}
          shortlist={savedShortlist ?? suggestion.shortlist}
        />
      </AnalyticsSection>
    </section>
  );
}
