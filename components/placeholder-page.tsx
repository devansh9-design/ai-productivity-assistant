export function PlaceholderPage({ title, description, action }: { title: string; description: string; action: string }) {
  return (
    <section aria-labelledby="page-title" className="mx-auto max-w-4xl">
      <p className="text-sm font-semibold uppercase tracking-wide text-indigo-600">Personal workspace</p>
      <h1 id="page-title" className="mt-2 text-3xl font-bold tracking-tight text-slate-900">{title}</h1>
      <div className="mt-8 rounded-2xl border border-dashed border-slate-300 bg-white p-8 sm:p-12">
        <h2 className="text-xl font-semibold text-slate-900">Nothing here yet</h2>
        <p className="mt-2 max-w-lg text-slate-600">{description}</p>
        <button type="button" className="mt-6 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700">{action}</button>
      </div>
    </section>
  );
}
