// Does every page show the thing it is about?
//
//   TC_ADMIN_EMAIL=... TC_ADMIN_PASSWORD=... npx tsx scripts/audit-subject-media.ts [--limit=N]
//
// READ-ONLY.
//
// "Has media" was the wrong question. product_media records that an asset is
// ATTACHED to a product, not that it DEPICTS it, so every automated check
// passed while a Canon EOS R7 page could be illustrated by a title card. This
// measures the right thing: how many subjects have imagery that names them.
//
// The judgement lives in src/lib/media/subject-match.ts and is unit-tested
// there; this only fetches and tallies.

import { loadEnvLocal, createAdminClient } from "./_shared.ts";
import {
  judgeSubject,
  VERDICT_LABEL,
  type MediaVerdict,
  type SubjectMediaAsset,
} from "../src/lib/media/subject-match.ts";

loadEnvLocal();
const limitArg = process.argv.find((a) => a.startsWith("--limit="));
const LIMIT = limitArg ? Number(limitArg.split("=")[1]) : 25;

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

async function main(): Promise<void> {
  const db = (await createAdminClient()) as unknown as Db;

  const assets = await all(db, "media_assets", "id,alt_text,caption,source_type,asset_role,brand_role");
  const assetById = new Map<string, SubjectMediaAsset>(
    assets.map((a) => [
      String(a.id),
      {
        id: String(a.id),
        altText: (a.alt_text as string) ?? null,
        caption: (a.caption as string) ?? null,
        sourceType: (a.source_type as string) ?? null,
        assetRole: (a.asset_role as string) ?? null,
        brandRole: (a.brand_role as string) ?? null,
      },
    ])
  );

  const products = await all(db, "products", "id,slug,name,manufacturer_id,is_published,category_id");
  const manufacturers = await all(db, "manufacturers", "id,name");
  const mfrById = new Map(manufacturers.map((m) => [String(m.id), String(m.name)]));
  const categories = await all(db, "taxonomy_categories", "id,slug");
  const catById = new Map(categories.map((c) => [String(c.id), String(c.slug)]));

  const productMedia = await all(db, "product_media", "media_id,product_id");
  const byProduct = new Map<string, SubjectMediaAsset[]>();
  for (const l of productMedia) {
    const a = assetById.get(String(l.media_id));
    if (!a) continue;
    const k = String(l.product_id);
    byProduct.set(k, [...(byProduct.get(k) ?? []), a]);
  }

  const content = await all(db, "content_items", "id,slug,title,status,locale");
  const contentMedia = await all(db, "content_media", "media_id,content_id");
  const byContent = new Map<string, SubjectMediaAsset[]>();
  for (const l of contentMedia) {
    const a = assetById.get(String(l.media_id));
    if (!a) continue;
    const k = String(l.content_id);
    byContent.set(k, [...(byContent.get(k) ?? []), a]);
  }

  type Row = { slug: string; name: string; verdict: MediaVerdict; category: string; published: boolean };
  const productRows: Row[] = products.map((p) => ({
    slug: String(p.slug),
    name: String(p.name),
    category: catById.get(String(p.category_id)) ?? "?",
    published: p.is_published === true,
    verdict: judgeSubject(byProduct.get(String(p.id)) ?? [], {
      name: String(p.name),
      manufacturerName: mfrById.get(String(p.manufacturer_id)) ?? null,
    }),
  }));

  const articleRows = content
    .filter((c) => c.locale === "en")
    .map((c) => ({
      slug: String(c.slug),
      name: String(c.title),
      published: c.status === "published",
      verdict: judgeSubject(byContent.get(String(c.id)) ?? [], {
        name: String(c.title),
        manufacturerName: null,
      }),
    }));

  const tally = (rows: { verdict: MediaVerdict }[]) => {
    const m = new Map<MediaVerdict, number>();
    for (const r of rows) m.set(r.verdict, (m.get(r.verdict) ?? 0) + 1);
    return m;
  };
  const pct = (n: number, d: number) => (d === 0 ? "—" : `${((n / d) * 100).toFixed(1)}%`);
  const ORDER: MediaVerdict[] = ["strong", "acceptable", "generic_placeholder", "undescribed", "wrong_subject", "missing"];

  console.log("=== SUBJECT MEDIA COVERAGE (production, read-only) ===\n");

  console.log(`PRODUCTS (${productRows.length})`);
  const pt = tally(productRows);
  for (const v of ORDER) {
    const n = pt.get(v) ?? 0;
    console.log(`  ${String(n).padStart(4)}  ${pct(n, productRows.length).padStart(6)}  ${VERDICT_LABEL[v]}`);
  }
  console.log(`  EXACT-SUBJECT COVERAGE: ${pct(pt.get("strong") ?? 0, productRows.length)}\n`);

  console.log("  by category:");
  const cats = new Map<string, Row[]>();
  for (const r of productRows) cats.set(r.category, [...(cats.get(r.category) ?? []), r]);
  for (const [cat, rows] of [...cats].sort((a, b) => b[1].length - a[1].length)) {
    const strong = rows.filter((r) => r.verdict === "strong").length;
    const missing = rows.filter((r) => r.verdict === "missing").length;
    console.log(`    ${String(rows.length).padStart(4)} ${cat.padEnd(22)} exact ${String(strong).padStart(3)} (${pct(strong, rows.length).padStart(6)})  missing ${missing}`);
  }

  const pubRows = productRows.filter((r) => r.published);
  console.log(`\nPUBLISHED PRODUCTS ONLY (${pubRows.length})`);
  const pubT = tally(pubRows);
  for (const v of ORDER) {
    const n = pubT.get(v) ?? 0;
    if (n > 0) console.log(`  ${String(n).padStart(4)}  ${VERDICT_LABEL[v]}`);
  }

  console.log(`\nARTICLES (${articleRows.length}, of which ${articleRows.filter((r) => r.published).length} published)`);
  const at = tally(articleRows);
  for (const v of ORDER) {
    const n = at.get(v) ?? 0;
    console.log(`  ${String(n).padStart(4)}  ${pct(n, articleRows.length).padStart(6)}  ${VERDICT_LABEL[v]}`);
  }

  console.log(`\nTOP ${LIMIT} PUBLISHED SUBJECTS NEEDING REAL IMAGERY`);
  const worst = [
    ...pubRows,
    ...articleRows.filter((r) => r.published).map((r) => ({ ...r, category: "article" })),
  ]
    .filter((r) => r.verdict === "generic_placeholder" || r.verdict === "missing" || r.verdict === "wrong_subject")
    .slice(0, LIMIT);
  for (const r of worst) console.log(`  [${r.verdict.padEnd(19)}] ${r.name.slice(0, 62)}`);
  if (worst.length === 0) console.log("  none");

  console.log("\nNOTE: this reads alt text and captions, which describe what is IN the");
  console.log("picture. It cannot see pixels. 'undescribed' is a documentation gap, not");
  console.log("an imagery gap, and the two need different work from different people.");
}

main().catch((e) => { console.error("audit failed:", e instanceof Error ? e.message : e); process.exitCode = 1; });
