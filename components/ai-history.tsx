"use client";

import { useCallback, useEffect, useState } from "react";
import type { PlanningProposal } from "@/lib/ai/proposal";

type HistoryItem = {
  id: string;
  message: string;
  proposal: PlanningProposal;
  proposal_type: string;
  validation_ok: boolean;
  confirmed: boolean;
  confirmed_plan_id: string | null;
  created_at: string;
};

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit",
  }).format(date);
}

function statusLabel(item: HistoryItem) {
  if (item.confirmed) return "Confirmed";
  if (!item.validation_ok) return "Invalid";
  return "Not confirmed";
}

export function AIHistory() {
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadHistory = useCallback(async () => {
    try {
      setError("");
      const response = await fetch("/api/ai/history", { cache: "no-store" });
      const data = (await response.json()) as { ok?: boolean; conversations?: HistoryItem[]; error?: string };
      if (!response.ok || !data.ok) throw new Error(data.error || "Unable to load AI history.");
      setItems(data.conversations ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load AI history.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadHistory();
    const refresh = () => void loadHistory();
    window.addEventListener("ai-history-updated", refresh);
    return () => window.removeEventListener("ai-history-updated", refresh);
  }, [loadHistory]);

  return (
    <section aria-labelledby="ai-history-title" className="mt-6 rounded-2xl border border-slate-200 bg-white p-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wide text-indigo-600">AI history</p>
          <h2 id="ai-history-title" className="mt-1 text-xl font-bold text-slate-900">Previous planning requests</h2>
          <p className="mt-1 text-sm text-slate-600">Your recent AI proposals and whether they were confirmed.</p>
        </div>
        <button type="button" onClick={() => { setLoading(true); void loadHistory(); }}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
          Refresh
        </button>
      </div>

      {loading ? <p className="mt-4 text-sm text-slate-500">Loading history...</p>
      : error ? <p role="alert" className="mt-4 rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p>
      : items.length === 0 ? (
        <div className="mt-4 rounded-xl border border-dashed border-slate-300 px-4 py-8 text-center">
          <p className="font-medium text-slate-700">No AI planning history yet.</p>
          <p className="mt-1 text-sm text-slate-500">Generate a proposal above and it will appear here.</p>
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          {items.map((item) => (
            <article key={item.id} className="rounded-xl border border-slate-200 bg-slate-50/60 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-slate-900">{item.message}</p>
                  <p className="mt-1 text-xs text-slate-500">{formatDate(item.created_at)}</p>
                </div>
                <span className={item.confirmed
                  ? "rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700"
                  : "rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-700"}>
                  {statusLabel(item)}
                </span>
              </div>
              <div className="mt-3 rounded-lg border border-slate-200 bg-white p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-indigo-600">{item.proposal_type}</p>
                <p className="mt-1 font-medium text-slate-900">{item.proposal?.summary ?? "Proposal"}</p>
                <p className="mt-1 text-sm text-slate-600">{item.proposal?.reason ?? ""}</p>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
