"use client";

import { createContext, useContext, useState, useTransition, type FormEvent, type ReactNode } from "react";

const ActionFormPendingContext = createContext(false);

/** Read by ActionSubmitButton so it can disable itself while its ActionForm is submitting. */
export function useActionFormPending() {
  return useContext(ActionFormPendingContext);
}

interface ActionFormProps {
  action: (formData: FormData) => Promise<{ error: string } | void | undefined | unknown>;
  children: ReactNode;
  className?: string;
  resetOnSuccess?: boolean;
}

/**
 * A Server Action thrown via `<form action={serverAction}>` (no client JS
 * in the loop) surfaces as Next.js's generic "server-side exception" crash
 * screen — that's what happened when a checkins length constraint was
 * violated. This component calls the same action from a submit handler
 * instead, so a thrown Error (validation failure, DB constraint violation,
 * anything) is caught and rendered as a normal inline message next to the
 * form, the same way TaskActionForm and TaskTimer already handle their
 * own actions.
 */
/**
 * An action may return { error, retryWith } to offer one explicit second try,
 * such as "Plan without my calendar": the warning is shown with a button that
 * resends the same form with `field` set to "1". Nothing is retried unless the
 * user presses it.
 */
interface RetryOffer { field: string; label: string; warning: string }

function retryOffer(result: unknown): RetryOffer | null {
  const offer = (result as { retryWith?: Partial<RetryOffer> } | undefined)?.retryWith;
  return offer && typeof offer.field === "string" && typeof offer.label === "string" && typeof offer.warning === "string"
    ? { field: offer.field, label: offer.label, warning: offer.warning }
    : null;
}

export function ActionForm({ action, children, className, resetOnSuccess = true }: ActionFormProps) {
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [retry, setRetry] = useState<{ offer: RetryOffer; formData: FormData; form: HTMLFormElement } | null>(null);
  const [isPending, startTransition] = useTransition();

  function run(form: HTMLFormElement, formData: FormData) {
    setError(null);
    setNotice(null);
    setRetry(null);
    startTransition(async () => {
      try {
        const result = await action(formData) as { error?: string; message?: string } | undefined;
        if (result && typeof result === "object" && "error" in result && typeof result.error === "string") {
          setError(result.error);
          const offer = retryOffer(result);
          if (offer) setRetry({ offer, formData, form });
        } else {
          // An action may return { message } to confirm what it did.
          if (result && typeof result === "object" && typeof result.message === "string") setNotice(result.message);
          if (resetOnSuccess) form.reset();
        }
      } catch (submitError) {
        setError(submitError instanceof Error ? submitError.message : "Something went wrong. Please try again.");
      }
    });
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    run(form, new FormData(form));
  }

  function acceptRetry() {
    if (!retry) return;
    const formData = new FormData();
    for (const [key, value] of retry.formData.entries()) formData.append(key, value);
    formData.set(retry.offer.field, "1");
    run(retry.form, formData);
  }

  return (
    <ActionFormPendingContext.Provider value={isPending}>
      <form onSubmit={handleSubmit} className={className}>
        {children}
        {error && (
          <p role="alert" className="mt-3 rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </p>
        )}
        {retry && (
          <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <p>{retry.offer.warning}</p>
            <button type="button" onClick={acceptRetry} disabled={isPending}
              className="mt-2 rounded-lg border border-amber-300 bg-white px-3 py-1.5 font-semibold text-amber-900 hover:bg-amber-100 disabled:opacity-60">
              {retry.offer.label}
            </button>
          </div>
        )}
        {notice && (
          <p role="status" className="mt-3 rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            {notice}
          </p>
        )}
      </form>
    </ActionFormPendingContext.Provider>
  );
}
