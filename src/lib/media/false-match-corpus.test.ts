import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { FALSE_MATCH_PAIRS } from "./false-match-corpus.ts";
import {
  scoreMatch,
  deriveIsModelSpecific,
  type MatchAsset,
  type MatchTarget,
} from "./match-engine.ts";
import { assessEntityMatch, MATCH_CONFIRMED } from "./providers/entity-match.ts";
import { compareModelIdentity } from "../engine/model-identity.ts";
import { compareDesignations, namesSpecificModel } from "./identity.ts";

// ONE CORPUS, EVERY MATCHER.
//
// The defect this file exists to make impossible: a pair asserted in one
// matcher's test file, unasserted in the other's, and wrong in the second. Each
// describe() block below runs the SAME list through a different consumer of
// product identity. A pair added to false-match-corpus.ts is added to all of
// them at once.

const asset = (filename: string): MatchAsset => ({
  id: "asset",
  storagePath: `0f8b1c2d-3e4f-5a6b-7c8d-9e0f1a2b3c4d-${filename}.jpg`,
  altText: null,
  caption: null,
  sourceType: "staff_photograph",
  assetRole: "product_photo",
  brandRole: null,
  owned: true,
  aiGenerated: false,
  publicationStatus: "published",
  rightsStatus: "verified",
  width: 2400,
  height: 1600,
});

const target = (title: string, manufacturerName: string): MatchTarget => ({
  id: "target",
  kind: "content",
  title,
  manufacturerName,
  categorySlug: null,
  // Derived exactly as the app derives it, NOT hardcoded true. The live defect
  // was in this derivation, so a test that hardcodes it tests nothing about it:
  // "Mac Studio review" carries no digit and was classified as naming no model.
  isModelSpecific: deriveIsModelSpecific(title),
  occupiedSlots: [],
});

// ---------------------------------------------------------------------------
// 1. THE LIBRARY MATCHER — choosing an existing image for a page.
// ---------------------------------------------------------------------------
describe("library matcher (scoreMatch) refuses every false-match pair", () => {
  for (const pair of FALSE_MATCH_PAIRS) {
    test(`"${pair.siblingFilename}" is not offered a slot on "${pair.subject}"`, () => {
      const m = scoreMatch(asset(pair.siblingFilename), target(pair.subject, pair.manufacturer));
      assert.notEqual(
        m.specificity,
        "exact_model",
        `${pair.distinction} — reasons: ${m.reasons.join(" | ")}`
      );
      assert.deepEqual(
        m.proposedSlots,
        [],
        `offered ${m.proposedSlots.join(",")} — reasons: ${m.reasons.join(" | ")}`
      );
      assert.ok(m.withheld.length > 0, "a refusal must say why");
    });

    // The article-title form, which is how content targets actually arrive.
    test(`"${pair.siblingFilename}" is not offered a slot on an article about "${pair.subject}"`, () => {
      const m = scoreMatch(
        asset(pair.siblingFilename),
        target(`${pair.subject} review`, pair.manufacturer)
      );
      assert.deepEqual(m.proposedSlots, [], `reasons: ${m.reasons.join(" | ")}`);
    });
  }
});

// ---------------------------------------------------------------------------
// 2. THE ACQUISITION MATCHER — accepting a provider's file for a catalogue row.
// ---------------------------------------------------------------------------
describe("acquisition matcher (assessEntityMatch) refuses every false-match pair", () => {
  for (const pair of FALSE_MATCH_PAIRS) {
    test(`a "${pair.sibling}" file does not confirm as "${pair.subject}"`, () => {
      const verdict = assessEntityMatch(
        { canonicalName: pair.subject, manufacturer: pair.manufacturer, aliases: [], family: null },
        {
          title: `File:${pair.sibling}.jpg`,
          fileName: `${pair.sibling}.jpg`,
          categories: [`Category:${pair.sibling}`],
          descriptionText: `A ${pair.sibling}`,
          mimeType: "image/jpeg",
          exifCameraModel: null,
        }
      );
      assert.notEqual(verdict.verdict, "confirmed", `${pair.distinction} — ${verdict.reason}`);
      assert.ok(
        verdict.confidence < MATCH_CONFIRMED,
        `confidence ${verdict.confidence} reached the confirm band`
      );
    });
  }
});

// ---------------------------------------------------------------------------
// 3. THE COVERAGE VETO — deciding whether an existing article covers a
//    development. The failure here is not a wrong picture, it is a missed story
//    reported as handled.
// ---------------------------------------------------------------------------
describe("coverage veto (compareModelIdentity) refuses every false-match pair", () => {
  for (const pair of FALSE_MATCH_PAIRS) {
    test(`coverage of "${pair.sibling}" is not coverage of "${pair.subject}"`, () => {
      const v = compareModelIdentity(`${pair.subject} announced`, `${pair.sibling} announced`);
      assert.equal(v.sameModel, false, `${pair.distinction} — ${v.reason}`);
      assert.ok(v.differing.length > 0, "the veto must name what differs");
    });
  }
});

// ---------------------------------------------------------------------------
// 4. THE SHARED CORE. Every pair must be separable by the canonical comparison
//    itself, otherwise the three consumers above are each getting it right by
//    their own private route — which is the situation this corpus ends.
// ---------------------------------------------------------------------------
describe("canonical identity separates every pair", () => {
  for (const pair of FALSE_MATCH_PAIRS) {
    test(`"${pair.subject}" and "${pair.sibling}" are different designations`, () => {
      const c = compareDesignations(pair.subject, pair.sibling);
      assert.equal(c.conflict, true, `${pair.distinction} — ${c.reason}`);
      assert.equal(c.neitherNames, false);
    });

    test(`"${pair.subject}" is recognised as naming a specific model`, () => {
      // The live defect in one sentence: this returned false for "Mac Studio",
      // so the rule that refuses family-level imagery never ran.
      assert.equal(
        namesSpecificModel(pair.subject),
        true,
        `${pair.subject} derived no designation, so nothing can protect it`
      );
    });
  }
});

// ---------------------------------------------------------------------------
// POSITIVE CONTROLS. A protection that refuses everything is not a protection,
// and these are the spellings the real library actually uses.
// ---------------------------------------------------------------------------
describe("the correct image is still accepted", () => {
  const cases: [string, string, string][] = [
    ["canon-eos-r5-mark-ii-front", "Canon EOS R5 Mark II", "Canon"],
    ["canon-eos-5d-mark-iii", "Canon EOS 5D Mark III", "Canon"],
    ["nvidia-geforce-rtx-5090-founders", "NVIDIA GeForce RTX 5090", "NVIDIA"],
    ["dji-mini-4-pro", "DJI Mini 4 Pro", "DJI"],
    ["apple-mac-studio", "Apple Mac Studio", "Apple"],
    ["nikon-z8", "Nikon Z8", "Nikon"],
  ];
  for (const [file, title, maker] of cases) {
    test(`"${file}" is an exact match for "${title}"`, () => {
      const m = scoreMatch(asset(file), target(title, maker));
      assert.equal(m.specificity, "exact_model", `reasons: ${m.reasons.join(" | ")}`);
      assert.ok(m.proposedSlots.includes("hero"), `withheld: ${m.withheld.join(" | ")}`);
    });
  }

  // The glued spelling this library really uses in its comparison graphics.
  // `cmp-rtx5090-vs-5080.png` must still be able to satisfy the RTX 5090.
  test("a glued filename spelling still satisfies the spaced catalogue name", () => {
    const c = compareDesignations("NVIDIA GeForce RTX 5090", "cmp rtx5090 vs 5080");
    assert.deepEqual(c.onlyInSubject, [], "the subject's designation went unsatisfied");
  });

  test("a roundup naming no model is not held to the strict rule", () => {
    assert.equal(namesSpecificModel("Best Canon cameras 2026"), false, "a year is not a model number");
  });
});
