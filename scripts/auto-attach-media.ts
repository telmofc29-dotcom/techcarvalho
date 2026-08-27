// AUTOMATIC MEDIA ASSOCIATION, END TO END.
//
//   CONTENT/DRAFT  ->  subject/entity/model  ->  CANONICAL MATCHER
//                  ->  rights + publication  ->  specificity  ->  slot policy
//                  ->  attach as ENGINE      OR  awaiting media
//
// ONE MATCHER. This script builds the same MatchTargets and MatchAssets the
// admin suggestion queue builds, calls the same scoreMatch, and then asks
// media/auto-attach.ts whether the answer is safe to write without a person.
// It never scores anything itself.
//
//   npx tsx scripts/auto-attach-media.ts            (report — writes nothing)
//   npx tsx scripts/auto-attach-media.ts --apply
//
// WHAT IT WILL NOT DO, ENFORCED IN auto-attach.ts AND RE-STATED HERE BECAUSE
// THIS IS THE FILE THAT WRITES:
//   * never touch a slot held by a human or an unknown selection
//   * never attach private or rights-ineligible media
//   * never claim a family image is an exact-product image
//   * never stamp a human actor on an engine choice
//
// Anything it cannot fill honestly is left for the awaiting-media workflow,
// which scripts/ensure-media-requirements.ts owns.

import { loadEnvLocal, createAdminClient } from "./_shared.ts";
import {
  matchesForTarget,
  deriveIsModelSpecific,
  type MatchAsset,
  type MatchTarget,
  type VerifiedProduct,
} from "../src/lib/media/match-engine.ts";
import { buildEntityVocabulary } from "../src/lib/media/entity-vocabulary.ts";
import { decideAutoAttach, engineSelection, type SlotState } from "../src/lib/media/auto-attach.ts";
import { isProtectedSelection, orderForSlot } from "../src/lib/media/selection-policy.ts";

loadEnvLocal();
const apply = process.argv.includes("--apply");
const LIMIT = Number(process.env.TC_ATTACH_LIMIT ?? "0") || Infinity;

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

async function main(): Promise<void> {
  const db = await createAdminClient();

  const [A, C, P, CM, PM, CAT, MF, FAM, TAG] = await Promise.all([
    db.from("media_assets").select(
      "id, storage_path, alt_text, caption, source_type, asset_role, brand_role, owned, ai_generated, publication_status, rights_status, width, height"
    ),
    db.from("content_items").select("id, title, status, category_id"),
    db.from("products").select("id, name, category_id, manufacturer_id, family_id"),
    db.from("content_media").select("content_id, media_id, role, selection_kind"),
    db.from("product_media").select("product_id, media_id, role, selection_kind"),
    db.from("taxonomy_categories").select("id, slug"),
    db.from("manufacturers").select("id, name"),
    db.from("product_families").select("name"),
    db.from("taxonomy_tags").select("name"),
  ]);
  for (const [n, r] of [["media_assets", A], ["content_items", C], ["content_media", CM]] as const) {
    if (r.error) throw new Error(`${n}: ${r.error.message}`);
  }

  const cat = new Map(((CAT.data ?? []) as { id: string; slug: string }[]).map((c) => [c.id, c.slug]));
  const mfr = new Map(((MF.data ?? []) as { id: string; name: string }[]).map((m) => [m.id, m.name]));

  const entityVocabulary = buildEntityVocabulary({
    manufacturers: ((MF.data ?? []) as { name: string }[]).map((m) => m.name),
    productNames: ((P.data ?? []) as { name: string }[]).map((p) => p.name),
    familyNames: ((FAM.data ?? []) as { name: string }[]).map((f) => f.name),
    categorySlugs: ((CAT.data ?? []) as { slug: string }[]).map((c) => c.slug),
    tagNames: ((TAG.data ?? []) as { name: string }[]).map((t) => t.name),
  });

  const productById = new Map(
    ((P.data ?? []) as Record<string, unknown>[]).map((p) => [
      String(p.id),
      {
        name: String(p.name),
        manufacturerName: mfr.get(String(p.manufacturer_id)) ?? null,
        familyId: str(p.family_id),
      },
    ])
  );
  const verifiedByAsset = new Map<string, VerifiedProduct[]>();
  for (const l of (PM.data ?? []) as Record<string, unknown>[]) {
    const pr = productById.get(String(l.product_id));
    if (!pr) continue;
    const k = String(l.media_id);
    verifiedByAsset.set(k, [...(verifiedByAsset.get(k) ?? []), { productId: String(l.product_id), ...pr }]);
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
    verifiedProducts: verifiedByAsset.get(String(a.id)) ?? [],
  }));
  const assetById = new Map(assets.map((a) => [a.id, a]));

  const slotsByTarget = new Map<string, SlotState[]>();
  const usage = new Map<string, number>();
  const pushSlot = (key: string, role: string, mediaId: string, kind: unknown) => {
    if (role !== "hero" && role !== "thumbnail" && role !== "gallery") return;
    slotsByTarget.set(key, [
      ...(slotsByTarget.get(key) ?? []),
      { role, protectedSelection: isProtectedSelection(kind as never) },
    ]);
    usage.set(mediaId, (usage.get(mediaId) ?? 0) + 1);
  };
  for (const r of (CM.data ?? []) as Record<string, unknown>[]) {
    pushSlot(`content:${r.content_id}`, String(r.role), String(r.media_id), r.selection_kind);
  }
  for (const r of (PM.data ?? []) as Record<string, unknown>[]) {
    pushSlot(`product:${r.product_id}`, String(r.role), String(r.media_id), r.selection_kind);
  }

  const targets: MatchTarget[] = [];
  // PRODUCT PAGES USE THE SAME MATCHER, THE SAME GATE AND THE SAME PROVENANCE.
  //
  // A product row always names one specific model, so isModelSpecific is true
  // unconditionally and the SKU rule refuses every family-level image for it.
  // That is the strict exact-identity bar the brief asks for, and it is the rule
  // that already exists rather than a second one written for products: a generic
  // manufacturer graphic cannot reach a product hero because it is not an exact
  // match, not because a product-specific check turned it away.
  //
  // productId and familyId are supplied so verifiedVerdict can use product_media
  // as recorded evidence — an image linked to a DIFFERENT product is refused
  // outright, whatever its filename says.
  for (const p of (P.data ?? []) as Record<string, unknown>[]) {
    const key = `product:${p.id}`;
    targets.push({
      id: String(p.id),
      kind: "product",
      productId: String(p.id),
      familyId: str(p.family_id),
      title: String(p.name),
      manufacturerName: p.manufacturer_id ? (mfr.get(String(p.manufacturer_id)) ?? null) : null,
      categorySlug: p.category_id ? (cat.get(String(p.category_id)) ?? null) : null,
      isModelSpecific: true,
      occupiedSlots: (slotsByTarget.get(key) ?? []).map((sl) => ({
        role: sl.role,
        humanSelected: sl.protectedSelection,
      })),
    });
  }
  for (const c of (C.data ?? []) as Record<string, unknown>[]) {
    const key = `content:${c.id}`;
    targets.push({
      id: String(c.id),
      kind: "content",
      title: String(c.title),
      manufacturerName: null,
      categorySlug: c.category_id ? (cat.get(String(c.category_id)) ?? null) : null,
      isModelSpecific: deriveIsModelSpecific(String(c.title)),
      occupiedSlots: (slotsByTarget.get(key) ?? []).map((s) => ({
        role: s.role,
        humanSelected: s.protectedSelection,
      })),
    });
  }

  const usable = assets.filter(
    (a) => a.publicationStatus === "published" && a.rightsStatus !== "restricted"
  );

  console.log("=".repeat(78));
  console.log(`AUTO-ATTACH ${apply ? "— APPLYING" : "— REPORT ONLY"}`);
  console.log(
    `${assets.length} assets (${usable.length} usable), ${targets.length} targets ` +
      `(${targets.filter((t) => t.kind === "content").length} content, ${targets.filter((t) => t.kind === "product").length} product)`
  );
  console.log(`entity vocabulary: ${entityVocabulary.size} naming words`);
  console.log("=".repeat(78));

  let considered = 0;
  let attached = 0;
  let nothingSafe = 0;
  const written: string[] = [];

  for (const target of targets) {
    if (considered >= LIMIT) break;
    considered++;

    const scored = matchesForTarget(target, usable, { limit: 8, entityVocabulary });
    // Rotation orders equals; it cannot promote a worse match. See
    // selection-policy.ts.
    const ordered = orderForSlot(
      scored.map((m) => ({ assetId: m.assetId, score: m.score, usageCount: usage.get(m.assetId) ?? 0 }))
    );
    const byId = new Map(scored.map((m) => [m.assetId, m]));

    let filledHere = false;
    const held = [...(slotsByTarget.get(`${target.kind}:${target.id}`) ?? [])];

    for (const candidate of ordered) {
      const match = byId.get(candidate.assetId);
      const asset = assetById.get(candidate.assetId);
      if (!match || !asset) continue;

      const decision = decideAutoAttach(asset, match, held);
      // Only the PROMINENT slots are worth reporting per-candidate; a gallery
      // attachment on every loosely-related asset would be noise of a different
      // kind, so the first qualifying candidate takes what it can and the rest
      // are left for an editor.
      if (decision.slots.length === 0) continue;

      const file = (asset.storagePath.split("/").pop() ?? "").replace(/^[0-9a-f-]{36}-?/i, "");
      console.log(
        `
  ${target.kind === "product" ? "PRODUCT" : "ARTICLE"}  ` +
          `[${target.isModelSpecific ? "model-specific" : "general"}] ${target.title.slice(0, 62)}`
      );
      console.log(`  IMAGE    ${file}`);
      console.log(`  MATCH    ${match.specificity} / ${match.strength} / score ${match.score} / ${match.nature}`);
      console.log(`  ATTACH   ${decision.slots.join(", ")}  as selection_kind='engine'`);
      for (const r of decision.reasons) console.log(`    why     ${r}`);

      if (apply) {
        const table = target.kind === "product" ? "product_media" : "content_media";
        const rows = decision.slots.map((role) => ({
          [target.kind === "product" ? "product_id" : "content_id"]: target.id,
          media_id: asset.id,
          role,
          sort_order: 0,
          ...engineSelection(),
        }));
        const { error } = await db.from(table).insert(rows as never);
        if (error) {
          console.log(`    FAILED  ${error.message}`);
          continue;
        }
        written.push(`${target.title.slice(0, 40)} <- ${file} [${decision.slots.join(",")}]`);
      }
      for (const role of decision.slots) held.push({ role, protectedSelection: false });
      attached += decision.slots.length;
      filledHere = true;
      break;
    }

    if (!filledHere) nothingSafe++;
  }

  console.log(`\n${"=".repeat(78)}`);
  console.log(`  targets considered            : ${considered}`);
  console.log(`  slots ${apply ? "attached" : "attachable"}${apply ? "              " : "            "}: ${attached}`);
  console.log(`  targets with NOTHING safe     : ${nothingSafe}  -> awaiting media`);
  if (!apply) console.log("\n  REPORT ONLY — nothing was written. Re-run with --apply.");
  else for (const w of written) console.log(`    wrote ${w}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
