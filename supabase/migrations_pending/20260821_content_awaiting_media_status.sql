-- Purpose: the owner's explicit "media-first publishing rule" (2026-08-21)
-- requires a distinct way to flag a content record as not publication-ready
-- specifically because it lacks legitimately-usable media — distinct from
-- 'draft' (not yet written) or 'needs_update' (was fine, now stale). Widens
-- the same CHECK constraint 20260820_editorial_workflow_statuses.sql
-- established, following the same pattern.
--
-- Backward compatible: every existing row's status remains valid; default
-- stays 'draft'. No RLS change needed — the public-read policy already
-- predicates on status = 'published' specifically, so 'awaiting_media' is
-- never publicly visible, same as every other pre-publication status.

alter table public.content_items drop constraint if exists content_items_status_check;
alter table public.content_items
  add constraint content_items_status_check check (
    status in ('idea', 'planned', 'draft', 'review', 'ready', 'published', 'needs_update', 'awaiting_media', 'archived')
  );
