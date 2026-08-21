-- APPLIED TO PRODUCTION 2026-08-20. Moved here from
-- supabase/migrations_pending/ after the user confirmed it was run.
--
-- Purpose: content_items.status currently only supports 'draft' | 'published'
-- | 'archived' (added by supabase/migrations/20260819_content_media_extensions_and_storage.sql).
-- The original editorial spec describes a fuller pipeline — Idea, Planned,
-- Draft, Review, Ready, Published, Needs update, Archived — which does not
-- exist today. This is a genuine gap (Phase 17): building "editorial
-- workflow" UI against invented status values that the CHECK constraint
-- would reject is not an option, so this widens the constraint instead of
-- silently reusing 'draft'/'archived' to mean something they don't.
--
-- Backward compatible: every existing row's status ('draft', 'published',
-- or 'archived') remains valid under the new constraint; the default stays
-- 'draft'. No RLS change needed — the public-read policy already predicates
-- on status = 'published' specifically (see 20260819202305_rls_policies.sql),
-- so none of the new pre-publication statuses become publicly visible.
--
-- Design note for whoever applies this: 'needs_update' is included here to
-- match the original spec literally, but there's a real alternative worth
-- considering first — content becoming stale is already derivable from
-- freshness_log (no review logged recently) without a stored status that
-- can drift out of sync with the data that actually justifies it. If that
-- alternative is preferred, drop 'needs_update' from the list below and
-- treat staleness as a freshness_log-derived signal only, as
-- src/app/admin/(dashboard)/page.tsx and .../freshness/page.tsx already do.

alter table public.content_items drop constraint if exists content_items_status_check;
alter table public.content_items
  add constraint content_items_status_check check (
    status in ('idea', 'planned', 'draft', 'review', 'ready', 'published', 'needs_update', 'archived')
  );
