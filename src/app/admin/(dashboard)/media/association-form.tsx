"use client";

import { useActionState, type ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { SubmitButton } from "@/components/admin/submit-button";
import type { AssociationState, HeroCollision } from "./actions";

// The association form, with an explicit hero-collision step.
//
// WHY THE EXTRA STEP EXISTS
// -------------------------
// Assigning this asset as hero to something that already has a hero used to
// just work — by adding a SECOND hero row, leaving the public page to pick one
// arbitrarily. In production that is exactly what happened: the owner set a new
// image as hero on an article and the old graphic kept rendering.
//
// The server now refuses to guess. When it finds an occupied slot it writes
// NOTHING and hands back the collision; this component shows both sides and
// makes the admin choose. The three choices are the three things a person could
// reasonably mean, and none of them is destructive:
//
//   Replace          — the newcomer takes the slot, the incumbent moves to the
//                      gallery. The old asset is kept, not deleted.
//   Add to gallery   — the incumbent keeps the slot, the newcomer joins the
//                      gallery.
//   Cancel           — this target is left exactly as it was.
export function MediaAssociationForm({
  action,
  submitLabel,
  newAssetAlt,
  newAssetPreviewUrl,
  children,
}: {
  action: (prev: AssociationState, formData: FormData) => Promise<AssociationState>;
  submitLabel: string;
  newAssetAlt: string | null;
  newAssetPreviewUrl: string | null;
  children: ReactNode;
}) {
  const [state, formAction] = useActionState(action, { error: null });
  const collisions = state.collisions ?? [];

  return (
    <form action={formAction} className="flex flex-col gap-3">
      {state.error && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3">
          <p className="text-sm text-red-800">{state.error}</p>
        </div>
      )}

      {state.savedAt && !state.error && collisions.length === 0 && state.savedMessage && (
        <div role="status" className="rounded-lg border border-green-200 bg-green-50 p-3">
          <p className="text-sm text-green-800">{state.savedMessage}</p>
        </div>
      )}

      {collisions.length > 0 && (
        <div role="alert" className="flex flex-col gap-4 rounded-lg border border-amber-300 bg-amber-50 p-4">
          <div>
            <p className="text-sm font-semibold text-amber-900">
              {collisions.length === 1
                ? "This already has a hero image."
                : `${collisions.length} of these already have a hero image.`}
            </p>
            <p className="mt-1 text-xs text-amber-900/90">
              Nothing has been saved yet. Choose what should happen to each one — replacing keeps the old image and
              moves it into the gallery, it is never deleted.
            </p>
          </div>

          {/* The roles the admin asked for, resent verbatim. The visible
              <select>s still show their original database values, so without
              these the confirmation submit would apply the decision to the old
              roles and change nothing. */}
          {(state.pendingRoles ?? []).map((pending) => (
            <input
              key={pending.targetId}
              type="hidden"
              name={`pending_role_${pending.targetId}`}
              value={pending.role}
            />
          ))}

          {collisions.map((collision) => (
            <HeroCollisionChoice
              key={collision.targetId}
              collision={collision}
              newAssetAlt={newAssetAlt}
              newAssetPreviewUrl={newAssetPreviewUrl}
            />
          ))}

          {/* The action lives INSIDE the panel, next to the choice it applies.
              It was previously only at the foot of the form — below every
              article row — so after choosing "Replace existing hero" there was
              nothing visible to press, and the change appeared not to apply.
              A decision and the button that commits it belong together. */}
          <div className="flex flex-wrap items-center gap-3 border-t border-amber-200 pt-3">
            <SubmitButton pendingLabel="Applying…">
              {collisions.length === 1 ? "Confirm and apply" : `Confirm and apply ${collisions.length} choices`}
            </SubmitButton>
            <span className="text-xs text-amber-900/80">Nothing is saved until you press this.</span>
          </div>
        </div>
      )}

      {children}

      {/* While a hero decision is pending the only action is the one inside the
          panel above, so a second button here would just be a way to miss it. */}
      {collisions.length === 0 && (
        <div className="flex items-center gap-3">
          <SubmitButton pendingLabel="Saving...">{submitLabel}</SubmitButton>
          {state.savedAt && !state.error && (
            <span className="text-sm text-green-700">{state.savedMessage ?? "Saved."}</span>
          )}
        </div>
      )}
    </form>
  );
}

function HeroCollisionChoice({
  collision,
  newAssetAlt,
  newAssetPreviewUrl,
}: {
  collision: HeroCollision;
  newAssetAlt: string | null;
  newAssetPreviewUrl: string | null;
}) {
  const name = `hero_decision_${collision.targetId}`;
  return (
    <fieldset className="rounded border border-amber-200 bg-white p-3">
      <legend className="px-1 text-xs font-semibold text-neutral-900">{collision.targetLabel}</legend>

      <div className="mb-3 grid grid-cols-2 gap-3">
        <Side
          heading="Current hero"
          previewUrl={collision.currentHeroPreviewUrl}
          alt={collision.currentHeroAlt}
          descriptor={collision.currentHeroDescriptor}
          href={`/admin/media/${collision.currentHeroMediaId}`}
        />
        <Side heading="Proposed new hero" previewUrl={newAssetPreviewUrl} alt={newAssetAlt} descriptor="the asset you are editing" />
      </div>

      <div className="flex flex-col gap-2 text-sm">
        <label className="flex items-start gap-2">
          <input type="radio" name={name} value="replace" defaultChecked className="mt-1" />
          <span>
            <strong className="font-medium">Replace existing hero.</strong> The current hero moves to the gallery and
            is kept.
          </span>
        </label>
        <label className="flex items-start gap-2">
          <input type="radio" name={name} value="add_to_gallery" className="mt-1" />
          <span>
            <strong className="font-medium">Keep existing hero</strong> and add this one to the gallery instead.
          </span>
        </label>
        <label className="flex items-start gap-2">
          <input type="radio" name={name} value="cancel" className="mt-1" />
          <span>
            <strong className="font-medium">Cancel</strong> — leave this one exactly as it is.
          </span>
        </label>
      </div>
    </fieldset>
  );
}

function Side({
  heading,
  previewUrl,
  alt,
  descriptor,
  href,
}: {
  heading: string;
  previewUrl: string | null;
  alt: string | null;
  descriptor: string;
  href?: string;
}) {
  return (
    <div className="min-w-0">
      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">{heading}</p>
      <div className="relative mb-1 h-24 w-full overflow-hidden rounded bg-neutral-100">
        {previewUrl ? (
          <Image src={previewUrl} alt={alt ?? ""} fill className="object-contain" unoptimized />
        ) : (
          <div className="flex h-full items-center justify-center text-[10px] text-neutral-400">No preview</div>
        )}
      </div>
      <p className="truncate text-xs text-neutral-700">{alt || <span className="italic text-neutral-400">no alt text</span>}</p>
      <p className="truncate text-[11px] text-neutral-500">{descriptor}</p>
      {href && (
        <Link href={href} className="text-[11px] text-accent underline">
          open asset
        </Link>
      )}
    </div>
  );
}
