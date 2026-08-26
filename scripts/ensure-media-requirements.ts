// Every article with no acceptable image must ASK for one.
//
// This is the honest half of automatic media association: when the matcher
// finds nothing it can stand behind, the answer is a request for the image
// that is actually needed — never a loosely-related picture pressed into a
// hero slot.
//
// It runs the real matcher over the real library. An article gets a
// requirement only when NOTHING in the library can fill its lead slot, so a
// request always means "this image does not exist yet", not "nobody looked".
//
// IDEMPOTENT AND NON-DESTRUCTIVE. An existing requirement is never overwritten
// — its notes may record sourcing work already done ("Wikimedia Commons checked
// by category on 2026-08-22 — no usable photograph"), and replacing that with a
// freshly generated line would destroy the record of a search someone ran.
//
//   npx tsx scripts/ensure-media-requirements.ts            (report)
//   npx tsx scripts/ensure-media-requirements.ts --apply

import { loadEnvLocal, createAdminClient } from "./_shared.ts";
import {
  deriveIsModelSpecific,
  matchesForTarget,
  type MatchAsset,
  type MatchTarget,
  type VerifiedProduct,
} from "../src/lib/media/match-engine.ts";

const apply = process.argv.includes("--apply");

/**
 * The brief written onto a new requirement.
 *
 * Says what is needed, what would be acceptable, and what must NOT be used.
 * The last line is the important one: it is the instruction that stops a
 * near-miss being substituted later, and it names the specific risk for this
 * subject rather than a generic warning.
 */
function briefFor(title: string, nearest: string | null): string {
  const subject = title.replace(/: what has been reported so far$/i, "").trim();
  const lines = [
    `Needed: a lead image for "${subject}".`,
    "Acceptable: an official press image of the exact product, or a photograph we own of it.",
  ];
  if (nearest) {
    lines.push(
      `Do NOT use: ${nearest} — the matcher considered it and it is not this product. ` +
        "A picture of a different model must not illustrate this one."
    );
  } else {
    lines.push(
      "Do NOT use: a photograph of an older or adjacent model presented as this one, " +
        "or a concept render presented as a photograph."
    );
  }
  lines.push("Opened automatically because nothing in the media library can honestly fill the lead slot.");
  return lines.join("\n");
}

async function main(): Promise<void> {
  loadEnvLocal();
  const db = await createAdminClient();

  const [assetsRes, contentRes, productsRes, cmRes, pmRes, catsRes, mfrRes, reqRes] = await Promise.all([
    db.from("media_assets").select(
      "id, storage_path, alt_text, caption, source_type, asset_role, brand_role, owned, ai_generated, publication_status, rights_status, width, height"
    ),
    db.from("content_items").select("id, title, status, category_id"),
    db.from("products").select("id, name, manufacturer_id, family_id"),
    db.from("content_media").select("content_id, media_id, role"),
    db.from("product_media").select("product_id, media_id, role"),
    db.from("taxonomy_categories").select("id, slug"),
    db.from("manufacturers").select("id, name"),
    db.from("media_requirements").select("id, content_id"),
  ]);
  for (const [n, r] of [["assets", assetsRes], ["content", contentRes], ["requirements", reqRes]] as const) {
    if (r.error) throw new Error(`${n} read failed: ${r.error.message}`);
  }

  const catSlug = new Map(((catsRes.data ?? []) as any[]).map((c) => [c.id, c.slug]));
  const mfrName = new Map(((mfrRes.data ?? []) as any[]).map((m) => [m.id, m.name]));
  const productById = new Map(
    ((productsRes.data ?? []) as any[]).map((p) => [
      String(p.id),
      { name: String(p.name), manufacturerName: mfrName.get(p.manufacturer_id) ?? null, familyId: p.family_id ?? null },
    ])
  );

  const verifiedByAsset = new Map<string, VerifiedProduct[]>();
  for (const l of (pmRes.data ?? []) as any[]) {
    const p = productById.get(String(l.product_id));
    if (!p) continue;
    const list = verifiedByAsset.get(String(l.media_id)) ?? [];
    list.push({ productId: String(l.product_id), ...p });
    verifiedByAsset.set(String(l.media_id), list);
  }

  const assets: MatchAsset[] = ((assetsRes.data ?? []) as any[]).map((a) => ({
    id: a.id, storagePath: a.storage_path, altText: a.alt_text, caption: a.caption,
    sourceType: a.source_type, assetRole: a.asset_role, brandRole: a.brand_role,
    owned: a.owned === true, aiGenerated: a.ai_generated === true,
    publicationStatus: a.publication_status, rightsStatus: a.rights_status,
    width: a.width, height: a.height,
    verifiedProducts: verifiedByAsset.get(String(a.id)) ?? [],
  }));
  const usable = assets.filter((a) => a.publicationStatus === "published" && a.rightsStatus !== "restricted");

  const heroed = new Set(((cmRes.data ?? []) as any[]).filter((r) => r.role === "hero").map((r) => r.content_id));
  const haveRequirement = new Set(((reqRes.data ?? []) as any[]).filter((r) => r.content_id).map((r) => r.content_id));

  let needed = 0, created = 0, alreadyOk = 0, matchable = 0;

  for (const c of (contentRes.data ?? []) as any[]) {
    if (heroed.has(c.id)) continue;

    const target: MatchTarget = {
      id: c.id, kind: "content", title: c.title, manufacturerName: null,
      categorySlug: c.category_id ? (catSlug.get(c.category_id) ?? null) : null,
      isModelSpecific: deriveIsModelSpecific(c.title),
      occupiedSlots: [],
    };

    const matches = matchesForTarget(target, usable, { limit: 3 });
    const canFillHero = matches.some((m) => m.proposedSlots.includes("hero"));
    if (canFillHero) {
      // The library CAN answer this one; it is a suggestion, not a gap.
      matchable++;
      continue;
    }

    needed++;
    if (haveRequirement.has(c.id)) { alreadyOk++; continue; }

    const nearestAsset = matches[0] ? usable.find((a) => a.id === matches[0].assetId) : undefined;
    const nearest = nearestAsset
      ? (nearestAsset.storagePath.split("/").pop() ?? "").replace(/^[0-9a-f-]{36}-/, "")
      : null;

    console.log(`\n  OPEN  [${c.status}] ${String(c.title).slice(0, 64)}`);
    console.log(`        ${briefFor(c.title, nearest).split("\n").join("\n        ")}`);

    if (apply) {
      const { error } = await db.from("media_requirements").insert({
        content_id: c.id,
        sourcing_status: "needed",
        notes: briefFor(c.title, nearest),
      });
      if (error) console.error(`        insert failed: ${error.message}`);
      else created++;
    } else {
      created++;
    }
  }

  console.log(`\n  articles with a usable candidate : ${matchable}`);
  console.log(`  articles needing new media       : ${needed}`);
  console.log(`    already had a requirement      : ${alreadyOk}`);
  console.log(`    ${apply ? "opened" : "would open"}                       : ${created}`);
  if (!apply) console.log("\n  REPORT ONLY — re-run with --apply");
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
