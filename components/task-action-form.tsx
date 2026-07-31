"use client";

import { useState, useTransition } from "react";
import { updateTaskStatus } from "@/lib/tasks/actions";
import type { Task } from "@/lib/types";

type Mode = "idle" | "completing" | "skipping" | "deferring";

const BUTTON_CLASS =
  "rounded-lg border px-3 py-1 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60";

export function TaskActionForm({ task }: { task: Task }) {
  const [mode, setMode] = useState<Mode>("idle");
  const [minutes, setMinutes] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function reset() {
    setMode("idle");
    setMinutes("");
    setReason("");
    setError(null);
  }

  function submit(status: string, extra?: Record<string, string>) {
    setError(null);
    const formData = new FormData();
    formData.set("id", task.id);
    formData.set("status", status);
    if (extra) {
      for (const [key, value] of Object.entries(extra)) formData.set(key, value);
    }

    startTransition(async () => {
      try {
        await updateTaskStatus(formData);
        reset();
      } catch (submitError) {
        setError(submitError instanceof Error ? submitError.message : "Could not update the task.");
      }
    });
  }

  if (mode === "completing") {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-sm text-slate-700" htmlFor={`actual-minutes-${task.id}`}>
          Actual minutes
        </label>
        <input
          id={`actual-minutes-${task.id}`}
          type="number"
          min={0}
          step={1}
          value={minutes}
          onChange={(event) => setMinutes(event.target.value)}
          className="w-24 rounded-lg border border-slate-300 px-2 py-1 text-sm text-slate-900"
          placeholder="optional"
          autoFocus
        />
        <button
          type="button"
          disabled={isPending}
          onClick={() => submit("completed", minutes ? { actual_minutes: minutes } : undefined)}
          className={`${BUTTON_CLASS} border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100`}
        >
          {isPending ? "Saving…" : "Save"}
        </button>
        <button type="button" onClick={reset} className={`${BUTTON_CLASS} border-slate-300 text-slate-700 hover:bg-slate-100`}>
          Cancel
        </button>
        {error && <p className="w-full text-sm text-rose-600">{error}</p>}
      </div>
    );
  }

  if (mode === "skipping" || mode === "deferring") {
    const status = mode === "skipping" ? "skipped" : "deferred";
    const label = mode === "skipping" ? "Skip" : "Defer";
    return (
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-sm text-slate-700" htmlFor={`reason-${task.id}`}>
          Reason
        </label>
        <input
          id={`reason-${task.id}`}
          type="text"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          className="min-w-[10rem] flex-1 rounded-lg border border-slate-300 px-2 py-1 text-sm text-slate-900"
          placeholder={`Why ${label.toLowerCase()} this task?`}
          maxLength={500}
          autoFocus
        />
        <button
          type="button"
          disabled={isPending || !reason.trim()}
          onClick={() => submit(status, { reason: reason.trim() })}
          className={`${BUTTON_CLASS} border-slate-300 text-slate-700 hover:bg-slate-100`}
        >
          {isPending ? "Saving…" : `Save ${label.toLowerCase()}`}
        </button>
        <button type="button" onClick={reset} className={`${BUTTON_CLASS} border-slate-300 text-slate-700 hover:bg-slate-100`}>
          Cancel
        </button>
        {error && <p className="w-full text-sm text-rose-600">{error}</p>}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {task.status !== "completed" && (
        <button
          type="button"
          onClick={() => setMode("completing")}
          className={`${BUTTON_CLASS} border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100`}
        >
          Complete
        </button>
      )}
      {task.status !== "skipped" && task.status !== "completed" && (
        <button
          type="button"
          onClick={() => setMode("skipping")}
          className={`${BUTTON_CLASS} border-slate-300 text-slate-700 hover:bg-slate-100`}
        >
          Skip
        </button>
      )}
      {task.status !== "deferred" && task.status !== "completed" && (
        <button
          type="button"
          onClick={() => setMode("deferring")}
          className={`${BUTTON_CLASS} border-slate-300 text-slate-700 hover:bg-slate-100`}
        >
          Defer
        </button>
      )}
      {task.status === "completed" && (
        <button
          type="button"
          disabled={isPending}
          onClick={() => submit("todo")}
          className={`${BUTTON_CLASS} border-slate-300 text-slate-700 hover:bg-slate-100`}
        >
          {isPending ? "Saving…" : "Reopen"}
        </button>
      )}
      {error && <p className="w-full text-sm text-rose-600">{error}</p>}
    </div>
  );
}
