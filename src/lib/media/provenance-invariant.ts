// The provenance invariant, mirrored in application code.
//
// WHY THIS EXISTS
// ---------------
// supabase/migrations/20260822_media_provenance_evidence.sql adds:
//
//   constraint media_assets_external_verified_needs_provenance check (
//     rights_status <> 'verified'
//     or owned = true
//     or source_type in ('staff_photograph', 'tc_graphic')
//     or (source_url is not null and license is not null
//         and (creator is not null or attribution is not null))
//   )
//
// That constraint is doing real work and must stay. But it was the FIRST thing
// checking the rule, not the last: /admin/media/[id] let an admin submit
// "verified" on an externally-sourced asset with no provenance, the database
// refused it, and the refusal arrived as an unhandled throw inside a Server
// Action — which React reports to the browser as a masked #441 with no
// indication of what was wrong. Production digest 994149443 was exactly this.
//
// So the same rule is expressed here, checked BEFORE the write, and turned into
// a sentence naming the missing field. The database keeps the final say; this
// just means an admin finds out from the form instead of from a crash.
//
// Pure and dependency-free so it is testable and callable from anywhere.

import type { MediaRightsStatus, MediaSourceType } from "@/lib/types/database";

/** The columns the constraint actually reads. */
export type ProvenanceRelevantFields = {
  rights_status?: MediaRightsStatus | null;
  owned?: boolean | null;
  source_type?: MediaSourceType | null;
  source_url?: string | null;
  license?: string | null;
  creator?: string | null;
  attribution?: string | null;
};

/**
 * Source types that carry no external licence, so the provenance requirement
 * does not apply to them. Matches the SQL list exactly — if one is added to the
 * constraint it must be added here, and the test asserts they agree.
 */
export const SELF_SOURCED_TYPES: readonly MediaSourceType[] = ["staff_photograph", "tc_graphic"];

/** Treat empty/whitespace-only strings as absent, as a blank form field means. */
function present(value: string | null | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Does this row satisfy the database constraint?
 *
 * Deliberately a transcription of the SQL rather than a tidier equivalent, so
 * the two can be compared line by line. Note `owned === true`: in SQL,
 * `owned = true` is NULL (not true) when owned is NULL, so a null `owned` does
 * NOT exempt a row. Writing `!!row.owned` here would be subtly more permissive
 * than the database and would reintroduce the crash for null-owned rows.
 */
export function satisfiesProvenanceInvariant(row: ProvenanceRelevantFields): boolean {
  if (row.rights_status !== "verified") return true;
  if (row.owned === true) return true;
  if (row.source_type != null && SELF_SOURCED_TYPES.includes(row.source_type)) return true;
  return present(row.source_url) && present(row.license) && (present(row.creator) || present(row.attribution));
}

/**
 * Why the row fails, phrased for an admin looking at the form.
 *
 * Returns null when the row is fine. Names every missing field rather than the
 * first, so the fix is one edit rather than three round trips.
 */
export function explainProvenanceRequirement(row: ProvenanceRelevantFields): string | null {
  if (satisfiesProvenanceInvariant(row)) return null;

  const missing: string[] = [];
  if (!present(row.source_url)) missing.push("Source URL");
  if (!present(row.license)) missing.push("License");
  if (!present(row.creator) && !present(row.attribution)) missing.push("Creator or Attribution text");

  return (
    "This asset cannot be marked Verified until its provenance is recorded. " +
    `Missing: ${missing.join(", ")}. ` +
    "An externally-sourced asset needs a source URL, a licence, and either a creator or attribution text " +
    "before its licence can be relied on or displayed. " +
    "Alternatively, if Tech Carvalho owns this asset, tick “Owned by Tech Carvalho”, or set Source type to " +
    "“Staff photograph” or “TechCarvalho-created graphic/diagram”."
  );
}

// ---------------------------------------------------------------------------
// The second rights constraint: an assessed licence needs an assessor
// ---------------------------------------------------------------------------
//
// supabase/migrations/20260825_media_derivatives.sql adds:
//
//   constraint media_assets_licence_modification_attributed check (
//     licence_permits_modification is null
//     or (licence_modification_assessed_at is not null
//         and licence_modification_assessed_by is not null)
//   )
//
// The reasoning is sound: "this licence permits modification" is a judgement
// someone made, and a judgement with no author and no date cannot be audited or
// revisited. Recording the claim without recording who made it and when is how
// an unsourced assertion becomes an apparent fact.
//
// But NOTHING in the application ever set those two columns. Not the upload
// action, not the edit action, nowhere. So every write that set
// licence_permits_modification to true or false was rejected by the database —
// including the upload form's "Owned by Tech Carvalho" tickbox, which submits a
// hidden licence_permits_modification=true. Ticking the box that says "this is
// my own photograph" made the upload fail.
//
// The fix is to record the assessment properly rather than to stop making it:
// the admin performing the edit IS the assessor, and the moment they submit IS
// the assessment time.

export type ModificationAssessmentFields = {
  licence_permits_modification?: boolean | null;
  licence_modification_assessed_at?: string | null;
  licence_modification_assessed_by?: string | null;
};

/**
 * Attach assessor and timestamp whenever a modification judgement is recorded.
 *
 * PATCH-safe: a payload that does not mention licence_permits_modification is
 * returned untouched, so an edit that never asked about modification permission
 * neither sets nor clears the attribution of a previous assessment.
 *
 * Setting it back to null clears both, because an unassessed licence has no
 * assessor — leaving a stale name and date attached to "not assessed" would
 * credit someone with a judgement that no longer exists.
 */
export function stampModificationAssessment<T extends object>(
  payload: T,
  adminId: string,
  now: string
): T & ModificationAssessmentFields {
  if (!("licence_permits_modification" in payload)) return payload;
  const value = (payload as ModificationAssessmentFields).licence_permits_modification;

  const assessment: ModificationAssessmentFields =
    value === null || value === undefined
      ? { licence_modification_assessed_at: null, licence_modification_assessed_by: null }
      : { licence_modification_assessed_at: now, licence_modification_assessed_by: adminId };

  // The cast is narrow and deliberate: TypeScript's `in` narrowing widens the
  // checked key to `unknown` on a generic T, which makes the spread's inferred
  // type incompatible with T even though the runtime value is unchanged. The
  // behaviour is covered by the unit tests rather than by the compiler here.
  return { ...payload, ...assessment } as T & ModificationAssessmentFields;
}

/** Mirrors media_assets_licence_modification_attributed. */
export function satisfiesModificationAttribution(row: ModificationAssessmentFields): boolean {
  if (row.licence_permits_modification === null || row.licence_permits_modification === undefined) return true;
  return row.licence_modification_assessed_at != null && row.licence_modification_assessed_by != null;
}
