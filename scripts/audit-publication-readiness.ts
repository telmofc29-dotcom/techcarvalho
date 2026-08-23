// Which unpublished products are actually ready to be pages?
//
//   TC_ADMIN_EMAIL=... TC_ADMIN_PASSWORD=... npx tsx scripts/audit-publication-readiness.ts
//
// READ-ONLY. Publishes nothing, and there is no flag that makes it.
//
// The judgement lives in src/lib/catalogue/publication-readiness.ts and is
// unit-tested there. This fetches, joins and tallies.

import { loadEnvLocal, createAdminClient } from "./_shared.ts";
import {
  assessReadiness, summarise, commonestGaps,
  type ReadinessInput, type ReadinessResult,
} from "../src/lib/catalogue/publication-readiness.ts";
import { judgeSubject, type SubjectMediaAsset } from "../src/lib/media/subject-match.ts";

loadEnvLocal();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = { from: (t: string) => any };

async function all(db: Db, table: string, cols: string): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from(table).select(cols).range(from, from + 999);
    if (error) throw new Error(`reading ${table} failed: ${error.message}`);
    if (data === null) throw new Error(`${table} returned null rather than rows`);
    out.push(...(data as Record<string, unknown>[]));
    if ((data as unknown[]).length < 1000) break;
  }
  return out;
}

/** Specs a reader of each category looks for first. */
const KEY_SPECS: Record<string, string[]> = {
  "camera-lenses": ["focal-length-min", "aperture-max", "lens-mount-type", "lens-weight", "filter-diameter", "min-focus-distance"],
  "3d-printing": ["build-volume-x", "build-volume-y", "build-volume-z", "nozzle-temp-max", "print-technology", "bed-temp-max"],
  "cameras-photography": ["sensor-format", "effective-megapixels", "lens-mount", "iso-range"],
};

async function main(): Promise<void> {
  const db = (await createAdminClient()) as unknown as Db;

  const products = await all(db, "products", "id,slug,name,summary,manufacturer_id,category_id,is_published");
  const cats = await all(db, "taxonomy_categories", "id,slug");
  const catById = new Map(cats.map((c) => [String(c.id), String(c.slug)]));
  const mfrs = await all(db, "manufacturers", "id,name");
  const mfrById = new Map(mfrs.map((m) => [String(m.id), String(m.name)]));
  const defs = await all(db, "spec_definitions", "id,slug");
  const defById = new Map(defs.map((d) => [String(d.id), String(d.slug)]));

  const specs = await all(db, "product_specs", "product_id,spec_definition_id");
  const specsByProduct = new Map<string, string[]>();
  for (const s of specs) {
    const slug = defById.get(String(s.spec_definition_id));
    if (!slug) continue;
    const k = String(s.product_id);
    specsByProduct.set(k, [...(specsByProduct.get(k) ?? []), slug]);
  }

  const sources = await all(db, "source_records", "product_id,reliability_tier,source_class");
  const srcByProduct = new Map<string, { primary: number; total: number }>();
  for (const s of sources) {
    if (!s.product_id) continue;
    const k = String(s.product_id);
    const cur = srcByProduct.get(k) ?? { primary: 0, total: 0 };
    cur.total++;
    if (s.reliability_tier === "primary" || s.source_class === "manufacturer_official") cur.primary++;
    srcByProduct.set(k, cur);
  }

  const rels = await all(db, "product_relationships", "product_id,related_product_id");
  const relCount = new Map<string, number>();
  for (const r of rels) {
    for (const id of [String(r.product_id), String(r.related_product_id)]) {
      relCount.set(id, (relCount.get(id) ?? 0) + 1);
    }
  }

  const techs = await all(db, "product_technologies", "product_id");
  const techCount = new Map<string, number>();
  for (const t of techs) techCount.set(String(t.product_id), (techCount.get(String(t.product_id)) ?? 0) + 1);

  const assets = await all(db, "media_assets", "id,alt_text,caption,source_type,asset_role,brand_role,rights_status");
  const assetById = new Map<string, SubjectMediaAsset & { rights: string }>(
    assets.map((a) => [String(a.id), {
      id: String(a.id), altText: (a.alt_text as string) ?? null, caption: (a.caption as string) ?? null,
      sourceType: (a.source_type as string) ?? null, assetRole: (a.asset_role as string) ?? null,
      brandRole: (a.brand_role as string) ?? null, rights: String(a.rights_status),
    }])
  );
  const pmLinks = await all(db, "product_media", "media_id,product_id");
  const mediaByProduct = new Map<string, (SubjectMediaAsset & { rights: string })[]>();
  for (const l of pmLinks) {
    const a = assetById.get(String(l.media_id));
    if (!a) continue;
    const k = String(l.product_id);
    mediaByProduct.set(k, [...(mediaByProduct.get(k) ?? []), a]);
  }

  const results: (ReadinessResult & { published: boolean; category: string })[] = products.map((p) => {
    const id = String(p.id);
    const category = catById.get(String(p.category_id)) ?? "?";
    const held = specsByProduct.get(id) ?? [];
    const keys = KEY_SPECS[category] ?? [];
    const media = mediaByProduct.get(id) ?? [];
    const src = srcByProduct.get(id) ?? { primary: 0, total: 0 };

    const input: ReadinessInput = {
      slug: String(p.slug),
      name: String(p.name),
      specCount: held.length,
      keySpecCount: keys.length ? keys.filter((k) => held.includes(k)).length : Math.min(held.length, 4),
      primarySourceCount: src.primary,
      sourceCount: src.total,
      hasExactMedia: judgeSubject(media, { name: String(p.name), manufacturerName: mfrById.get(String(p.manufacturer_id)) ?? null }) === "strong",
      hasAnyMedia: media.length > 0,
      relationshipCount: relCount.get(id) ?? 0,
      technologyCount: techCount.get(id) ?? 0,
      hasSummary: typeof p.summary === "string" && p.summary.trim().length > 20,
      hasRightsIssue: media.some((m) => m.rights === "restricted"),
      identityUncertain: false,
    };
    return { ...assessReadiness(input), published: p.is_published === true, category };
  });

  const unpublished = results.filter((r) => !r.published);
  console.log("=== PUBLICATION READINESS (production, read-only) ===\n");
  console.log(`products ${results.length}  |  published ${results.length - unpublished.length}  |  unpublished ${unpublished.length}\n`);

  console.log("UNPUBLISHED, by verdict");
  const s = summarise(unpublished);
  for (const [k, v] of Object.entries(s)) console.log(`  ${String(v).padStart(4)}  ${k}`);

  console.log("\nUNPUBLISHED, by category");
  const byCat = new Map<string, typeof unpublished>();
  for (const r of unpublished) byCat.set(r.category, [...(byCat.get(r.category) ?? []), r]);
  for (const [cat, rows] of [...byCat].sort((a, b) => b[1].length - a[1].length)) {
    const t = summarise(rows);
    console.log(`  ${String(rows.length).padStart(4)} ${cat.padEnd(22)} ready ${t.ready}  nearly ${t.nearly}  not_ready ${t.not_ready}  blocked ${t.blocked}`);
  }

  console.log("\nCOMMONEST GAPS — fix these once and dozens of products move");
  for (const g of commonestGaps(unpublished, 8)) {
    console.log(`  ${String(g.count).padStart(4)}  ${g.gap}`);
  }

  const blocked = unpublished.filter((r) => r.verdict === "blocked");
  if (blocked.length) {
    console.log(`\nBLOCKED (${blocked.length}) — reasons, deduplicated`);
    const reasons = new Map<string, number>();
    for (const b of blocked) for (const x of b.blockers) reasons.set(x, (reasons.get(x) ?? 0) + 1);
    for (const [r, n] of [...reasons].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${r}`);
  }

  const ready = unpublished.filter((r) => r.verdict === "ready");
  console.log(`\nREADY NOW (${ready.length})`);
  for (const r of ready.slice(0, 20)) console.log(`  ${r.slug}`);
  if (ready.length > 20) console.log(`  …and ${ready.length - 20} more`);

  console.log("\nNothing was published. This script has no code path that publishes.");
}

main().catch((e) => { console.error("audit failed:", e instanceof Error ? e.message : e); process.exitCode = 1; });
