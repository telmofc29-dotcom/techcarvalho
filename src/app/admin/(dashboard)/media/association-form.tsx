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
  isPrivate,
  canPublish,
  publishBlockedReason,
  children,
}: {
  action: (prev: AssociationState, formData: FormData) => Promise<AssociationState>;
  submitLabel: string;
  newAssetAlt: string | null;
  newAssetPreviewUrl: string | null;
  /** Private assets render nothing publicly, however they are attached. */
  isPrivate: boolean;
  canPublish: boolean;
  publishBlockedReason: string | null;
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
                ? collisions[0].slot === "hero"
                  ? "This already has a hero image."
                  : "This already has a card image."
                : `${collisions.length} slots are already taken.`}
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
          {(state.pendingScope ?? []).map((targetId) => (
            <input key={`scope-${targetId}`} type="hidden" name={`scope_${targetId}`} value="1" />
          ))}
          {(state.pendingRoles ?? []).map((pending) => (
            <input
              key={`${pending.targetId}-${pending.role}`}
              type="hidden"
              name={`roles_${pending.targetId}`}
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
        <div className="flex flex-col gap-2">
          {/* The single most confusing thing in owner testing: a correctly
              attached image that never appeared, because it was still private.
              The warning sits next to the button that would fix it. */}
          {isPrivate && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3">
              <p className="text-sm font-medium text-amber-900">This image is still PRIVATE.</p>
              <p className="mt-1 text-xs leading-relaxed text-amber-900/90">
                Attaching it does not publish it. Until it is published it will not appear on the live website,
                whichever slots you tick.
                {!canPublish && publishBlockedReason ? ` It cannot be published yet: ${publishBlockedReason}` : ""}
              </p>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <SubmitButton pendingLabel="Saving...">{submitLabel}</SubmitButton>
            {isPrivate && canPublish && (
              <button
                name="publish_after"
                value="1"
                className="rounded bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700"
              >
                Publish image and apply
              </button>
            )}
          </div>
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
  // Hero and card are separate exclusive slots and each needs its own answer.
  const name = collision.slot === "hero" ? `hero_decision_${collision.targetId}` : `thumb_decision_${collision.targetId}`;
  const slotLabel = collision.slot === "hero" ? "hero" : "card image";
  return (
    <fieldset className="rounded border border-amber-200 bg-white p-3">
      <legend className="px-1 text-xs font-semibold text-neutral-900">
        {collision.targetLabel} — {slotLabel}
      </legend>

      <div className="mb-3 grid grid-cols-2 gap-3">
        <Side
          heading={`Current ${slotLabel}`}
          previewUrl={collision.currentHeroPreviewUrl}
          alt={collision.currentHeroAlt}
          descriptor={collision.currentHeroDescriptor}
          href={`/admin/media/${collision.currentHeroMediaId}`}
        />
        <Side heading={`Proposed new ${slotLabel}`} previewUrl={newAssetPreviewUrl} alt={newAssetAlt} descriptor="the asset you are editing" />
      </div>

      <div className="flex flex-col gap-2 text-sm">
        <label className="flex items-start gap-2">
          <input type="radio" name={name} value="replace" defaultChecked className="mt-1" />
          <span>
            <strong className="font-medium">Replace the existing {slotLabel}.</strong>{" "}
            {collision.slot === "hero"
              ? "The current hero moves to the gallery and is kept."
              : "The current card image stops being the card image; it is not removed from anywhere else."}
          </span>
        </label>
        <label className="flex items-start gap-2">
          <input type="radio" name={name} value="add_to_gallery" className="mt-1" />
          <span>
            <strong className="font-medium">Keep the existing {slotLabel}.</strong> This image will not take that
            slot — any other slots you ticked for it still apply.
          </span>
        </label>
        <label className="flex items-start gap-2">
          <input type="radio" name={name} value="cancel" className="mt-1" />
          <span>
            <strong className="font-medium">Cancel</strong> — leave this target completely unchanged, including any
            other slots you ticked for it.
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
