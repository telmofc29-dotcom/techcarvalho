-- ============================================================================
-- Add 'family_page' to outbound_click_events.link_position — NOT YET APPLIED
-- ============================================================================
-- Drafted, not run. Move into migrations/ only once it has actually executed.
--
-- WHY
-- ---
-- Product-family hub routes (/families/...) were added on 2026-08-22. Their
-- outbound and affiliate links pass link_position = 'family_page', which is a
-- genuinely new position: a family hub is neither a product page nor a
-- category page, and recording it as either would misreport where the click
-- happened.
--
-- The CHECK constraint in 20260820_outbound_click_events.sql predates that
-- route and does not include it. recordOutboundClick() fires the insert as
-- `void supabase.from(...).insert(...)` with no error handling, so until this
-- is applied every click from a family hub is REJECTED BY THE CHECK AND
-- SILENTLY LOST — no exception reaches the user, and nothing appears in the
-- dashboard. Silent loss is the failure mode this project treats as a bug
-- class of its own, so recordOutboundClick now logs the rejection too.
--
-- The constraint deliberately stays a closed vocabulary: its own migration
-- notes that link_position is constrained "so this can never become a
-- free-text injection point". Widening it by one known value keeps that
-- property; loosening it to free text would not.

alter table public.outbound_click_events
  drop constraint if exists outbound_click_events_link_position_check;

alter table public.outbound_click_events
  add constraint outbound_click_events_link_position_check check (
    link_position in (
      'article_top', 'article_body', 'article_end', 'sidebar', 'product_page',
      'manufacturer_page', 'category_page', 'nav', 'footer', 'search_results',
      'related_content',
      -- Added 2026-08-22 with the /families/ hub routes.
      'family_page'
    )
  );
