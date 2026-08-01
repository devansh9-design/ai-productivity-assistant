"use client";

import { useActionFormPending } from "@/components/action-form";

interface ActionSubmitButtonProps {
  children: React.ReactNode;
  pendingLabel?: string;
  className?: string;
}

export function ActionSubmitButton({ children, pendingLabel, className }: ActionSubmitButtonProps) {
  const isPending = useActionFormPending();

  return (
    <button
      type="submit"
      disabled={isPending}
      aria-disabled={isPending}
      aria-busy={isPending}
      className={`${className ?? ""} disabled:cursor-not-allowed disabled:opacity-60`}
    >
      {isPending ? pendingLabel ?? "Saving…" : children}
    </button>
  );
}
