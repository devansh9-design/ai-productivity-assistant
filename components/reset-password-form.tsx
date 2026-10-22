"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export function ResetPasswordForm() {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    const formData = new FormData(event.currentTarget);
    const password = String(formData.get("password") ?? "");
    if (password.length < 8) {
      setMessage("Use a password with at least 8 characters.");
      return;
    }
    if (password !== String(formData.get("confirm") ?? "")) {
      setMessage("The two passwords don't match.");
      return;
    }

    setIsSubmitting(true);
    const { error } = await createClient().auth.updateUser({ password });
    setIsSubmitting(false);
    if (error) {
      setMessage(error.code === "same_password" ? "Choose a password different from your old one." : error.message);
      return;
    }
    router.replace("/today");
    router.refresh();
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <section className="w-full max-w-md card p-6 shadow-sm sm:p-8" aria-labelledby="reset-heading">
        <p className="text-sm font-semibold text-indigo-600">Personal Assistant</p>
        <h1 id="reset-heading" className="mt-2 text-2xl font-bold tracking-tight text-slate-900">Choose a new password</h1>
        <p className="mt-2 text-sm text-slate-600">You&apos;ll stay signed in on this device.</p>

        <form className="mt-6 space-y-4" onSubmit={onSubmit}>
          <label className="block text-sm font-medium text-slate-800" htmlFor="password">
            New password
            <input className="input mt-1" id="password" name="password" type="password" autoComplete="new-password" minLength={8} required />
          </label>
          <label className="block text-sm font-medium text-slate-800" htmlFor="confirm">
            Type it again
            <input className="input mt-1" id="confirm" name="confirm" type="password" autoComplete="new-password" minLength={8} required />
          </label>
          <p aria-live="polite" className={message ? "text-sm text-rose-700" : "sr-only"}>{message}</p>
          <button className="w-full rounded-lg bg-indigo-600 px-4 py-2 font-semibold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60" type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Saving…" : "Save new password"}
          </button>
        </form>
      </section>
    </main>
  );
}
