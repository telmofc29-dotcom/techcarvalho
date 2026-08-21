// Hand-written types mirroring supabase/migrations/20260819202304_initial_schema.sql.
// No Supabase CLI is available in this environment to run `supabase gen types`, so
// these are maintained by hand. Keep in sync with the migration when the schema changes.

export type MediaType = "image" | "video";
export type ProductStatus = "active" | "discontinued" | "rumored";
export type RelationshipType =
  | "successor_of"
  | "alternative_to"
  | "accessory_for"
  | "compatible_with"
  | "requires";
export type SpecDataType = "text" | "number" | "boolean" | "enum";
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
  | "related_content";
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
export type EngineJobStatus = "running" | "success" | "partial" | "failed" | "skipped";
export type EngineOpportunitySubject = "category" | "topic" | "product" | "content" | "search_term";

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
        };
        Update: Partial<Database["public"]["Tables"]["media_assets"]["Insert"]>;
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
          created_at: string;
        };
        Insert: {
          id?: string;
          product_id: string;
          related_product_id: string;
          relationship_type: RelationshipType;
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
        };
        Update: Partial<Database["public"]["Tables"]["content_items"]["Insert"]>;
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
        };
        Returns: void;
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
        Returns: void;
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
        Returns: void;
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
    };
  };
}

export type Tables = Database["public"]["Tables"];
export type TableName = keyof Tables;
export type Row<T extends TableName> = Tables[T]["Row"];
export type Insert<T extends TableName> = Tables[T]["Insert"];
export type Update<T extends TableName> = Tables[T]["Update"];
