import type { ReactNode } from "react";

/** One dashboard section: a title, a plain-language note on how it is calculated, and its content. */
export function AnalyticsSection({ id, title, explanation, children }: { id: string; title: string; explanation: string; children: ReactNode }) {
  return (
    <section aria-labelledby={`${id}-title`} className="mt-6 card p-5">
      <h2 id={`${id}-title`} className="text-lg font-semibold text-slate-900">{title}</h2>
      <p className="mt-1 text-sm text-slate-600">{explanation}</p>
      <div className="mt-4">{children}</div>
    </section>
  );
}

export function EmptyNote({ children }: { children: ReactNode }) {
  return <p className="rounded-lg bg-slate-50 px-3 py-3 text-sm text-slate-600">{children}</p>;
}
