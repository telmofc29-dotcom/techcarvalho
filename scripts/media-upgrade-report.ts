// BETTER MEDIA AVAILABLE, AND DISCOVER RECOVERY, IN ONE PASS.
//
// For every occupied slot the ENGINE chose, ask whether anything now in the
// library is SUBSTANTIALLY better. For every article failing the Discover
// checks, ask whether the fix is available today or needs new photography.
//
// Both questions run through the ONE canonical matcher and the ONE upgrade
// policy. Nothing here scores anything itself.
//
//   TC_ADMIN_EMAIL=... TC_ADMIN_PASSWORD=... npx tsx scripts/media-upgrade-report.ts
//   ... --apply     (applies ONLY engine->engine replacements the policy allows)
//
// Human and unknown selections are never written to, with or without --apply.

import { loadEnvLocal, createAdminClient } from "./_shared.ts";
import {
  matchesForTarget,
  scoreMatch,
  deriveIsModelSpecific,
  type MatchAsset,
  type MatchTarget,
  type VerifiedProduct,
} from "../src/lib/media/match-engine.ts";
import { buildEntityVocabulary } from "../src/lib/media/entity-vocabulary.ts";
import { assessUpgrade, type SlotOccupant } from "../src/lib/media/upgrade-policy.ts";
import { engineSelection } from "../src/lib/media/auto-attach.ts";
import { isProtectedSelection } from "../src/lib/media/selection-policy.ts";
import { assessDiscoverReadiness, type ArticleForReadiness } from "../src/lib/seo/discover-readiness.ts";
import type { MediaSelectionKind } from "../src/lib/types/database.ts";

loadEnvLocal();
const apply = process.argv.includes("--apply");
const GRAPHIC_ROLES = new Set(["diagram", "chart", "comparison_graphic", "concept_render"]);
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
type Role = "hero" | "thumbnail" | "gallery";

async function main(): Promise<void> {
  const db = await createAdminClient();
  const [A, C, P, CM, PM, CAT, MF, FAM, TAG, AU, SEO] = await Promise.all([
    db.from("media_assets").select("id, storage_path, alt_text, caption, source_type, asset_role, brand_role, owned, ai_generated, publication_status, rights_status, width, height"),
    db.from("content_items").select("id, title, slug, status, category_id, published_at, updated_at, author_id"),
    db.from("products").select("id, name, category_id, manufacturer_id, family_id"),
    db.from("content_media").select("id, content_id, media_id, role, selection_kind"),
    db.from("product_media").select("id, product_id, media_id, role, selection_kind"),
    db.from("taxonomy_categories").select("id, slug"),
    db.from("manufacturers").select("id, name"),
    db.from("product_families").select("name"),
    db.from("taxonomy_tags").select("name"),
    db.from("author_profiles").select("id, display_name"),
    db.from("seo_metadata").select("content_id, meta_description"),
  ]);
  if (A.error) throw new Error(A.error.message);

  const cat = new Map(((CAT.data ?? []) as Record<string, unknown>[]).map((c) => [String(c.id), String(c.slug)]));
  const mfr = new Map(((MF.data ?? []) as Record<string, unknown>[]).map((m) => [String(m.id), String(m.name)]));
  const entityVocabulary = buildEntityVocabulary({
    manufacturers: ((MF.data ?? []) as { name: string }[]).map((m) => m.name),
    productNames: ((P.data ?? []) as { name: string }[]).map((p) => p.name),
    familyNames: ((FAM.data ?? []) as { name: string }[]).map((f) => f.name),
    categorySlugs: ((CAT.data ?? []) as { slug: string }[]).map((c) => c.slug),
    tagNames: ((TAG.data ?? []) as { name: string }[]).map((t) => t.name),
  });

  const prodById = new Map(
    ((P.data ?? []) as Record<string, unknown>[]).map((p) => [
      String(p.id),
      { name: String(p.name), manufacturerName: mfr.get(String(p.manufacturer_id)) ?? null, familyId: str(p.family_id) },
    ])
  );
  const vby = new Map<string, VerifiedProduct[]>();
  for (const l of (PM.data ?? []) as Record<string, unknown>[]) {
    const pr = prodById.get(String(l.product_id));
    if (!pr) continue;
    const k = String(l.media_id);
    vby.set(k, [...(vby.get(k) ?? []), { productId: String(l.product_id), ...pr }]);
  }

  const assets: MatchAsset[] = ((A.data ?? []) as Record<string, unknown>[]).map((a) => ({
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
    verifiedProducts: vby.get(String(a.id)) ?? [],
  }));
  const assetById = new Map(assets.map((a) => [a.id, a]));
  const usable = assets.filter((a) => a.publicationStatus === "published" && a.rightsStatus !== "restricted");
  const file = (a: MatchAsset) => (a.storagePath.split("/").pop() ?? "").replace(/^[0-9a-f-]{36}-?/i, "");

  type SlotRow = { table: "content_media" | "product_media"; id: string; key: string; mediaId: string; role: Role; kind: MediaSelectionKind | null };
  const slotRows: SlotRow[] = [
    ...((CM.data ?? []) as Record<string, unknown>[]).map((r) => ({
      table: "content_media" as const, id: String(r.id), key: `content:${r.content_id}`,
      mediaId: String(r.media_id), role: String(r.role) as Role, kind: (r.selection_kind as MediaSelectionKind) ?? null,
    })),
    ...((PM.data ?? []) as Record<string, unknown>[]).map((r) => ({
      table: "product_media" as const, id: String(r.id), key: `product:${r.product_id}`,
      mediaId: String(r.media_id), role: String(r.role) as Role, kind: (r.selection_kind as MediaSelectionKind) ?? null,
    })),
  ];
  const slotsByTarget = new Map<string, SlotRow[]>();
  for (const r of slotRows) slotsByTarget.set(r.key, [...(slotsByTarget.get(r.key) ?? []), r]);

  const targets: MatchTarget[] = [];
  for (const c of (C.data ?? []) as Record<string, unknown>[]) {
    targets.push({
      id: String(c.id), kind: "content", title: String(c.title), manufacturerName: null,
      categorySlug: c.category_id ? (cat.get(String(c.category_id)) ?? null) : null,
      isModelSpecific: deriveIsModelSpecific(String(c.title)),
      occupiedSlots: (slotsByTarget.get(`content:${c.id}`) ?? []).map((s) => ({ role: s.role, humanSelected: isProtectedSelection(s.kind) })),
    });
  }
  for (const p of (P.data ?? []) as Record<string, unknown>[]) {
    targets.push({
      id: String(p.id), kind: "product", productId: String(p.id), familyId: str(p.family_id),
      title: String(p.name), manufacturerName: p.manufacturer_id ? (mfr.get(String(p.manufacturer_id)) ?? null) : null,
      categorySlug: p.category_id ? (cat.get(String(p.category_id)) ?? null) : null, isModelSpecific: true,
      occupiedSlots: (slotsByTarget.get(`product:${p.id}`) ?? []).map((s) => ({ role: s.role, humanSelected: isProtectedSelection(s.kind) })),
    });
  }

  console.log("=".repeat(78));
  console.log(`BETTER MEDIA AVAILABLE ${apply ? "— APPLYING engine->engine only" : "— REPORT ONLY"}`);
  console.log("=".repeat(78));

  let replaced = 0;
  let protectedSlots = 0;
  for (const target of targets) {
    const held = slotsByTarget.get(`${target.kind}:${target.id}`) ?? [];
    if (held.length === 0) continue;
    const candidates = matchesForTarget(target, usable, { limit: 6, entityVocabulary });
    if (candidates.length === 0) continue;

    for (const slot of held) {
      if (isProtectedSelection(slot.kind)) { protectedSlots++; continue; }
      const current = assetById.get(slot.mediaId);
      if (!current) continue;
      const occupant: SlotOccupant = {
        role: slot.role, selectionKind: slot.kind, asset: current,
        match: scoreMatch(current, target, { entityVocabulary }),
      };
      for (const cand of candidates) {
        if (cand.assetId === current.id) continue;
        const candAsset = assetById.get(cand.assetId);
        if (!candAsset) continue;
        const verdict = assessUpgrade(occupant, candAsset, cand);
        if (verdict.decision !== "replace") continue;

        console.log(`\n  ${target.kind.toUpperCase()} "${target.title.slice(0, 54)}"  [${slot.role}]`);
        console.log(`    CURRENT   ${file(current)}  (${occupant.match.specificity}/${occupant.match.nature}, ${current.width}x${current.height})`);
        console.log(`    PROPOSED  ${file(candAsset)}  (${cand.specificity}/${cand.nature}, ${candAsset.width}x${candAsset.height})`);
        console.log(`    WHY BETTER`);
        for (const r of verdict.reasons) console.log(`      - ${r.detail}`);
        if (apply) {
          const { error } = await db.from(slot.table).update({ media_id: candAsset.id, ...engineSelection() }).eq("id", slot.id);
          if (error) { console.log(`    FAILED ${error.message}`); continue; }
          console.log(`    REPLACED (selection_kind stays 'engine')`);
        }
        replaced++;
        break;
      }
    }
  }
  console.log(`\n  engine slots ${apply ? "replaced" : "replaceable"}: ${replaced}`);
  console.log(`  protected slots skipped without inspection: ${protectedSlots}`);
  if (!apply) console.log("  REPORT ONLY — re-run with --apply");

  // ---- DISCOVER RECOVERY -------------------------------------------------
  console.log(`\n${"=".repeat(78)}`);
  console.log("DISCOVER RECOVERY — can each failing article be fixed from the library today?");
  console.log("=".repeat(78));

  const authors = new Map(((AU.data ?? []) as Record<string, unknown>[]).map((a) => [String(a.id), String(a.display_name)]));
  const descs = new Map(((SEO.data ?? []) as Record<string, unknown>[]).map((s) => [String(s.content_id), s.meta_description ? String(s.meta_description) : null]));
  const heroOf = new Map<string, MatchAsset>();
  for (const r of (CM.data ?? []) as Record<string, unknown>[]) {
    if (String(r.role) !== "hero") continue;
    const a = assetById.get(String(r.media_id));
    if (a) heroOf.set(String(r.content_id), a);
  }

  let fixable = 0;
  let needsNew = 0;
  let ready = 0;
  const examples: string[] = [];
  for (const c of ((C.data ?? []) as Record<string, unknown>[]).filter((x) => String(x.status) === "published")) {
    const hero = heroOf.get(String(c.id));
    const article: ArticleForReadiness = {
      id: String(c.id), slug: String(c.slug), title: String(c.title), status: String(c.status),
      publishedAt: c.published_at ? String(c.published_at) : null,
      updatedAt: c.updated_at ? String(c.updated_at) : null,
      authorName: c.author_id ? (authors.get(String(c.author_id)) ?? null) : null,
      description: descs.get(String(c.id)) ?? null,
      hero: hero ? {
        width: hero.width, height: hero.height, altText: hero.altText,
        publicationStatus: hero.publicationStatus,
        isGraphic: GRAPHIC_ROLES.has(hero.assetRole ?? "") || hero.sourceType === "tc_graphic",
      } : null,
    };
    const finding = assessDiscoverReadiness(article);
    if (finding.state === "READY") { ready++; continue; }

    const target = targets.find((t) => t.kind === "content" && t.id === String(c.id));
    const best = target
      ? matchesForTarget(target, usable, { limit: 5, entityVocabulary })
          .map((m) => ({ m, a: assetById.get(m.assetId) }))
          .filter((x): x is { m: typeof x.m; a: MatchAsset } => x.a !== undefined)
          .filter(({ m, a }) => m.proposedSlots.includes("hero") && a.width !== null && a.height !== null && a.width >= 1200 && a.width * a.height >= 300_000)[0]
      : undefined;

    if (best) {
      fixable++;
      if (examples.length < 4) {
        examples.push(
          `  FIXABLE NOW  "${article.title.slice(0, 52)}"\n` +
            `    ${finding.state} — ${finding.problems[0]?.slice(0, 84)}\n` +
            `    candidate: ${file(best.a)} (${best.m.specificity}, ${best.a.width}x${best.a.height})`
        );
      }
    } else {
      needsNew++;
      if (examples.length < 6 && needsNew <= 2) {
        examples.push(
          `  NEEDS NEW PHOTOGRAPHY  "${article.title.slice(0, 46)}"\n` +
            `    ${finding.state} — ${finding.problems[0]?.slice(0, 84)}\n` +
            `    nothing in the published library can honestly fill the lead slot at Discover size.`
        );
      }
    }
  }
  console.log(`\n  READY already            : ${ready}`);
  console.log(`  CAN FIX NOW from library : ${fixable}`);
  console.log(`  NEEDS NEW PHOTOGRAPHY    : ${needsNew}  -> awaiting media`);
  for (const e of examples) console.log(`\n${e}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
