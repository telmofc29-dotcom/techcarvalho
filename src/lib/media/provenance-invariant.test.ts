// Regression tests for media_assets_external_verified_needs_provenance.
//
// THE PRODUCTION FAILURE THESE REPRODUCE
// --------------------------------------
// Digest 994149443. An asset uploaded with no source type, no licence and no
// creator was edited on /admin/media/[id] and saved with Rights status =
// Verified. The database refused it:
//
//   new row for relation "media_assets" violates check constraint
//   "media_assets_external_verified_needs_provenance"
//
// updateMediaProvenance had no error channel — it returned Promise<void> and
// let updateRow's throw escape the Server Action, which React reports to the
// browser as a masked #441. The admin saw a red box naming neither the rule nor
// the missing field.
//
// The constraint is correct and stays. These lock in that the application
// refuses the same state FIRST, with a message that says what is missing.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  SELF_SOURCED_TYPES,
  explainProvenanceRequirement,
  satisfiesProvenanceInvariant,
} from "./provenance-invariant.ts";

// --- The exact state behind digest 994149443 ---------------------------------

test("DIGEST 994149443: verified + externally sourced + no provenance is refused", () => {
  const row = {
    rights_status: "verified" as const,
    owned: false,
    source_type: null,
    source_url: null,
    license: null,
    creator: null,
    attribution: null,
  };
  assert.equal(satisfiesProvenanceInvariant(row), false);

  const message = explainProvenanceRequirement(row);
  assert.ok(message, "must produce a message, not null");
  assert.match(message, /cannot be marked Verified/i);
  assert.match(message, /Source URL/);
  assert.match(message, /License/);
  assert.match(message, /Creator or Attribution/);
});

test("the message tells the admin how to resolve it, not just that it failed", () => {
  const message = explainProvenanceRequirement({
    rights_status: "verified",
    owned: false,
    source_type: "public_domain_or_cc",
  });
  assert.ok(message);
  assert.match(message, /Owned by Tech Carvalho/i, "offers the ownership route");
  assert.match(message, /Staff photograph|TechCarvalho-created/i, "offers the self-sourced route");
});

// --- The three exemptions the constraint grants ------------------------------

test("owned assets are exempt", () => {
  assert.equal(
    satisfiesProvenanceInvariant({ rights_status: "verified", owned: true, source_type: null }),
    true
  );
});

test("staff photographs and tc_graphic are exempt", () => {
  for (const source_type of SELF_SOURCED_TYPES) {
    assert.equal(
      satisfiesProvenanceInvariant({ rights_status: "verified", owned: false, source_type }),
      true,
      `${source_type} should be exempt`
    );
  }
});

test("full provenance satisfies it without ownership", () => {
  assert.equal(
    satisfiesProvenanceInvariant({
      rights_status: "verified",
      owned: false,
      source_type: "public_domain_or_cc",
      source_url: "https://commons.wikimedia.org/wiki/File:Example.jpg",
      license: "CC BY-SA 4.0",
      creator: "Some Photographer",
    }),
    true
  );
  assert.equal(explainProvenanceRequirement({
    rights_status: "verified",
    owned: false,
    source_type: "public_domain_or_cc",
    source_url: "https://example.org/x",
    license: "CC BY 4.0",
    attribution: "Photo by X, CC BY 4.0",
  }), null, "attribution satisfies the creator-or-attribution half");
});

// --- Anything not 'verified' is unconstrained --------------------------------

test("non-verified rights statuses are never blocked", () => {
  for (const rights_status of ["unknown", "pending_verification", "restricted"] as const) {
    assert.equal(
      satisfiesProvenanceInvariant({ rights_status, owned: false, source_type: null }),
      true,
      `${rights_status} must not require provenance`
    );
  }
});

// --- Boundary cases the SQL and this must agree on ---------------------------

test("NULL owned does NOT exempt, matching SQL three-valued logic", () => {
  // In SQL `owned = true` evaluates to NULL when owned is NULL, and a CHECK
  // passes only on TRUE. Using !!owned here would be more permissive than the
  // database and would let the crash back in for null-owned rows.
  assert.equal(
    satisfiesProvenanceInvariant({ rights_status: "verified", owned: null, source_type: null }),
    false
  );
});

test("partial provenance is still refused, and names only what is missing", () => {
  const message = explainProvenanceRequirement({
    rights_status: "verified",
    owned: false,
    source_type: "stock_licensed",
    source_url: "https://example.com/asset",
    license: null,
    creator: "A Person",
  });
  assert.ok(message);
  assert.match(message, /License/, "the missing field is named");
  assert.doesNotMatch(message, /Missing:[^.]*Source URL/, "a field that IS present is not listed as missing");
  assert.doesNotMatch(message, /Missing:[^.]*Creator/, "creator is present, so not listed");
});

test("empty and whitespace-only strings count as absent", () => {
  assert.equal(
    satisfiesProvenanceInvariant({
      rights_status: "verified",
      owned: false,
      source_type: "stock_licensed",
      source_url: "   ",
      license: "",
      creator: "  ",
    }),
    false,
    "a blank form field is not provenance"
  );
});

// --- The self-sourced list must not silently drift from the SQL --------------

test("SELF_SOURCED_TYPES matches the constraint's exemption list exactly", () => {
  assert.deepEqual([...SELF_SOURCED_TYPES], ["staff_photograph", "tc_graphic"]);
});

// ---------------------------------------------------------------------------
// media_assets_licence_modification_attributed
// ---------------------------------------------------------------------------
//
// A judgement about a licence needs an author and a date. Nothing in the
// application ever wrote licence_modification_assessed_at/by, so EVERY attempt
// to record a modification judgement was rejected — including the upload form's
// "Owned by Tech Carvalho" tickbox, which submits a hidden
// licence_permits_modification=true. Ticking "this is my own photograph" made
// the upload fail.

import { satisfiesModificationAttribution, stampModificationAssessment } from "./provenance-invariant.ts";

const ADMIN = "11111111-2222-3333-4444-555555555555";
const NOW = "2026-08-24T12:00:00.000Z";

test("the upload form's owned tickbox produced an unattributed judgement", () => {
  // Exactly what the form submitted before the fix.
  assert.equal(satisfiesModificationAttribution({ licence_permits_modification: true }), false);
});

test("stamping makes that same payload valid", () => {
  const stamped = stampModificationAssessment({ licence_permits_modification: true }, ADMIN, NOW);
  assert.equal(satisfiesModificationAttribution(stamped), true);
  assert.equal(stamped.licence_modification_assessed_by, ADMIN);
  assert.equal(stamped.licence_modification_assessed_at, NOW);
});

test("a false judgement is still a judgement and is attributed", () => {
  const stamped = stampModificationAssessment({ licence_permits_modification: false }, ADMIN, NOW);
  assert.equal(satisfiesModificationAttribution(stamped), true);
  assert.equal(stamped.licence_modification_assessed_by, ADMIN);
});

test("setting it back to 'not assessed' clears the assessor", () => {
  const stamped = stampModificationAssessment(
    { licence_permits_modification: null, licence_modification_assessed_at: NOW, licence_modification_assessed_by: ADMIN },
    ADMIN,
    NOW
  );
  assert.equal(stamped.licence_modification_assessed_at, null);
  assert.equal(stamped.licence_modification_assessed_by, null);
  assert.equal(satisfiesModificationAttribution(stamped), true);
});

test("PATCH-safe: a payload that never mentions the field is untouched", () => {
  const patch = { caption: "just a caption" };
  const stamped = stampModificationAssessment(patch, ADMIN, NOW);
  assert.deepEqual(stamped, patch);
  assert.ok(!("licence_modification_assessed_at" in stamped), "must not invent an assessment");
});

test("null and undefined both count as unassessed", () => {
  assert.equal(satisfiesModificationAttribution({}), true);
  assert.equal(satisfiesModificationAttribution({ licence_permits_modification: null }), true);
});
