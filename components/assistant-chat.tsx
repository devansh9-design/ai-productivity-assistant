"use client";

import { useState } from "react";

type Proposal = {
  proposal_type: string;
  summary: string;
  rationale: string;
  actions: Array<{
    type: string; task_id: string | null; title: string; start_time: string | null; end_time: string | null;
    estimated_minutes: number | null; due_date: string | null; priority: string | null; description: string | null;
  }>;
  warnings: string[];
  requires_confirmation: boolean;
};

export function AssistantChat() {
  const [message, setMessage] = useState("");
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [proposalId, setProposalId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  async function ask() {
    const value = message.trim();
    if (!value || busy) return;
    setBusy(true); setNotice(""); setProposal(null);
    try {
      const response = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: value }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Assistant request failed.");
      setProposal(body.proposal);
      setProposalId(body.proposal_id);
      setMessage("");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Assistant request failed.");
    } finally { setBusy(false); }
  }

  async function resolve(method: "PUT" | "DELETE") {
    if (!proposalId || busy) return;
    setBusy(true); setNotice("");
    try {
      const response = await fetch("/api/assistant", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proposal_id: proposalId }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not resolve proposal.");
      setNotice(method === "PUT" ? "Proposal confirmed." : "Proposal dismissed.");
      setProposal(null); setProposalId(null);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not resolve proposal.");
    } finally { setBusy(false); }
  }

  return (
    <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-5">
      <h2 className="text-lg font-semibold text-slate-900">AI planning assistant</h2>
      <p className="mt-1 text-sm text-slate-600">Ask about today, scheduling, rescheduling, or drafting a task. The assistant proposes changes; it never writes without confirmation.</p>
      <div className="mt-4 flex gap-2">
        <textarea value={message} onChange={(e) => setMessage(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void ask(); } }} maxLength={2000} rows={3} placeholder="I have two hours tonight. What should I work on?" className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900" />
        <button type="button" onClick={() => void ask()} disabled={busy || !message.trim()} className="self-end rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Thinking..." : "Ask"}</button>
      </div>

      {notice && <p role="status" className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">{notice}</p>}

      {proposal && (
        <div className="mt-5 rounded-xl border border-indigo-100 bg-indigo-50/40 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-indigo-700">{proposal.proposal_type.replaceAll("_", " ")}</p>
          <h3 className="mt-1 text-base font-semibold text-slate-900">{proposal.summary}</h3>
          <p className="mt-2 text-sm text-slate-700">{proposal.rationale}</p>
          {proposal.actions.length > 0 && (
            <div className="mt-3 space-y-2">
              {proposal.actions.map((action, index) => (
                <div key={index} className="rounded-lg border border-slate-200 bg-white p-3 text-sm">
                  <div className="font-medium text-slate-900">{action.title}</div>
                  <div className="mt-1 text-slate-600">
                    {action.start_time && action.end_time ? `${action.start_time}–${action.end_time}` : ""}
                    {action.estimated_minutes ? ` · ${action.estimated_minutes} min` : ""}
                    {action.priority ? ` · ${action.priority}` : ""}
                    {action.due_date ? ` · due ${action.due_date}` : ""}
                  </div>
                  {action.description && <p className="mt-1 text-xs text-slate-500">{action.description}</p>}
                </div>
              ))}
            </div>
          )}
          {proposal.warnings.length > 0 && <ul className="mt-3 list-disc pl-5 text-xs text-amber-700">{proposal.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>}
          {proposal.requires_confirmation && (
            <div className="mt-4 flex gap-2">
              <button type="button" onClick={() => void resolve("PUT")} disabled={busy} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Confirm proposal</button>
              <button type="button" onClick={() => void resolve("DELETE")} disabled={busy} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50">Dismiss</button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
