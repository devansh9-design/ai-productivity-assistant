import type { Insight } from "@/lib/preferences/insights";

export function InsightsCard({ insights, durationFactor }: { insights: Insight[]; durationFactor: number }) {
  return (
    <section aria-labelledby="insights-title" className="mt-6 card p-5">
      <h2 id="insights-title" className="text-lg font-semibold text-slate-900">Patterns from your history</h2>
      {insights.length === 0 ? (
        <p className="mt-2 text-sm text-slate-600">
          Insights appear once there is enough history: complete a few tasks with actual minutes recorded, or track time with the task timer.
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {insights.map((insight) => (
            <li key={insight.id} className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">{insight.text}</li>
          ))}
        </ul>
      )}
      {durationFactor !== 1 && (
        <p className="mt-3 text-xs text-slate-500">
          New plans scale task estimates by x{durationFactor.toFixed(2)} to match your actual durations. You can turn this off in Settings.
        </p>
      )}
    </section>
  );
}
