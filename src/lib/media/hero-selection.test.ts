import { test } from "node:test";
import assert from "node:assert/strict";
import {
  selectArticleHero,
  isEligibleHeroCandidate,
  productRelevance,
  titleNamesProduct,
  MIN_HERO_WIDTH,
  MIN_CARD_WIDTH,
  minimumWidthFor,
  SHARED_HERO_MIN_USES,
  type HeroCandidate,
  type ProductLinkRole,
} from "./hero-selection.ts";

// --- fixtures ---------------------------------------------------------------
// Modelled on real production rows: every product photograph in the catalogue
// is a Wikimedia Commons file with source_type 'public_domain_or_cc',
// asset_role 'product_photo' and rights_status 'verified'; every generated
// graphic is source_type 'tc_graphic' with a filename whose prefix says what it
// is (-hero- for a title card, -cmp-/-chart-/-timeline-/-spec_diagram- for a
// data graphic).

function titleCard(id: string, heroUseCount = 1): HeroCandidate<string> {
  return {
    ref: id,
    assetId: id,
    asset: {
      source_type: "tc_graphic",
      asset_role: "article_hero",
      owned: true,
      ai_generated: false,
      storage_path: `image/${id}-hero-smartphones.png`,
      source_url: null,
      license: null,
    },
    origin: "article",
    rightsStatus: "verified",
    publicationStatus: "published",
    hasPublicCopy: true,
    brandRole: null,
    width: 1600,
    height: 900,
    heroUseCount,
  };
}

function comparisonChart(id: string): HeroCandidate<string> {
  return {
    ...titleCard(id),
    asset: {
      source_type: "tc_graphic",
      asset_role: "comparison_graphic",
      owned: true,
      ai_generated: false,
      storage_path: `image/${id}-cmp-ps5-vs-ps5pro.png`,
      source_url: null,
      license: null,
    },
  };
}

function productPhoto(
  id: string,
  productName: string,
  linkRole: ProductLinkRole,
  overrides: Partial<HeroCandidate<string>> = {}
): HeroCandidate<string> {
  return {
    ref: id,
    assetId: id,
    asset: {
      source_type: "public_domain_or_cc",
      asset_role: "product_photo",
      owned: false,
      ai_generated: false,
      storage_path: `image/${id}-${productName.toLowerCase().replace(/\s+/g, "-")}.jpg`,
      source_url: "https://commons.wikimedia.org/wiki/File:Example.jpg",
      license: "CC BY-SA 4.0",
    },
    origin: "product",
    rightsStatus: "verified",
    publicationStatus: "published",
    hasPublicCopy: true,
    brandRole: null,
    width: 1600,
    height: 1067,
    linkRole,
    productName,
    heroUseCount: 0,
    ...overrides,
  };
}

// --- relevance --------------------------------------------------------------

test("a title names a product only when every token of its name is present", () => {
  assert.equal(titleNamesProduct("Canon Announces the EOS R6 V: What's Confirmed So Far", "Canon EOS R6"), true);
  assert.equal(titleNamesProduct("Canon EOS 70D vs 80D vs 90D: What Changed", "Canon EOS 60D"), false);
  // A brand token alone is not a claim that the page is about one body.
  assert.equal(titleNamesProduct("Best Used Canon DSLRs for Beginners", "Canon EOS 80D"), false);
  assert.equal(titleNamesProduct("anything", null), false);
});

test("relevance comes from the editorial link first, the title second", () => {
  assert.equal(productRelevance("primary_subject", "Sony PlayStation 5", "PS5 Storage Expansion"), "subject");
  assert.equal(productRelevance("mentioned", "Canon EOS R6", "Canon Announces the EOS R6 V"), "subject");
  assert.equal(productRelevance("compared_against", "Microsoft Xbox Series S", "Why Consoles Got Expensive"), "compared");
  assert.equal(productRelevance("mentioned", "Canon EOS R5", "Sensor Size Explained"), "incidental");
});

// --- rights and eligibility -------------------------------------------------

test("a restricted asset can never be surfaced, whatever else it has going for it", () => {
  const restricted = productPhoto("a1", "Sony PlayStation 5", "primary_subject", { rightsStatus: "restricted" });
  assert.equal(isEligibleHeroCandidate(restricted).eligible, false);

  const decision = selectArticleHero({
    contentId: "c1",
    title: "PS5 Storage Expansion Explained",
    contentType: "troubleshooting",
    incumbent: titleCard("t1", 4),
    candidates: [restricted],
  });
  assert.equal(decision.keptIncumbent, true);
  assert.equal(decision.winner?.assetId, "t1");
});

test("an unpublished asset, a missing public copy and a brand logo are all ineligible", () => {
  assert.equal(
    isEligibleHeroCandidate(productPhoto("a", "X", "primary_subject", { publicationStatus: "private" })).eligible,
    false
  );
  assert.equal(isEligibleHeroCandidate(productPhoto("b", "X", "primary_subject", { hasPublicCopy: false })).eligible, false);
  assert.equal(isEligibleHeroCandidate(productPhoto("c", "X", "primary_subject", { brandRole: "wordmark" })).eligible, false);
});

test("a photograph too small for the lead slot is left where it is", () => {
  const tiny = productPhoto("small", "Sony PlayStation 5", "primary_subject", { width: MIN_HERO_WIDTH - 1 });
  assert.equal(isEligibleHeroCandidate(tiny).eligible, false);
  // Unknown dimensions are NOT a disqualification — the frame contains rather
  // than crops them, and several published Commons rows have null width.
  assert.equal(isEligibleHeroCandidate(productPhoto("unk", "X", "primary_subject", { width: null })).eligible, true);
});

// --- KEEP THE DIAGRAM -------------------------------------------------------

test("a comparison chart leads a comparison page even when photographs are held", () => {
  const decision = selectArticleHero({
    contentId: "c-cmp",
    title: "PS5 vs. PS5 Pro: Is the $200+ Upgrade Actually Worth It?",
    contentType: "comparison",
    incumbent: comparisonChart("chart"),
    candidates: [productPhoto("ps5", "Sony PlayStation 5", "compared_against")],
  });
  assert.equal(decision.keptIncumbent, true);
  assert.equal(decision.winner?.assetId, "chart");
  assert.match(decision.reason, /comparison/i);
});

test("a diagram leads an explainer even when the article links a photographed product", () => {
  // "How Much Power Supply Do You Actually Need for an RTX 5090 Build?" — the
  // wattage chart IS the article. A photograph of the card is not an upgrade,
  // and the product is linked as the primary subject, so this is the case a
  // naive "prefer a photograph" rule gets wrong.
  const decision = selectArticleHero({
    contentId: "c-psu",
    title: "How Much Power Supply Do You Actually Need for an RTX 5090 Build?",
    contentType: "guide",
    incumbent: comparisonChart("psu-chart"),
    candidates: [productPhoto("rtx", "NVIDIA GeForce RTX 5090", "primary_subject")],
  });
  assert.equal(decision.keptIncumbent, true);
  assert.equal(decision.winner?.assetId, "psu-chart");
});

test("a release-date timeline is not displaced by a console mentioned in passing", () => {
  // "Call of Duty: Modern Warfare 4: What's Actually Confirmed" is judged
  // `named_media`, so evaluateHero DOES want its timeline replaced — but the
  // only thing held is a PlayStation, which is not what the page is about.
  const decision = selectArticleHero({
    contentId: "c-cod",
    title: "Call of Duty: Modern Warfare 4: What's Actually Confirmed",
    contentType: "news",
    incumbent: comparisonChart("mw4-timeline"),
    candidates: [productPhoto("ps5", "Sony PlayStation 5", "mentioned")],
  });
  assert.equal(decision.keptIncumbent, true);
  assert.equal(decision.winner?.assetId, "mw4-timeline");
});

test("a title card written for this article survives a merely-mentioned product", () => {
  const decision = selectArticleHero({
    contentId: "c-sensor",
    title: "Sensor Size Explained: Crop vs Full-Frame, What It Actually Changes",
    contentType: "guide",
    incumbent: titleCard("bespoke", 1),
    candidates: [productPhoto("r5", "Canon EOS R5", "mentioned")],
  });
  assert.equal(decision.keptIncumbent, true);
  assert.match(decision.reason, /title card/i);
});

// --- ROUTING THE PHOTOGRAPH IN ----------------------------------------------

test("a card shared by several articles yields to any product the article links", () => {
  const decision = selectArticleHero({
    contentId: "c-phones",
    title: "Which 2026 Flagship Phone Should You Actually Buy? A Use-Case Guide",
    contentType: "guide",
    incumbent: titleCard("smartphones-card", 4),
    candidates: [
      productPhoto("iphone", "Apple iPhone 17 Pro", "mentioned"),
      productPhoto("galaxy", "Samsung Galaxy S26 Ultra", "mentioned"),
      productPhoto("pixel", "Google Pixel 10 Pro", "mentioned"),
    ],
  });
  assert.equal(decision.keptIncumbent, false);
  assert.equal(decision.incumbentShared, true);
  assert.equal(decision.winnerTier, "real_subject");
});

test("a bespoke card yields to a product the title actually names", () => {
  const decision = selectArticleHero({
    contentId: "c-r6v",
    title: "Canon Announces the EOS R6 V: What's Confirmed So Far",
    contentType: "news",
    incumbent: titleCard("r6v-card", 1),
    candidates: [
      productPhoto("r5", "Canon EOS R5", "compared_against"),
      productPhoto("r6", "Canon EOS R6", "mentioned"),
    ],
  });
  assert.equal(decision.keptIncumbent, false);
  assert.equal(decision.winner?.assetId, "r6", "the named body, not the one merely compared against");
});

test("a page with no hero at all takes the best thing held", () => {
  const decision = selectArticleHero({
    contentId: "c-none",
    title: "Anything",
    contentType: "guide",
    incumbent: null,
    candidates: [productPhoto("p", "Sony PlayStation 5", "mentioned")],
  });
  assert.equal(decision.incumbentTier, "missing");
  assert.equal(decision.winner?.assetId, "p");
});

test("nothing held means the existing graphic stays — a failed upgrade costs nothing", () => {
  const decision = selectArticleHero({
    contentId: "c-empty",
    title: "Smart Home Starter Guide: Where to Actually Begin",
    contentType: "guide",
    incumbent: titleCard("smart-home-card", 3),
    candidates: [],
  });
  assert.equal(decision.keptIncumbent, true);
  assert.equal(decision.winner?.assetId, "smart-home-card");
  assert.equal(decision.incumbentShared, true);
});

// --- ranking ----------------------------------------------------------------

test("the product the page is ABOUT outranks one it merely compares", () => {
  const decision = selectArticleHero({
    contentId: "c-rank",
    title: "Some Article",
    contentType: "guide",
    incumbent: titleCard("card", 3),
    candidates: [
      productPhoto("compared", "Microsoft Xbox Series S", "compared_against"),
      productPhoto("subject", "Sony PlayStation 5", "primary_subject"),
    ],
  });
  assert.equal(decision.winner?.assetId, "subject");
});

test("an image already leading another article loses to an unused one", () => {
  const decision = selectArticleHero({
    contentId: "c-dup",
    title: "Some Article",
    contentType: "guide",
    incumbent: titleCard("card", 3),
    candidates: [
      productPhoto("used", "Apple iPhone 17 Pro", "mentioned", { heroUseCount: 1 }),
      productPhoto("unused", "Google Pixel 10 Pro", "mentioned", { heroUseCount: 0 }),
    ],
  });
  assert.equal(decision.winner?.assetId, "unused");
});

test("articles with an identical candidate pool do not all pick the same photograph", () => {
  const pool = [
    productPhoto("iphone", "Apple iPhone 17 Pro", "mentioned"),
    productPhoto("galaxy", "Samsung Galaxy S26 Ultra", "mentioned"),
    productPhoto("pixel", "Google Pixel 10 Pro", "mentioned"),
  ];
  const picks = new Set(
    ["a1b2", "c3d4", "e5f6", "07a8", "9bc0", "def1"].map(
      (id) =>
        selectArticleHero({
          contentId: id,
          title: "Phones",
          contentType: "guide",
          incumbent: titleCard("smartphones-card", 4),
          candidates: pool,
        }).winner?.assetId
    )
  );
  assert.ok(picks.size > 1, "the tie-break must spread the pool, not converge on one asset");
});

test("selection is stable — the same article always resolves to the same image", () => {
  const call = () =>
    selectArticleHero({
      contentId: "stable-id",
      title: "Phones",
      contentType: "guide",
      incumbent: titleCard("smartphones-card", SHARED_HERO_MIN_USES),
      candidates: [
        productPhoto("iphone", "Apple iPhone 17 Pro", "mentioned"),
        productPhoto("pixel", "Google Pixel 10 Pro", "mentioned"),
      ],
    }).winner?.assetId;
  // A card and its article page run this independently; if it were not stable
  // the two would show different images for the same piece.
  assert.equal(call(), call());
});

test("a graphic is never swapped for another graphic of the same or worse tier", () => {
  const decision = selectArticleHero({
    contentId: "c-graphic",
    title: "Some Article",
    contentType: "guide",
    incumbent: titleCard("card", 4),
    candidates: [{ ...titleCard("other-card", 0), origin: "product", linkRole: "primary_subject", productName: "X" }],
  });
  assert.equal(decision.keptIncumbent, true);
});

// ---------------------------------------------------------------------------
// Slot-aware minimum width — the homepage placeholder bug
// ---------------------------------------------------------------------------
//
// A 512x512 router image was assigned as BOTH Hero and Thumbnail on a published
// article. The article page rendered it; the homepage card rendered a
// placeholder. MIN_HERO_WIDTH (720) was being applied to a card, and its own
// rejection reason says what it is for: "a 720px LEAD SLOT would upscale it."

test("a 512px asset is rejected for a lead slot but fine for a card", () => {
  const candidate = {
    ref: "x",
    assetId: "a1",
    asset: { source_type: "tc_graphic", asset_role: null, owned: true, ai_generated: true,
             storage_path: "image/router-2.png", source_url: null, license: null },
    origin: "article" as const,
    rightsStatus: "verified",
    publicationStatus: "published",
    hasPublicCopy: true,
    brandRole: null,
    width: 512,
    height: 512,
  };
  assert.equal(isEligibleHeroCandidate(candidate).eligible, false, "lead slot must still refuse it");
  assert.equal(isEligibleHeroCandidate(candidate, "lead").eligible, false);
  assert.equal(isEligibleHeroCandidate(candidate, "card").eligible, true, "a card is not a lead slot");
});

test("the default slot is lead, so existing behaviour is unchanged", () => {
  assert.equal(minimumWidthFor("lead"), MIN_HERO_WIDTH);
  assert.equal(minimumWidthFor("card"), MIN_CARD_WIDTH);
  assert.ok(MIN_CARD_WIDTH < MIN_HERO_WIDTH);
});

test("a favicon-sized asset is refused even for a card", () => {
  const tiny = {
    ref: "x", assetId: "a2",
    asset: { source_type: "tc_graphic", asset_role: null, owned: true, ai_generated: false,
             storage_path: "image/icon.png", source_url: null, license: null },
    origin: "article" as const, rightsStatus: "verified", publicationStatus: "published",
    hasPublicCopy: true, brandRole: null, width: 64, height: 64,
  };
  assert.equal(isEligibleHeroCandidate(tiny, "card").eligible, false);
});

test("SAFETY rejections apply to every slot, not just the lead", () => {
  // Loosening the width rule must not loosen anything that protects rights or
  // privacy. These four must refuse a card exactly as they refuse a lead.
  const base = {
    ref: "x", assetId: "a3",
    asset: { source_type: "tc_graphic", asset_role: null, owned: true, ai_generated: false,
             storage_path: "image/x.png", source_url: null, license: null },
    origin: "article" as const, rightsStatus: "verified", publicationStatus: "published",
    hasPublicCopy: true, brandRole: null, width: 1600, height: 900,
  };
  assert.equal(isEligibleHeroCandidate({ ...base, rightsStatus: "restricted" }, "card").eligible, false);
  assert.equal(isEligibleHeroCandidate({ ...base, publicationStatus: "private" }, "card").eligible, false);
  assert.equal(isEligibleHeroCandidate({ ...base, hasPublicCopy: false }, "card").eligible, false);
  assert.equal(isEligibleHeroCandidate({ ...base, brandRole: "logo_full" }, "card").eligible, false);
});

test("a human-assigned image survives when nothing beats it", () => {
  // selectArticleHero returning no winner must not mean "show a placeholder".
  // The caller falls back to the stored assignment; this pins the shape that
  // makes that correct -- an ineligible incumbent yields no winner, so the
  // fallback is the ONLY thing standing between a valid assignment and a
  // placeholder.
  const incumbent = {
    ref: "stored-image",
    assetId: "a4",
    asset: { source_type: "tc_graphic", asset_role: null, owned: true, ai_generated: true,
             storage_path: "image/router-2.png", source_url: null, license: null },
    origin: "article" as const, rightsStatus: "verified", publicationStatus: "published",
    hasPublicCopy: true, brandRole: null, width: 512, height: 512,
  };
  const leadDecision = selectArticleHero({
    contentId: "c1", title: "Wi-Fi 4 to Wi-Fi 7", contentType: "guide",
    incumbent, candidates: [], slot: "lead",
  });
  assert.equal(leadDecision.winner, null, "too narrow for a lead slot");

  const cardDecision = selectArticleHero({
    contentId: "c1", title: "Wi-Fi 4 to Wi-Fi 7", contentType: "guide",
    incumbent, candidates: [], slot: "card",
  });
  assert.equal(cardDecision.winner?.ref, "stored-image", "a card must accept it outright");
});
