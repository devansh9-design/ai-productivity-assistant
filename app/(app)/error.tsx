"use client";

import Link from "next/link";

/**
 * Shown when a page in the signed-in app fails to render. The server has
 * already logged the error (instrumentation.ts) with the same reference, so
 * it can be found in Vercel's runtime logs. No data was changed by the
 * failure itself; Try again re-renders the page.
 */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div role="alert" className="mx-auto max-w-xl rounded-2xl border border-rose-200 bg-white p-6">
      <h1 className="text-lg font-semibold text-slate-900">This page couldn&apos;t load</h1>
      <p className="mt-2 text-sm text-slate-600">
        Something went wrong while loading it. Your saved data is unaffected. Try again, or go back to Today.
      </p>
      {error.digest && <p className="mt-3 text-xs text-slate-500">Reference: <code>{error.digest}</code></p>}
      <div className="mt-5 flex flex-wrap gap-3">
        <button type="button" onClick={reset}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700">
          Try again
        </button>
        <Link href="/today" className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50">
          Go to Today
        </Link>
      </div>
    </div>
  );
}
