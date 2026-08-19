"use client";

import { useFormStatus } from "react-dom";

export function SubmitButton({
  children,
  pendingLabel,
  variant = "primary",
}: {
  children: React.ReactNode;
  pendingLabel?: string;
  variant?: "primary" | "danger";
}) {
  const { pending } = useFormStatus();

  const classes =
    variant === "danger"
      ? "bg-red-600 hover:bg-red-700 text-white"
      : "bg-neutral-900 hover:bg-neutral-700 text-white";

  return (
    <button
      type="submit"
      disabled={pending}
      className={`rounded px-3 py-2 text-sm font-medium disabled:opacity-50 ${classes}`}
    >
      {pending ? (pendingLabel ?? "Saving...") : children}
    </button>
  );
}

export function ConfirmDeleteButton({
  confirmMessage,
  label = "Delete",
}: {
  confirmMessage: string;
  label?: string;
}) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      onClick={(e) => {
        if (!window.confirm(confirmMessage)) {
          e.preventDefault();
        }
      }}
      className="rounded px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
    >
      {pending ? "Deleting..." : label}
    </button>
  );
}
