// Shared types for the Content & Growth Engine. Mirrors
// supabase/migrations_pending/20260821_growth_engine.sql — keep in sync by
// hand, same convention as src/lib/types/database.ts.

export type EngineSourceType =
  | "manufacturer_newsroom"
  | "product_feed"
  | "rss_atom"
  | "official_docs"
  | "public_api"
  | "regulatory_dataset"
  | "trusted_editorial"
  | "other_approved";

export type TrustLevel = "primary" | "secondary" | "community";

// Deliberately distinct from discovery permission — see the Source Registry
// header in the migration. Being allowed to read facts from a source never
// implies being allowed to republish its imagery.
export type MediaRightsStatus =
  | "unverified"
  | "confirmed_usable"
  | "requires_registration"
  | "unclear_manual_review"
  | "no_source_found"
  | "prohibited";

export type DiscoveryType =
  | "product_launch"
  | "product_update"
  | "spec_change"
  | "firmware_release"
  | "technology_news"
  | "recall_or_security"
  | "new_topic";

// Ordered weakest -> strongest deliberately; confidence.ts relies on the
// distinction, never on how many outlets repeated a claim.
export type ClaimStatus =
  | "rumour"
  | "leak"
  | "estimate"
  | "unverified"
  | "reported_secondary"
  | "confirmed_primary";

export type PipelineState =
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

export type BriefState = Extract<
  PipelineState,
  "planned" | "drafting" | "media_check" | "review_eligible" | "published" | "blocked" | "rejected" | "error"
>;

export type FreshnessReason =
  | "spec_changed"
  | "successor_released"
  | "discontinued"
  | "firmware_changed"
  | "stale_facts"
  | "stale_pricing"
  | "broken_source_link"
  | "outdated_comparison"
  | "missing_internal_links";

export type JobStatus = "running" | "success" | "partial" | "failed" | "skipped";

export type EngineSource = {
  id: string;
  organisation: string;
  url: string;
  source_type: EngineSourceType;
  categories: string[];
  trust_level: TrustLevel;
  is_active: boolean;
  discovery_permitted: boolean;
  media_republication_permitted: boolean;
  media_rights_status: MediaRightsStatus;
  terms_url: string | null;
  terms_notes: string | null;
  attribution_required: boolean;
  attribution_text: string | null;
  check_frequency_hours: number;
  last_checked_at: string | null;
  last_success_at: string | null;
  consecutive_failures: number;
  last_error: string | null;
};

export type EngineDiscovery = {
  id: string;
  dedupe_key: string;
  title: string;
  summary: string | null;
  discovery_type: DiscoveryType;
  category_slug: string | null;
  confidence: number;
  claim_status: ClaimStatus;
  state: PipelineState;
  state_reason: string | null;
  first_seen_at: string;
  last_seen_at: string;
  sighting_count: number;
};

export type EngineEvidence = {
  id: string;
  discovery_id: string;
  url: string;
  publisher: string | null;
  excerpt: string | null;
  claim_status: ClaimStatus;
  trust_level: TrustLevel;
  originates_from_url: string | null;
  retrieved_at: string;
};

export type EngineOpportunity = {
  id: string;
  subject_type: "category" | "topic" | "product" | "content" | "search_term";
  subject_key: string;
  label: string;
  score: number | null;
  inputs: Record<string, number | string | null>;
  explanation: string;
  computed_at: string;
};

export type EngineSettings = {
  master_enabled: boolean;
  discovery_enabled: boolean;
  research_enabled: boolean;
  freshness_enabled: boolean;
  opportunity_scoring_enabled: boolean;
  autonomous_publishing_enabled: boolean;
  notes: string | null;
  updated_at: string;
};
