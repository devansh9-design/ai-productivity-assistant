"use client";

import { FormEvent, useState, useTransition } from "react";
import { deleteAccount } from "@/lib/account/actions";
import { confirmsAccountEmail } from "@/lib/account/confirm";

export function DeleteAccountForm({ email }: { email: string }) {
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const matches = confirmsAccountEmail(typed, email);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    setError(null);
    startTransition(async () => {
      try {
        const result = await deleteAccount(formData);
        if ("error" in result) {
          setError(result.error);
          return;
        }
        // A full load, so no page of the deleted account stays in the client cache.
        window.location.assign("/login?notice=account_deleted");
      } catch {
        setError("Your account could not be deleted. Please try again.");
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="mt-4 space-y-3">
      <label className="block text-sm font-medium text-slate-800" htmlFor="confirm_email">
        Type <span className="font-semibold">{email}</span> to confirm
        <input id="confirm_email" name="confirm_email" type="email" autoComplete="off" className="input mt-1"
          value={typed} onChange={(event) => setTyped(event.target.value)} required />
      </label>
      {error && <p role="alert" className="rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p>}
      <button type="submit" disabled={!matches || isPending}
        className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-50">
        {isPending ? "Deleting…" : "Delete my account and data"}
      </button>
    </form>
  );
}
