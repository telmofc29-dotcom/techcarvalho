// Content ingestion script — loads ContentBatchImport data files (see
// src/lib/content/import-types.ts) and upserts content_items (with tags,
// product links, content-to-content relationships, sources) into Supabase,
// resolving every cross-reference by slug.
//
// Usage:
//   npx tsx scripts/ingest-content.ts data/content/camera-guides.ts
//   npx tsx scripts/ingest-content.ts data/content/camera-guides.ts --apply
//
// Same dry-run/--apply/idempotent-by-slug/never-auto-publish discipline as
// scripts/ingest-catalogue.ts — see that file's header for the shared
// rationale (auth, re-run safety). Every data file must export exactly one
// ContentBatchImport object, either as `export default {...}` or a single
// `export const foo = {...}`.
//
// status defaults to "draft" if the import omits it — nothing is ever
// silently published. On UPDATE, status is only changed if the import
// explicitly includes the field (same hasOwnProperty discipline as
// products' isPublished).

import { loadEnvLocal, parseArgs, resolveDataFiles, createAnonClient, createAdminClient, IngestPlan, loadImportFiles, upsertBySlug, type IngestClient } from "./_shared";
import type { ContentBatchImport, ContentImport, TagDefinitionImport } from "../src/lib/content/import-types";

loadEnvLocal();

type Db = { [slug: string]: string };

async function resolveIdsBySlug(client: IngestClient, table: "taxonomy_categories" | "taxonomy_tags" | "products" | "content_items", slugs: string[]): Promise<Db> {
  const unique = [...new Set(slugs)];
  if (unique.length === 0) return {};
  const { data, error } = await client.from(table).select("id, slug").in("slug", unique);
  if (error) throw new Error(`Failed to look up ${table}: ${error.message}`);
  const map: Db = {};
  for (const row of data ?? []) map[row.slug] = row.id;
  return map;
}

async function main() {
  const { apply, files: rawFiles } = parseArgs(process.argv.slice(2));
  if (rawFiles.length === 0) {
    console.error("Usage: npx tsx scripts/ingest-content.ts <data-file.ts> [more-files.ts...] [--apply]");
    process.exit(1);
  }
  const files = resolveDataFiles(rawFiles);

  console.log(`Loading ${files.length} content data file(s) (wildcards expanded and underscore-prefixed definition files auto-included):`);
  for (const f of files) console.log(`  - ${f}`);
  const batches = await loadImportFiles<ContentBatchImport>(files);
  const content: ContentImport[] = batches.flatMap((b) => b.content ?? []);
  const tagDefinitions: TagDefinitionImport[] = batches.flatMap((b) => b.tagDefinitions ?? []);
  console.log(`Batch total: ${content.length} content item(s), ${tagDefinitions.length} tag definition(s).`);

  const client = apply ? await createAdminClient() : createAnonClient();
  if (!apply) {
    console.log(
      "\nDRY RUN using the anonymous role — duplicate-slug detection against draft/unpublished content_items is " +
        "incomplete without admin auth (anon only sees status='published' rows). Category/tag lookups ARE fully " +
        "checked (world-readable reference data regardless of publish status). linkedProducts lookups are NOT " +
        "fully checked in dry-run when the target product is unpublished — anon can only see published products, " +
        "so a real, correct linkedProducts reference to an unpublished product will be misreported as \"not " +
        "found\" here. Run with --apply once TC_ADMIN_EMAIL/TC_ADMIN_PASSWORD exist for a fully authoritative " +
        "check of every lookup, including unpublished products.\n"
    );
  }

  const plan = new IngestPlan();

  const categoryIds = await resolveIdsBySlug(client, "taxonomy_categories", content.map((c) => c.categorySlug).filter((s): s is string => Boolean(s)));
  for (const c of content) {
    if (c.categorySlug && !categoryIds[c.categorySlug]) {
      plan.record({
        entity: "taxonomy_categories (lookup)",
        identifier: c.categorySlug,
        action: "error",
        detail: "no taxonomy_categories row with this slug exists",
      });
    }
  }

  // Tags explicitly defined in this batch are created/updated; any tag slug
  // referenced via tagSlugs but not defined here falls back to a read-only
  // lookup (must already exist from a prior batch, or it's a genuine error
  // below) — same "define or reference" split ingest-catalogue.ts uses for
  // manufacturers/spec_definitions/product_families.
  const definedTagIds = await upsertBySlug(
    client,
    "taxonomy_tags",
    "taxonomy_tags",
    tagDefinitions,
    (t) => ({ slug: t.slug, name: t.name }),
    plan,
    apply
  );
  const referencedTagSlugs = content.flatMap((c) => c.tagSlugs ?? []);
  const existingTagIds = await resolveIdsBySlug(
    client,
    "taxonomy_tags",
    referencedTagSlugs.filter((slug) => !definedTagIds[slug])
  );
  const tagIds: Db = { ...existingTagIds, ...definedTagIds };
  // In dry-run mode a batch-defined tag has no real id yet (nothing was
  // actually inserted) — "known" for validation purposes means either
  // already-existing OR defined in this batch, same distinction
  // ingest-catalogue.ts makes via knownSpecSlugs. tagIds itself (used for
  // the real content_tags insert) is only ever dereferenced in --apply
  // mode, where definedTagIds is correctly populated with real ids.
  const knownTagSlugs = new Set([...tagDefinitions.map((t) => t.slug), ...Object.keys(existingTagIds)]);
  const productIds = await resolveIdsBySlug(
    client,
    "products",
    content.flatMap((c) => (c.linkedProducts ?? []).map((p) => p.productSlug))
  );

  // 1. content_items themselves (without content_relationships yet — those
  // need every content item's id resolved first, including ones later in
  // this same batch).
  const { data: existingContent, error: existingErr } = await client
    .from("content_items")
    .select("id, slug")
    .in("slug", content.map((c) => c.slug));
  if (existingErr) throw new Error(`Failed to look up existing content_items: ${existingErr.message}`);
  const existingBySlug = new Map((existingContent ?? []).map((r) => [r.slug, r.id]));

  const contentIds: Db = {};
  // Same reasoning as failedProductSlugs in ingest-catalogue.ts — lets the
  // tags/products/relationships/sources passes below report "skip" rather
  // than an optimistic "create" for an item that will never exist.
  const failedContentSlugs = new Set<string>();

  for (const item of content) {
    if (item.categorySlug && !categoryIds[item.categorySlug]) {
      plan.record({ entity: "content_items", identifier: item.slug, action: "error", detail: `categorySlug "${item.categorySlug}" not found` });
      failedContentSlugs.add(item.slug);
      continue;
    }
    const missingProducts = (item.linkedProducts ?? []).filter((p) => !productIds[p.productSlug]);
    if (missingProducts.length > 0) {
      plan.record({
        entity: "content_items",
        identifier: item.slug,
        action: "error",
        detail: `linked product(s) not found: ${missingProducts.map((p) => p.productSlug).join(", ")} (in dry-run, an unpublished product is expected to show here — see the caveat above)`,
      });
      failedContentSlugs.add(item.slug);
      continue;
    }
    const missingTags = (item.tagSlugs ?? []).filter((slug) => !knownTagSlugs.has(slug));
    if (missingTags.length > 0) {
      plan.record({
        entity: "content_items",
        identifier: item.slug,
        action: "error",
        detail: `tag(s) not found: ${missingTags.join(", ")} — add to a batch file's tagDefinitions, or create via /admin/taxonomy-tags`,
      });
      failedContentSlugs.add(item.slug);
      continue;
    }

    const existingId = existingBySlug.get(item.slug);
    const explicitlyStatused = Object.prototype.hasOwnProperty.call(item, "status");
    // Same hasOwnProperty discipline as status, and for the same reason
    // src/app/admin/(dashboard)/content/actions.ts auto-fills published_at
    // on the Draft->Published transition: RLS requires status='published'
    // AND published_at <= now() for public visibility. Before this fix,
    // published_at was unconditionally included in baseRow on every
    // UPDATE (`item.publishedAt ?? null`) — so re-running this idempotent
    // import against an already-published row (e.g. to fix a typo, add
    // SEO copy, or apply a later batch file that doesn't repeat the date)
    // would silently null out a live publish date and make the row
    // invisible again, even though status was never touched. Now
    // published_at is only ever written when the import explicitly
    // provides a date (always synced — preserves a deliberate historical
    // date) or when this update is itself the transition to published
    // with no date given (auto-filled to now()); otherwise it's omitted
    // from the row entirely so an existing date is left alone.
    const explicitlyDated = Object.prototype.hasOwnProperty.call(item, "publishedAt");

    if (!apply) {
      plan.record({ entity: "content_items", identifier: item.slug, action: existingId ? "update" : "create" });
      if (existingId) contentIds[item.slug] = existingId;
      continue;
    }

    const baseRow = {
      slug: item.slug,
      title: item.title,
      type: item.type,
      body: item.body,
      category_id: item.categorySlug ? categoryIds[item.categorySlug] : null,
      search_intent: item.searchIntent ?? null,
      primary_query: item.primaryQuery ?? null,
      intent_fingerprint: item.intentFingerprint ?? null,
    };

    if (existingId) {
      const row: Record<string, unknown> = { ...baseRow };
      if (explicitlyStatused) row.status = item.status;
      if (explicitlyDated) {
        row.published_at = item.publishedAt ?? null;
      } else if (explicitlyStatused && item.status === "published") {
        row.published_at = new Date().toISOString();
      }
      const { error } = await client.from("content_items").update(row as never).eq("id", existingId);
      if (error) {
        plan.record({ entity: "content_items", identifier: item.slug, action: "error", detail: error.message });
        continue;
      }
      contentIds[item.slug] = existingId;
      plan.record({ entity: "content_items", identifier: item.slug, action: "update" });
    } else {
      const status = item.status ?? "draft";
      const publishedAt = explicitlyDated
        ? (item.publishedAt ?? null)
        : status === "published"
          ? new Date().toISOString()
          : null;
      const row = { ...baseRow, status, published_at: publishedAt };
      const { data, error } = await client.from("content_items").insert(row as never).select("id").single();
      if (error || !data) {
        plan.record({ entity: "content_items", identifier: item.slug, action: "error", detail: error?.message ?? "insert failed" });
        continue;
      }
      contentIds[item.slug] = data.id;
      plan.record({ entity: "content_items", identifier: item.slug, action: "create" });
    }
  }

  const knownContentSlugs = new Set([...content.map((c) => c.slug), ...Object.keys(contentIds)]);

  // 2. Tags (delete+reinsert per item, matching the admin UI's own
  // updateContentTags action — idempotent by construction).
  //
  // Reporting note (2026-08-21 incident): this used to call plan.record()
  // once per CONTENT ITEM after a single multi-row insert(), rather than
  // once per tag row — so an item with 3 tags and an item with 1 tag both
  // showed as "1 create" in the summary table, making the printed counts
  // look far smaller than the actual row count written (e.g. 20 items all
  // having tags reported as "20 create" while the real content_tags row
  // count was over 40). Not a data bug — Postgres's multi-row INSERT is
  // atomic, so "0 errors" already meant every row in every call succeeded
  // — but a real, worth-fixing reporting-accuracy defect, especially once
  // batches scale into the hundreds/thousands of items. Now reports one
  // line per tag, matching how content_relationships/source_records
  // already report below.
  for (const item of content) {
    const contentId = contentIds[item.slug];
    if (!item.tagSlugs || item.tagSlugs.length === 0) continue;
    if (failedContentSlugs.has(item.slug)) {
      for (const slug of item.tagSlugs) {
        plan.record({ entity: "content_tags", identifier: `${item.slug} / ${slug}`, action: "skip", detail: "parent content item failed validation" });
      }
      continue;
    }
    if (!apply || !contentId) {
      for (const slug of item.tagSlugs) {
        plan.record({ entity: "content_tags", identifier: `${item.slug} / ${slug}`, action: apply ? "error" : "create" });
      }
      continue;
    }
    const { error: deleteErr } = await client.from("content_tags").delete().eq("content_id", contentId);
    if (deleteErr) {
      for (const slug of item.tagSlugs) {
        plan.record({ entity: "content_tags", identifier: `${item.slug} / ${slug}`, action: "error", detail: deleteErr.message });
      }
      continue;
    }
    const rows = item.tagSlugs.map((slug) => ({ content_id: contentId, tag_id: tagIds[slug] }));
    const { error } = await client.from("content_tags").insert(rows);
    for (const slug of item.tagSlugs) {
      plan.record({
        entity: "content_tags",
        identifier: `${item.slug} / ${slug}`,
        action: error ? "error" : "create",
        detail: error?.message,
      });
    }
  }

  // 3. Linked products (content_products) — same delete+reinsert pattern,
  // same per-row reporting fix as content_tags above.
  for (const item of content) {
    const contentId = contentIds[item.slug];
    if (!item.linkedProducts || item.linkedProducts.length === 0) continue;
    if (failedContentSlugs.has(item.slug)) {
      for (const p of item.linkedProducts) {
        plan.record({
          entity: "content_products",
          identifier: `${item.slug} / ${p.productSlug}`,
          action: "skip",
          detail: "parent content item failed validation",
        });
      }
      continue;
    }
    if (!apply || !contentId) {
      for (const p of item.linkedProducts) {
        plan.record({ entity: "content_products", identifier: `${item.slug} / ${p.productSlug}`, action: apply ? "error" : "create" });
      }
      continue;
    }
    const { error: deleteErr } = await client.from("content_products").delete().eq("content_id", contentId);
    if (deleteErr) {
      for (const p of item.linkedProducts) {
        plan.record({ entity: "content_products", identifier: `${item.slug} / ${p.productSlug}`, action: "error", detail: deleteErr.message });
      }
      continue;
    }
    const rows = item.linkedProducts.map((p) => ({
      content_id: contentId,
      product_id: productIds[p.productSlug],
      role: p.role,
    }));
    const { error } = await client.from("content_products").insert(rows);
    for (const p of item.linkedProducts) {
      plan.record({
        entity: "content_products",
        identifier: `${item.slug} / ${p.productSlug}`,
        action: error ? "error" : "create",
        detail: error?.message,
      });
    }
  }

  // 4. content_relationships — final pass, every content slug in the batch
  // is now resolved, so forward references within the same file work
  // regardless of array order. Only ever inserts the forward-direction
  // row, same discipline as product_relationships.
  for (const item of content) {
    const contentId = contentIds[item.slug];
    if (failedContentSlugs.has(item.slug)) {
      for (const rel of item.relatedContent ?? []) {
        plan.record({
          entity: "content_relationships",
          identifier: `${item.slug} ${rel.type} ${rel.relatedSlug}`,
          action: "skip",
          detail: "parent content item failed validation",
        });
      }
      continue;
    }
    for (const rel of item.relatedContent ?? []) {
      if (!knownContentSlugs.has(rel.relatedSlug)) {
        plan.record({
          entity: "content_relationships",
          identifier: `${item.slug} ${rel.type} ${rel.relatedSlug}`,
          action: "error",
          detail: `relatedSlug "${rel.relatedSlug}" not found in DB or this batch`,
        });
        continue;
      }
      if (!apply || !contentId) {
        plan.record({
          entity: "content_relationships",
          identifier: `${item.slug} ${rel.type} ${rel.relatedSlug}`,
          action: apply ? "error" : "create",
        });
        continue;
      }
      let relatedId: string | undefined = contentIds[rel.relatedSlug];
      if (!relatedId) {
        const { data } = await client.from("content_items").select("id").eq("slug", rel.relatedSlug).maybeSingle();
        relatedId = data?.id;
      }
      if (!relatedId) {
        plan.record({
          entity: "content_relationships",
          identifier: `${item.slug} ${rel.type} ${rel.relatedSlug}`,
          action: "error",
          detail: "related content id could not be resolved",
        });
        continue;
      }
      const { error } = await client
        .from("content_relationships")
        .insert({ content_id: contentId, related_content_id: relatedId, relationship_type: rel.type });
      if (error && error.code !== "23505") {
        plan.record({
          entity: "content_relationships",
          identifier: `${item.slug} ${rel.type} ${rel.relatedSlug}`,
          action: "error",
          detail: error.message,
        });
      } else {
        plan.record({
          entity: "content_relationships",
          identifier: `${item.slug} ${rel.type} ${rel.relatedSlug}`,
          action: error?.code === "23505" ? "skip" : "create",
        });
      }
    }
  }

  // 5. Sources — soft idempotency: skip if an identical URL is already
  // recorded against the same content item (source_records has no unique
  // constraint to upsert on).
  for (const item of content) {
    const contentId = contentIds[item.slug];
    if (!item.sources || item.sources.length === 0) continue;

    if (failedContentSlugs.has(item.slug)) {
      for (const s of item.sources) plan.record({ entity: "source_records", identifier: `${item.slug} / ${s.url}`, action: "skip", detail: "parent content item failed validation" });
      continue;
    }

    if (!apply || !contentId) {
      for (const s of item.sources) plan.record({ entity: "source_records", identifier: `${item.slug} / ${s.url}`, action: apply ? "error" : "create" });
      continue;
    }

    const { data: existingSources } = await client.from("source_records").select("url").eq("content_id", contentId);
    const existingUrls = new Set((existingSources ?? []).map((r) => r.url));

    for (const s of item.sources) {
      if (existingUrls.has(s.url)) {
        plan.record({ entity: "source_records", identifier: `${item.slug} / ${s.url}`, action: "skip" });
        continue;
      }
      const { error } = await client.from("source_records").insert({
        content_id: contentId,
        url: s.url,
        publisher: s.publisher ?? null,
        reliability_tier: s.reliabilityTier ?? "secondary",
      });
      if (error) {
        plan.record({ entity: "source_records", identifier: `${item.slug} / ${s.url}`, action: "error", detail: error.message });
      } else {
        plan.record({ entity: "source_records", identifier: `${item.slug} / ${s.url}`, action: "create" });
      }
    }
  }

  // 6. SEO metadata — mirrors updateContentSeo in
  // src/app/admin/(dashboard)/content/actions.ts exactly: upsert on
  // content_id. Only touches seo_metadata for items that actually declare
  // metaTitle/metaDescription — an import never creates an empty row.
  for (const item of content) {
    const contentId = contentIds[item.slug];
    if (!item.metaTitle && !item.metaDescription) continue;

    if (failedContentSlugs.has(item.slug)) {
      plan.record({ entity: "seo_metadata", identifier: item.slug, action: "skip", detail: "parent content item failed validation" });
      continue;
    }
    if (!apply || !contentId) {
      plan.record({ entity: "seo_metadata", identifier: item.slug, action: apply ? "error" : "create" });
      continue;
    }
    // Only the fields this import actually declares are written — if e.g.
    // metaTitle is set but metaDescription isn't, an existing
    // meta_description (whether set by a prior import or a manual admin
    // edit) is left untouched rather than being nulled out by omission.
    const seoRow: Record<string, unknown> = { content_id: contentId };
    if (item.metaTitle) seoRow.meta_title = item.metaTitle;
    if (item.metaDescription) seoRow.meta_description = item.metaDescription;
    const { error } = await client.from("seo_metadata").upsert(seoRow, { onConflict: "content_id" });
    if (error) {
      plan.record({ entity: "seo_metadata", identifier: item.slug, action: "error", detail: error.message });
    } else {
      plan.record({ entity: "seo_metadata", identifier: item.slug, action: "create" });
    }
  }

  plan.print(apply ? "apply" : "dry-run");
  // process.exitCode (not process.exit()) — see the matching comment in
  // scripts/ingest-catalogue.ts for why a hard exit crashes on Windows
  // after Supabase network activity.
  process.exitCode = plan.hasErrors ? 1 : 0;
}

main().catch((err) => {
  console.error("Fatal error:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
