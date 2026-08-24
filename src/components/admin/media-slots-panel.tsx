"use client";

import { useActionState } from "react";
import Image from "next/image";
import Link from "next/link";
import { SubmitButton } from "./submit-button";
import type { SlotActionState } from "@/app/admin/(dashboard)/media/slot-actions";

export type SlotAsset = {
  mediaId: string;
  alt: string | null;
  previewUrl: string | null;
  descriptor: string;
  /** Will this actually appear on the public site? */
  renderable: boolean;
  /** Why not, when it will not. */
  blockedReason: string | null;
  sortOrder: number;
};

export type SlotsView = {
  hero: SlotAsset | null;
  thumbnail: SlotAsset | null;
  gallery: SlotAsset[];
  /** Which asset a card will actually show, and whether it came from the hero. */
  cardImage: { mediaId: string; via: "thumbnail" | "hero"; inherited: boolean } | null;
  thumbnailUnusable: boolean;
  /** Everything available to attach. */
  library: { id: string; label: string }[];
};

// Media slots, edited from the product or article itself.
//
// Two things this panel is careful about, because both were previously easy to
// get wrong:
//
//   REMOVING IS NOT DELETING. Every "Remove" here detaches an association. The
//   asset stays in the library, keeps its rights and provenance, and remains
//   attached to anything else that uses it.
//
//   PRIVATE MEDIA IS SHOWN AS SUCH. An asset in a public-facing slot that has
//   not been published renders nothing on the live site. That used to be
//   invisible from the admin — the audit found a hero in exactly that state.
//   Now it is labelled wherever it appears, with what to do about it.
export function MediaSlotsPanel({
  action,
  view,
  targetLabel,
}: {
  action: (prev: SlotActionState, formData: FormData) => Promise<SlotActionState>;
  view: SlotsView;
  targetLabel: string;
}) {
  const [state, formAction] = useActionState(action, { error: null, notice: null });
  const conflict = state.heroConflict;

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {state.error && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3">
          <p className="text-sm text-red-800">{state.error}</p>
        </div>
      )}
      {state.notice && !state.error && (
        <div className="rounded-lg border border-green-200 bg-green-50 p-3">
          <p className="text-sm text-green-800">{state.notice}</p>
        </div>
      )}

      {conflict && (
        <div role="alert" className="flex flex-col gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4">
          <div>
            <p className="text-sm font-semibold text-amber-900">{targetLabel} already has a hero image.</p>
            <p className="mt-1 text-xs text-amber-900/90">
              Nothing has been changed yet. Replacing keeps the current image and moves it into the gallery — it is
              never deleted.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Preview heading="Current hero" alt={conflict.currentAlt} previewUrl={conflict.currentPreviewUrl} descriptor={conflict.currentDescriptor} href={`/admin/media/${conflict.currentMediaId}`} />
            <Preview heading="Proposed new hero" alt={conflict.incomingAlt} previewUrl={conflict.incomingPreviewUrl} descriptor="the image you selected" href={`/admin/media/${conflict.incomingMediaId}`} />
          </div>
          <input type="hidden" name="op" value="set_hero" />
          <input type="hidden" name="media_id__set_hero" value={conflict.incomingMediaId} />
          <div className="flex flex-wrap gap-2">
            <button name="decision" value="replace" className="rounded bg-neutral-900 px-3 py-2 text-sm font-medium text-white hover:bg-neutral-700">
              Replace hero
            </button>
            <button name="decision" value="add_to_gallery" className="rounded border border-neutral-300 bg-white px-3 py-2 text-sm font-medium text-neutral-800 hover:bg-neutral-50">
              Keep current, add to gallery
            </button>
            <button name="decision" value="cancel" className="rounded border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-600 hover:bg-neutral-50">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* ---------------- Hero ---------------- */}
      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">Hero</h3>
        {view.hero ? (
          <SlotRowView asset={view.hero} actions={<RemoveButton mediaId={view.hero.mediaId} role="hero" />} />
        ) : (
          <p className="mb-2 text-sm text-neutral-500">No hero image. The page will render without one.</p>
        )}
        <Picker library={view.library} op="set_hero" label={view.hero ? "Replace hero with" : "Set hero"} />
      </section>

      {/* ---------------- Card / thumbnail ---------------- */}
      <section>
        <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">Card / thumbnail</h3>
        <p className="mb-2 text-xs text-neutral-500">
          Used on listings, category pages and the homepage. Leave it unset and cards reuse the hero automatically —
          you do not need to attach the same image twice.
        </p>

        {view.thumbnail ? (
          <>
            <SlotRowView asset={view.thumbnail} actions={<RemoveButton mediaId={view.thumbnail.mediaId} role="thumbnail" />} />
            {view.thumbnailUnusable && (
              <p className="mb-2 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                This card image is not published, so cards fall back to the hero. Publish it to make it take effect.
              </p>
            )}
            <button name="op" value="clear_thumbnail" className="mb-2 text-xs text-neutral-600 underline">
              Clear explicit card image (go back to inheriting the hero)
            </button>
          </>
        ) : (
          <p className="mb-2 text-sm text-neutral-600">
            {view.cardImage?.inherited ? (
              <span className="rounded bg-neutral-100 px-2 py-1 text-xs">Inherited from the hero</span>
            ) : (
              <span className="text-neutral-500">No card image and no hero to inherit.</span>
            )}
          </p>
        )}
        <Picker library={view.library} op="set_thumbnail" label="Set an explicit card image" />
      </section>

      {/* ---------------- Gallery ---------------- */}
      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
          Gallery {view.gallery.length > 0 && <span className="font-normal text-neutral-400">({view.gallery.length})</span>}
        </h3>
        {view.gallery.length === 0 ? (
          <p className="mb-2 text-sm text-neutral-500">No gallery images.</p>
        ) : (
          <ul className="mb-2 flex flex-col gap-2">
            {view.gallery.map((asset, index) => (
              <li key={asset.mediaId}>
                <SlotRowView
                  asset={asset}
                  actions={
                    <>
                      <IconButton op="move" mediaId={asset.mediaId} extraName="direction" extraValue="up" disabled={index === 0} label="Move up">
                        ↑
                      </IconButton>
                      <IconButton op="move" mediaId={asset.mediaId} extraName="direction" extraValue="down" disabled={index === view.gallery.length - 1} label="Move down">
                        ↓
                      </IconButton>
                      <RemoveButton mediaId={asset.mediaId} role="gallery" />
                    </>
                  }
                />
              </li>
            ))}
          </ul>
        )}
        <Picker library={view.library} op="add_gallery" label="Add to gallery" />
      </section>

      <p className="text-xs text-neutral-500">
        Removing an image here only removes it from this page. The asset stays in the media library, keeps its rights
        and provenance, and remains attached to anything else that uses it.
      </p>
    </form>
  );
}

function Preview({
  heading,
  alt,
  previewUrl,
  descriptor,
  href,
}: {
  heading: string;
  alt: string | null;
  previewUrl: string | null;
  descriptor: string;
  href: string;
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
      <Link href={href} className="text-[11px] text-accent underline">
        open asset
      </Link>
    </div>
  );
}

function SlotRowView({ asset, actions }: { asset: SlotAsset; actions: React.ReactNode }) {
  return (
    <div className="mb-2 flex items-center gap-3 rounded-lg border border-neutral-200 bg-white p-2">
      <div className="relative h-14 w-20 shrink-0 overflow-hidden rounded bg-neutral-100">
        {asset.previewUrl ? (
          <Image src={asset.previewUrl} alt={asset.alt ?? ""} fill className="object-contain" unoptimized />
        ) : (
          <div className="flex h-full items-center justify-center text-[10px] text-neutral-400">No preview</div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-neutral-800">
          {asset.alt || <span className="italic text-neutral-400">no alt text</span>}
        </p>
        <p className="truncate text-[11px] text-neutral-500">{asset.descriptor}</p>
        {!asset.renderable && asset.blockedReason && (
          <p className="mt-0.5 text-[11px] font-medium text-amber-700">{asset.blockedReason}</p>
        )}
        <Link href={`/admin/media/${asset.mediaId}`} className="text-[11px] text-accent underline">
          open asset
        </Link>
      </div>
      <div className="flex shrink-0 items-center gap-1">{actions}</div>
    </div>
  );
}

function Picker({ library, op, label }: { library: { id: string; label: string }[]; op: string; label: string }) {
  const selectId = `pick-${op}`;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <label htmlFor={selectId} className="sr-only">
        {label}
      </label>
      {/* A DISTINCT field name per picker. All three pickers live in one form,
          so sharing "media_id" meant every submit carried three values and the
          action read whichever came first — the hero picker — regardless of
          which button was pressed. Setting a card image or adding to the gallery
          silently did nothing. */}
      <select
        id={selectId}
        name={`media_id__${op}`}
        defaultValue=""
        className="max-w-md flex-1 rounded border border-neutral-300 px-2 py-1.5 text-sm"
      >
        <option value="">{label}…</option>
        {library.map((item) => (
          <option key={item.id} value={item.id}>
            {item.label}
          </option>
        ))}
      </select>
      <button name="op" value={op} className="rounded border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-800 hover:bg-neutral-50">
        {label}
      </button>
    </div>
  );
}

function RemoveButton({ mediaId, role }: { mediaId: string; role: string }) {
  return (
    <>
      <button
        name="op"
        value="remove"
        formNoValidate
        onClick={(e) => {
          const form = e.currentTarget.form;
          if (!form) return;
          setHidden(form, "media_id__remove", mediaId);
          setHidden(form, "role", role);
        }}
        className="rounded px-2 py-1 text-xs text-neutral-600 hover:bg-neutral-100"
        title="Remove this association. The image itself is kept."
      >
        Remove
      </button>
    </>
  );
}

function IconButton({
  op,
  mediaId,
  extraName,
  extraValue,
  disabled,
  label,
  children,
}: {
  op: string;
  mediaId: string;
  extraName: string;
  extraValue: string;
  disabled: boolean;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      name="op"
      value={op}
      disabled={disabled}
      aria-label={label}
      title={label}
      onClick={(e) => {
        const form = e.currentTarget.form;
        if (!form) return;
        setHidden(form, `media_id__${op}`, mediaId);
        setHidden(form, extraName, extraValue);
      }}
      className="rounded px-2 py-1 text-xs text-neutral-600 hover:bg-neutral-100 disabled:opacity-30"
    >
      {children}
    </button>
  );
}

/**
 * Set a hidden field on the form immediately before it submits.
 *
 * The pickers and the per-row buttons share one form, so the row buttons have
 * to override media_id (and role/direction) at click time. Creating the input
 * if it is missing keeps this independent of render order.
 */
function setHidden(form: HTMLFormElement, name: string, value: string) {
  let input = form.querySelector<HTMLInputElement>(`input[type=hidden][data-slot-field="${name}"]`);
  if (!input) {
    input = document.createElement("input");
    input.type = "hidden";
    input.dataset.slotField = name;
    input.name = name;
    form.appendChild(input);
  }
  input.value = value;
}

export { SubmitButton };
