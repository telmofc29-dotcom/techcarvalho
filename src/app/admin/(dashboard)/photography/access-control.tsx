"use client";

import { useActionState } from "react";
import { ACCESS_LABEL, type OwnerAccess } from "@/lib/media/resolution";
import { OWNER_ACCESS_VALUES } from "@/lib/media/photography-triage";
import { TOUCH_TARGET } from "@/components/shared/ui";
import { setOwnerAccessAction, type SetOwnerAccessResult } from "./actions";

// Marking a product is ONE interaction.
//
// Five submit buttons in one form, each carrying its own value, rather than a
// select plus a Save button — the whole purpose of this screen is to make 44
// unassessed products cheap to work through, and a two-step control doubles the
// cost of every row. The optional note sits in the same form, so a click still
// submits whatever has been typed alongside it.
//
// The clicked button's name/value is what tells the action which state was
// chosen; the same pattern translation-row-actions.tsx uses for per-locale
// buttons.
//
// A FAILURE IS SHOWN AS A FAILURE
// -------------------------------
// The result is rendered inline, including the "matched no rows" case. An
// action that silently did nothing would look exactly like one that worked
// until the page was reloaded — which is the read-path silent-success problem
// wearing a write-path costume.

const TONE: Record<OwnerAccess, string> = {
  owned: "border-green-300 bg-green-50 text-green-900 hover:bg-green-100",
  borrowable: "border-green-200 bg-green-50/60 text-green-900 hover:bg-green-100",
  retail_display: "border-blue-200 bg-blue-50 text-blue-900 hover:bg-blue-100",
  not_accessible: "border-red-200 bg-red-50 text-red-900 hover:bg-red-100",
  unknown: "border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-100",
};

const SELECTED: Record<OwnerAccess, string> = {
  owned: "border-green-700 bg-green-700 text-white hover:bg-green-700",
  borrowable: "border-green-700 bg-green-700 text-white hover:bg-green-700",
  retail_display: "border-blue-700 bg-blue-700 text-white hover:bg-blue-700",
  not_accessible: "border-red-700 bg-red-700 text-white hover:bg-red-700",
  unknown: "border-neutral-700 bg-neutral-700 text-white hover:bg-neutral-700",
};

function formatSetAt(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

export function AccessControl({
  productId,
  productName,
  current,
  note,
  setAt,
}: {
  productId: string;
  productName: string;
  current: OwnerAccess;
  note: string | null;
  setAt: string | null;
}) {
  const [result, formAction, pending] = useActionState<SetOwnerAccessResult | null, FormData>(
    setOwnerAccessAction,
    null
  );

  // What the database holds now: the action's echo if this row has been saved
  // in this session, otherwise what the page was rendered with.
  const stored = result?.ok ? result.access : current;
  const storedNote = result?.ok ? result.note : note;
  const storedSetAt = result?.ok ? result.setAt : setAt;

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="product_id" value={productId} />

      <fieldset disabled={pending} className="contents">
        <legend className="sr-only">Physical access to {productName}</legend>
        <div className="flex flex-wrap gap-1.5">
          {OWNER_ACCESS_VALUES.map((value) => {
            const isCurrent = value === stored;
            return (
              <button
                key={value}
                type="submit"
                name="owner_access"
                value={value}
                aria-pressed={isCurrent}
                className={`${TOUCH_TARGET} rounded border px-3 text-xs font-medium disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900 ${
                  isCurrent ? SELECTED[value] : TONE[value]
                }`}
              >
                {ACCESS_LABEL[value]}
              </button>
            );
          })}
        </div>

        <input
          type="text"
          name="owner_access_note"
          defaultValue={storedNote ?? ""}
          maxLength={500}
          placeholder="Optional note — where it is, whose it is, when it goes back"
          aria-label={`Access note for ${productName}`}
          className="min-h-11 w-full rounded border border-neutral-300 bg-white px-3 py-2 text-xs focus:border-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-900/20 disabled:opacity-50"
        />
      </fieldset>

      <p aria-live="polite" className="text-xs leading-relaxed">
        {pending && <span className="text-neutral-500">Saving…</span>}
        {!pending && result && !result.ok && (
          <span role="alert" className="text-red-700">
            {result.error}
          </span>
        )}
        {!pending && result?.ok && (
          <span className="text-green-800">
            Saved as “{ACCESS_LABEL[result.access]}”
            {result.setAt
              ? `, recorded ${formatSetAt(result.setAt)}.`
              : " — back to nobody having assessed it."}
          </span>
        )}
        {!pending && !result && storedSetAt && (
          <span className="text-neutral-500">
            Recorded {formatSetAt(storedSetAt)}
            {storedNote ? ` — ${storedNote}` : ""}
          </span>
        )}
        {!pending && !result && !storedSetAt && (
          <span className="text-neutral-500">
            Not assessed — nobody has looked at this one yet.
            {storedNote ? ` Note: ${storedNote}` : ""}
          </span>
        )}
      </p>
    </form>
  );
}
