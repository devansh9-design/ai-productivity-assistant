import { saveEveningCheckin } from "@/lib/checkins/actions";
import { ActionForm } from "@/components/action-form";
import { ActionSubmitButton } from "@/components/action-submit-button";
import { DISTRACTIONS_MAX_LENGTH, LESSON_MAX_LENGTH, REFLECTION_MAX_LENGTH, WINS_MAX_LENGTH } from "@/lib/checkins/validate";
import type { Checkin, JournalEntry } from "@/lib/types";

const MOOD_OPTIONS = [1, 2, 3, 4, 5] as const;

export function EveningCheckinForm({
  existingCheckin,
  existingReflection,
}: {
  existingCheckin: Checkin | null;
  existingReflection: JournalEntry | null;
}) {
  const alreadyCheckedIn = !!existingCheckin || !!existingReflection;

  return (
    <details className="mt-8 rounded-2xl border border-slate-200 bg-white p-6" open={!alreadyCheckedIn}>
      <summary className="cursor-pointer text-lg font-semibold text-slate-900">
        Evening check-in {alreadyCheckedIn && <span className="ml-2 text-sm font-normal text-emerald-700">Saved for today ✓</span>}
      </summary>
      <p className="mt-2 text-sm text-slate-600">Close the day: how it went, and one thing to carry into tomorrow.</p>

      <ActionForm action={saveEveningCheckin} className="mt-4 grid gap-4 sm:grid-cols-2" resetOnSuccess={false}>
        <fieldset className="sm:col-span-2">
          <legend className="text-sm font-medium text-slate-800">Mood</legend>
          <div className="mt-1 flex gap-2">
            {MOOD_OPTIONS.map((value) => (
              <label
                key={value}
                className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg border border-slate-300 text-sm font-medium text-slate-700 has-[:checked]:border-indigo-500 has-[:checked]:bg-indigo-50 has-[:checked]:text-indigo-700"
              >
                <input
                  type="radio"
                  name="mood"
                  value={value}
                  defaultChecked={existingCheckin?.mood === value}
                  className="sr-only"
                />
                {value}
              </label>
            ))}
          </div>
          <p className="mt-1 text-xs text-slate-500">1 = rough day, 5 = great day</p>
        </fieldset>

        <label className="block text-sm font-medium text-slate-800" htmlFor="checkin-energy">
          Energy level
          <select
            className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900"
            id="checkin-energy"
            name="energy_level"
            defaultValue={existingCheckin?.energy_level ?? ""}
          >
            <option value="">Not set</option>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
        </label>

        <label className="block text-sm font-medium text-slate-800" htmlFor="checkin-distractions">
          Distractions
          <input
            className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900"
            id="checkin-distractions"
            name="distractions"
            defaultValue={existingCheckin?.distractions ?? ""}
            placeholder="What pulled focus today?"
            maxLength={DISTRACTIONS_MAX_LENGTH}
          />
        </label>

        <label className="block text-sm font-medium text-slate-800" htmlFor="checkin-wins">
          Wins
          <input
            className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900"
            id="checkin-wins"
            name="wins"
            defaultValue={existingCheckin?.wins ?? ""}
            placeholder="What went well?"
            maxLength={WINS_MAX_LENGTH}
          />
        </label>

        <label className="block text-sm font-medium text-slate-800" htmlFor="checkin-lesson">
          Lesson
          <input
            className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900"
            id="checkin-lesson"
            name="lesson"
            defaultValue={existingCheckin?.lesson ?? ""}
            placeholder="What would you do differently?"
            maxLength={LESSON_MAX_LENGTH}
          />
        </label>

        <label className="block text-sm font-medium text-slate-800 sm:col-span-2" htmlFor="checkin-reflection">
          Reflection
          <textarea
            className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900"
            id="checkin-reflection"
            name="reflection"
            rows={3}
            required
            maxLength={REFLECTION_MAX_LENGTH}
            defaultValue={existingReflection?.reflection ?? ""}
            placeholder="Free-write about the day."
          />
        </label>

        <div className="sm:col-span-2">
          <ActionSubmitButton className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700">
            {alreadyCheckedIn ? "Update check-in" : "Save check-in"}
          </ActionSubmitButton>
        </div>
      </ActionForm>
    </details>
  );
}
