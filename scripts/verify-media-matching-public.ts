// Run the REAL matcher against the REAL published surface, as `anon` sees it.
//
// WHY A SECOND SCRIPT AND NOT A FLAG ON verify-media-matching.ts
// --------------------------------------------------------------
// That one signs in as an admin and sees drafts and private assets. This one
// deliberately holds only the anon key, so what it reports is exactly what a
// visitor's data would allow — and any private asset that shows up here is a
// leak, not a finding about matching. It therefore needs no credentials and can
// be run by anyone, which is the point: the highest-stakes surface is the
// published one, and verifying it should not depend on holding a password.
//
//   npx tsx scripts/verify-media-matching-public.ts
//
// It writes nothing.

import { loadEnvLocal } from "./_shared.ts";
import {
  scoreMatch,
  matchesForTarget,
  classifyNature,
  deriveIsModelSpecific,
  type MatchAsset,
  type MatchTarget,
  type VerifiedProduct,
} from "../src/lib/media/match-engine.ts";
import { FALSE_MATCH_PAIRS } from "../src/lib/media/false-match-corpus.ts";

loadEnvLocal();
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

async function rest<T>(path: string): Promise<T[]> {
  const r = await fetch(`${URL_}/rest/v1/${path}`, {
    headers: { apikey: ANON!, Authorization: `Bearer ${ANON}` },
  });
  const body = await r.text();
  if (!r.ok) throw new Error(`${path} -> ${r.status} ${body}`);
  return JSON.parse(body) as T[];
}

type Row = Record<string, unknown>;
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

async function main(): Promise<void> {
  if (!URL_ || !ANON) throw new Error("NEXT_PUBLIC_SUPABASE_URL / _PUBLISHABLE_KEY are not set.");

  const [assetRows, contentRows, productRows, pmRows, cmRows, catRows, mfrRows] = await Promise.all([
    rest<Row>(
      "media_assets?select=id,storage_path,alt_text,caption,source_type,asset_role,brand_role,owned,ai_generated,publication_status,rights_status,width,height&limit=1000"
    ),
    rest<Row>("content_items?select=id,title,status,category_id&limit=1000"),
    rest<Row>("products?select=id,name,category_id,manufacturer_id,family_id&limit=1000"),
    rest<Row>("product_media?select=product_id,media_id,role&limit=2000"),
    rest<Row>("content_media?select=content_id,media_id,role&limit=2000"),
    rest<Row>("taxonomy_categories?select=id,slug&limit=200"),
    rest<Row>("manufacturers?select=id,name&limit=200"),
  ]);

  // ---- THE LEAK CHECK, FIRST -------------------------------------------
  // Everything below reasons about what anon can read. If anon can read a
  // private asset, no matching result on this page means anything.
  const leaked = assetRows.filter((a) => a.publication_status !== "published");
  console.log("=== PRIVATE MEDIA LEAK CHECK (anon key) ===");
  console.log(`  media_assets readable by anon : ${assetRows.length}`);
  console.log(`  of those, NOT published       : ${leaked.length}`);
  if (leaked.length > 0) {
    console.log("  LEAK — anon can read unpublished media:");
    for (const a of leaked.slice(0, 10)) console.log(`    ${a.id} ${a.storage_path}`);
    process.exitCode = 1;
  } else {
    console.log("  OK — every asset anon can read is published.");
  }
  const unpublishedContent = contentRows.filter((c) => c.status !== "published");
  console.log(`  content_items readable by anon: ${contentRows.length}, not published: ${unpublishedContent.length}`);
  if (unpublishedContent.length > 0) process.exitCode = 1;

  const catSlug = new Map(catRows.map((c) => [String(c.id), String(c.slug)]));
  const mfrName = new Map(mfrRows.map((m) => [String(m.id), String(m.name)]));
  const productById = new Map(
    productRows.map((p) => [
      String(p.id),
      {
        name: String(p.name),
        manufacturerName: mfrName.get(String(p.manufacturer_id)) ?? null,
        familyId: str(p.family_id),
      },
    ])
  );

  const verifiedByAsset = new Map<string, VerifiedProduct[]>();
  for (const link of pmRows) {
    const product = productById.get(String(link.product_id));
    if (!product) continue;
    const key = String(link.media_id);
    verifiedByAsset.set(key, [
      ...(verifiedByAsset.get(key) ?? []),
      { productId: String(link.product_id), ...product },
    ]);
  }

  const assets: MatchAsset[] = assetRows.map((a) => ({
    id: String(a.id),
    storagePath: String(a.storage_path),
    altText: str(a.alt_text),
    caption: str(a.caption),
    sourceType: str(a.source_type),
    assetRole: str(a.asset_role),
    brandRole: str(a.brand_role),
    owned: a.owned === true,
    aiGenerated: a.ai_generated === true,
    publicationStatus: String(a.publication_status),
    rightsStatus: String(a.rights_status),
    width: typeof a.width === "number" ? a.width : null,
    height: typeof a.height === "number" ? a.height : null,
    verifiedProducts: verifiedByAsset.get(String(a.id)) ?? [],
  }));

  const occupied = new Map<string, { role: "hero" | "thumbnail" | "gallery"; humanSelected: boolean }[]>();
  for (const r of cmRows) {
    const role = String(r.role);
    if (role !== "hero" && role !== "thumbnail" && role !== "gallery") continue;
    const key = `content:${r.content_id}`;
    occupied.set(key, [...(occupied.get(key) ?? []), { role, humanSelected: true }]);
  }
  for (const r of pmRows) {
    const role = String(r.role);
    if (role !== "hero" && role !== "thumbnail" && role !== "gallery") continue;
    const key = `product:${r.product_id}`;
    occupied.set(key, [...(occupied.get(key) ?? []), { role, humanSelected: true }]);
  }

  const contentTargets: MatchTarget[] = contentRows.map((c) => ({
    id: String(c.id),
    kind: "content",
    title: String(c.title),
    manufacturerName: null,
    categorySlug: c.category_id ? (catSlug.get(String(c.category_id)) ?? null) : null,
    isModelSpecific: deriveIsModelSpecific(String(c.title)),
    occupiedSlots: occupied.get(`content:${c.id}`) ?? [],
  }));
  const productTargets: MatchTarget[] = productRows.map((p) => ({
    id: String(p.id),
    kind: "product",
    productId: String(p.id),
    familyId: str(p.family_id),
    title: String(p.name),
    manufacturerName: p.manufacturer_id ? (mfrName.get(String(p.manufacturer_id)) ?? null) : null,
    categorySlug: p.category_id ? (catSlug.get(String(p.category_id)) ?? null) : null,
    isModelSpecific: true,
    occupiedSlots: occupied.get(`product:${p.id}`) ?? [],
  }));
  const usable = assets.filter(
    (a) => a.publicationStatus === "published" && a.rightsStatus !== "restricted"
  );

  // ---- 1. WHAT THE MATCHER PICKS, AND WHY ------------------------------
  console.log("\n=== ARTICLE -> SELECTED IMAGE -> SPECIFICITY -> WHY ===");
  let shown = 0;
  for (const t of [...productTargets, ...contentTargets]) {
    if (shown >= 12) break;
    const best = matchesForTarget(t, usable, { limit: 1 })[0];
    if (!best) continue;
    const asset = assets.find((a) => a.id === best.assetId)!;
    const file = (asset.storagePath.split("/").pop() ?? "").replace(/^[0-9a-f-]{36}-?/i, "");
    console.log(`\n  ${t.kind.toUpperCase()}  "${t.title}"`);
    console.log(`    -> ${file}`);
    console.log(`    specificity: ${best.specificity}   strength: ${best.strength}   score: ${best.score}   nature: ${best.nature}`);
    console.log(`    slots: [${best.proposedSlots.join(", ")}]`);
    for (const r of best.reasons) console.log(`    why: ${r}`);
    for (const w of best.withheld) console.log(`    withheld: ${w}`);
    shown++;
  }

  // ---- 2. DELIBERATE FALSE MATCHES, AGAINST REAL ASSETS -----------------
  //
  // For every corpus pair, find a REAL asset in this library whose own words
  // name the sibling, and offer it to a target named after the subject. If a
  // real asset exists, the refusal is evidence; if not, that is said plainly
  // rather than reported as a pass.
  console.log("\n=== DELIBERATE FALSE MATCHES, USING REAL LIBRARY ASSETS ===");
  let refused = 0;
  let offered = 0;
  let untestable = 0;
  for (const pair of FALSE_MATCH_PAIRS) {
    const sibTokens = pair.sibling.toLowerCase().split(/\s+/).filter((w) => w.length > 1);
    const real = usable.find((a) => {
      const text = `${a.storagePath} ${a.altText ?? ""} ${a.caption ?? ""}`.toLowerCase();
      return sibTokens.every((w) => text.includes(w));
    });
    if (!real) {
      console.log(`\n  ${pair.subject}  <-  ${pair.sibling}`);
      console.log(`    NOT TESTABLE ON REAL DATA: no asset in the published library names "${pair.sibling}".`);
      untestable++;
      continue;
    }
    const t: MatchTarget = {
      id: "probe",
      kind: "content",
      title: `${pair.subject} review`,
      manufacturerName: pair.manufacturer,
      categorySlug: null,
      isModelSpecific: deriveIsModelSpecific(`${pair.subject} review`),
      occupiedSlots: [],
    };
    const m = scoreMatch(real, t);
    const file = (real.storagePath.split("/").pop() ?? "").replace(/^[0-9a-f-]{36}-?/i, "");
    console.log(`\n  ARTICLE "${t.title}"`);
    console.log(`    IMAGE   ${file}   (${classifyNature(real)})`);
    if (m.proposedSlots.length === 0) {
      console.log(`    REFUSED — slots: none`);
      console.log(`    WHY: ${m.withheld.join(" | ") || m.reasons.join(" | ")}`);
      refused++;
    } else {
      console.log(`    *** OFFERED [${m.proposedSlots.join(", ")}] at ${m.specificity} — THIS IS A FALSE MATCH`);
      console.log(`    reasons: ${m.reasons.join(" | ")}`);
      offered++;
    }
  }
  console.log(
    `\n  refused ${refused}   offered ${offered}   not testable on this library ${untestable}   (of ${FALSE_MATCH_PAIRS.length})`
  );
  if (offered > 0) process.exitCode = 1;

  // ---- 3. WHAT HAS NO HONEST IMAGE -------------------------------------
  console.log("\n=== PUBLISHED PAGES WITH NO HONEST LEAD IMAGE AVAILABLE ===");
  const needsLead = [...contentTargets, ...productTargets].filter(
    (t) => !t.occupiedSlots.some((s) => s.role === "hero")
  );
  const answerable = needsLead.filter((t) =>
    matchesForTarget(t, usable, { limit: 1 }).some((m) => m.proposedSlots.includes("hero"))
  );
  console.log(`  published targets with no hero  : ${needsLead.length}`);
  console.log(`  of those, the library CAN fill  : ${answerable.length}`);
  console.log(`  of those, needing new media     : ${needsLead.length - answerable.length}`);
  for (const t of needsLead.filter((x) => !answerable.includes(x)).slice(0, 8)) {
    console.log(`    AWAITING MEDIA: ${t.kind} "${t.title}"`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
