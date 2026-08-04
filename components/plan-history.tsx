"use client";

import { useState } from "react";
import type { DailyPlan, PlanBlock } from "@/lib/types";

function shortTime(value: string) {
  return value.slice(0, 5);
}

interface PlanHistoryEntry {
  plan: DailyPlan;
  blocks: PlanBlock[];
}

interface PlanHistoryProps {
  entries: PlanHistoryEntry[];
}

export function PlanHistory({ entries }: PlanHistoryProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (entries.length === 0) return null;

  return (
    <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-5">
      <h2 className="text-lg font-semibold text-slate-900">Plan history</h2>
      <p className="mt-1 text-sm text-slate-600">
        Older versions of today&apos;s plan.
      </p>
      <div className="mt-4 space-y-2">
        {entries.map(({ plan, blocks }) => {
          const isExpanded = expandedId === plan.id;
          const statusLabel =
            plan.status === "superseded" ? "Superseded" : "Completed";
          return (
            <div key={plan.id} className="rounded-lg border border-slate-200">
              <button
                type="button"
                onClick={() => setExpandedId(isExpanded ? null : plan.id)}
                className="flex w-full items-center justify-between px-3 py-2 text-left text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                <span>
                  v{plan.version} &mdash; {statusLabel} &mdash;{" "}
                  {new Date(plan.generated_at).toLocaleTimeString()}
                </span>
                <span className="text-xs text-slate-400">
                  {isExpanded ? "\u25B2" : "\u25BC"}
                </span>
              </button>
              {isExpanded && (
                <div className="space-y-1 border-t border-slate-100 px-3 py-2">
                  {blocks.length === 0 && (
                    <p className="text-sm text-slate-500">No blocks.</p>
                  )}
                  {blocks.map((block) => (
                    <div
                      key={block.id}
                      className={`rounded px-2 py-1 text-xs ${
                        block.kind === "buffer"
                          ? "bg-amber-50 text-amber-700"
                          : "bg-indigo-50 text-indigo-700"
                      }`}
                    >
                      <span className="font-semibold">
                        {shortTime(block.start_time)}-
                        {shortTime(block.end_time)}
                      </span>{" "}
                      {block.kind === "buffer" ? "Buffer" : block.title}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
