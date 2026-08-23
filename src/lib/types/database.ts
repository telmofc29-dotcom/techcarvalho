// Hand-written types mirroring supabase/migrations/20260819202304_initial_schema.sql.
// No Supabase CLI is available in this environment to run `supabase gen types`, so
// these are maintained by hand. Keep in sync with the migration when the schema changes.

export type MediaType = "image" | "video";
export type ProductStatus = "active" | "discontinued" | "rumored";
// Widened by supabase/migrations_pending/20260827_knowledge_graph.sql. The
// original five are unchanged; six were added for the catalogue expansion.
//
// `predecessor` is deliberately absent: relationships are stored ONE
// DIRECTIONAL and the reverse is inferred at query time, so `successor_of`
// already expresses both directions. A predecessor value would let the same
// fact be stored twice and disagree with itself.
export type RelationshipType =
  | "successor_of"
  | "alternative_to"
  | "accessory_for"
  | "compatible_with"
  | "requires"
  | "same_family"
  | "modern_equivalent"
  | "mount_successor"
  | "requires_adapter"
  | "supports_extender"
  | "competes_with";

/**
 * How real a product is. Separate from ProductStatus, which is a catalogue
 * lifecycle field. 'unknown' means NOBODY HAS ASSESSED IT — never "does not
 * exist". For future-tech entries the gap between `announced` and
 * `commercially_available` is frequently the entire story.
 */
export type ProductMaturity =
  | "announced"
  | "demonstrated"
  | "prototype"
  | "pilot"
  | "production"
  | "commercially_available"
  | "discontinued"
  | "unknown";

/**
 * What KIND of source a record is. Orthogonal to ReliabilityTier, which is how
 * much weight it carries. A manufacturer spec page and an independent lab test
 * can both be 'primary' and are not the same claim.
 */
export type SourceClass =
  | "manufacturer_official"
  | "standards_body"
  | "primary_documentation"
  | "independent_publication"
  | "independent_test"
  | "retailer"
  | "community"
  | "unclassified";

/** Broad shape of a reusable explainable concept. */
export type TechnologyKind =
  | "mount"
  | "focus_motor"
  | "stabilisation"
  | "lens_line"
  | "optical_design"
  | "sensor"
  | "connectivity"
  | "printer_kinematics"
  | "printer_feature"
  | "material"
  | "compute"
  | "autonomy"
  | "standard"
  | "other";

/**
 * What kind of assertion a product_claims row is. A manufacturer claim is not
 * evidence: it has no tester, no conditions and no measurement.
 */
export type ProductClaimKind =
  | "manufacturer_performance"
  | "manufacturer_compatibility"
  | "manufacturer_marketing"
  | "third_party_measured";

export type DatePrecision = "day" | "month" | "year" | "unknown";

export type TechnologyRelationshipType =
  | "kind_of"
  | "succeeds"
  | "related_to"
  | "competes_with"
  | "requires";
export type SpecDataType = "text" | "number" | "boolean" | "enum";
// Added by supabase/migrations/20260825_product_owner_access.sql. Deliberately
// re-declared here rather than imported from src/lib/media/resolution.ts — this
// file has no imports at all (see the Locale note below) — but resolution.ts's
// OwnerAccess is the vocabulary of record and the CHECK constraint on
// public.products.owner_access is the source of truth. Keep all three in sync.
export type ProductOwnerAccess =
  | "owned"
  | "borrowable"
  | "retail_display"
  | "not_accessible"
  | "unknown";
// 'troubleshooting' added by supabase/migrations/20260820_content_troubleshooting_type.sql.
export type ContentType = "review" | "guide" | "comparison" | "news" | "troubleshooting";
// Widened by supabase/migrations/20260820_editorial_workflow_statuses.sql — the original
// 'draft' | 'published' | 'archived' remain valid; the five new values are pre-publication
// pipeline states. Only status = 'published' is ever publicly readable (see RLS).
// 'awaiting_media' added by supabase/migrations_pending/20260821_content_awaiting_media_status.sql
// — flags a record that is otherwise ready but blocked specifically on
// lacking legitimately-usable media (see the media-first publishing rule).
export type ContentStatus =
  | "idea"
  | "planned"
  | "draft"
  | "review"
  | "ready"
  | "published"
  | "needs_update"
  | "awaiting_media"
  | "archived";
export type ContentProductRole = "primary_subject" | "mentioned" | "compared_against";
// Added by supabase/migrations/20260824_translation_model.sql. Deliberately
// re-declared here rather than imported from src/lib/i18n/locales.ts: this file
// has no imports at all, and locales.ts is imported by the sitemap, metadata and
// the proxy. Keep the two in sync — LOCALES there is the vocabulary of record,
// and public.locales in the database is the row-level source of truth (four
// rows: en/pt/es/fr, en being is_source).
export type Locale = "en" | "pt" | "es" | "fr";
export type TranslationState = "draft" | "needs_review" | "ready" | "published" | "failed";
// Added by supabase/migrations/20260820_content_relationships.sql.
export type ContentRelationshipType = "pillar_of" | "supporting_of" | "related_to";
// Added by supabase/migrations/20260820_product_offers.sql.
export type AffiliateStatus = "affiliate" | "non_affiliate" | "pending";
// Drafted by supabase/migrations_pending/20260821_product_launch_pricing.sql — not yet applied to production.
export type LaunchPricingCurrency = "USD" | "GBP" | "EUR";
// Added by supabase/migrations/20260820_outbound_click_events.sql. Mirrors LinkPosition in
// src/lib/analytics/events.ts — keep both in sync if either changes.
export type OutboundClickLinkPosition =
  | "article_top"
  | "article_body"
  | "article_end"
  | "sidebar"
  | "product_page"
  | "manufacturer_page"
  | "category_page"
  | "nav"
  | "footer"
  | "search_results"
  | "related_content"
  // Added 2026-08-22 with the /families/ hub routes. The DB CHECK constraint
  // is widened by supabase/migrations_pending/20260822_outbound_family_page_position.sql
  // — until that is applied, clicks from a family hub are rejected at insert.
  | "family_page";
export type OutboundClickKind = "affiliate" | "outbound";
// Added by supabase/migrations_pending/20260821_first_party_analytics.sql —
// mirrors src/lib/analytics/events.ts's own vocabularies; keep both in sync
// if either changes.
export type AnalyticsDeviceType = "mobile" | "tablet" | "desktop";
export type AnalyticsEntityType = "product" | "content" | "manufacturer" | "category";
export type AnalyticsEventType =
  | "page_view"
  | "internal_link_click"
  | "related_content_click"
  | "navigation_click"
  | "search"
  | "search_result_click"
  | "scroll_depth"
  | "cta_click"
  | "outbound_link_click"
  | "affiliate_click";
export type AnalyticsRollupDimension = "category" | "product" | "content" | "manufacturer" | "search_term" | "path" | "site";
export type MediaRole = "hero" | "gallery" | "thumbnail";
export type ReliabilityTier = "primary" | "secondary" | "community";
// 'public_domain_or_cc' and 'tc_graphic' added by
// supabase/migrations_pending/20260821_media_sourcing_workflow.sql.
export type MediaSourceType =
  | "manufacturer"
  | "staff_photograph"
  | "stock_licensed"
  | "user_submitted"
  | "press_kit"
  | "public_domain_or_cc"
  | "tc_graphic"
  | "other";
// Pre-asset media sourcing workflow state — see media_requirements above
// and src/lib/media/requirements.ts.
export type MediaSourcingStatus = "needed" | "sourcing" | "available" | "blocked" | "approved";
export type MediaPublicationStatus = "private" | "published";
export type MediaRightsStatus = "unknown" | "pending_verification" | "verified" | "restricted";
// Added by supabase/migrations_pending/20260821_media_brand_role.sql — see
// that file's header for why this is one column rather than a separate
// is_brand_asset flag plus a role field.
export type MediaBrandRole =
  | "logo_full"
  | "logo_full_tagline"
  | "wordmark"
  | "wordmark_tagline"
  | "mark"
  | "favicon"
  | "og_image";
// Phase 5 editorial asset roles — see supabase/migrations_pending/20260822_phase5_trends_media.sql
export type MediaAssetRole =
  | "product_photo"
  | "article_hero"
  | "banner"
  | "category_hero"
  | "homepage_feature"
  | "background"
  | "diagram"
  | "chart"
  | "comparison_graphic"
  | "social_og"
  | "logo_brand"
  | "icon"
  | "screenshot";
// Drafted by supabase/migrations_pending/20260825_media_derivatives.sql.
// Mirrors CropName / DerivativeFormat in src/lib/media/derivatives.ts — keep
// the three in sync (the SQL CHECK, this union, and the TS type).
export type MediaDerivativeCrop = "natural" | "square" | "og";
export type MediaDerivativeFormat = "avif" | "webp" | "jpeg" | "png";
export type SearchIntent = "informational" | "commercial" | "transactional" | "navigational";

// ---- Growth Engine column unions (Phase 3) ----
// Mirrors the CHECK constraints in supabase/migrations_pending/20260821_growth_engine.sql.
// Declared here (rather than imported from src/lib/engine/types.ts) so this
// file stays dependency-free, matching how every other type here is defined.
export type EngineSourceTypeCol =
  | "manufacturer_newsroom"
  | "product_feed"
  | "rss_atom"
  | "official_docs"
  | "public_api"
  | "regulatory_dataset"
  | "trusted_editorial"
  | "other_approved";
export type EngineTrustLevel = "primary" | "secondary" | "community";
export type EngineMediaRightsStatus =
  | "unverified"
  | "confirmed_usable"
  | "requires_registration"
  | "unclear_manual_review"
  | "no_source_found"
  | "prohibited";
export type EngineDiscoveryType =
  | "product_launch"
  | "product_update"
  | "spec_change"
  | "firmware_release"
  | "technology_news"
  | "recall_or_security"
  | "new_topic";
export type EngineClaimStatus =
  | "confirmed_primary"
  | "reported_secondary"
  | "estimate"
  | "leak"
  | "rumour"
  | "unverified";
export type EnginePipelineState =
  | "discovered"
  | "researched"
  | "evidence_checked"
  | "planned"
  | "drafting"
  | "media_check"
  | "review_eligible"
  | "published"
  | "blocked"
  | "rejected"
  | "error";
export type EngineBriefState =
  | "planned"
  | "drafting"
  | "media_check"
  | "review_eligible"
  | "published"
  | "blocked"
  | "rejected"
  | "error";
export type EngineFreshnessReason =
  | "spec_changed"
  | "successor_released"
  | "discontinued"
  | "firmware_changed"
  | "stale_facts"
  | "stale_pricing"
  | "broken_source_link"
  | "outdated_comparison"
  | "missing_internal_links";
export type EngineSeverity = "low" | "medium" | "high";
export type EngineFreshnessState = "open" | "acknowledged" | "actioned" | "dismissed";

/** Mirrors the engine_update_proposals.reason check constraint. */
export type EngineUpdateReason =
  | "firmware_update"
  | "successor_released"
  | "discontinued"
  | "spec_change"
  | "price_change"
  | "newer_evidence"
  | "broken_source"
  // Age alone, with no new evidence behind it — raised by the freshness pass.
  | "stale_content";

export type EngineUpdateProposalState = "open" | "accepted" | "rejected" | "applied";

export type EngineResolutionDecision =
  | "matched_existing"
  | "new_entity"
  | "ambiguous"
  | "ignored";
export type EngineJobStatus = "running" | "success" | "partial" | "failed" | "skipped";
export type EngineOpportunitySubject = "category" | "topic" | "product" | "content" | "search_term";
// Added by supabase/migrations_pending/20260825_contact_messages.sql — not yet
// applied. Both vocabularies are CHECK constraints there; CONTACT_SUBJECTS in
// src/lib/contact/message.ts carries the reader-facing labels. Keep all three
// in sync.
export type ContactMessageSubject = "correction" | "sourcing" | "permissions" | "general";
export type ContactMessageStatus = "new" | "read" | "archived";

export interface Database {
  public: {
    Tables: {
      admin_users: {
        Row: {
          id: string;
          display_name: string | null;
          created_at: string;
        };
        Insert: {
          id: string;
          display_name?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["admin_users"]["Insert"]>;
        Relationships: [];
      };
      // Added by supabase/migrations_pending/20260825_author_profiles.sql —
      // NOT YET APPLIED, so this table does not exist in production yet and a
      // query against it currently fails rather than returning zero rows.
      //
      // Deliberately NOT admin_users. admin_users is the authorization table;
      // making it publicly readable would publish the site's admin membership
      // list as a side effect of wanting a byline. This is an opt-in editorial
      // identity, private until is_public is set.
      author_profiles: {
        Row: {
          /** 1:1 with admin_users.id. An author must be able to publish here. */
          id: string;
          display_name: string;
          role_title: string | null;
          /** Written by a person. Never generated, never credentials. */
          short_bio: string | null;
          /** Gates the anon SELECT policy. Default FALSE — publishing a real name is irreversible. */
          is_public: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          display_name: string;
          role_title?: string | null;
          short_bio?: string | null;
          is_public?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["author_profiles"]["Insert"]>;
        Relationships: [];
      };
      // Added by supabase/migrations_pending/20260825_contact_messages.sql —
      // NOT YET APPLIED.
      //
      // Contains third-party email addresses and unpublished messages. `anon`
      // has NO privilege on it at all: the only write path is the SECURITY
      // DEFINER function submit_contact_message() (see Functions below), and
      // reads are admin-only. There is no Insert path from the app.
      contact_messages: {
        Row: {
          id: string;
          name: string | null;
          email: string;
          /** Closed vocabulary — mirrors CONTACT_SUBJECTS in src/lib/contact/message.ts. */
          subject: ContactMessageSubject;
          message: string;
          page_path: string | null;
          status: ContactMessageStatus;
          created_at: string;
          handled_at: string | null;
          handled_by: string | null;
        };
        // Insert is typed for completeness only. Nothing in the app inserts
        // directly — anon cannot, and the admin UI has no reason to.
        Insert: {
          id?: string;
          name?: string | null;
          email: string;
          subject: ContactMessageSubject;
          message: string;
          page_path?: string | null;
          status?: ContactMessageStatus;
          created_at?: string;
          handled_at?: string | null;
          handled_by?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["contact_messages"]["Insert"]>;
        Relationships: [];
      };
      media_assets: {
        Row: {
          id: string;
          storage_path: string;
          media_type: MediaType;
          alt_text: string | null;
          width: number | null;
          height: number | null;
          license: string | null;
          attribution: string | null;
          created_at: string;
          // Added by supabase/migrations_pending/20260819_content_media_extensions_and_storage.sql,
          // applied to production.
          caption: string | null;
          source_type: MediaSourceType | null;
          creator: string | null;
          source_url: string | null;
          attribution_required: boolean;
          ai_generated: boolean;
          owned: boolean;
          publication_status: MediaPublicationStatus;
          public_storage_path: string | null;
          published_at: string | null;
          published_by: string | null;
          rights_status: MediaRightsStatus;
          // Added by supabase/migrations_pending/20260821_media_brand_role.sql.
          // Non-null = this is a site-brand asset (logo/mark/favicon/OG
          // source), distinct from product/article/editorial media; the
          // value is its specific intended role.
          brand_role: MediaBrandRole | null;
          // Phase 5 editorial role — broader than brand_role, lets the library
          // be filtered and reused instead of being an undifferentiated pile.
          asset_role: MediaAssetRole | null;
          // Added by supabase/migrations_pending/20260825_media_derivatives.sql
          // — NOT YET APPLIED, so these read as undefined on a live row today.
          // Whether the licence permits ALTERING the image (watermarking,
          // re-cropping). null means NOBODY HAS ASSESSED IT and is never
          // treated as permission — see modificationPermission() in
          // src/lib/media/derivatives.ts. Distinct from whether the licence
          // permits reuse, which `license`/`rights_status` already cover.
          licence_permits_modification: boolean | null;
          licence_modification_note: string | null;
          licence_modification_assessed_at: string | null;
          licence_modification_assessed_by: string | null;
        };
        Insert: {
          id?: string;
          storage_path: string;
          media_type: MediaType;
          alt_text?: string | null;
          width?: number | null;
          height?: number | null;
          license?: string | null;
          attribution?: string | null;
          created_at?: string;
          caption?: string | null;
          source_type?: MediaSourceType | null;
          creator?: string | null;
          source_url?: string | null;
          attribution_required?: boolean;
          ai_generated?: boolean;
          owned?: boolean;
          publication_status?: MediaPublicationStatus;
          public_storage_path?: string | null;
          published_at?: string | null;
          published_by?: string | null;
          rights_status?: MediaRightsStatus;
          brand_role?: MediaBrandRole | null;
          asset_role?: MediaAssetRole | null;
          licence_permits_modification?: boolean | null;
          licence_modification_note?: string | null;
          licence_modification_assessed_at?: string | null;
          licence_modification_assessed_by?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["media_assets"]["Insert"]>;
        Relationships: [];
      };
      // Drafted by supabase/migrations_pending/20260825_media_derivatives.sql —
      // NOT YET APPLIED. Derived renditions of a media asset (responsive
      // widths x formats x crops). Never holds the master, which stays at
      // media_assets.storage_path; the table's own CHECK enforces that every
      // storage_path here is under 'derivatives/'.
      media_derivatives: {
        Row: {
          id: string;
          media_asset_id: string;
          crop: MediaDerivativeCrop;
          width: number;
          height: number | null;
          format: MediaDerivativeFormat;
          storage_path: string;
          public_storage_path: string | null;
          watermarked: boolean;
          bytes: number | null;
          content_hash: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          media_asset_id: string;
          crop: MediaDerivativeCrop;
          width: number;
          height?: number | null;
          format: MediaDerivativeFormat;
          storage_path: string;
          public_storage_path?: string | null;
          watermarked?: boolean;
          bytes?: number | null;
          content_hash?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["media_derivatives"]["Insert"]>;
        Relationships: [];
      };
      taxonomy_categories: {
        Row: {
          id: string;
          parent_id: string | null;
          name: string;
          slug: string;
          description: string | null;
          sort_order: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          parent_id?: string | null;
          name: string;
          slug: string;
          description?: string | null;
          sort_order?: number;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["taxonomy_categories"]["Insert"]>;
        Relationships: [];
      };
      taxonomy_tags: {
        Row: {
          id: string;
          name: string;
          slug: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          slug: string;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["taxonomy_tags"]["Insert"]>;
        Relationships: [];
      };
      manufacturers: {
        Row: {
          id: string;
          name: string;
          slug: string;
          website: string | null;
          description: string | null;
          logo_media_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          slug: string;
          website?: string | null;
          description?: string | null;
          logo_media_id?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["manufacturers"]["Insert"]>;
        Relationships: [];
      };
      product_families: {
        Row: {
          id: string;
          category_id: string | null;
          name: string;
          slug: string;
          description: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          category_id?: string | null;
          name: string;
          slug: string;
          description?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["product_families"]["Insert"]>;
        Relationships: [];
      };
      products: {
        Row: {
          id: string;
          manufacturer_id: string;
          category_id: string;
          family_id: string | null;
          name: string;
          slug: string;
          model_number: string | null;
          release_date: string | null;
          status: ProductStatus;
          summary: string | null;
          is_published: boolean;
          // Added by supabase/migrations/20260825_product_owner_access.sql, applied to
          // production. NOT NULL with default 'unknown', which means NOBODY HAS ASSESSED
          // IT — never "cannot be photographed".
          owner_access: ProductOwnerAccess;
          owner_access_note: string | null;
          owner_access_set_at: string | null;
          // Added by supabase/migrations_pending/20260827_knowledge_graph.sql.
          maturity: ProductMaturity;
          /** 'month' means release_date's day is a storage artefact — do not display it. */
          release_date_precision: DatePrecision;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          manufacturer_id: string;
          category_id: string;
          family_id?: string | null;
          name: string;
          slug: string;
          model_number?: string | null;
          release_date?: string | null;
          status?: ProductStatus;
          summary?: string | null;
          is_published?: boolean;
          owner_access?: ProductOwnerAccess;
          owner_access_note?: string | null;
          owner_access_set_at?: string | null;
          maturity?: ProductMaturity;
          release_date_precision?: DatePrecision;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["products"]["Insert"]>;
        Relationships: [];
      };
      product_relationships: {
        Row: {
          id: string;
          product_id: string;
          related_product_id: string;
          relationship_type: RelationshipType;
          /** Why this edge is asserted. A successor is never inferred from specs alone. */
          basis: string | null;
          source_url: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          product_id: string;
          related_product_id: string;
          relationship_type: RelationshipType;
          basis?: string | null;
          source_url?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["product_relationships"]["Insert"]>;
        Relationships: [];
      };
      product_tags: {
        Row: { product_id: string; tag_id: string };
        Insert: { product_id: string; tag_id: string };
        Update: Partial<Database["public"]["Tables"]["product_tags"]["Insert"]>;
        Relationships: [];
      };
      // Added by supabase/migrations/20260820_product_offers.sql, applied to production.
      product_offers: {
        Row: {
          id: string;
          product_id: string;
          retailer: string;
          url: string;
          affiliate_status: AffiliateStatus;
          price_note: string | null;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          product_id: string;
          retailer: string;
          url: string;
          affiliate_status?: AffiliateStatus;
          price_note?: string | null;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["product_offers"]["Insert"]>;
        Relationships: [];
      };
      // Drafted by supabase/migrations_pending/20260821_product_launch_pricing.sql —
      // not yet applied to production. Historical launch MSRP, structured per
      // currency, distinct from product_offers (current retailer pricing).
      product_launch_pricing: {
        Row: {
          id: string;
          product_id: string;
          currency: LaunchPricingCurrency;
          amount: number;
          is_estimated: boolean;
          source_url: string | null;
          source_publisher: string | null;
          note: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          product_id: string;
          currency: LaunchPricingCurrency;
          amount: number;
          is_estimated?: boolean;
          source_url?: string | null;
          source_publisher?: string | null;
          note?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["product_launch_pricing"]["Insert"]>;
        Relationships: [];
      };
      spec_definitions: {
        Row: {
          id: string;
          category_id: string | null;
          name: string;
          slug: string;
          data_type: SpecDataType;
          unit: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          category_id?: string | null;
          name: string;
          slug: string;
          data_type: SpecDataType;
          unit?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["spec_definitions"]["Insert"]>;
        Relationships: [];
      };
      product_specs: {
        Row: {
          id: string;
          product_id: string;
          spec_definition_id: string;
          value: unknown;
          created_at: string;
        };
        Insert: {
          id?: string;
          product_id: string;
          spec_definition_id: string;
          value: unknown;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["product_specs"]["Insert"]>;
        Relationships: [];
      };
      content_items: {
        Row: {
          id: string;
          type: ContentType;
          title: string;
          slug: string;
          body: string | null;
          status: ContentStatus;
          author_id: string | null;
          published_at: string | null;
          created_at: string;
          updated_at: string;
          // Added by supabase/migrations_pending/20260819_content_media_extensions_and_storage.sql,
          // applied to production.
          category_id: string | null;
          search_intent: SearchIntent | null;
          primary_query: string | null;
          intent_fingerprint: string | null;
          // Added by supabase/migrations/20260824_translation_model.sql, applied to
          // production. Identity/fact stays single-valued site-wide; only these
          // per-locale columns exist, so a product name cannot be translated even
          // by trying. See that migration's header.
          locale: Locale;
          /** The editorial family. Every language variant of one piece shares this. */
          translation_group_id: string;
          /** The row this was translated FROM. NULL on a source-language row. */
          source_content_id: string | null;
          /** Bumped by trigger ONLY when title or body change. NOT updated_at. */
          translatable_revision: number;
          /** The source revision this translation was made from. */
          source_revision_seen: number | null;
          translation_state: TranslationState | null;
          translated_at: string | null;
          translation_reviewed_by: string | null;
        };
        Insert: {
          id?: string;
          type: ContentType;
          title: string;
          slug: string;
          body?: string | null;
          status?: ContentStatus;
          author_id?: string | null;
          published_at?: string | null;
          created_at?: string;
          updated_at?: string;
          category_id?: string | null;
          search_intent?: SearchIntent | null;
          primary_query?: string | null;
          intent_fingerprint?: string | null;
          locale?: Locale;
          // OPTIONAL in the type but NOT in the database: the column is NOT NULL
          // with no default, and the BEFORE INSERT trigger that would supply one
          // lives in supabase/migrations_pending/20260825_translation_group_default.sql,
          // which is NOT applied. Until it is, every insert that omits this fails
          // with 23502. createTranslation() in
          // src/app/admin/(dashboard)/translations/actions.ts therefore always
          // sets it explicitly — which is the correct behaviour anyway, because a
          // translation must join its SOURCE's family rather than self-root.
          translation_group_id?: string;
          source_content_id?: string | null;
          translatable_revision?: number;
          source_revision_seen?: number | null;
          translation_state?: TranslationState | null;
          translated_at?: string | null;
          translation_reviewed_by?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["content_items"]["Insert"]>;
        Relationships: [];
      };
      // Added by supabase/migrations/20260824_translation_model.sql, applied to
      // production. A table rather than an enum so adding a language does not
      // require an ALTER TYPE on a live database. World-readable; admin-write.
      locales: {
        Row: {
          code: Locale;
          label: string;
          /** BCP-47 tag for hreflang and <html lang>. Unregioned on purpose. */
          bcp47: string;
          /** Exactly one row has this true (unique partial index). */
          is_source: boolean;
          sort_order: number;
        };
        Insert: {
          code: string;
          label: string;
          bcp47: string;
          is_source?: boolean;
          sort_order?: number;
        };
        Update: Partial<Database["public"]["Tables"]["locales"]["Insert"]>;
        Relationships: [];
      };
      content_tags: {
        Row: { content_id: string; tag_id: string };
        Insert: { content_id: string; tag_id: string };
        Update: Partial<Database["public"]["Tables"]["content_tags"]["Insert"]>;
        Relationships: [];
      };
      // Added by supabase/migrations/20260820_content_relationships.sql, applied to
      // production. Directional, mirrors product_relationships — reverse direction is
      // inferred at query time (content_id = X OR related_content_id = X), never inserted.
      content_relationships: {
        Row: {
          id: string;
          content_id: string;
          related_content_id: string;
          relationship_type: ContentRelationshipType;
          created_at: string;
        };
        Insert: {
          id?: string;
          content_id: string;
          related_content_id: string;
          relationship_type: ContentRelationshipType;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["content_relationships"]["Insert"]>;
        Relationships: [];
      };
      content_products: {
        Row: {
          id: string;
          content_id: string;
          product_id: string;
          role: ContentProductRole;
          created_at: string;
        };
        Insert: {
          id?: string;
          content_id: string;
          product_id: string;
          role: ContentProductRole;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["content_products"]["Insert"]>;
        Relationships: [];
      };
      product_media: {
        Row: {
          id: string;
          product_id: string;
          media_id: string;
          role: MediaRole;
          sort_order: number;
        };
        Insert: {
          id?: string;
          product_id: string;
          media_id: string;
          role: MediaRole;
          sort_order?: number;
        };
        Update: Partial<Database["public"]["Tables"]["product_media"]["Insert"]>;
        Relationships: [];
      };
      content_media: {
        Row: {
          id: string;
          content_id: string;
          media_id: string;
          role: MediaRole;
          sort_order: number;
        };
        Insert: {
          id?: string;
          content_id: string;
          media_id: string;
          role: MediaRole;
          sort_order?: number;
        };
        Update: Partial<Database["public"]["Tables"]["content_media"]["Insert"]>;
        Relationships: [];
      };
      // Added by supabase/migrations_pending/20260821_media_sourcing_workflow.sql
      // — tracks the pre-asset media sourcing workflow (see src/lib/media/requirements.ts).
      media_requirements: {
        Row: {
          id: string;
          product_id: string | null;
          content_id: string | null;
          sourcing_status: MediaSourcingStatus;
          target_source_type: MediaSourceType | null;
          notes: string | null;
          resolved_media_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          product_id?: string | null;
          content_id?: string | null;
          sourcing_status?: MediaSourcingStatus;
          target_source_type?: MediaSourceType | null;
          notes?: string | null;
          resolved_media_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["media_requirements"]["Insert"]>;
        Relationships: [];
      };
      evidence_records: {
        Row: {
          id: string;
          product_id: string | null;
          content_id: string | null;
          test_type: string;
          conditions: string | null;
          result_summary: string;
          raw_data: unknown;
          tested_by: string | null;
          tested_at: string;
        };
        Insert: {
          id?: string;
          product_id?: string | null;
          content_id?: string | null;
          test_type: string;
          conditions?: string | null;
          result_summary: string;
          raw_data?: unknown;
          tested_by?: string | null;
          tested_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["evidence_records"]["Insert"]>;
        Relationships: [];
      };
      source_records: {
        Row: {
          id: string;
          product_id: string | null;
          content_id: string | null;
          product_spec_id: string | null;
          url: string;
          publisher: string | null;
          retrieved_at: string;
          reliability_tier: ReliabilityTier;
          /** Added by 20260827_knowledge_graph.sql. NOT a reliability measure. */
          source_class: SourceClass;
          created_at: string;
        };
        Insert: {
          id?: string;
          product_id?: string | null;
          content_id?: string | null;
          product_spec_id?: string | null;
          url: string;
          publisher?: string | null;
          retrieved_at?: string;
          reliability_tier?: ReliabilityTier;
          source_class?: SourceClass;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["source_records"]["Insert"]>;
        Relationships: [];
      };
      freshness_log: {
        Row: {
          id: string;
          product_id: string | null;
          content_id: string | null;
          reviewed_by: string | null;
          reviewed_at: string;
          reason: string;
        };
        Insert: {
          id?: string;
          product_id?: string | null;
          content_id?: string | null;
          reviewed_by?: string | null;
          reviewed_at?: string;
          reason: string;
        };
        Update: Partial<Database["public"]["Tables"]["freshness_log"]["Insert"]>;
        Relationships: [];
      };
      seo_metadata: {
        Row: {
          id: string;
          product_id: string | null;
          content_id: string | null;
          category_id: string | null;
          meta_title: string | null;
          meta_description: string | null;
          canonical_url: string | null;
          og_media_id: string | null;
          noindex: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          product_id?: string | null;
          content_id?: string | null;
          category_id?: string | null;
          meta_title?: string | null;
          meta_description?: string | null;
          canonical_url?: string | null;
          og_media_id?: string | null;
          noindex?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["seo_metadata"]["Insert"]>;
        Relationships: [];
      };
      // Added by supabase/migrations/20260820_outbound_click_events.sql, applied to
      // production. Anonymous-insert-only, admin-read-only — see the migration's header
      // comment for the full RLS/abuse-mitigation design. No PII columns.
      outbound_click_events: {
        Row: {
          id: string;
          created_at: string;
          kind: OutboundClickKind;
          retailer: string | null;
          destination_domain: string;
          link_position: OutboundClickLinkPosition;
          product_id: string | null;
          content_id: string | null;
        };
        Insert: {
          id?: string;
          created_at?: string;
          kind: OutboundClickKind;
          retailer?: string | null;
          destination_domain: string;
          link_position: OutboundClickLinkPosition;
          product_id?: string | null;
          content_id?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["outbound_click_events"]["Insert"]>;
        Relationships: [];
      };
      // Added by supabase/migrations_pending/20260821_first_party_analytics.sql
      // — TechCarvalho's own first-party session/event analytics, separate from
      // outbound_click_events (see that migration's header for the full
      // three-privacy-tier design). anon insert-only, admin-read-only.
      analytics_visitors: {
        Row: { id: string; first_seen_at: string; last_seen_at: string };
        Insert: { id?: string; first_seen_at?: string; last_seen_at?: string };
        Update: Partial<Database["public"]["Tables"]["analytics_visitors"]["Insert"]>;
        Relationships: [];
      };
      analytics_sessions: {
        Row: {
          id: string;
          visitor_id: string | null;
          started_at: string;
          last_seen_at: string;
          entry_path: string;
          referrer_host: string | null;
          utm_source: string | null;
          utm_medium: string | null;
          utm_campaign: string | null;
          device_type: AnalyticsDeviceType | null;
          is_admin: boolean;
        };
        Insert: {
          id?: string;
          visitor_id?: string | null;
          started_at?: string;
          last_seen_at?: string;
          entry_path: string;
          referrer_host?: string | null;
          utm_source?: string | null;
          utm_medium?: string | null;
          utm_campaign?: string | null;
          device_type?: AnalyticsDeviceType | null;
          is_admin?: boolean;
        };
        Update: Partial<Database["public"]["Tables"]["analytics_sessions"]["Insert"]>;
        Relationships: [];
      };
      analytics_events: {
        Row: {
          id: string;
          session_id: string;
          event_type: AnalyticsEventType;
          path: string;
          entity_type: AnalyticsEntityType | null;
          product_id: string | null;
          content_id: string | null;
          manufacturer_id: string | null;
          category_slug: string | null;
          metadata: Record<string, unknown>;
          created_at: string;
        };
        Insert: {
          id?: string;
          session_id: string;
          event_type: AnalyticsEventType;
          path: string;
          entity_type?: AnalyticsEntityType | null;
          product_id?: string | null;
          content_id?: string | null;
          manufacturer_id?: string | null;
          category_slug?: string | null;
          metadata?: Record<string, unknown>;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["analytics_events"]["Insert"]>;
        Relationships: [];
      };
      analytics_daily_rollups: {
        Row: {
          day: string;
          dimension_type: AnalyticsRollupDimension;
          dimension_key: string;
          sessions: number;
          page_views: number;
          event_count: number;
          outbound_clicks: number;
          affiliate_clicks: number;
          computed_at: string;
        };
        Insert: {
          day: string;
          dimension_type: AnalyticsRollupDimension;
          dimension_key: string;
          sessions?: number;
          page_views?: number;
          event_count?: number;
          outbound_clicks?: number;
          affiliate_clicks?: number;
          computed_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["analytics_daily_rollups"]["Insert"]>;
        Relationships: [];
      };
      // ---- Growth Engine (Phase 3) ----
      // See supabase/migrations_pending/20260821_growth_engine.sql. All engine
      // tables are admin-only via RLS; the scheduled jobs never read them
      // directly, they go through SECURITY DEFINER RPCs (Functions below).
      engine_settings: {
        Row: {
          id: boolean;
          master_enabled: boolean;
          discovery_enabled: boolean;
          research_enabled: boolean;
          freshness_enabled: boolean;
          opportunity_scoring_enabled: boolean;
          autonomous_publishing_enabled: boolean;
          notes: string | null;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["engine_settings"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["engine_settings"]["Row"]>;
        Relationships: [];
      };
      engine_sources: {
        Row: {
          id: string;
          organisation: string;
          url: string;
          source_type: EngineSourceTypeCol;
          categories: string[];
          trust_level: EngineTrustLevel;
          is_active: boolean;
          // Deliberately separate from media_republication_permitted:
          // permission to read facts never implies permission to reuse imagery.
          discovery_permitted: boolean;
          media_republication_permitted: boolean;
          media_rights_status: EngineMediaRightsStatus;
          terms_url: string | null;
          terms_notes: string | null;
          attribution_required: boolean;
          attribution_text: string | null;
          check_frequency_hours: number;
          last_checked_at: string | null;
          last_success_at: string | null;
          consecutive_failures: number;
          last_error: string | null;
          created_at: string;
          updated_at: string;
          // Phase 5: a THIRD, independent permission. Being allowed to browse
          // an image library is not permission to republish what is in it.
          media_browsing_permitted: boolean;
          editorial_use_only: boolean;
          registration_required: boolean;
          last_reviewed_at: string | null;
          reviewed_by: string | null;
        };
        Insert: {
          id?: string;
          organisation: string;
          url: string;
          source_type: EngineSourceTypeCol;
          categories?: string[];
          trust_level?: EngineTrustLevel;
          is_active?: boolean;
          discovery_permitted?: boolean;
          media_republication_permitted?: boolean;
          media_rights_status?: EngineMediaRightsStatus;
          terms_url?: string | null;
          terms_notes?: string | null;
          attribution_required?: boolean;
          attribution_text?: string | null;
          check_frequency_hours?: number;
          last_checked_at?: string | null;
          last_success_at?: string | null;
          consecutive_failures?: number;
          last_error?: string | null;
          // The migration defines these with `default now()` but no trigger,
          // so updated_at only advances if a writer sets it explicitly.
          created_at?: string;
          updated_at?: string;
          media_browsing_permitted?: boolean;
          editorial_use_only?: boolean;
          registration_required?: boolean;
          last_reviewed_at?: string | null;
          reviewed_by?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["engine_sources"]["Insert"]>;
        Relationships: [];
      };
      engine_discoveries: {
        Row: {
          id: string;
          dedupe_key: string;
          title: string;
          summary: string | null;
          discovery_type: EngineDiscoveryType;
          category_slug: string | null;
          product_id: string | null;
          content_id: string | null;
          manufacturer_id: string | null;
          confidence: number;
          claim_status: EngineClaimStatus;
          state: EnginePipelineState;
          state_reason: string | null;
          first_seen_at: string;
          last_seen_at: string;
          sighting_count: number;
          created_at: string;
          updated_at: string;
          // Phase 4 relevance stage.
          relevance_verdict: "relevant" | "rejected" | "uncertain" | null;
          relevance_score: number | null;
          relevance_explanation: string | null;
          suggested_angle: string | null;
          relevance_overridden_by_admin: boolean;
        };
        Insert: Partial<Database["public"]["Tables"]["engine_discoveries"]["Row"]> & {
          dedupe_key: string;
          title: string;
          discovery_type: string;
        };
        Update: Partial<Database["public"]["Tables"]["engine_discoveries"]["Row"]>;
        Relationships: [];
      };
      engine_discovery_evidence: {
        Row: {
          id: string;
          discovery_id: string;
          source_id: string | null;
          url: string;
          publisher: string | null;
          excerpt: string | null;
          claim_status: EngineClaimStatus;
          trust_level: EngineTrustLevel;
          // Non-null means this source is repeating someone else's claim, so
          // it is excluded from corroboration — see confidence.ts.
          originates_from_url: string | null;
          // Added by supabase/migrations_pending/20260823_engine_evidence_provenance.sql.
          // false means NOBODY LOOKED for an upstream citation, which is not the
          // same as "this source is original" — independence.ts counts an
          // unexamined source at half corroboration weight for exactly that reason.
          origin_examined: boolean;
          retrieved_at: string;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["engine_discovery_evidence"]["Row"]> & {
          discovery_id: string;
          url: string;
        };
        Update: Partial<Database["public"]["Tables"]["engine_discovery_evidence"]["Row"]>;
        Relationships: [];
      };
      engine_opportunities: {
        Row: {
          id: string;
          subject_type: EngineOpportunitySubject;
          subject_key: string;
          label: string;
          score: number | null;
          inputs: Record<string, unknown>;
          explanation: string;
          discovery_id: string | null;
          computed_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["engine_opportunities"]["Row"]> & {
          subject_type: string;
          subject_key: string;
          label: string;
          explanation: string;
        };
        Update: Partial<Database["public"]["Tables"]["engine_opportunities"]["Row"]>;
        Relationships: [];
      };
      engine_briefs: {
        Row: {
          id: string;
          discovery_id: string | null;
          opportunity_id: string | null;
          proposed_title: string;
          proposed_slug: string | null;
          content_type: string | null;
          search_intent: string | null;
          primary_query: string | null;
          category_slug: string | null;
          rationale: string;
          related_product_slugs: string[];
          related_content_slugs: string[];
          media_requirement_note: string | null;
          state: EngineBriefState;
          state_reason: string | null;
          content_id: string | null;
          created_at: string;
          updated_at: string;
          // Phase 4 structured-brief fields.
          primary_question: string | null;
          supporting_questions: string[];
          verified_facts: string[];
          uncertainties: string[];
          source_urls: string[];
          suggested_structure: string[];
          freshness_sensitivity: "breaking" | "time_sensitive" | "evergreen" | null;
          brief_kind: string | null;
          priority: number | null;
          review_state: "pending" | "approved" | "rejected" | "snoozed" | "research_requested";
          review_note: string | null;
          snoozed_until: string | null;
          reviewed_at: string | null;
          // Phase 6 — 20260822_phase6_draft_assembly.sql. Links a brief to the
          // draft it produced. `assembled_content_id` is null for every brief
          // that has not been assembled, which is what makes "approved but not
          // yet drafted" distinguishable from "drafted".
          assembled_content_id: string | null;
          assembled_at: string | null;
          assembly_note: string | null;
        };
        Insert: Partial<Database["public"]["Tables"]["engine_briefs"]["Row"]> & {
          proposed_title: string;
          rationale: string;
        };
        Update: Partial<Database["public"]["Tables"]["engine_briefs"]["Row"]>;
        Relationships: [];
      };
      engine_freshness_reviews: {
        Row: {
          id: string;
          product_id: string | null;
          content_id: string | null;
          reason: EngineFreshnessReason;
          detail: string | null;
          severity: EngineSeverity;
          state: EngineFreshnessState;
          detected_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["engine_freshness_reviews"]["Row"]> & {
          reason: string;
        };
        Update: Partial<Database["public"]["Tables"]["engine_freshness_reviews"]["Row"]>;
        Relationships: [];
      };
      // Phase 6 — 20260822_phase6_draft_assembly.sql.
      // New evidence about an EXISTING page becomes a proposal against that
      // page, not a second article about the same thing.
      engine_update_proposals: {
        Row: {
          id: string;
          content_id: string | null;
          product_id: string | null;
          discovery_id: string | null;
          reason: EngineUpdateReason;
          summary: string;
          proposed_changes: string[];
          evidence_urls: string[];
          confidence: number;
          state: EngineUpdateProposalState;
          state_reason: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["engine_update_proposals"]["Row"]> & {
          reason: string;
          summary: string;
        };
        Update: Partial<Database["public"]["Tables"]["engine_update_proposals"]["Row"]>;
        Relationships: [];
      };
      // Audit log for entity matching, so a wrong merge can be reversed and
      // "why didn't this create a record?" has an answer.
      engine_entity_resolutions: {
        Row: {
          id: string;
          discovery_id: string | null;
          candidate_name: string;
          normalised_name: string;
          matched_product_id: string | null;
          matched_content_id: string | null;
          match_score: number | null;
          decision: EngineResolutionDecision;
          explanation: string;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["engine_entity_resolutions"]["Row"]> & {
          candidate_name: string;
          normalised_name: string;
          decision: string;
          explanation: string;
        };
        Update: Partial<Database["public"]["Tables"]["engine_entity_resolutions"]["Row"]>;
        Relationships: [];
      };
      engine_trends: {
        Row: {
          id: string;
          topic_key: string;
          label: string;
          category_slug: string | null;
          trend_score: number | null;
          confidence: number;
          velocity: number | null;
          contributing_signals: Record<string, unknown>;
          why_trending: string;
          first_detected_at: string;
          last_observed_at: string;
          observation_count: number;
          recommended_content_type: string | null;
          related_product_ids: string[];
          related_content_ids: string[];
          has_published_coverage: boolean;
          is_active: boolean;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["engine_trends"]["Row"]> & {
          topic_key: string;
          label: string;
          why_trending: string;
        };
        Update: Partial<Database["public"]["Tables"]["engine_trends"]["Row"]>;
        Relationships: [];
      };
      engine_media_candidates: {
        Row: {
          id: string;
          media_requirement_id: string | null;
          product_id: string | null;
          content_id: string | null;
          source_id: string | null;
          source_organisation: string | null;
          source_url: string | null;
          asset_url: string | null;
          asset_type: "image" | "video" | "generated" | null;
          width: number | null;
          height: number | null;
          potential_licence: string | null;
          attribution_required: boolean;
          attribution_text: string | null;
          rights_status: EngineMediaRightsStatus;
          // Defaults TRUE. Only cleared for source classes whose terms are
          // already established (our own graphics, staff photography).
          requires_human_review: boolean;
          confidence: number;
          state: "discovered" | "rights_review" | "approved" | "rejected" | "ingested" | "associated";
          state_reason: string | null;
          ingested_media_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["engine_media_candidates"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["engine_media_candidates"]["Row"]>;
        Relationships: [];
      };
      homepage_overrides: {
        Row: {
          id: string;
          content_id: string;
          mode: "pin_lead" | "pin_supporting" | "suppress";
          note: string | null;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["homepage_overrides"]["Row"]> & {
          content_id: string;
          mode: "pin_lead" | "pin_supporting" | "suppress";
        };
        Update: Partial<Database["public"]["Tables"]["homepage_overrides"]["Row"]>;
        Relationships: [];
      };
      search_intelligence: {
        Row: {
          id: string;
          normalised_query: string;
          display_query: string;
          search_count: number;
          zero_result_count: number;
          click_count: number;
          last_seen_at: string;
          first_seen_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["search_intelligence"]["Row"]> & {
          normalised_query: string;
          display_query: string;
        };
        Update: Partial<Database["public"]["Tables"]["search_intelligence"]["Row"]>;
        Relationships: [];
      };
      engine_job_runs: {
        Row: {
          id: string;
          job_name: string;
          idempotency_key: string | null;
          status: EngineJobStatus;
          started_at: string;
          finished_at: string | null;
          items_examined: number;
          items_created: number;
          items_deduped: number;
          items_failed: number;
          detail: Record<string, unknown>;
          error: string | null;
        };
        Insert: Partial<Database["public"]["Tables"]["engine_job_runs"]["Row"]> & { job_name: string };
        Update: Partial<Database["public"]["Tables"]["engine_job_runs"]["Row"]>;
        Relationships: [];
      };
    };
    Views: { [_ in never]: never };
    Functions: {
      // Added by supabase/migrations_pending/20260825_contact_messages.sql —
      // NOT YET APPLIED. The ONLY write path into contact_messages: `anon` has
      // no privilege on that table and no insert policy exists for any role.
      // Returns {ok: true, id} or {ok: false, reason} — a rejected message is a
      // normal result, not an error, so the form can explain it to the sender.
      submit_contact_message: {
        Args: {
          p_name: string | null;
          p_email: string;
          p_subject: string;
          p_message: string;
          p_page_path?: string | null;
        };
        Returns: { ok: boolean; reason?: string; id?: string };
      };
      compute_analytics_rollup: {
        Args: { target_day: string };
        Returns: void;
      };
      analytics_session_under_rate_limit: {
        Args: { p_session_id: string; p_max_per_minute: number };
        Returns: boolean;
      };
      record_analytics_touch: {
        Args: {
          p_visitor_id: string;
          p_session_id: string;
          p_now: string;
          p_is_new_session: boolean;
          p_entry_path: string | null;
          p_referrer_host: string | null;
          p_utm_source: string | null;
          p_utm_medium: string | null;
          p_utm_campaign: string | null;
          p_device_type: string | null;
        };
        Returns: void;
      };
      // Growth Engine RPCs — see supabase/migrations_pending/20260821_growth_engine.sql
      // and _growth_engine_rpcs.sql. All are SECURITY DEFINER and anon-callable
      // because scheduled jobs run without cookies; each re-checks the engine
      // kill switch internally.
      compute_analytics_rollup_guarded: {
        Args: { target_day: string; cooldown_minutes?: number };
        Returns: string;
      };
      engine_flag_enabled: {
        Args: { p_flag: string };
        Returns: boolean;
      };
      engine_record_job_run: {
        Args: {
          p_job_name: string;
          p_status: string;
          p_items_examined?: number;
          p_items_created?: number;
          p_items_deduped?: number;
          p_items_failed?: number;
          p_detail?: unknown;
          p_error?: string | null;
          // Added by 20260822_silent_success_telemetry.sql. Optional here
          // because src/lib/engine/cron.ts falls back to the 8-argument call
          // while that migration is still pending, so both shapes must typecheck.
          p_verified_writes?: number | null;
          p_silent_no_ops?: number | null;
          p_unverified_writes?: number | null;
          p_blind_writes?: number | null;
          // Added by 20260823b_queue_probe_fixes.sql. Optional for the same
          // reason as the four above: cron.ts walks a fallback ladder while the
          // migration is pending, so every rung must typecheck.
          p_stage_outcome?: string | null;
          p_outcome_ambiguity?: string | null;
        };
        // `string` once the telemetry migration lands ('recorded' /
        // 'rejected_invalid_status' / 'rejected_invalid_job_name' /
        // 'no_rows_affected'); `null` until then, because the deployed function
        // still returns void. Both are real, so both are in the type — and the
        // caller must therefore handle null rather than assume a status.
        Returns: string | null;
      };
      engine_upsert_discovery: {
        Args: {
          p_dedupe_key: string;
          p_title: string;
          p_summary: string | null;
          p_discovery_type: string;
          p_category_slug: string | null;
          p_claim_status: string;
          p_confidence: number;
          p_source_url: string | null;
          p_publisher: string | null;
          p_trust_level: string;
          // Added by supabase/migrations_pending/20260823_engine_evidence_provenance.sql.
          // OPTIONAL here on purpose: the migration is applied by hand, out of
          // band from a deploy, so both shapes must typecheck while the two are
          // out of step. src/lib/engine/jobs/discovery.ts calls the 14-argument
          // shape first and falls back to the 10-argument one on PGRST202.
          p_source_id?: string | null;
          p_excerpt?: string | null;
          p_originates_from_url?: string | null;
          p_origin_examined?: boolean;
        };
        Returns: string;
      };
      engine_due_sources: {
        Args: Record<string, never>;
        Returns: {
          id: string;
          organisation: string;
          url: string;
          source_type: string;
          trust_level: string;
          categories: string[];
        }[];
      };
      engine_record_source_check: {
        Args: { p_source_id: string; p_success: boolean; p_error?: string | null };
        // void -> `string | null` while 20260822_silent_success_telemetry.sql is
        // pending. `null` is the deployed `returns void` shape; a string is the
        // post-migration status. Both are real, so the caller must handle both —
        // src/lib/engine/postconditions.ts pendingRpc/pendingCreatedId does.
        Returns: string | null;
      };
      engine_opportunity_inputs: {
        Args: { p_days?: number };
        Returns: {
          category_slug: string;
          search_volume: number;
          zero_result_searches: number;
          views: number;
          previous_views: number;
          existing_content_count: number;
          commercial_clicks: number;
          days_since_freshest: number;
        }[];
      };
      engine_upsert_opportunity: {
        Args: {
          p_subject_type: string;
          p_subject_key: string;
          p_label: string;
          p_score: number | null;
          p_inputs: unknown;
          p_explanation: string;
        };
        // void -> `string | null` while 20260822_silent_success_telemetry.sql is
        // pending. `null` is the deployed `returns void` shape; a string is the
        // post-migration value. Both are real, so callers must handle both.
        Returns: string | null;
      };
      engine_freshness_candidates: {
        Args: { p_stale_days?: number };
        Returns: {
          kind: string;
          entity_id: string;
          slug: string;
          title: string;
          age_days: number;
          source_count: number;
        }[];
      };
      // ---- Phase 4 pipeline RPCs ----
      engine_aggregate_searches: {
        Args: { p_days?: number };
        Returns: number;
      };
      engine_unclassified_discoveries: {
        Args: { p_limit?: number };
        Returns: { id: string; title: string; summary: string | null }[];
      };
      engine_set_relevance: {
        Args: {
          p_id: string;
          p_verdict: string;
          p_score: number;
          p_explanation: string;
          p_angle: string | null;
        };
        Returns: string;
      };
      engine_briefable_discoveries: {
        Args: { p_limit?: number };
        Returns: {
          id: string;
          title: string;
          summary: string | null;
          discovery_type: string;
          category_slug: string | null;
          claim_status: string;
          suggested_angle: string | null;
          sighting_count: number;
        }[];
      };
      engine_evidence_for: {
        Args: { p_discovery_id: string };
        Returns: {
          url: string;
          publisher: string | null;
          claim_status: string;
          trust_level: string;
          originates_from_url: string | null;
        }[];
      };
      engine_create_brief: {
        Args: {
          p_discovery_id: string;
          p_title: string;
          p_rationale: string;
          p_primary_question: string;
          p_supporting_questions: string[];
          p_verified_facts: string[];
          p_uncertainties: string[];
          p_source_urls: string[];
          p_suggested_structure: string[];
          p_brief_kind: string;
          p_freshness: string;
          p_category_slug: string | null;
          p_content_type: string;
          p_priority: number;
          p_media_note: string;
        };
        Returns: string;
      };
      // ---- Phase 5 RPCs ----
      // Returns ONLY the final homepage selection. Overrides are read inside
      // the security barrier and never returned — see
      // 20260822_phase5_secure_homepage.sql.
      public_homepage_selection: {
        Args: { p_supporting?: number };
        Returns: {
          content_id: string;
          slug: string;
          title: string;
          content_type: string;
          category_slug: string | null;
          published_at: string;
          role: string;
        }[];
      };
      engine_trend_inputs: {
        Args: { p_days?: number };
        Returns: {
          topic_key: string;
          label: string;
          category_slug: string | null;
          recent_discoveries: number;
          relevant_discoveries: number;
          recent_views: number;
          prior_views: number;
          searches: number;
          zero_result_searches: number;
          commercial_clicks: number;
          published_coverage: number;
          newest_discovery_at: string | null;
        }[];
      };
      engine_upsert_trend: {
        Args: {
          p_topic_key: string;
          p_label: string;
          p_category: string | null;
          p_score: number | null;
          p_confidence: number;
          p_velocity: number | null;
          p_signals: unknown;
          p_why: string;
          p_recommended_type: string | null;
          p_has_coverage: boolean;
        };
        Returns: string;
      };
      // Deactivates trends whose evidence has aged past the documented floor or
      // horizon (constants in src/lib/engine/trends.ts). Defined in
      // supabase/migrations_pending/20260822_trend_decay_expiry.sql — NOT YET
      // APPLIED; the trend job reports a partial run while it is missing.
      engine_expire_stale_trends: {
        Args: {
          p_half_life_hours?: number;
          p_floor?: number;
          p_horizon_hours?: number;
          p_grace_hours?: number;
        };
        Returns: {
          topic_key: string;
          reason: string;
        }[];
      };
      engine_open_media_requirements: {
        Args: { p_limit?: number };
        Returns: {
          requirement_id: string;
          kind: string;
          entity_id: string;
          slug: string;
          label: string;
          manufacturer: string | null;
          category_slug: string | null;
          existing_candidates: number;
        }[];
      };
      engine_record_media_candidate: {
        Args: {
          p_requirement_id: string | null;
          p_product_id: string | null;
          p_content_id: string | null;
          p_source_organisation: string | null;
          p_source_url: string | null;
          p_asset_url: string | null;
          p_asset_type: string | null;
          p_width: number | null;
          p_height: number | null;
          p_potential_licence: string | null;
          p_rights_status: string | null;
          p_confidence: number;
          p_requires_human_review: boolean;
          p_reason: string | null;
        };
        Returns: string;
      };
      // Drafted by supabase/migrations_pending/20260822_hero_media_upgrade.sql
      // — not yet applied. Returns 'created' | 'already_tracked' |
      // 'rejected_invalid'.
      engine_flag_weak_hero: {
        Args: {
          p_content_id: string | null;
          p_product_id: string | null;
          p_tier: string;
          p_reason: string;
        };
        Returns: string;
      };
      // Drafted by supabase/migrations_pending/20260822_engine_safety.sql —
      // NOT YET APPLIED. src/lib/engine/guard.ts calls these and treats an
      // error as "telemetry unavailable", which the circuit breakers then
      // treat as a reason to STOP rather than to proceed unchecked. So the
      // code is safe against the migration being absent; it simply reports
      // every breaker as unavailable until it lands.
      // Lease-based idempotency for a scheduled pass — same pending migration.
      // engine_begin_run returns a run id, or a marker when another worker
      // already holds the lease, so a double-fired scheduler cannot run twice.
      engine_begin_run: {
        Args: { p_job_name: string; p_idempotency_key: string; p_lease_seconds?: number };
        Returns: string;
      };
      engine_complete_run: {
        Args: {
          p_run_id: string;
          p_status: string;
          p_items_examined: number;
          p_items_created: number;
          p_items_deduped: number;
          p_items_failed: number;
          p_detail: Record<string, unknown> | null;
          p_error: string | null;
        };
        // 'ok' | 'rejected_invalid'. Was declared `void` here while the SQL in
        // 20260822_engine_safety.sql declares `returns text` — so the type said
        // the completion could not be checked when in fact it could, and the
        // caller duly did not check it.
        Returns: string;
      };
      engine_recent_job_runs: {
        Args: { p_hours?: number; p_limit?: number };
        Returns: {
          job_name: string;
          status: string;
          started_at: string;
          finished_at: string | null;
          items_examined: number;
          items_created: number;
          items_deduped: number;
          items_failed: number;
          has_error: boolean;
          // Added by 20260822_silent_success_telemetry.sql. Optional because the
          // deployed function does not select them yet; `null` means UNMEASURED,
          // never zero. src/lib/engine/guard.ts already reads them this way.
          verified_writes?: number | null;
          silent_no_ops?: number | null;
          unverified_writes?: number | null;
          blind_writes?: number | null;
          // Added by 20260823b_queue_probe_fixes.sql. `null` means UNMEASURED —
          // the run predates the column or the stage does not classify itself.
          stage_outcome?: string | null;
          outcome_ambiguity?: string | null;
        }[];
      };
      // Added by 20260822_silent_success_telemetry.sql. Not yet applied.
      engine_silent_success_stats: {
        Args: { p_hours?: number };
        Returns: {
          runs_in_window: number;
          runs_instrumented: number;
          /** False whenever any run in the window lacks instrumentation. */
          all_measured: boolean;
          verified_writes: number;
          silent_no_ops: number;
          unverified_writes: number;
          blind_writes: number;
        }[];
      };
      engine_source_health: {
        Args: Record<string, never>;
        Returns: { checked: number; failed: number; max_consecutive_failures: number }[];
      };
      engine_validation_stats: {
        Args: { p_hours?: number };
        Returns: {
          evaluated: number;
          rejected: number;
          baseline_evaluated: number;
          baseline_rejected: number;
        }[];
      };
      engine_upsert_freshness: {
        Args: {
          p_kind: string;
          p_entity_id: string;
          p_reason: string;
          p_detail: string | null;
          p_severity: string;
        };
        Returns: string;
      };
      // ---- Phase 6 RPCs ----
      // Only briefs a HUMAN approved. Approval is the gate on assembly.
      engine_assemblable_briefs: {
        Args: { p_limit?: number };
        Returns: {
          id: string;
          discovery_id: string | null;
          proposed_title: string;
          proposed_slug: string | null;
          content_type: string;
          search_intent: string | null;
          primary_query: string | null;
          category_slug: string | null;
          rationale: string;
          primary_question: string | null;
          supporting_questions: string[] | null;
          verified_facts: string[] | null;
          uncertainties: string[] | null;
          source_urls: string[] | null;
          suggested_structure: string[] | null;
          brief_kind: string | null;
          freshness_sensitivity: string | null;
          media_requirement_note: string | null;
        }[];
      };
      // Returns the new content id, or 'duplicate_slug' / 'rejected_invalid'.
      // There is deliberately no parameter capable of publishing.
      engine_assemble_draft: {
        Args: {
          p_brief_id: string;
          p_title: string;
          p_slug: string;
          p_body: string;
          p_content_type: string;
          p_category_slug: string | null;
          p_search_intent: string | null;
          p_primary_query: string | null;
          p_source_urls: string[];
          p_meta_title?: string | null;
          p_meta_description?: string | null;
        };
        Returns: string;
      };
      engine_existing_entities: {
        Args: Record<string, never>;
        Returns: {
          kind: string;
          id: string;
          name: string;
          slug: string;
          is_published: boolean;
        }[];
      };
      engine_record_entity_resolution: {
        Args: {
          p_discovery_id: string | null;
          p_candidate_name: string;
          p_normalised: string;
          p_product_id: string | null;
          p_content_id: string | null;
          p_score: number;
          p_decision: string;
          p_explanation: string;
        };
        // void -> `string | null` while 20260822_silent_success_telemetry.sql is
        // pending. `null` is the deployed `returns void` shape; a string is the
        // post-migration value. Both are real, so callers must handle both.
        // On success this is the new row's UUID, not a status word.
        Returns: string | null;
      };
      // Manufacturers + categories. A product is only ever created for a
      // manufacturer that already has a record — never an invented one.
      engine_reference_data: {
        Args: Record<string, never>;
        Returns: { kind: string; id: string; name: string; slug: string }[];
      };
      // Returns the new product id, or one of 'duplicate_slug' /
      // 'unknown_manufacturer' / 'unknown_category' / 'rejected_invalid'.
      // is_published is hard-wired false; there is no parameter to change it,
      // and no parameter for specs, pricing or release date.
      engine_assemble_product: {
        Args: {
          p_discovery_id: string | null;
          p_name: string;
          p_slug: string;
          p_manufacturer_slug: string;
          p_category_slug: string;
          p_status: string;
          p_source_urls: string[];
        };
        Returns: string;
      };
      engine_upsert_update_proposal: {
        Args: {
          p_content_id: string | null;
          p_product_id: string | null;
          p_discovery_id: string | null;
          p_reason: string;
          p_summary: string;
          p_changes: string[];
          p_evidence: string[];
          p_confidence: number;
        };
        Returns: string;
      };

      // ---------------------------------------------------------------------
      // Shadow evaluation
      // ---------------------------------------------------------------------
      // DECLARED BUT NOT YET APPLIED. These describe
      // supabase/migrations_pending/20260822_engine_shadow_evaluation.sql, which
      // has NOT been run in production. Declaring them here is what lets
      // jobs/shadow-job.ts compile and be wired into the tick; calling one
      // before the migration is applied fails loudly with PostgREST's
      // "Could not find the function" error rather than silently doing nothing,
      // which is the behaviour we want in the meantime.
      engine_shadow_candidates: {
        Args: { p_limit?: number };
        Returns: {
          id: string;
          dedupe_key: string | null;
          title: string;
          summary: string | null;
          discovery_type: string;
          category_slug: string | null;
          claim_status: string;
          state: string;
          sighting_count: number | null;
          first_seen_at: string;
          relevance_overridden_by_admin: boolean | null;
          product_id: string | null;
          content_id: string | null;
        }[];
      };
      // Evidence WITH excerpt and source-registry permissions — the two things
      // engine_evidence_for deliberately omits, and without which claim
      // attestation and the media-rights check cannot run honestly.
      engine_shadow_evidence: {
        Args: { p_discovery_id: string };
        Returns: {
          id: string;
          url: string;
          publisher: string | null;
          organisation: string | null;
          excerpt: string | null;
          claim_status: string;
          trust_level: string;
          originates_from_url: string | null;
          retrieved_at: string | null;
          source_type: string | null;
          discovery_permitted: boolean | null;
          media_republication_permitted: boolean | null;
          media_rights_status: string | null;
          attribution_required: boolean | null;
          editorial_use_only: boolean | null;
          registration_required: boolean | null;
        }[];
      };
      engine_shadow_media: {
        Args: { p_product_id: string | null; p_content_id: string | null };
        Returns: {
          id: string;
          source_organisation: string | null;
          source_url: string | null;
          asset_url: string | null;
          asset_type: string | null;
          potential_licence: string | null;
          attribution_required: boolean | null;
          attribution_text: string | null;
          rights_status: string | null;
          requires_human_review: boolean | null;
          state: string | null;
          registry_media_republication_permitted: boolean | null;
          registry_media_rights_status: string | null;
          registry_attribution_required: boolean | null;
          registry_editorial_use_only: boolean | null;
          registry_registration_required: boolean | null;
          registry_organisation: string | null;
        }[];
      };
      // Permissions only. Needed because engine_upsert_discovery never writes
      // engine_discovery_evidence.source_id, so provenance has to be recovered
      // by host match — see the migration's comment on this function.
      engine_shadow_sources: {
        Args: Record<string, never>;
        Returns: {
          id: string;
          url: string;
          organisation: string | null;
          source_type: string | null;
          discovery_permitted: boolean | null;
          media_republication_permitted: boolean | null;
          media_rights_status: string | null;
          attribution_required: boolean | null;
          editorial_use_only: boolean | null;
          registration_required: boolean | null;
        }[];
      };
      engine_shadow_content_signals: {
        Args: Record<string, never>;
        Returns: {
          id: string;
          title: string;
          slug: string;
          primary_query: string | null;
          intent_fingerprint: string | null;
          content_type: string | null;
          category_id: string | null;
        }[];
      };
      // Returns 'created' | 'deduped' | 'rejected_invalid' | 'rejected_disabled'.
      // 'deduped' is the candidate_identity unique constraint refusing to bank
      // credit for a re-run, not an error.
      //
      // Note what is ABSENT: no content id, no product id, no status, no
      // is_published. This function writes three engine_shadow_* tables and
      // nothing else, which is why SHADOW is structurally incapable of
      // publishing rather than merely configured not to.
      engine_shadow_record_decision: {
        Args: {
          p_candidate_identity: string;
          p_candidate_kind: string;
          p_discovery_id: string | null;
          p_title: string;
          p_publisher: string | null;
          p_record_kind: string;
          p_outcome: string | null;
          p_terminal_stage: string;
          p_reached_gate: boolean;
          p_stages: unknown;
          p_gate: unknown;
          p_proposal: unknown;
          p_failed_stage: string | null;
          p_failure_error: string | null;
          p_explanation: string;
          p_dimensions: string[];
          p_reasons: unknown;
        };
        Returns: string;
      };
      engine_shadow_ledger: {
        Args: { p_limit?: number };
        Returns: {
          candidate_identity: string;
          title: string;
          publisher: string | null;
          decided_on: string;
          record_kind: string;
          outcome: string | null;
          terminal_stage: string;
          reached_gate: boolean;
          dimensions: string[];
        }[];
      };
      engine_shadow_escapes: {
        Args: Record<string, never>;
        Returns: {
          would_publish: number;
          fabricated_claim_escapes: number;
          unlicensed_media_escapes: number;
          bypassed_hard_blockers: number;
          duplicate_leakage: number;
          human_reviewed: number;
          human_disagreed: number;
        }[];
      };
      // Raw proof RUNS, passing and failing. PROVEN/NOT_PROVEN is derived in
      // src/lib/engine/proofs.ts, never here.
      engine_shadow_proof_runs: {
        Args: { p_limit?: number };
        Returns: {
          kind: string;
          level: string;
          observed_at: string;
          commit_sha: string | null;
          method: string;
          observed: string;
          passed: boolean;
        }[];
      };
      // Added by supabase/migrations/20260824_translation_model.sql. SECURITY
      // DEFINER and admin-only: it RAISES for a non-admin rather than returning
      // zero rows, because an empty coverage report reads as "everything is
      // translated". Verified: anon calling it gets 42501.
      //
      // NOT used by src/lib/admin/translation-service.ts — see the note there.
      // It cannot report translation_reviewed_by, which the "reviewed" state
      // needs, and widening its return type would mean a migration. Typed here
      // anyway so any future caller gets the real shape.
      content_translation_status: {
        Args: Record<string, never>;
        Returns: {
          translation_group_id: string;
          source_id: string;
          source_title: string;
          source_slug: string;
          source_status: ContentStatus;
          locale: Locale;
          translation_id: string | null;
          translation_state: TranslationState | null;
          is_stale: boolean | null;
          translated_at: string | null;
        }[];
      };
      engine_shadow_record_proof_run: {
        Args: {
          p_kind: string;
          p_level: string;
          p_commit_sha: string | null;
          p_method: string;
          p_observed: string;
          p_passed: boolean;
        };
        Returns: string;
      };
    };
  };
}

export type Tables = Database["public"]["Tables"];
export type TableName = keyof Tables;
export type Row<T extends TableName> = Tables[T]["Row"];
export type Insert<T extends TableName> = Tables[T]["Insert"];
export type Update<T extends TableName> = Tables[T]["Update"];
