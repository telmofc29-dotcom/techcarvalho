// Which held image should LEAD an article — the selection step that never
// existed.
//
// THE DEFECT THIS FIXES
// ---------------------
// `getPublishedHeroImage("content", id)` read exactly one row: the
// `content_media` link with role='hero'. That is a lookup, not a selection.
// Whatever an import batch happened to attach became the lead image forever,
// and the catalogue photography sitting one join away — `content_products` ->
// `products` -> `product_media` -> `media_assets` — was never a candidate for
// an article at all.
//
// Measured against production on 2026-08-23: all 36 published products lead
// with a real Wikimedia photograph, every one of them `rights_status =
// 'verified'` and already published to the public bucket. 46 published
// articles link to one of those products. Yet only 12 articles led with a real
// photograph, because the other 34 were never given the chance: their hero
// link pointed at a generated graphic and nothing ever looked further.
//
// WHAT THIS IS NOT
// ----------------
// It is NOT "prefer a photograph". src/lib/media/hierarchy.ts already encodes
// the judgement that matters — a comparison chart is RIGHT on a comparison
// page and WRONG on a page about something a reader expects to see — and this
// module defers to it. On production data that means 13 comparison articles
// keep their `cmp-*` chart, every explainer keeps its diagram or timeline, and
// a Call of Duty release-date timeline is not replaced by a photograph of a
// PlayStation just because one is available.
//
// Nothing here grants, infers or upgrades rights. Candidates arrive already
// filtered to published assets and are re-checked here; a `restricted` asset
// can never win, and no rights_status is ever raised.

import {
  classifyMediaTier,
  evaluateHero,
  inferSubjectKind,
  tierRank,
  type ClassifiableAsset,
  type MediaTier,
  type SubjectKind,
} from "./hierarchy.ts";

/** How an article's `content_products` row describes the link. */
export type ProductLinkRole = "primary_subject" | "compared_against" | "mentioned";

/**
 * A hero candidate, with everything the decision needs attached.
 *
 * `ref` is an opaque payload handed straight back to the caller, so the public
 * layer can carry its own `HeroImage` through without this module knowing
 * anything about URLs, storage buckets or React.
 */
export type HeroCandidate<TRef = unknown> = {
  ref: TRef;
  assetId: string;
  /** The columns classifyMediaTier() reads. */
  asset: ClassifiableAsset;
  /** 'article' = the existing content_media hero. 'product' = catalogue media. */
  origin: "article" | "product";
  // --- rights / publication state, re-checked here rather than trusted ------
  rightsStatus?: string | null;
  publicationStatus?: string | null;
  /** Whether a copy exists in the public bucket. Without one there is no URL. */
  hasPublicCopy?: boolean;
  /** Non-null marks a site-brand asset (logo/wordmark). Never a hero. */
  brandRole?: string | null;
  width?: number | null;
  height?: number | null;
  // --- relevance inputs (product-origin candidates) ------------------------
  linkRole?: ProductLinkRole | null;
  productName?: string | null;
  /**
   * How many published articles already LEAD with this asset. Feeds the
   * duplicate-use tie-break, and marks a shared category card as a card that
   * cannot be about any one article.
   */
  heroUseCount?: number;
};

/**
 * The narrowest a lead image may be and still be worth promoting.
 *
 * The article column renders the lead at 720 CSS px. Below that the browser is
 * upscaling, and an upscaled photograph is not an improvement on a crisply
 * rendered graphic — so a small asset is left where it is rather than promoted
 * into a slot it cannot fill. Unknown dimensions are not a disqualification:
 * five published rows have null width/height and LeadMediaFrame already handles
 * them by containing rather than cropping.
 */
export const MIN_HERO_WIDTH = 720;

/**
 * The same rule for a CARD, which is a much smaller frame.
 *
 * MIN_HERO_WIDTH exists because a lead slot renders roughly 720px wide and
 * upscaling looks bad there. Its own rejection reason says so: "a 720px lead
 * slot would upscale it." A card is a fraction of that, so applying the lead
 * figure to cards rejected images that render perfectly well in them — and,
 * because rejection produced null rather than a fallback, replaced a human's
 * explicit assignment with a placeholder.
 *
 * Live example: a 512x512 router image assigned as both Hero and Thumbnail
 * showed on the article page and as a placeholder on the homepage card.
 *
 * This floor still exists so a favicon-sized asset cannot become a card image.
 */
export const MIN_CARD_WIDTH = 240;

/**
 * Which frame the candidate is being judged for.
 *
 * Defaults to "lead" everywhere, so this parameter changes no existing
 * behaviour unless a caller asks for card rules.
 */
export type HeroSlotKind = "lead" | "card";

export function minimumWidthFor(slot: HeroSlotKind): number {
  return slot === "card" ? MIN_CARD_WIDTH : MIN_HERO_WIDTH;
}

/**
 * The point at which a lead image stops being about the article it leads.
 *
 * Two published articles sharing one hero is already a reader-visible defect:
 * on production, six generated category cards lead 18 articles between them,
 * and three separate smartphone articles open with the identical card reading
 * "Smartphones". `evaluateHero` blesses a title card on a conceptual piece —
 * correctly, in isolation — but it judges one page at a time and so cannot see
 * that this particular card is a category label wearing an article's slot.
 */
export const SHARED_HERO_MIN_USES = 2;

export type CandidateRelevance =
  /** The page is about this product: linked as its subject, or named in the title. */
  | "subject"
  /** The page weighs this product against others. */
  | "compared"
  /** The product is mentioned in passing. */
  | "incidental";

const RELEVANCE_RANK: Record<CandidateRelevance, number> = {
  subject: 1,
  compared: 2,
  incidental: 3,
};

export function relevanceRank(relevance: CandidateRelevance): number {
  return RELEVANCE_RANK[relevance];
}

/** Lowercase alphanumeric tokens. "Canon EOS R6" -> ["canon","eos","r6"]. */
function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
}

/**
 * Whether the article's title actually names this product.
 *
 * Token containment, not substring: "Canon Announces the EOS R6 V" names the
 * Canon EOS R6 even though the words are not contiguous, while "Canon EOS 70D
 * vs 80D vs 90D" does not name the Canon EOS 60D. Deliberately requires EVERY
 * token of the product name, so the model number always has to be present — a
 * brand token alone ("Canon") is not a claim that the page is about one body.
 */
export function titleNamesProduct(title: string, productName: string | null | undefined): boolean {
  if (!productName) return false;
  const nameTokens = tokenize(productName);
  if (nameTokens.length === 0) return false;
  const titleTokens = new Set(tokenize(title));
  return nameTokens.every((t) => titleTokens.has(t));
}

export function productRelevance(
  linkRole: ProductLinkRole | null | undefined,
  productName: string | null | undefined,
  articleTitle: string
): CandidateRelevance {
  if (linkRole === "primary_subject") return "subject";
  if (titleNamesProduct(articleTitle, productName)) return "subject";
  if (linkRole === "compared_against") return "compared";
  return "incidental";
}

export type EligibilityVerdict = { eligible: true } | { eligible: false; reason: string };

/**
 * Whether a candidate may be surfaced at all.
 *
 * This is a re-check, not the enforcement point: publication already ran
 * through evaluatePublishEligibility() in the Server Action, and the queries
 * that build these candidates already filter on publication_status. Re-checking
 * costs nothing and means a future caller assembling candidates some other way
 * still cannot route a restricted asset onto a page.
 */
export function isEligibleHeroCandidate(
  candidate: HeroCandidate,
  slot: HeroSlotKind = "lead"
): EligibilityVerdict {
  if (candidate.rightsStatus === "restricted") {
    return { eligible: false, reason: "Asset is marked restricted." };
  }
  if (candidate.publicationStatus !== undefined && candidate.publicationStatus !== "published") {
    return { eligible: false, reason: "Asset is not published." };
  }
  if (candidate.hasPublicCopy === false) {
    return { eligible: false, reason: "Asset has no public copy to link to." };
  }
  if (candidate.brandRole) {
    return { eligible: false, reason: "Site-brand asset (logo/wordmark), not editorial imagery." };
  }
  // SAFETY rejections are above and apply to every slot. This one is about
  // RESOLUTION, so it scales with the frame being filled.
  const minWidth = minimumWidthFor(slot);
  if (typeof candidate.width === "number" && candidate.width > 0 && candidate.width < minWidth) {
    return {
      eligible: false,
      reason: `Only ${candidate.width}px wide; a ${minWidth}px ${slot} slot would upscale it.`,
    };
  }
  return { eligible: true };
}

export type HeroDecision<TRef = unknown> = {
  /** The candidate that should lead the page. Null when nothing is showable. */
  winner: HeroCandidate<TRef> | null;
  /** True when the article keeps the hero it already had. */
  keptIncumbent: boolean;
  incumbentTier: MediaTier;
  winnerTier: MediaTier;
  subject: SubjectKind;
  /** Whether the incumbent is a lead image shared with other published articles. */
  incumbentShared: boolean;
  /** Plain-language record of why, for audits and for the admin surfaces. */
  reason: string;
};

/**
 * Deterministic 32-bit FNV-1a. Used only to rotate between candidates that
 * scored IDENTICALLY, so that four smartphone articles drawing on the same
 * three flagship photographs do not all pick the first one. Stable across
 * server and client and across deploys, because the same id always hashes the
 * same way — a card and its article page therefore never disagree.
 */
function stableHash(value: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * Pick the image that should lead an article.
 *
 * The order of the checks is the whole argument:
 *
 *  1. An incumbent that `evaluateHero` calls acceptable AND not worth replacing
 *     is KEPT — this is where every comparison chart on a comparison page and
 *     every diagram on an explainer survives, and it is checked before any
 *     photograph is even scored.
 *  2. Unless it is a SHARED card, which by construction is about a category
 *     rather than this article.
 *  3. A replacement has to be a strictly better tier, itself acceptable for
 *     this kind of page, and RELEVANT — a product mentioned in passing does not
 *     displace a title card written for this specific article, though it does
 *     displace a category card that says nothing about it.
 */
export function selectArticleHero<TRef>(input: {
  contentId: string;
  title: string;
  contentType: string | null;
  /** The current content_media role='hero' asset, if any. */
  incumbent: HeroCandidate<TRef> | null;
  /** Catalogue media reachable through this article's content_products links. */
  candidates: HeroCandidate<TRef>[];
  /** Which frame this is being chosen for. Defaults to the lead slot. */
  slot?: HeroSlotKind;
}): HeroDecision<TRef> {
  const slot: HeroSlotKind = input.slot ?? "lead";
  const subject = inferSubjectKind({ contentType: input.contentType, title: input.title });

  const incumbent =
    input.incumbent && isEligibleHeroCandidate(input.incumbent, slot).eligible ? input.incumbent : null;
  const incumbentTier = classifyMediaTier(incumbent?.asset);
  const incumbentShared =
    incumbent !== null &&
    incumbentTier === "generic_graphic" &&
    (incumbent.heroUseCount ?? 0) >= SHARED_HERO_MIN_USES;

  const base = {
    incumbentTier,
    subject,
    incumbentShared,
  };
  const keep = (reason: string): HeroDecision<TRef> => ({
    ...base,
    winner: incumbent,
    keptIncumbent: true,
    winnerTier: incumbentTier,
    reason,
  });

  const verdict = evaluateHero(incumbentTier, subject);
  // A title card is the one tier hierarchy.ts says is "never the best available
  // answer — but on a conceptual piece there may be no better one". So it is
  // kept only when there IS no better one, which cannot be known before the
  // candidates have been scored. Every other tier can short-circuit here; a
  // title card has to earn its slot against whatever else is held.
  const incumbentIsTitleCard = incumbent !== null && incumbentTier === "generic_graphic";

  if (incumbent && verdict.acceptable && !verdict.shouldReplace && !incumbentShared && !incumbentIsTitleCard) {
    return keep(verdict.reason);
  }

  // How strong a claim a candidate needs on this page.
  //
  //  * Nothing held, or a SHARED card: any linked product says more than what
  //    is there. A card carrying a category name is not about this article, and
  //    a product the editors linked at all is.
  //  * A card written for THIS article does at least state the article's own
  //    subject, so displacing it takes a product the page is genuinely about —
  //    linked as its subject, or named in its title. A camera mentioned once in
  //    an explainer about sensor sizes does not qualify, and should not: the
  //    right lead there is a diagram nobody has drawn yet.
  //  * Anything else reaching this point was flagged by evaluateHero as a
  //    substitute for showing a thing readers expect to SEE. That verdict is
  //    itself evidence about the page, so a compared-against product is enough.
  const minimumRelevance: CandidateRelevance =
    incumbent === null || incumbentShared ? "incidental" : incumbentIsTitleCard ? "subject" : "compared";

  const scored = input.candidates
    .flatMap((candidate) => {
      if (!isEligibleHeroCandidate(candidate, slot).eligible) return [];
      const tier = classifyMediaTier(candidate.asset);
      // Never sideways or downhill: the hierarchy's whole point is that the
      // replacement answers "what does this thing look like?" better.
      if (incumbent && tierRank(tier) >= tierRank(incumbentTier)) return [];
      // A replacement has to be defensible in its own right on this page.
      if (!evaluateHero(tier, subject).acceptable) return [];
      const relevance = productRelevance(candidate.linkRole, candidate.productName, input.title);
      if (relevanceRank(relevance) > relevanceRank(minimumRelevance)) return [];
      return [{ candidate, tier, relevance }];
    })
    .sort(
      (a, b) =>
        tierRank(a.tier) - tierRank(b.tier) ||
        relevanceRank(a.relevance) - relevanceRank(b.relevance) ||
        // Duplicate use: an image that already leads another article is the
        // last one to pick, so the library spreads rather than converging.
        (a.candidate.heroUseCount ?? 0) - (b.candidate.heroUseCount ?? 0) ||
        a.candidate.assetId.localeCompare(b.candidate.assetId)
    );

  if (scored.length === 0) {
    if (!incumbent) {
      return { ...base, winner: null, keptIncumbent: true, winnerTier: "missing", reason: "No showable media at all." };
    }
    return keep(
      incumbentShared
        ? "Lead image is shared with other articles, but no relevant photography is held for this one."
        : incumbentIsTitleCard
          ? "A title card written for this article. Nothing held is both better and relevant enough to displace it."
          : `${verdict.reason} No better image is held.`
    );
  }

  // Break ties between candidates with an EQUAL claim to the slot — same tier,
  // same relevance, equally unused. Without this, four smartphone articles
  // drawing on the same three flagship photographs would every one of them pick
  // whichever sorted first, and the shared-category-card problem would come
  // back wearing a photograph. Pairing the article id WITH the asset id
  // (rendezvous-style) rather than taking `hash(article) % n` decorrelates the
  // choice from the candidate count and from the sort order.
  const best = scored[0];
  const tied = scored.filter(
    (s) =>
      tierRank(s.tier) === tierRank(best.tier) &&
      relevanceRank(s.relevance) === relevanceRank(best.relevance) &&
      (s.candidate.heroUseCount ?? 0) === (best.candidate.heroUseCount ?? 0)
  );
  const picked = tied.reduce((a, b) =>
    stableHash(`${input.contentId}:${b.candidate.assetId}`) > stableHash(`${input.contentId}:${a.candidate.assetId}`) ? b : a
  );

  return {
    ...base,
    winner: picked.candidate,
    keptIncumbent: false,
    winnerTier: picked.tier,
    reason: `${
      incumbentShared
        ? `Lead image was a graphic shared by ${incumbent?.heroUseCount ?? 0} published articles.`
        : incumbentIsTitleCard
          ? "Lead image was a title card."
          : verdict.reason
    } Replaced with held ${picked.tier} imagery of ${picked.candidate.productName ?? "a linked product"} (${picked.relevance}).`,
  };
}
