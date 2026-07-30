const STATUS_STYLES: Record<string, string> = {
  active: "bg-emerald-50 text-emerald-700",
  todo: "bg-slate-100 text-slate-700",
  in_progress: "bg-indigo-50 text-indigo-700",
  completed: "bg-emerald-50 text-emerald-700",
  skipped: "bg-amber-50 text-amber-700",
  deferred: "bg-amber-50 text-amber-700",
  archived: "bg-slate-100 text-slate-500",
};

const PRIORITY_STYLES: Record<string, string> = {
  low: "bg-slate-100 text-slate-600",
  medium: "bg-indigo-50 text-indigo-700",
  high: "bg-amber-50 text-amber-800",
  urgent: "bg-rose-50 text-rose-700",
};

export function StatusBadge({ status }: { status: string }) {
  const style = STATUS_STYLES[status] ?? "bg-slate-100 text-slate-700";
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${style}`}>
      {status.replace("_", " ")}
    </span>
  );
}

export function PriorityBadge({ priority }: { priority: string }) {
  const style = PRIORITY_STYLES[priority] ?? "bg-slate-100 text-slate-700";
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${style}`}>
      {priority}
    </span>
  );
}

export function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center">
      <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
      <p className="mt-2 text-sm text-slate-600">{description}</p>
    </div>
  );
}
