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
export type ContentStatus =
  | "idea"
  | "planned"
  | "draft"
  | "review"
  | "ready"
  | "published"
  | "needs_update"
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
export type MediaSourceType =
  | "manufacturer"
  | "staff_photograph"
  | "stock_licensed"
  | "user_submitted"
  | "press_kit"
  | "other";
export type MediaPublicationStatus = "private" | "published";
export type MediaRightsStatus = "unknown" | "pending_verification" | "verified" | "restricted";
export type SearchIntent = "informational" | "commercial" | "transactional" | "navigational";

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
    };
    Views: { [_ in never]: never };
    Functions: {
      compute_analytics_rollup: {
        Args: { target_day: string };
        Returns: void;
      };
    };
  };
}

export type Tables = Database["public"]["Tables"];
export type TableName = keyof Tables;
export type Row<T extends TableName> = Tables[T]["Row"];
export type Insert<T extends TableName> = Tables[T]["Insert"];
export type Update<T extends TableName> = Tables[T]["Update"];
