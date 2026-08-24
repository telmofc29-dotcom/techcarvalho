import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildApprovalPackage,
  MARKER_SYMBOL,
  MARKER_LABEL,
  type PackageInput,
} from "./approval-package.ts";
import { classifyBriefQuality } from "./brief-quality.ts";

const NOW = new Date("2026-08-24T12:00:00Z");

const GOOD_QUALITY = classifyBriefQuality(
  {
    title: "iPhone 18: what is confirmed so far",
    briefKind: "breaking",
    contentType: "news",
    verifiedFacts: ["a", "b", "c"],
    uncertainties: ["u1", "u2"],
    sourceUrls: ["https://www.reuters.com/a", "https://www.theverge.com/b"],
    freshnessSensitivity: "time_sensitive",
    hasDiscovery: true,
    hasOpportunity: true,
    createdAt: "2026-08-23T00:00:00Z",
  },
  NOW
);

function pkg(over: Partial<PackageInput> = {}) {
  return buildApprovalPackage({
    briefId: "b1",
    title: "iPhone 18: what is confirmed so far",
    contentType: "news",
    categorySlug: "smartphones",
    quality: GOOD_QUALITY,
    primaryQuestion: "What has Apple actually confirmed?",
    verifiedFacts: ["a", "b", "c"],
    uncertainties: ["u1", "u2"],
    sourceUrls: ["https://www.reuters.com/a", "https://www.theverge.com/b"],
    proposedSlug: "iphone-18-what-is-confirmed",
    slugTaken: false,
    metaTitle: "iPhone 18: what is confirmed so far",
    metaDescription: "What has Apple actually confirmed?",
    existingProducts: [],
    missingProductSlugs: [],
    cannibalisationMatch: null,
    corpusKnown: true,
    mediaReady: false,
    mediaNeedsRightsReview: 0,
    alreadyAssembled: false,
    ...over,
  });
}

function allLines(p: ReturnType<typeof pkg>) {
  return p.sections.flatMap((s) => s.lines);
}

// ---------------------------------------------------------------------------
// The core honesty property: existing vs will-be-created
// ---------------------------------------------------------------------------

test("the article is reported as WILL BE CREATED, never as existing", () => {
  const p = pkg();
  const line = allLines(p).find((l) => l.text.includes("will be created as a DRAFT"));
  assert.ok(line, "expected a creation line");
  assert.equal(line.marker, "will_create");
});

test("an existing product is reported as existing, a missing one is not invented", () => {
  const p = pkg({
    existingProducts: [{ name: "iPhone 17", slug: "iphone-17", isPublished: true }],
    missingProductSlugs: ["iphone-18"],
  });
  const lines = allLines(p);
  const existing = lines.find((l) => l.text.includes("iPhone 17"));
  const missing = lines.find((l) => l.text.includes("iphone-18"));
  assert.equal(existing?.marker, "ok");
  assert.equal(missing?.marker, "warn");
  // Crucially: a missing product is NOT reported as something approval creates.
  assert.notEqual(missing?.marker, "will_create");
  assert.match(missing?.detail ?? "", /specifications are never guessed/i);
});

test("approving never claims it will publish", () => {
  const p = pkg();
  assert.match(p.afterBuild.join(" "), /publish/i);
  assert.match(p.afterBuild.join(" "), /separate/i);
  const created = allLines(p).find((l) => l.marker === "will_create");
  assert.match(created?.text ?? "", /DRAFT/);
});

// ---------------------------------------------------------------------------
// Blockers
// ---------------------------------------------------------------------------

test("cannibalisation blocks the build", () => {
  const p = pkg({ cannibalisationMatch: { title: "iPhone 18 tracker", similarity: 0.9 } });
  assert.equal(p.canBuild, false);
  assert.match(p.blockers.join(" "), /Overlaps existing content/);
});

test("an already-assembled brief cannot be built twice", () => {
  const p = pkg({ alreadyAssembled: true });
  assert.equal(p.canBuild, false);
  assert.match(p.blockers.join(" "), /already produced a draft/i);
});

test("a missing slug blocks the build", () => {
  const p = pkg({ proposedSlug: null });
  assert.equal(p.canBuild, false);
});

test("a clean package can build", () => {
  const p = pkg();
  assert.equal(p.canBuild, true);
  assert.deepEqual(p.blockers, []);
});

// ---------------------------------------------------------------------------
// Media never blocks, and rights are never assumed
// ---------------------------------------------------------------------------

test("unresolved media rights warn but do not block", () => {
  const p = pkg({ mediaNeedsRightsReview: 3 });
  assert.equal(p.canBuild, true);
  const media = p.sections.find((s) => s.title === "Media");
  assert.equal(media?.lines[0].marker, "warn");
  assert.match(media?.lines[0].detail ?? "", /will not assume rights/i);
});

test("no media at all still proceeds, and records the gap", () => {
  const p = pkg({ mediaReady: false, mediaNeedsRightsReview: 0 });
  assert.equal(p.canBuild, true);
  const media = p.sections.find((s) => s.title === "Media");
  assert.match(media?.lines[0].text ?? "", /No media yet/);
  assert.match(media?.lines[0].detail ?? "", /not silently forgotten/i);
});

test("media that is genuinely ready is reported as ready", () => {
  const p = pkg({ mediaReady: true });
  const media = p.sections.find((s) => s.title === "Media");
  assert.equal(media?.lines[0].marker, "ok");
  // and the after-build list should no longer ask for a media decision
  assert.ok(!p.afterBuild.some((s) => /Decide the media/i.test(s)));
});

test("when media is missing the owner is told they still have to decide it", () => {
  const p = pkg({ mediaReady: false });
  assert.ok(p.afterBuild.some((s) => /Decide the media/i.test(s)));
});

// ---------------------------------------------------------------------------
// No false clearances
// ---------------------------------------------------------------------------

test("an unreadable corpus never produces a duplication clearance", () => {
  const p = pkg({ corpusKnown: false });
  const content = p.sections.find((s) => s.title === "Content");
  const texts = content!.lines.map((l) => l.text).join(" | ");
  assert.ok(!/no overlap found/i.test(texts), "must not claim a clearance it did not earn");
  assert.match(texts, /could NOT be checked/i);
  // Not knowing is not a blocker — it is a warning, so work is not halted by
  // an infrastructure problem, but nothing is claimed either.
  assert.equal(p.canBuild, true);
});

test("a readable corpus with no match does claim the clearance", () => {
  const p = pkg({ corpusKnown: true, cannibalisationMatch: null });
  const content = p.sections.find((s) => s.title === "Content");
  assert.match(content!.lines.map((l) => l.text).join(" | "), /no overlap found/i);
});

test("a missing meta description is reported, never fabricated", () => {
  const p = pkg({ metaDescription: null });
  const seo = p.sections.find((s) => s.title === "SEO");
  const line = seo!.lines.find((l) => l.text.includes("meta description"));
  assert.equal(line?.marker, "warn");
  assert.match(line?.detail ?? "", /will not be invented/i);
});

// ---------------------------------------------------------------------------
// Research framing
// ---------------------------------------------------------------------------

test("unconfirmed claims are framed as a strength, not a defect", () => {
  const p = pkg();
  const research = p.sections.find((s) => s.title === "Research");
  const line = research!.lines.find((l) => l.text.includes("unconfirmed"));
  assert.equal(line?.marker, "ok");
  assert.match(line?.detail ?? "", /stated as established fact/i);
});

test("zero recorded uncertainties is treated as under-examination", () => {
  const q = classifyBriefQuality(
    {
      title: "Something",
      briefKind: "breaking",
      contentType: "news",
      verifiedFacts: ["a", "b"],
      uncertainties: [],
      sourceUrls: ["https://www.reuters.com/a", "https://www.theverge.com/b"],
      freshnessSensitivity: null,
      hasDiscovery: true,
      hasOpportunity: false,
      createdAt: "2026-08-23T00:00:00Z",
    },
    NOW
  );
  const p = pkg({ quality: q });
  const research = p.sections.find((s) => s.title === "Research");
  const line = research!.lines.find((l) => l.text.includes("No open questions"));
  assert.equal(line?.marker, "warn");
});

// ---------------------------------------------------------------------------
// Structure
// ---------------------------------------------------------------------------

test("every section is present and non-empty", () => {
  const p = pkg();
  assert.deepEqual(
    p.sections.map((s) => s.title),
    ["Research", "Database", "Content", "Media", "SEO"]
  );
  for (const s of p.sections) {
    assert.ok(s.lines.length > 0, `${s.title} must say something`);
  }
});

test("every marker has a symbol and a label", () => {
  for (const m of ["ok", "will_create", "warn", "blocked"] as const) {
    assert.equal(typeof MARKER_SYMBOL[m], "string");
    assert.equal(typeof MARKER_LABEL[m], "string");
  }
});

test("blockers exactly match the blocked lines", () => {
  const p = pkg({ cannibalisationMatch: { title: "x", similarity: 0.9 }, proposedSlug: null });
  const blocked = allLines(p).filter((l) => l.marker === "blocked");
  assert.equal(p.blockers.length, blocked.length);
  assert.equal(p.canBuild, false);
});
