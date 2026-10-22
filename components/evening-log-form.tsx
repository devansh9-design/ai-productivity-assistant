"use client";

import { useState } from "react";
import { saveEveningLog } from "@/lib/checkins/actions";
import { ActionForm } from "@/components/action-form";
import { ActionSubmitButton } from "@/components/action-submit-button";
import { LESSON_MAX_LENGTH, NOTE_MAX_LENGTH, REASON_MAX_LENGTH, field, suggestedMetricValues, type LogOutcome } from "@/lib/evening/log";
import type { EveningLogData } from "@/lib/evening/load";

const OUTCOME_OPTIONS: Array<{ value: LogOutcome; label: string }> = [
  { value: "done", label: "Done" },
  { value: "partial", label: "Partly" },
  { value: "skipped", label: "Skipped" },
];
const MOOD_OPTIONS = [1, 2, 3, 4, 5] as const;

const CHIP_CLASS =
  "flex cursor-pointer items-center justify-center rounded-lg border border-slate-300 px-2 py-1.5 text-sm font-medium text-slate-700 has-[:checked]:border-indigo-500 has-[:checked]:bg-indigo-50 has-[:checked]:text-indigo-700 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-indigo-400";

/**
 * Closes the day on one screen: each item done, partly done or skipped (with a
 * reason), today's metric numbers, and an optional mood, lesson and note.
 * Routine sessions marked done suggest what they add to their metric.
 */
export function EveningLogForm({ data }: { data: EveningLogData }) {
  const [outcomes, setOutcomes] = useState<Record<string, LogOutcome | undefined>>(
    () => Object.fromEntries(data.tasks.map((task) => [task.id, task.outcome ?? undefined])),
  );
  const [values, setValues] = useState<Record<string, string>>(
    () => Object.fromEntries(data.metrics.map((metric) => [metric.id, metric.value === null ? "" : String(metric.value)])),
  );
  const suggestions = suggestedMetricValues(data.routineSources, outcomes);

  return (
    <details className="mt-8 card p-5" open={!data.saved} suppressHydrationWarning>
      <summary className="cursor-pointer text-lg font-semibold text-slate-900">
        Evening log {data.saved && <span className="ml-2 text-sm font-normal text-emerald-700">Saved for today ✓</span>}
      </summary>
      <p className="mt-2 text-sm text-slate-600">Close the day: mark each item, add today&apos;s numbers, and a note if you like.</p>

      <ActionForm action={saveEveningLog} resetOnSuccess={false} className="mt-4 space-y-6">
        <fieldset>
          <legend className="text-sm font-semibold text-slate-900">What got done</legend>
          {data.tasks.length === 0 ? (
            <p className="mt-2 text-sm text-slate-600">Nothing was planned or due today.</p>
          ) : (
            <ul className="mt-2 space-y-3">
              {data.tasks.map((task) => {
                const outcome = outcomes[task.id];
                return (
                  <li key={task.id} className="rounded-lg border border-slate-200 p-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-slate-900">{task.title}</p>
                        <p className="text-xs text-slate-500">
                          {[task.plannedTime, task.isRoutine ? "routine" : null].filter(Boolean).join(" · ") || "due today"}
                        </p>
                      </div>
                      <div role="radiogroup" aria-label={`How did "${task.title}" go?`} className="grid w-full grid-cols-3 gap-2 sm:w-auto">
                        {OUTCOME_OPTIONS.map((option) => (
                          <label key={option.value} className={CHIP_CLASS}>
                            <input
                              type="radio"
                              name={field.outcome(task.id)}
                              value={option.value}
                              checked={outcome === option.value}
                              onChange={() => setOutcomes((current) => ({ ...current, [task.id]: option.value }))}
                              className="sr-only"
                            />
                            {option.label}
                          </label>
                        ))}
                      </div>
                    </div>
                    {(outcome === "partial" || outcome === "skipped") && (
                      <input
                        className="input mt-2"
                        name={field.reason(task.id)}
                        defaultValue={task.reason ?? ""}
                        maxLength={REASON_MAX_LENGTH}
                        required={outcome === "skipped"}
                        aria-label={outcome === "skipped" ? `Why was "${task.title}" skipped?` : `How far did "${task.title}" get?`}
                        placeholder={outcome === "skipped" ? "Why was it skipped?" : "How far did you get? (optional)"}
                      />
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </fieldset>

        {data.metrics.length > 0 && (
          <fieldset>
            <legend className="text-sm font-semibold text-slate-900">Today&apos;s numbers</legend>
            <p className="mt-1 text-xs text-slate-500">Leave a box empty if you didn&apos;t track it today.</p>
            <div className="mt-2 grid gap-3 sm:grid-cols-2">
              {data.metrics.map((metric) => {
                const suggestion = suggestions.get(metric.id);
                const inputId = `metric-${metric.id}`;
                return (
                  <div key={metric.id}>
                    <label className="block text-sm font-medium text-slate-800" htmlFor={inputId}>
                      {metric.name}{metric.unit ? ` (${metric.unit})` : ""}
                      <span className="block text-xs font-normal text-slate-500">{metric.goalTitle}</span>
                    </label>
                    <input
                      id={inputId}
                      className="input mt-1"
                      name={field.metric(metric.id)}
                      type="number"
                      step="any"
                      inputMode="decimal"
                      value={values[metric.id] ?? ""}
                      onChange={(event) => setValues((current) => ({ ...current, [metric.id]: event.target.value }))}
                    />
                    {suggestion && values[metric.id] !== String(suggestion.value) && (
                      <button
                        type="button"
                        onClick={() => setValues((current) => ({ ...current, [metric.id]: String(suggestion.value) }))}
                        className="mt-1 text-xs font-medium text-indigo-700 underline"
                      >
                        Use {suggestion.value} from {suggestion.from.join(", ")}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </fieldset>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <fieldset>
            <legend className="text-sm font-medium text-slate-800">Mood <span className="font-normal text-slate-500">(optional)</span></legend>
            <div className="mt-1 flex gap-2">
              {MOOD_OPTIONS.map((value) => (
                <label key={value} className={`${CHIP_CLASS} h-9 w-9`}>
                  <input type="radio" name="mood" value={value} defaultChecked={data.evening.mood === value} className="sr-only" />
                  {value}
                </label>
              ))}
            </div>
            <p className="mt-1 text-xs text-slate-500">1 = rough day, 5 = great day</p>
          </fieldset>
          <label className="block text-sm font-medium text-slate-800" htmlFor="evening-lesson">
            Lesson <span className="font-normal text-slate-500">(optional)</span>
            <input className="input mt-1" id="evening-lesson" name="lesson" maxLength={LESSON_MAX_LENGTH}
              defaultValue={data.evening.lesson ?? ""} placeholder="What would you do differently?" />
          </label>
          <label className="block text-sm font-medium text-slate-800 sm:col-span-2" htmlFor="evening-note">
            Note <span className="font-normal text-slate-500">(optional)</span>
            <textarea className="input mt-1" id="evening-note" name="note" rows={2} maxLength={NOTE_MAX_LENGTH}
              defaultValue={data.evening.note ?? ""} placeholder="Anything worth remembering about today?" />
          </label>
        </div>

        <ActionSubmitButton pendingLabel="Saving…" className="btn-primary w-full sm:w-auto">
          {data.saved ? "Update evening log" : "Save evening log"}
        </ActionSubmitButton>
      </ActionForm>
    </details>
  );
}
