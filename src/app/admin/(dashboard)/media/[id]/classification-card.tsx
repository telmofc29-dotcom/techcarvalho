"use client";

import { useActionState, useState } from "react";
import { SubmitButton } from "@/components/admin/submit-button";
import { CLASSIFICATION_PRESETS, type ClassificationPresetId } from "@/lib/media/classification-presets";
import type { FormState } from "@/components/admin/reference-form";

// "Where did this file come from?" — the one question the owner can actually
// answer, asked once.
//
// Everything the database needs follows from it. Choosing "TechCarvalho
// photograph" records ownership, source type and verified rights together;
// choosing "External / licensed" records only that it is NOT ours and leaves
// the real source URL, licence and creator to be typed in below. No preset
// invents provenance for somebody else's work.
export function ClassificationCard({
  action,
  currentPreset,
  isUnclassified,
  aiGenerated,
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  currentPreset: ClassificationPresetId | null;
  isUnclassified: boolean;
  aiGenerated: boolean;
}) {
  const [state, formAction] = useActionState(action, { error: null });
  const [selected, setSelected] = useState<ClassificationPresetId | "">(currentPreset ?? "");

  const chosen = CLASSIFICATION_PRESETS.find((p) => p.id === selected) ?? null;

  return (
    <form action={formAction} className="flex flex-col gap-3">
      {isUnclassified && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
          <p className="text-sm font-medium text-amber-900">This asset is not classified yet.</p>
          <p className="mt-1 text-xs leading-relaxed text-amber-900/90">
            Until it is, it stays private and cannot be used in a public hero, card or gallery slot. Pick the option
            below that describes where the file came from — that is all that is needed for anything we made
            ourselves.
          </p>
        </div>
      )}

      {state.error && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3">
          <p className="text-sm text-red-800">{state.error}</p>
        </div>
      )}

      <fieldset className="flex flex-col gap-2">
        <legend className="sr-only">Where did this file come from?</legend>
        {CLASSIFICATION_PRESETS.map((preset) => (
          <label
            key={preset.id}
            className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 ${
              selected === preset.id ? "border-neutral-900 bg-neutral-50" : "border-neutral-200 bg-white"
            }`}
          >
            <input
              type="radio"
              name="preset"
              value={preset.id}
              checked={selected === preset.id}
              onChange={() => setSelected(preset.id)}
              className="mt-1"
            />
            <span className="min-w-0">
              <span className="block text-sm font-medium text-neutral-900">{preset.label}</span>
              <span className="mt-0.5 block text-xs leading-relaxed text-neutral-600">{preset.help}</span>
            </span>
          </label>
        ))}
      </fieldset>

      {/* Asked, not assumed: whether a render was machine-made is a fact about
          the file, and a classification has no business guessing it. */}
      {selected === "tc_render" && (
        <label className="flex items-center gap-2 rounded border border-neutral-200 bg-white px-3 py-2 text-sm">
          <input type="checkbox" name="ai_generated" defaultChecked={aiGenerated} />
          <span>This render was made with a generative model</span>
        </label>
      )}

      {chosen?.requiresManualProvenance && (
        <p className="rounded border border-neutral-200 bg-neutral-50 px-3 py-2 text-xs leading-relaxed text-neutral-700">
          External media still needs its real provenance. Fill in Source URL, License and Creator or Attribution in
          the sections below before setting Rights status to Verified — nothing here fills those in for you.
        </p>
      )}

      <div className="flex items-center gap-3">
        <SubmitButton pendingLabel="Saving…">Save classification</SubmitButton>
        {state.error === null && state.error !== undefined ? null : null}
      </div>
    </form>
  );
}
