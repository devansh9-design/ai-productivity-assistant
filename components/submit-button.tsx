"use client";

import { useFormStatus } from "react-dom";

interface SubmitButtonProps {
  children: React.ReactNode;
  pendingLabel?: string;
  className?: string;
}

/**
 * Wraps a Server Action's submit button so it disables itself the instant
 * the form starts submitting. This closes the common double-click /
 * double-tap path to duplicate rows (e.g. two goals created from one click)
 * without needing an idempotency key on every create action.
 *
 * Must be rendered inside the <form action={...}> it controls, since
 * useFormStatus reads the status of the nearest parent form.
 */
export function SubmitButton({ children, pendingLabel, className }: SubmitButtonProps) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      aria-disabled={pending}
      aria-busy={pending}
      className={`${className ?? ""} disabled:cursor-not-allowed disabled:opacity-60`}
    >
      {pending ? pendingLabel ?? "Saving…" : children}
    </button>
  );
}
