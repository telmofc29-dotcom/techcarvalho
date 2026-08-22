import { test } from "node:test";
import assert from "node:assert/strict";
import { validateGraphicSpec, findForbiddenKeys, buildAltText } from "./validate.ts";
import { TC_ORIGINAL_GRAPHIC_RIGHTS, ASSET_ROLE_BY_KIND } from "./types.ts";
import type { ChartSpec, ComparisonSpec, SpecDiagramSpec, TimelineSpec } from "./types.ts";

const provenance = { sourceLabel: "Manufacturer published specifications", asOf: "2026-08-19" };

const chart = () => ({
  kind: "chart",
  slug: "gpu-memory-bandwidth",
  title: "Memory bandwidth",
  chartType: "bar",
  unit: "GB/s",
  categories: ["Card A", "Card B", "Card C"],
  series: [{ name: "Bandwidth", points: [448, 576, null] }],
  provenance,
});

const comparison = () => ({
  kind: "comparison",
  slug: "a-vs-b",
  title: "A vs B",
  left: { name: "A" },
  right: { name: "B" },
  rows: [{ label: "Sensor", left: "45 MP", right: null }],
  provenance,
});

const diagram = () => ({
  kind: "spec_diagram",
  slug: "sensor-layout",
  title: "Sensor layout",
  subject: "Camera body",
  bodyShape: "rounded",
  callouts: [{ label: "Sensor", value: "Full frame" }, { label: "Mount", value: null }],
  provenance,
});

const timeline = () => ({
  kind: "timeline",
  slug: "mount-history",
  title: "Mount history",
  events: [
    { date: "2018-09", label: "First body" },
    { date: "2020", label: "Second body" },
  ],
  provenance,
});

// ---- the rights firewall ----

test("a spec file cannot assert rights metadata at the top level", () => {
  const result = validateGraphicSpec({ ...chart(), owned: true, rights_status: "verified" });
  assert.equal(result.ok, false);
  assert.ok(result.ok === false && result.errors.some((e) => e.includes("rights/provenance metadata cannot be set")));
});

test("rights metadata is rejected at any nesting depth", () => {
  const sneaky = chart() as Record<string, unknown>;
  sneaky.series = [{ name: "Bandwidth", points: [1, 2, 3], source_type: "manufacturer" }];
  const result = validateGraphicSpec(sneaky);
  assert.equal(result.ok, false);
  assert.ok(result.ok === false && result.errors.some((e) => e.includes("series[0].source_type")));
});

test("findForbiddenKeys reports every offending path", () => {
  const found = findForbiddenKeys({ a: { owned: true }, list: [{ license: "CC0" }] });
  assert.deepEqual(found.sort(), ["spec.a.owned", "spec.list[0].license"]);
  assert.deepEqual(findForbiddenKeys({ title: "fine", rows: [{ label: "ok" }] }), []);
});

test("the emitted rights literals are exactly what the generator established", () => {
  assert.deepEqual(TC_ORIGINAL_GRAPHIC_RIGHTS, {
    source_type: "tc_graphic",
    owned: true,
    rights_status: "verified",
    ai_generated: false,
    attribution_required: false,
  });
});

test("asset roles are fixed per kind — a chart can never be filed as a product photo", () => {
  assert.equal(ASSET_ROLE_BY_KIND.chart, "chart");
  assert.equal(ASSET_ROLE_BY_KIND.comparison, "comparison_graphic");
  assert.equal(ASSET_ROLE_BY_KIND.spec_diagram, "diagram");
  assert.equal(ASSET_ROLE_BY_KIND.timeline, "diagram");
  assert.ok(!Object.values(ASSET_ROLE_BY_KIND).includes("product_photo"));
});

// ---- provenance is mandatory ----

test("provenance is required and must be a real dated day", () => {
  const noProv = chart() as Record<string, unknown>;
  delete noProv.provenance;
  assert.equal(validateGraphicSpec(noProv).ok, false);

  const bad = validateGraphicSpec({ ...chart(), provenance: { sourceLabel: "x", asOf: "2026-02-31" } });
  assert.equal(bad.ok, false);

  const vague = validateGraphicSpec({ ...chart(), provenance: { sourceLabel: "x", asOf: "2026" } });
  assert.equal(vague.ok, false);

  const unsourced = validateGraphicSpec({ ...chart(), provenance: { sourceLabel: "  ", asOf: "2026-08-19" } });
  assert.equal(unsourced.ok, false);
});

// ---- charts ----

test("a well-formed chart with an explicit gap validates", () => {
  const result = validateGraphicSpec(chart());
  assert.equal(result.ok, true);
});

test("ragged series are rejected rather than padded or truncated", () => {
  const spec = chart() as Record<string, unknown>;
  spec.series = [{ name: "Bandwidth", points: [448, 576] }];
  const result = validateGraphicSpec(spec);
  assert.equal(result.ok, false);
  assert.ok(result.ok === false && result.errors.some((e) => e.includes("has 2 values but there are 3 categories")));
});

test("a chart with no real values at all is refused", () => {
  const spec = chart() as Record<string, unknown>;
  spec.series = [{ name: "Bandwidth", points: [null, null, null] }];
  const result = validateGraphicSpec(spec);
  assert.equal(result.ok, false);
  assert.ok(result.ok === false && result.errors.some((e) => e.includes("no known values")));
});

test("numeric-looking strings are not accepted as measurements", () => {
  const spec = chart() as Record<string, unknown>;
  spec.series = [{ name: "Bandwidth", points: ["448", 576, null] }];
  const result = validateGraphicSpec(spec);
  assert.equal(result.ok, false);
  assert.ok(result.ok === false && result.errors.some((e) => e.includes("must be a finite number or null")));
});

test("NaN and Infinity are not measurements", () => {
  for (const bad of [Number.NaN, Number.POSITIVE_INFINITY]) {
    const spec = chart() as Record<string, unknown>;
    spec.series = [{ name: "Bandwidth", points: [bad, 1, 2] }];
    assert.equal(validateGraphicSpec(spec).ok, false);
  }
});

test("a chart must carry a unit", () => {
  const spec = chart() as Record<string, unknown>;
  delete spec.unit;
  const result = validateGraphicSpec(spec);
  assert.equal(result.ok, false);
  assert.ok(result.ok === false && result.errors.some((e) => e.includes("unit is required")));
});

// ---- comparison ----

test("a comparison row with nothing known on either side is refused", () => {
  const spec = comparison() as Record<string, unknown>;
  spec.rows = [{ label: "Sensor", left: null, right: null }];
  const result = validateGraphicSpec(spec);
  assert.equal(result.ok, false);
  assert.ok(result.ok === false && result.errors.some((e) => e.includes("says nothing")));
});

test("a comparison may only declare a winner explicitly", () => {
  const spec = comparison() as Record<string, unknown>;
  spec.rows = [{ label: "Sensor", left: "45 MP", right: "24 MP", favours: "better" }];
  assert.equal(validateGraphicSpec(spec).ok, false);

  const ok = comparison() as Record<string, unknown>;
  ok.rows = [{ label: "Sensor", left: "45 MP", right: "24 MP", favours: "left" }];
  assert.equal(validateGraphicSpec(ok).ok, true);
});

test("a valid comparison with one unknown side passes", () => {
  assert.equal(validateGraphicSpec(comparison()).ok, true);
});

// ---- spec diagram ----

test("spec diagrams accept only abstract body primitives", () => {
  const spec = diagram() as Record<string, unknown>;
  spec.bodyShape = "camera-silhouette";
  const result = validateGraphicSpec(spec);
  assert.equal(result.ok, false);
  assert.ok(result.ok === false && result.errors.some((e) => e.includes("abstract primitives only")));
  assert.equal(validateGraphicSpec(diagram()).ok, true);
});

test("a spec diagram where nothing is known is refused", () => {
  const spec = diagram() as Record<string, unknown>;
  spec.callouts = [{ label: "Sensor", value: null }];
  const result = validateGraphicSpec(spec);
  assert.equal(result.ok, false);
  assert.ok(result.ok === false && result.errors.some((e) => e.includes("no known specification values")));
});

// ---- timeline ----

test("timelines reject unparseable dates instead of guessing", () => {
  const spec = timeline() as Record<string, unknown>;
  spec.events = [
    { date: "sometime in 2019", label: "A" },
    { date: "2020", label: "B" },
  ];
  const result = validateGraphicSpec(spec);
  assert.equal(result.ok, false);
  assert.ok(result.ok === false && result.errors.some((e) => e.includes("must be YYYY, YYYY-MM or YYYY-MM-DD")));
});

test("a timeline needs at least two events", () => {
  const spec = timeline() as Record<string, unknown>;
  spec.events = [{ date: "2020", label: "only" }];
  assert.equal(validateGraphicSpec(spec).ok, false);
  assert.equal(validateGraphicSpec(timeline()).ok, true);
});

// ---- general shape ----

test("unknown kinds are refused", () => {
  assert.equal(validateGraphicSpec({ ...chart(), kind: "product_photo" }).ok, false);
  assert.equal(validateGraphicSpec(null).ok, false);
  assert.equal(validateGraphicSpec("chart").ok, false);
});

test("slugs must be kebab-case so filenames and seeds stay stable", () => {
  assert.equal(validateGraphicSpec({ ...chart(), slug: "Not A Slug" }).ok, false);
  assert.equal(validateGraphicSpec({ ...chart(), slug: "gpu-2026" }).ok, true);
});

test("attach must name exactly one target", () => {
  assert.equal(validateGraphicSpec({ ...chart(), attach: { role: "gallery" } }).ok, false);
  assert.equal(
    validateGraphicSpec({ ...chart(), attach: { contentSlug: "a", productSlug: "b", role: "gallery" } }).ok,
    false
  );
  assert.equal(validateGraphicSpec({ ...chart(), attach: { contentSlug: "a", role: "banner" } }).ok, false);
  assert.equal(validateGraphicSpec({ ...chart(), attach: { contentSlug: "a", role: "gallery" } }).ok, true);
});

// ---- alt text ----

test("alt text names the source, the date, and the number of gaps", () => {
  const alt = buildAltText(chart() as unknown as ChartSpec);
  assert.match(alt, /Original Tech Carvalho bar chart/);
  assert.match(alt, /GB\/s/);
  assert.match(alt, /1 data point not available and shown as gaps/);
  assert.match(alt, /Manufacturer published specifications, as of 2026-08-19/);
});

test("alt text discloses missing sides and unpublished specs", () => {
  assert.match(buildAltText(comparison() as unknown as ComparisonSpec), /value not available on one side/);
  assert.match(buildAltText(diagram() as unknown as SpecDiagramSpec), /1 of which are not published/);
  assert.match(buildAltText(diagram() as unknown as SpecDiagramSpec), /not a photograph/);
});

test("timeline alt text reports the real date range", () => {
  assert.match(buildAltText(timeline() as unknown as TimelineSpec), /from Sep 2018 to 2020/);
});
