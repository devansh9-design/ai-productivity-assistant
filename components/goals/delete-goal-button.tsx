"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteGoal } from "@/lib/goals/actions";

/** Deletes the goal after a confirmation, then returns to the Goals list (the goal's page no longer exists). */
export function DeleteGoalButton({ goalId, title }: { goalId: string; title: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function remove() {
    if (!window.confirm(`Delete "${title}" and its whole roadmap? This can't be undone.`)) return;
    setError(null);
    startTransition(async () => {
      const formData = new FormData();
      formData.set("id", goalId);
      const result = await deleteGoal(formData);
      if (result.error) { setError(result.error); return; }
      router.replace("/goals");
      router.refresh();
    });
  }

  return (
    <div className="mt-2">
      <button type="button" onClick={remove} disabled={pending}
        className="rounded-lg border border-rose-300 px-4 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-60">
        {pending ? "Deleting…" : "Delete goal"}
      </button>
      {error && <p role="alert" className="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
    </div>
  );
}
