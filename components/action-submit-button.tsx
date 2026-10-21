"use client";

import { useActionFormPending } from "@/components/action-form";

interface ActionSubmitButtonProps {
  children: React.ReactNode;
  pendingLabel?: string;
  className?: string;
  /** Needed when the button shows only an icon. */
  "aria-label"?: string;
}

export function ActionSubmitButton({ children, pendingLabel, className, "aria-label": ariaLabel }: ActionSubmitButtonProps) {
  const isPending = useActionFormPending();

  return (
    <button
      type="submit"
      disabled={isPending}
      aria-disabled={isPending}
      aria-busy={isPending}
      aria-label={ariaLabel}
      className={`${className ?? ""} disabled:cursor-not-allowed disabled:opacity-60`}
    >
      {isPending ? pendingLabel ?? "Saving…" : children}
    </button>
  );
}
