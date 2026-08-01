import { EmptyState } from "@/components/status-badge";
import type { Checkin, JournalEntry } from "@/lib/types";

const MOOD_LABELS: Record<number, string> = { 1: "😞", 2: "🙁", 3: "😐", 4: "🙂", 5: "😄" };

export function RecentReflections({
  entries,
  checkinsByDate,
}: {
  entries: JournalEntry[];
  checkinsByDate: Map<string, Checkin>;
}) {
  return (
    <div className="mt-8">
      <h2 className="text-lg font-semibold text-slate-900">Recent reflections</h2>
      {entries.length === 0 ? (
        <div className="mt-4">
          <EmptyState
            title="No reflections yet"
            description="Save an evening check-in above and it will show up here."
          />
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          {entries.map((entry) => {
            const checkin = checkinsByDate.get(entry.entry_date);
            return (
              <article key={entry.id} className="rounded-2xl border border-slate-200 bg-white p-5">
                <div className="flex flex-wrap items-center gap-2 text-sm font-medium text-slate-700">
                  <span>{entry.entry_date}</span>
                  {checkin?.mood && <span aria-label={`Mood ${checkin.mood} of 5`}>{MOOD_LABELS[checkin.mood]}</span>}
                  {checkin?.energy_level && (
                    <span className="text-xs font-medium text-slate-500">{checkin.energy_level} energy</span>
                  )}
                </div>
                <p className="mt-2 text-sm text-slate-700">{entry.reflection}</p>
                {checkin?.wins && (
                  <p className="mt-2 text-xs text-slate-500">
                    <span className="font-medium text-slate-600">Wins:</span> {checkin.wins}
                  </p>
                )}
                {checkin?.lesson && (
                  <p className="mt-1 text-xs text-slate-500">
                    <span className="font-medium text-slate-600">Lesson:</span> {checkin.lesson}
                  </p>
                )}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
