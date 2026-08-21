// Structured catalogue import definitions — the shape every product-import
// data file (manufacturer/family/product/spec/relationship/source) must
// conform to. This is the contract between hand-written or researched
// catalogue data and the ingestion script (scripts/ingest-catalogue.ts) —
// nothing here writes to the database directly, it's pure data shape.
//
// Design intent: an import is just a description of the SAME rows an admin
// could create by hand through /admin/products, /admin/manufacturers, etc.
// No parallel "catalogue" data model, no data embedded in React components —
// every field maps directly onto a real column in the applied schema
// (see supabase/migrations/ and src/lib/types/database.ts).
//
// Data quality rule (see CLAUDE.md / the batch instructions this exists
// for): every fact in a ProductImport must be traceable to a real source.
// releaseDate, status, and every spec value must come from genuine research
// (manufacturer spec pages preferred, per SourceImport.reliabilityTier),
// never invented or inferred. If a fact isn't verified, omit the field —
// an absent spec is honest; a guessed one is not.

import type {
  ProductStatus,
  RelationshipType,
  ReliabilityTier,
  SpecDataType,
} from "@/lib/types/database";

export type SourceImport = {
  url: string;
  publisher?: string;
  reliabilityTier?: ReliabilityTier;
};

// Matches spec_definitions — referenced by slug so the same definition
// (e.g. "effective-megapixels") is reused across every product that needs
// it rather than redefined per product. See CAMERA_SPEC_DEFINITIONS in
// src/lib/catalogue/camera-specs.ts for the canonical camera vocabulary.
export type SpecDefinitionImport = {
  slug: string;
  name: string;
  dataType: SpecDataType;
  unit?: string;
  // Scopes the definition to one taxonomy category (by slug). Omit for a
  // definition meaningful across categories.
  categorySlug?: string;
};

export type ProductSpecImport = {
  specSlug: string;
  value: string | number | boolean;
  // Per-spec provenance — most specs share the product's own `sources`,
  // but a spec pulled from a different/more specific source (e.g. a
  // teardown for weight vs. the official page for everything else) can
  // cite its own.
  sources?: SourceImport[];
};

export type ProductRelationshipImport = {
  // Slug of the OTHER product. Only ever create the forward-direction row
  // (e.g. "90d" -> relationship_type: "successor_of" -> target "80d" means
  // "90d is the successor of 80d") — the ingestion script never inserts a
  // reciprocal row; the app infers the reverse direction at query time,
  // exactly like the hand-built admin UI does.
  relatedProductSlug: string;
  type: RelationshipType;
};

export type ManufacturerImport = {
  slug: string;
  name: string;
  website?: string;
  description?: string;
};

export type ProductFamilyImport = {
  slug: string;
  name: string;
  categorySlug?: string;
  description?: string;
};

export type ProductImport = {
  slug: string;
  name: string;
  manufacturerSlug: string;
  categorySlug: string;
  familySlug?: string;
  modelNumber?: string;
  // ISO date (YYYY-MM-DD). Omit entirely if the exact date isn't confirmed
  // by a real source — never estimate from "the product appeared in an
  // article that year" or similar inference.
  releaseDate?: string;
  status?: ProductStatus;
  summary?: string;
  specs?: ProductSpecImport[];
  relationships?: ProductRelationshipImport[];
  // Provenance for the product's own facts (release date, status, summary
  // claims) — distinct from per-spec sources above.
  sources?: SourceImport[];
  // Defaults to false in the ingestion script — an import NEVER publishes
  // a product automatically. Publication is a deliberate, separate admin
  // decision, same as the hand-built admin UI.
  isPublished?: boolean;
  // Optional — maps onto the existing seo_metadata table (see
  // src/app/admin/(dashboard)/products/actions.ts updateProductSeo, the
  // established admin write path this mirrors exactly: upsert keyed on
  // product_id). Omitted entirely if neither field is set — an import
  // never creates an empty seo_metadata row just because the product
  // exists. Same trade-off as every other field on ProductImport:
  // re-running this import is a "sync from source data" operation, so a
  // manual admin edit to meta_title/meta_description that has since
  // diverged from this file WILL be overwritten by a later re-apply of the
  // same file — no different from summary/status behaving the same way
  // today. Once a product is hand-edited going forward, stop including it
  // (or keep this field in sync) in future re-runs of the same data file.
  metaTitle?: string;
  metaDescription?: string;
  // Optional — maps onto the (not-yet-applied, see
  // supabase/migrations_pending/20260821_product_launch_pricing.sql)
  // product_launch_pricing table. Distinct from the older
  // "launch-msrp-usd" spec_definition (still the only place USD launch
  // price actually lives for every existing product) — this is the
  // structured, multi-currency, provenance-carrying replacement going
  // forward. isEstimated must only ever be true for a deliberately-flagged
  // approximate/derived FX conversion, never the default for a genuinely
  // sourced regional price.
  launchPricing?: LaunchPricingImport[];
};

export type LaunchPricingImport = {
  currency: "USD" | "GBP" | "EUR";
  amount: number;
  isEstimated?: boolean;
  sourceUrl?: string;
  sourcePublisher?: string;
  note?: string;
};

export type CatalogueImport = {
  manufacturers?: ManufacturerImport[];
  specDefinitions?: SpecDefinitionImport[];
  productFamilies?: ProductFamilyImport[];
  products?: ProductImport[];
};
