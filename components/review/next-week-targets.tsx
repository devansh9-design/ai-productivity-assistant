"use client";

import { useState, useTransition } from "react";
import { Plus, Sparkles, Trash2 } from "lucide-react";
import { proposeNextWeekTargets, saveNextWeekTargets } from "@/lib/review/actions";
import { ActionForm } from "@/components/action-form";
import { ActionSubmitButton } from "@/components/action-submit-button";
import { TARGET_LIMITS, type TargetRow } from "@/lib/review/targets";

export interface NextWeekGoal {
  goalId: string;
  title: string;
  lastWeek: Array<{ text: string; tone: "good" | "bad" | "neutral" }>;
  metrics: Array<{ id: string; name: string; unit: string | null }>;
  existing: TargetRow[];
  proposal: TargetRow[];
}

interface EditableRow { title: string; metricId: string; value: string }
interface GoalState { include: boolean; rows: EditableRow[]; reason: string | null }

function toEditable(rows: TargetRow[]): EditableRow[] {
  return rows.map((row) => ({ title: row.title, metricId: row.metricId ?? "", value: row.value === null ? "" : String(row.value) }));
}

/**
 * Next week's targets, goal by goal: last week's result beside an editable
 * proposal. Goals that already have targets for next week are shown as set
 * and only replaced if ticked. One Save writes every ticked goal.
 */
export function NextWeekTargets({ planningWeek, reviewWeek, goals }: { planningWeek: string; reviewWeek: string; goals: NextWeekGoal[] }) {
  const [state, setState] = useState<Record<string, GoalState>>(() => Object.fromEntries(goals.map((goal) => [goal.goalId, {
    include: goal.existing.length === 0 && goal.proposal.length > 0,
    rows: toEditable(goal.existing.length > 0 ? goal.existing : goal.proposal),
    reason: null,
  }])));
  const [aiMessage, setAiMessage] = useState<string | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [asking, startAsking] = useTransition();

  const update = (goalId: string, change: (current: GoalState) => GoalState) => setState((all) => ({ ...all, [goalId]: change(all[goalId]) }));
  const setRow = (goalId: string, index: number, patch: Partial<EditableRow>) =>
    update(goalId, (current) => ({ ...current, rows: current.rows.map((row, i) => (i === index ? { ...row, ...patch } : row)) }));

  function askAI() {
    setAiError(null);
    setAiMessage(null);
    startAsking(async () => {
      try {
        const result = await proposeNextWeekTargets(reviewWeek);
        if ("error" in result) { setAiError(result.error); return; }
        setState((all) => {
          const next = { ...all };
          for (const proposal of result.proposals) {
            if (!next[proposal.goalId]) continue;
            // Ticks stay as they were: a new proposal is only saved if the student ticks its goal.
            next[proposal.goalId] = { include: next[proposal.goalId].include && proposal.rows.length > 0, rows: toEditable(proposal.rows), reason: proposal.reason };
          }
          return next;
        });
        setAiMessage(result.message);
      } catch {
        setAiError("The proposals could not be loaded. Please try again.");
      }
    });
  }

  const payload = JSON.stringify(goals.filter((goal) => state[goal.goalId].include).map((goal) => ({
    goalId: goal.goalId,
    rows: state[goal.goalId].rows.map((row) => ({
      title: row.title,
      metricId: row.metricId || null,
      value: row.metricId ? (row.value.trim() === "" ? null : Number(row.value)) : null,
    })),
  })));

  // Goals with nothing last week, nothing proposed and nothing set are grouped at the end, so the ones that matter come first.
  const isQuiet = (goal: NextWeekGoal) => goal.lastWeek.length === 0 && goal.proposal.length === 0 && goal.existing.length === 0;
  const busy = goals.filter((goal) => !isQuiet(goal));
  const quiet = goals.filter(isQuiet);

  function renderGoal(goal: NextWeekGoal) {
    const goalState = state[goal.goalId];
    const checkboxId = `include-${goal.goalId}`;
    return (
      <fieldset key={goal.goalId} aria-labelledby={`${checkboxId}-label`} className="rounded-lg border border-slate-200 p-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <label id={`${checkboxId}-label`} htmlFor={checkboxId} className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <input id={checkboxId} type="checkbox" checked={goalState.include}
              onChange={(event) => update(goal.goalId, (current) => ({ ...current, include: event.target.checked }))} />
            {goal.title}
          </label>
          {goal.existing.length > 0 && <span className="text-xs font-medium text-slate-500">Already set for next week{goalState.include ? ": saving replaces it" : ""}</span>}
        </div>

        <div className="mt-2 grid gap-3 md:grid-cols-2">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Last week</p>
            {goal.lastWeek.length === 0 ? (
              <p className="mt-1 text-sm text-slate-500">No targets last week.</p>
            ) : (
              <ul className="mt-1 text-sm">
                {goal.lastWeek.map((line, index) => (
                  <li key={index} className={line.tone === "bad" ? "text-rose-700" : line.tone === "good" ? "text-emerald-700" : "text-slate-600"}>{line.text}</li>
                ))}
              </ul>
            )}
          </div>
          <div className={goalState.include ? "" : "opacity-60"}>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Next week</p>
            {goalState.reason && <p className="mt-1 text-sm text-slate-700">{goalState.reason}</p>}
            {goalState.rows.length === 0 && <p className="mt-1 text-sm text-slate-500">No proposal. Add a target, or leave this goal unticked.</p>}
            <ul className="mt-1 space-y-2">
              {goalState.rows.map((row, index) => (
                <li key={index} className="grid grid-cols-[1fr_auto] gap-2">
                  <input className="input" aria-label={`Target ${index + 1} for ${goal.title}`} value={row.title} maxLength={200} disabled={!goalState.include}
                    onChange={(event) => setRow(goal.goalId, index, { title: event.target.value })} placeholder="What this week should achieve" />
                  <button type="button" disabled={!goalState.include} aria-label={`Remove target ${index + 1} for ${goal.title}`}
                    onClick={() => update(goal.goalId, (current) => ({ ...current, rows: current.rows.filter((_, i) => i !== index) }))}
                    className="rounded-lg border border-slate-300 px-2 text-slate-600 hover:bg-slate-50 disabled:opacity-50">
                    <Trash2 aria-hidden="true" className="h-4 w-4" />
                  </button>
                  <div className="col-span-2 grid grid-cols-2 gap-2">
                    <select className="input" aria-label={`Metric for target ${index + 1} of ${goal.title}`} value={row.metricId} disabled={!goalState.include}
                      onChange={(event) => setRow(goal.goalId, index, { metricId: event.target.value })}>
                      <option value="">No number</option>
                      {goal.metrics.map((metric) => <option key={metric.id} value={metric.id}>{metric.name}{metric.unit ? ` (${metric.unit})` : ""}</option>)}
                    </select>
                    <input className="input" type="number" min={0} step="any" inputMode="decimal" aria-label={`Amount for target ${index + 1} of ${goal.title}`}
                      value={row.value} disabled={!goalState.include || !row.metricId} placeholder={row.metricId ? "Amount" : "–"}
                      onChange={(event) => setRow(goal.goalId, index, { value: event.target.value })} />
                  </div>
                </li>
              ))}
            </ul>
            {goalState.include && goalState.rows.length < TARGET_LIMITS.perGoal && (
              <button type="button" onClick={() => update(goal.goalId, (current) => ({ ...current, rows: [...current.rows, { title: "", metricId: goal.metrics[0]?.id ?? "", value: "" }] }))}
                className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-indigo-700 hover:underline">
                <Plus aria-hidden="true" className="h-4 w-4" />Add a target
              </button>
            )}
          </div>
        </div>
      </fieldset>
    );
  }

  if (goals.length === 0) {
    return <p className="rounded-lg bg-slate-50 px-3 py-3 text-sm text-slate-600">No active goals. Add a goal to set weekly targets.</p>;
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={askAI} disabled={asking}
          className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-sm font-semibold text-indigo-700 hover:bg-indigo-100 disabled:opacity-60">
          <Sparkles aria-hidden="true" className="h-4 w-4" />{asking ? "Asking the AI…" : "Ask the AI to propose"}
        </button>
        <p className="text-xs text-slate-500">Proposals below are worked out from last week. The AI can adjust them; nothing is saved until you press Save.</p>
      </div>
      {aiMessage && <p role="status" className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{aiMessage}</p>}
      {aiError && <p role="alert" className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{aiError}</p>}

      <ActionForm action={saveNextWeekTargets} resetOnSuccess={false} className="mt-4 space-y-4">
        <input type="hidden" name="planning_week" value={planningWeek} />
        <input type="hidden" name="review_week" value={reviewWeek} />
        <input type="hidden" name="targets" value={payload} />
        {busy.map(renderGoal)}
        {quiet.length > 0 && (
          <details className="rounded-lg border border-dashed border-slate-300 p-3" open={quiet.some((goal) => state[goal.goalId].include)}>
            <summary className="cursor-pointer text-sm font-medium text-slate-700">
              {quiet.length === 1 ? "1 more goal has" : `${quiet.length} more goals have`} no targets yet: {quiet.map((goal) => goal.title).join(", ")}
            </summary>
            <div className="mt-3 space-y-4">{quiet.map(renderGoal)}</div>
          </details>
        )}
        <ActionSubmitButton pendingLabel="Saving…" className="btn-primary w-full sm:w-auto">Save next week&apos;s targets</ActionSubmitButton>
      </ActionForm>
    </div>
  );
}
