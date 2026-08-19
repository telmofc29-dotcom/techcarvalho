@AGENTS.md

# Tech Carvalho project conventions

- **Authorization boundary**: `requireAdmin()` / `getCurrentAdmin()` in `src/lib/dal.ts` is the real
  authorization check. `src/proxy.ts` (formerly `middleware.ts` — see AGENTS.md) only redirects
  unauthenticated visitors before render as defense-in-depth; it does not check `is_admin()`. Every
  admin Server Component **and every Server Action** must call `requireAdmin()` itself — actions bypass
  layout-level protection since they're invoked directly. RLS (`is_admin()`) is the final authoritative
  layer underneath both.
- **No admin bypass**: there is no public admin signup and no hardcoded/temporary admin credential
  anywhere in the codebase, even though no `admin_users` row exists yet in production. Don't add one to
  make testing easier — provisioning is a manual `insert into admin_users` after a real `auth.users`
  account exists.
- **Database types**: `src/lib/types/database.ts` is hand-written (no Supabase CLI available in this
  environment to run `supabase gen types`). Keep it in sync with `supabase/migrations/*.sql` by hand
  when the schema changes, including after `supabase/migrations_pending/` is applied.
- **Pending schema changes**: `supabase/migrations_pending/` holds additive migrations drafted but not
  yet applied to any database (kept out of `supabase/migrations/` so tooling won't auto-apply them).
  Currently: `content_items` category/search-intent/query/fingerprint fields + an `archived` status, and
  `media_assets` caption/source/creator/attribution-flag/ai-generated/owned fields, plus the `media`
  Storage bucket and its RLS policies (required before media upload works at all).
- **Admin CRUD pattern**: the five simple reference tables (manufacturers, product_families,
  taxonomy_categories, taxonomy_tags, spec_definitions) use a shared generic system —
  `src/lib/admin/reference-service.ts` for queries and `src/components/admin/reference-form.tsx` +
  `ReferenceFieldConfig` for forms. Products/content/media have bespoke pages because they carry nested
  relationships (specs, tags, associations) that don't fit the generic shape.
- **Freshness thresholds**: defined once in `src/lib/admin/freshness.ts`
  (`FRESHNESS_OVERDUE_DAYS` / `FRESHNESS_DUE_SOON_DAYS`) — not specified by the schema, chosen as a
  reasonable editorial default. Change there, not per-callsite.
- **Public site honesty**: never render fabricated reviews, ratings, testing claims, traffic numbers, or
  article counts. Empty states (`EmptyState` in `src/components/shared/ui.tsx`) are the default for
  unpublished/empty registries, both in admin and on the public site.
