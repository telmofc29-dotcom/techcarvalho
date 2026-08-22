import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classifyRights, evaluateProvenance, requiresRenderedCredit,
  type ProvenanceAsset,
} from "./provenance.ts";

const asset = (o: Partial<ProvenanceAsset>): ProvenanceAsset => ({
  source_type: null, rights_status: null, license: null, creator: null,
  attribution: null, attribution_required: null, source_url: null,
  owned: null, ai_generated: null, ...o,
});

// The shape of the real Commons product photographs now live on the site.
const REAL_COMMONS = asset({
  source_type: "public_domain_or_cc",
  rights_status: "verified",
  license: "CC BY-SA 4.0",
  creator: "A.Savin",
  attribution: "Photo: A.Savin, CC BY-SA 4.0, via Wikimedia Commons",
  attribution_required: true,
  source_url: "https://commons.wikimedia.org/wiki/File:Jan2015_Canon_EOS_7D_Mark_II_Body01.jpg",
  owned: false,
  ai_generated: false,
});

// ---------------------------------------------------------------------------
// THE 2026-08-22 PRODUCTION ESCAPE
// ---------------------------------------------------------------------------

test("REGRESSION 2026-08-22: an attribution licence with attribution disabled is a BLOCKER", () => {
  // The escape class. The licence requires a credit; attribution_required
  // being false means no credit renders, so the licence condition goes unmet
  // on a live page. Every other field can be perfect.
  const a = asset({ ...REAL_COMMONS, attribution_required: false });
  const r = evaluateProvenance(a);
  assert.equal(r.publishable, false);
  const codes = r.findings.filter((f) => f.severity === "blocker").map((f) => f.code);
  assert.ok(codes.includes("provenance_attribution_disabled"), codes.join(","));
});

test("REGRESSION 2026-08-22: complete data still DECLARES that a credit must render", () => {
  // The real incident had every database field populated and still shipped
  // without a rendered credit. Data completeness must never be read as
  // compliance — the asset has to tell the gate a credit is owed.
  const r = evaluateProvenance(REAL_COMMONS);
  assert.equal(r.publishable, true, "the DATA is complete, so data checks pass");
  assert.equal(r.requiresCredit, true, "but a rendered credit is still owed");
});

test("a licence string alone never graduates an asset to rights_verified", () => {
  assert.equal(classifyRights(asset({ license: "CC BY 4.0" })), "rights_uncertain");
  assert.equal(
    classifyRights(asset({ license: "CC BY 4.0", rights_status: "verified" })),
    "rights_uncertain",
    "verified flag without a source URL is still uncertain"
  );
  assert.equal(
    classifyRights(asset({ license: "CC BY 4.0", rights_status: "verified", source_url: "https://example.com/x" })),
    "rights_uncertain",
    "no creator for an attribution licence is still uncertain"
  );
});

// ---------------------------------------------------------------------------
// The five classes
// ---------------------------------------------------------------------------

test("the five rights classes are distinguished", () => {
  assert.equal(classifyRights(REAL_COMMONS), "rights_verified");
  assert.equal(classifyRights(asset({ rights_status: "restricted", source_type: "public_domain_or_cc" })), "rights_restricted");
  assert.equal(classifyRights(asset({ source_type: "tc_graphic", owned: true })), "generated_original");
  assert.equal(classifyRights(asset({ source_type: "staff_photograph" })), "owned_original");
  assert.equal(classifyRights(asset({ source_type: "manufacturer" })), "rights_uncertain");
});

test("restricted beats every other signal", () => {
  const a = asset({ ...REAL_COMMONS, rights_status: "restricted" });
  assert.equal(classifyRights(a), "rights_restricted");
  assert.equal(evaluateProvenance(a).publishable, false);
});

test("our own work needs no external credit; everyone else's does", () => {
  assert.equal(requiresRenderedCredit(asset({ source_type: "tc_graphic", owned: true })), false);
  assert.equal(requiresRenderedCredit(asset({ source_type: "staff_photograph" })), false);
  assert.equal(requiresRenderedCredit(REAL_COMMONS), true);
});

test("CC0 and public domain need no credit even though externally sourced", () => {
  const cc0 = asset({
    source_type: "public_domain_or_cc", rights_status: "verified", license: "CC0",
    source_url: "https://commons.wikimedia.org/wiki/File:X.jpg", attribution_required: false,
  });
  assert.equal(classifyRights(cc0), "rights_verified");
  assert.equal(requiresRenderedCredit(cc0), false);
  assert.equal(evaluateProvenance(cc0).publishable, true);
});

// ---------------------------------------------------------------------------
// Fails closed
// ---------------------------------------------------------------------------

test("every missing provenance field blocks, and names itself", () => {
  const cases: [Partial<ProvenanceAsset>, string][] = [
    [{ source_url: null }, "provenance_no_source_url"],
    [{ license: "Some Bespoke Licence" }, "provenance_unrecognised_licence"],
    [{ creator: null, attribution: null }, "provenance_no_creator"],
    [{ rights_status: "pending_verification" }, "rights_unverified"],
  ];
  for (const [patch, expected] of cases) {
    const r = evaluateProvenance(asset({ ...REAL_COMMONS, ...patch }));
    assert.equal(r.publishable, false, expected);
    const codes = r.findings.filter((f) => f.severity === "blocker").map((f) => f.code);
    assert.ok(codes.includes(expected), `expected ${expected}, got ${codes.join(",")}`);
  }
});

test("a malformed source URL is not a source URL", () => {
  for (const u of ["not-a-url", "javascript:alert(1)", "", "   "]) {
    const r = evaluateProvenance(asset({ ...REAL_COMMONS, source_url: u }));
    assert.equal(r.publishable, false, u);
  }
});

test("uncertainty is not permission", () => {
  const unresolved = asset({ source_type: "manufacturer", license: "CC BY 4.0" });
  assert.equal(classifyRights(unresolved), "rights_uncertain");
  assert.equal(evaluateProvenance(unresolved).publishable, false);
});

// ---------------------------------------------------------------------------
// Internal consistency
// ---------------------------------------------------------------------------

test("contradictory fields are reported rather than silently resolved", () => {
  const r = evaluateProvenance(asset({
    source_type: "public_domain_or_cc", rights_status: "verified", license: "CC0",
    source_url: "https://commons.wikimedia.org/wiki/File:X.jpg", attribution_required: true,
  }));
  assert.ok(r.findings.some((f) => f.code === "provenance_inconsistent_attribution"));
});

test("owned work carrying an external source URL is flagged", () => {
  const r = evaluateProvenance(asset({
    source_type: "public_domain_or_cc", rights_status: "verified", license: "CC0",
    source_url: "https://example.com/photo.jpg", owned: true,
  }));
  assert.ok(r.findings.some((f) => f.code === "provenance_owned_but_external"));
});

test("AI-generated originals are flagged as illustration, never documentary", () => {
  const r = evaluateProvenance(asset({ source_type: "tc_graphic", owned: true, ai_generated: true }));
  assert.ok(r.findings.some((f) => f.code === "generated_ai_imagery"));
  assert.equal(r.publishable, true, "a labelling rule, not a rights block");
});

test("every blocker carries an actionable message, not just a code", () => {
  const r = evaluateProvenance(asset({ source_type: "manufacturer" }));
  for (const f of r.findings) {
    assert.ok(f.message.length > 25, f.code);
    assert.ok(!/^[A-Z_]+$/.test(f.message), `message for ${f.code} is just a code`);
  }
});
