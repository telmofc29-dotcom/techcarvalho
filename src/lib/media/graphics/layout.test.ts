import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bandSlots,
  formatMeasure,
  groupedSlots,
  lineSegments,
  maxCharsForWidth,
  niceScale,
  parseEventDate,
  seeded,
  timelineLayout,
  truncateLabel,
  valueToY,
  wrapText,
} from "./layout.ts";

// ---- determinism ----

test("seeded PRNG is deterministic per slug and differs between slugs", () => {
  const a = seeded("canon-r5-vs-r6");
  const b = seeded("canon-r5-vs-r6");
  const c = seeded("nikon-z8");
  const seqA = [a(), a(), a()];
  const seqB = [b(), b(), b()];
  assert.deepEqual(seqA, seqB);
  assert.notDeepEqual(seqA, [c(), c(), c()]);
  for (const v of seqA) assert.ok(v >= 0 && v < 1);
});

// ---- text fitting ----

test("truncateLabel leaves short text alone and ellipsises long text", () => {
  assert.equal(truncateLabel("45 MP", 10), "45 MP");
  assert.equal(truncateLabel("Full-frame stacked CMOS", 10), "Full-fram…");
  assert.equal(truncateLabel("abc", 1), "…");
  assert.equal(truncateLabel("abc", 0), "");
});

test("wrapText wraps greedily and marks overflow instead of dropping it", () => {
  assert.deepEqual(wrapText("one two three four", 9, 4), ["one two", "three", "four"]);
  const clipped = wrapText("alpha beta gamma delta epsilon", 11, 2);
  assert.equal(clipped.length, 2);
  assert.ok(clipped[1].endsWith("…"), "overflowing wrap must look truncated");
  assert.deepEqual(wrapText("   ", 10, 2), []);
});

test("maxCharsForWidth scales with available width", () => {
  assert.ok(maxCharsForWidth(600, 20) > maxCharsForWidth(300, 20));
  assert.equal(maxCharsForWidth(0, 20), 0);
  assert.equal(maxCharsForWidth(600, 0), 0);
});

// ---- scale ----

test("niceScale returns null when there is nothing real to plot", () => {
  assert.equal(niceScale([]), null);
  assert.equal(niceScale([null, null]), null);
  assert.equal(niceScale([Number.NaN]), null);
});

test("niceScale always contains the real data range", () => {
  const scale = niceScale([12, 47, null, 33], { zeroBaseline: true });
  assert.ok(scale);
  assert.ok(scale.min <= 12 && scale.max >= 47);
  assert.equal(scale.min, 0);
  assert.equal(scale.ticks[0], scale.min);
  assert.equal(scale.ticks[scale.ticks.length - 1], scale.max);
});

test("niceScale ticks are evenly stepped and free of float noise", () => {
  const scale = niceScale([0, 0.3], { zeroBaseline: true });
  assert.ok(scale);
  for (const t of scale.ticks) {
    assert.equal(String(t).replace("-", "").replace(".", "").length <= 6, true, `tick ${t} looks like float noise`);
  }
  for (let i = 1; i < scale.ticks.length; i++) {
    assert.ok(Math.abs(scale.ticks[i] - scale.ticks[i - 1] - scale.step) < 1e-9);
  }
});

test("niceScale handles a single repeated value without inventing spread", () => {
  const zeroed = niceScale([40, 40], { zeroBaseline: true });
  assert.ok(zeroed);
  assert.equal(zeroed.min, 0);
  assert.ok(zeroed.max >= 40);

  const free = niceScale([40, 40], { zeroBaseline: false });
  assert.ok(free);
  assert.ok(free.min <= 40 && free.max >= 40);

  const zeros = niceScale([0, 0], { zeroBaseline: true });
  assert.ok(zeros);
  assert.ok(zeros.max > zeros.min);
});

test("niceScale without zeroBaseline may start above zero (charts must caption it)", () => {
  const scale = niceScale([980, 1000], { zeroBaseline: false });
  assert.ok(scale);
  assert.ok(scale.min > 0);
});

test("valueToY maps min to the bottom and max to the top of the plot", () => {
  const scale = niceScale([0, 100], { zeroBaseline: true });
  assert.ok(scale);
  assert.equal(valueToY(scale.min, scale, 100, 400), 500);
  assert.equal(valueToY(scale.max, scale, 100, 400), 100);
});

// ---- bar geometry ----

test("bandSlots divides a band evenly and stays inside it", () => {
  const slots = bandSlots(4, 100, 800, 0.3);
  assert.equal(slots.length, 4);
  assert.ok(slots[0].x >= 100);
  assert.ok(slots[3].x + slots[3].width <= 900 + 1e-9);
  const widths = new Set(slots.map((s) => Math.round(s.width * 1000)));
  assert.equal(widths.size, 1, "all slots equal width");
  assert.deepEqual(bandSlots(0, 100, 800), []);
});

test("groupedSlots splits one slot between series without overlapping", () => {
  const [slot] = bandSlots(1, 0, 300, 0);
  const grouped = groupedSlots(slot, 3, 6);
  assert.equal(grouped.length, 3);
  assert.ok(grouped[0].x + grouped[0].width <= grouped[1].x + 1e-9);
  assert.ok(grouped[1].x + grouped[1].width <= grouped[2].x + 1e-9);
  assert.deepEqual(groupedSlots(slot, 1), [slot]);
});

// ---- the anti-interpolation rule ----

test("lineSegments breaks the line at every gap rather than bridging it", () => {
  assert.deepEqual(lineSegments([1, 2, null, 4, 5]), [[0, 1], [3, 4]]);
  assert.deepEqual(lineSegments([null, null]), []);
  assert.deepEqual(lineSegments([1, 2, 3]), [[0, 1, 2]]);
  assert.deepEqual(lineSegments([null, 5, null]), [[1]]);
});

// ---- dates ----

test("parseEventDate preserves the precision it was given", () => {
  assert.equal(parseEventDate("2024")?.precision, "year");
  assert.equal(parseEventDate("2024")?.display, "2024");
  assert.equal(parseEventDate("2024-03")?.precision, "month");
  assert.equal(parseEventDate("2024-03")?.display, "Mar 2024");
  assert.equal(parseEventDate("2024-03-07")?.precision, "day");
  assert.equal(parseEventDate("2024-03-07")?.display, "7 Mar 2024");
});

test("parseEventDate rejects impossible and malformed dates", () => {
  assert.equal(parseEventDate("2024-13"), null);
  assert.equal(parseEventDate("2024-02-31"), null);
  assert.equal(parseEventDate("March 2024"), null);
  assert.equal(parseEventDate(""), null);
  assert.equal(parseEventDate("24-03"), null);
});

test("parseEventDate orders correctly across precisions", () => {
  const a = parseEventDate("2023")!;
  const b = parseEventDate("2023-06")!;
  const c = parseEventDate("2023-06-15")!;
  assert.ok(a.time < b.time && b.time < c.time);
});

// ---- timeline ----

test("timelineLayout spaces events in proportion to real dates, not evenly", () => {
  const layout = timelineLayout(
    [
      { date: "2020-01-01", label: "A" },
      { date: "2020-02-01", label: "B" },
      { date: "2030-01-01", label: "C" },
    ],
    { x0: 0, x1: 1000, minGap: 10 }
  );
  assert.ok(layout);
  assert.equal(layout.proportional, true);
  const [a, b, c] = layout.placed;
  assert.equal(a.x, 0);
  assert.equal(c.x, 1000);
  assert.ok(b.x < 50, "a one-month gap must not be drawn like a ten-year one");
});

test("timelineLayout sorts by date and flags non-proportional layouts", () => {
  const layout = timelineLayout(
    [
      { date: "2022", label: "second" },
      { date: "2021", label: "first" },
    ],
    { x0: 0, x1: 100, minGap: 10 }
  );
  assert.ok(layout);
  assert.equal(layout.placed[0].event.label, "first");

  const flat = timelineLayout(
    [
      { date: "2021", label: "a" },
      { date: "2021", label: "b" },
    ],
    { x0: 0, x1: 100, minGap: 10 }
  );
  assert.ok(flat);
  assert.equal(flat.proportional, false, "identical dates carry no spacing information");
});

test("timelineLayout alternates lanes when labels would collide", () => {
  const layout = timelineLayout(
    [
      { date: "2021-01-01", label: "a" },
      { date: "2021-01-02", label: "b" },
      { date: "2021-01-03", label: "c" },
    ],
    { x0: 0, x1: 1000, minGap: 600, lanes: 2 }
  );
  assert.ok(layout);
  assert.notEqual(layout.placed[0].lane, layout.placed[1].lane);
});

test("timelineLayout returns null when no event has a usable date", () => {
  assert.equal(timelineLayout([{ date: "soon", label: "x" }], { x0: 0, x1: 100 }), null);
});

// ---- number formatting ----

test("formatMeasure returns null for gaps so callers cannot print a fake zero", () => {
  assert.equal(formatMeasure(null), null);
  assert.equal(formatMeasure(Number.NaN), null);
  assert.equal(formatMeasure(Number.POSITIVE_INFINITY), null);
});

test("formatMeasure groups thousands and honours decimals", () => {
  assert.equal(formatMeasure(1234567), "1,234,567");
  assert.equal(formatMeasure(-1234), "-1,234");
  assert.equal(formatMeasure(12.345, 2), "12.35");
  assert.equal(formatMeasure(0), "0");
});
