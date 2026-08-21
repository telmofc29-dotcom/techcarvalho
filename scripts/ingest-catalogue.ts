// Catalogue ingestion script — loads CatalogueImport data files (see
// src/lib/catalogue/import-types.ts) and upserts manufacturers ->
// spec_definitions -> product_families -> products (with specs,
// relationships, sources) into Supabase, resolving every cross-reference by
// slug so data files never need to know real UUIDs.
//
// Usage:
//   npx tsx scripts/ingest-catalogue.ts data/catalogue/canon-cameras.ts
//   npx tsx scripts/ingest-catalogue.ts data/catalogue/canon-cameras.ts --apply
//
// Without --apply this is a dry run: validates everything, writes nothing.
// --apply requires TC_ADMIN_EMAIL / TC_ADMIN_PASSWORD in the environment
// (not .env.local) and performs real upserts, authenticated as that admin
// user through the same RLS path the web app uses — no service-role key.
//
// Every data file must export exactly one CatalogueImport object, either
// as `export default {...}` or a single `export const foo = {...}`.
//
// Idempotent by slug: re-running the same file twice updates existing rows
// rather than duplicating them. Never auto-publishes a product on update —
// is_published is only set from the import on CREATE, or on UPDATE if the
// import explicitly includes the isPublished field (see hasOwn check
// below) — an import that omits it entirely never touches an existing
// product's publication state.

import { loadEnvLocal, parseArgs, resolveDataFiles, createAnonClient, createAdminClient, IngestPlan, loadImportFiles, upsertBySlug, type IngestClient } from "./_shared";
import type {
  CatalogueImport,
  ManufacturerImport,
  SpecDefinitionImport,
  ProductFamilyImport,
  ProductImport,
} from "../src/lib/catalogue/import-types";

loadEnvLocal();

type Db = { [slug: string]: string };

async function resolveTaxonomyCategoryIds(client: IngestClient, slugs: Set<string>): Promise<Db> {
  if (slugs.size === 0) return {};
  const { data, error } = await client.from("taxonomy_categories").select("id, slug").in("slug", [...slugs]);
  if (error) throw new Error(`Failed to look up taxonomy_categories: ${error.message}`);
  const map: Db = {};
  for (const row of data ?? []) map[row.slug] = row.id;
  return map;
}

// Fills gaps in an existing slug->id map for slugs that are REFERENCED
// (e.g. a product's manufacturerSlug) but not DEFINED in this batch — i.e.
// they must already exist in the DB. Mutates `into` in place. Used for
// manufacturers/product_families/spec_definitions, all of which a product
// can reference without redefining in the same import file.
async function fillReferenceGaps(
  client: IngestClient,
  table: "manufacturers" | "product_families" | "spec_definitions",
  referencedSlugs: string[],
  into: Db
): Promise<void> {
  const missing = referencedSlugs.filter((slug) => !into[slug]);
  if (missing.length === 0) return;
  const { data, error } = await client.from(table).select("id, slug").in("slug", missing);
  if (error) throw new Error(`Failed to look up existing ${table}: ${error.message}`);
  for (const row of data ?? []) into[row.slug] = row.id;
}

async function main() {
  const { apply, files: rawFiles } = parseArgs(process.argv.slice(2));
  if (rawFiles.length === 0) {
    console.error("Usage: npx tsx scripts/ingest-catalogue.ts <data-file.ts> [more-files.ts...] [--apply]");
    process.exit(1);
  }
  const files = resolveDataFiles(rawFiles);

  console.log(`Loading ${files.length} catalogue data file(s) (wildcards expanded and underscore-prefixed definition files auto-included):`);
  for (const f of files) console.log(`  - ${f}`);
  const batches = await loadImportFiles<CatalogueImport>(files);

  const manufacturers: ManufacturerImport[] = [];
  const specDefinitions: SpecDefinitionImport[] = [];
  const productFamilies: ProductFamilyImport[] = [];
  const products: ProductImport[] = [];
  for (const b of batches) {
    manufacturers.push(...(b.manufacturers ?? []));
    specDefinitions.push(...(b.specDefinitions ?? []));
    productFamilies.push(...(b.productFamilies ?? []));
    products.push(...(b.products ?? []));
  }

  console.log(
    `Batch totals: ${manufacturers.length} manufacturer(s), ${specDefinitions.length} spec definition(s), ` +
      `${productFamilies.length} product famil${productFamilies.length === 1 ? "y" : "ies"}, ${products.length} product(s).`
  );

  const client = apply ? await createAdminClient() : createAnonClient();
  if (!apply) {
    console.log(
      "\nDRY RUN using the anonymous role — duplicate-slug detection against unpublished/admin-only rows is " +
        "incomplete without admin auth (anon can only see published products/manufacturers etc. that carry no " +
        "publication gate — manufacturers/spec_definitions/product_families are world-readable regardless of " +
        "product publication state, so those ARE fully checked; only *products* below unpublished ones could be " +
        "under-detected). Run with --apply once TC_ADMIN_EMAIL/TC_ADMIN_PASSWORD exist for a fully authoritative check.\n"
    );
  }

  const plan = new IngestPlan();

  // 1. Manufacturers, spec definitions, product families — no cross-refs
  // among themselves (product_families.categorySlug is resolved read-only
  // against existing taxonomy_categories, never created by this script).
  const categorySlugs = new Set<string>([
    ...productFamilies.map((f) => f.categorySlug).filter((s): s is string => Boolean(s)),
    ...specDefinitions.map((s) => s.categorySlug).filter((s): s is string => Boolean(s)),
    ...products.map((p) => p.categorySlug),
  ]);
  const categoryIds = await resolveTaxonomyCategoryIds(client, categorySlugs);

  for (const slug of categorySlugs) {
    if (!categoryIds[slug]) {
      plan.record({
        entity: "taxonomy_categories (lookup)",
        identifier: slug,
        action: "error",
        detail: "no taxonomy_categories row with this slug exists — create it in /admin/taxonomy-categories first",
      });
    }
  }

  const manufacturerIds = await upsertBySlug(
    client,
    "manufacturers",
    "manufacturers",
    manufacturers,
    (m) => ({ slug: m.slug, name: m.name, website: m.website ?? null, description: m.description ?? null }),
    plan,
    apply
  );

  const specDefIds = await upsertBySlug(
    client,
    "spec_definitions",
    "spec_definitions",
    specDefinitions,
    (s) => ({
      slug: s.slug,
      name: s.name,
      data_type: s.dataType,
      unit: s.unit ?? null,
      category_id: s.categorySlug ? categoryIds[s.categorySlug] ?? null : null,
    }),
    plan,
    apply
  );

  const familyIds = await upsertBySlug(
    client,
    "product_families",
    "product_families",
    productFamilies,
    (f) => ({
      slug: f.slug,
      name: f.name,
      description: f.description ?? null,
      category_id: f.categorySlug ? categoryIds[f.categorySlug] ?? null : null,
    }),
    plan,
    apply
  );

  // manufacturerIds/familyIds/specDefIds only have entries for rows
  // upserted THIS run (i.e. defined in the batch). A product can reference
  // a pre-existing manufacturer/family/spec that isn't redefined in this
  // batch at all — resolve those gaps by slug BEFORE building the
  // known-slug sets below (and before any product row is built), so both
  // validation and the actual FK values are correct either way.
  const uniq = (arr: string[]) => [...new Set(arr)];
  await fillReferenceGaps(client, "manufacturers", uniq(products.map((p) => p.manufacturerSlug)), manufacturerIds);
  await fillReferenceGaps(
    client,
    "product_families",
    uniq(products.map((p) => p.familySlug).filter((s): s is string => Boolean(s))),
    familyIds
  );
  await fillReferenceGaps(
    client,
    "spec_definitions",
    uniq(products.flatMap((p) => (p.specs ?? []).map((s) => s.specSlug))),
    specDefIds
  );

  // If not applying, manufacturers/families/specs defined in THIS batch
  // won't have real DB ids for the not-yet-created ones — allow products to
  // resolve against them by slug presence alone for validation purposes.
  const knownManufacturerSlugs = new Set([...manufacturers.map((m) => m.slug), ...Object.keys(manufacturerIds)]);
  const knownFamilySlugs = new Set([...productFamilies.map((f) => f.slug), ...Object.keys(familyIds)]);
  const knownSpecSlugs = new Set([...specDefinitions.map((s) => s.slug), ...Object.keys(specDefIds)]);

  // 2. Products (without relationships yet — those need every product's id
  // resolved first, including ones later in this same batch).
  const { data: existingProducts, error: existingProductsErr } = await client
    .from("products")
    .select("id, slug, is_published")
    .in("slug", products.map((p) => p.slug));
  if (existingProductsErr) throw new Error(`Failed to look up existing products: ${existingProductsErr.message}`);
  const existingProductBySlug = new Map((existingProducts ?? []).map((r) => [r.slug, r]));

  const productIds: Db = {};
  // Tracked separately from productIds (which only has *successful*
  // ids) so specs/relationships/sources below can skip cleanly for a
  // product that failed validation, in both dry-run and apply mode —
  // otherwise dry-run would optimistically report "would create" for a
  // spec/source belonging to a product that will never actually exist.
  const failedProductSlugs = new Set<string>();

  for (const product of products) {
    if (!knownManufacturerSlugs.has(product.manufacturerSlug)) {
      plan.record({
        entity: "products",
        identifier: product.slug,
        action: "error",
        detail: `manufacturerSlug "${product.manufacturerSlug}" not found in DB or this batch`,
      });
      failedProductSlugs.add(product.slug);
      continue;
    }
    if (!categoryIds[product.categorySlug]) {
      plan.record({
        entity: "products",
        identifier: product.slug,
        action: "error",
        detail: `categorySlug "${product.categorySlug}" does not exist — create it in /admin/taxonomy-categories first`,
      });
      failedProductSlugs.add(product.slug);
      continue;
    }
    if (product.familySlug && !knownFamilySlugs.has(product.familySlug)) {
      plan.record({
        entity: "products",
        identifier: product.slug,
        action: "error",
        detail: `familySlug "${product.familySlug}" not found in DB or this batch`,
      });
      failedProductSlugs.add(product.slug);
      continue;
    }

    const existing = existingProductBySlug.get(product.slug);
    const explicitlyPublished = Object.prototype.hasOwnProperty.call(product, "isPublished");

    if (!apply) {
      plan.record({ entity: "products", identifier: product.slug, action: existing ? "update" : "create" });
      if (existing) productIds[product.slug] = existing.id;
      continue;
    }

    const baseRow = {
      slug: product.slug,
      name: product.name,
      manufacturer_id: manufacturerIds[product.manufacturerSlug],
      category_id: categoryIds[product.categorySlug],
      family_id: product.familySlug ? familyIds[product.familySlug] ?? null : null,
      model_number: product.modelNumber ?? null,
      release_date: product.releaseDate ?? null,
      status: product.status ?? "active",
      summary: product.summary ?? null,
    };

    if (existing) {
      const row = explicitlyPublished ? { ...baseRow, is_published: product.isPublished } : baseRow;
      const { error } = await client.from("products").update(row as never).eq("id", existing.id);
      if (error) {
        plan.record({ entity: "products", identifier: product.slug, action: "error", detail: error.message });
        continue;
      }
      productIds[product.slug] = existing.id;
      plan.record({ entity: "products", identifier: product.slug, action: "update" });
    } else {
      const row = { ...baseRow, is_published: product.isPublished ?? false };
      const { data, error } = await client.from("products").insert(row as never).select("id").single();
      if (error || !data) {
        plan.record({ entity: "products", identifier: product.slug, action: "error", detail: error?.message ?? "insert failed" });
        continue;
      }
      productIds[product.slug] = data.id;
      plan.record({ entity: "products", identifier: product.slug, action: "create" });
    }
  }

  const knownProductSlugs = new Set([...products.map((p) => p.slug), ...Object.keys(productIds)]);

  // 3. Product specs
  for (const product of products) {
    const productId = productIds[product.slug];
    if (failedProductSlugs.has(product.slug)) {
      for (const spec of product.specs ?? []) {
        plan.record({ entity: "product_specs", identifier: `${product.slug} / ${spec.specSlug}`, action: "skip", detail: "parent product failed validation" });
      }
      continue;
    }
    for (const spec of product.specs ?? []) {
      if (!knownSpecSlugs.has(spec.specSlug)) {
        plan.record({
          entity: "product_specs",
          identifier: `${product.slug} / ${spec.specSlug}`,
          action: "error",
          detail: `specSlug "${spec.specSlug}" not found in DB or this batch — add it to src/lib/catalogue/camera-specs.ts (or the relevant vocabulary) first`,
        });
        continue;
      }
      if (!apply || !productId) {
        plan.record({ entity: "product_specs", identifier: `${product.slug} / ${spec.specSlug}`, action: apply ? "error" : "create" });
        continue;
      }
      const specDefId = specDefIds[spec.specSlug];
      const { error } = await client
        .from("product_specs")
        .upsert(
          { product_id: productId, spec_definition_id: specDefId, value: spec.value as never },
          { onConflict: "product_id,spec_definition_id" }
        );
      if (error) {
        plan.record({ entity: "product_specs", identifier: `${product.slug} / ${spec.specSlug}`, action: "error", detail: error.message });
      } else {
        plan.record({ entity: "product_specs", identifier: `${product.slug} / ${spec.specSlug}`, action: "create" });
      }
    }
  }

  // 4. Product relationships — final pass, every product slug in the batch
  // is now resolved (or known-to-exist), so forward references within the
  // same file work regardless of array order.
  for (const product of products) {
    const productId = productIds[product.slug];
    if (failedProductSlugs.has(product.slug)) {
      for (const rel of product.relationships ?? []) {
        plan.record({
          entity: "product_relationships",
          identifier: `${product.slug} ${rel.type} ${rel.relatedProductSlug}`,
          action: "skip",
          detail: "parent product failed validation",
        });
      }
      continue;
    }
    for (const rel of product.relationships ?? []) {
      if (!knownProductSlugs.has(rel.relatedProductSlug)) {
        plan.record({
          entity: "product_relationships",
          identifier: `${product.slug} ${rel.type} ${rel.relatedProductSlug}`,
          action: "error",
          detail: `relatedProductSlug "${rel.relatedProductSlug}" not found in DB or this batch`,
        });
        continue;
      }
      if (!apply || !productId) {
        plan.record({
          entity: "product_relationships",
          identifier: `${product.slug} ${rel.type} ${rel.relatedProductSlug}`,
          action: apply ? "error" : "create",
        });
        continue;
      }
      let relatedId: string | undefined = productIds[rel.relatedProductSlug];
      if (!relatedId) {
        const { data } = await client.from("products").select("id").eq("slug", rel.relatedProductSlug).maybeSingle();
        relatedId = data?.id;
      }
      if (!relatedId) {
        plan.record({
          entity: "product_relationships",
          identifier: `${product.slug} ${rel.type} ${rel.relatedProductSlug}`,
          action: "error",
          detail: "related product id could not be resolved",
        });
        continue;
      }
      const { error } = await client
        .from("product_relationships")
        .insert({ product_id: productId, related_product_id: relatedId, relationship_type: rel.type });
      if (error && error.code !== "23505") {
        plan.record({
          entity: "product_relationships",
          identifier: `${product.slug} ${rel.type} ${rel.relatedProductSlug}`,
          action: "error",
          detail: error.message,
        });
      } else {
        plan.record({
          entity: "product_relationships",
          identifier: `${product.slug} ${rel.type} ${rel.relatedProductSlug}`,
          action: error?.code === "23505" ? "skip" : "create",
        });
      }
    }
  }

  // 5. Sources (product-level and per-spec) — soft idempotency: skip if an
  // identical URL is already recorded against the same product, since
  // source_records has no unique constraint to upsert on.
  for (const product of products) {
    const productId = productIds[product.slug];
    const allSources = [
      ...(product.sources ?? []).map((s) => ({ ...s, product_spec_id: null as string | null })),
    ];
    for (const spec of product.specs ?? []) {
      for (const s of spec.sources ?? []) {
        allSources.push({ ...s, product_spec_id: "__spec__" + spec.specSlug });
      }
    }
    if (allSources.length === 0) continue;

    if (failedProductSlugs.has(product.slug)) {
      for (const s of allSources) plan.record({ entity: "source_records", identifier: `${product.slug} / ${s.url}`, action: "skip", detail: "parent product failed validation" });
      continue;
    }

    if (!apply || !productId) {
      for (const s of allSources) plan.record({ entity: "source_records", identifier: `${product.slug} / ${s.url}`, action: apply ? "error" : "create" });
      continue;
    }

    const { data: existingSources } = await client.from("source_records").select("url").eq("product_id", productId);
    const existingUrls = new Set((existingSources ?? []).map((r) => r.url));

    for (const s of allSources) {
      if (existingUrls.has(s.url)) {
        plan.record({ entity: "source_records", identifier: `${product.slug} / ${s.url}`, action: "skip" });
        continue;
      }
      let productSpecId: string | null = null;
      if (s.product_spec_id?.startsWith("__spec__")) {
        const specSlug = s.product_spec_id.replace("__spec__", "");
        const { data } = await client
          .from("product_specs")
          .select("id")
          .eq("product_id", productId)
          .eq("spec_definition_id", specDefIds[specSlug])
          .maybeSingle();
        productSpecId = data?.id ?? null;
      }
      const { error } = await client.from("source_records").insert({
        product_id: productSpecId ? null : productId,
        product_spec_id: productSpecId,
        url: s.url,
        publisher: s.publisher ?? null,
        reliability_tier: s.reliabilityTier ?? "secondary",
      });
      if (error) {
        plan.record({ entity: "source_records", identifier: `${product.slug} / ${s.url}`, action: "error", detail: error.message });
      } else {
        plan.record({ entity: "source_records", identifier: `${product.slug} / ${s.url}`, action: "create" });
      }
    }
  }

  // 6. SEO metadata — mirrors updateProductSeo in
  // src/app/admin/(dashboard)/products/actions.ts exactly: upsert on
  // product_id. Only touches seo_metadata for products that actually
  // declare metaTitle/metaDescription — an import never creates an empty
  // row.
  for (const product of products) {
    const productId = productIds[product.slug];
    if (!product.metaTitle && !product.metaDescription) continue;

    if (failedProductSlugs.has(product.slug)) {
      plan.record({ entity: "seo_metadata", identifier: product.slug, action: "skip", detail: "parent product failed validation" });
      continue;
    }
    if (!apply || !productId) {
      plan.record({ entity: "seo_metadata", identifier: product.slug, action: apply ? "error" : "create" });
      continue;
    }
    // Only the fields this import actually declares are written — if e.g.
    // metaTitle is set but metaDescription isn't, an existing
    // meta_description (whether set by a prior import or a manual admin
    // edit) is left untouched rather than being nulled out by omission.
    const seoRow: Record<string, unknown> = { product_id: productId };
    if (product.metaTitle) seoRow.meta_title = product.metaTitle;
    if (product.metaDescription) seoRow.meta_description = product.metaDescription;
    const { error } = await client.from("seo_metadata").upsert(seoRow, { onConflict: "product_id" });
    if (error) {
      plan.record({ entity: "seo_metadata", identifier: product.slug, action: "error", detail: error.message });
    } else {
      plan.record({ entity: "seo_metadata", identifier: product.slug, action: "create" });
    }
  }

  plan.print(apply ? "apply" : "dry-run");
  // process.exitCode (not process.exit()) — after Supabase network calls,
  // a hard process.exit() races libuv's async-handle teardown on Windows
  // and crashes with "Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)"
  // even though the script's own work already completed successfully.
  // Setting exitCode lets Node drain pending I/O and exit naturally.
  process.exitCode = plan.hasErrors ? 1 : 0;
}

main().catch((err) => {
  console.error("Fatal error:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
