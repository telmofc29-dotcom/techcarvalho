// What to photograph next, ranked by how much of the site it would improve.
//
// WHY THIS EXISTS
// ---------------
// There is no owned photography on this site at all — zero staff_photograph
// assets against 112 media rows. The gap is not going to close by acquisition:
// the eight remaining blocked products failed Commons search because suitable
// photography of them does not exist there, not because permission was refused.
// Somebody has to take the pictures.
//
// So this turns "the media library is thin" into a shooting list, ordered by
// what each photograph would actually fix.
//
// THE RANKING RULE
// ----------------
// Expected site value, which is close to: how many pages currently show
// something worse because this photograph does not exist. A product that four
// articles depend on outranks one that nothing links to, however visible its
// page. That is deliberately not the same as "most popular product" — the point
// is to spend a finite amount of the owner's time where it changes the most
// pages.
//
// A REQUEST MUST HAVE A DESTINATION
// ---------------------------------
// Nothing is requested to fill a queue. Every request names the pages that
// would use it and why the current media is inadequate, and a product whose
// existing photography is already fine produces no request at all. A dashboard
// that asks for work it cannot justify trains its reader to ignore it.
//
// Pure. No I/O.

import { isShootable, ACCESS_RANK, type OwnerAccess } from "./resolution.ts";

export type CurrentMediaState =
  /** No usable image at all. */
  | "none"
  /** A generated title card or category card. */
  | "generic_graphic"
  /** A diagram or chart. Often correct — see the note in rankPhotoRequests. */
  | "data_graphic"
  /** A real photograph, but licensed from a third party. */
  | "licensed_third_party"
  /** A real photograph we own. Nothing to request. */
  | "owned_original";

export type PhotoRequestInput = {
  productId: string;
  productName: string;
  productSlug: string;
  /** Published articles that link to this product. */
  articleTitles: string[];
  /** Whether the product's own page is published. */
  productPublished: boolean;
  /** What the product page currently leads with. */
  currentMedia: CurrentMediaState;
  /** True when the catalogue already holds a real photograph of this product. */
  hasRealPhotograph: boolean;
  /**
   * Whether the object can realistically be got at.
   *
   * Defaults to "unknown", which means NOBODY HAS ASSESSED IT — not "no". The
   * distinction is the whole point of this field: without it the list ranked a
   * £4,000 camera body nobody owns above a router on the owner's own desk,
   * purely because more articles linked to the camera. Site value and physical
   * feasibility are different questions and are now answered separately.
   */
  ownerAccess?: OwnerAccess;
};

export type PhotoRequestPriority = "high" | "medium" | "low";

export type PhotoRequest = {
  productId: string;
  productName: string;
  productSlug: string;
  priority: PhotoRequestPriority;
  /** How many published pages would be improved. Products page + articles. */
  pagesAffected: number;
  articleTitles: string[];
  /** The shots worth having, in the order they matter. */
  shotList: string[];
  /** Why this is being asked for, in words. */
  reason: string;
  /** How obtainable the object is. */
  ownerAccess: OwnerAccess;
  /**
   * False when the object cannot be got at. Such a request is still RETURNED —
   * the site's need for the image is real and does not go away — but it is
   * sorted below everything shootable and labelled, so the list never opens
   * with something nobody can do. The fix for these is a licensed image or an
   * illustration, not a camera; see resolveMediaStrategy.
   */
  shootable: boolean;
};

/**
 * The shots worth asking for.
 *
 * Generic on purpose. A per-category shot list ("EF mount", "battery
 * compartment") reads well in a brief but would need a taxonomy of body parts
 * per product type to be real, and a wrong shot list is worse than a general
 * one: it sends the owner to photograph something the articles never discuss.
 * The hero and the detail shot are what every product page and article
 * genuinely uses today.
 */
export const BASE_SHOT_LIST = [
  "Landscape hero — whole product, plain background, room to crop to 16:9",
  "Three-quarter view — gives the object depth on a card",
  "Detail — the controls, ports or mount the articles actually discuss",
] as const;

/** Below this many affected pages, a request is not worth the owner's time. */
export const MIN_PAGES_FOR_REQUEST = 1;

/**
 * Turn the catalogue into a ranked shooting list.
 *
 * Products that already hold a real photograph produce NO request unless it is
 * third-party licensed, where an owned original is a genuine upgrade — it
 * removes an attribution obligation and a dependency on someone else's licence
 * continuing to exist.
 *
 * A product currently showing a DATA GRAPHIC is not requested either. A chart
 * explaining what a spec means is frequently the right lead image, and asking
 * for a photograph to replace it would make the page worse — the same judgement
 * hierarchy.ts already encodes for hero selection.
 */
export function rankPhotoRequests(inputs: PhotoRequestInput[]): PhotoRequest[] {
  const requests: PhotoRequest[] = [];

  for (const input of inputs) {
    if (input.currentMedia === "owned_original") continue;
    if (input.currentMedia === "data_graphic") continue;

    const pagesAffected = input.articleTitles.length + (input.productPublished ? 1 : 0);
    if (pagesAffected < MIN_PAGES_FOR_REQUEST) continue;

    let reason: string;
    if (input.currentMedia === "none") {
      reason = "No usable image exists, so the page cannot show the product at all.";
    } else if (input.currentMedia === "generic_graphic") {
      reason = "Currently leads with a generated card rather than the product.";
    } else {
      reason =
        "Currently uses a third-party licensed photograph. An owned original removes the " +
        "attribution obligation and the dependency on someone else's licence.";
    }
    if (input.hasRealPhotograph && input.currentMedia === "generic_graphic") {
      reason +=
        " A real photograph is already held for this product, so check the media routing before shooting.";
    }

    // High when several pages depend on it; low when it is one unpublished
    // product nobody links to.
    const priority: PhotoRequestPriority =
      pagesAffected >= 3 ? "high" : pagesAffected === 2 ? "medium" : "low";

    const ownerAccess = input.ownerAccess ?? "unknown";
    const shootable = isShootable(ownerAccess);
    if (!shootable) {
      reason +=
        " The object is recorded as not obtainable, so this will not be fixed by a camera — " +
        "it needs a licensed photograph or an illustration instead.";
    }

    requests.push({
      productId: input.productId,
      productName: input.productName,
      productSlug: input.productSlug,
      priority,
      pagesAffected,
      articleTitles: input.articleTitles,
      shotList: [...BASE_SHOT_LIST],
      reason,
      ownerAccess,
      shootable,
    });
  }

  // Sort order, in precedence:
  //   1. Shootable before not — a backlog must never open with something
  //      nobody can act on.
  //   2. Most pages improved — the site-value question.
  //   3. Easiest access — a tie between two equally valuable shots goes to the
  //      one already on the desk.
  //   4. Name, so the list is stable between runs and a reader can find the
  //      same row twice.
  //
  // Access is the TIE-BREAKER and not the primary key on purpose: sorting by
  // convenience first would bury the photograph that fixes four pages beneath
  // one that fixes a single unpublished product.
  return requests.sort(
    (a, b) =>
      Number(b.shootable) - Number(a.shootable) ||
      b.pagesAffected - a.pagesAffected ||
      ACCESS_RANK[a.ownerAccess] - ACCESS_RANK[b.ownerAccess] ||
      a.productName.localeCompare(b.productName)
  );
}
