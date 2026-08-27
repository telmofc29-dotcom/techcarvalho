import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { assessUpgrade, describeUpgrade, type SlotOccupant } from "./upgrade-policy.ts";
import { scoreMatch, deriveIsModelSpecific, type MatchAsset, type MatchTarget } from "./match-engine.ts";
import { buildEntityVocabulary } from "./entity-vocabulary.ts";
import type { MediaSelectionKind } from "@/lib/types/database";

const VOCAB = buildEntityVocabulary({
  manufacturers: ["NVIDIA", "Canon"],
  productNames: ["NVIDIA GeForce RTX 5090", "Canon EOS R5"],
  categorySlugs: ["computing", "cameras-photography"],
  tagNames: ["GPU", "Camera"],
});

const asset = (over: Partial<MatchAsset> = {}): MatchAsset => ({
  id: "x",
  storagePath: "uuid-nvidia-geforce-rtx-5090.jpg",
  altText: "NVIDIA GeForce RTX 5090 graphics card",
  caption: null,
  sourceType: "manufacturer",
  assetRole: "product_photo",
  brandRole: null,
  owned: false,
  aiGenerated: false,
  publicationStatus: "published",
  rightsStatus: "verified",
  width: 1600,
  height: 900,
  verifiedProducts: [],
  ...over,
});

const TARGET: MatchTarget = {
  id: "t",
  kind: "content",
  title: "NVIDIA GeForce RTX 5090 review",
  manufacturerName: "NVIDIA",
  categorySlug: "computing",
  isModelSpecific: deriveIsModelSpecific("NVIDIA GeForce RTX 5090 review"),
  occupiedSlots: [],
};

const occupant = (a: MatchAsset, kind: MediaSelectionKind | null, role: "hero" | "thumbnail" | "gallery" = "hero"): SlotOccupant => ({
  role,
  selectionKind: kind,
  asset: a,
  match: scoreMatch(a, TARGET, { entityVocabulary: VOCAB }),
});

const upgrade = (current: MatchAsset, kind: MediaSelectionKind | null, proposed: MatchAsset, role: "hero" | "thumbnail" | "gallery" = "hero") =>
  assessUpgrade(occupant(current, kind, role), proposed, scoreMatch(proposed, { ...TARGET, occupiedSlots: [] }, { entityVocabulary: VOCAB }));

// A GENERATED TITLE CARD THAT NAMES THE PRODUCT — the thing 71 of 81 published
// articles currently lead with.
//
// It names the exact model, which is why the matcher offers it at all; it is
// still a diagram rather than a picture of the card. A card that named only
// "NVIDIA" would be refused outright by the SKU rule and could never have become
// an occupant, so using one here would have tested a situation that cannot
// arise. Checked against the real matcher before writing these.
const GENERIC = asset({
  id: "generic",
  storagePath: "uuid-nvidia-geforce-rtx-5090-explained.png",
  altText: "What the NVIDIA GeForce RTX 5090 changes",
  sourceType: "tc_graphic",
  assetRole: "diagram",
  width: 800,
  height: 800,
});

// Graphics cannot lead, so an engine-selected graphic lives in a gallery slot.
const GALLERY = "gallery" as const;

describe("human and unknown selections are never replaced", () => {
  test("a human hero is kept, however much better the candidate is", () => {
    const v = upgrade(GENERIC, "human", asset({ id: "great" }), GALLERY);
    assert.equal(v.decision, "keep");
    assert.match(v.refusals.join(" "), /a person chose the current image/);
  });

  // 179 links predate provenance. Treating unknown as free would licence
  // replacing every image the owner picked before 2026-08-27.
  test("an unknown selection is kept, exactly like a human one", () => {
    const v = upgrade(GENERIC, "unknown", asset({ id: "great" }), GALLERY);
    assert.equal(v.decision, "keep");
    assert.match(v.refusals.join(" "), /predates provenance/);
  });

  test("a null selection is kept", () => {
    assert.equal(upgrade(GENERIC, null, asset({ id: "great" }), GALLERY).decision, "keep");
  });
});

describe("a real upgrade of an ENGINE selection is taken", () => {
  test("a verified photograph replaces a generic generated card", () => {
    // No verifiedProducts here: this target is an ARTICLE, so it carries no
    // productId, and an asset recorded against a product is correctly refused
    // for it by verifiedVerdict. Learned by the assertion failing, which is the
    // identity protection working rather than a fixture that needed forcing.
    const better = asset({ id: "photo" });
    const v = upgrade(GENERIC, "engine", better, GALLERY);
    assert.equal(v.decision, "replace", v.refusals.join(" | "));
    assert.match(describeUpgrade(v), /explains rather than depicts/);
  });

  test("the reason names the improvement in words, not a score", () => {
    const better = asset({ id: "photo" });
    const v = upgrade(GENERIC, "engine", better, GALLERY);
    assert.equal(v.decision, "replace");
    assert.ok(!describeUpgrade(v).includes("score"), describeUpgrade(v));
  });
});

describe("churn is refused", () => {
  test("two comparable photographs are not an upgrade", () => {
    const current = asset({ id: "a" });
    const other = asset({ id: "b", storagePath: "uuid-nvidia-geforce-rtx-5090-2.jpg" });
    const v = upgrade(current, "engine", other);
    assert.equal(v.decision, "keep");
    assert.match(v.refusals.join(" "), /no improvement in kind|Two comparable images/);
  });

  test("NEWER IS NOT BETTER — nothing here reads a timestamp", () => {
    // Identical in every respect the policy can see. If recency leaked in, this
    // would flip to replace.
    const v = upgrade(asset({ id: "old" }), "engine", asset({ id: "new" }));
    assert.equal(v.decision, "keep");
  });

  test("a LESS specific image is never an upgrade", () => {
    const exact = asset({ id: "exact" });
    const vague = asset({ id: "vague", storagePath: "uuid-nvidia-cards.jpg", altText: "NVIDIA graphics cards" });
    const v = upgrade(exact, "engine", vague);
    assert.equal(v.decision, "keep");
  });

  test("a graphic never replaces a photograph", () => {
    const v = upgrade(asset({ id: "photo" }), "engine", GENERIC, GALLERY);
    assert.equal(v.decision, "keep");
    assert.match(v.refusals.join(" "), /depicts a real object/);
  });

  test("size alone does not justify a replacement", () => {
    // Same nature, same specificity, only bigger. One non-decisive improvement.
    const small = asset({ id: "small", width: 900, height: 506 });
    const big = asset({ id: "big", width: 1920, height: 1080 });
    const v = upgrade(small, "engine", big);
    assert.equal(v.decision, "keep", describeUpgrade(v));
    assert.match(v.refusals.join(" "), /one non-decisive improvement/);
  });
});

describe("the candidate must itself be safe", () => {
  test("a private asset is never proposed", () => {
    const v = upgrade(GENERIC, "engine", asset({ id: "p", publicationStatus: "private" }), GALLERY);
    assert.equal(v.decision, "keep");
    assert.match(v.refusals.join(" "), /not published/);
  });

  test("an asset the matcher refuses for this slot is never proposed", () => {
    // Wrong model entirely.
    const wrong = asset({ id: "w", storagePath: "uuid-nvidia-geforce-rtx-5080.jpg", altText: "NVIDIA GeForce RTX 5080" });
    const v = upgrade(GENERIC, "engine", wrong, GALLERY);
    assert.equal(v.decision, "keep");
  });
});
