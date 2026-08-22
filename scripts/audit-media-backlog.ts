// Read-only audit of the blocked-product media backlog, run from an
// AUTHENTICATED admin session (signInWithPassword — no service-role key
// exists in this project). `anon` cannot see unpublished products or
// media_requirements at all: RLS denies by returning ZERO ROWS, not an
// error, so docs/product-media-strategy.md's §1.1 counts could not be
// produced from an anon connection. This script exists to produce them
// honestly.
//
// Every query logs its `error` object explicitly and aborts on failure —
// the direct lesson of the `licence` vs `license` bug, where a selected
// column that didn't exist produced an error that was swallowed and read
// as "no data".
//
// Usage: TC_ADMIN_EMAIL=... TC_ADMIN_PASSWORD=... npx tsx scripts/audit-media-backlog.ts

import { loadEnvLocal, createAdminClient, type IngestClient } from "./_shared";

loadEnvLocal();

function must<T>(label: string, res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) {
    console.error(`QUERY FAILED (${label}): ${res.error.message}`);
    throw new Error(`${label}: ${res.error.message}`);
  }
  if (res.data === null) {
    console.error(`QUERY RETURNED NULL DATA WITH NO ERROR (${label}) — treat as failure, not as empty.`);
    throw new Error(`${label}: null data, null error`);
  }
  return res.data;
}

async function main() {
  const client: IngestClient = await createAdminClient();
  const { data: userData, error: userError } = await client.auth.getUser();
  if (userError || !userData.user) throw new Error(`auth.getUser: ${userError?.message}`);
  console.log(`Authenticated as ${userData.user.email} (${userData.user.id})`);

  // admin_users.id IS the auth.users id — see the table definition in
  // supabase/migrations/20260819202304_initial_schema.sql
  // (`id uuid primary key references auth.users (id)`). There is no `user_id`
  // column, so this self-check queried a column that does not exist: it broke
  // `next build`'s type-check outright, and had it ever run it would have
  // failed at the database and reported "NOT VISIBLE — RLS may be denying"
  // for a genuine admin.
  const { data: adminRow, error: adminError } = await client
    .from("admin_users")
    .select("id")
    .eq("id", userData.user.id)
    .maybeSingle();
  if (adminError) {
    console.error(`QUERY FAILED (admin_users self-check): ${adminError.message}`);
  }
  console.log(`admin_users self-check: ${adminRow ? "IS ADMIN" : "NOT VISIBLE — RLS may be denying"}`);

  const products = must(
    "products",
    await client
      .from("products")
      .select("id, slug, name, is_published, manufacturer_id, category_id, release_date, created_at")
      .order("created_at", { ascending: true })
  );
  console.log(`\nproducts: ${products.length} total (authenticated view)`);

  const manufacturers = must("manufacturers", await client.from("manufacturers").select("id, name, slug"));
  const mfrById = new Map(manufacturers.map((m) => [m.id, m.name]));

  const categories = must("taxonomy_categories", await client.from("taxonomy_categories").select("id, name, slug"));
  const catById = new Map(categories.map((c) => [c.id, c.name]));

  const requirements = must(
    "media_requirements",
    await client
      .from("media_requirements")
      .select("id, product_id, content_id, sourcing_status, target_source_type, notes, resolved_media_id")
  );
  console.log(`media_requirements: ${requirements.length} total`);
  const reqByProduct = new Map(requirements.filter((r) => r.product_id).map((r) => [r.product_id as string, r]));

  const productMedia = must(
    "product_media",
    await client.from("product_media").select("id, product_id, media_id, role, sort_order")
  );
  console.log(`product_media: ${productMedia.length} rows`);

  const assets = must(
    "media_assets",
    await client
      .from("media_assets")
      .select(
        "id, storage_path, media_type, alt_text, license, creator, source_type, source_url, attribution, attribution_required, ai_generated, owned, rights_status, publication_status, asset_role, brand_role"
      )
  );
  console.log(`media_assets: ${assets.length} rows (authenticated view)`);
  const assetById = new Map(assets.map((a) => [a.id, a]));

  const heroByProduct = new Map<string, (typeof assets)[number]>();
  for (const pm of productMedia) {
    if (pm.role !== "hero") continue;
    const a = assetById.get(pm.media_id);
    if (a) heroByProduct.set(pm.product_id, a);
  }

  // ---- Blocked products, grouped by manufacturer ----
  const blocked = products.filter((p) => !p.is_published);
  console.log(`\n=== BLOCKED (is_published = false): ${blocked.length} ===\n`);

  const byMfr = new Map<string, typeof blocked>();
  for (const p of blocked) {
    const key = (p.manufacturer_id && mfrById.get(p.manufacturer_id)) || "(no manufacturer)";
    const list = byMfr.get(key) ?? [];
    list.push(p);
    byMfr.set(key, list);
  }

  const sorted = [...byMfr.entries()].sort((a, b) => b[1].length - a[1].length);
  for (const [mfr, list] of sorted) {
    console.log(`## ${mfr} (${list.length})`);
    for (const p of list) {
      const req = reqByProduct.get(p.id);
      const hero = heroByProduct.get(p.id);
      console.log(
        `  - ${p.name}  [slug=${p.slug}]` +
          `  cat=${(p.category_id && catById.get(p.category_id)) || "-"}` +
          `  released=${p.release_date ?? "-"}` +
          `  req=${req ? req.sourcing_status : "NONE"}` +
          `${req?.target_source_type ? `/${req.target_source_type}` : ""}` +
          `  hero=${hero ? `${hero.rights_status}/${hero.publication_status}` : "NONE"}` +
          `${req?.notes ? `\n      notes: ${req.notes}` : ""}`
      );
    }
    console.log("");
  }

  // ---- Published products (for reference) ----
  const published = products.filter((p) => p.is_published);
  console.log(`=== PUBLISHED: ${published.length} ===`);
  for (const p of published) {
    const hero = heroByProduct.get(p.id);
    console.log(`  - ${p.name} [${p.slug}] hero=${hero ? hero.source_url ?? "(no source_url)" : "NONE"}`);
  }

  // ---- Commons assets needing the metadata correction ----
  console.log(`\n=== media_assets with a Wikimedia source_url ===`);
  const commons = assets.filter((a) => (a.source_url ?? "").includes("wikimedia.org"));
  for (const a of commons) {
    console.log(
      `  - ${a.id} source_type=${a.source_type ?? "NULL"} asset_role=${a.asset_role ?? "NULL"} ` +
        `rights=${a.rights_status} pub=${a.publication_status} license=${a.license ?? "-"} creator=${a.creator ?? "-"}`
    );
  }
  console.log(`  (${commons.length} Commons-sourced assets)`);

  // ---- Requirement status histogram ----
  console.log(`\n=== media_requirements by sourcing_status ===`);
  const hist = new Map<string, number>();
  for (const r of requirements) hist.set(r.sourcing_status, (hist.get(r.sourcing_status) ?? 0) + 1);
  for (const [k, v] of hist) console.log(`  ${k}: ${v}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
