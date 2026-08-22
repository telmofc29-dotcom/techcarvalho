// Two approved, narrowly-scoped production corrections plus the editorial
// links for the newly-unblocked Canon bodies.
//
// 1. METADATA on the 9 pre-existing Wikimedia Commons assets. They were
//    imported with source_type 'other' (7) or NULL (2) and asset_role NULL,
//    while the schema has had purpose-built 'public_domain_or_cc' and
//    'product_photo' values unused since 20260821_media_sourcing_workflow.sql
//    — see docs/product-media-strategy.md §1.4.
//
//    NOTE, and this is a correction to the brief: only 6 of those 9 are
//    product photos. The other 3 are ARTICLE heroes (the Milky Way photo, the
//    TP-Link router, the Canon EOS line-up shot). Tagging those 'product_photo'
//    would be wrong, so asset_role is derived from how each asset is actually
//    linked (product_media -> product_photo, content_media -> article_hero)
//    rather than assumed. source_type becomes 'public_domain_or_cc' for all 9,
//    which is correct regardless of role.
//
//    source_type is not cosmetic here: classifyProductMedia() in
//    src/lib/media/presentation.ts treats 'other'/NULL as "we do not know what
//    this is", so fixing it makes the site's claim about these images honest
//    rather than defaulted.
//
// 2. content_products links — ONLY where a published article genuinely names
//    the specific model. Verified by reading each match in context first;
//    three apparent "EOS R" matches were rejected as false positives because
//    they referred to the EOS R *system*/RF mount, not the EOS R body.
//
// 3. product_relationships — one direction only, never the reciprocal
//    (see CLAUDE.md; the reverse is inferred at query time).
//
// Usage: TC_ADMIN_EMAIL=... TC_ADMIN_PASSWORD=... npx tsx scripts/fix-commons-asset-metadata.ts

import { loadEnvLocal, createAdminClient } from "./_shared";
import type { ContentProductRole, RelationshipType } from "../src/lib/types/database";

loadEnvLocal();

/** [product slug, article slug, role] — each verified against the article body. */
const CONTENT_LINKS: Array<[string, string, ContentProductRole]> = [
  // "...all three have it and the 60D before them didn't."
  ["canon-eos-60d", "canon-70d-80d-90d-generation-differences", "mentioned"],
  // "...well before the 70D, 80D, and 90D that followed it."
  ["canon-eos-80d", "canon-eos-60d-still-worth-it", "mentioned"],
  // "...a video-focused variant within the R6 line rather than a straightforward
  //  successor to the existing R6 Mark II."
  ["canon-eos-r6", "canon-eos-r6-v-announcement", "mentioned"],
  // "...positioned as the lighter, cheaper sibling to the R7."
  ["canon-eos-r7", "canon-90d-vs-eos-r10", "mentioned"],
];

/** [product slug, related product slug, type] — stored one-directional ONLY. */
const RELATIONSHIPS: Array<[string, string, RelationshipType]> = [
  // Directly backed by the published "Canon EOS R vs RP" comparison.
  ["canon-eos-rp", "canon-eos-r", "alternative_to"],
  // Both are Canon's entry full-frame RF bodies; the R8 took that slot after the RP.
  ["canon-eos-r8", "canon-eos-rp", "alternative_to"],
  // Both are Canon's entry APS-C RF bodies; the R50 is the smaller, cheaper one.
  ["canon-eos-r50", "canon-eos-r10", "alternative_to"],
  // The two Rebel-line bodies in the catalogue, sold as adjacent entry choices.
  ["canon-eos-rebel-t7i", "canon-eos-rebel-t7", "alternative_to"],
];

async function main() {
  const client = await createAdminClient();
  const { data: userData, error: userError } = await client.auth.getUser();
  if (userError || !userData.user) throw new Error(`auth.getUser: ${userError?.message}`);
  console.log(`Authenticated as ${userData.user.email}\n`);

  // ---------- 1. Commons asset metadata ----------
  const { data: assets, error: assetErr } = await client
    .from("media_assets")
    .select("id, source_url, source_type, asset_role, creator, license");
  if (assetErr) throw new Error(`media_assets read failed: ${assetErr.message}`);

  const commons = assets.filter((a) => (a.source_url ?? "").includes("wikimedia.org"));
  const { data: pm, error: pmErr } = await client.from("product_media").select("media_id");
  if (pmErr) throw new Error(`product_media read failed: ${pmErr.message}`);
  const { data: cm, error: cmErr } = await client.from("content_media").select("media_id");
  if (cmErr) throw new Error(`content_media read failed: ${cmErr.message}`);
  const productLinked = new Set(pm.map((r) => r.media_id));
  const contentLinked = new Set(cm.map((r) => r.media_id));

  console.log(`=== Commons assets: ${commons.length} ===`);
  let fixed = 0;
  for (const a of commons) {
    const role = productLinked.has(a.id)
      ? ("product_photo" as const)
      : contentLinked.has(a.id)
        ? ("article_hero" as const)
        : null;
    if (role === null) {
      console.log(`  SKIP ${a.id} — not linked to a product or article; role cannot be derived, not guessing.`);
      continue;
    }
    if (a.source_type === "public_domain_or_cc" && a.asset_role === role) continue;

    const { error } = await client
      .from("media_assets")
      .update({ source_type: "public_domain_or_cc", asset_role: role })
      .eq("id", a.id);
    if (error) {
      console.error(`  FAILED ${a.id}: ${error.message}`);
      continue;
    }
    console.log(
      `  FIXED ${a.id}  source_type ${a.source_type ?? "NULL"} -> public_domain_or_cc, ` +
        `asset_role ${a.asset_role ?? "NULL"} -> ${role}   (${a.license} / ${a.creator})`
    );
    fixed++;
  }
  console.log(`  ${fixed} row(s) corrected.\n`);

  // ---------- 2/3. Links ----------
  const { data: prods, error: prodErr } = await client.from("products").select("id, slug");
  if (prodErr) throw new Error(`products read failed: ${prodErr.message}`);
  const pid = new Map(prods.map((p) => [p.slug, p.id]));

  const { data: items, error: itemErr } = await client.from("content_items").select("id, slug");
  if (itemErr) throw new Error(`content_items read failed: ${itemErr.message}`);
  const cid = new Map(items.map((i) => [i.slug, i.id]));

  const { data: existingCp, error: cpErr } = await client
    .from("content_products")
    .select("content_id, product_id");
  if (cpErr) throw new Error(`content_products read failed: ${cpErr.message}`);
  const cpKey = new Set(existingCp.map((r) => `${r.content_id}|${r.product_id}`));

  console.log(`=== content_products ===`);
  for (const [pSlug, aSlug, role] of CONTENT_LINKS) {
    const p = pid.get(pSlug);
    const a = cid.get(aSlug);
    if (!p || !a) {
      console.error(`  SKIP ${pSlug} <- ${aSlug}: slug not found.`);
      continue;
    }
    if (cpKey.has(`${a}|${p}`)) {
      console.log(`  SKIP (exists) ${pSlug} <- ${aSlug}`);
      continue;
    }
    const { error } = await client.from("content_products").insert({ content_id: a, product_id: p, role });
    if (error) console.error(`  FAILED ${pSlug} <- ${aSlug}: ${error.message}`);
    else console.log(`  LINKED [${role}] ${pSlug} <- ${aSlug}`);
  }

  const { data: existingRel, error: relErr } = await client
    .from("product_relationships")
    .select("product_id, related_product_id, relationship_type");
  if (relErr) throw new Error(`product_relationships read failed: ${relErr.message}`);

  console.log(`\n=== product_relationships ===`);
  for (const [aSlug, bSlug, type] of RELATIONSHIPS) {
    const a = pid.get(aSlug);
    const b = pid.get(bSlug);
    if (!a || !b) {
      console.error(`  SKIP ${aSlug} -> ${bSlug}: slug not found.`);
      continue;
    }
    // Guard against creating the reciprocal of a row that already exists in
    // EITHER direction — the reverse is inferred at query time, so inserting it
    // would render the same related product twice on both pages.
    const clash = existingRel.find(
      (r) =>
        (r.product_id === a && r.related_product_id === b) ||
        (r.product_id === b && r.related_product_id === a)
    );
    if (clash) {
      console.log(`  SKIP ${aSlug} -> ${bSlug}: a relationship already exists in one direction.`);
      continue;
    }
    const { error } = await client
      .from("product_relationships")
      .insert({ product_id: a, related_product_id: b, relationship_type: type });
    if (error) console.error(`  FAILED ${aSlug} -> ${bSlug}: ${error.message}`);
    else console.log(`  ADDED ${aSlug} -${type}-> ${bSlug}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
