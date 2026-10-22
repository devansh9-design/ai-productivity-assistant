"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { Maximize2, Minimize2 } from "lucide-react";

/**
 * The month calendar beside Today. Expand opens it at full size over the
 * page; Minimize, Escape or a click outside returns it to the side column.
 */
export function TodayCalendar({ title, compact, full }: { title: string; compact: ReactNode; full: ReactNode }) {
  const [expanded, setExpanded] = useState(false);
  const expandButton = useRef<HTMLButtonElement>(null);
  const minimizeButton = useRef<HTMLButtonElement>(null);

  // Minimize, Escape and a click outside all close it the same way, returning focus to Expand.
  const minimize = useCallback(() => {
    setExpanded(false);
    requestAnimationFrame(() => expandButton.current?.focus());
  }, []);

  useEffect(() => {
    if (!expanded) return;
    minimizeButton.current?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") minimize(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [expanded, minimize]);

  return (
    <section aria-labelledby="today-calendar-title" className="card p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 id="today-calendar-title" className="text-sm font-semibold text-slate-900">
          <Link href="/month" className="hover:underline">{title}</Link>
        </h2>
        <button ref={expandButton} type="button" onClick={() => setExpanded(true)} aria-haspopup="dialog"
          className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50">
          <Maximize2 aria-hidden="true" className="h-3.5 w-3.5" />Expand
        </button>
      </div>
      <div className="mt-3">{compact}</div>

      {expanded && (
        <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-slate-950/40 p-4 sm:p-8" onClick={minimize}>
          <div role="dialog" aria-modal="true" aria-labelledby="today-calendar-full-title" onClick={(event) => event.stopPropagation()}
            className="w-full max-w-5xl rounded-2xl border border-slate-200 bg-white p-4 shadow-xl sm:p-6">
            <div className="flex items-center justify-between gap-2">
              <h2 id="today-calendar-full-title" className="text-lg font-semibold text-slate-900">{title}</h2>
              <button ref={minimizeButton} type="button" onClick={minimize}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">
                <Minimize2 aria-hidden="true" className="h-4 w-4" />Minimize
              </button>
            </div>
            <div className="mt-4">{full}</div>
          </div>
        </div>
      )}
    </section>
  );
}
