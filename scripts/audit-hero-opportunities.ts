// Route A audit — "which published articles could lead with a photograph we
// ALREADY hold?"
//
// Regenerates the opportunity list from production rather than trusting a
// previous audit: joins content_products -> published products ->
// product_media(role='hero') -> media_assets, and classifies every asset on
// both sides with classifyMediaTier() from src/lib/media/hierarchy.ts.
//
// Read-only. Signs in as a real admin (same RLS path as the app, no
// service-role key) only so that unpublished rows are visible for an accurate
// denominator; it never writes.
//
// Usage: TC_ADMIN_EMAIL=... TC_ADMIN_PASSWORD=... npx tsx scripts/audit-hero-opportunities.ts [--json out.json]

import { writeFileSync } from "node:fs";
import { loadEnvLocal, createAdminClient } from "./_shared.ts";
import { classifyMediaTier, evaluateHero, inferSubjectKind, tierRank, type MediaTier } from "../src/lib/media/hierarchy.ts";

type AssetRow = {
  id: string;
  storage_path: string;
  public_storage_path: string | null;
  publication_status: string;
  alt_text: string | null;
  caption: string | null;
  source_type: string | null;
  asset_role: string | null;
  owned: boolean;
  ai_generated: boolean;
  source_url: string | null;
  license: string | null;
  creator: string | null;
  attribution: string | null;
  attribution_required: boolean;
  rights_status: string;
};

async function main() {
  loadEnvLocal();
  const db = await createAdminClient();

  const jsonFlag = process.argv.indexOf("--json");
  const outPath = jsonFlag >= 0 ? process.argv[jsonFlag + 1] : null;

  const { data: articles, error: articlesErr } = await db
    .from("content_items")
    .select("id, title, slug, type, status, published_at, category_id")
    .eq("status", "published")
    .lte("published_at", new Date().toISOString())
    .order("published_at", { ascending: false });
  if (articlesErr) throw new Error(`articles: ${articlesErr.message}`);
  const arts = articles ?? [];

  const { data: cm, error: cmErr } = await db.from("content_media").select("id, content_id, media_id, role, sort_order");
  if (cmErr) throw new Error(`content_media: ${cmErr.message}`);

  const { data: cp, error: cpErr } = await db.from("content_products").select("content_id, product_id, role");
  if (cpErr) throw new Error(`content_products: ${cpErr.message}`);

  const { data: products, error: pErr } = await db
    .from("products")
    .select("id, name, slug, is_published, manufacturer_id");
  if (pErr) throw new Error(`products: ${pErr.message}`);

  const { data: pm, error: pmErr } = await db.from("product_media").select("product_id, media_id, role, sort_order");
  if (pmErr) throw new Error(`product_media: ${pmErr.message}`);

  const { data: assets, error: aErr } = await db
    .from("media_assets")
    .select(
      "id, storage_path, public_storage_path, publication_status, alt_text, caption, source_type, asset_role, owned, ai_generated, source_url, license, creator, attribution, attribution_required, rights_status"
    );
  if (aErr) throw new Error(`media_assets: ${aErr.message}`);

  const assetById = new Map<string, AssetRow>((assets ?? []).map((a) => [a.id, a as unknown as AssetRow]));
  const productById = new Map((products ?? []).map((p) => [p.id, p]));

  // product -> hero asset (published products only)
  const productHero = new Map<string, AssetRow>();
  for (const link of pm ?? []) {
    if (link.role !== "hero") continue;
    const a = assetById.get(link.media_id);
    if (!a) continue;
    if (!productHero.has(link.product_id)) productHero.set(link.product_id, a);
  }

  const cmByContent = new Map<string, typeof cm>();
  for (const row of cm ?? []) {
    const list = cmByContent.get(row.content_id) ?? [];
    list.push(row);
    cmByContent.set(row.content_id, list);
  }
  const cpByContent = new Map<string, typeof cp>();
  for (const row of cp ?? []) {
    const list = cpByContent.get(row.content_id) ?? [];
    list.push(row);
    cpByContent.set(row.content_id, list);
  }

  const report = arts.map((art) => {
    const media = cmByContent.get(art.id) ?? [];
    const heroLink = media.find((m) => m.role === "hero");
    const heroAsset = heroLink ? assetById.get(heroLink.media_id) ?? null : null;
    const heroTier = classifyMediaTier(heroAsset);
    const subject = inferSubjectKind({ contentType: art.type, title: art.title });
    const verdict = evaluateHero(heroTier, subject);

    const candidates = (cpByContent.get(art.id) ?? [])
      .map((link) => {
        const prod = productById.get(link.product_id);
        if (!prod || !prod.is_published) return null;
        const asset = productHero.get(link.product_id);
        if (!asset) return null;
        return {
          productId: prod.id,
          productName: prod.name,
          productSlug: prod.slug,
          linkRole: link.role,
          assetId: asset.id,
          assetTier: classifyMediaTier(asset),
          assetPath: asset.storage_path,
          publicationStatus: asset.publication_status,
          rightsStatus: asset.rights_status,
          sourceType: asset.source_type,
          assetRole: asset.asset_role,
          license: asset.license,
          creator: asset.creator,
          attribution: asset.attribution,
          attributionRequired: asset.attribution_required,
          sourceUrl: asset.source_url,
          altText: asset.alt_text,
          owned: asset.owned,
        };
      })
      .filter((c): c is NonNullable<typeof c> => c !== null)
      .sort((a, b) => tierRank(a.assetTier) - tierRank(b.assetTier));

    return {
      id: art.id,
      slug: art.slug,
      title: art.title,
      type: art.type,
      subject,
      heroLinkId: heroLink?.id ?? null,
      heroAssetId: heroAsset?.id ?? null,
      heroAssetPath: heroAsset?.storage_path ?? null,
      heroTier,
      heroAcceptable: verdict.acceptable,
      heroShouldReplace: verdict.shouldReplace,
      heroReason: verdict.reason,
      galleryCount: media.filter((m) => m.role === "gallery").length,
      allMedia: media.map((m) => ({
        linkId: m.id,
        role: m.role,
        sortOrder: m.sort_order,
        assetId: m.media_id,
        path: assetById.get(m.media_id)?.storage_path ?? null,
        tier: classifyMediaTier(assetById.get(m.media_id)),
      })),
      candidates,
    };
  });

  const dist: Record<string, number> = {};
  for (const r of report) dist[r.heroTier] = (dist[r.heroTier] ?? 0) + 1;

  console.log(`Published articles: ${report.length}`);
  console.log("Current hero tier distribution:");
  for (const [tier, n] of Object.entries(dist).sort((a, b) => tierRank(a[0] as MediaTier) - tierRank(b[0] as MediaTier))) {
    console.log(`  ${tier.padEnd(22)} ${n}`);
  }

  const withCandidates = report.filter((r) => r.candidates.length > 0);
  console.log(`\nArticles linked to a published product that already has a hero asset: ${withCandidates.length}`);

  const upgradable = withCandidates.filter((r) => r.candidates.some((c) => tierRank(c.assetTier) < tierRank(r.heroTier)));
  console.log(`Of those, where the product asset is a STRICTLY better tier: ${upgradable.length}`);

  console.log("\nBy content_products role (strict upgrades only):");
  const byRole: Record<string, number> = {};
  for (const r of upgradable) {
    const best = r.candidates.find((c) => tierRank(c.assetTier) < tierRank(r.heroTier))!;
    byRole[best.linkRole] = (byRole[best.linkRole] ?? 0) + 1;
  }
  for (const [role, n] of Object.entries(byRole)) console.log(`  ${role.padEnd(20)} ${n}`);

  if (outPath) {
    writeFileSync(outPath, JSON.stringify(report, null, 2), "utf-8");
    console.log(`\nFull report written to ${outPath}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
