import "server-only";
import { createClient } from "@/lib/supabase/server";
import {
  rankPhotoRequests,
  type CurrentMediaState,
  type PhotoRequestInput,
  type PhotoRequestPriority,
} from "@/lib/media/photo-requests";
import { type OwnerAccess } from "@/lib/media/resolution";
import {
  orderForTriage,
  summariseAssessment,
  isOwnerAccess,
  type AssessmentTotals,
} from "@/lib/media/photography-triage";

// The shooting list and the access-triage screen, computed from the database on
// every load.
//
// ONE RANKING, NOT TWO
// --------------------
// The ordering comes from rankPhotoRequests() in src/lib/media/photo-requests.ts
// and nothing here reweights it. This file's only ordering contribution is
// orderForTriage(), which partitions the already-ranked list so unassessed rows
// come first — see the header of photography-triage.ts for why that is a
// partition and not a second ranking.
//
// EVERY QUERY CHECKS ITS OWN ERROR, BY NAME, AND THROWS
// ----------------------------------------------------
// `?? []` is banned here. This project rendered an honest-looking "nothing to
// do" for weeks while `anon` had no table grants at all, and scripts/
// photo-requests.ts carries the same warning for the same reason. A failed read
// of product_media would silently turn every product into "no image exists",
// which reads as a finding and is a fabrication. A throw reaches
// src/app/admin/(dashboard)/error.tsx and is visible.
//
// The classification of "what is the lead media" mirrors scripts/
// photo-requests.ts exactly, so the screen and the script cannot disagree about
// the same catalogue.

/** Media whose source_type marks it as a generated card rather than a photograph. */
const GENERATED_SOURCE_TYPE = "tc_graphic";

/** asset_role values that mean the image IS the data, and a photo would be a downgrade. */
const DATA_GRAPHIC_ROLES = new Set(["diagram", "chart", "comparison_graphic"]);

export const CURRENT_MEDIA_LABEL: Record<CurrentMediaState, string> = {
  none: "No image at all",
  generic_graphic: "Generated card",
  data_graphic: "Data graphic",
  licensed_third_party: "Licensed photo",
  owned_original: "Our own photo",
};

export type PhotographyItem = {
  productId: string;
  productName: string;
  productSlug: string;
  productPublished: boolean;
  ownerAccess: OwnerAccess;
  ownerAccessNote: string | null;
  ownerAccessSetAt: string | null;
  /** What the product page leads with today. */
  currentMedia: CurrentMediaState;
  /** Published pages a photograph would improve: the product page plus linked articles. */
  pagesAffected: number;
  articleTitles: string[];
  /**
   * Null when rankPhotoRequests() deliberately issued no request — the product
   * already has our own photograph, or leads with a data graphic that a photo
   * would make worse. Such a row is still shown (and still assessable), just
   * not as a shooting task.
   */
  priority: PhotoRequestPriority | null;
  reason: string | null;
  shotList: string[];
};

export type PhotographyOverview = {
  /** Request-backed rows, triage-ordered: unassessed first, ranking preserved within groups. */
  requests: PhotographyItem[];
  /** Products rankPhotoRequests() deliberately did not ask for. Assessable all the same. */
  notRequested: PhotographyItem[];
  totals: AssessmentTotals & {
    /** Products that produced a photo request. */
    requests: number;
    /** Of those, how many nobody has assessed — the size of the triage job. */
    unassessedRequests: number;
  };
};

export async function getPhotographyOverview(): Promise<PhotographyOverview> {
  const supabase = await createClient();

  const [productsRes, contentRes, contentProductsRes, productMediaRes, mediaRes] = await Promise.all([
    supabase
      .from("products")
      .select("id, name, slug, is_published, owner_access, owner_access_note, owner_access_set_at"),
    supabase.from("content_items").select("id, title, status"),
    supabase.from("content_products").select("content_id, product_id"),
    supabase.from("product_media").select("product_id, media_id, role"),
    supabase.from("media_assets").select("id, source_type, asset_role"),
  ]);

  // Named individually so a failure says WHICH read failed. "Something went
  // wrong" would send the reader to the wrong table.
  for (const [label, res] of [
    ["products", productsRes],
    ["content_items", contentRes],
    ["content_products", contentProductsRes],
    ["product_media", productMediaRes],
    ["media_assets", mediaRes],
  ] as const) {
    if (res.error) {
      throw new Error(`photography overview: reading ${label} failed — ${res.error.message}`);
    }
    if (res.data === null) {
      throw new Error(`photography overview: ${label} returned null rather than rows`);
    }
  }

  const products = productsRes.data!;
  const mediaById = new Map(mediaRes.data!.map((m) => [m.id, m]));

  const publishedTitles = new Map(
    contentRes.data!.filter((c) => c.status === "published").map((c) => [c.id, c.title])
  );

  const articlesByProduct = new Map<string, string[]>();
  for (const link of contentProductsRes.data!) {
    const title = publishedTitles.get(link.content_id);
    if (!title) continue;
    articlesByProduct.set(link.product_id, [...(articlesByProduct.get(link.product_id) ?? []), title]);
  }

  const heroesByProduct = new Map<string, string[]>();
  for (const pm of productMediaRes.data!) {
    if (pm.role !== "hero") continue;
    heroesByProduct.set(pm.product_id, [...(heroesByProduct.get(pm.product_id) ?? []), pm.media_id]);
  }

  const classified = products.map((product) => {
    const assets = (heroesByProduct.get(product.id) ?? [])
      .map((id) => mediaById.get(id))
      .filter((a): a is NonNullable<typeof a> => Boolean(a));

    const anyReal = assets.some((a) => a.source_type !== GENERATED_SOURCE_TYPE && a.source_type !== null);
    const owned = assets.some((a) => a.source_type === "staff_photograph");

    let currentMedia: CurrentMediaState = "none";
    if (owned) currentMedia = "owned_original";
    else if (assets.some((a) => DATA_GRAPHIC_ROLES.has(String(a.asset_role)))) currentMedia = "data_graphic";
    else if (anyReal) currentMedia = "licensed_third_party";
    else if (assets.length > 0) currentMedia = "generic_graphic";

    // The column is NOT NULL with a CHECK, so this guard should never fire —
    // but a value the app does not recognise must not be silently rewritten to
    // "unknown" in a way that looks like an assessment result. Falling back and
    // saying nothing is how a mismatch between the schema and this vocabulary
    // would stay invisible.
    const raw = product.owner_access;
    if (!isOwnerAccess(raw)) {
      throw new Error(
        `photography overview: product ${product.slug} has owner_access ${JSON.stringify(raw)}, ` +
          `which is not one of the five states this app knows. The schema and ` +
          `src/lib/media/resolution.ts have diverged.`
      );
    }

    const articleTitles = articlesByProduct.get(product.id) ?? [];

    return {
      product,
      ownerAccess: raw,
      currentMedia,
      articleTitles,
      input: {
        productId: product.id,
        productName: product.name,
        productSlug: product.slug,
        articleTitles,
        productPublished: product.is_published,
        currentMedia,
        hasRealPhotograph: anyReal,
        ownerAccess: raw,
      } satisfies PhotoRequestInput,
    };
  });

  const ranked = rankPhotoRequests(classified.map((c) => c.input));
  const rankedById = new Map(ranked.map((r) => [r.productId, r]));
  const byId = new Map(classified.map((c) => [c.product.id, c]));

  const toItem = (
    entry: (typeof classified)[number],
    request: (typeof ranked)[number] | undefined
  ): PhotographyItem => ({
    productId: entry.product.id,
    productName: entry.product.name,
    productSlug: entry.product.slug,
    productPublished: entry.product.is_published,
    ownerAccess: entry.ownerAccess,
    ownerAccessNote: entry.product.owner_access_note,
    ownerAccessSetAt: entry.product.owner_access_set_at,
    currentMedia: entry.currentMedia,
    pagesAffected:
      request?.pagesAffected ?? entry.articleTitles.length + (entry.product.is_published ? 1 : 0),
    articleTitles: entry.articleTitles,
    priority: request?.priority ?? null,
    reason: request?.reason ?? null,
    shotList: request?.shotList ?? [],
  });

  // orderForTriage partitions the ranking; it never reorders within a group.
  const requests = orderForTriage(ranked).map((r) => toItem(byId.get(r.productId)!, r));

  const notRequested = classified
    .filter((c) => !rankedById.has(c.product.id))
    .map((c) => toItem(c, undefined))
    .sort((a, b) => a.productName.localeCompare(b.productName));

  const totals = summariseAssessment(classified.map((c) => c.ownerAccess));

  return {
    requests,
    notRequested,
    totals: {
      ...totals,
      requests: requests.length,
      unassessedRequests: requests.filter((r) => r.ownerAccess === "unknown").length,
    },
  };
}
