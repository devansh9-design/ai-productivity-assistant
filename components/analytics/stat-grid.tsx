export interface Stat {
  label: string;
  value: string;
  detail: string;
}

export function StatGrid({ stats }: { stats: Stat[] }) {
  return (
    <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {stats.map((stat) => (
        <div key={stat.label} className="rounded-xl bg-slate-50 p-4">
          <dt className="text-sm font-medium text-slate-600">{stat.label}</dt>
          <dd className="mt-1 text-2xl font-bold text-slate-900">{stat.value}</dd>
          <dd className="mt-1 text-xs text-slate-500">{stat.detail}</dd>
        </div>
      ))}
    </dl>
  );
}
