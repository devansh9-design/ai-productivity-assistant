/** Shown while a signed-in page loads its data on the server. */
export default function AppLoading() {
  return (
    <div role="status" aria-live="polite" className="mx-auto max-w-4xl animate-pulse">
      <span className="sr-only">Loading…</span>
      <div className="h-4 w-40 rounded bg-slate-200" />
      <div className="mt-3 h-8 w-64 rounded bg-slate-200" />
      <div className="mt-8 space-y-4">
        <div className="h-32 card" />
        <div className="h-48 card" />
      </div>
    </div>
  );
}
