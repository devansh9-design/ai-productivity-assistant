"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { getSafeRedirectPath } from "@/lib/auth/redirect";

type Mode = "sign-in" | "sign-up" | "forgot";
type Notice = { tone: "error" | "info"; text: string } | null;

/** Messages for the ?error= and ?notice= values other pages send here. */
const ARRIVAL_NOTICES: Record<string, Notice> = {
  confirmation_failed: { tone: "error", text: "That email link has expired or was already used. Sign in, or create your account again to get a new link." },
  reset_failed: { tone: "error", text: "That reset link has expired or was already used. Ask for a new one below." },
  account_deleted: { tone: "info", text: "Your account and all of its data were deleted." },
};

const HEADINGS: Record<Mode, { title: string; lead: string; submit: string }> = {
  "sign-in": { title: "Welcome back", lead: "Sign in to continue planning your day.", submit: "Sign in" },
  "sign-up": { title: "Create your account", lead: "Start planning your work in one private place.", submit: "Create account" },
  forgot: { title: "Reset your password", lead: "We'll email you a link to choose a new password.", submit: "Send reset link" },
};

export function AuthForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [mode, setMode] = useState<Mode>("sign-in");
  const [notice, setNotice] = useState<Notice>(
    () => ARRIVAL_NOTICES[searchParams.get("error") ?? searchParams.get("notice") ?? ""] ?? null,
  );
  // Set when an email still needs confirming, so it can be sent again.
  const [unconfirmedEmail, setUnconfirmedEmail] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const destination = getSafeRedirectPath(searchParams.get("next"));
  const callbackUrl = (next: string) => `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;

  function switchMode(next: Mode) {
    setMode(next);
    setNotice(null);
    setUnconfirmedEmail("");
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice(null);
    setUnconfirmedEmail("");
    const formData = new FormData(event.currentTarget);
    const email = String(formData.get("email") ?? "").trim();
    const password = String(formData.get("password") ?? "");
    const supabase = createClient();

    if (mode === "forgot") {
      setIsSubmitting(true);
      const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: callbackUrl("/reset-password") });
      setIsSubmitting(false);
      // The same answer whether or not the account exists, so emails can't be probed.
      setNotice(error?.status === 429
        ? { tone: "error", text: "Too many emails were sent just now. Wait a few minutes and try again." }
        : { tone: "info", text: "If that email has an account, a reset link is on its way. It works once." });
      return;
    }

    if (password.length < 8) {
      setNotice({ tone: "error", text: "Use a password with at least 8 characters." });
      return;
    }

    setIsSubmitting(true);
    const result =
      mode === "sign-in"
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password, options: { emailRedirectTo: callbackUrl(destination) } });
    setIsSubmitting(false);

    if (result.error) {
      if (result.error.code === "email_not_confirmed") {
        setUnconfirmedEmail(email);
        setNotice({ tone: "error", text: "Confirm your email first: open the link we sent you." });
      } else {
        setNotice({ tone: "error", text: result.error.message });
      }
      return;
    }

    if (mode === "sign-up" && !result.data.session) {
      setUnconfirmedEmail(email);
      setNotice({ tone: "info", text: "Check your email to confirm your account, then sign in." });
      return;
    }

    router.replace(destination);
    router.refresh();
  }

  async function resendConfirmation() {
    setIsSubmitting(true);
    const { error } = await createClient().auth.resend({
      type: "signup", email: unconfirmedEmail, options: { emailRedirectTo: callbackUrl(destination) },
    });
    setIsSubmitting(false);
    setNotice(error
      ? { tone: "error", text: error.status === 429 ? "An email was sent just now. Wait a minute and try again." : error.message }
      : { tone: "info", text: `A new confirmation link was sent to ${unconfirmedEmail}.` });
  }

  const heading = HEADINGS[mode];
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <section className="w-full max-w-md card p-6 shadow-sm sm:p-8" aria-labelledby="auth-heading">
        <p className="text-sm font-semibold text-indigo-600">Personal Assistant</p>
        <h1 id="auth-heading" className="mt-2 text-2xl font-bold tracking-tight text-slate-900">{heading.title}</h1>
        <p className="mt-2 text-sm text-slate-600">{heading.lead}</p>

        <form className="mt-6 space-y-4" onSubmit={onSubmit}>
          <label className="block text-sm font-medium text-slate-800" htmlFor="email">
            Email
            <input className="input mt-1" id="email" name="email" type="email" autoComplete="email" required />
          </label>
          {mode !== "forgot" && (
            <label className="block text-sm font-medium text-slate-800" htmlFor="password">
              <span className="flex items-baseline justify-between">
                Password
                {mode === "sign-in" && (
                  <button type="button" className="text-xs font-medium text-indigo-700 hover:text-indigo-900" onClick={() => switchMode("forgot")}>
                    Forgot password?
                  </button>
                )}
              </span>
              <input className="input mt-1" id="password" name="password" type="password" autoComplete={mode === "sign-up" ? "new-password" : "current-password"} minLength={8} required />
            </label>
          )}
          <p aria-live="polite" className={notice ? `text-sm ${notice.tone === "error" ? "text-rose-700" : "text-emerald-700"}` : "sr-only"}>{notice?.text}</p>
          {unconfirmedEmail && (
            <button type="button" onClick={resendConfirmation} disabled={isSubmitting}
              className="text-sm font-medium text-indigo-700 hover:text-indigo-900 disabled:opacity-60">
              Resend the confirmation email
            </button>
          )}
          <button className="w-full rounded-lg bg-indigo-600 px-4 py-2 font-semibold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60" type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Please wait…" : heading.submit}
          </button>
        </form>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 text-sm">
          <button className="font-medium text-indigo-700 hover:text-indigo-900" type="button"
            onClick={() => switchMode(mode === "sign-in" ? "sign-up" : "sign-in")}>
            {mode === "sign-in" ? "New here? Create an account" : "Back to sign in"}
          </button>
          <Link href="/privacy" className="text-slate-500 hover:text-slate-800">Privacy</Link>
        </div>
      </section>
    </main>
  );
}
