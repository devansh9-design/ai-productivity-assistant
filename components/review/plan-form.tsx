import { ActionForm } from "@/components/action-form";
import { ActionSubmitButton } from "@/components/action-submit-button";
import { saveWeeklyPlan } from "@/lib/review/actions";
import type { OpenTask } from "@/lib/review/load";
import { MAX_PRIORITIES, MAX_SHORTLIST } from "@/lib/review/suggestions";

const FIELD = "mt-1 block w-full min-w-0 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900";
/** How many ranked open tasks to offer as shortlist checkboxes. */
const SHORTLIST_CHOICES = 12;

interface PlanFormProps {
  planningWeek: string;
  reviewWeek: string;
  /** Open tasks in suggestion order. */
  ranked: OpenTask[];
  /** Pre-filled choices: the saved plan if there is one, otherwise the suggestions. */
  priorities: string[];
  shortlist: string[];
}

export function PlanForm({ planningWeek, reviewWeek, ranked, priorities, shortlist }: PlanFormProps) {
  const checked = new Set(shortlist);
  const choices = [
    ...ranked.slice(0, SHORTLIST_CHOICES),
    ...ranked.slice(SHORTLIST_CHOICES).filter((task) => checked.has(task.id)),
  ];

  return (
    <ActionForm action={saveWeeklyPlan} resetOnSuccess={false} className="space-y-6">
      <input type="hidden" name="planning_week" value={planningWeek} />
      <input type="hidden" name="review_week" value={reviewWeek} />

      <fieldset>
        <legend className="text-sm font-semibold uppercase tracking-wide text-slate-500">Top {MAX_PRIORITIES} priorities</legend>
        <p className="mt-1 text-sm text-slate-600">Pick an open task or type a new one for each slot. Leave a slot empty to skip it.</p>
        <div className="mt-3 space-y-3">
          {Array.from({ length: MAX_PRIORITIES }, (_, index) => {
            const slot = index + 1;
            return (
              <div key={slot} className="grid gap-2 rounded-xl bg-slate-50 p-3 sm:grid-cols-2">
                <label className="min-w-0 text-sm font-medium text-slate-800">Priority {slot}
                  <select name={`priority_${slot}_task`} defaultValue={priorities[index] ?? ""} className={FIELD}>
                    <option value="">No task chosen</option>
                    {ranked.map((task) => <option key={task.id} value={task.id}>{task.title}</option>)}
                  </select>
                </label>
                <label className="min-w-0 text-sm font-medium text-slate-800">or a new task
                  <input name={`priority_${slot}_new`} maxLength={200} placeholder="New task title" className={FIELD} />
                </label>
              </div>
            );
          })}
        </div>
      </fieldset>

      <fieldset>
        <legend className="text-sm font-semibold uppercase tracking-wide text-slate-500">Shortlist (up to {MAX_SHORTLIST})</legend>
        <p className="mt-1 text-sm text-slate-600">Other work you would like to get to. It is saved as a list only; no day is filled in automatically.</p>
        {choices.length ? (
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {choices.map((task) => (
              <label key={task.id} className="flex min-w-0 items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-800">
                <input type="checkbox" name="shortlist" value={task.id} defaultChecked={checked.has(task.id)} className="h-4 w-4 shrink-0" />
                <span className="min-w-0 truncate">{task.title}</span>
              </label>
            ))}
          </div>
        ) : <p className="mt-2 text-sm text-slate-500">No other open tasks to choose from.</p>}
      </fieldset>

      <div>
        <ActionSubmitButton pendingLabel="Saving..." className="btn-primary">Save priorities and shortlist</ActionSubmitButton>
        <p className="mt-2 text-xs text-slate-500">Saving never creates or confirms a daily plan, and never changes Google Calendar.</p>
      </div>
    </ActionForm>
  );
}
