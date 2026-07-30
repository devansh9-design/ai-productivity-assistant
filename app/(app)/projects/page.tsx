import { createClient } from "@/lib/supabase/server";
import { createProject, deleteProject, updateProjectStatus } from "@/lib/projects/actions";
import { StatusBadge, EmptyState } from "@/components/status-badge";
import { StatusSelectForm } from "@/components/status-select-form";
import { SubmitButton } from "@/components/submit-button";
import type { Goal, Project } from "@/lib/types";

const PROJECT_STATUSES = ["active", "completed", "archived"] as const;

export default async function ProjectsPage() {
  const supabase = await createClient();
  const [{ data: projects, error }, { data: goals }] = await Promise.all([
    supabase.from("projects").select("*").order("created_at", { ascending: true }).returns<Project[]>(),
    supabase.from("goals").select("*").order("title", { ascending: true }).returns<Goal[]>(),
  ]);

  const goalTitleById = new Map((goals ?? []).map((goal) => [goal.id, goal.title]));

  return (
    <section aria-labelledby="page-title" className="mx-auto max-w-4xl">
      <p className="text-sm font-semibold uppercase tracking-wide text-indigo-600">Personal workspace</p>
      <h1 id="page-title" className="mt-2 text-3xl font-bold tracking-tight text-slate-900">
        Projects
      </h1>
      <p className="mt-2 max-w-lg text-slate-600">
        Projects sit under a goal and group the milestones and tasks that move it forward.
      </p>

      <form action={createProject} className="mt-8 rounded-2xl border border-slate-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-slate-900">New project</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="block text-sm font-medium text-slate-800 sm:col-span-2" htmlFor="project-title">
            Title
            <input
              className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900"
              id="project-title"
              name="title"
              required
              maxLength={200}
            />
          </label>
          <label className="block text-sm font-medium text-slate-800" htmlFor="project-goal">
            Goal
            <select
              className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900"
              id="project-goal"
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
          <label className="block text-sm font-medium text-slate-800 sm:col-span-2" htmlFor="project-description">
            Description
            <textarea
              className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900"
              id="project-description"
              name="description"
              rows={2}
            />
          </label>
        </div>
        <SubmitButton
          pendingLabel="Adding…"
          className="mt-4 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
        >
          Add project
        </SubmitButton>
      </form>

      <div className="mt-8 space-y-3">
        {error && (
          <p role="alert" className="rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-700">
            Could not load projects: {error.message}
          </p>
        )}

        {!error && projects && projects.length === 0 && (
          <EmptyState
            title="No projects yet"
            description="Add a project above and optionally link it to one of your goals."
          />
        )}

        {projects?.map((project) => (
          <article key={project.id} className="rounded-2xl border border-slate-200 bg-white p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-base font-semibold text-slate-900">{project.title}</h3>
                  <StatusBadge status={project.status} />
                  {project.goal_id && (
                    <span className="text-xs font-medium text-slate-500">
                      {goalTitleById.get(project.goal_id) ?? "Linked goal"}
                    </span>
                  )}
                </div>
                {project.description && <p className="mt-1 text-sm text-slate-600">{project.description}</p>}
              </div>
              <div className="flex items-center gap-2">
                <StatusSelectForm
                  action={updateProjectStatus}
                  id={project.id}
                  label={`Update status for ${project.title}`}
                  defaultValue={project.status}
                  options={PROJECT_STATUSES}
                />
                <form action={deleteProject}>
                  <input type="hidden" name="id" value={project.id} />
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
