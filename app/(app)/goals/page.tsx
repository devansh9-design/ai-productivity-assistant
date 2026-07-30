import { createClient } from "@/lib/supabase/server";
import { createGoal, deleteGoal, updateGoalStatus } from "@/lib/goals/actions";
import { StatusBadge, EmptyState } from "@/components/status-badge";
import { StatusSelectForm } from "@/components/status-select-form";
import { SubmitButton } from "@/components/submit-button";
import type { Goal } from "@/lib/types";

const GOAL_STATUSES = ["active", "completed", "archived"] as const;

export default async function GoalsPage() {
  const supabase = await createClient();
  const { data: goals, error } = await supabase
    .from("goals")
    .select("*")
    .order("created_at", { ascending: true })
    .returns<Goal[]>();

  return (
    <section aria-labelledby="page-title" className="mx-auto max-w-4xl">
      <p className="text-sm font-semibold uppercase tracking-wide text-indigo-600">Personal workspace</p>
      <h1 id="page-title" className="mt-2 text-3xl font-bold tracking-tight text-slate-900">
        Goals
      </h1>
      <p className="mt-2 max-w-lg text-slate-600">
        Goals are the top of the hierarchy. Projects, milestones, and tasks all roll up to one.
      </p>

      <form action={createGoal} className="mt-8 rounded-2xl border border-slate-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-slate-900">New goal</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="block text-sm font-medium text-slate-800 sm:col-span-2" htmlFor="goal-title">
            Title
            <input
              className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900"
              id="goal-title"
              name="title"
              required
              maxLength={200}
            />
          </label>
          <label className="block text-sm font-medium text-slate-800 sm:col-span-2" htmlFor="goal-description">
            Description
            <textarea
              className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900"
              id="goal-description"
              name="description"
              rows={2}
            />
          </label>
        </div>
        <SubmitButton
          pendingLabel="Adding…"
          className="mt-4 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
        >
          Add goal
        </SubmitButton>
      </form>

      <div className="mt-8 space-y-3">
        {error && (
          <p role="alert" className="rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-700">
            Could not load goals: {error.message}
          </p>
        )}

        {!error && goals && goals.length === 0 && (
          <EmptyState
            title="No goals yet"
            description="Add your first goal above. Projects and tasks can then link to it."
          />
        )}

        {goals?.map((goal) => (
          <article key={goal.id} className="rounded-2xl border border-slate-200 bg-white p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-base font-semibold text-slate-900">{goal.title}</h3>
                  <StatusBadge status={goal.status} />
                </div>
                {goal.description && <p className="mt-1 text-sm text-slate-600">{goal.description}</p>}
              </div>
              <div className="flex items-center gap-2">
                <StatusSelectForm
                  action={updateGoalStatus}
                  id={goal.id}
                  label={`Update status for ${goal.title}`}
                  defaultValue={goal.status}
                  options={GOAL_STATUSES}
                />
                <form action={deleteGoal}>
                  <input type="hidden" name="id" value={goal.id} />
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
