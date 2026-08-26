// Run the REAL matcher against REAL production media and content.
//
// suggestion-service.ts is server-only, so this loads the same rows with the
// admin client and calls the same pure scorer the app calls. What it proves is
// behaviour on the actual library, not on fixtures: "the code exists" and "the
// tests pass" are both weaker claims than "here is what it did to your data".
//
// It writes nothing.
//
//   TC_ADMIN_EMAIL=... TC_ADMIN_PASSWORD=... npx tsx scripts/verify-media-matching.ts

import { loadEnvLocal, createAdminClient } from "./_shared.ts";
import {
  scoreMatch,
  matchesForTarget,
  classifyNature,
  verifiedVerdict,
  type MatchAsset,
  type MatchTarget,
  type VerifiedProduct,
} from "../src/lib/media/match-engine.ts";

async function main(): Promise<void> {
  loadEnvLocal();
  const db = await createAdminClient();

  const [assetsRes, contentRes, productsRes, cmRes, pmRes, catsRes, mfrRes] = await Promise.all([
    db.from("media_assets").select(
      "id, storage_path, alt_text, caption, source_type, asset_role, brand_role, owned, ai_generated, publication_status, rights_status, width, height"
    ),
    db.from("content_items").select("id, title, status, category_id"),
    db.from("products").select("id, name, is_published, category_id, manufacturer_id, family_id"),
    db.from("content_media").select("content_id, media_id, role"),
    db.from("product_media").select("product_id, media_id, role"),
    db.from("taxonomy_categories").select("id, slug"),
    db.from("manufacturers").select("id, name"),
  ]);
  for (const [n, r] of [["assets", assetsRes], ["content", contentRes], ["products", productsRes]] as const) {
    if (r.error) throw new Error(`${n}: ${r.error.message}`);
  }

  const catSlug = new Map(((catsRes.data ?? []) as any[]).map((c) => [c.id, c.slug]));
  const mfrName = new Map(((mfrRes.data ?? []) as any[]).map((m) => [m.id, m.name]));

  const productById = new Map(
    ((productsRes.data ?? []) as any[]).map((p) => [
      String(p.id),
      { name: String(p.name), manufacturerName: mfrName.get(p.manufacturer_id) ?? null, familyId: p.family_id ?? null },
    ])
  );
  const verifiedByAsset = new Map<string, VerifiedProduct[]>();
  for (const l of (pmRes.data ?? []) as any[]) {
    const p = productById.get(String(l.product_id));
    if (!p) continue;
    const list = verifiedByAsset.get(String(l.media_id)) ?? [];
    list.push({ productId: String(l.product_id), ...p });
    verifiedByAsset.set(String(l.media_id), list);
  }

  const assets: MatchAsset[] = ((assetsRes.data ?? []) as any[]).map((a) => ({
    id: a.id, storagePath: a.storage_path, altText: a.alt_text, caption: a.caption,
    sourceType: a.source_type, assetRole: a.asset_role, brandRole: a.brand_role,
    owned: a.owned === true, aiGenerated: a.ai_generated === true,
    publicationStatus: a.publication_status, rightsStatus: a.rights_status,
    width: a.width, height: a.height,
    verifiedProducts: verifiedByAsset.get(String(a.id)) ?? [],
  }));

  const slots = new Map<string, { role: "hero" | "thumbnail" | "gallery"; humanSelected: boolean }[]>();
  const usage = new Map<string, number>();
  const push = (k: string, role: string, mediaId: string) => {
    if (role !== "hero" && role !== "thumbnail" && role !== "gallery") return;
    slots.set(k, [...(slots.get(k) ?? []), { role, humanSelected: true }]);
    usage.set(mediaId, (usage.get(mediaId) ?? 0) + 1);
  };
  for (const r of (cmRes.data ?? []) as any[]) push(`content:${r.content_id}`, r.role, r.media_id);
  for (const r of (pmRes.data ?? []) as any[]) push(`product:${r.product_id}`, r.role, r.media_id);

  const contentTargets: MatchTarget[] = ((contentRes.data ?? []) as any[]).map((c) => ({
    id: c.id, kind: "content" as const, title: c.title, manufacturerName: null,
    categorySlug: c.category_id ? (catSlug.get(c.category_id) ?? null) : null,
    isModelSpecific: /\d/.test(c.title) && !/^\d+\s/.test(c.title),
    occupiedSlots: slots.get(`content:${c.id}`) ?? [],
  }));
  const productTargets: MatchTarget[] = ((productsRes.data ?? []) as any[]).map((p) => ({
    id: p.id, kind: "product" as const, productId: p.id, familyId: p.family_id, title: p.name,
    manufacturerName: p.manufacturer_id ? (mfrName.get(p.manufacturer_id) ?? null) : null,
    categorySlug: p.category_id ? (catSlug.get(p.category_id) ?? null) : null,
    isModelSpecific: true,
    occupiedSlots: slots.get(`product:${p.id}`) ?? [],
  }));

  const usable = assets.filter((a) => a.publicationStatus === "published" && a.rightsStatus !== "restricted");
  console.log(`\n${"=".repeat(78)}`);
  console.log(`REAL LIBRARY: ${assets.length} assets (${usable.length} usable), ` +
    `${contentTargets.length} articles, ${productTargets.length} products, ` +
    `${verifiedByAsset.size} assets with verified product identity`);
  console.log("=".repeat(78));

  const file = (a: MatchAsset) => (a.storagePath.split("/").pop() ?? "").replace(/^[0-9a-f-]{36}-/, "").slice(0, 46);

  // ---- 1. Articles with no hero, and what the matcher offers --------------
  console.log("\n--- ARTICLES NEEDING A HERO: what the matcher proposes ---");
  const needing = contentTargets.filter((t) => !t.occupiedSlots.some((s) => s.role === "hero"));
  let shown = 0, awaiting = 0;
  for (const t of needing) {
    const m = matchesForTarget(t, usable, { limit: 3 });
    const best = m.find((x) => x.proposedSlots.includes("hero"));
    if (!best) {
      awaiting++;
      if (awaiting <= 4 && m.length > 0) {
        const a0 = usable.find((x) => x.id === m[0].assetId)!;
        console.log(`
  NO HERO  ${t.title.slice(0, 60)}`);
        console.log(`  best     ${file(a0)} (${m[0].specificity}/${m[0].strength}, ${a0.width}x${a0.height})`);
        console.log(`  withheld ${(m[0].withheld[0] ?? "(nothing recorded)").slice(0, 96)}`);
      } else if (awaiting <= 4) {
        console.log(`
  NO HERO  ${t.title.slice(0, 60)}  -- no candidate scored at all`);
      }
      continue;
    }
    if (shown++ >= 6) continue;
    const a = usable.find((x) => x.id === best.assetId)!;
    console.log(`\n  ARTICLE  ${t.title.slice(0, 66)}`);
    console.log(`  IMAGE    ${file(a)}`);
    console.log(`  WHY      ${best.specificity} / ${best.strength} / ${classifyNature(a)}`);
    for (const r of best.reasons.slice(0, 2)) console.log(`           - ${r.slice(0, 96)}`);
  }
  console.log(`\n  ${shown > 6 ? 6 : shown} shown; ${needing.length} articles lack a hero; ` +
    `${awaiting} of them have NO acceptable candidate -> AWAITING MEDIA`);

  // ---- 2. Deliberate false matches ---------------------------------------
  console.log("\n--- DELIBERATE FALSE MATCHES: what the matcher REFUSES ---");
  let refusals = 0;
  for (const a of usable) {
    for (const t of productTargets) {
      const m = scoreMatch(a, t);
      const v = verifiedVerdict(a, t);
      // The interesting refusals: text looks related, identity says otherwise.
      if (v === "verified_other_product" && m.specificity !== "exact_model") {
        if (refusals++ >= 5) break;
        console.log(`\n  REFUSED  ${file(a)}`);
        console.log(`  FOR      ${t.title.slice(0, 60)}`);
        console.log(`  WHY      ${(m.reasons[0] ?? m.withheld[0] ?? "").slice(0, 104)}`);
      }
    }
    if (refusals >= 5) break;
  }
  if (refusals === 0) console.log("  (no verified-identity conflicts in the current library)");

  // ---- 3. Model-specific targets never accept family-level images ---------
  console.log("\n--- SKU RULE ON REAL DATA ---");
  let offered = 0, checked = 0;
  for (const t of productTargets.slice(0, 120)) {
    for (const m of matchesForTarget(t, usable, { limit: 3 })) {
      checked++;
      if (m.specificity !== "exact_model" && m.proposedSlots.length > 0) offered++;
    }
  }
  console.log(`  ${checked} model-specific pairings examined; ` +
    `${offered} non-exact images offered a slot ${offered === 0 ? "(correct)" : "(THIS IS A DEFECT)"}`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
