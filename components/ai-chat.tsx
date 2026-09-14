"use client";

import { FormEvent, useState } from "react";
import type { PlanningProposal } from "@/lib/ai/proposal";
import { confirmAIProposal } from "@/lib/plans/actions";

function formatProposalTime(value: string, timezone?: string): string {
  if (!value) return "";
  const shortTime = /^(\\d{1,2}):(\\d{2})(?::\\d{2})?$/.exec(value);
  if (shortTime) {
    const hours = Number(shortTime[1]);
    const minutes = Number(shortTime[2]);
    const suffix = hours >= 12 ? "PM" : "AM";
    const displayHours = hours % 12 || 12;
    return `${displayHours}:${String(minutes).padStart(2, "0")} ${suffix}`;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: timezone,
  }).format(date);
}

function formatProposalRange(start: string, end: string, timezone?: string): string {
  const startDate = new Date(start);
  const endDate = new Date(end);

  if (!Number.isNaN(startDate.getTime()) && !Number.isNaN(endDate.getTime())) {
    const dateFormatter = new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      timeZone: timezone,
    });
    const timeFormatter = new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "2-digit",
      timeZone: timezone,
    });

    const startDateLabel = dateFormatter.format(startDate);
    const endDateLabel = dateFormatter.format(endDate);
    const startTimeLabel = timeFormatter.format(startDate);
    const endTimeLabel = timeFormatter.format(endDate);

    return startDateLabel === endDateLabel
      ? `${startTimeLabel} – ${endTimeLabel}`
      : `${startDateLabel}, ${startTimeLabel} – ${endDateLabel}, ${endTimeLabel}`;
  }

  return `${formatProposalTime(start, timezone)} – ${formatProposalTime(end, timezone)}`;
}

type ChatResponse = {
  ok?: boolean;
  proposal?: PlanningProposal;
  requires_confirmation?: boolean;
  context?: { date: string; timezone: string; calendar_connected: boolean };
  error?: string;
  conversation_id?: string;
};

export function AIChat() {
  const [message, setMessage] = useState("");
  const [proposal, setProposal] = useState<PlanningProposal | null>(null);
  const [meta, setMeta] = useState<ChatResponse["context"]>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [success, setSuccess] = useState("");
  const [conversationId, setConversationId] = useState<string | undefined>();

  async function submit(event: FormEvent) {
    event.preventDefault();
    const value = message.trim();
    if (!value || loading) return;

    setLoading(true);
    setError("");
    setSuccess("");
    setProposal(null);
    setConversationId(undefined);

    try {
      const response = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: value }),
      });
      const data = (await response.json()) as ChatResponse;
      if (!response.ok || !data.ok || !data.proposal) {
        throw new Error(data.error || "Unable to create a proposal.");
      }
      setProposal(data.proposal);
      setMeta(data.context);
      setConversationId(data.conversation_id);
      setMessage("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to create a proposal.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section aria-labelledby="ai-chat-title" className="mt-8 rounded-2xl border border-slate-200 bg-white p-5">
      <div>
        <p className="text-sm font-semibold uppercase tracking-wide text-indigo-600">AI planning</p>
        <h2 id="ai-chat-title" className="mt-1 text-xl font-bold text-slate-900">Ask your productivity assistant</h2>
        <p className="mt-1 text-sm text-slate-600">
          Ask for scheduling help in natural language. The assistant proposes changes; nothing is written without confirmation.
        </p>
      </div>

      <form onSubmit={submit} className="mt-4">
        <label htmlFor="ai-message" className="sr-only">Message</label>
        <textarea
          id="ai-message"
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          maxLength={4000}
          rows={4}
          placeholder="I have two hours tonight. What should I work on?"
          className="w-full resize-y rounded-xl border border-slate-300 px-4 py-3 text-sm text-slate-900 shadow-sm focus:border-indigo-500 focus:outline-none"
        />
        <div className="mt-3 flex items-center justify-between gap-3">
          <span className="text-xs text-slate-500">{message.length}/4000</span>
          <button
            type="submit"
            disabled={loading || !message.trim()}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? "Thinking..." : "Get proposal"}
          </button>
        </div>
      </form>

      {error && <p role="alert" className="mt-4 rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p>}

      {success && (
        <p role="status" className="mt-4 rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          {success}
        </p>
      )}

      {proposal && (
        <div className="mt-6 rounded-xl border border-indigo-100 bg-indigo-50/40 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-indigo-700">Proposal preview</p>
              <h3 className="mt-1 font-semibold text-slate-900">{proposal.summary}</h3>
              <p className="mt-1 text-sm text-slate-700">{proposal.reason}</p>
            </div>
            <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-600">{proposal.type}</span>
          </div>

          {proposal.items.length > 0 && (
            <div className="mt-4 space-y-2">
              {proposal.items.map((item, index) => (
                <div key={item.task_id ?? item.title ?? index} className="rounded-lg border border-slate-200 bg-white p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-medium text-slate-900">{item.title || item.task_id || "Proposed item"}</p>
                    {item.start_time && item.end_time && (
                      <span className="text-xs font-medium text-slate-500">{formatProposalRange(item.start_time, item.end_time, meta?.timezone)}</span>
                    )}
                  </div>
                  <p className="mt-1 text-sm text-slate-600">{item.reason}</p>
                </div>
              ))}
            </div>
          )}

          {proposal.type === "suggest_schedule" || proposal.type === "propose_reschedule" ? (
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button
                type="button"
                disabled={confirming}
                onClick={async () => {
                  setConfirming(true);
                  setError("");
                  setSuccess("");
                  try {
                    const result = await confirmAIProposal(proposal, conversationId);
                    setSuccess(result.message);
                    setProposal(null);
                  } catch (err) {
                    setError(err instanceof Error ? err.message : "Unable to confirm the proposal.");
                  } finally {
                    setConfirming(false);
                  }
                }}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {confirming ? "Confirming..." : "Confirm schedule"}
              </button>
              <span className="text-xs text-slate-500">Review the times above before confirming.</span>
            </div>
          ) : null}

          <div className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
            {proposal.type === "suggest_schedule" || proposal.type === "propose_reschedule"
              ? "Preview only. No task or calendar changes have been made until you confirm."
              : "Informational proposal only. No task or calendar changes have been made."}
          </div>

          {meta && (
            <p className="mt-2 text-xs text-slate-500">
              Context: {meta.date} · {meta.timezone} · Calendar {meta.calendar_connected ? "connected" : "unavailable"}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
