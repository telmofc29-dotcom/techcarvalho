// Regression tests for the media upload form's enumerated choices.
//
// THE DEFECT THESE EXIST TO PREVENT
// ---------------------------------
// /admin/media/new offered "Public domain / Creative Commons" and
// "TechCarvalho-created graphic/diagram" in its Source type menu. The server
// action that receives the submission checked against a separate, hand-written
// array which omitted both, so choosing either produced "Choose a valid source
// type." and no upload — for two values the production database accepts (both
// verified by direct insert against production before the fix).
//
// The omission was invisible to the compiler because the allow-list was an
// ARRAY annotated with the union:
//
//     const VALID_SOURCE_TYPES: MediaSourceType[] = ["manufacturer", ...];
//
// A short array satisfies that annotation. Nothing reports the missing members.
//
// So these tests assert the two properties that actually matter, rather than
// that the module exists:
//
//   1. EVERY member of each database union is offered by the form. A value the
//      schema permits but no menu exposes is a capability quietly lost.
//   2. EVERY value the form offers is accepted by the validator the server
//      action uses. This is the direction that broke, and it is asserted per
//      option so a failure names the exact offending value.
//
// Both directions are needed. Deriving one list from the other makes them equal
// by construction today; these tests are what fail if someone re-introduces a
// second hand-maintained copy tomorrow.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ASSET_ROLE_OPTIONS,
  ASSET_ROLES_PENDING_MIGRATION,
  BRAND_ROLE_OPTIONS,
  MEDIA_TYPE_OPTIONS,
  RIGHTS_STATUS_OPTIONS,
  SOURCE_TYPE_OPTIONS,
  VALID_ASSET_ROLES,
  VALID_BRAND_ROLES,
  VALID_MEDIA_TYPES,
  VALID_RIGHTS_STATUSES,
  VALID_SOURCE_TYPES,
  isValidAssetRole,
  isValidBrandRole,
  isValidMediaType,
  isValidRightsStatus,
  isValidSourceType,
  type MediaOption,
} from "./form-options.ts";

// The database unions, restated here as literal string arrays ON PURPOSE.
//
// Importing the TypeScript union would make this test tautological — it would
// compare the module against itself. Node's type stripping erases types at
// runtime anyway, so a union cannot be enumerated at runtime even if we wanted
// it to be. Restating the values means adding a member to database.ts without
// adding it here fails this test, which is the reminder that the menu and the
// validator both need it too.
//
// These lists are kept in sync with src/lib/types/database.ts by hand, exactly
// as that file is kept in sync with supabase/migrations/*.sql by hand.
const DB_MEDIA_TYPES = ["image", "video"];

const DB_SOURCE_TYPES = [
  "manufacturer",
  "staff_photograph",
  "stock_licensed",
  "user_submitted",
  "press_kit",
  "public_domain_or_cc",
  "tc_graphic",
  "other",
];

const DB_ASSET_ROLES = [
  "product_photo",
  "article_hero",
  "banner",
  "category_hero",
  "homepage_feature",
  "background",
  "diagram",
  "chart",
  "comparison_graphic",
  "social_og",
  "logo_brand",
  "icon",
  "screenshot",
  "concept_render",
];

const DB_BRAND_ROLES = [
  "logo_full",
  "logo_full_tagline",
  "wordmark",
  "wordmark_tagline",
  "mark",
  "favicon",
  "og_image",
];

const DB_RIGHTS_STATUSES = ["unknown", "pending_verification", "verified", "restricted"];

function sorted(values: readonly string[]): string[] {
  return [...values].sort();
}

function offeredValues(options: readonly MediaOption<string>[]): string[] {
  return options.map((o) => o.value);
}

// --- 1. The form offers every value the schema permits -----------------------

const COVERAGE: [string, readonly MediaOption<string>[], string[]][] = [
  ["media type", MEDIA_TYPE_OPTIONS, DB_MEDIA_TYPES],
  ["source type", SOURCE_TYPE_OPTIONS, DB_SOURCE_TYPES],
  ["asset role", ASSET_ROLE_OPTIONS, DB_ASSET_ROLES],
  ["brand role", BRAND_ROLE_OPTIONS, DB_BRAND_ROLES],
  ["rights status", RIGHTS_STATUS_OPTIONS, DB_RIGHTS_STATUSES],
];

for (const [name, options, dbValues] of COVERAGE) {
  test(`${name}: the form offers exactly the values the schema permits`, () => {
    assert.deepEqual(
      sorted(offeredValues(options)),
      sorted(dbValues),
      `The ${name} menu and the database union have diverged. A value in the ` +
        `menu but not the schema fails on insert; a value in the schema but not ` +
        `the menu cannot be chosen at all.`
    );
  });
}

// --- 2. The validator accepts every value the form offers --------------------

const VALIDATION: [string, readonly MediaOption<string>[], (v: string) => boolean][] = [
  ["media type", MEDIA_TYPE_OPTIONS, isValidMediaType],
  ["source type", SOURCE_TYPE_OPTIONS, isValidSourceType],
  ["asset role", ASSET_ROLE_OPTIONS, isValidAssetRole],
  ["brand role", BRAND_ROLE_OPTIONS, isValidBrandRole],
  ["rights status", RIGHTS_STATUS_OPTIONS, isValidRightsStatus],
];

for (const [name, options, isValid] of VALIDATION) {
  test(`${name}: every offered option passes the server action's validator`, () => {
    for (const option of options) {
      assert.equal(
        isValid(option.value),
        true,
        `The ${name} menu offers "${option.label}" (${option.value}) but the ` +
          `server action rejects it. This is the exact defect that made ` +
          `"Public domain / Creative Commons" and "TechCarvalho-created ` +
          `graphic/diagram" un-uploadable.`
      );
    }
  });
}

// --- 3. The two values that actually regressed -------------------------------

test("source type: public_domain_or_cc is offered and accepted", () => {
  assert.ok(
    offeredValues(SOURCE_TYPE_OPTIONS).includes("public_domain_or_cc"),
    "licensed external media must be selectable"
  );
  assert.equal(isValidSourceType("public_domain_or_cc"), true);
  assert.ok(VALID_SOURCE_TYPES.includes("public_domain_or_cc"));
});

test("source type: tc_graphic is offered and accepted", () => {
  assert.ok(
    offeredValues(SOURCE_TYPE_OPTIONS).includes("tc_graphic"),
    "TechCarvalho's own graphics must be selectable"
  );
  assert.equal(isValidSourceType("tc_graphic"), true);
  assert.ok(VALID_SOURCE_TYPES.includes("tc_graphic"));
});

// --- 4. Invented values are still refused ------------------------------------
//
// The fix widened the allow-lists. These assert it did not widen them into
// accepting anything at all, which would move the failure to the database and
// turn a clear form error into a raw constraint violation.

test("validators refuse values outside the schema", () => {
  assert.equal(isValidMediaType("audio"), false);
  assert.equal(isValidSourceType("definitely_not_a_source"), false);
  assert.equal(isValidAssetRole("product_photograph"), false, "near-miss of product_photo");
  assert.equal(isValidBrandRole("logo"), false, "near-miss of logo_full");
  assert.equal(isValidRightsStatus("ok"), false);
  assert.equal(isValidSourceType(""), false, "empty string is 'not specified', handled before validation");
});

// --- 5. Concept renders stay distinguishable ---------------------------------
//
// A concept render depicts something that does not exist. It must remain its
// own role rather than collapsing into product photography.

test("concept_render is a distinct role, separate from product_photo", () => {
  assert.ok(VALID_ASSET_ROLES.includes("concept_render"));
  assert.ok(VALID_ASSET_ROLES.includes("product_photo"));
  assert.notEqual(
    ASSET_ROLE_OPTIONS.find((o) => o.value === "concept_render")?.label,
    ASSET_ROLE_OPTIONS.find((o) => o.value === "product_photo")?.label
  );
});

test("concept_render's label states what it is, so it cannot be picked by accident", () => {
  const label = ASSET_ROLE_OPTIONS.find((o) => o.value === "concept_render")?.label ?? "";
  assert.match(label, /concept/i);
  assert.match(label, /unreleased|unrevealed/i);
});

test("the pending-migration list names concept_render and nothing already applied", () => {
  // The hint the upload action shows points at a migration in
  // migrations_pending/. Listing an already-applied role here would send an
  // admin to run a migration that is not their problem.
  assert.deepEqual([...ASSET_ROLES_PENDING_MIGRATION], ["concept_render"]);
  for (const role of ASSET_ROLES_PENDING_MIGRATION) {
    assert.ok(
      VALID_ASSET_ROLES.includes(role),
      "a role pending migration must still be a real role the code knows about"
    );
  }
});

// --- 6. Option lists are well-formed -----------------------------------------

for (const [name, options] of COVERAGE.map(([n, o]) => [n, o] as const)) {
  test(`${name}: options have unique values and non-empty labels`, () => {
    const values = offeredValues(options);
    assert.equal(new Set(values).size, values.length, "duplicate option values");
    for (const option of options) {
      assert.notEqual(option.label.trim(), "", `empty label for ${option.value}`);
      assert.notEqual(option.value.trim(), "", "empty option value");
    }
  });
}

test("the derived allow-lists match the offered options exactly", () => {
  assert.deepEqual(VALID_MEDIA_TYPES, offeredValues(MEDIA_TYPE_OPTIONS));
  assert.deepEqual(VALID_SOURCE_TYPES, offeredValues(SOURCE_TYPE_OPTIONS));
  assert.deepEqual(VALID_ASSET_ROLES, offeredValues(ASSET_ROLE_OPTIONS));
  assert.deepEqual(VALID_BRAND_ROLES, offeredValues(BRAND_ROLE_OPTIONS));
  assert.deepEqual(VALID_RIGHTS_STATUSES, offeredValues(RIGHTS_STATUS_OPTIONS));
});
