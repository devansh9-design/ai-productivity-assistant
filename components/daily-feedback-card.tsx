"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { applyFeedbackSuggestion, dismissFeedbackSuggestion, generateDailyFeedback } from "@/lib/feedback/actions";
import { ActionForm } from "@/components/action-form";
import { ActionSubmitButton } from "@/components/action-submit-button";
import type { SuggestionStatus } from "@/lib/feedback/daily";

export interface FeedbackCardData {
  source: "ai" | "fallback" | null;
  summary: string | null;
  /** Lines with numbers, written by the app from live data. */
  numbers: Array<{ heading: string | null; lines: string[] }>;
  suggestions: Array<{ id: string; description: string; reason: string; status: SuggestionStatus }>;
  needsFeedback: boolean;
}

const SMALL_BUTTON = "rounded-lg border px-3 py-1.5 text-sm font-semibold";

/**
 * The AI's short note on the day, the numbers behind it, and its proposals,
 * each applied or dismissed by the student. Writes the feedback by itself
 * once the evening log is saved, and again whenever the log changes.
 */
export function DailyFeedbackCard({ data }: { data: FeedbackCardData }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  function write() {
    setError(null);
    startTransition(async () => {
      try {
        // The action revalidates Today, so the new note arrives with its response.
        const result = await generateDailyFeedback();
        if (result && "error" in result && typeof result.error === "string") setError(result.error);
      } catch {
        setError("Feedback could not be written. Please try again.");
      }
    });
  }

  useEffect(() => {
    // Once the feedback is current again, a later save of the log may start another write.
    if (!data.needsFeedback) started.current = false;
    else if (!started.current) {
      started.current = true;
      write();
    }
  }, [data.needsFeedback]);

  if (!data.summary && !data.needsFeedback && !isPending) return null;

  return (
    <section aria-labelledby="feedback-title" className="mt-6 card p-5" aria-busy={isPending}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="feedback-title" className="text-lg font-semibold text-slate-900">Today&apos;s feedback</h2>
        {data.source && !isPending && (
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
            {data.source === "ai" ? "AI, checked against your numbers" : "Written from your numbers"}
          </span>
        )}
      </div>

      {isPending ? (
        <p role="status" className="mt-2 text-sm text-slate-600">Writing your feedback…</p>
      ) : (
        data.summary && <p className="mt-2 text-sm text-slate-800">{data.summary}</p>
      )}
      {error && <p role="alert" className="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}

      {data.numbers.length > 0 && (
        <div className="mt-4 rounded-lg bg-slate-50 p-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Your numbers</h3>
          {data.numbers.map((group, index) => (
            <div key={index} className="mt-2">
              {group.heading && <p className="text-sm font-medium text-slate-900">{group.heading}</p>}
              <ul className="text-sm text-slate-700">
                {group.lines.map((line) => <li key={line}>{line}</li>)}
              </ul>
            </div>
          ))}
        </div>
      )}

      {data.suggestions.length > 0 && (
        <div className="mt-4">
          <h3 className="text-sm font-semibold text-slate-900">Suggested changes</h3>
          <p className="text-xs text-slate-500">Nothing changes unless you apply it.</p>
          <ul className="mt-2 space-y-3">
            {data.suggestions.map((item) => (
              <li key={item.id} className="rounded-lg border border-slate-200 p-3">
                <p className="text-sm font-medium text-slate-900">{item.description}</p>
                <p className="mt-1 text-sm text-slate-600">{item.reason}</p>
                {item.status === "proposed" ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <ActionForm action={applyFeedbackSuggestion} resetOnSuccess={false}>
                      <input type="hidden" name="id" value={item.id} />
                      <ActionSubmitButton pendingLabel="Applying…" className={`${SMALL_BUTTON} border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100`}>Apply</ActionSubmitButton>
                    </ActionForm>
                    <ActionForm action={dismissFeedbackSuggestion} resetOnSuccess={false}>
                      <input type="hidden" name="id" value={item.id} />
                      <ActionSubmitButton pendingLabel="Dismissing…" className={`${SMALL_BUTTON} border-slate-300 text-slate-700 hover:bg-slate-50`}>Dismiss</ActionSubmitButton>
                    </ActionForm>
                  </div>
                ) : (
                  <p className={`mt-2 text-xs font-semibold ${item.status === "applied" ? "text-emerald-700" : "text-slate-500"}`}>
                    {item.status === "applied" ? "Applied ✓" : "Dismissed"}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {!isPending && data.summary && (
        <button type="button" onClick={write} className="mt-4 text-sm font-medium text-slate-600 underline hover:text-slate-900">
          Write the feedback again
        </button>
      )}
    </section>
  );
}
