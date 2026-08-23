// Run the content quality inventory against production.
//
//   TC_ADMIN_EMAIL=... TC_ADMIN_PASSWORD=... npx tsx scripts/content-inventory.ts
//
// READ-ONLY. It changes nothing; it reports what the corpus actually looks like
// so editorial decisions are made against measurements rather than impressions.
//
// Every read checks its own error. An earlier throwaway probe in this project
// used `?? []` around a query with a wrong column name, reported "0 rows", and
// produced a fabricated measurement — twice. A failed read here throws.

import { loadEnvLocal, createAdminClient } from "./_shared.ts";
import { assessContent, findOverlaps, type ContentSignals } from "../src/lib/content/quality-inventory.ts";

loadEnvLocal();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = { from: (t: string) => any };

async function read<T>(db: Db, table: string, columns: string): Promise<T[]> {
  const { data, error } = await db.from(table).select(columns);
  if (error) throw new Error(`reading ${table} (${columns}) failed: ${error.message}`);
  if (data === null) throw new Error(`reading ${table} returned null rather than rows`);
  return data as T[];
}

async function main(): Promise<void> {
  const db = (await createAdminClient()) as unknown as Db;

  const content = await read<{
    id: string; slug: string; title: string; type: string; body: string | null; status: string;
    category_id: string | null;
  }>(db, "content_items", "id,slug,title,type,body,status,category_id");
  const published = content.filter((c) => c.status === "published");

  const sources = await read<{ content_id: string | null; reliability_tier: string }>(
    db, "source_records", "content_id,reliability_tier"
  );
  const links = await read<{ content_id: string; related_content_id: string }>(
    db, "content_relationships", "content_id,related_content_id"
  );
  const contentProducts = await read<{ content_id: string; product_id: string }>(
    db, "content_products", "content_id,product_id"
  );
  const contentMedia = await read<{ content_id: string; media_id: string; role: string }>(
    db, "content_media", "content_id,media_id,role"
  );
  const media = await read<{ id: string; source_type: string | null }>(
    db, "media_assets", "id,source_type"
  );

  const mediaType = new Map(media.map((m) => [m.id, m.source_type]));
  const srcCount = new Map<string, number>();
  const primaryCount = new Map<string, number>();
  for (const s of sources) {
    if (!s.content_id) continue;
    srcCount.set(s.content_id, (srcCount.get(s.content_id) ?? 0) + 1);
    if (s.reliability_tier === "primary") {
      primaryCount.set(s.content_id, (primaryCount.get(s.content_id) ?? 0) + 1);
    }
  }
  const linkCount = new Map<string, number>();
  for (const l of links) {
    linkCount.set(l.content_id, (linkCount.get(l.content_id) ?? 0) + 1);
    linkCount.set(l.related_content_id, (linkCount.get(l.related_content_id) ?? 0) + 1);
  }
  const productCount = new Map<string, number>();
  for (const cp of contentProducts) {
    productCount.set(cp.content_id, (productCount.get(cp.content_id) ?? 0) + 1);
  }
  const heroGeneric = new Map<string, boolean>();
  for (const cm of contentMedia) {
    if (cm.role !== "hero") continue;
    heroGeneric.set(cm.content_id, mediaType.get(cm.media_id) === "tc_graphic");
  }

  // Corroborated overlap: a shared linked product or a shared category, not
  // headline similarity alone. Without this the detector proposed merging a
  // Canon DSLR comparison into a PlayStation one, because both are
  // "X vs Y: is the upgrade worth it".
  const productsByContent = new Map<string, string[]>();
  for (const cp of contentProducts) {
    productsByContent.set(cp.content_id, [...(productsByContent.get(cp.content_id) ?? []), cp.product_id]);
  }
  const overlaps = findOverlaps(
    published.map((c) => ({
      id: c.id,
      title: c.title,
      productIds: productsByContent.get(c.id) ?? [],
      categoryId: c.category_id,
    }))
  );

  const assessments = published.map((c) =>
    assessContent({
      id: c.id, slug: c.slug, title: c.title, contentType: c.type, body: c.body,
      sourceCount: srcCount.get(c.id) ?? 0,
      primarySourceCount: primaryCount.get(c.id) ?? 0,
      linkedProductCount: productCount.get(c.id) ?? 0,
      heroIsGeneric: heroGeneric.get(c.id) ?? true,
      internalLinkCount: linkCount.get(c.id) ?? 0,
      overlaps: overlaps.get(c.id) ?? [],
    } satisfies ContentSignals)
  );

  const by = (v: string) => assessments.filter((a) => a.verdict === v);
  console.log(`=== CONTENT INVENTORY — ${published.length} published pieces ===\n`);
  for (const v of ["MERGE", "REVIEW", "IMPROVE", "KEEP"]) {
    console.log(`${v.padEnd(8)} ${by(v).length}`);
  }

  for (const v of ["MERGE", "REVIEW"]) {
    const rows = by(v);
    if (rows.length === 0) continue;
    console.log(`\n--- ${v} ---`);
    for (const a of rows) {
      console.log(`  ${String(a.words).padStart(5)}w  ${a.title.slice(0, 64)}`);
      for (const r of a.reasons.slice(0, 2)) console.log(`         ${r.slice(0, 120)}`);
    }
  }

  console.log(`\n--- IMPROVE, worst 12 by shortfall against their own floor ---`);
  for (const a of by("IMPROVE").sort((x, y) => x.words / x.floor - y.words / y.floor).slice(0, 12)) {
    console.log(`  ${String(a.words).padStart(5)}w / ${a.floor}  ${a.title.slice(0, 60)}`);
  }

  const noSources = assessments.filter((a) => a.reasons.some((r) => r.includes("No source records")));
  const orphans = assessments.filter((a) => a.reasons.some((r) => r.includes("links to nothing")));
  const genericHero = assessments.filter((a) => a.reasons.some((r) => r.includes("generated graphic while")));
  console.log(`\nno sources at all      : ${noSources.length}`);
  console.log(`orphans                : ${orphans.length}`);
  console.log(`generic hero + products: ${genericHero.length}`);
}

main().catch((e) => {
  console.error("inventory failed:", e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
