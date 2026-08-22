import { test } from "node:test";
import assert from "node:assert/strict";
import { renderGraphicSvg, NO_DATA_LABEL, CANVAS_W, CANVAS_H, esc } from "./svg.ts";
import type { ChartSpec, ComparisonSpec, SpecDiagramSpec, TimelineSpec } from "./types.ts";

const provenance = { sourceLabel: "Manufacturer specifications", asOf: "2026-08-19" };

const chart = (points: (number | null)[]): ChartSpec => ({
  kind: "chart",
  slug: "bandwidth",
  title: "Memory bandwidth",
  chartType: "bar",
  unit: "GB/s",
  categories: ["A", "B", "C"],
  series: [{ name: "Bandwidth", points }],
  provenance,
});

const textNodes = (svg: string): string[] =>
  [...svg.matchAll(/<text\b[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]);

test("output is deterministic for a given spec", () => {
  assert.equal(renderGraphicSvg(chart([1, 2, 3])), renderGraphicSvg(chart([1, 2, 3])));
});

test("every graphic is stamped as a drawn diagram and carries its provenance", () => {
  for (const svg of [
    renderGraphicSvg(chart([1, 2, 3])),
    renderGraphicSvg({
      kind: "timeline",
      slug: "t",
      title: "T",
      events: [{ date: "2020", label: "a" }, { date: "2022", label: "b" }],
      provenance,
    } satisfies TimelineSpec),
  ]) {
    assert.match(svg, /original diagram, not a photograph/);
    assert.match(svg, /Manufacturer specifications/);
    assert.match(svg, /as of 2026-08-19/);
    assert.ok(svg.startsWith("<svg "), "must be a bare SVG document");
    assert.match(svg, new RegExp(`width="${CANVAS_W}" height="${CANVAS_H}"`));
  }
});

test("the renderer emits no bitmaps, external refs or arbitrary paths for the body", () => {
  const svg = renderGraphicSvg({
    kind: "spec_diagram",
    slug: "body",
    title: "Body",
    subject: "Camera body",
    bodyShape: "rounded",
    callouts: [{ label: "Sensor", value: "Full frame" }],
    provenance,
  } satisfies SpecDiagramSpec);
  assert.ok(!svg.includes("<image"), "no raster content may be embedded");
  assert.ok(!/href=/.test(svg), "no external references");
  assert.match(svg, /Schematic — proportions are not to scale/);
});

// ---- charts render only supplied values ----

test("a bar chart draws exactly as many bars as it has real values", () => {
  const full = renderGraphicSvg(chart([10, 20, 30]));
  const gapped = renderGraphicSvg(chart([10, null, 30]));
  const bars = (svg: string) => [...svg.matchAll(/rx="3" fill="#38bdf8"/g)].length;
  assert.equal(bars(full), 3);
  assert.equal(bars(gapped), 2, "a missing value must not become a bar");
});

test("a missing bar is shown as a labelled gap, never as zero", () => {
  const svg = renderGraphicSvg(chart([10, null, 30]));
  assert.ok(textNodes(svg).includes(NO_DATA_LABEL));
  const labels = textNodes(svg);
  assert.ok(labels.includes("10") && labels.includes("30"));
});

test("value labels come only from the data — no invented category values", () => {
  const svg = renderGraphicSvg(chart([10, null, 30]));
  // Axis ticks plus the two real values are the only numeric text on the canvas.
  const numeric = textNodes(svg).filter((t) => /^-?[\d,.]+$/.test(t));
  const ticks = ["0", "5", "10", "15", "20", "25", "30"];
  for (const value of numeric) {
    assert.ok(ticks.includes(value), `unexpected numeric label '${value}' on the canvas`);
  }
  assert.ok(numeric.filter((v) => v === "10").length >= 2, "10 appears as both a tick and a value label");
});

test("a line chart breaks at gaps instead of drawing through them", () => {
  const line = (points: (number | null)[]): ChartSpec => ({ ...chart(points), chartType: "line" });
  const seriesPaths = (svg: string) => [...svg.matchAll(/<path d="[^"]*" fill="none" stroke="#38bdf8" stroke-width="3"/g)].length;
  assert.equal(seriesPaths(renderGraphicSvg(line([1, 2, 3]))), 1);
  assert.equal(seriesPaths(renderGraphicSvg(line([1, null, 3]))), 2, "a gap must split the line into two paths");
});

test("a truncated value axis is captioned as such", () => {
  const truncated = renderGraphicSvg({ ...chart([980, 990, 1000]), chartType: "line", zeroBaseline: false });
  assert.match(truncated, /axis does not start at zero/);
  const zeroed = renderGraphicSvg(chart([980, 990, 1000]));
  assert.ok(!zeroed.includes("axis does not start at zero"));
});

// ---- comparison ----

test("a comparison marks an unknown side rather than leaving it blank", () => {
  const svg = renderGraphicSvg({
    kind: "comparison",
    slug: "a-vs-b",
    title: "A vs B",
    left: { name: "Alpha" },
    right: { name: "Beta" },
    rows: [{ label: "Sensor", left: "45 MP", right: null }],
    provenance,
  } satisfies ComparisonSpec);
  const labels = textNodes(svg);
  assert.ok(labels.includes("45 MP"));
  assert.ok(labels.includes(NO_DATA_LABEL));
  assert.ok(labels.includes("Alpha") && labels.includes("Beta"));
});

test("a comparison highlights a side only when the spec says to", () => {
  const base = {
    kind: "comparison" as const,
    slug: "a-vs-b",
    title: "A vs B",
    left: { name: "Alpha" },
    right: { name: "Beta" },
    provenance,
  };
  const neutral = renderGraphicSvg({ ...base, rows: [{ label: "Sensor", left: "45 MP", right: "24 MP" }] });
  const declared = renderGraphicSvg({
    ...base,
    rows: [{ label: "Sensor", left: "45 MP", right: "24 MP", favours: "left" }],
  });
  const marker = /<circle cx="140" cy="[\d.]+" r="6"/;
  assert.ok(!marker.test(neutral), "no winner is inferred from the values");
  assert.ok(marker.test(declared));
});

// ---- timeline ----

test("a timeline displays dates at the precision supplied", () => {
  const svg = renderGraphicSvg({
    kind: "timeline",
    slug: "history",
    title: "History",
    events: [
      { date: "2018-09", label: "First" },
      { date: "2021-03-04", label: "Second" },
    ],
    provenance,
  } satisfies TimelineSpec);
  const labels = textNodes(svg);
  assert.ok(labels.includes("Sep 2018"), "a month-precision date must not gain a day");
  assert.ok(labels.includes("4 Mar 2021"));
  assert.match(svg, /Positions are proportional to real dates/);
});

test("a timeline whose events share one date says so instead of implying spacing", () => {
  const svg = renderGraphicSvg({
    kind: "timeline",
    slug: "same-day",
    title: "Same day",
    events: [{ date: "2021", label: "A" }, { date: "2021", label: "B" }],
    provenance,
  } satisfies TimelineSpec);
  assert.match(svg, /Order only/);
});

// ---- escaping ----

test("markup in supplied text is escaped, not executed", () => {
  assert.equal(esc(`<script>&"`), "&lt;script&gt;&amp;&quot;");
  const svg = renderGraphicSvg({
    ...chart([1, 2, 3]),
    title: "R5 & R6 <compare>",
  });
  assert.ok(!svg.includes("<compare>"));
  assert.match(svg, /R5 &amp; R6 &lt;compare&gt;/);
});
