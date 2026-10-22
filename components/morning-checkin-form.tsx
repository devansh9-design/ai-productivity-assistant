import { saveMorningCheckin } from "@/lib/checkins/actions";
import { generateDraftPlan } from "@/lib/plans/actions";
import { ActionForm } from "@/components/action-form";
import { ActionSubmitButton } from "@/components/action-submit-button";
import { AVAILABLE_MINUTE_OPTIONS, EVENT_TITLE_MAX_LENGTH, NOTES_MAX_LENGTH, formatMinutes } from "@/lib/checkins/morning";
import type { Checkin, EnergyLevel } from "@/lib/types";

const ENERGY_OPTIONS: Array<{ value: EnergyLevel; label: string; hint: string }> = [
  { value: "low", label: "Low", hint: "Lighter plan" },
  { value: "medium", label: "Medium", hint: "Normal plan" },
  { value: "high", label: "High", hint: "Bring it on" },
];

const CHIP_CLASS =
  "flex cursor-pointer flex-col items-center rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 has-[:checked]:border-indigo-500 has-[:checked]:bg-indigo-50 has-[:checked]:text-indigo-700 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-indigo-400";

/** "3 h free · low energy", for the collapsed card and the schedule card. */
export function morningSummary(checkin: Checkin): string {
  return [
    checkin.available_minutes != null ? `${formatMinutes(checkin.available_minutes)} free` : null,
    checkin.energy_level ? `${checkin.energy_level} energy` : null,
  ].filter(Boolean).join(" · ");
}

/**
 * Today starts here: free time, energy and anything special, then the plan is
 * generated from them. Once saved it collapses to a summary that can be edited,
 * which regenerates the draft.
 */
export function MorningCheckinForm({ existingCheckin, hasPlan }: { existingCheckin: Checkin | null; hasPlan: boolean }) {
  const done = existingCheckin !== null;
  const minuteOptions: number[] = [...AVAILABLE_MINUTE_OPTIONS];
  if (existingCheckin?.available_minutes != null && !minuteOptions.includes(existingCheckin.available_minutes)) {
    minuteOptions.push(existingCheckin.available_minutes);
    minuteOptions.sort((a, b) => a - b);
  }

  return (
    // Tapping the summary before hydration toggles `open` natively; that state belongs to the browser.
    <details className="mt-6 card p-5" open={!done} suppressHydrationWarning>
      <summary className="cursor-pointer text-lg font-semibold text-slate-900">
        Morning check-in
        {done && <span className="ml-2 text-sm font-normal text-emerald-700">Done ✓ {morningSummary(existingCheckin)}</span>}
      </summary>
      <p className="mt-2 text-sm text-slate-600">
        {done
          ? "Changed your mind? Update it and the draft plan is rebuilt."
          : "Tell the planner how today looks, and it builds a plan that fits."}
      </p>

      <ActionForm action={saveMorningCheckin} resetOnSuccess={false} className="mt-4 grid gap-4 sm:grid-cols-2">
        <label className="block text-sm font-medium text-slate-800" htmlFor="morning-minutes">
          Free time for planned work today
          <select
            className="input mt-1"
            id="morning-minutes"
            name="available_minutes"
            required
            defaultValue={existingCheckin?.available_minutes ?? ""}
          >
            <option value="" disabled>Choose…</option>
            {minuteOptions.map((minutes) => (
              <option key={minutes} value={minutes}>{formatMinutes(minutes)}</option>
            ))}
          </select>
        </label>

        <fieldset>
          <legend className="text-sm font-medium text-slate-800">Energy</legend>
          <div className="mt-1 grid grid-cols-3 gap-2">
            {ENERGY_OPTIONS.map((option) => (
              <label key={option.value} className={CHIP_CLASS}>
                <input
                  type="radio"
                  name="energy_level"
                  value={option.value}
                  required
                  defaultChecked={existingCheckin?.energy_level === option.value}
                  className="sr-only"
                />
                {option.label}
                <span className="text-xs font-normal text-slate-500">{option.hint}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <label className="block text-sm font-medium text-slate-800 sm:col-span-2" htmlFor="morning-notes">
          Anything special today? <span className="font-normal text-slate-500">(optional)</span>
          <textarea
            className="input mt-1"
            id="morning-notes"
            name="notes"
            rows={2}
            maxLength={NOTES_MAX_LENGTH}
            defaultValue={existingCheckin?.notes ?? ""}
            placeholder="Exam prep, travelling home, slept badly…"
          />
        </label>

        <details className="sm:col-span-2 rounded-lg border border-slate-200 p-3" suppressHydrationWarning>
          <summary className="cursor-pointer text-sm font-medium text-slate-800">Add an exam, trip or other fixed block</summary>
          <p className="mt-1 text-xs text-slate-500">It is added to today&apos;s commitments, so nothing is planned over it.</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <label className="block text-sm font-medium text-slate-800 sm:col-span-3" htmlFor="morning-event-title">
              What
              <input className="input mt-1" id="morning-event-title" name="event_title" maxLength={EVENT_TITLE_MAX_LENGTH} placeholder="Maths mid-sem exam" />
            </label>
            <label className="block text-sm font-medium text-slate-800" htmlFor="morning-event-start">
              From
              <input className="input mt-1" id="morning-event-start" name="event_start" type="time" />
            </label>
            <label className="block text-sm font-medium text-slate-800" htmlFor="morning-event-end">
              Until
              <input className="input mt-1" id="morning-event-end" name="event_end" type="time" />
            </label>
          </div>
        </details>

        <div className="sm:col-span-2">
          <ActionSubmitButton pendingLabel="Planning your day…" className="btn-primary w-full sm:w-auto">
            {done ? "Update and replan" : "Save and plan my day"}
          </ActionSubmitButton>
        </div>
      </ActionForm>

      {!done && !hasPlan && (
        <ActionForm action={generateDraftPlan} resetOnSuccess={false} className="mt-3">
          <ActionSubmitButton pendingLabel="Generating..." className="text-sm font-medium text-slate-600 underline hover:text-slate-900">
            Skip the check-in and plan anyway
          </ActionSubmitButton>
        </ActionForm>
      )}
    </details>
  );
}
