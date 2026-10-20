import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ActionForm } from "@/components/action-form";
import { ActionSubmitButton } from "@/components/action-submit-button";
import { createAvailabilityRule, createFixedCommitment, deleteAvailabilityRule, deleteFixedCommitment } from "@/lib/scheduler/actions";
import { CalendarStatusCard } from "@/components/settings/calendar-status-card";
import { getGoogleConnectUrl } from "@/lib/google/actions";
import { isGoogleCalendarConnected } from "@/lib/google/oauth";
import { loadCalendarStatus } from "@/lib/integrations/status";
import { savePlanningPreferences } from "@/lib/preferences/actions";
import { loadPersonalization } from "@/lib/preferences/load";
import { MIN_DURATION_SAMPLES } from "@/lib/preferences/preferences";
import { DEFAULT_TIMEZONE, TIMEZONE_COOKIE_NAME } from "@/lib/tasks/timezone";
import type { AvailabilityRule, FixedCommitment } from "@/lib/types";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const RULE_LABELS: Record<string, string> = { working: "working hours", high_focus: "high-focus window", exercise: "gym / exercise" };

function shortTime(value: string) {
  return value.slice(0, 5);
}

async function connectGoogleCalendar() {
  "use server";
  const url = await getGoogleConnectUrl();
  redirect(url);
}

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [{ data: rules, error: rulesError }, { data: commitments, error: commitmentsError }] = await Promise.all([
    supabase.from("availability_rules").select("*").order("weekday").order("start_time").returns<AvailabilityRule[]>(),
    supabase.from("fixed_commitments").select("*").order("commitment_date").order("start_time").returns<FixedCommitment[]>(),
  ]);

  // Google Calendar connection status (service-role check, never exposes tokens)
  const googleConnected = user ? await isGoogleCalendarConnected(user.id) : false;
  const calendarStatus = user ? await loadCalendarStatus(supabase, user.id).catch(() => null) : null;
  const timeZone = (await cookies()).get(TIMEZONE_COOKIE_NAME)?.value || DEFAULT_TIMEZONE;
  const { preferences, durationFactor, durationSamples } = await loadPersonalization(supabase, timeZone);

  const params = await searchParams;
  const googleStatus = typeof params.google === "string" ? params.google : null;
  const googleError = typeof params.google_error === "string" ? params.google_error : null;

  return (
    <section aria-labelledby="page-title" className="mx-auto max-w-4xl">
      <p className="text-sm font-semibold uppercase tracking-wide text-indigo-600">Schedule preferences</p>
      <h1 id="page-title" className="mt-2 text-3xl font-bold tracking-tight text-slate-900">Settings</h1>
      <p className="mt-2 max-w-2xl text-slate-600">Set recurring availability and protected time. The daily scheduler only places tasks inside working windows.</p>

      <ActionForm action={createAvailabilityRule} className="mt-8 card p-6">
        <h2 className="text-lg font-semibold text-slate-900">Recurring schedule rule</h2>
        <p className="mt-1 text-sm text-slate-600">Use working windows for capacity, high-focus windows for demanding tasks, and the other types to reserve recurring time.</p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <label className="text-sm font-medium text-slate-800">Day
            <select name="weekday" defaultValue="1" className="input mt-1">
              {WEEKDAYS.map((day, index) => <option key={day} value={index}>{day}</option>)}
            </select>
          </label>
          <label className="text-sm font-medium text-slate-800">Type
            <select name="kind" defaultValue="working" className="input mt-1">
              <option value="working">Working hours</option><option value="high_focus">High-focus window</option><option value="sleep">Sleep</option><option value="meal">Meal</option><option value="travel">Travel</option><option value="break">Break</option><option value="exercise">Gym / exercise</option>
            </select>
          </label>
          <label className="text-sm font-medium text-slate-800">Start time<input name="start_time" type="time" required className="input mt-1" /></label>
          <label className="text-sm font-medium text-slate-800">End time<input name="end_time" type="time" required className="input mt-1" /></label>
        </div>
        <ActionSubmitButton pendingLabel="Saving..." className="mt-4 btn-primary">Add rule</ActionSubmitButton>
      </ActionForm>

      <div className="mt-4 card p-6">
        <h2 className="text-lg font-semibold text-slate-900">Current recurring rules</h2>
        {rulesError && <p role="alert" className="mt-3 text-sm text-rose-700">Could not load schedule rules: {rulesError.message}</p>}
        {!rulesError && (rules ?? []).length === 0 && <p className="mt-3 text-sm text-slate-600">No working availability yet. Add working hours before generating a plan.</p>}
        <div className="mt-3 space-y-2">
          {(rules ?? []).map((rule) => <div key={rule.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700"><span>{WEEKDAYS[rule.weekday]}: {RULE_LABELS[rule.kind] ?? rule.kind} from {shortTime(rule.start_time)} to {shortTime(rule.end_time)}</span><form action={deleteAvailabilityRule}><input type="hidden" name="id" value={rule.id} /><button className="font-medium text-rose-700 hover:text-rose-800">Remove</button></form></div>)}
        </div>
      </div>

      <ActionForm action={savePlanningPreferences} resetOnSuccess={false} className="mt-8 card p-6">
        <h2 className="text-lg font-semibold text-slate-900">Planning preferences</h2>
        <p className="mt-1 text-sm text-slate-600">These apply the next time you generate or replan today&apos;s schedule.</p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="text-sm font-medium text-slate-800">Buffer (% of free working time)
            <input name="buffer_percent" type="number" min={0} max={50} step={1} required defaultValue={preferences.bufferPercent} className="input mt-1" />
          </label>
          <label className="text-sm font-medium text-slate-800">Longest low-energy session (minutes)
            <input name="low_energy_max_block_minutes" type="number" min={15} max={240} step={5} required defaultValue={preferences.lowEnergyMaxBlockMinutes} className="input mt-1" />
          </label>
        </div>
        <label className="mt-4 flex items-start gap-2 text-sm text-slate-800">
          <input name="adapt_to_actual_durations" type="checkbox" defaultChecked={preferences.adaptToActualDurations} className="mt-0.5" />
          <span>
            Adjust task estimates using how long completed tasks actually took.
            <span className="block text-xs text-slate-500">
              {durationSamples >= MIN_DURATION_SAMPLES
                ? `Based on ${durationSamples} recent completed tasks, the current adjustment is x${durationFactor.toFixed(2)}.`
                : `Needs at least ${MIN_DURATION_SAMPLES} recently completed tasks with actual minutes recorded (currently ${durationSamples}).`}
            </span>
          </span>
        </label>
        <ActionSubmitButton pendingLabel="Saving..." className="mt-4 btn-primary">Save preferences</ActionSubmitButton>
      </ActionForm>

      <ActionForm action={createFixedCommitment} className="mt-8 card p-6">
        <h2 className="text-lg font-semibold text-slate-900">Fixed commitment</h2>
        <p className="mt-1 text-sm text-slate-600">Commitments are immutable to the scheduler and always block task placement.</p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <label className="text-sm font-medium text-slate-800 lg:col-span-2">Title<input name="title" required maxLength={200} className="input mt-1" /></label>
          <label className="text-sm font-medium text-slate-800">Date<input name="commitment_date" type="date" required className="input mt-1" /></label>
          <span className="hidden lg:block" />
          <label className="text-sm font-medium text-slate-800">Start time<input name="start_time" type="time" required className="input mt-1" /></label>
          <label className="text-sm font-medium text-slate-800">End time<input name="end_time" type="time" required className="input mt-1" /></label>
        </div>
        <ActionSubmitButton pendingLabel="Saving..." className="mt-4 btn-primary">Add commitment</ActionSubmitButton>
      </ActionForm>

      <div className="mt-4 card p-6">
        <h2 className="text-lg font-semibold text-slate-900">Fixed commitments</h2>
        {commitmentsError && <p role="alert" className="mt-3 text-sm text-rose-700">Could not load commitments: {commitmentsError.message}</p>}
        {!commitmentsError && (commitments ?? []).length === 0 && <p className="mt-3 text-sm text-slate-600">No fixed commitments saved.</p>}
        <div className="mt-3 space-y-2">
          {(commitments ?? []).map((commitment) => <div key={commitment.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700"><span>{commitment.commitment_date} · {shortTime(commitment.start_time)} to {shortTime(commitment.end_time)} · {commitment.title}</span><form action={deleteFixedCommitment}><input type="hidden" name="id" value={commitment.id} /><button className="font-medium text-rose-700 hover:text-rose-800">Remove</button></form></div>)}
        </div>
      </div>

      <CalendarStatusCard connected={googleConnected} status={calendarStatus} timeZone={timeZone}
        oauthResult={googleStatus} oauthError={googleError} connectAction={connectGoogleCalendar} />

      <div className="mt-8 card p-6">
        <h2 className="text-lg font-semibold text-slate-900">Your data</h2>
        <p className="mt-1 text-sm text-slate-600">
          Download everything you&apos;ve saved (goals, tasks, plans, check-ins, reviews and AI history) as one JSON file. Google sign-in tokens are never included.
        </p>
        <a href="/api/export" download
          className="mt-4 inline-block btn-secondary">
          Download my data
        </a>
      </div>
    </section>
  );
}
