"use client";

import { FormEvent, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { getSafeRedirectPath } from "@/lib/auth/redirect";

type Mode = "sign-in" | "sign-up";

export function AuthForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [mode, setMode] = useState<Mode>("sign-in");
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const destination = getSafeRedirectPath(searchParams.get("next"));

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    const formData = new FormData(event.currentTarget);
    const email = String(formData.get("email") ?? "").trim();
    const password = String(formData.get("password") ?? "");

    if (password.length < 8) {
      setMessage("Use a password with at least 8 characters.");
      return;
    }

    setIsSubmitting(true);
    const supabase = createClient();
    const result =
      mode === "sign-in"
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({
            email,
            password,
            options: { emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(destination)}` },
          });

    setIsSubmitting(false);
    if (result.error) {
      setMessage(result.error.message);
      return;
    }

    if (mode === "sign-up" && !result.data.session) {
      setMessage("Check your email to confirm your account, then sign in.");
      return;
    }

    router.replace(destination);
    router.refresh();
  }

  const isSignUp = mode === "sign-up";
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <section className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8" aria-labelledby="auth-heading">
        <p className="text-sm font-semibold text-indigo-600">Personal Assistant</p>
        <h1 id="auth-heading" className="mt-2 text-2xl font-bold tracking-tight text-slate-900">
          {isSignUp ? "Create your account" : "Welcome back"}
        </h1>
        <p className="mt-2 text-sm text-slate-600">
          {isSignUp ? "Start planning your work in one private place." : "Sign in to continue planning your day."}
        </p>

        <form className="mt-6 space-y-4" onSubmit={onSubmit}>
          <label className="block text-sm font-medium text-slate-800" htmlFor="email">
            Email
            <input className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900" id="email" name="email" type="email" autoComplete="email" required />
          </label>
          <label className="block text-sm font-medium text-slate-800" htmlFor="password">
            Password
            <input className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900" id="password" name="password" type="password" autoComplete={isSignUp ? "new-password" : "current-password"} minLength={8} required />
          </label>
          <p aria-live="polite" className={message ? "text-sm text-rose-700" : "sr-only"}>{message}</p>
          <button className="w-full rounded-lg bg-indigo-600 px-4 py-2 font-semibold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60" type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Please wait…" : isSignUp ? "Create account" : "Sign in"}
          </button>
        </form>

        <button className="mt-5 text-sm font-medium text-indigo-700 hover:text-indigo-900" type="button" onClick={() => { setMode(isSignUp ? "sign-in" : "sign-up"); setMessage(""); }}>
          {isSignUp ? "Already have an account? Sign in" : "New here? Create an account"}
        </button>
      </section>
    </main>
  );
}
