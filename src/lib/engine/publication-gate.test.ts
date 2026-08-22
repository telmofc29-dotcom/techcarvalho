import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluatePublicationGate, type GateInput } from "./publication-gate.ts";

/** A candidate that passes everything. Each test spoils exactly one thing. */
const clean = (): GateInput => ({
  kind: "article",
  identifier: "example-article",
  evidence: {
    totalClaims: 10, supportedClaims: 10, unsupportedClaims: [],
    unsupportedHighRisk: [], brokenCitations: [], mismatches: [],
  },
  sources: {
    total: 4, distinctPublishers: 3, primaryCount: 2, independentCount: 3,
    isVendorPressRelease: false, oldestEvidenceDays: 5,
  },
  freshness: { sensitivity: "evergreen", evidenceAgeDays: 20 },
  entity: { decision: "matched_existing", matchedName: "Canon EOS R5" },
  duplication: { nearestSimilarity: 0.2, nearestSlug: "something-else", cannibalisesSlug: null },
  media: {
    hasHero: true, provenanceBlockers: [], requiresCredit: true,
    creditRenderVerified: true, misleadingGenerated: false,
  },
  technical: {
    brokenInternalLinks: [], invalidExternalLinks: [], hasSeoTitle: true,
    hasSeoDescription: true, structuredDataValid: true, emptySections: [],
    placeholderMarkers: [], buildRenderOk: true,
  },
});

test("a fully clean candidate is publishable", () => {
  const v = evaluatePublicationGate(clean());
  assert.equal(v.publishable, true, v.summary);
  assert.equal(v.blockers.length, 0);
  assert.equal(v.unavailableChecks.length, 0);
});

test("every dimension is scored independently, never averaged into one number", () => {
  const v = evaluatePublicationGate(clean());
  const dims = v.dimensions.map((d) => d.dimension);
  for (const expected of [
    "entity_identity", "factual_accuracy", "source_quality", "freshness",
    "media_rights", "search_intent", "uniqueness", "editorial_quality", "technical_validity",
  ]) {
    assert.ok(dims.includes(expected as never), `missing dimension ${expected}`);
  }
  // No aggregate is exposed at all — uncertainty cannot hide in one number.
  assert.ok(!("overallScore" in v));
  assert.ok(!("score" in v));
});

test("every dimension explains itself", () => {
  for (const d of evaluatePublicationGate(clean()).dimensions) {
    assert.ok(d.rationale.length > 10, `${d.dimension} has no rationale`);
    assert.ok(d.score >= 0 && d.score <= 1, `${d.dimension} score out of range`);
  }
});

// ---------------------------------------------------------------------------
// A single hard blocker overrides everything
// ---------------------------------------------------------------------------

test("ONE hard blocker blocks publication however good everything else is", () => {
  const input = clean();
  input.media!.provenanceBlockers = ["provenance_no_source_url"];
  const v = evaluatePublicationGate(input);
  assert.equal(v.publishable, false);
  const perfect = v.dimensions.filter((d) => d.score === 1).length;
  assert.ok(perfect >= 5, "other dimensions should still score well — and it does not matter");
  assert.ok(v.summary.startsWith("BLOCKED"));
});

test("each hard blocker fires on its own condition", () => {
  const cases: [string, (i: GateInput) => void][] = [
    ["unsupported_claims", (i) => { i.evidence!.unsupportedClaims = ["The price is $499."]; }],
    ["invented_specifics", (i) => { i.evidence!.unsupportedHighRisk = ["Ships 5 November."]; }],
    ["broken_citation", (i) => { i.evidence!.brokenCitations = ["https://dead.example/x"]; }],
    ["source_evidence_mismatch", (i) => { i.evidence!.mismatches = ["claim not in cited source"]; }],
    ["missing_required_evidence", (i) => { i.evidence!.totalClaims = 0; i.evidence!.supportedClaims = 0; }],
    ["vendor_press_release", (i) => { i.sources!.isVendorPressRelease = true; }],
    ["low_source_diversity", (i) => { i.sources!.independentCount = 1; i.sources!.primaryCount = 0; }],
    ["unresolved_entity", (i) => { i.entity!.decision = "ambiguous"; }],
    ["duplicate_content", (i) => { i.duplication!.nearestSimilarity = 0.9; }],
    ["intent_cannibalisation", (i) => { i.duplication!.cannibalisesSlug = "existing-page"; }],
    ["missing_hero_media", (i) => { i.media!.hasHero = false; }],
    ["media_provenance_incomplete", (i) => { i.media!.provenanceBlockers = ["rights_unverified"]; }],
    ["media_credit_not_rendered", (i) => { i.media!.creditRenderVerified = false; }],
    ["misleading_generated_imagery", (i) => { i.media!.misleadingGenerated = true; }],
    ["broken_internal_link", (i) => { i.technical!.brokenInternalLinks = ["/articles/gone"]; }],
    ["invalid_external_link", (i) => { i.technical!.invalidExternalLinks = ["https://dead.example"]; }],
    ["missing_seo_metadata", (i) => { i.technical!.hasSeoTitle = false; }],
    ["malformed_structured_data", (i) => { i.technical!.structuredDataValid = false; }],
    ["incomplete_sections", (i) => { i.technical!.emptySections = ["## What it costs"]; }],
    ["placeholder_text", (i) => { i.technical!.placeholderMarkers = ["[Write this section"]; }],
    ["build_render_failed", (i) => { i.technical!.buildRenderOk = false; }],
  ];
  for (const [code, spoil] of cases) {
    const input = clean();
    spoil(input);
    const v = evaluatePublicationGate(input);
    assert.equal(v.publishable, false, `${code} should block`);
    assert.ok(v.blockers.some((b) => b.code === code), `expected ${code}, got ${v.blockers.map((b) => b.code).join(",")}`);
  }
});

// ---------------------------------------------------------------------------
// Fails closed
// ---------------------------------------------------------------------------

test("an unavailable check BLOCKS — a broken subsystem never skips validation", () => {
  const checks: (keyof GateInput)[] = ["evidence", "sources", "freshness", "entity", "duplication", "media", "technical"];
  for (const key of checks) {
    const input = clean();
    delete (input as Record<string, unknown>)[key];
    const v = evaluatePublicationGate(input);
    assert.equal(v.publishable, false, `missing ${key} must block`);
    assert.ok(v.blockers.some((b) => b.code === "check_unavailable"), String(key));
    assert.ok(v.unavailableChecks.length > 0, String(key));
  }
});

test("all validation missing means blocked, not vacuously clean", () => {
  const v = evaluatePublicationGate({ kind: "article", identifier: "empty" });
  assert.equal(v.publishable, false);
  assert.ok(v.unavailableChecks.length >= 7, `only ${v.unavailableChecks.length} reported`);
});

// ---------------------------------------------------------------------------
// The 2026-08-22 production escape
// ---------------------------------------------------------------------------

test("REGRESSION 2026-08-22: complete media data with an unrendered credit is BLOCKED", () => {
  const input = clean();
  // Exactly the incident: provenance complete, nothing missing in the data...
  input.media!.provenanceBlockers = [];
  input.media!.requiresCredit = true;
  // ...but the page does not render the credit.
  input.media!.creditRenderVerified = false;
  const v = evaluatePublicationGate(input);
  assert.equal(v.publishable, false);
  const b = v.blockers.find((x) => x.code === "media_credit_not_rendered");
  assert.ok(b, "the escape must be caught");
  assert.ok(b.message.includes("2026-08-22"), "the blocker should name the incident it encodes");
});

test("no credit is owed when the licence does not require one", () => {
  const input = clean();
  input.media!.requiresCredit = false;
  input.media!.creditRenderVerified = false;
  assert.equal(evaluatePublicationGate(input).publishable, true, "CC0 and our own work owe no credit");
});

// ---------------------------------------------------------------------------
// Freshness and sources
// ---------------------------------------------------------------------------

test("stale evidence blocks breaking material but not evergreen", () => {
  const breaking = clean();
  breaking.freshness = { sensitivity: "breaking", evidenceAgeDays: 10 };
  assert.equal(evaluatePublicationGate(breaking).publishable, false);

  const evergreen = clean();
  evergreen.freshness = { sensitivity: "evergreen", evidenceAgeDays: 400 };
  assert.equal(evaluatePublicationGate(evergreen).publishable, true);
});

test("a primary source rescues low diversity; repetition does not", () => {
  const withPrimary = clean();
  withPrimary.sources = { total: 1, distinctPublishers: 1, primaryCount: 1, independentCount: 1, isVendorPressRelease: false, oldestEvidenceDays: 1 };
  assert.equal(evaluatePublicationGate(withPrimary).publishable, true);

  const echoChamber = clean();
  echoChamber.sources = { total: 6, distinctPublishers: 6, primaryCount: 0, independentCount: 1, isVendorPressRelease: false, oldestEvidenceDays: 1 };
  assert.equal(evaluatePublicationGate(echoChamber).publishable, false, "six outlets repeating one origin is not corroboration");
});

test("every blocker is actionable prose, not a bare code", () => {
  const input = clean();
  input.media!.hasHero = false;
  input.evidence!.unsupportedClaims = ["x"];
  for (const b of evaluatePublicationGate(input).blockers) {
    assert.ok(b.message.length > 30, b.code);
    assert.ok(/[a-z]\s[a-z]/i.test(b.message), `${b.code} message is not prose`);
  }
});
