import { createTask } from "@/lib/tasks/actions";
import { ActionForm } from "@/components/action-form";
import { ActionSubmitButton } from "@/components/action-submit-button";

/**
 * Today's "Add a task" form: title, goal, time estimate, priority, must do and
 * due date only. The due date starts at today, so a new task shows up straight away.
 */
export function NewTaskForm({ goals, today }: { goals: Array<{ id: string; title: string }>; today: string }) {
  return (
    <details id="add-task" className="mt-6 card p-5">
      <summary className="cursor-pointer text-lg font-semibold text-slate-900">Add a task</summary>
      <ActionForm action={createTask} className="mt-4 grid gap-4 sm:grid-cols-2">
        <label className="block text-sm font-medium text-slate-800 sm:col-span-2" htmlFor="new-task-title">
          Title
          <input id="new-task-title" name="title" required maxLength={200} className="input mt-1" placeholder="e.g. Submit the lab report" />
        </label>

        <label className="block text-sm font-medium text-slate-800" htmlFor="new-task-goal">
          Goal
          <select id="new-task-goal" name="goal_id" defaultValue="" className="input mt-1">
            <option value="">No goal</option>
            {goals.map((goal) => <option key={goal.id} value={goal.id}>{goal.title}</option>)}
          </select>
        </label>

        <label className="block text-sm font-medium text-slate-800" htmlFor="new-task-estimate">
          Time estimate (minutes)
          <input id="new-task-estimate" name="estimated_minutes" type="number" min={1} max={1440} step={1} inputMode="numeric" className="input mt-1" placeholder="e.g. 45" />
        </label>

        <label className="block text-sm font-medium text-slate-800" htmlFor="new-task-priority">
          Priority
          <select id="new-task-priority" name="priority" defaultValue="medium" className="input mt-1">
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="urgent">Urgent</option>
          </select>
        </label>

        <label className="block text-sm font-medium text-slate-800" htmlFor="new-task-due">
          Due date
          <input id="new-task-due" name="due_date" type="date" defaultValue={today} className="input mt-1" />
        </label>

        <label className="flex items-center gap-2 text-sm font-medium text-slate-800 sm:col-span-2" htmlFor="new-task-must-do">
          <input id="new-task-must-do" name="must_do" type="checkbox" className="h-4 w-4" />
          Must do
          <span className="font-normal text-slate-500">(planned before anything else, up to three a day)</span>
        </label>

        <div className="sm:col-span-2">
          <ActionSubmitButton pendingLabel="Adding…" className="btn-primary w-full sm:w-auto">Add task</ActionSubmitButton>
        </div>
      </ActionForm>
    </details>
  );
}
