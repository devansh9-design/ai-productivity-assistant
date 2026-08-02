"use client";

import { createContext, useContext, useState, useTransition, type FormEvent, type ReactNode } from "react";

const ActionFormPendingContext = createContext(false);

/** Read by ActionSubmitButton so it can disable itself while its ActionForm is submitting. */
export function useActionFormPending() {
  return useContext(ActionFormPendingContext);
}

interface ActionFormProps {
  action: (formData: FormData) => Promise<unknown>;
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
export function ActionForm({ action, children, className, resetOnSuccess = true }: ActionFormProps) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const form = event.currentTarget;
    const formData = new FormData(form);

    startTransition(async () => {
      try {
        await action(formData);
        if (resetOnSuccess) form.reset();
      } catch (submitError) {
        setError(submitError instanceof Error ? submitError.message : "Something went wrong. Please try again.");
      }
    });
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
      </form>
    </ActionFormPendingContext.Provider>
  );
}
