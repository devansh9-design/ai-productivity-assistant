import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ActionForm } from "@/components/action-form";
import { ActionSubmitButton } from "@/components/action-submit-button";
import { createAvailabilityRule, createFixedCommitment, deleteAvailabilityRule, deleteFixedCommitment } from "@/lib/scheduler/actions";
import { getGoogleConnectUrl, disconnectGoogleCalendar } from "@/lib/google/actions";
import { isGoogleCalendarConnected } from "@/lib/google/oauth";
import type { AvailabilityRule, FixedCommitment } from "@/lib/types";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

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

  const params = await searchParams;
  const googleStatus = typeof params.google === "string" ? params.google : null;
  const googleError = typeof params.google_error === "string" ? params.google_error : null;

  return (
    <section aria-labelledby="page-title" className="mx-auto max-w-4xl">
      <p className="text-sm font-semibold uppercase tracking-wide text-indigo-600">Schedule preferences</p>
      <h1 id="page-title" className="mt-2 text-3xl font-bold tracking-tight text-slate-900">Settings</h1>
      <p className="mt-2 max-w-2xl text-slate-600">Set recurring availability and protected time. The daily scheduler only places tasks inside working windows.</p>

      <ActionForm action={createAvailabilityRule} className="mt-8 rounded-2xl border border-slate-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-slate-900">Recurring schedule rule</h2>
        <p className="mt-1 text-sm text-slate-600">Use working windows for capacity, high-focus windows for demanding tasks, and the other types to reserve recurring time.</p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <label className="text-sm font-medium text-slate-800">Day
            <select name="weekday" defaultValue="1" className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900">
              {WEEKDAYS.map((day, index) => <option key={day} value={index}>{day}</option>)}
            </select>
          </label>
          <label className="text-sm font-medium text-slate-800">Type
            <select name="kind" defaultValue="working" className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900">
              <option value="working">Working hours</option><option value="high_focus">High-focus window</option><option value="sleep">Sleep</option><option value="meal">Meal</option><option value="travel">Travel</option><option value="break">Break</option>
            </select>
          </label>
          <label className="text-sm font-medium text-slate-800">Start time<input name="start_time" type="time" required className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900" /></label>
          <label className="text-sm font-medium text-slate-800">End time<input name="end_time" type="time" required className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900" /></label>
        </div>
        <ActionSubmitButton pendingLabel="Saving..." className="mt-4 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700">Add rule</ActionSubmitButton>
      </ActionForm>

      <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-slate-900">Current recurring rules</h2>
        {rulesError && <p role="alert" className="mt-3 text-sm text-rose-700">Could not load schedule rules: {rulesError.message}</p>}
        {!rulesError && (rules ?? []).length === 0 && <p className="mt-3 text-sm text-slate-600">No working availability yet. Add working hours before generating a plan.</p>}
        <div className="mt-3 space-y-2">
          {(rules ?? []).map((rule) => <div key={rule.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700"><span>{WEEKDAYS[rule.weekday]}: {rule.kind.replace("_", " ")} from {shortTime(rule.start_time)} to {shortTime(rule.end_time)}</span><form action={deleteAvailabilityRule}><input type="hidden" name="id" value={rule.id} /><button className="font-medium text-rose-700 hover:text-rose-800">Remove</button></form></div>)}
        </div>
      </div>

      <ActionForm action={createFixedCommitment} className="mt-8 rounded-2xl border border-slate-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-slate-900">Fixed commitment</h2>
        <p className="mt-1 text-sm text-slate-600">Commitments are immutable to the scheduler and always block task placement.</p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <label className="text-sm font-medium text-slate-800 lg:col-span-2">Title<input name="title" required maxLength={200} className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900" /></label>
          <label className="text-sm font-medium text-slate-800">Date<input name="commitment_date" type="date" required className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900" /></label>
          <span className="hidden lg:block" />
          <label className="text-sm font-medium text-slate-800">Start time<input name="start_time" type="time" required className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900" /></label>
          <label className="text-sm font-medium text-slate-800">End time<input name="end_time" type="time" required className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900" /></label>
        </div>
        <ActionSubmitButton pendingLabel="Saving..." className="mt-4 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700">Add commitment</ActionSubmitButton>
      </ActionForm>

      <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-slate-900">Fixed commitments</h2>
        {commitmentsError && <p role="alert" className="mt-3 text-sm text-rose-700">Could not load commitments: {commitmentsError.message}</p>}
        {!commitmentsError && (commitments ?? []).length === 0 && <p className="mt-3 text-sm text-slate-600">No fixed commitments saved.</p>}
        <div className="mt-3 space-y-2">
          {(commitments ?? []).map((commitment) => <div key={commitment.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700"><span>{commitment.commitment_date} · {shortTime(commitment.start_time)} to {shortTime(commitment.end_time)} · {commitment.title}</span><form action={deleteFixedCommitment}><input type="hidden" name="id" value={commitment.id} /><button className="font-medium text-rose-700 hover:text-rose-800">Remove</button></form></div>)}
        </div>
      </div>

      {/* ----- Day 6: Google Calendar integration ----- */}
      <div className="mt-8 rounded-2xl border border-slate-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-slate-900">Google Calendar</h2>
        <p className="mt-1 text-sm text-slate-600">
          Connect your Google Calendar to automatically block out calendar events when generating your daily plan. Only read access is requested.
        </p>

        {googleStatus === "connected" && (
          <p className="mt-3 rounded-lg bg-emerald-50 px-4 py-2 text-sm text-emerald-800">
            Google Calendar connected successfully.
          </p>
        )}
        {googleError && (
          <p role="alert" className="mt-3 rounded-lg bg-rose-50 px-4 py-2 text-sm text-rose-700">
            Google Calendar connection failed: {googleError === "oauth_state_mismatch" ? "Security validation failed. Please try again." : googleError === "token_exchange_failed" ? "Could not complete authorization. Please try again." : googleError}
          </p>
        )}

        <div className="mt-4">
          {googleConnected ? (
            <div className="flex items-center gap-4">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-3 py-1 text-sm font-medium text-emerald-800">
                <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
                Connected
              </span>
              <ActionForm action={disconnectGoogleCalendar} resetOnSuccess={false}>
                <ActionSubmitButton
                  pendingLabel="Disconnecting..."
                  className="rounded-lg border border-rose-300 px-4 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-50"
                >
                  Disconnect
                </ActionSubmitButton>
              </ActionForm>
            </div>
          ) : (
            <ActionForm action={connectGoogleCalendar} resetOnSuccess={false}>
              <ActionSubmitButton
                pendingLabel="Connecting..."
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
              >
                Connect Google Calendar
              </ActionSubmitButton>
            </ActionForm>
          )}
        </div>
      </div>
    </section>
  );
}
