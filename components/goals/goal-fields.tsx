import { GOAL_CATEGORIES } from "@/lib/onboarding/wizard";
import type { Goal, GoalCategory } from "@/lib/types";

export const CATEGORY_LABEL: Record<GoalCategory, string> = Object.fromEntries(
  GOAL_CATEGORIES.map((category) => [category.value, category.label]),
) as Record<GoalCategory, string>;

export const CATEGORY_STYLE: Record<GoalCategory, string> = {
  fitness: "bg-emerald-50 text-emerald-700",
  placement: "bg-indigo-50 text-indigo-700",
  academics: "bg-amber-50 text-amber-800",
  skill: "bg-sky-50 text-sky-800",
  other: "bg-slate-100 text-slate-700",
};

export function CategoryBadge({ category }: { category: GoalCategory }) {
  return <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${CATEGORY_STYLE[category]}`}>{CATEGORY_LABEL[category]}</span>;
}

/** The goal's own fields, shared by the "New goal" and "Edit goal" forms. */
export function GoalFields({ goal, idPrefix }: { goal?: Goal; idPrefix: string }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <label className="block text-sm font-medium text-slate-800 sm:col-span-2" htmlFor={`${idPrefix}-title`}>Goal
        <input className="input mt-1" id={`${idPrefix}-title`} name="title" required maxLength={200} defaultValue={goal?.title} placeholder="e.g. Put on 5 kg of muscle" />
      </label>
      <label className="block text-sm font-medium text-slate-800">Type
        <select className="input mt-1" name="category" defaultValue={goal?.category ?? "other"}>
          {GOAL_CATEGORIES.map((category) => <option key={category.value} value={category.value}>{category.label}</option>)}
        </select>
      </label>
      <label className="block text-sm font-medium text-slate-800">Your level
        <select className="input mt-1" name="level" defaultValue={goal?.level ?? ""}>
          <option value="">Not set</option><option value="beginner">Beginner</option><option value="intermediate">Intermediate</option><option value="advanced">Advanced</option>
        </select>
      </label>
      <label className="block text-sm font-medium text-slate-800">Start date
        <input type="date" className="input mt-1" name="start_date" defaultValue={goal?.start_date ?? ""} />
      </label>
      <label className="block text-sm font-medium text-slate-800">Target date
        <input type="date" className="input mt-1" name="target_date" defaultValue={goal?.target_date ?? ""} />
      </label>
      <label className="block text-sm font-medium text-slate-800">Hours per week
        <input type="number" inputMode="decimal" min={0.5} max={112} step={0.5} className="input mt-1" name="weekly_hours" defaultValue={goal?.weekly_hours ?? ""} />
        <span className="mt-1 block text-xs font-normal text-slate-500">Routines for this goal must fit in this time.</span>
      </label>
      {goal && (
        <label className="block text-sm font-medium text-slate-800">Status
          <select className="input mt-1" name="status" defaultValue={goal.status}>
            <option value="active">Active</option><option value="completed">Completed</option><option value="archived">Archived</option>
          </select>
        </label>
      )}
      <label className="block text-sm font-medium text-slate-800 sm:col-span-2">Notes
        <textarea className="input mt-1" name="description" rows={2} maxLength={2000} defaultValue={goal?.description ?? ""} placeholder="Why it matters, where you're starting from…" />
      </label>
    </div>
  );
}
