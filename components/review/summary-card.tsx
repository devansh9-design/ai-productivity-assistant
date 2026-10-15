import { ActionForm } from "@/components/action-form";
import { ActionSubmitButton } from "@/components/action-submit-button";
import { EmptyNote } from "@/components/analytics/section";
import type { WeekFacts } from "@/lib/review/facts";
import type { SavedReview } from "@/lib/review/load";
import { generateWeeklySummary } from "@/lib/review/actions";

const BUTTON = "rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700";

export function SummaryCard({ week, saved, facts, generatedLabel }: { week: string; saved: SavedReview | null; facts: WeekFacts; generatedLabel: string | null }) {
  return (
    <div>
      {saved ? (
        <div className="space-y-4">
          <p className="text-lg font-semibold text-slate-900">{saved.headline}</p>

          {saved.highlights.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Highlights</h3>
              <ul className="mt-2 space-y-1.5">
                {saved.highlights.map((item) => (
                  <li key={item.taskId} className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-slate-700">
                    <span className="font-medium text-slate-900">{item.title}</span>
                    {item.note && <span className="text-slate-600"> · {item.note}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {saved.observations.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Observations</h3>
              <ul className="mt-2 space-y-1.5">
                {saved.observations.map((item) => {
                  // The number always comes from today's facts, never from the summary text.
                  const metric = facts.metrics[item.metric];
                  return (
                    <li key={item.metric} className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">
                      {metric && <span className="font-medium text-slate-900">{metric.label}: {metric.value}. </span>}
                      {item.note}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {saved.suggestion && <p className="text-sm text-slate-700"><span className="font-medium text-slate-900">For next week:</span> {saved.suggestion}</p>}

          <p className="text-xs text-slate-500">
            {saved.source === "ai" ? "Written by AI and checked against your data" : `Written by the app from your numbers. ${saved.fallbackReason ?? ""}`}
            {generatedLabel && ` · ${generatedLabel}`}
          </p>
        </div>
      ) : (
        <EmptyNote>
          {facts.isEmpty
            ? "There is nothing to summarize for this week. Generating will save a short note without calling the AI."
            : "No summary yet. Generating one sends this week's numbers, task titles, and check-ins to the AI, then checks every reference before saving."}
        </EmptyNote>
      )}

      <ActionForm action={generateWeeklySummary} resetOnSuccess={false} className="mt-4">
        <input type="hidden" name="week" value={week} />
        <ActionSubmitButton pendingLabel="Generating..." className={BUTTON}>{saved ? "Regenerate summary" : "Generate summary"}</ActionSubmitButton>
      </ActionForm>
    </div>
  );
}
