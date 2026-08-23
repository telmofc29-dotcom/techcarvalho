// Measures what the hero SELECTOR actually does to production.
//
// Route A's earlier audit (scripts/audit-hero-opportunities.ts) answered
// "which articles COULD lead with a photograph we already hold". This answers
// the question that matters after the routing fix landed: "which ones now DO,
// which ones deliberately keep their graphic, and which are left needing media
// that does not exist yet — and why."
//
// It runs the same pure function the site runs (selectArticleHero from
// src/lib/media/hero-selection.ts) over the same candidate set
// resolveArticleHeroes() assembles, against live production data read as
// `anon` — i.e. exactly the rows a visitor's request can see. Read-only: it
// signs in as nobody and writes nothing.
//
// Usage: npx tsx scripts/audit-hero-routing.ts [--json out.json]

import { writeFileSync } from "node:fs";
import { loadEnvLocal, createAnonClient } from "./_shared.ts";
import { classifyMediaTier, tierRank, type MediaTier } from "../src/lib/media/hierarchy.ts";
import {
  selectArticleHero,
  isEligibleHeroCandidate,
  productRelevance,
  type HeroCandidate,
  type ProductLinkRole,
} from "../src/lib/media/hero-selection.ts";

type AssetRow = {
  id: string;
  storage_path: string;
  public_storage_path: string | null;
  publication_status: string;
  alt_text: string | null;
  source_type: string | null;
  asset_role: string | null;
  owned: boolean;
  ai_generated: boolean;
  source_url: string | null;
  license: string | null;
  rights_status: string;
  brand_role: string | null;
  width: number | null;
  height: number | null;
};

function candidateOf(
  asset: AssetRow,
  origin: "article" | "product",
  extra: { linkRole?: ProductLinkRole | null; productName?: string | null; heroUseCount?: number } = {}
): HeroCandidate<AssetRow> {
  return {
    ref: asset,
    assetId: asset.id,
    asset: {
      source_type: asset.source_type,
      asset_role: asset.asset_role,
      owned: asset.owned,
      ai_generated: asset.ai_generated,
      storage_path: asset.storage_path,
      source_url: asset.source_url,
      license: asset.license,
    },
    origin,
    rightsStatus: asset.rights_status,
    publicationStatus: asset.publication_status,
    hasPublicCopy: Boolean(asset.public_storage_path),
    brandRole: asset.brand_role,
    width: asset.width,
    height: asset.height,
    ...extra,
  };
}

/** Tiers that show the reader the real thing. */
const REAL_IMAGERY: MediaTier[] = ["real_subject", "official_permitted", "original_photo", "licensed_third_party"];
const isReal = (t: MediaTier) => REAL_IMAGERY.includes(t);

async function main() {
  loadEnvLocal();
  const db = createAnonClient();
  const jsonFlag = process.argv.indexOf("--json");
  const outPath = jsonFlag >= 0 ? process.argv[jsonFlag + 1] : null;
  const nowIso = new Date().toISOString();

  const [articlesRes, cmRes, cpRes, productsRes, pmRes, assetsRes] = await Promise.all([
    db.from("content_items").select("id, title, slug, type").eq("status", "published").lte("published_at", nowIso),
    db.from("content_media").select("content_id, media_id, role, sort_order"),
    db.from("content_products").select("content_id, product_id, role"),
    db.from("products").select("id, name, slug").eq("is_published", true),
    db.from("product_media").select("product_id, media_id, role, sort_order"),
    db
      .from("media_assets")
      .select(
        "id, storage_path, public_storage_path, publication_status, alt_text, source_type, asset_role, owned, ai_generated, source_url, license, rights_status, brand_role, width, height"
      ),
  ]);
  for (const [name, res] of Object.entries({ articlesRes, cmRes, cpRes, productsRes, pmRes, assetsRes })) {
    if (res.error) throw new Error(`${name}: ${res.error.message}`);
  }

  const articles = articlesRes.data ?? [];
  const assetById = new Map<string, AssetRow>((assetsRes.data ?? []).map((a) => [a.id, a as unknown as AssetRow]));
  const productNameById = new Map((productsRes.data ?? []).map((p) => [p.id, p.name]));

  const incumbentByArticle = new Map<string, AssetRow>();
  const heroUseCount = new Map<string, number>();
  for (const row of cmRes.data ?? []) {
    if (row.role !== "hero") continue;
    heroUseCount.set(row.media_id, (heroUseCount.get(row.media_id) ?? 0) + 1);
    if (incumbentByArticle.has(row.content_id)) continue;
    const asset = assetById.get(row.media_id);
    if (asset) incumbentByArticle.set(row.content_id, asset);
  }

  const productHeroByProduct = new Map<string, AssetRow>();
  for (const link of [...(pmRes.data ?? [])].sort((a, b) => a.sort_order - b.sort_order)) {
    if (link.role !== "hero" || !productNameById.has(link.product_id)) continue;
    if (productHeroByProduct.has(link.product_id)) continue;
    const asset = assetById.get(link.media_id);
    if (asset) productHeroByProduct.set(link.product_id, asset);
  }

  const linksByArticle = new Map<string, { product_id: string; role: ProductLinkRole }[]>();
  for (const link of cpRes.data ?? []) {
    const list = linksByArticle.get(link.content_id) ?? [];
    list.push({ product_id: link.product_id, role: link.role as ProductLinkRole });
    linksByArticle.set(link.content_id, list);
  }

  const rows = articles.map((article) => {
    const incumbentAsset = incumbentByArticle.get(article.id) ?? null;
    const incumbent = incumbentAsset
      ? candidateOf(incumbentAsset, "article", { heroUseCount: heroUseCount.get(incumbentAsset.id) ?? 0 })
      : null;

    const links = linksByArticle.get(article.id) ?? [];
    const candidates: HeroCandidate<AssetRow>[] = [];
    const seen = new Set<string>();
    for (const link of links) {
      const asset = productHeroByProduct.get(link.product_id);
      if (!asset || seen.has(asset.id)) continue;
      seen.add(asset.id);
      candidates.push(
        candidateOf(asset, "product", {
          linkRole: link.role,
          productName: productNameById.get(link.product_id) ?? null,
          heroUseCount: heroUseCount.get(asset.id) ?? 0,
        })
      );
    }

    const decision = selectArticleHero({
      contentId: article.id,
      title: article.title,
      contentType: article.type,
      incumbent,
      candidates,
    });

    return {
      slug: article.slug,
      title: article.title,
      type: article.type,
      subject: decision.subject,
      before: decision.incumbentTier,
      after: decision.winnerTier,
      changed: !decision.keptIncumbent,
      shared: decision.incumbentShared,
      linkedProducts: links.length,
      productPhotoCandidates: candidates.length,
      candidateDetail: candidates.map((c) => ({
        product: c.productName,
        linkRole: c.linkRole,
        tier: classifyMediaTier(c.asset),
        relevance: productRelevance(c.linkRole, c.productName, article.title),
        eligible: isEligibleHeroCandidate(c),
        alreadyLeads: c.heroUseCount ?? 0,
      })),
      winnerAssetId: decision.winner?.assetId ?? null,
      winnerPath: decision.winner?.ref.storage_path ?? null,
      reason: decision.reason,
    };
  });

  const tally = (pick: (r: (typeof rows)[number]) => MediaTier) => {
    const d: Record<string, number> = {};
    for (const r of rows) d[pick(r)] = (d[pick(r)] ?? 0) + 1;
    return Object.entries(d).sort((a, b) => tierRank(a[0] as MediaTier) - tierRank(b[0] as MediaTier));
  };

  console.log(`Published articles: ${rows.length}\n`);
  console.log("Hero tier distribution           BEFORE   AFTER");
  const tiers = new Set([...rows.map((r) => r.before), ...rows.map((r) => r.after)]);
  for (const tier of [...tiers].sort((a, b) => tierRank(a) - tierRank(b))) {
    const before = rows.filter((r) => r.before === tier).length;
    const after = rows.filter((r) => r.after === tier).length;
    console.log(`  ${tier.padEnd(28)} ${String(before).padStart(5)}   ${String(after).padStart(5)}`);
  }
  void tally;

  const realBefore = rows.filter((r) => isReal(r.before)).length;
  const realAfter = rows.filter((r) => isReal(r.after)).length;
  console.log(`\nArticles leading with real imagery: ${realBefore} -> ${realAfter} (+${realAfter - realBefore})`);

  const productLinked = rows.filter((r) => r.productPhotoCandidates > 0);
  console.log(`\nProduct-linked articles (a published product with a held photograph): ${productLinked.length}`);
  console.log(`  now lead with real photography:      ${productLinked.filter((r) => isReal(r.after)).length}`);
  console.log(`  deliberately keep a graphic:         ${productLinked.filter((r) => !isReal(r.after)).length}`);

  console.log(`\nChanged by the selector: ${rows.filter((r) => r.changed).length}`);
  for (const r of rows.filter((r) => r.changed)) {
    console.log(`  ${r.before} -> ${r.after}  ${r.slug}`);
    console.log(`      ${r.reason}`);
  }

  console.log(`\nStill NOT leading with real imagery: ${rows.filter((r) => !isReal(r.after)).length}`);
  const classes = new Map<string, typeof rows>();
  for (const r of rows.filter((x) => !isReal(x.after))) {
    const key =
      r.productPhotoCandidates === 0
        ? "A. No published product with a held photograph is linked at all"
        : r.after === "data_graphic"
          ? "B. Keeps a chart/diagram/timeline that is the right lead for this page"
          : r.shared
            ? "D. Shared category card, and no linked product cleared relevance"
            : "C. Keeps a title card written for this article; linked products are only mentioned in passing";
    const list = classes.get(key) ?? [];
    list.push(r);
    classes.set(key, list);
  }
  for (const [key, list] of [...classes].sort()) {
    console.log(`\n  ${key}: ${list.length}`);
    for (const r of list) console.log(`      [${r.after}] ${r.slug}`);
  }

  // Duplicate use AFTER selection: the failure mode the fix must not recreate.
  const afterUse = new Map<string, string[]>();
  for (const r of rows) {
    if (!r.winnerAssetId) continue;
    const list = afterUse.get(r.winnerAssetId) ?? [];
    list.push(r.slug);
    afterUse.set(r.winnerAssetId, list);
  }
  const sharedAfter = [...afterUse.entries()].filter(([, s]) => s.length > 1).sort((a, b) => b[1].length - a[1].length);
  const beforeShared = [...heroUseCount.entries()].filter(([, n]) => n > 1);
  console.log(
    `\nShared lead images: ${beforeShared.length} assets over ${beforeShared.reduce((s, [, n]) => s + n, 0)} articles ` +
      `-> ${sharedAfter.length} assets over ${sharedAfter.reduce((s, [, l]) => s + l.length, 0)} articles`
  );
  for (const [assetId, slugs] of sharedAfter) {
    console.log(`  ${slugs.length}x ${assetById.get(assetId)?.storage_path}`);
    for (const s of slugs) console.log(`      ${s}`);
  }

  if (outPath) {
    writeFileSync(outPath, JSON.stringify(rows, null, 2), "utf-8");
    console.log(`\nFull report written to ${outPath}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
