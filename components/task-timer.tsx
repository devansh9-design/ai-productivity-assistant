"use client";

import { useEffect, useState, useTransition } from "react";
import { startTaskSession, stopTaskSession } from "@/lib/task-sessions/actions";
import type { TaskSession } from "@/lib/types";

function formatElapsed(startedAt: string, now: number): string {
  const elapsedMs = Math.max(0, now - new Date(startedAt).getTime());
  const totalMinutes = Math.floor(elapsedMs / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

export function TaskTimer({ taskId, activeSession }: { taskId: string; activeSession: TaskSession | null }) {
  const [session, setSession] = useState(activeSession);
  const [now, setNow] = useState(() => Date.now());
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (!session) return;
    const interval = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(interval);
  }, [session]);

  function handleStart() {
    setError(null);
    const formData = new FormData();
    formData.set("task_id", taskId);
    startTransition(async () => {
      try {
        const newSession = await startTaskSession(formData);
        setSession(newSession);
        setNow(Date.now());
      } catch (startError) {
        setError(startError instanceof Error ? startError.message : "Could not start the timer.");
      }
    });
  }

  function handleStop() {
    if (!session) return;
    setError(null);
    const formData = new FormData();
    formData.set("session_id", session.id);
    startTransition(async () => {
      try {
        await stopTaskSession(formData);
        setSession(null);
      } catch (stopError) {
        setError(stopError instanceof Error ? stopError.message : "Could not stop the timer.");
      }
    });
  }

  return (
    <div className="flex items-center gap-2">
      {session ? (
        <>
          <span className="text-xs font-medium text-indigo-700">Timer running · {formatElapsed(session.started_at, now)}</span>
          <button
            type="button"
            disabled={isPending}
            onClick={handleStop}
            className="rounded-lg border border-slate-300 px-2 py-0.5 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isPending ? "Stopping…" : "Stop timer"}
          </button>
        </>
      ) : (
        <button
          type="button"
          disabled={isPending}
          onClick={handleStart}
          className="rounded-lg border border-slate-300 px-2 py-0.5 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isPending ? "Starting…" : "Start timer"}
        </button>
      )}
      {error && <span className="text-xs text-rose-600">{error}</span>}
    </div>
  );
}
