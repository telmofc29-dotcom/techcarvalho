import "server-only";
import { createClient } from "@/lib/supabase/server";
import { mediaPublicUrl } from "@/lib/media/public-url";
import { logQueryError } from "@/lib/log/query-error";
import { chooseActiveHero } from "@/lib/media/hero-slot";
import { selectArticleHero, type HeroCandidate, type ProductLinkRole } from "@/lib/media/hero-selection";
import type { MediaSourceType } from "@/lib/types/database";
import { ROOT_LOCALE } from "@/lib/i18n/locales";

// Provenance travels with the hero image because the PAGE has to disclose it.
// See src/lib/media/presentation.ts: a TechCarvalho original graphic occupying
// the hero slot must be labelled as a graphic, and a required credit line must
// actually reach the reader. Both are impossible if the query drops these
// columns, so they are part of the type rather than an optional extra lookup.
// Optional so the many call sites that only need url+alt are unaffected.
export type HeroImage = {
  url: string;
  alt: string | null;
  sourceType?: MediaSourceType | null;
  owned?: boolean;
  aiGenerated?: boolean;
  attribution?: string | null;
  attributionRequired?: boolean;
  creator?: string | null;
  sourceUrl?: string | null;
  /** Recorded licence string, e.g. 'CC BY-SA 4.0'. Needed to link the deed,
   *  which CC BY/BY-SA require alongside the creator's name. */
  license?: string | null;
  /** Editor-written caption. A chart's caption says what the chart shows and
   *  cites its source — dropping it turns a sourced graphic into a picture. */
  caption?: string | null;
  // The three fields below exist so a CARD can decide how to fit the image,
  // not just a detail page. classifyMediaTier() needs storage_path and
  // asset_role to tell a comparison chart from a photograph; without them
  // every list view had to assume "photograph" and crop accordingly, which is
  // how 16:9 charts ended up cropped 25% narrower in 4:3 card frames.
  storagePath?: string | null;
  assetRole?: string | null;
  /** Intrinsic pixel size. Drives the frame's aspect ratio so the frame is
   *  built around the image rather than the image forced into the frame. */
  width?: number | null;
  height?: number | null;
};

/**
 * Adapts the camelCase shape the public layer passes around into the snake_case
 * row shape classifyMediaTier()/mediaFit() expect.
 *
 * Structurally typed rather than taking `HeroImage` so a `GalleryImage` — which
 * carries exactly the same provenance fields but declares the nullable ones as
 * `T | null` instead of `T | undefined` — goes through the same path. The two
 * kinds of image get identical fit decisions because they are the same assets;
 * only the slot differs.
 */
export function classifiable(
  image:
    | {
        sourceType?: MediaSourceType | null;
        assetRole?: string | null;
        owned?: boolean | null;
        aiGenerated?: boolean | null;
        storagePath?: string | null;
        sourceUrl?: string | null;
        license?: string | null;
      }
    | null
    | undefined
) {
  if (!image) return null;
  return {
    source_type: image.sourceType ?? null,
    asset_role: image.assetRole ?? null,
    owned: image.owned ?? null,
    ai_generated: image.aiGenerated ?? null,
    storage_path: image.storagePath ?? null,
    source_url: image.sourceUrl ?? null,
    license: image.license ?? null,
  };
}

export type GalleryImage = {
  url: string;
  alt: string | null;
  caption: string | null;
  attribution: string | null;
  attributionRequired: boolean;
  creator: string | null;
  sourceUrl: string | null;
  /** Recorded licence string. CC BY/BY-SA require a link to the licence
   *  itself, not only to the material and the creator's name. */
  license: string | null;
  // Same purpose as on HeroImage: a gallery slot has to know whether it is
  // holding a diagram or a photograph before it decides to crop.
  storagePath: string | null;
  assetRole: string | null;
  sourceType: MediaSourceType | null;
  owned: boolean | null;
  aiGenerated: boolean | null;
  width: number | null;
  height: number | null;
};

// Degrades to "no image" on any error rather than crashing product/article
// pages — a missing hero image link, a media row deleted out from under a
// stale join, etc. should never take down the page it's decorating. Errors
// are still logged server-side so a real failure doesn't look identical to
// "this product just has no hero image".
export async function getPublishedHeroImage(
  kind: "product" | "content",
  id: string
): Promise<HeroImage | null> {
  const supabase = await createClient();

  try {
    // ALL hero rows, not the first one the database happens to hand back.
    //
    // The schema's unique constraint is on (target, media, role), which permits
    // several DIFFERENT assets to hold 'hero' on one target. This query used to
    // be .limit(1) with no ORDER BY, so when that happened the winner was
    // effectively arbitrary — and in production, on ps5-vs-ps5-pro-worth-it, it
    // picked the older graphic over the newly assigned image. Worse, had it
    // picked the newer one, that asset was still private and the page would
    // have rendered NO hero at all.
    //
    // chooseActiveHero() prefers a hero that can actually be displayed, then
    // orders deterministically. This is a safety net for data that already
    // exists; the real fix is the one-hero index in
    // supabase/migrations_pending/20260824_one_hero_per_target.sql.
    const { data: links, error: linkError } =
      kind === "product"
        ? await supabase.from("product_media").select("id, media_id, sort_order").eq("product_id", id).eq("role", "hero")
        : await supabase.from("content_media").select("id, media_id, sort_order").eq("content_id", id).eq("role", "hero");
    if (linkError) logQueryError(`getPublishedHeroImage(${kind}, ${id}) link`, linkError);
    if (linkError || !links || links.length === 0) return null;

    const { data: candidates, error: assetError } = await supabase
      .from("media_assets")
      .select(
        "id, alt_text, caption, publication_status, storage_path, public_storage_path, source_type, asset_role, owned, ai_generated, attribution, attribution_required, creator, source_url, license, width, height"
      )
      .in("id", links.map((l) => l.media_id));
    if (assetError) logQueryError(`getPublishedHeroImage(${kind}, ${id}) asset`, assetError);
    if (assetError || !candidates || candidates.length === 0) return null;

    if (links.length > 1) {
      // Not fatal, but it is a contradiction an admin should know about, and it
      // is invisible from the page itself.
      logQueryError(`getPublishedHeroImage(${kind}, ${id})`, {
        message: `${links.length} hero associations exist for this target; expected exactly one. Run scripts/audit-media-usage.mjs.`,
      });
    }

    const byId = new Map(candidates.map((a) => [a.id, a]));
    const chosen = chooseActiveHero(
      links.map((l) => {
        const a = byId.get(l.media_id);
        return {
          mediaId: l.media_id,
          rowId: l.id,
          sortOrder: l.sort_order ?? 0,
          renderable: a?.publication_status === "published" && Boolean(a?.public_storage_path),
        };
      })
    );
    const asset = chosen ? byId.get(chosen.mediaId) : null;
    if (!asset) return null;
    if (asset.publication_status !== "published" || !asset.public_storage_path) return null;

    return {
      url: mediaPublicUrl(asset.public_storage_path),
      alt: asset.alt_text,
      sourceType: asset.source_type,
      owned: asset.owned,
      aiGenerated: asset.ai_generated,
      attribution: asset.attribution,
      attributionRequired: asset.attribution_required,
      creator: asset.creator,
      // `source_url` was already selected by the query above and already
      // declared on HeroImage, but was never copied onto the returned
      // object — so a hero image whose licence requires a link back to the
      // source rendered its credit as plain text with the link silently
      // dropped. getPublishedGallery (below) has always returned it; only
      // the hero path lost it.
      sourceUrl: asset.source_url,
      license: asset.license,
      caption: asset.caption,
      storagePath: asset.storage_path,
      assetRole: asset.asset_role,
      width: asset.width,
      height: asset.height,
    };
  } catch (e) {
    console.error(`[query-error] getPublishedHeroImage(${kind}, ${id}) threw`, e);
    return null;
  }
}

// Every column the hero pipeline needs: what to render, what to disclose, and
// (rights_status / brand_role) what selection is allowed to consider at all.
// One list, used by the batched list path and the article resolver alike, so
// the two cannot drift into classifying the same asset differently.
const HERO_ASSET_COLUMNS =
  "id, alt_text, caption, publication_status, storage_path, public_storage_path, source_type, asset_role, owned, ai_generated, attribution, attribution_required, creator, source_url, license, width, height, rights_status, brand_role";

type HeroAssetRow = {
  id: string;
  alt_text: string | null;
  caption: string | null;
  publication_status: string;
  storage_path: string;
  public_storage_path: string | null;
  source_type: MediaSourceType | null;
  asset_role: string | null;
  owned: boolean;
  ai_generated: boolean;
  attribution: string | null;
  attribution_required: boolean;
  creator: string | null;
  source_url: string | null;
  license: string | null;
  width: number | null;
  height: number | null;
  rights_status: string;
  brand_role: string | null;
};

/** Null when the asset has no public copy — there is no URL to render. */
function heroImageFromAsset(asset: HeroAssetRow): HeroImage | null {
  if (asset.publication_status !== "published" || !asset.public_storage_path) return null;
  return {
    url: mediaPublicUrl(asset.public_storage_path),
    alt: asset.alt_text,
    sourceType: asset.source_type,
    owned: asset.owned,
    aiGenerated: asset.ai_generated,
    // Carried so a CARD can render its credit too. Omitting these on the
    // batched path was a live licence breach: the detail-page query selected
    // them and the list query did not, so every CC BY photograph on the
    // homepage, category pages and index pages rendered uncredited.
    attribution: asset.attribution,
    attributionRequired: asset.attribution_required,
    creator: asset.creator,
    sourceUrl: asset.source_url,
    license: asset.license,
    caption: asset.caption,
    storagePath: asset.storage_path,
    assetRole: asset.asset_role,
    width: asset.width,
    height: asset.height,
  };
}

/**
 * Wraps an asset row as a selection candidate.
 *
 * Null when the asset cannot be rendered at all. Everything else — rights
 * state, brand role, dimensions — is passed THROUGH rather than filtered here,
 * so `isEligibleHeroCandidate` remains the single place that decides what may
 * be surfaced and its reasons stay auditable.
 */
function heroCandidate(
  asset: HeroAssetRow,
  origin: "article" | "product",
  extra: { linkRole?: ProductLinkRole | null; productName?: string | null; heroUseCount?: number } = {}
): HeroCandidate<HeroImage> | null {
  const image = heroImageFromAsset(asset);
  if (!image) return null;
  return {
    ref: image,
    assetId: asset.id,
    asset: {
      source_type: asset.source_type,
      asset_role: asset.asset_role,
      owned: asset.owned,
      ai_generated: asset.ai_generated,
      storage_path: asset.storage_path,
      source_url: asset.source_url,
      license: asset.license,
    },
    origin,
    rightsStatus: asset.rights_status,
    publicationStatus: asset.publication_status,
    hasPublicCopy: Boolean(asset.public_storage_path),
    brandRole: asset.brand_role,
    width: asset.width,
    height: asset.height,
    ...extra,
  };
}

// Batched hero-image lookup for LIST pages (homepage rails, category/
// products/articles indexes, search results, manufacturer product lists,
// related-item rails) — one query pair for the whole list rather than
// calling getPublishedHeroImage per row, same fixed-round-trip-count
// discipline as attachExcerpts in ./excerpt.ts. Rows with no hero (or an
// unpublished/deleted one) get heroImage: null, never an error.
//
// For `kind: "content"` the stored link is the STARTING point, not the answer:
// the result goes through resolveArticleHeroes() so a card shows the same lead
// image the article page will. Before that, an article could open with a
// photograph of the product it covers while its card on the homepage still
// showed the category title card, because the two came from different code.
export async function attachHeroImages<T extends { id: string }>(
  supabase: Awaited<ReturnType<typeof createClient>>,
  rows: T[],
  kind: "product" | "content"
): Promise<(T & { heroImage: HeroImage | null })[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);

  try {
    const linksResult =
      kind === "product"
        ? await supabase.from("product_media").select("product_id, media_id").in("product_id", ids).eq("role", "hero")
        : await supabase.from("content_media").select("content_id, media_id").in("content_id", ids).eq("role", "hero");
    logQueryError(`attachHeroImages(${kind}) links`, linksResult.error);

    const links: { entityId: string; media_id: string }[] = (linksResult.data ?? []).map((l) =>
      kind === "product"
        ? { entityId: (l as { product_id: string; media_id: string }).product_id, media_id: l.media_id }
        : { entityId: (l as { content_id: string; media_id: string }).content_id, media_id: l.media_id }
    );

    const assetByEntityId = new Map<string, HeroAssetRow>();
    if (links.length > 0) {
      const mediaIds = [...new Set(links.map((l) => l.media_id))];
      const { data: assets, error: assetError } = await supabase
        .from("media_assets")
        // storage_path/asset_role/source_type/owned/ai_generated let the CARD
        // classify the asset (chart vs photograph) and so choose contain vs
        // cover; width/height let it size the frame. Same single round trip —
        // these are extra columns on a query that already ran, not extra
        // queries.
        .select(HERO_ASSET_COLUMNS)
        .in("id", mediaIds);
      logQueryError(`attachHeroImages(${kind}) assets`, assetError);

      const assetById = new Map((assets ?? []).map((a) => [a.id, a as unknown as HeroAssetRow]));
      for (const link of links) {
        if (assetByEntityId.has(link.entityId)) continue;
        const asset = assetById.get(link.media_id);
        if (!asset) continue;
        assetByEntityId.set(link.entityId, asset);
      }
    }

    if (kind === "product") {
      return rows.map((r) => {
        const asset = assetByEntityId.get(r.id);
        return { ...r, heroImage: asset ? heroImageFromAsset(asset) : null };
      });
    }

    const resolved = await resolveArticleHeroes(supabase, await articleInputs(supabase, rows), assetByEntityId);
    return rows.map((r) => ({ ...r, heroImage: resolved.get(r.id) ?? null }));
  } catch (e) {
    console.error(`[query-error] attachHeroImages(${kind}) threw`, e);
    return rows.map((r) => ({ ...r, heroImage: null }));
  }
}

export type ArticleHeroInput = { id: string; title: string; type: string | null };

/**
 * Selection needs the article's title and type, which every content list in
 * this repo already selects — so in practice this is a free structural read.
 * A caller that does not carry them gets one extra query rather than being
 * silently skipped: a page quietly opting out of hero selection is exactly the
 * kind of invisible difference this codebase keeps getting bitten by.
 */
async function articleInputs(
  supabase: Awaited<ReturnType<typeof createClient>>,
  rows: { id: string }[]
): Promise<ArticleHeroInput[]> {
  const present: ArticleHeroInput[] = [];
  const missing: string[] = [];
  for (const row of rows) {
    const r = row as { id: string; title?: unknown; type?: unknown };
    if (typeof r.title === "string") {
      present.push({ id: r.id, title: r.title, type: typeof r.type === "string" ? r.type : null });
    } else {
      missing.push(r.id);
    }
  }
  if (missing.length === 0) return present;

  // Scoped to the source locale even though this is a by-id lookup: the ids
  // arrive from already-scoped callers, so the filter is redundant today and
  // costs nothing — and it means a future caller that passes a translation's id
  // gets nothing rather than silently mixing a Portuguese title into an English
  // hero selection.
  const { data, error } = await supabase
    .from("content_items")
    .select("id, title, type")
    .eq("locale", ROOT_LOCALE)
    .in("id", missing);
  logQueryError("articleInputs", error);
  for (const row of data ?? []) present.push({ id: row.id, title: row.title, type: row.type });
  return present;
}

/**
 * THE FIX. Chooses each article's lead image from everything the site already
 * holds for it, instead of returning whatever `content_media` happened to
 * store.
 *
 * Candidates are the stored hero (the incumbent) plus the hero photography of
 * every PUBLISHED product the article links through `content_products`. The
 * judgement itself lives in src/lib/media/hero-selection.ts and is pure; this
 * function only assembles the inputs and maps the winner back to a HeroImage.
 *
 * Round-trip discipline: three further rounds at most, each `.in(...)`-bounded
 * by the batch, and every one of them skipped entirely when no article in the
 * batch has a replaceable hero — a list of comparison articles leading with
 * their comparison charts costs nothing extra.
 *
 * Degrades to the stored hero on any error. A failure to find a BETTER image
 * must never cost a page the image it already had.
 */
export async function resolveArticleHeroes(
  supabase: Awaited<ReturnType<typeof createClient>>,
  articles: ArticleHeroInput[],
  incumbentAssetByArticleId: Map<string, HeroAssetRow>
): Promise<Map<string, HeroImage | null>> {
  const stored = new Map<string, HeroImage | null>(
    articles.map((a) => {
      const asset = incumbentAssetByArticleId.get(a.id);
      return [a.id, asset ? heroImageFromAsset(asset) : null];
    })
  );
  if (articles.length === 0) return stored;

  try {
    const articleIds = articles.map((a) => a.id);
    const { data: productLinks, error: productLinksError } = await supabase
      .from("content_products")
      .select("content_id, product_id, role")
      .in("content_id", articleIds);
    logQueryError("resolveArticleHeroes productLinks", productLinksError);
    if (!productLinks || productLinks.length === 0) return stored;

    const productIds = [...new Set(productLinks.map((l) => l.product_id))];
    // RLS already hides media of unpublished products from `anon`, but an
    // admin-authenticated session (the audit script, a preview) sees them, and
    // the public site must render the same thing either way — so the published
    // set is filtered explicitly rather than left to the policy.
    const [{ data: products, error: productsError }, { data: productMedia, error: productMediaError }] =
      await Promise.all([
        supabase.from("products").select("id, name").in("id", productIds).eq("is_published", true),
        supabase.from("product_media").select("product_id, media_id, sort_order").in("product_id", productIds).eq("role", "hero"),
      ]);
    logQueryError("resolveArticleHeroes products", productsError);
    logQueryError("resolveArticleHeroes productMedia", productMediaError);

    const productNameById = new Map((products ?? []).map((p) => [p.id, p.name]));
    const publishedProductMedia = (productMedia ?? []).filter((m) => productNameById.has(m.product_id));
    if (publishedProductMedia.length === 0) return stored;

    const productMediaIds = [...new Set(publishedProductMedia.map((m) => m.media_id))];
    const incumbentIds = [...new Set([...incumbentAssetByArticleId.values()].map((a) => a.id))];
    const [{ data: assets, error: assetsError }, { data: heroUses, error: heroUsesError }] = await Promise.all([
      supabase.from("media_assets").select(HERO_ASSET_COLUMNS).in("id", productMediaIds),
      // How many PUBLISHED articles already lead with each asset. RLS restricts
      // content_media to published parents, so this count is exactly the
      // reader-visible duplication and needs no status filter of its own.
      supabase
        .from("content_media")
        .select("media_id")
        .eq("role", "hero")
        .in("media_id", [...new Set([...productMediaIds, ...incumbentIds])]),
    ]);
    logQueryError("resolveArticleHeroes assets", assetsError);
    logQueryError("resolveArticleHeroes heroUses", heroUsesError);

    const heroUseCount = new Map<string, number>();
    for (const row of heroUses ?? []) heroUseCount.set(row.media_id, (heroUseCount.get(row.media_id) ?? 0) + 1);

    const productAssetById = new Map((assets ?? []).map((a) => [a.id, a as unknown as HeroAssetRow]));
    const productHeroAssetByProductId = new Map<string, HeroAssetRow>();
    for (const link of [...publishedProductMedia].sort((a, b) => a.sort_order - b.sort_order)) {
      if (productHeroAssetByProductId.has(link.product_id)) continue;
      const asset = productAssetById.get(link.media_id);
      if (asset) productHeroAssetByProductId.set(link.product_id, asset);
    }

    const linksByArticle = new Map<string, { product_id: string; role: ProductLinkRole }[]>();
    for (const link of productLinks) {
      const list = linksByArticle.get(link.content_id) ?? [];
      list.push({ product_id: link.product_id, role: link.role as ProductLinkRole });
      linksByArticle.set(link.content_id, list);
    }

    const resolved = new Map(stored);
    for (const article of articles) {
      const incumbentAsset = incumbentAssetByArticleId.get(article.id);
      const incumbent = incumbentAsset
        ? heroCandidate(incumbentAsset, "article", { heroUseCount: heroUseCount.get(incumbentAsset.id) ?? 0 })
        : null;

      const candidates: HeroCandidate<HeroImage>[] = [];
      const seen = new Set<string>();
      for (const link of linksByArticle.get(article.id) ?? []) {
        const asset = productHeroAssetByProductId.get(link.product_id);
        if (!asset || seen.has(asset.id)) continue;
        seen.add(asset.id);
        const candidate = heroCandidate(asset, "product", {
          linkRole: link.role,
          productName: productNameById.get(link.product_id) ?? null,
          heroUseCount: heroUseCount.get(asset.id) ?? 0,
        });
        if (candidate) candidates.push(candidate);
      }

      const decision = selectArticleHero({
        contentId: article.id,
        title: article.title,
        contentType: article.type,
        incumbent,
        candidates,
      });
      resolved.set(article.id, decision.winner?.ref ?? null);
    }
    return resolved;
  } catch (e) {
    console.error("[query-error] resolveArticleHeroes threw", e);
    return stored;
  }
}

/**
 * The article detail page's lead image. Same selection as the cards, so a
 * reader who clicks a card sees the image the card showed them.
 */
export async function getResolvedArticleHero(article: ArticleHeroInput): Promise<HeroImage | null> {
  const supabase = await createClient();
  try {
    const { data: link, error: linkError } = await supabase
      .from("content_media")
      .select("media_id")
      .eq("content_id", article.id)
      .eq("role", "hero")
      .limit(1)
      .maybeSingle();
    if (linkError) logQueryError(`getResolvedArticleHero(${article.id}) link`, linkError);

    const incumbentByArticleId = new Map<string, HeroAssetRow>();
    if (link) {
      const { data: asset, error: assetError } = await supabase
        .from("media_assets")
        .select(HERO_ASSET_COLUMNS)
        .eq("id", link.media_id)
        .maybeSingle();
      if (assetError) logQueryError(`getResolvedArticleHero(${article.id}) asset`, assetError);
      if (asset) incumbentByArticleId.set(article.id, asset as unknown as HeroAssetRow);
    }

    const resolved = await resolveArticleHeroes(supabase, [article], incumbentByArticleId);
    return resolved.get(article.id) ?? null;
  } catch (e) {
    console.error(`[query-error] getResolvedArticleHero(${article.id}) threw`, e);
    return null;
  }
}

// Detail-page gallery: role='gallery' only (deliberately excludes 'hero' —
// the hero image is already shown separately/prominently by
// getPublishedHeroImage, so including it here would show it twice),
// ordered by sort_order. Carries caption/attribution so a required credit
// is never silently dropped on the page that actually needs it.
export async function getPublishedGallery(kind: "product" | "content", id: string): Promise<GalleryImage[]> {
  const supabase = await createClient();

  try {
    const linksResult =
      kind === "product"
        ? await supabase.from("product_media").select("media_id, sort_order").eq("product_id", id).eq("role", "gallery").order("sort_order")
        : await supabase.from("content_media").select("media_id, sort_order").eq("content_id", id).eq("role", "gallery").order("sort_order");
    logQueryError(`getPublishedGallery(${kind}, ${id}) links`, linksResult.error);
    const links = linksResult.data ?? [];
    if (links.length === 0) return [];

    const mediaIds = links.map((l) => l.media_id);
    const { data: assets, error: assetError } = await supabase
      .from("media_assets")
      .select(
        "id, alt_text, caption, attribution, attribution_required, creator, source_url, publication_status, storage_path, public_storage_path, license, asset_role, source_type, owned, ai_generated, width, height"
      )
      .in("id", mediaIds);
    logQueryError(`getPublishedGallery(${kind}, ${id}) assets`, assetError);

    const assetById = new Map((assets ?? []).map((a) => [a.id, a]));
    const images: GalleryImage[] = [];
    for (const link of links) {
      const asset = assetById.get(link.media_id);
      if (!asset || asset.publication_status !== "published" || !asset.public_storage_path) continue;
      images.push({
        url: mediaPublicUrl(asset.public_storage_path),
        alt: asset.alt_text,
        caption: asset.caption,
        attribution: asset.attribution,
        attributionRequired: asset.attribution_required,
        creator: asset.creator,
        sourceUrl: asset.source_url,
        license: asset.license,
        storagePath: asset.storage_path,
        assetRole: asset.asset_role,
        sourceType: asset.source_type,
        owned: asset.owned,
        aiGenerated: asset.ai_generated,
        width: asset.width,
        height: asset.height,
      });
    }
    return images;
  } catch (e) {
    console.error(`[query-error] getPublishedGallery(${kind}, ${id}) threw`, e);
    return [];
  }
}
