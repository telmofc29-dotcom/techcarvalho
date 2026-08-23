import { test } from "node:test";
import assert from "node:assert/strict";
import {
  readSpecValue,
  validateProduct,
  validateRelationship,
  LENS_SPEC_FIELDS,
  PRINTER_SPEC_FIELDS,
  type SpecField,
} from "./research-schema.ts";

const numField: SpecField = { key: "weight_g", name: "Weight", slug: "w", dataType: "number", unit: "g" };
const boolField: SpecField = { key: "weather_sealed", name: "Sealed", slug: "s", dataType: "boolean", unit: null };
const textField: SpecField = { key: "mount", name: "Mount", slug: "m", dataType: "text", unit: null };

const lens = (over: Record<string, unknown> = {}) => ({
  name: "Canon RF 50mm F1.8 STM",
  slug: "canon-rf-50mm-f1-8-stm",
  manufacturer_slug: "canon",
  ...over,
});

// --- the central rule ------------------------------------------------------

test("NULL IS ABSENCE, NEVER A VALUE", () => {
  // The manufacturer not stating something is a fact, and it is written as no
  // spec row at all. Turning it into 0 or "" would put a number in a table that
  // reads to a visitor as something the manufacturer said.
  for (const blank of [null, undefined, "", "   "]) {
    assert.deepEqual(readSpecValue(numField, blank), { skip: true }, `${JSON.stringify(blank)} must skip`);
  }
});

test("PLACEHOLDER STRINGS ARE NOT DATA", () => {
  // A researcher under pressure to fill a field writes "N/A". Accepting it puts
  // the string "Unknown" in a specification table.
  for (const junk of ["N/A", "n/a", "Unknown", "not stated", "TBD", "-", "—", "?", "null"]) {
    assert.deepEqual(readSpecValue(textField, junk), { skip: true }, `${junk} must skip`);
  }
});

test("a number field rejects a value carrying units rather than parsing it", () => {
  // "900g" silently becoming 900 is how a mis-shaped record enters looking fine.
  const r = readSpecValue(numField, "900g");
  assert.ok("issue" in r, "expected an issue, got " + JSON.stringify(r));
  assert.deepEqual(readSpecValue(numField, 900), { value: 900 });
  assert.deepEqual(readSpecValue(numField, "900"), { value: 900 });
  // A comma decimal is a real form in European sources.
  assert.deepEqual(readSpecValue(numField, "0,21"), { value: 0.21 });
});

test("NaN and Infinity are rejected, not stored", () => {
  assert.ok("issue" in readSpecValue(numField, Number.NaN));
  assert.ok("issue" in readSpecValue(numField, Number.POSITIVE_INFINITY));
});

test("a boolean field never treats an arbitrary string as true", () => {
  assert.deepEqual(readSpecValue(boolField, true), { value: true });
  assert.deepEqual(readSpecValue(boolField, "yes"), { value: true });
  assert.deepEqual(readSpecValue(boolField, "no"), { value: false });
  // The dangerous case: any non-empty string is truthy in JavaScript.
  assert.ok("issue" in readSpecValue(boolField, "dust and moisture resistant"));
  assert.ok("issue" in readSpecValue(boolField, 1));
});

// --- product identity ------------------------------------------------------

test("a record without identity is rejected outright, not partially imported", () => {
  assert.ok("rejected" in validateProduct({ name: "X" }, LENS_SPEC_FIELDS));
  assert.ok("rejected" in validateProduct({ slug: "x" }, LENS_SPEC_FIELDS));
  assert.ok("rejected" in validateProduct(lens({ slug: "Canon RF 50" }), LENS_SPEC_FIELDS), "slug must be url-safe");
  assert.ok("rejected" in validateProduct({ name: "X", slug: "x" }, LENS_SPEC_FIELDS), "no manufacturer");
});

test("only stated fields become specs — absence produces no row", () => {
  const r = validateProduct(
    lens({ weight_g: 160, filter_diameter_mm: 43, aperture_blades: null, elements: undefined }),
    LENS_SPEC_FIELDS
  );
  assert.ok("product" in r);
  const slugs = r.product.specs.map((s) => s.field.key);
  assert.ok(slugs.includes("weight_g"));
  assert.ok(slugs.includes("filter_diameter_mm"));
  assert.ok(!slugs.includes("aperture_blades"), "null must not produce a spec");
  assert.ok(!slugs.includes("elements"), "undefined must not produce a spec");
});

test("a badly shaped value is REPORTED, not silently dropped", () => {
  // Absence and corruption are different: one is normal, the other is a defect
  // in the research and someone needs to see it.
  const r = validateProduct(lens({ weight_g: "about 160 grams" }), LENS_SPEC_FIELDS);
  assert.ok("product" in r);
  assert.equal(r.issues.length, 1);
  assert.equal(r.issues[0].field, "weight_g");
  assert.ok(!r.product.specs.some((s) => s.field.key === "weight_g"));
});

// --- claims are not specs --------------------------------------------------

test("A STABILISATION STOPS FIGURE IS A CLAIM, NOT A SPEC", () => {
  // "Up to 8 stops" is an assertion by the party selling the lens, under
  // conditions nobody states. A spec row would read as a property of the object.
  const r = validateProduct(lens({ stabilisation: "IS", stabilisation_stops_claim: "5.5" }), LENS_SPEC_FIELDS);
  assert.ok("product" in r);
  assert.ok(
    !r.product.specs.some((s) => s.field.key.includes("stops")),
    "no stops spec may exist"
  );
  assert.equal(r.product.claims.length, 1);
  assert.match(r.product.claims[0].claim, /5\.5 stops/);
  assert.equal(r.product.claims[0].kind, "manufacturer_performance");
  // The stabilisation TYPE is a genuine spec and does survive.
  assert.ok(r.product.specs.some((s) => s.field.key === "stabilisation"));
});

test("printer speed fields are not in the spec vocabulary at all", () => {
  // 600 mm/s is a manufacturer maximum nobody prints at. It must be
  // structurally impossible for it to become a spec row.
  const keys = PRINTER_SPEC_FIELDS.map((f) => f.key);
  for (const forbidden of ["max_speed_mms", "print_speed", "acceleration", "speed", "max_acceleration"]) {
    assert.ok(!keys.includes(forbidden), `${forbidden} must not be a printer spec field`);
  }
});

test("manufacturer claims are carried through with their wording intact", () => {
  const r = validateProduct(
    lens({ manufacturer_claims: [{ claim: "Up to 16x faster", source_url: "https://example.invalid/x" }] }),
    LENS_SPEC_FIELDS
  );
  assert.ok("product" in r);
  assert.equal(r.product.claims[0].claim, "Up to 16x faster");
  assert.equal(r.product.claims[0].sourceUrl, "https://example.invalid/x");
});

// --- maturity --------------------------------------------------------------

test("maturity defaults to unknown and never guesses", () => {
  const bare = validateProduct(lens(), LENS_SPEC_FIELDS);
  assert.ok("product" in bare);
  assert.equal(bare.product.maturity, "unknown");

  const shipping = validateProduct(lens({ status: "shipping" }), LENS_SPEC_FIELDS);
  assert.ok("product" in shipping);
  assert.equal(shipping.product.maturity, "commercially_available");

  const invented = validateProduct(lens({ maturity: "coming_soon" }), LENS_SPEC_FIELDS);
  assert.ok("product" in invented);
  assert.equal(invented.product.maturity, "unknown", "an unknown maturity must fall back, not pass through");
  assert.equal(invented.issues.length, 1);
});

test("a non-ISO announced date is reported and dropped, not stored", () => {
  const r = validateProduct(lens({ announced: "September 2020" }), LENS_SPEC_FIELDS);
  assert.ok("product" in r);
  assert.equal(r.product.announced, null);
  assert.equal(r.issues[0].field, "announced");
});

// --- relationships ---------------------------------------------------------

test("A RELATIONSHIP WITHOUT A BASIS IS REJECTED", () => {
  // The brief forbids inferring a successor from matching focal lengths. That is
  // only enforceable if the reason travels with the edge.
  const r = validateRelationship({ from_slug: "a", to_slug: "b", type: "successor_of" });
  assert.ok("rejected" in r);
  assert.match(r.rejected, /basis/);
});

test("predecessor is refused because the reverse is inferred", () => {
  const r = validateRelationship({ from_slug: "a", to_slug: "b", type: "predecessor", basis: "x" });
  assert.ok("rejected" in r);
});

test("an unknown relationship type is refused rather than coerced", () => {
  const r = validateRelationship({ from_slug: "a", to_slug: "b", type: "kind_of", basis: "x" });
  assert.ok("rejected" in r, "kind_of belongs to technology_relationships, not products");
});

test("a self-relationship is refused", () => {
  assert.ok("rejected" in validateRelationship({ from_slug: "a", to_slug: "a", type: "same_family", basis: "x" }));
});

test("a well-formed relationship survives with its basis and source", () => {
  const r = validateRelationship({
    from_slug: "canon-rf-50mm-f1-8-stm",
    to_slug: "canon-ef-50mm-f1-8-stm",
    type: "mount_successor",
    basis: "Canon positions the RF 50 STM as the RF-mount equivalent of the EF 50 STM",
    source_url: "https://example.invalid/canon",
  });
  assert.ok(!("rejected" in r));
  assert.equal(r.type, "mount_successor");
  assert.ok(r.basis && r.basis.length > 10);
});

test("every spec field maps to a url-safe definition slug", () => {
  for (const f of [...LENS_SPEC_FIELDS, ...PRINTER_SPEC_FIELDS]) {
    assert.match(f.slug, /^[a-z0-9-]+$/, `${f.key} -> ${f.slug}`);
    assert.ok(f.name.length > 0);
  }
});

test("MONTH-PRECISION DATES ARE KEPT, AND THEIR PRECISION WITH THEM", () => {
  // Canon announces lenses as "2019-09". Rejecting that discards real
  // information; storing it as the 1st and rendering "1 Sep 2019" publishes a
  // fabricated day. Both were wrong; the precision travels with the date.
  const r = validateProduct(lens({ announced: "2019-09" }), LENS_SPEC_FIELDS);
  assert.ok("product" in r);
  assert.equal(r.product.announced, "2019-09-01");
  assert.equal(r.product.announcedPrecision, "month");
  assert.equal(r.issues.length, 0, "a month-precision date is not an issue");
});

test("day and year precision are distinguished too", () => {
  const day = validateProduct(lens({ announced: "2019-09-28" }), LENS_SPEC_FIELDS);
  assert.ok("product" in day);
  assert.equal(day.product.announcedPrecision, "day");

  const year = validateProduct(lens({ announced: "2019" }), LENS_SPEC_FIELDS);
  assert.ok("product" in year);
  assert.equal(year.product.announced, "2019-01-01");
  assert.equal(year.product.announcedPrecision, "year");
});

test("a date with no precision at all is 'unknown', not a guess", () => {
  const none = validateProduct(lens(), LENS_SPEC_FIELDS);
  assert.ok("product" in none);
  assert.equal(none.product.announced, null);
  assert.equal(none.product.announcedPrecision, "unknown");

  const junk = validateProduct(lens({ announced: "September 2019" }), LENS_SPEC_FIELDS);
  assert.ok("product" in junk);
  assert.equal(junk.product.announced, null);
  assert.equal(junk.issues.length, 1);
});
