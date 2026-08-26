// IS IT SAFE TO DELETE THIS MEDIA ASSET?
//
// WHY THIS IS A SEPARATE, PURE MODULE
// -----------------------------------
// Deleting media is the one bulk action with no undo, and the decision that
// makes it safe is not "did the delete succeed" but "what else was pointing at
// this row". That decision is worth testing directly, so it does not live
// inside a Server Action where the only way to exercise it is to actually
// delete something.
//
// WHAT THE FOREIGN KEYS DO, WHICH IS NOT ONE THING
// ------------------------------------------------
//   content_media.media_id               cascade   article silently loses its image
//   product_media.media_id               cascade   product silently loses its image
//   media_derivatives.media_asset_id     cascade   derived files go too (correct)
//   content_items.og_media_id            SET NULL  the social card blanks
//   manufacturers.logo_media_id          SET NULL  the brand logo blanks
//   media_requirements.resolved_media_id SET NULL  the record that a sourcing
//                                                  request was satisfied is erased
//   engine_media_candidates.ingested_media_id SET NULL
//
// Postgres reports none of it. A bulk delete that only reported "20 succeeded"
// would be making a true statement about twenty rows and saying nothing about
// the pages that just lost their hero image.
//
// Pure. No I/O.

export type MediaDeletionRelationship = {
  /** Human-readable, shown verbatim in the confirmation dialog. */
  label: string;
  count: number;
  /** True when this relationship alone prevents deletion. */
  blocking: boolean;
};

/** Everything that points at one asset, counted. */
export type DeletionReferences = {
  /** Roles this asset fills on articles, e.g. ["hero", "gallery"]. */
  contentRoles: readonly string[];
  /** Roles this asset fills on products. */
  productRoles: readonly string[];
  /** content_items.og_media_id */
  ogReferences: number;
  /** manufacturers.logo_media_id */
  logoReferences: number;
  /** media_requirements.resolved_media_id */
  requirementReferences: number;
  /** media_derivatives.media_asset_id — cascades, informational only. */
  derivatives: number;
  /** engine_media_candidates.ingested_media_id — set-null, informational. */
  engineCandidates: number;
  publicationStatus: string;
  /** False when no such row was found. */
  exists: boolean;
  /**
   * Non-empty when one or more of the relationship queries FAILED.
   *
   * The 2026-08 incident in one line: a query that errors and a query that
   * returns nothing look identical unless something keeps them apart. Here the
   * difference is whether a delete is licensed, so an incomplete answer must
   * fail CLOSED.
   */
  readFailures: readonly string[];
};

export type MediaDeletionAssessment = {
  id: string;
  filename: string;
  publicationStatus: string;
  relationships: MediaDeletionRelationship[];
  blocked: boolean;
  /** Set when blocked. Names what is attached, not merely that something is. */
  reason: string | null;
};

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * Decide whether one asset may be deleted, and say why in words an admin can
 * act on.
 *
 * ATTACHED MEDIA IS REFUSED. There is no force flag: the safe way to delete an
 * asset that is in use is to detach it first and look at what that page becomes
 * without it. A flag that skipped this check would be used the first time a
 * bulk delete was inconvenient, which is exactly when it matters.
 */
export function assessDeletion(
  id: string,
  filename: string,
  refs: DeletionReferences
): MediaDeletionAssessment {
  const relationships: MediaDeletionRelationship[] = [];

  if (refs.contentRoles.length > 0) {
    relationships.push({
      label: `used on ${plural(refs.contentRoles.length, "article slot")} (${[...new Set(refs.contentRoles)].join(", ")})`,
      count: refs.contentRoles.length,
      blocking: true,
    });
  }
  if (refs.productRoles.length > 0) {
    relationships.push({
      label: `used on ${plural(refs.productRoles.length, "product slot")} (${[...new Set(refs.productRoles)].join(", ")})`,
      count: refs.productRoles.length,
      blocking: true,
    });
  }
  for (const [count, phrase] of [
    [refs.ogReferences, "set as the social-card image on"],
    [refs.logoReferences, "set as the logo for"],
    [refs.requirementReferences, "recorded as the resolution of"],
  ] as const) {
    if (count > 0) {
      relationships.push({
        label: `${phrase} ${plural(count, "record")} — that reference would be blanked without warning`,
        count,
        blocking: true,
      });
    }
  }

  // Informational, not blocking. Derivatives exist BECAUSE of this asset; if the
  // master goes they are meant to go with it.
  if (refs.derivatives > 0) {
    relationships.push({
      label: `${plural(refs.derivatives, "derived file")} will be deleted too`,
      count: refs.derivatives,
      blocking: false,
    });
  }
  if (refs.engineCandidates > 0) {
    relationships.push({
      label: `${plural(refs.engineCandidates, "engine media candidate row")} will lose its ingest link`,
      count: refs.engineCandidates,
      blocking: false,
    });
  }
  if (refs.publicationStatus === "published") {
    relationships.push({
      label: "currently PUBLISHED — the public copy goes too",
      count: 1,
      blocking: false,
    });
  }

  // ORDER MATTERS. A failed relationship read outranks everything, because in
  // that state the list above is not evidence of anything.
  if (refs.readFailures.length > 0) {
    return {
      id,
      filename,
      publicationStatus: refs.publicationStatus,
      relationships,
      blocked: true,
      reason:
        `Relationship check could not complete (${refs.readFailures.join("; ")}). ` +
        "Refusing to delete on incomplete information.",
    };
  }
  if (!refs.exists) {
    return {
      id,
      filename,
      publicationStatus: refs.publicationStatus,
      relationships,
      blocked: true,
      reason: "No such media asset (already deleted, or not visible to this account).",
    };
  }

  const blockers = relationships.filter((r) => r.blocking);
  return {
    id,
    filename,
    publicationStatus: refs.publicationStatus,
    relationships,
    blocked: blockers.length > 0,
    reason:
      blockers.length > 0
        ? `Attached: ${blockers.map((b) => b.label).join("; ")}. Detach it first — a bulk delete will not quietly empty a slot somebody filled.`
        : null,
  };
}
