// Structured content import definitions — the contract between
// hand-written/researched editorial content and the ingestion script
// (scripts/ingest-content.ts). Every field maps onto a real content_items
// column or a real join table; there is no parallel "articles" data model.
//
// Data quality rule: for time-sensitive topics, every claim must be
// labelled by how certain it is (see ClaimStatus) and, where practical,
// backed by a SourceImport. A rumour must never be phrased as confirmed
// fact in `body`. Never write "we tested"/"in our testing"/"we found"
// unless a genuine evidence_records row with staff_hands_on_testing
// backs the claim — see src/lib/admin/evidence-test-types.ts.

import type { ContentProductRole, ContentRelationshipType, ContentStatus, ContentType, SearchIntent } from "@/lib/types/database";

export type ClaimStatus = "confirmed_fact" | "official_announcement" | "reputable_report" | "rumour" | "speculation";

export type ContentSourceImport = {
  url: string;
  publisher?: string;
  reliabilityTier?: "primary" | "secondary" | "community";
  // What this specific source supports, and how certain the resulting claim
  // is — lets a future editor see why a claim was published at what
  // confidence level, per the batch's provenance requirement.
  claimStatus?: ClaimStatus;
};

export type LinkedProductImport = {
  productSlug: string;
  role: ContentProductRole;
};

export type RelatedContentImport = {
  relatedSlug: string;
  type: ContentRelationshipType;
};

// taxonomy_tags has no per-category scoping (unlike spec_definitions) —
// just a slug and a display name. Content data files reference tags by
// slug via ContentImport.tagSlugs; any slug not already in the DB and not
// defined here fails validation rather than being silently auto-created
// with a guessed display name.
export type TagDefinitionImport = {
  slug: string;
  name: string;
};

export type ContentImport = {
  slug: string;
  title: string;
  type: ContentType;
  // Defaults to "draft" in the ingestion script if omitted — nothing is
  // auto-published. Set to "published" only for content that's genuinely
  // ready, with a real publishedAt.
  status?: ContentStatus;
  categorySlug?: string;
  searchIntent?: SearchIntent;
  primaryQuery?: string;
  intentFingerprint?: string;
  // Plain text — see src/lib/content/body-format.ts for the supported
  // "## "/"### " heading and "- " list conventions.
  body: string;
  publishedAt?: string;
  tagSlugs?: string[];
  linkedProducts?: LinkedProductImport[];
  relatedContent?: RelatedContentImport[];
  sources?: ContentSourceImport[];
  // Optional — maps onto the existing seo_metadata table (see
  // src/app/admin/(dashboard)/content/actions.ts updateContentSeo, the
  // established admin write path this mirrors exactly: upsert keyed on
  // content_id). Omitted entirely if neither field is set — an import
  // never creates an empty seo_metadata row just because the item exists.
  // Same trade-off as every other field on ContentImport: re-running this
  // import is a "sync from source data" operation, so a manual admin edit
  // to meta_title/meta_description that has since diverged from this file
  // WILL be overwritten by a later re-apply of the same file — no
  // different from title/body/category behaving the same way today. Once
  // an item is hand-edited going forward, stop including it (or keep this
  // field in sync) in future re-runs of the same data file.
  metaTitle?: string;
  metaDescription?: string;
};

export type ContentBatchImport = {
  content: ContentImport[];
  tagDefinitions?: TagDefinitionImport[];
};
