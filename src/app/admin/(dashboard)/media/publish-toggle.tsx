"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Badge } from "@/components/shared/ui";
import { publishMediaAsset, unpublishMediaAsset } from "./actions";
import type { FormState } from "@/components/admin/reference-form";

const initialState: FormState = { error: null };

function ToggleButton({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded px-3 py-2 text-sm font-medium bg-neutral-900 text-white hover:bg-neutral-700 disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900"
    >
      {pending ? pendingLabel : label}
    </button>
  );
}

export function PublishToggle({ id, isPublished }: { id: string; isPublished: boolean }) {
  const action = isPublished ? unpublishMediaAsset : publishMediaAsset;
  const [state, formAction] = useActionState(async () => action(id), initialState);

  return (
    <div className="flex items-center gap-3">
      <Badge tone={isPublished ? "green" : "neutral"}>{isPublished ? "Published" : "Private"}</Badge>
      <form action={formAction}>
        <ToggleButton
          label={isPublished ? "Unpublish" : "Publish"}
          pendingLabel={isPublished ? "Unpublishing..." : "Publishing..."}
        />
      </form>
      {state.error && (
        <p role="alert" className="text-sm text-red-600">
          {state.error}
        </p>
      )}
    </div>
  );
}
