import "server-only";

// THE I/O HALF OF MEDIA INTELLIGENCE.
//
// Loads the library and the content/product catalogue once, then runs the pure
// scorer in both directions. Fixed round-trip count: five reads regardless of
// how many assets or targets exist, because the matching is in-memory and the
// alternative is a query per pairing.
//
// ON "HUMAN SELECTED"
// -------------------
// content_media has no column recording WHO chose a slot, so this cannot
// distinguish an owner's deliberate hero from one an earlier automation
// attached. It therefore treats EVERY occupied hero and thumbnail as protected.
// That is the fail-safe direction: the cost is a suggestion the owner has to
// make explicitly, and the alternative cost is silently overwriting a choice
// somebody made on purpose.

import { createClient } from "@/lib/supabase/server";
import { logQueryError } from "@/lib/log/query-error";
import {
  matchesForAsset,
  matchesForTarget,
  classifyNature,
  proposeAltText,
  type MatchAsset,
  type VerifiedProduct,
  type MatchTarget,
  type MediaMatch,
  type AssetNature,
} from "./match-engine.ts";

export type AssetSuggestion = {
  asset: MatchAsset;
  nature: AssetNature;
  /** Best targets for this image, strongest first. */
  matches: MediaMatch[];
  /** Alt text proposed from what is genuinely known. Null when nothing is. */
  proposedAlt: string | null;
  /** True when the asset currently has no association at all. */
  unattached: boolean;
};

export type TargetNeed = {
  target: MatchTarget;
  /** Why this page needs visual work. */
  reason: string;
  /** Existing library assets that could fill the gap, strongest first. */
  candidates: MediaMatch[];
  /** Set when nothing in the library fits — this is what to go and create. */
  briefForNewImage: string | null;
  priority: number;
};

type Loaded = {
  assets: MatchAsset[];
  targets: MatchTarget[];
  /** media_id -> number of slots it currently occupies anywhere. */
  usage: Map<string, number>;
  failures: string[];
};

async function loadAll(): Promise<Loaded> {
  const supabase = await createClient();
  const failures: string[] = [];

  const [assetsRes, contentRes, productsRes, cmRes, pmRes, catsRes, mfrRes] = await Promise.all([
    supabase
      .from("media_assets")
      .select(
        "id, storage_path, alt_text, caption, source_type, asset_role, brand_role, owned, ai_generated, publication_status, rights_status, width, height"
      ),
    supabase.from("content_items").select("id, title, status, category_id"),
    supabase.from("products").select("id, name, is_published, category_id, manufacturer_id, family_id"),
    supabase.from("content_media").select("content_id, media_id, role"),
    supabase.from("product_media").select("product_id, media_id, role"),
    supabase.from("taxonomy_categories").select("id, slug"),
    supabase.from("manufacturers").select("id, name"),
  ]);

  for (const [name, res] of [
    ["media_assets", assetsRes],
    ["content_items", contentRes],
    ["products", productsRes],
    ["content_media", cmRes],
    ["product_media", pmRes],
  ] as const) {
    if (res.error) {
      logQueryError(`loadAll ${name}`, res.error);
      failures.push(`${name}: ${res.error.message}`);
    }
  }

  const catSlug = new Map(
    ((catsRes.data ?? []) as { id: string; slug: string }[]).map((c) => [c.id, c.slug])
  );
  const mfrName = new Map(
    ((mfrRes.data ?? []) as { id: string; name: string }[]).map((m) => [m.id, m.name])
  );

  // VERIFIED IDENTITY, built from links that already exist.
  //
  // product_media is loaded below for usage counts anyway. Joining it through
  // to the matcher turns "what does this filename claim" into "what is this
  // image recorded as showing" — better evidence, and the only thing able to
  // refuse an image whose filename names the wrong product.
  const productById = new Map(
    ((productsRes.data ?? []) as unknown as Record<string, unknown>[]).map((p) => [
      String(p.id),
      {
        name: String(p.name),
        manufacturerName: mfrName.get(String(p.manufacturer_id)) ?? null,
        familyId: (p.family_id as string | null) ?? null,
      },
    ])
  );
  const verifiedByAsset = new Map<string, VerifiedProduct[]>();
  for (const link of (pmRes.data ?? []) as unknown as Record<string, unknown>[]) {
    const product = productById.get(String(link.product_id));
    if (!product) continue;
    const mediaId = String(link.media_id);
    const list = verifiedByAsset.get(mediaId) ?? [];
    list.push({ productId: String(link.product_id), ...product });
    verifiedByAsset.set(mediaId, list);
  }

  const assets: MatchAsset[] = (
    (assetsRes.data ?? []) as unknown as Record<string, unknown>[]
  ).map((a) => ({
    id: String(a.id),
    storagePath: String(a.storage_path),
    altText: (a.alt_text as string | null) ?? null,
    caption: (a.caption as string | null) ?? null,
    sourceType: (a.source_type as string | null) ?? null,
    assetRole: (a.asset_role as string | null) ?? null,
    brandRole: (a.brand_role as string | null) ?? null,
    owned: a.owned === true,
    aiGenerated: a.ai_generated === true,
    publicationStatus: String(a.publication_status),
    rightsStatus: String(a.rights_status),
    width: (a.width as number | null) ?? null,
    height: (a.height as number | null) ?? null,
    verifiedProducts: verifiedByAsset.get(String(a.id)) ?? [],
  }));

  // Slots per target, and total usage per asset.
  const slotsByTarget = new Map<string, { role: "hero" | "thumbnail" | "gallery"; humanSelected: boolean }[]>();
  const usage = new Map<string, number>();
  const push = (key: string, role: string, mediaId: string) => {
    if (role !== "hero" && role !== "thumbnail" && role !== "gallery") return;
    slotsByTarget.set(key, [
      ...(slotsByTarget.get(key) ?? []),
      // See the header: with no provenance column, every occupied slot is
      // treated as a deliberate human choice.
      { role, humanSelected: true },
    ]);
    usage.set(mediaId, (usage.get(mediaId) ?? 0) + 1);
  };
  for (const r of (cmRes.data ?? []) as { content_id: string; media_id: string; role: string }[]) {
    push(`content:${r.content_id}`, r.role, r.media_id);
  }
  for (const r of (pmRes.data ?? []) as { product_id: string; media_id: string; role: string }[]) {
    push(`product:${r.product_id}`, r.role, r.media_id);
  }

  const targets: MatchTarget[] = [];
  for (const c of (contentRes.data ?? []) as {
    id: string;
    title: string;
    status: string;
    category_id: string | null;
  }[]) {
    targets.push({
      id: c.id,
      kind: "content",
      title: c.title,
      manufacturerName: null,
      categorySlug: c.category_id ? (catSlug.get(c.category_id) ?? null) : null,
      // An article naming a model number is model-specific and gets the SKU
      // rule; a general explainer does not.
      isModelSpecific: /\d/.test(c.title) && !/^\d+\s/.test(c.title),
      occupiedSlots: slotsByTarget.get(`content:${c.id}`) ?? [],
    });
  }
  for (const p of (productsRes.data ?? []) as {
    id: string;
    name: string;
    is_published: boolean;
    category_id: string | null;
    manufacturer_id: string | null;
    family_id: string | null;
  }[]) {
    targets.push({
      id: p.id,
      kind: "product",
      productId: p.id,
      familyId: p.family_id,
      title: p.name,
      manufacturerName: p.manufacturer_id ? (mfrName.get(p.manufacturer_id) ?? null) : null,
      categorySlug: p.category_id ? (catSlug.get(p.category_id) ?? null) : null,
      // A product row always names one specific model.
      isModelSpecific: true,
      occupiedSlots: slotsByTarget.get(`product:${p.id}`) ?? [],
    });
  }

  return { assets, targets, usage, failures };
}

/** MEDIA -> CONTENT. Where could each image go? */
export async function loadAssetSuggestions(
  options: { limit?: number; onlyUnattached?: boolean } = {}
): Promise<{ suggestions: AssetSuggestion[]; failures: string[] }> {
  const { assets, targets, usage, failures } = await loadAll();

  const pool = options.onlyUnattached
    ? assets.filter((a) => (usage.get(a.id) ?? 0) === 0)
    : assets;

  const suggestions: AssetSuggestion[] = [];
  for (const asset of pool) {
    const matches = matchesForAsset(asset, targets, { limit: 4 });
    if (matches.length === 0) continue;
    suggestions.push({
      asset,
      nature: classifyNature(asset),
      matches,
      // Only propose alt text where none exists. Overwriting a human's
      // description with a generated one would be a downgrade.
      proposedAlt: asset.altText && asset.altText.trim().length > 0
        ? null
        : proposeAltText(asset, matches[0]),
      unattached: (usage.get(asset.id) ?? 0) === 0,
    });
  }

  // Unattached first, then by how good the best match is: an image doing
  // nothing with a strong home is the most valuable thing to action.
  suggestions.sort(
    (a, b) =>
      Number(b.unattached) - Number(a.unattached) ||
      (b.matches[0]?.score ?? 0) - (a.matches[0]?.score ?? 0)
  );
  return { suggestions: suggestions.slice(0, options.limit ?? 60), failures };
}

/** CONTENT -> MEDIA. Which pages need visual work, and what could fill it? */
export async function loadMediaNeeds(
  options: { limit?: number } = {}
): Promise<{ needs: TargetNeed[]; failures: string[] }> {
  const { assets, targets, failures } = await loadAll();
  const usable = assets.filter(
    (a) => a.publicationStatus === "published" && a.rightsStatus !== "restricted"
  );

  const needs: TargetNeed[] = [];
  for (const target of targets) {
    const hasHero = target.occupiedSlots.some((s) => s.role === "hero");
    const hasThumb = target.occupiedSlots.some((s) => s.role === "thumbnail");
    if (hasHero && hasThumb) continue;

    const reason = !hasHero && !hasThumb
      ? "No lead or card image"
      : !hasHero
        ? "No lead image"
        : "No explicit card image";

    const candidates = matchesForTarget(target, usable, { limit: 3 });

    // Priority: published pages a reader can already reach come first, and a
    // page with a candidate sitting unused outranks one that needs new work.
    let priority = 0;
    if (target.kind === "content") priority += 20;
    if (!hasHero) priority += 30;
    if (candidates.length > 0) priority += 25;
    priority += Math.min(candidates[0]?.score ?? 0, 40) / 2;

    needs.push({
      target,
      reason,
      candidates,
      briefForNewImage:
        candidates.length === 0
          ? describeNeededImage(target)
          : null,
      priority,
    });
  }

  needs.sort((a, b) => b.priority - a.priority || a.target.title.localeCompare(b.target.title));
  return { needs: needs.slice(0, options.limit ?? 60), failures };
}

/**
 * What image to go and make, when the library has nothing.
 *
 * Deliberately describes a SHOT, not a specification: it is a brief for a
 * photograph or a render, and any claim about the subject's features would be
 * this system inventing one.
 */
function describeNeededImage(target: MatchTarget): string {
  const subject = target.title.replace(/[:—-].*$/, "").trim();
  if (target.kind === "product") {
    return `Photograph of ${subject} — the product itself, clearly identifiable, on a plain background. Owner photography preferred.`;
  }
  return `Lead image for "${subject}" — a photograph of the hardware involved, or an original diagram if the piece is explanatory. No stock-looking imagery.`;
}
