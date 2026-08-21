// Single source of truth for the content_items.type / status dropdown
// options shown in the admin content forms — kept here instead of inline
// in both new/page.tsx and [id]/page.tsx so the two forms can't drift.
// Must stay in sync with the CHECK constraints in
// supabase/migrations/20260819202304_initial_schema.sql (type, before the
// troubleshooting addition) and 20260820_content_troubleshooting_type.sql /
// 20260820_editorial_workflow_statuses.sql.

export const CONTENT_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: "review", label: "Review" },
  { value: "guide", label: "Guide" },
  { value: "comparison", label: "Comparison" },
  { value: "news", label: "News" },
  { value: "troubleshooting", label: "Troubleshooting" },
];

// Ordered to match the editorial pipeline (Idea → ... → Archived), not
// alphabetically — this is the sequence an editor actually moves through.
export const CONTENT_STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: "idea", label: "Idea" },
  { value: "planned", label: "Planned" },
  { value: "draft", label: "Draft" },
  { value: "review", label: "Review" },
  { value: "ready", label: "Ready" },
  { value: "published", label: "Published" },
  { value: "needs_update", label: "Needs update" },
  { value: "awaiting_media", label: "Awaiting media" },
  { value: "archived", label: "Archived" },
];
