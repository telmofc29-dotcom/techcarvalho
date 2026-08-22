// Adversarial strictness tests for MEDIA candidate entity matching.
//
// WHY THIS FILE EXISTS SEPARATELY FROM providers/identity.test.ts
// ---------------------------------------------------------------
// That file tests the intended behaviour of query expansion and entity
// matching. This one was written to BREAK the entity gate: it takes each
// product in the catalogue's most confusable families and feeds it files that
// belong to its SIBLING, in both directions, plus the composite-image traps
// that a real Commons run actually returned.
//
// THE PRINCIPLE UNDER TEST
// ------------------------
// A large number of visually similar search results is NOT evidence that the
// exact subject was found. Every one of the files below has a clean licence,
// a plausible title, and often a curated category. None of that makes it a
// photograph of the product on whose page it would appear. Wrong-product
// identity must fail CLOSED, and `ambiguous` counts as closed — it is never
// rounded up to "confirmed".
//
// (Historical note: one test here was once marked `todo`, because it pinned a
// real defect in providers/entity-match.ts that was found by this suite and
// reported rather than patched — the owning file was under concurrent edit.
// Writing it as an executable `todo` rather than prose is what made it
// verifiable when the fix landed. It has, so the marker is gone and the case
// now runs on every commit. It is described in full at the test itself.)

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { assessEntityMatch, MATCH_CONFIRMED, MATCH_REJECTED } from "./providers/entity-match.ts";
import { discriminators, type SubjectIdentity } from "./providers/query-expansion.ts";

const subject = (
  canonicalName: string,
  manufacturer: string | null,
  aliases: string[] = [],
  family: string | null = null
): SubjectIdentity => ({ canonicalName, manufacturer, aliases, family });

const S = {
  r5: subject("Canon EOS R5", "Canon", [], "Canon EOS R"),
  r5m2: subject("Canon EOS R5 Mark II", "Canon", [], "Canon EOS R"),
  switch2: subject("Nintendo Switch 2", "Nintendo", ["Switch 2"], "Nintendo Switch"),
  ps5: subject("Sony PlayStation 5", "Sony", ["PS5"], "PlayStation 5"),
  ps5pro: subject("Sony PlayStation 5 Pro", "Sony", ["PS5 Pro"], "PlayStation 5"),
  rtx5080: subject("NVIDIA GeForce RTX 5080", "NVIDIA", ["RTX 5080"], "GeForce RTX 50"),
  rtx5090: subject("NVIDIA GeForce RTX 5090", "NVIDIA", ["RTX 5090"], "GeForce RTX 50"),
  mini4pro: subject("DJI Mini 4 Pro", "DJI", [], "DJI Mini"),
  mini4k: subject("DJI Mini 4K", "DJI", [], "DJI Mini"),
  xe75: subject("TP-Link Deco XE75", "TP-Link", [], "TP-Link Deco"),
  be85: subject("TP-Link Deco BE85", "TP-Link", [], "TP-Link Deco"),
  r9800: subject("AMD Ryzen 7 9800X3D", "AMD", [], "Ryzen 7"),
  r9700: subject("AMD Ryzen 7 9700X", "AMD", [], "Ryzen 7"),
  u285k: subject("Intel Core Ultra 9 285K", "Intel", [], "Core Ultra"),
  u265k: subject("Intel Core Ultra 7 265K", "Intel", [], "Core Ultra"),
} satisfies Record<string, SubjectIdentity>;

type File = {
  title: string;
  fileName?: string | null;
  categories?: string[];
  descriptionText?: string | null;
  mimeType?: string;
  exifCameraModel?: string | null;
};

function assess(identity: SubjectIdentity, file: File) {
  return assessEntityMatch(identity, {
    title: file.title,
    fileName: file.fileName === undefined ? file.title.replace(/^File:/, "") : file.fileName,
    categories: file.categories ?? [],
    descriptionText: file.descriptionText ?? null,
    mimeType: file.mimeType ?? "image/jpeg",
    exifCameraModel: file.exifCameraModel ?? null,
  });
}

/** Fails closed: rejected or ambiguous, never confirmed. */
function assertNotConfirmed(identity: SubjectIdentity, file: File, why: string) {
  const m = assess(identity, file);
  assert.notEqual(
    m.verdict,
    "confirmed",
    `WRONG PRODUCT CONFIRMED at ${m.confidence.toFixed(2)}: "${file.title}" was accepted as ` +
      `${identity.canonicalName}. ${why}\n  reason: ${m.reason}`
  );
}

function assertConfirmed(identity: SubjectIdentity, file: File) {
  const m = assess(identity, file);
  assert.equal(
    m.verdict,
    "confirmed",
    `FALSE NEGATIVE at ${m.confidence.toFixed(2)}: the correct file "${file.title}" was not accepted for ` +
      `${identity.canonicalName}. Over-strictness leaves real products with no photograph at all.\n  reason: ${m.reason}`
  );
}

/** A sibling's file, offered to each of the pair in turn. */
function assertSiblingsNeverCross(
  a: SubjectIdentity,
  b: SubjectIdentity,
  fileFor: (s: SubjectIdentity) => File
) {
  assertNotConfirmed(a, fileFor(b), `"${b.canonicalName}" is a different product.`);
  assertNotConfirmed(b, fileFor(a), `"${a.canonicalName}" is a different product.`);
}

describe("a sibling's photograph never clears the gate for the wrong product", () => {
  const commonsShaped = (s: SubjectIdentity): File => ({
    title: `File:${s.canonicalName} product photo.jpg`,
    categories: [`Category:${s.canonicalName}`],
    descriptionText: `${s.canonicalName}, photographed on a white background`,
  });

  const pairs: [SubjectIdentity, SubjectIdentity][] = [
    [S.r5, S.r5m2],
    [S.ps5, S.ps5pro],
    [S.rtx5080, S.rtx5090],
    [S.mini4pro, S.mini4k],
    [S.xe75, S.be85],
    [S.r9800, S.r9700],
    [S.u285k, S.u265k],
  ];

  for (const [a, b] of pairs) {
    test(`${a.canonicalName} <-> ${b.canonicalName}, both directions`, () => {
      assertSiblingsNeverCross(a, b, commonsShaped);
    });
  }

  test("a sibling file wearing OUR curated category is still refused", () => {
    // The nastiest realistic shape: a mis-categorised file. The category says
    // 285K, the title says 265K. Curated categories are the strongest signal
    // the matcher has, so this is where a scoring system would be tempted to
    // average the two and call it probable.
    assertNotConfirmed(
      S.u285k,
      {
        title: "File:Intel Core Ultra 7 265K.jpg",
        categories: ["Category:Intel Core Ultra 9 285K"],
        descriptionText: "Intel Core Ultra 9 285K retail box",
      },
      "A curated category cannot outvote a title that names a different chip."
    );
  });

  test("the family name alone is never enough, however many files carry it", () => {
    // Twenty plausible, cleanly-licensed, correctly-categorised family-level
    // files. The pile is the point: volume is not evidence of identity.
    let confirmed = 0;
    for (let i = 1; i <= 20; i++) {
      const m = assess(S.rtx5080, {
        title: `File:NVIDIA GeForce RTX 50 series graphics card (${String(i).padStart(2, "0")}).jpg`,
        categories: ["Category:NVIDIA GeForce RTX 50 series"],
        descriptionText: "A GeForce RTX 50 series graphics card",
      });
      if (m.verdict === "confirmed") confirmed++;
    }
    assert.equal(confirmed, 0, `${confirmed} of 20 family-level files were accepted as the RTX 5080 specifically.`);
  });
});

describe("the correct file still confirms — strictness must not blind the engine", () => {
  const cases: [SubjectIdentity, File][] = [
    [S.u285k, { title: "File:Intel Core Ultra 9 285K boxed processor.jpg", categories: ["Category:Intel Core Ultra 9 285K"], descriptionText: "Retail box of the Intel Core Ultra 9 285K" }],
    [S.mini4pro, { title: "File:2024 Dron DJI Mini 4 Pro (03).jpg", categories: ["Category:DJI Mini 4 Pro"], descriptionText: "Dron DJI Mini 4 Pro na bialym tle" }],
    [S.switch2, { title: "File:Nintendo Switch 2 console and Joy-Con.jpg", categories: ["Category:Nintendo Switch 2"] }],
    [S.r5, { title: "File:Canon EOS R5 body.jpg", categories: ["Category:Canon EOS R5"] }],
    [S.xe75, { title: "File:TP-Link Deco XE75 mesh unit.jpg", categories: ["Category:TP-Link Deco XE75"] }],
    [S.r9800, { title: "File:AMD Ryzen 7 9800X3D boxed.jpg", categories: ["Category:AMD Ryzen 7 9800X3D"] }],
    [S.ps5pro, { title: "File:Sony PlayStation 5 Pro console.jpg", categories: ["Category:PlayStation 5 Pro"] }],
    [S.rtx5090, { title: "File:NVIDIA GeForce RTX 5090 Founders Edition.jpg", categories: ["Category:GeForce RTX 5090"] }],
  ];
  for (const [identity, file] of cases) {
    test(`${identity.canonicalName} accepts its own photograph`, () => assertConfirmed(identity, file));
  }
});

describe("wrong-object traps: right subject matter, wrong object", () => {
  test("a bare PCB is not a photograph of a graphics card", () => {
    assertNotConfirmed(
      S.rtx5080,
      { title: "File:Nvidia RTX 5080 5090 FE PCB.png", categories: ["Category:GeForce RTX 5080"], mimeType: "image/png" },
      "A reader arriving at a graphics-card page expects a graphics card."
    );
  });

  test("a die micrograph is not the retail processor", () => {
    assertNotConfirmed(
      S.u285k,
      {
        title: "File:Intel Core Ultra 9 285K die micrograph.jpg",
        categories: ["Category:Intel Core Ultra 9 285K"],
        descriptionText: "Delidded die micrograph of the Intel Core Ultra 9 285K",
      },
      "Bare silicon is not the boxed product."
    );
  });

  test("a frame lifted from a review video is not product photography", () => {
    for (const title of [
      "File:RTX 5080 FE shou fa ping ce (2160p 60fps VP9-128kbit AAC)-00.01.24.019.png",
      "File:B-Rolls der NVIDIA GeForce RTX 5080 (by Geekerwan).webm",
    ]) {
      assertNotConfirmed(S.rtx5080, { title, mimeType: "image/png" }, "Its licence traces to a channel setting.");
    }
  });
});

// ---------------------------------------------------------------------------
// FIXED 2026-08-22 — kept as a regression test.
//
// This was found by adversarial testing, reported rather than patched (the
// owning file was under concurrent edit), and has since been fixed in
// providers/entity-match.ts. A title naming a sibling model is now capped at
// MULTI_PRODUCT_CEILING (0.74), and the cap is applied to the CONFIDENCE
// NUMBER rather than only the verdict, so no later re-weighting can lift a
// composite back over the line.
//
// The `todo` marker is removed: this now runs and passes on every commit.
//
// THE DEFECT
// ----------
// `assessEntityMatch` rejects a title carrying a foreign model number — unless
// this product's own discriminators are ALSO in the title, in which case the
// hard rejection is downgraded to a -0.05 nudge:
//
//     const oursPresent = required.every((t) => titleToks.has(t));
//     if (!oursPresent) { return { verdict: "rejected", ... }; }
//     signals.push({ name: "extra_number_in_title", weight: -0.05, ... });
//
// The stated reasoning is that an extra number alongside our own is "likely a
// sequence or resolution". That holds for "(03)" and "2160p". It does not hold
// when the extra number is a SIBLING MODEL, which is precisely the composite
// and comparison shot: two products in one frame, both named in the title.
//
// Measured BEFORE the fix:
//   File:NVIDIA GeForce RTX 5080 and RTX 5090 side by side.jpg
//     -> confirmed 0.99 for the RTX 5080, AND confirmed 0.99 for the RTX 5090
//   File:Intel Core Ultra 9 285K and Core Ultra 7 265K.jpg
//     -> confirmed 1.00 for BOTH chips
//   File:RTX 5070 5080 5090 lineup.jpg          -> confirmed 0.80 for the 5080
//   File:Nvidia RTX 5080 5090 FE coolers.png    -> confirmed 0.99 for the 5080
//
// The real production trap named in docs/product-media-strategy.md —
// `File:Nvidia RTX 5080 5090 FE PCB.png` — currently fails closed only by
// luck: the word "pcb" carries a -0.5 wrong-subject penalty that drags it into
// the ambiguous band. Change one word in that filename, as the "coolers"
// variant above shows, and the same two-card composite confirms at 0.99.
//
// Impact: the same image is published on two different product pages, each
// captioned as if it were that product. It is the "HERO12 on a HERO13 page"
// failure the module's own header warns about, arriving through the one door
// left open.
//
// Suggested fix (for whoever owns that file): the `oursPresent` escape hatch
// should not apply when the foreign number is model-shaped for the SAME family
// — i.e. when it has the same length and prefix shape as one of `required`, or
// when it appears adjacent to a shared alphabetic token such as "rtx" or
// "ultra". A title naming two products cannot evidence either one, so it should
// score at most `ambiguous` and never `confirmed`.
// ---------------------------------------------------------------------------
test(
  "REGRESSION: a file naming TWO sibling products must not confirm for either",
  () => {
    const both = "File:NVIDIA GeForce RTX 5080 and RTX 5090 side by side.jpg";
    assertNotConfirmed(S.rtx5080, { title: both, categories: ["Category:GeForce RTX 5080"] }, "The frame contains two cards.");
    assertNotConfirmed(S.rtx5090, { title: both, categories: ["Category:GeForce RTX 5090"] }, "The frame contains two cards.");

    const bothCpu = "File:Intel Core Ultra 9 285K and Core Ultra 7 265K.jpg";
    assertNotConfirmed(S.u285k, { title: bothCpu, categories: ["Category:Intel Core Ultra 9 285K"] }, "Two chips in one frame.");
    assertNotConfirmed(S.u265k, { title: bothCpu, categories: ["Category:Intel Core Ultra 7 265K"] }, "Two chips in one frame.");

    assertNotConfirmed(
      S.rtx5080,
      { title: "File:Nvidia RTX 5080 5090 FE coolers.png", categories: ["Category:GeForce RTX 5080"], mimeType: "image/png" },
      "The real PCB composite with one word changed."
    );
  }
);

// ---------------------------------------------------------------------------
// SECOND DEFECT — reported, not patched. This one fails CLOSED, so it destroys
// nothing; it is recorded because the safe behaviour is load-bearing and a
// naive relaxation of it would open a merge path between two live consoles.
//
// `discriminators()` in providers/query-expansion.ts derives nothing at all
// from a name whose distinguishing token is a single bare letter:
//
//     discriminators("Xbox Series X") -> []
//     discriminators("Xbox Series S") -> []
//     discriminators("Nintendo Switch") -> []
//
// "series" is on the NON_DISCRIMINATING list and a lone "x"/"s" is neither a
// digit nor a listed variant word. `assessEntityMatch` then refuses every file
// with "No discriminating token could be derived" — correct as a fail-closed
// default, but it means these products can NEVER acquire media by this route,
// and the only thing keeping a Series S photograph off the Series X page is
// that blanket refusal rather than any understanding of the difference.
//
// The test below pins BOTH halves so the safe half cannot be lost while
// somebody fixes the blind spot: if a future change makes the correct file
// confirm, the sibling file must still be refused.
// ---------------------------------------------------------------------------
describe("blind spot: products with no derivable discriminator", () => {
  const xsx = subject("Xbox Series X", "Microsoft", [], "Xbox Series");
  const xss = subject("Xbox Series S", "Microsoft", [], "Xbox Series");

  test("the blind spot is real and currently fails closed", () => {
    assert.deepEqual(discriminators(xsx.canonicalName), [], "if this now returns tokens, the blind spot is fixed — check the sibling assertion below still holds");
    assert.deepEqual(discriminators(xss.canonicalName), []);
    assert.deepEqual(discriminators("Nintendo Switch"), []);
  });

  test("whatever else changes, a Series S file must never confirm as a Series X", () => {
    assertSiblingsNeverCross(xsx, xss, (s) => ({
      title: `File:${s.canonicalName} console.jpg`,
      categories: [`Category:${s.canonicalName}`],
      descriptionText: `The ${s.canonicalName} console`,
    }));
  });
});

test("the verdict bands themselves fail closed", () => {
  // If these ever invert or meet, "ambiguous" stops existing and every
  // uncertain candidate silently becomes a confirmed one.
  assert.ok(MATCH_REJECTED < MATCH_CONFIRMED, "the ambiguous band must be non-empty");
  assert.ok(MATCH_CONFIRMED <= 1 && MATCH_REJECTED >= 0);
});
