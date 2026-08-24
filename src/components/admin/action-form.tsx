"use client";

import { useActionState, type ReactNode } from "react";
import { SubmitButton } from "./submit-button";
import type { FormState } from "./reference-form";

// A plain <form> whose Server Action can REPORT a failure instead of throwing.
//
// WHY
// ---
// A Server Action wired directly to <form action={...}> has nowhere to put an
// error. If it throws — a failed query, a rejected constraint — the throw
// escapes to the nearest error boundary, and in a production build React
// replaces the message with a masked #441. That is how "associate this asset
// with a product and press Save" turned into a red box with no explanation:
// the database refused the write for a good reason and the reason was
// unreachable.
//
// useActionState gives the action a return channel. Everything that used to
// throw now returns { error }, and it renders here, above the form, where the
// person who pressed the button is looking.
//
// Deliberately thin: same shape and FormState contract as ReferenceForm, so the
// bespoke media forms behave like the generic reference ones without being
// forced into that component's field config.
export function ActionForm({
  action,
  submitLabel,
  pendingLabel = "Saving...",
  children,
  className = "flex flex-col gap-4",
}: {
  action: (prevState: FormState, formData: FormData) => Promise<FormState>;
  submitLabel: string;
  pendingLabel?: string;
  children: ReactNode;
  className?: string;
}) {
  const [state, formAction] = useActionState(action, { error: null });

  return (
    <form action={formAction} className={className}>
      {state.error && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3">
          <p className="text-sm text-red-800">{state.error}</p>
        </div>
      )}
      {children}
      <div>
        <SubmitButton pendingLabel={pendingLabel}>{submitLabel}</SubmitButton>
      </div>
    </form>
  );
}
