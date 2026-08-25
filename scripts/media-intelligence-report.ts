// MEDIA INTELLIGENCE — run the real matcher over the real library.
//
// READ-ONLY. Writes nothing. Uses the same pure scorer the admin surface uses,
// so what it prints is what the suggestion queue will show.
//
//   npx tsx scripts/media-intelligence-report.ts
//   npx tsx scripts/media-intelligence-report.ts --needs      (content -> media)
//   npx tsx scripts/media-intelligence-report.ts --unattached (only unused assets)

import { loadEnvLocal, createAdminClient } from "./_shared.ts";
import {
  matchesForAsset,
  matchesForTarget,
  classifyNature,
  proposeAltText,
  NATURE_LABELS,
  type MatchAsset,
  type MatchTarget,
} from "../src/lib/media/match-engine.ts";

async function main(): Promise<void> {
  loadEnvLocal();
  const db = await createAdminClient();
  const wantNeeds = process.argv.includes("--needs");
  const onlyUnattached = process.argv.includes("--unattached");

  const [assetsRes, contentRes, productsRes, cmRes, pmRes, catsRes, mfrRes] = await Promise.all([
    db.from("media_assets").select(
      "id, storage_path, alt_text, caption, source_type, asset_role, brand_role, owned, ai_generated, publication_status, rights_status, width, height"
    ),
    db.from("content_items").select("id, title, status, category_id"),
    db.from("products").select("id, name, is_published, category_id, manufacturer_id"),
    db.from("content_media").select("content_id, media_id, role"),
    db.from("product_media").select("product_id, media_id, role"),
    db.from("taxonomy_categories").select("id, slug"),
    db.from("manufacturers").select("id, name"),
  ]);
  if (assetsRes.error) { console.error(assetsRes.error.message); process.exitCode = 1; return; }

  const catSlug = new Map(((catsRes.data ?? []) as any[]).map((c) => [c.id, c.slug]));
  const mfrName = new Map(((mfrRes.data ?? []) as any[]).map((m) => [m.id, m.name]));

  const assets: MatchAsset[] = ((assetsRes.data ?? []) as any[]).map((a) => ({
    id: a.id, storagePath: a.storage_path, altText: a.alt_text, caption: a.caption,
    sourceType: a.source_type, assetRole: a.asset_role, brandRole: a.brand_role,
    owned: a.owned === true, aiGenerated: a.ai_generated === true,
    publicationStatus: a.publication_status, rightsStatus: a.rights_status,
    width: a.width, height: a.height,
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

  const targets: MatchTarget[] = [
    ...((contentRes.data ?? []) as any[]).map((c) => ({
      id: c.id, kind: "content" as const, title: c.title, manufacturerName: null,
      categorySlug: c.category_id ? (catSlug.get(c.category_id) ?? null) : null,
      isModelSpecific: /\d/.test(c.title) && !/^\d+\s/.test(c.title),
      occupiedSlots: slots.get(`content:${c.id}`) ?? [],
    })),
    ...((productsRes.data ?? []) as any[]).map((p) => ({
      id: p.id, kind: "product" as const, title: p.name,
      manufacturerName: p.manufacturer_id ? (mfrName.get(p.manufacturer_id) ?? null) : null,
      categorySlug: p.category_id ? (catSlug.get(p.category_id) ?? null) : null,
      isModelSpecific: true,
      occupiedSlots: slots.get(`product:${p.id}`) ?? [],
    })),
  ];

  console.log("");
  console.log("=".repeat(76));
  console.log(`MEDIA INTELLIGENCE  —  ${assets.length} assets, ${targets.length} targets`);
  console.log("=".repeat(76));

  const byNature = new Map<string, number>();
  for (const a of assets) {
    const n = classifyNature(a);
    byNature.set(n, (byNature.get(n) ?? 0) + 1);
  }
  console.log("\nLIBRARY BY NATURE");
  for (const [n, c] of [...byNature].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(c).padStart(4)}  ${NATURE_LABELS[n as keyof typeof NATURE_LABELS]}`);
  }
  const unattached = assets.filter((a) => (usage.get(a.id) ?? 0) === 0);
  console.log(`\n  ${unattached.length} assets are attached to nothing.`);

  if (!wantNeeds) {
    console.log("\n" + "-".repeat(76));
    console.log("MEDIA -> CONTENT   (where could each image go?)");
    console.log("-".repeat(76));
    const pool = onlyUnattached ? unattached : assets;
    let shown = 0, matched = 0;
    for (const a of pool) {
      const m = matchesForAsset(a, targets, { limit: 3 });
      if (m.length === 0) continue;
      matched++;
      if (shown >= 14) continue;
      shown++;
      const file = a.storagePath.split("/").pop()!.replace(/^[0-9a-f-]{36}-/, "");
      console.log(`\n  ${file.slice(0, 66)}`);
      console.log(`     ${NATURE_LABELS[classifyNature(a)]}${(usage.get(a.id) ?? 0) === 0 ? "  ·  UNATTACHED" : ""}`);
      for (const x of m) {
        console.log(`     ${x.strength.toUpperCase().padEnd(6)} ${x.specificity.padEnd(12)} [${x.proposedSlots.join("+") || "none"}]  ${x.target.title.slice(0, 46)}`);
        console.log(`            ${x.reasons[0]?.slice(0, 92) ?? ""}`);
      }
      const alt = a.altText ? null : proposeAltText(a, m[0]);
      if (alt) console.log(`     ALT: ${alt.slice(0, 92)}`);
    }
    console.log(`\n  ${matched} of ${pool.length} assets have at least one safe target.`);
  } else {
    console.log("\n" + "-".repeat(76));
    console.log("CONTENT -> MEDIA   (which pages need visual work?)");
    console.log("-".repeat(76));
    const usable = assets.filter((a) => a.publicationStatus === "published" && a.rightsStatus !== "restricted");
    let needsCount = 0, withCandidate = 0, shown = 0;
    for (const t of targets) {
      const hasHero = t.occupiedSlots.some((s) => s.role === "hero");
      const hasThumb = t.occupiedSlots.some((s) => s.role === "thumbnail");
      if (hasHero && hasThumb) continue;
      needsCount++;
      const c = matchesForTarget(t, usable, { limit: 2 });
      if (c.length > 0) withCandidate++;
      if (shown >= 14 || c.length === 0) continue;
      shown++;
      console.log(`\n  ${t.kind.toUpperCase()} ${t.title.slice(0, 60)}`);
      console.log(`     needs: ${!hasHero ? "lead image" : "card image"}`);
      for (const x of c) {
        const f = assets.find((a) => a.id === x.assetId)!.storagePath.split("/").pop()!.replace(/^[0-9a-f-]{36}-/, "");
        console.log(`     ${x.strength.toUpperCase().padEnd(6)} [${x.proposedSlots.join("+")}]  ${f.slice(0, 52)}`);
      }
    }
    console.log(`\n  ${needsCount} targets lack a lead or card image; ${withCandidate} have a candidate already in the library.`);
    console.log(`  ${needsCount - withCandidate} need an image that does not exist yet.`);
  }

  console.log("\nRead-only. Nothing was written.");
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
