import { ActionForm } from "@/components/action-form";
import { ActionSubmitButton } from "@/components/action-submit-button";
import { disconnectGoogleCalendar } from "@/lib/google/actions";
import { updateCalendarSwitches } from "@/lib/integrations/actions";
import { describeCalendarState, type CalendarIntegrationStatus, type CalendarState } from "@/lib/integrations/calendar";

const STATE_BADGES: Record<CalendarState, { label: string; className: string; dot: string }> = {
  connected: { label: "Connected", className: "bg-emerald-100 text-emerald-800", dot: "bg-emerald-500" },
  failing: { label: "Last attempt failed", className: "bg-amber-100 text-amber-900", dot: "bg-amber-500" },
  needs_reconnect: { label: "Needs reconnecting", className: "bg-rose-100 text-rose-800", dot: "bg-rose-500" },
  not_connected: { label: "Not connected", className: "bg-slate-100 text-slate-700", dot: "bg-slate-400" },
};

const OAUTH_ERRORS: Record<string, string> = {
  oauth_state_mismatch: "Security validation failed. Please try again.",
  token_exchange_failed: "Could not complete authorization. Please try again.",
  access_denied: "Access was not granted.",
};

interface Props {
  connected: boolean;
  status: CalendarIntegrationStatus | null;
  timeZone: string;
  oauthResult: string | null;
  oauthError: string | null;
  connectAction: () => Promise<void>;
}

export function CalendarStatusCard({ connected, status, timeZone, oauthResult, oauthError, connectAction }: Props) {
  const format = (value: string | null) => value
    ? new Intl.DateTimeFormat("en-GB", { timeZone, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(value))
    : "Never";
  const state = status ? describeCalendarState(status, connected) : connected ? "connected" : "not_connected";
  const badge = STATE_BADGES[state];

  return (
    <div className="mt-8 rounded-2xl border border-slate-200 bg-white p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-slate-900">Google Calendar</h2>
        <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium ${badge.className}`}>
          <span className={`inline-block h-2 w-2 rounded-full ${badge.dot}`} />
          {badge.label}
        </span>
      </div>
      <p className="mt-1 text-sm text-slate-600">
        When connected, plans avoid your calendar events, and confirmed plans are published to a separate AI Planner calendar.
      </p>

      {oauthResult === "connected" && (
        <p className="mt-3 rounded-lg bg-emerald-50 px-4 py-2 text-sm text-emerald-800">Google Calendar connected successfully.</p>
      )}
      {oauthError && (
        <p role="alert" className="mt-3 rounded-lg bg-rose-50 px-4 py-2 text-sm text-rose-700">
          Google Calendar connection failed: {OAUTH_ERRORS[oauthError] ?? "Please try again."}
        </p>
      )}
      {state === "needs_reconnect" && (
        <p role="alert" className="mt-3 rounded-lg bg-rose-50 px-4 py-2 text-sm text-rose-700">
          Google no longer accepts this app&apos;s access, so plans cannot check your calendar. Reconnect, or disconnect to stop using Google Calendar.
        </p>
      )}

      {!status && (
        <p role="alert" className="mt-3 rounded-lg bg-rose-50 px-4 py-2 text-sm text-rose-700">
          The integration status could not be loaded. Planning and publishing will stop with an error until it can be read.
        </p>
      )}
      {status && (
        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
          <div className="rounded-lg bg-slate-50 px-3 py-2"><dt className="text-slate-500">Last calendar read</dt><dd className="font-medium text-slate-900">{format(status.lastReadAt)}</dd></div>
          <div className="rounded-lg bg-slate-50 px-3 py-2"><dt className="text-slate-500">Last published</dt><dd className="font-medium text-slate-900">{format(status.lastPublishedAt)}</dd></div>
          <div className="rounded-lg bg-slate-50 px-3 py-2"><dt className="text-slate-500">Last problem</dt><dd className="font-medium text-slate-900">
            {status.lastErrorAt ? `${format(status.lastErrorAt)} while ${status.lastErrorOperation === "publish" ? "publishing" : "reading"}` : "None"}
          </dd></div>
          {status.lastErrorMessage && <p className="text-slate-600 sm:col-span-3">{status.lastErrorMessage}</p>}
        </dl>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        {(!connected || state === "needs_reconnect") && (
          <ActionForm action={connectAction} resetOnSuccess={false}>
            <ActionSubmitButton pendingLabel="Connecting..." className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700">
              {state === "needs_reconnect" ? "Reconnect Google Calendar" : "Connect Google Calendar"}
            </ActionSubmitButton>
          </ActionForm>
        )}
        {(connected || state === "needs_reconnect") && (
          <ActionForm action={disconnectGoogleCalendar} resetOnSuccess={false}>
            <ActionSubmitButton pendingLabel="Disconnecting..." className="rounded-lg border border-rose-300 px-4 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-50">
              Disconnect
            </ActionSubmitButton>
          </ActionForm>
        )}
      </div>

      {status && (
        <ActionForm action={updateCalendarSwitches} resetOnSuccess={false} className="mt-6 border-t border-slate-200 pt-4">
          <h3 className="text-sm font-semibold text-slate-900">Pause without disconnecting</h3>
          <label className="mt-3 flex items-start gap-2 text-sm text-slate-800">
            <input name="planning_enabled" type="checkbox" defaultChecked={status.planningEnabled} className="mt-0.5" />
            <span>
              Use calendar events when planning
              <span className="block text-xs text-slate-500">When off, plans are made without reading Google Calendar and say that meetings are not included.</span>
            </span>
          </label>
          <label className="mt-3 flex items-start gap-2 text-sm text-slate-800">
            <input name="publishing_enabled" type="checkbox" defaultChecked={status.publishingEnabled} className="mt-0.5" />
            <span>
              Publish confirmed plans to my calendar
              <span className="block text-xs text-slate-500">When off, Confirm plan saves the plan without creating or changing any Google Calendar events.</span>
            </span>
          </label>
          <ActionSubmitButton pendingLabel="Saving..." className="mt-4 rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50">
            Save calendar settings
          </ActionSubmitButton>
        </ActionForm>
      )}
    </div>
  );
}
