// INTERNAL LINKING AND ORPHANS, AGAINST THE REAL CORPUS.
//
// Runs the EXISTING link-suggestions engine over production content, now fed
// the recorded associations it never had: content_products, content_tags,
// content_technologies, and the product family and manufacturer behind each
// product. Raw title overlap is still there and still weighted as before —
// evidence is strictly additive — but only words that NAME something count.
//
//   TC_ADMIN_EMAIL=... TC_ADMIN_PASSWORD=... npx tsx scripts/verify-internal-links.ts
//
// It writes nothing. Suggestions are for review; nothing is inserted into
// content_relationships and no published prose is touched.

import { loadEnvLocal, createAdminClient } from "./_shared.ts";
import {
  suggestLinksFor,
  findOrphans,
  pairKey,
  relatedness,
  topicTerms,
  AUTO_LINK_THRESHOLD,
  type LinkCandidate,
} from "../src/lib/engine/link-suggestions.ts";
import { buildEntityVocabulary } from "../src/lib/media/entity-vocabulary.ts";

loadEnvLocal();

async function main(): Promise<void> {
  const db = await createAdminClient();

  const [C, CP, CT, CTech, P, MF, CAT, FAM, TAG, REL] = await Promise.all([
    db.from("content_items").select("id, title, status, type, category_id"),
    db.from("content_products").select("content_id, product_id"),
    db.from("content_tags").select("content_id, tag_id"),
    db.from("content_technologies").select("content_id, technology_id"),
    db.from("products").select("id, name, manufacturer_id, family_id"),
    db.from("manufacturers").select("id, name"),
    db.from("taxonomy_categories").select("id, slug"),
    db.from("product_families").select("id, name"),
    db.from("taxonomy_tags").select("id, name"),
    db.from("content_relationships").select("content_id, related_content_id"),
  ]);
  for (const [n, r] of [["content_items", C], ["content_products", CP], ["content_tags", CT]] as const) {
    if (r.error) throw new Error(`${n}: ${r.error.message}`);
  }
  if (CTech.error) console.log(`  note: content_technologies unreadable (${CTech.error.message}) — concepts omitted`);

  const entityVocabulary = buildEntityVocabulary({
    manufacturers: ((MF.data ?? []) as { name: string }[]).map((m) => m.name),
    productNames: ((P.data ?? []) as { name: string }[]).map((p) => p.name),
    familyNames: ((FAM.data ?? []) as { name: string }[]).map((f) => f.name),
    categorySlugs: ((CAT.data ?? []) as { slug: string }[]).map((c) => c.slug),
    tagNames: ((TAG.data ?? []) as { name: string }[]).map((t) => t.name),
  });

  const productMeta = new Map(
    ((P.data ?? []) as Record<string, unknown>[]).map((p) => [
      String(p.id),
      { manufacturerId: p.manufacturer_id ? String(p.manufacturer_id) : null, familyId: p.family_id ? String(p.family_id) : null },
    ])
  );

  const group = <T>(rows: T[], key: (r: T) => string, val: (r: T) => string): Map<string, string[]> => {
    const m = new Map<string, string[]>();
    for (const r of rows) {
      const k = key(r);
      m.set(k, [...(m.get(k) ?? []), val(r)]);
    }
    return m;
  };
  const byProducts = group((CP.data ?? []) as Record<string, unknown>[], (r) => String(r.content_id), (r) => String(r.product_id));
  const byTags = group((CT.data ?? []) as Record<string, unknown>[], (r) => String(r.content_id), (r) => String(r.tag_id));
  const byConcepts = group((CTech.data ?? []) as Record<string, unknown>[], (r) => String(r.content_id), (r) => String(r.technology_id));

  const candidates: LinkCandidate[] = ((C.data ?? []) as Record<string, unknown>[]).map((c) => {
    const productIds = byProducts.get(String(c.id)) ?? [];
    const metas = productIds.map((id) => productMeta.get(id)).filter(Boolean) as { manufacturerId: string | null; familyId: string | null }[];
    return {
      id: String(c.id),
      title: String(c.title),
      categoryId: c.category_id ? String(c.category_id) : null,
      type: String(c.type),
      evidence: {
        productIds,
        familyIds: [...new Set(metas.map((m) => m.familyId).filter(Boolean) as string[])],
        manufacturerIds: [...new Set(metas.map((m) => m.manufacturerId).filter(Boolean) as string[])],
        tagIds: byTags.get(String(c.id)) ?? [],
        conceptIds: byConcepts.get(String(c.id)) ?? [],
      },
    };
  });

  const published = candidates.filter((c) => {
    const row = ((C.data ?? []) as Record<string, unknown>[]).find((r) => String(r.id) === c.id);
    return String(row?.status) === "published";
  });

  const existingPairs = new Set<string>();
  const linkedIds = new Set<string>();
  for (const r of (REL.data ?? []) as Record<string, unknown>[]) {
    existingPairs.add(pairKey(String(r.content_id), String(r.related_content_id)));
    linkedIds.add(String(r.content_id));
    linkedIds.add(String(r.related_content_id));
  }
  for (const r of (CP.data ?? []) as Record<string, unknown>[]) linkedIds.add(String(r.content_id));

  console.log("=".repeat(78));
  console.log(`INTERNAL LINKING — ${candidates.length} items (${published.length} published)`);
  console.log(`entity vocabulary: ${entityVocabulary.size} naming words`);
  console.log(`existing relationships: ${(REL.data ?? []).length}`);
  console.log("=".repeat(78));

  // ---- suggestions ------------------------------------------------------
  let above = 0;
  let shown = 0;
  const allScores: number[] = [];
  for (const item of published) {
    const s = suggestLinksFor(item, published, existingPairs, 3, { entityVocabulary });
    for (const x of s) allScores.push(x.score);
    const strong = s.filter((x) => x.score >= AUTO_LINK_THRESHOLD);
    above += strong.length;
    if (strong.length > 0 && shown < 8) {
      console.log(`\n  FROM  "${item.title.slice(0, 64)}"`);
      for (const x of strong.slice(0, 2)) {
        console.log(`    ->  "${x.toTitle.slice(0, 62)}"   ${x.score.toFixed(2)}`);
        console.log(`        ${x.reason}`);
      }
      shown++;
    }
  }
  console.log(`\n  suggestions at or above the auto-link bar (${AUTO_LINK_THRESHOLD}): ${above}`);
  console.log(`  total scored pairs considered: ${allScores.length}`);

  // ---- the safety property ---------------------------------------------
  //
  // "Both mention Samsung" is the brief's example of a link that must NOT be
  // made. Manufacturer overlap is weighted at 0.08 precisely so it cannot carry
  // a pairing on its own; this measures whether that holds on real rows.
  let manufacturerOnly = 0;
  for (let i = 0; i < published.length; i++) {
    for (let j = i + 1; j < published.length; j++) {
      const a = published[i];
      const b = published[j];
      const sharedMfr = (a.evidence?.manufacturerIds ?? []).some((m) => (b.evidence?.manufacturerIds ?? []).includes(m));
      const sharedProduct = (a.evidence?.productIds ?? []).some((p) => (b.evidence?.productIds ?? []).includes(p));
      if (!sharedMfr || sharedProduct) continue;
      // MERELY. The brief forbids linking two pages BECAUSE they mention the
      // same company. A pair that also shares a tag, a family, a concept or a
      // naming word is not that pair — it has other evidence, and the
      // manufacturer is incidental. So "manufacturer-only" means exactly that:
      // nothing else in common at all.
      const sharedFamily = (a.evidence?.familyIds ?? []).some((f) => (b.evidence?.familyIds ?? []).includes(f));
      const sharedTag = (a.evidence?.tagIds ?? []).some((t) => (b.evidence?.tagIds ?? []).includes(t));
      const sharedConcept = (a.evidence?.conceptIds ?? []).some((t) => (b.evidence?.conceptIds ?? []).includes(t));
      const namingOverlap = [...topicTerms(a.title)].some(
        (t) => topicTerms(b.title).has(t) && (entityVocabulary.has(t) || t.startsWith("concept:"))
      );
      if (sharedFamily || sharedTag || sharedConcept || namingOverlap) continue;
      if (relatedness(a, b, { entityVocabulary }) >= AUTO_LINK_THRESHOLD) {
        manufacturerOnly++;
        console.log(`    MERE-MANUFACTURER LINK: "${a.title.slice(0, 42)}" <-> "${b.title.slice(0, 42)}"`);
      }
    }
  }
  console.log(`  pairs linked on a SHARED MANUFACTURER alone: ${manufacturerOnly}  (must be 0)`);
  if (manufacturerOnly > 0) process.exitCode = 1;

  // ---- orphans ----------------------------------------------------------
  const orphans = findOrphans(published, linkedIds);
  console.log(`\n  ORPHAN CONTENT: ${orphans.length} published pieces connected to nothing`);
  for (const o of orphans.slice(0, 12)) {
    const best = suggestLinksFor(o, published, existingPairs, 1, { entityVocabulary })[0];
    console.log(`    "${o.title.slice(0, 60)}"`);
    console.log(`       best available link: ${best ? `"${best.toTitle.slice(0, 48)}" (${best.score.toFixed(2)})` : "none found"}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
