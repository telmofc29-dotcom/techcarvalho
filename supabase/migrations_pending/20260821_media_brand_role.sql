-- DRAFTED, NOT YET APPLIED. Audited whether media_assets already
-- distinguishes site-brand assets (logo/mark/favicon/OG source files) from
-- normal product/article/editorial media — it does not; nothing in the
-- existing schema (media_type, source_type, rights_status, etc.)
-- represents "what this image is used FOR" as opposed to "where it came
-- from" or "what kind of file it is". This is the smallest clean
-- extension that closes that gap: one nullable text column doing double
-- duty as both the "is this a brand asset" flag (non-null = yes) and its
-- specific role, rather than two separate columns — a brand asset's role
-- IS the thing that makes it a brand asset, there's no case where you'd
-- want one without the other.
--
-- Deliberately NOT a new table / not folded into source_type (which
-- describes provenance — manufacturer, staff photo, stock, etc. — a
-- brand asset commissioned via Canva doesn't fit that vocabulary and
-- forcing it in would conflate two unrelated questions).

alter table public.media_assets
  add column if not exists brand_role text
  check (brand_role is null or brand_role in (
    'logo_full', 'logo_full_tagline', 'wordmark', 'wordmark_tagline', 'mark', 'favicon', 'og_image'
  ));

create index if not exists media_assets_brand_role_idx on public.media_assets (brand_role) where brand_role is not null;
