@AGENTS.md

# Tech Carvalho project conventions

## Architecture

Next.js App Router + Supabase (Postgres, Auth, Storage). Public site under `src/app/(public)/`,
admin CMS under `src/app/admin/(dashboard)/` (route-group-protected). RLS is the authoritative
data boundary everywhere; the app never uses a service-role key (none exists in this codebase —
every read/write goes through `anon`/`authenticated` roles, gated by RLS).

## Authorization model

- **Real boundary**: `requireAdmin()` / `getCurrentAdmin()` in `src/lib/dal.ts`. `src/proxy.ts`
  (formerly `middleware.ts` — see AGENTS.md) only redirects unauthenticated visitors before render
  as defense-in-depth; it does not check `is_admin()`. Every admin Server Component **and every
  Server Action** must call `requireAdmin()` itself — actions bypass layout-level protection since
  they're invoked directly. RLS (`is_admin()`) is the final authoritative layer underneath both.
- **No admin bypass**: no public admin signup, no hardcoded/temporary admin credential anywhere.
  Provisioning a new admin is a manual `insert into admin_users` after a real `auth.users` account
  exists — never add a bypass to make testing easier.
- **Public publication rules**: products (`is_published`), content (`status = 'published' and
  published_at <= now()`), media (`publication_status = 'published'`) are the only rows visible to
  `anon`. Reference data (manufacturers, taxonomy, spec definitions) is world-readable — no publish
  gating, matches the schema's own design notes.

## Database types & migration discipline

- `src/lib/types/database.ts` is hand-written (no Supabase CLI in this environment to run
  `supabase gen types`). Keep it in sync with `supabase/migrations/*.sql` by hand whenever the
  schema changes.
- Applied migrations live in `supabase/migrations/`. Anything drafted-but-not-yet-applied belongs in
  a `supabase/migrations_pending/` directory instead (kept out of `migrations/` specifically so no
  tooling auto-applies it) — move it into `migrations/` only once it's actually been run in
  production. `docs/proposed-migrations.md` holds longer-range proposals (e.g. full-text search) not
  even drafted as SQL yet.
- Never apply production SQL, weaken RLS, or fabricate production data without the user explicitly
  approving that specific action in that turn.

## Media storage architecture

Two Storage buckets, not one — applied in
`supabase/migrations/20260819_content_media_extensions_and_storage.sql`. `media-private` (upload
target, RLS admin-only for every operation including read) and `media-public` (bucket
`public=true`, admin-only write). Upload never makes something public — an explicit "publish"
action (`src/app/admin/(dashboard)/media/actions.ts publishMediaAsset`) copies the object into
`media-public` and only then is `media_assets.publication_status` flipped to `'published'`.
Unpublish removes the public copy only; the private original is the permanent archive/evidence
record and is never touched by publish/unpublish.

Publishing is additionally gated by `src/lib/media/rights.ts` (`evaluatePublishEligibility`) —
`restricted` always blocks; otherwise only `rights_status = 'verified'`, `owned = true`, or
`source_type = 'staff_photograph'` clears an asset. `source_url`/attribution text/manufacturer or
stock `source_type` alone are never treated as proof of rights. This is enforced server-side inside
the Server Action, not just in the UI.

## Error handling: empty vs. failed

Lesson from the 2026-08 incident where `anon` had no table grants at all and every public page
silently rendered an honest-looking empty state for weeks because nothing distinguished "genuinely
no data" from "the query failed": every failure must be distinguishable from an empty result.

- **Public pages** (`src/lib/public/*.ts`): keep degrading gracefully — a visitor never sees a raw
  error — but every query calls `logQueryError()` (`src/lib/log/query-error.ts`) so a real failure
  is visible in server logs instead of looking identical to zero rows.
- **Admin pages**: a real query failure must be visibly reported to the admin, not shown as "0
  records". Pages using `reference-service.ts` (`listRows`/`listRowsPaginated`/etc.) already throw
  on error, caught by `src/app/admin/(dashboard)/error.tsx`. Pages using raw `createClient()`
  queries directly (products/content/media lists, the dashboard) check `error` explicitly and
  render `QueryErrorBanner` (`src/components/admin/ui.tsx`) instead of an empty state.

## Admin CRUD pattern

The five simple reference tables (manufacturers, product_families, taxonomy_categories,
taxonomy_tags, spec_definitions) use a shared generic system — `src/lib/admin/reference-service.ts`
for queries, `src/components/admin/reference-form.tsx` + `ReferenceFieldConfig` for forms,
`listRowsPaginated` + `src/components/admin/pagination.tsx` for paginated lists. Products/content/
media have bespoke pages because they carry nested relationships (specs, tags, associations) that
don't fit the generic shape.

Product specs are category/spec-definition-driven, not hardcoded columns — `spec_definitions`
(optionally scoped to a `taxonomy_categories` row) + `product_specs` (jsonb value) is the same
mechanism for a camera's sensor size as a GPU's memory bus width. Don't add product-type-specific
database columns; add spec definitions instead.

Product relationships (`product_relationships`) are stored one-directional
(`successor_of`/`alternative_to`/`accessory_for`/`compatible_with`/`requires`) and the reverse
direction is inferred at query time (`src/lib/public/product-detail.ts` queries both
`product_id = X` and `related_product_id = X` and labels each direction differently) — never insert
the reciprocal row manually.

Freshness thresholds are defined once in `src/lib/admin/freshness.ts`
(`FRESHNESS_OVERDUE_DAYS` / `FRESHNESS_DUE_SOON_DAYS`) — not specified by the schema, a reasonable
editorial default. Change there, not per-callsite.

## Testing

`npm test` runs `node --test`, which auto-discovers `*.test.ts` under `src/`. No test framework
dependency — Node 24's built-in test runner + native TypeScript stripping. Relative imports in
files that get loaded this way need explicit `.ts` extensions (Node ESM requirement); `tsconfig.json`
has `allowImportingTsExtensions` on for this. Tests are for pure/business-rule functions only
(rights eligibility, slugify, search sanitization, freshness bucketing, JSON-LD builders) — not a
general test-everything mandate.

## Public site honesty

Never render fabricated reviews, ratings, testing claims, traffic numbers, prices, availability, or
article counts — including in JSON-LD (`src/lib/seo/jsonld.ts` only emits fields backed by real
data). Empty states (`EmptyState` in `src/components/shared/ui.tsx`) are the default for
unpublished/empty registries, both in admin and on the public site.

## Deployment safety

Never push, deploy, or apply production SQL/migrations without the user explicitly asking for that
specific action in that turn. Local `npm run build` succeeding is not the same as it being live —
this repo's Vercel deployment only updates on push, and this assistant does not push.
