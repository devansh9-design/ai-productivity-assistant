import { ActionForm } from "@/components/action-form";
import { ActionSubmitButton } from "@/components/action-submit-button";
import { replanToday } from "@/lib/plans/actions";

const OPTION_CLASS = "flex h-full flex-col rounded-xl border border-slate-200 p-4";
const BUTTON_CLASS = "mt-3 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm font-semibold text-indigo-700 hover:bg-indigo-100";

export function ReplanPanel({ lowEnergyMaxBlockMinutes }: { lowEnergyMaxBlockMinutes: number }) {
  return (
    <section aria-labelledby="replan-title" className="mt-4 card p-5">
      <h2 id="replan-title" className="text-lg font-semibold text-slate-900">Replan the rest of today</h2>
      <p className="mt-1 text-sm text-slate-600">
        Builds a new draft from the current time. Blocks for tasks you have started or finished stay as they are, and Google Calendar is unchanged until you confirm the draft.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <ActionForm action={replanToday} resetOnSuccess={false} className={OPTION_CLASS}>
          <input type="hidden" name="mode" value="low_energy" />
          <h3 className="font-semibold text-slate-900">Low on energy</h3>
          <p className="mt-1 flex-1 text-sm text-slate-600">
            Lighter tasks first, sessions of at most {lowEnergyMaxBlockMinutes} minutes, and high-energy work deferred.
          </p>
          <ActionSubmitButton pendingLabel="Replanning..." className={BUTTON_CLASS}>Replan for low energy</ActionSubmitButton>
        </ActionForm>

        <ActionForm action={replanToday} resetOnSuccess={false} className={OPTION_CLASS}>
          <input type="hidden" name="mode" value="behind_schedule" />
          <h3 className="font-semibold text-slate-900">Behind schedule</h3>
          <p className="mt-1 flex-1 text-sm text-slate-600">
            Moves the remaining tasks to start now, uses buffer time to catch up, and lists anything that no longer fits.
          </p>
          <ActionSubmitButton pendingLabel="Replanning..." className={BUTTON_CLASS}>Catch up from now</ActionSubmitButton>
        </ActionForm>
      </div>

      <ActionForm action={replanToday} resetOnSuccess={false} className={`${OPTION_CLASS} mt-3`}>
        <input type="hidden" name="mode" value="free_time" />
        <h3 className="font-semibold text-slate-900">Free time available</h3>
        <p className="mt-1 text-sm text-slate-600">Fills the window with open tasks that are not on today&apos;s plan yet, keeping everything else in place.</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="text-sm font-medium text-slate-800">From
            <input name="start_time" type="time" required className="input mt-1" />
          </label>
          <label className="text-sm font-medium text-slate-800">Until
            <input name="end_time" type="time" required className="input mt-1" />
          </label>
        </div>
        <ActionSubmitButton pendingLabel="Replanning..." className={`${BUTTON_CLASS} self-start`}>Fill my free time</ActionSubmitButton>
      </ActionForm>
    </section>
  );
}
