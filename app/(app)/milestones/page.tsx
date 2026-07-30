import { createClient } from "@/lib/supabase/server";
import { createMilestone, deleteMilestone, updateMilestoneStatus } from "@/lib/milestones/actions";
import { StatusBadge, EmptyState } from "@/components/status-badge";
import { StatusSelectForm } from "@/components/status-select-form";
import type { Milestone, Project } from "@/lib/types";

const MILESTONE_STATUSES = ["active", "completed", "archived"] as const;

export default async function MilestonesPage() {
  const supabase = await createClient();
  const [{ data: milestones, error }, { data: projects }] = await Promise.all([
    supabase.from("milestones").select("*").order("due_date", { ascending: true }).returns<Milestone[]>(),
    supabase.from("projects").select("*").order("title", { ascending: true }).returns<Project[]>(),
  ]);

  const projectTitleById = new Map((projects ?? []).map((project) => [project.id, project.title]));

  return (
    <section aria-labelledby="page-title" className="mx-auto max-w-4xl">
      <p className="text-sm font-semibold uppercase tracking-wide text-indigo-600">Personal workspace</p>
      <h1 id="page-title" className="mt-2 text-3xl font-bold tracking-tight text-slate-900">
        Milestones
      </h1>
      <p className="mt-2 max-w-lg text-slate-600">
        Milestones mark meaningful checkpoints inside a project, each with its own due date.
      </p>

      <form action={createMilestone} className="mt-8 rounded-2xl border border-slate-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-slate-900">New milestone</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="block text-sm font-medium text-slate-800 sm:col-span-2" htmlFor="milestone-title">
            Title
            <input
              className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900"
              id="milestone-title"
              name="title"
              required
              maxLength={200}
            />
          </label>
          <label className="block text-sm font-medium text-slate-800" htmlFor="milestone-project">
            Project
            <select
              className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900"
              id="milestone-project"
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
          <label className="block text-sm font-medium text-slate-800" htmlFor="milestone-due-date">
            Due date
            <input
              className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900"
              id="milestone-due-date"
              name="due_date"
              type="date"
            />
          </label>
          <label className="block text-sm font-medium text-slate-800 sm:col-span-2" htmlFor="milestone-description">
            Description
            <textarea
              className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900"
              id="milestone-description"
              name="description"
              rows={2}
            />
          </label>
        </div>
        <button
          type="submit"
          className="mt-4 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
        >
          Add milestone
        </button>
      </form>

      <div className="mt-8 space-y-3">
        {error && (
          <p role="alert" className="rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-700">
            Could not load milestones: {error.message}
          </p>
        )}

        {!error && milestones && milestones.length === 0 && (
          <EmptyState
            title="No milestones yet"
            description="Add a milestone above and optionally link it to one of your projects."
          />
        )}

        {milestones?.map((milestone) => (
          <article key={milestone.id} className="rounded-2xl border border-slate-200 bg-white p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-base font-semibold text-slate-900">{milestone.title}</h3>
                  <StatusBadge status={milestone.status} />
                  {milestone.due_date && (
                    <span className="text-xs font-medium text-slate-500">Due {milestone.due_date}</span>
                  )}
                  {milestone.project_id && (
                    <span className="text-xs font-medium text-slate-500">
                      {projectTitleById.get(milestone.project_id) ?? "Linked project"}
                    </span>
                  )}
                </div>
                {milestone.description && <p className="mt-1 text-sm text-slate-600">{milestone.description}</p>}
              </div>
              <div className="flex items-center gap-2">
                <StatusSelectForm
                  action={updateMilestoneStatus}
                  id={milestone.id}
                  label={`Update status for ${milestone.title}`}
                  defaultValue={milestone.status}
                  options={MILESTONE_STATUSES}
                />
                <form action={deleteMilestone}>
                  <input type="hidden" name="id" value={milestone.id} />
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
