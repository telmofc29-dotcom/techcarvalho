// The single source of truth for every enumerated choice on the media forms.
//
// WHY THIS MODULE EXISTS
// ----------------------
// The upload form and the server action that validates its submissions used to
// keep two independent hand-written lists of the same enums. They drifted, and
// the drift was invisible in both directions:
//
//   * The form offered "Public domain / Creative Commons" and
//     "TechCarvalho-created graphic/diagram". The action's VALID_SOURCE_TYPES
//     omitted both, so choosing either failed the upload with "Choose a valid
//     source type" — a value the DATABASE accepts (verified against production:
//     both insert cleanly) refused by a stale allow-list in front of it.
//
// The reason the omission survived review is worth stating, because it is a
// property of the type system rather than of anyone's attention:
//
//     const VALID_SOURCE_TYPES: MediaSourceType[] = ["manufacturer", ...];
//
// An ARRAY annotated with a union type accepts a SHORT list silently. Every
// member present is checked; a missing member is not an error. So a value added
// to MediaSourceType is never reported as missing from the validator.
//
// A Record keyed by the union does not have that hole: omit a member and the
// object literal fails to compile. actions.ts already used that pattern for
// asset roles, with a comment explaining exactly this hazard — and the other
// four lists next to it were still arrays. This module applies the lesson
// uniformly and, more importantly, makes the FORM render from the same maps, so
// "the UI offers something the server rejects" stops being expressible.
//
// Pure data and pure predicates. No I/O, no React, no server-only imports —
// which is what lets the regression test import it directly under node --test.

import type {
  MediaAssetRole,
  MediaBrandRole,
  MediaRightsStatus,
  MediaSourceType,
  MediaType,
} from "@/lib/types/database";

/**
 * One selectable choice. `label` is presentation copy; `value` is the string
 * that reaches the database, so it must match the column's CHECK constraint.
 */
export type MediaOption<T extends string> = { value: T; label: string };

/**
 * Build the accepted-value list from an option list.
 *
 * Deriving the validator's allow-list FROM the rendered options is the point:
 * it is not possible to offer a choice the validator then refuses, because
 * there is only one list.
 */
function valuesOf<T extends string>(options: readonly MediaOption<T>[]): T[] {
  return options.map((o) => o.value);
}

// ---------------------------------------------------------------------------
// Media type
// ---------------------------------------------------------------------------

const MEDIA_TYPE_LABELS: Record<MediaType, string> = {
  image: "Image",
  video: "Video",
};

export const MEDIA_TYPE_OPTIONS: readonly MediaOption<MediaType>[] = (
  Object.keys(MEDIA_TYPE_LABELS) as MediaType[]
).map((value) => ({ value, label: MEDIA_TYPE_LABELS[value] }));

export const VALID_MEDIA_TYPES: MediaType[] = valuesOf(MEDIA_TYPE_OPTIONS);

// ---------------------------------------------------------------------------
// Source type — where the file came from
// ---------------------------------------------------------------------------

// Keyed by the union: omitting a member is a compile error, which is the whole
// reason the previous array-typed list could go stale unnoticed.
const SOURCE_TYPE_LABELS: Record<MediaSourceType, string> = {
  manufacturer: "Manufacturer",
  staff_photograph: "Staff photograph",
  stock_licensed: "Stock (licensed)",
  user_submitted: "User submitted",
  press_kit: "Press kit",
  public_domain_or_cc: "Public domain / Creative Commons",
  tc_graphic: "TechCarvalho-created graphic/diagram",
  other: "Other",
};

// Explicit display order. Object key order would work, but an explicit list
// means reordering the menu never silently changes what is accepted.
const SOURCE_TYPE_ORDER: readonly MediaSourceType[] = [
  "manufacturer",
  "staff_photograph",
  "stock_licensed",
  "user_submitted",
  "press_kit",
  "public_domain_or_cc",
  "tc_graphic",
  "other",
];

export const SOURCE_TYPE_OPTIONS: readonly MediaOption<MediaSourceType>[] = SOURCE_TYPE_ORDER.map(
  (value) => ({ value, label: SOURCE_TYPE_LABELS[value] })
);

export const VALID_SOURCE_TYPES: MediaSourceType[] = valuesOf(SOURCE_TYPE_OPTIONS);

// ---------------------------------------------------------------------------
// Editorial role — what the image IS
// ---------------------------------------------------------------------------

const ASSET_ROLE_LABELS: Record<MediaAssetRole, string> = {
  product_photo: "Product photograph",
  article_hero: "Article hero",
  concept_render: "Concept render (unreleased / unrevealed product)",
  diagram: "Diagram",
  chart: "Data chart",
  comparison_graphic: "Comparison graphic",
  screenshot: "Screenshot",
  logo_brand: "Logo / brand mark",
  icon: "Icon",
  category_hero: "Category hero",
  homepage_feature: "Homepage feature",
  banner: "Banner",
  background: "Background",
  social_og: "Social / OG image",
};

const ASSET_ROLE_ORDER: readonly MediaAssetRole[] = [
  "product_photo",
  "article_hero",
  "concept_render",
  "diagram",
  "chart",
  "comparison_graphic",
  "screenshot",
  "logo_brand",
  "icon",
  "category_hero",
  "homepage_feature",
  "banner",
  "background",
  "social_og",
];

export const ASSET_ROLE_OPTIONS: readonly MediaOption<MediaAssetRole>[] = ASSET_ROLE_ORDER.map(
  (value) => ({ value, label: ASSET_ROLE_LABELS[value] })
);

export const VALID_ASSET_ROLES: MediaAssetRole[] = valuesOf(ASSET_ROLE_OPTIONS);

/**
 * Roles whose CHECK constraint is not yet applied in every environment.
 *
 * EMPTY, and that is the correct state. 'concept_render' lived here while
 * supabase/migrations_pending/20260828_concept_render_role.sql was unapplied;
 * that migration has since been run in production (verified behaviourally — the
 * constraint accepts the value and reclassified nothing) and now lives in
 * supabase/migrations/.
 *
 * Leaving a role listed here after its migration lands is not harmless. This
 * constant only decides what an admin is TOLD when an insert fails with
 * SQLSTATE 23514; a stale entry sends them off to run a migration that is
 * already applied while their actual constraint failure goes unexplained.
 *
 * Repopulate it when a new role is added to the union ahead of its migration,
 * and empty it again once that migration is applied.
 */
export const ASSET_ROLES_PENDING_MIGRATION: readonly MediaAssetRole[] = [];

// ---------------------------------------------------------------------------
// Brand asset role
// ---------------------------------------------------------------------------

const BRAND_ROLE_LABELS: Record<MediaBrandRole, string> = {
  logo_full: "Full logo (mark + wordmark)",
  logo_full_tagline: "Full logo + tagline",
  wordmark: "Wordmark only",
  wordmark_tagline: "Wordmark + tagline",
  mark: "Mark / monogram only",
  favicon: "Favicon candidate",
  og_image: "Social / OG image candidate",
};

const BRAND_ROLE_ORDER: readonly MediaBrandRole[] = [
  "logo_full",
  "logo_full_tagline",
  "wordmark",
  "wordmark_tagline",
  "mark",
  "favicon",
  "og_image",
];

export const BRAND_ROLE_OPTIONS: readonly MediaOption<MediaBrandRole>[] = BRAND_ROLE_ORDER.map(
  (value) => ({ value, label: BRAND_ROLE_LABELS[value] })
);

export const VALID_BRAND_ROLES: MediaBrandRole[] = valuesOf(BRAND_ROLE_OPTIONS);

// ---------------------------------------------------------------------------
// Rights status
// ---------------------------------------------------------------------------

const RIGHTS_STATUS_LABELS: Record<MediaRightsStatus, string> = {
  unknown: "Unknown",
  pending_verification: "Pending verification",
  verified: "Verified",
  restricted: "Restricted (never publish)",
};

const RIGHTS_STATUS_ORDER: readonly MediaRightsStatus[] = [
  "unknown",
  "pending_verification",
  "verified",
  "restricted",
];

export const RIGHTS_STATUS_OPTIONS: readonly MediaOption<MediaRightsStatus>[] =
  RIGHTS_STATUS_ORDER.map((value) => ({ value, label: RIGHTS_STATUS_LABELS[value] }));

export const VALID_RIGHTS_STATUSES: MediaRightsStatus[] = valuesOf(RIGHTS_STATUS_OPTIONS);

// ---------------------------------------------------------------------------
// Predicates used by the server action
// ---------------------------------------------------------------------------

export function isValidMediaType(v: string): v is MediaType {
  return (VALID_MEDIA_TYPES as string[]).includes(v);
}

export function isValidSourceType(v: string): v is MediaSourceType {
  return (VALID_SOURCE_TYPES as string[]).includes(v);
}

export function isValidAssetRole(v: string): v is MediaAssetRole {
  return (VALID_ASSET_ROLES as string[]).includes(v);
}

export function isValidBrandRole(v: string): v is MediaBrandRole {
  return (VALID_BRAND_ROLES as string[]).includes(v);
}

export function isValidRightsStatus(v: string): v is MediaRightsStatus {
  return (VALID_RIGHTS_STATUSES as string[]).includes(v);
}
