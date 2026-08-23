"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import { type OwnerAccess } from "@/lib/media/resolution";
import { isOwnerAccess, OWNER_ACCESS_VALUES } from "@/lib/media/photography-triage";

// Recording whether the owner can actually get at a product.
//
// requireAdmin() IS CALLED HERE, NOT INHERITED
// -------------------------------------------
// A Server Action is invoked directly by a POST to its action id; the admin
// layout never runs for it. Layout-level protection therefore protects nothing
// here, and RLS (is_admin()) is the layer underneath, not a substitute for this
// check. See the authorization section of CLAUDE.md.
//
// THE VALUE IS VALIDATED SERVER-SIDE
// ----------------------------------
// The form offers five buttons, and that is a convenience, not a constraint —
// the action is reachable with any string at all. isOwnerAccess() rejects
// anything outside the five before the round-trip. The CHECK constraint in
// supabase/migrations/20260825_product_owner_access.sql would also reject it
// (23514), and both layers are deliberate: this one produces a sentence a
// person can read, that one guarantees the database is never wrong regardless
// of what calls it.
//
// A ZERO-ROW UPDATE IS A FAILURE, NOT A SUCCESS
// ---------------------------------------------
// PostgREST returns success with no error when an UPDATE matches nothing —
// which is exactly what an RLS denial or a bad id looks like. Reporting that as
// "Saved" is the silent-success failure mode this project has shipped before,
// so the update selects the row back and the action fails loudly if nothing
// came back.

export type SetOwnerAccessResult =
  | { ok: true; access: OwnerAccess; setAt: string | null; note: string | null }
  | { ok: false; error: string };

/** Longer than this is a paragraph, not an access note; the UI says so too. */
const MAX_NOTE_LENGTH = 500;

export async function setOwnerAccessAction(
  _prev: SetOwnerAccessResult | null,
  formData: FormData
): Promise<SetOwnerAccessResult> {
  await requireAdmin();

  const productId = String(formData.get("product_id") ?? "").trim();
  if (!productId) {
    return { ok: false, error: "No product was identified, so nothing was changed." };
  }

  const access = formData.get("owner_access");
  if (!isOwnerAccess(access)) {
    return {
      ok: false,
      error:
        `"${String(access)}" is not an access state. Expected one of: ` +
        `${OWNER_ACCESS_VALUES.join(", ")}. Nothing was changed.`,
    };
  }

  const rawNote = String(formData.get("owner_access_note") ?? "").trim();
  if (rawNote.length > MAX_NOTE_LENGTH) {
    return {
      ok: false,
      error: `That note is ${rawNote.length} characters; keep it under ${MAX_NOTE_LENGTH}. Nothing was changed.`,
    };
  }
  const note = rawNote || null;

  // Recorded so a stale assessment is visible as stale: "not obtainable" set
  // three years ago is a different claim from one set this week.
  //
  // Choosing 'unknown' CLEARS the timestamp rather than stamping it. 'unknown'
  // is the absence of an assessment, and a dated one would read as "someone
  // looked on this date and concluded nothing" — which is a finding this column
  // must never manufacture. Clearing also makes "reset to not assessed"
  // indistinguishable from "never touched", which is exactly right: both mean
  // nobody has an answer.
  const setAt = access === "unknown" ? null : new Date().toISOString();

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("products")
    .update({ owner_access: access, owner_access_note: note, owner_access_set_at: setAt })
    .eq("id", productId)
    .select("id, name, owner_access, owner_access_note, owner_access_set_at");

  if (error) {
    return { ok: false, error: `Could not save: ${error.message}` };
  }
  if (!data || data.length === 0) {
    return {
      ok: false,
      error:
        "The update matched no rows, so nothing was saved. Either that product no longer " +
        "exists or this account is not permitted to write it.",
    };
  }

  const saved = data[0];
  revalidatePath("/admin/photography");
  revalidatePath(`/admin/products/${productId}`);

  return {
    ok: true,
    // Echoed back from the row the database actually holds, not from the form.
    // "Saved" that reports the submitted value would look identical whether or
    // not the write landed.
    access: saved.owner_access as OwnerAccess,
    setAt: saved.owner_access_set_at,
    note: saved.owner_access_note,
  };
}
