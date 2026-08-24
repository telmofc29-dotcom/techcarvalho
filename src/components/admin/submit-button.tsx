"use client";

import { useFormStatus } from "react-dom";

export function SubmitButton({
  children,
  pendingLabel,
  variant = "primary",
}: {
  children: React.ReactNode;
  pendingLabel?: string;
  // `secondary` exists for actions that are neither the main path nor
  // destructive — "Reject" and "Ignore for now" in the owner queue. Rendering
  // those in danger red would overstate them: rejecting a brief is a normal
  // editorial decision that deletes nothing, and colouring it like a delete
  // makes an owner hesitate over the one action that keeps the queue clear.
  variant?: "primary" | "secondary" | "danger";
}) {
  const { pending } = useFormStatus();

  const classes =
    variant === "danger"
      ? "bg-red-600 hover:bg-red-700 text-white"
      : variant === "secondary"
        ? "bg-white hover:bg-neutral-50 text-neutral-700 ring-1 ring-inset ring-neutral-300"
        : "bg-neutral-900 hover:bg-neutral-700 text-white";

  return (
    <button
      type="submit"
      disabled={pending}
      className={`rounded px-3 py-2 text-sm font-medium disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900 ${classes}`}
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
      className="rounded px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-700"
    >
      {pending ? "Deleting..." : label}
    </button>
  );
}
