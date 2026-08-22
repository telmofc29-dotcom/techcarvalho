-- ============================================================================
-- Phase 6 — Draft assembly, entity resolution, update proposals
-- ============================================================================
--
-- Closes the gap between an approved brief and an editable draft.
--
-- Publication safety is unchanged and non-negotiable:
--   * Assembled drafts are created with content_items.status = 'draft'.
--   * products are created with is_published = false.
--   * No function here writes status='published' or is_published=true.
--   * autonomous_publishing_enabled remains the separate, still-off switch.
--
-- The load-bearing editorial rule: assembled draft bodies contain STRUCTURE and
-- QUOTED EVIDENCE, never invented prose. Verified facts are reproduced with
-- their source; anything unconfirmed is written into an explicit "Unverified —
-- do not state as fact" block. A human writes the actual article.

-- ---------------------------------------------------------------------------
-- 1. Link briefs to the drafts they produced
-- ---------------------------------------------------------------------------
alter table public.engine_briefs
  add column if not exists assembled_content_id uuid references public.content_items(id) on delete set null,
  add column if not exists assembled_at timestamptz,
  add column if not exists assembly_note text;

-- ---------------------------------------------------------------------------
-- 2. Update proposals
-- ---------------------------------------------------------------------------
-- When new evidence affects an EXISTING page, the engine must propose an
-- update to that page rather than creating a second article about the same
-- thing. That is the difference between a maintained publication and one that
-- accumulates near-duplicates.
create table if not exists public.engine_update_proposals (
  id uuid primary key default gen_random_uuid(),
  content_id uuid references public.content_items(id) on delete cascade,
  product_id uuid references public.products(id) on delete cascade,
  discovery_id uuid references public.engine_discoveries(id) on delete set null,
  reason text not null check (reason in (
    'firmware_update', 'successor_released', 'discontinued', 'spec_change',
    'price_change', 'newer_evidence', 'broken_source',
    -- 'stale_content' has no new evidence behind it — it means enough time has
    -- passed that the page's claims can no longer be assumed current. It is
    -- separate from the others precisely so an editor can tell "something
    -- changed" apart from "nobody has checked this in a year".
    'stale_content'
  )),
  summary text not null,
  -- What specifically should change, and what evidence supports it.
  proposed_changes text[] not null default '{}',
  evidence_urls text[] not null default '{}',
  confidence numeric(4,3) not null default 0 check (confidence >= 0 and confidence <= 1),
  state text not null default 'open' check (state in ('open', 'accepted', 'rejected', 'applied')),
  state_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint engine_update_one_target check (
    (content_id is not null and product_id is null) or (content_id is null and product_id is not null)
  )
);
create index if not exists engine_update_proposals_state_idx on public.engine_update_proposals (state);
-- Idempotency: one OPEN proposal per (target, reason), so repeated passes
-- refresh rather than pile up.
create unique index if not exists engine_update_proposals_one_open_content
  on public.engine_update_proposals (content_id, reason) where content_id is not null and state = 'open';
create unique index if not exists engine_update_proposals_one_open_product
  on public.engine_update_proposals (product_id, reason) where product_id is not null and state = 'open';

-- ---------------------------------------------------------------------------
-- 3. Entity resolution log
-- ---------------------------------------------------------------------------
-- Records every match decision so a wrong merge can be audited and reversed,
-- and so "why didn't this create a product?" has an answer.
create table if not exists public.engine_entity_resolutions (
  id uuid primary key default gen_random_uuid(),
  discovery_id uuid references public.engine_discoveries(id) on delete cascade,
  candidate_name text not null,
  normalised_name text not null,
  matched_product_id uuid references public.products(id) on delete set null,
  matched_content_id uuid references public.content_items(id) on delete set null,
  match_score numeric(4,3),
  decision text not null check (decision in ('matched_existing', 'new_entity', 'ambiguous', 'ignored')),
  explanation text not null,
  created_at timestamptz not null default now()
);
create index if not exists engine_entity_resolutions_decision_idx on public.engine_entity_resolutions (decision);

-- ---------------------------------------------------------------------------
-- 4. RLS — admin only
-- ---------------------------------------------------------------------------
alter table public.engine_update_proposals enable row level security;
alter table public.engine_entity_resolutions enable row level security;
do $$
declare t text;
begin
  foreach t in array array['engine_update_proposals', 'engine_entity_resolutions'] loop
    execute format('drop policy if exists "admins read %1$s" on public.%1$I', t);
    execute format('drop policy if exists "admins insert %1$s" on public.%1$I', t);
    execute format('drop policy if exists "admins update %1$s" on public.%1$I', t);
    execute format('drop policy if exists "admins delete %1$s" on public.%1$I', t);
    execute format('create policy "admins read %1$s" on public.%1$I for select using (public.is_admin())', t);
    execute format('create policy "admins insert %1$s" on public.%1$I for insert with check (public.is_admin())', t);
    execute format('create policy "admins update %1$s" on public.%1$I for update using (public.is_admin())', t);
    execute format('create policy "admins delete %1$s" on public.%1$I for delete using (public.is_admin())', t);
    execute format('grant select, insert, update, delete on public.%1$I to authenticated', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 5. Cron-path RPCs
-- ---------------------------------------------------------------------------

-- Briefs an editor has APPROVED that have not yet been assembled into a draft.
-- Approval is the gate: nothing is assembled without a human saying yes.
create or replace function public.engine_assemblable_briefs(p_limit integer default 10)
returns table (
  id uuid, discovery_id uuid, proposed_title text, proposed_slug text,
  content_type text, search_intent text, primary_query text, category_slug text,
  rationale text, primary_question text, supporting_questions text[],
  verified_facts text[], uncertainties text[], source_urls text[],
  suggested_structure text[], brief_kind text, freshness_sensitivity text,
  media_requirement_note text
)
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if not public.engine_flag_enabled('research') then
    return;
  end if;
  return query
    select b.id, b.discovery_id, b.proposed_title, b.proposed_slug,
           b.content_type, b.search_intent, b.primary_query, b.category_slug,
           b.rationale, b.primary_question, b.supporting_questions,
           b.verified_facts, b.uncertainties, b.source_urls,
           b.suggested_structure, b.brief_kind, b.freshness_sensitivity,
           b.media_requirement_note
      from public.engine_briefs b
     where b.review_state = 'approved'
       and b.assembled_content_id is null
       and b.state not in ('rejected', 'published')
     order by b.priority desc nulls last
     limit greatest(coalesce(p_limit, 10), 1);
end;
$fn$;
revoke execute on function public.engine_assemblable_briefs(integer) from public;
grant execute on function public.engine_assemblable_briefs(integer) to anon, authenticated;

-- Creates the draft. Hard-wired to status='draft' — this function has no
-- parameter capable of publishing anything.
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
begin
  if p_title is null or p_slug is null or p_body is null then
    return 'rejected_invalid';
  end if;
  if p_content_type not in ('review', 'guide', 'comparison', 'news', 'troubleshooting') then
    return 'rejected_invalid';
  end if;
  -- Slug collision means the topic already exists; the caller should be
  -- proposing an update instead of a second page.
  if exists (select 1 from public.content_items where slug = p_slug) then
    return 'duplicate_slug';
  end if;

  select id into v_category from public.taxonomy_categories where slug = p_category_slug;

  insert into public.content_items (type, title, slug, body, status, category_id, search_intent, primary_query)
  values (p_content_type, left(p_title, 300), left(p_slug, 200), p_body,
          'draft',  -- never anything else
          v_category, nullif(p_search_intent, ''), left(p_primary_query, 200))
  returning id into v_content;

  -- Provenance travels with the draft.
  foreach v_url in array coalesce(p_source_urls, '{}') loop
    insert into public.source_records (content_id, url, publisher, reliability_tier, retrieved_at)
    values (v_content, left(v_url, 1000), null, 'secondary', now())
    on conflict do nothing;
  end loop;

  -- SEO metadata, only where the caller derived something real. A null
  -- description stays null rather than becoming an invented sales pitch for an
  -- article nobody has written yet.
  if p_meta_title is not null or p_meta_description is not null then
    insert into public.seo_metadata (content_id, meta_title, meta_description)
    values (v_content, left(p_meta_title, 200), left(p_meta_description, 300))
    on conflict (content_id) do nothing;
  end if;

  -- Media-first rule applies to engine-assembled drafts too.
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

-- Existing entities for duplicate/entity resolution. Names and publication
-- state only — cheap to scan, and enough both to match against and to decide
-- whether an assembled draft may LINK to a record or merely name it. Linking
-- an unpublished record would create a broken public link the moment the
-- article goes live, so the flag travels with the name.
create or replace function public.engine_existing_entities()
returns table (kind text, id uuid, name text, slug text, is_published boolean)
language plpgsql
security definer
set search_path = public
as $fn$
begin
  return query
    select 'product'::text, p.id, p.name::text, p.slug::text, coalesce(p.is_published, false)
      from public.products p
    union all
    select 'content'::text, c.id, c.title::text, c.slug::text, (c.status = 'published')
      from public.content_items c;
end;
$fn$;
revoke execute on function public.engine_existing_entities() from public;
grant execute on function public.engine_existing_entities() to anon, authenticated;

create or replace function public.engine_record_entity_resolution(
  p_discovery_id uuid, p_candidate_name text, p_normalised text,
  p_product_id uuid, p_content_id uuid, p_score numeric,
  p_decision text, p_explanation text
)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if p_decision not in ('matched_existing', 'new_entity', 'ambiguous', 'ignored') then
    return;
  end if;
  insert into public.engine_entity_resolutions (
    discovery_id, candidate_name, normalised_name, matched_product_id,
    matched_content_id, match_score, decision, explanation
  ) values (
    p_discovery_id, left(p_candidate_name, 300), left(p_normalised, 300),
    p_product_id, p_content_id, p_score, p_decision, left(p_explanation, 1000)
  );
end;
$fn$;
revoke execute on function public.engine_record_entity_resolution(uuid, text, text, uuid, uuid, numeric, text, text) from public;
grant execute on function public.engine_record_entity_resolution(uuid, text, text, uuid, uuid, numeric, text, text) to anon, authenticated;

create or replace function public.engine_upsert_update_proposal(
  p_content_id uuid, p_product_id uuid, p_discovery_id uuid,
  p_reason text, p_summary text, p_changes text[], p_evidence text[], p_confidence numeric
)
returns text
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if p_reason not in ('firmware_update','successor_released','discontinued','spec_change','price_change','newer_evidence','broken_source') then
    return 'rejected_invalid';
  end if;
  begin
    insert into public.engine_update_proposals (
      content_id, product_id, discovery_id, reason, summary,
      proposed_changes, evidence_urls, confidence
    ) values (
      p_content_id, p_product_id, p_discovery_id, p_reason, left(p_summary, 2000),
      coalesce(p_changes, '{}'), coalesce(p_evidence, '{}'),
      least(greatest(coalesce(p_confidence, 0), 0), 1)
    );
  exception when unique_violation then
    -- An open proposal for this (target, reason) already exists: refresh it
    -- rather than creating a duplicate.
    update public.engine_update_proposals
       set summary = left(p_summary, 2000),
           proposed_changes = coalesce(p_changes, '{}'),
           evidence_urls = coalesce(p_evidence, '{}'),
           confidence = least(greatest(coalesce(p_confidence, 0), 0), 1),
           updated_at = now()
     where reason = p_reason and state = 'open'
       and ((p_content_id is not null and content_id = p_content_id)
         or (p_product_id is not null and product_id = p_product_id));
    return 'refreshed';
  end;
  return 'created';
end;
$fn$;
revoke execute on function public.engine_upsert_update_proposal(uuid, uuid, uuid, text, text, text[], text[], numeric) from public;
grant execute on function public.engine_upsert_update_proposal(uuid, uuid, uuid, text, text, text[], text[], numeric) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. Product assembly
-- ---------------------------------------------------------------------------
-- Reference data the product-assembly job matches against. A product is only
-- ever created for a manufacturer that ALREADY has a record — the engine never
-- invents a manufacturer, and products.manufacturer_id is NOT NULL, so the
-- schema enforces this rather than merely encouraging it.
create or replace function public.engine_reference_data()
returns table (kind text, id uuid, name text, slug text)
language plpgsql
security definer
set search_path = public
as $fn$
begin
  return query
    select 'manufacturer'::text, m.id, m.name::text, m.slug::text from public.manufacturers m
    union all
    select 'category'::text, c.id, c.name::text, c.slug::text from public.taxonomy_categories c;
end;
$fn$;
revoke execute on function public.engine_reference_data() from public;
grant execute on function public.engine_reference_data() to anon, authenticated;

-- Creates an UNPUBLISHED product shell.
--
-- What it deliberately does NOT write: specifications, pricing, availability,
-- release_date, or a summary. Those are exactly the fields a machine would have
-- to invent, so they are left null for a human to fill from the sources that
-- travel with the record. is_published is hard-wired false and this function
-- has no parameter capable of changing it.
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
begin
  if p_name is null or p_slug is null then
    return 'rejected_invalid';
  end if;
  -- 'discontinued' is excluded on purpose: the engine may create a product it
  -- believes is real ('active') or merely reported ('rumored'), but declaring
  -- something discontinued is an editorial judgement about an existing record,
  -- which belongs in an update proposal instead.
  if p_status not in ('active', 'rumored') then
    return 'rejected_invalid';
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

  -- Media-first rule: the product is blocked on photography from the moment it
  -- exists, rather than being discovered later as media debt.
  insert into public.media_requirements (product_id, sourcing_status, notes)
  values (v_product, 'needed',
          'Auto-created for an engine-assembled product. Legitimately-licensed photography required before publication.')
  on conflict do nothing;

  return v_product::text;
end;
$fn$;
revoke execute on function public.engine_assemble_product(uuid, text, text, text, text, text, text[]) from public;
grant execute on function public.engine_assemble_product(uuid, text, text, text, text, text, text[]) to anon, authenticated;
