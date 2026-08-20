# Proposed future migrations

Nothing here is applied. These are documented proposals only, for when the
catalog is large enough to justify the change — not applied speculatively.

## Full-text search (products, content_items)

**Problem**: `src/lib/public/search.ts` uses plain `ILIKE '%term%'` across a
handful of text columns. That's fine at today's scale (near-empty tables)
but doesn't use an index — every search is a sequential scan — and doesn't
rank by relevance, only by whatever `order()` is specified.

**Proposal**, when it's actually worth doing:

```sql
alter table public.products add column if not exists search_vector tsvector
  generated always as (
    setweight(to_tsvector('english', coalesce(name, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(model_number, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(summary, '')), 'C')
  ) stored;
create index if not exists products_search_vector_idx on public.products using gin (search_vector);

alter table public.content_items add column if not exists search_vector tsvector
  generated always as (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(body, '')), 'B')
  ) stored;
create index if not exists content_items_search_vector_idx on public.content_items using gin (search_vector);
```

Then `src/lib/public/search.ts` switches from `.ilike()` to
`.textSearch('search_vector', query, { type: 'websearch' })`, ranked with
`ts_rank`. No paid service, no new dependency — this is a Postgres/Supabase
native feature, consistent with "prefer Postgres foundations" already
established for search.

**Trigger to actually do this**: when `ILIKE` scans start showing up as slow
in Supabase's query performance view, or the catalog crosses roughly a few
thousand rows — whichever comes first. Not before.
