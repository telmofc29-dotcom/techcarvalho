-- ============================================================================
-- Least privilege for engine draft/product assembly — NOT YET APPLIED
-- ============================================================================
-- Drafted, not run. Move into migrations/ only once it has actually executed.
--
-- THE FINDING (2026-08-22, found by probing production as `anon`)
-- ---------------------------------------------------------------
-- `engine_assemble_draft` created a real `content_items` row when called with
-- a brief id that DOES NOT EXIST:
--
--   engine_assemble_draft(p_brief_id => '00000000-...-000000000000', ...)
--     -> 'fe2c29be-7db5-4427-866c-cefa54dbd0a1'   (a real draft row)
--
-- The function validated the title, slug, body, content type and slug
-- uniqueness. It never validated that the BRIEF existed, was approved, or was
-- unassembled. The final `update engine_briefs ... where id = p_brief_id`
-- simply matched nothing and the function returned success.
--
-- WHY THIS MATTERS MORE THAN IT LOOKS
-- -----------------------------------
-- The anon key is PUBLIC — it ships in client-side JavaScript. So this was
-- unbounded `content_items` INSERT access for anyone who read the bundle,
-- plus `source_records` and `media_requirements` rows alongside each one.
--
-- Nothing could be PUBLISHED this way: status is hard-wired to 'draft' and
-- direct table writes are correctly denied (42501, verified). The publication
-- boundary held. But "cannot publish" is not the same as "minimum permission
-- necessary", and unbounded writes to a content table is not minimum.
--
-- This is the security-boundary principle stated in CLAUDE.md applied to the
-- engine itself: content automation must not acquire broad write authority
-- merely because that made the RPC simpler to write.
--
-- THE FIX
-- -------
-- Both assembly functions now require a real, eligible antecedent:
--   * a draft may only be assembled from a brief that EXISTS, has
--     review_state = 'approved', and has not already been assembled;
--   * a product may only be assembled from a discovery that EXISTS and was
--     classified relevant.
--
-- Human approval was always the intended gate. It was enforced in the SELECT
-- that fed the job (engine_assemblable_briefs) but not in the WRITE, so
-- anything calling the write directly bypassed it. Gating the read and not
-- the write is the same mistake as validating input in the UI only.

-- ---------------------------------------------------------------------------
-- 1. Drafts require an approved, unassembled brief
-- ---------------------------------------------------------------------------
create or replace function public.engine_assemble_draft(
  p_brief_id uuid,
  p_title text,
  p_slug text,
  p_body text,
  p_content_type text,
  p_category_slug text,
  p_search_intent text,
  p_primary_query text,
  p_source_urls text[],
  p_meta_title text default null,
  p_meta_description text default null
)
returns text
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_category uuid;
  v_content uuid;
  v_url text;
  v_brief record;
begin
  if p_title is null or p_slug is null or p_body is null then
    return 'rejected_invalid';
  end if;
  if p_content_type not in ('review', 'guide', 'comparison', 'news', 'troubleshooting') then
    return 'rejected_invalid';
  end if;

  -- THE FIX. Nothing is created without a real, approved, unassembled brief.
  -- Human approval is the gate on assembly; it must be enforced HERE, in the
  -- write, not only in the query that feeds the job.
  select id, review_state, assembled_content_id, state
    into v_brief
    from public.engine_briefs
   where id = p_brief_id;

  if not found then
    return 'rejected_unknown_brief';
  end if;
  if v_brief.review_state is distinct from 'approved' then
    return 'rejected_brief_not_approved';
  end if;
  if v_brief.assembled_content_id is not null then
    return 'rejected_already_assembled';
  end if;
  if v_brief.state in ('rejected', 'published') then
    return 'rejected_brief_closed';
  end if;

  if exists (select 1 from public.content_items where slug = p_slug) then
    return 'duplicate_slug';
  end if;

  select id into v_category from public.taxonomy_categories where slug = p_category_slug;

  insert into public.content_items (type, title, slug, body, status, category_id, search_intent, primary_query)
  values (p_content_type, left(p_title, 300), left(p_slug, 200), p_body,
          'draft',  -- never anything else
          v_category, nullif(p_search_intent, ''), left(p_primary_query, 200))
  returning id into v_content;

  foreach v_url in array coalesce(p_source_urls, '{}') loop
    insert into public.source_records (content_id, url, publisher, reliability_tier, retrieved_at)
    values (v_content, left(v_url, 1000), null, 'secondary', now())
    on conflict do nothing;
  end loop;

  if p_meta_title is not null or p_meta_description is not null then
    insert into public.seo_metadata (content_id, meta_title, meta_description)
    values (v_content, left(p_meta_title, 200), left(p_meta_description, 300))
    on conflict (content_id) do nothing;
  end if;

  insert into public.media_requirements (content_id, sourcing_status, notes)
  values (v_content, 'needed', 'Auto-created for an engine-assembled draft. Media required before publication.')
  on conflict do nothing;

  update public.engine_briefs
     set assembled_content_id = v_content,
         assembled_at = now(),
         state = 'drafting',
         updated_at = now()
   where id = p_brief_id;

  return v_content::text;
end;
$fn$;

revoke execute on function public.engine_assemble_draft(uuid, text, text, text, text, text, text, text, text[], text, text) from public;
grant execute on function public.engine_assemble_draft(uuid, text, text, text, text, text, text, text, text[], text, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Products require a real, relevant discovery
-- ---------------------------------------------------------------------------
create or replace function public.engine_assemble_product(
  p_discovery_id uuid,
  p_name text,
  p_slug text,
  p_manufacturer_slug text,
  p_category_slug text,
  p_status text,
  p_source_urls text[]
)
returns text
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_manufacturer uuid;
  v_category uuid;
  v_product uuid;
  v_url text;
  v_discovery record;
begin
  if p_name is null or p_slug is null then
    return 'rejected_invalid';
  end if;
  if p_status not in ('active', 'rumored') then
    return 'rejected_invalid';
  end if;

  -- Same fix: a product needs a real antecedent that passed relevance.
  select id, relevance_verdict into v_discovery
    from public.engine_discoveries
   where id = p_discovery_id;

  if not found then
    return 'rejected_unknown_discovery';
  end if;
  if v_discovery.relevance_verdict is distinct from 'relevant' then
    return 'rejected_discovery_not_relevant';
  end if;

  if exists (select 1 from public.products where slug = p_slug) then
    return 'duplicate_slug';
  end if;

  select id into v_manufacturer from public.manufacturers where slug = p_manufacturer_slug;
  if v_manufacturer is null then
    return 'unknown_manufacturer';
  end if;

  select id into v_category from public.taxonomy_categories where slug = p_category_slug;
  if v_category is null then
    return 'unknown_category';
  end if;

  insert into public.products (manufacturer_id, category_id, name, slug, status, is_published)
  values (v_manufacturer, v_category, left(p_name, 300), left(p_slug, 200), p_status,
          false)  -- never anything else
  returning id into v_product;

  foreach v_url in array coalesce(p_source_urls, '{}') loop
    insert into public.source_records (product_id, url, publisher, reliability_tier, retrieved_at)
    values (v_product, left(v_url, 1000), null, 'secondary', now())
    on conflict do nothing;
  end loop;

  insert into public.media_requirements (product_id, sourcing_status, notes)
  values (v_product, 'needed',
          'Auto-created for an engine-assembled product. Legitimately-licensed photography required before publication.')
  on conflict do nothing;

  return v_product::text;
end;
$fn$;

revoke execute on function public.engine_assemble_product(uuid, text, text, text, text, text, text[]) from public;
grant execute on function public.engine_assemble_product(uuid, text, text, text, text, text, text[]) to anon, authenticated;
