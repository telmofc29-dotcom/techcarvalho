// Pure layout maths for the original-graphic generator. No SVG, no I/O, no
// randomness except the explicitly seeded PRNG below (which is used ONLY for
// decorative background motifs — never for anything a reader would read as
// data).

import type { Measure, TimelineEvent } from "./types.ts";

/**
 * Deterministic per-slug PRNG (FNV-1a seed + LCG), matching
 * scripts/generate-editorial-heroes.mjs so both generators produce
 * byte-identical output for a given input on every run.
 *
 * Decoration only. Data renderers never receive this function.
 */
export function seeded(slug: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < slug.length; i++) {
    h ^= slug.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  let s = h >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

/** Hard-truncate with an ellipsis. Returns the input unchanged when it fits. */
export function truncateLabel(text: string, maxChars: number): string {
  const t = String(text).trim();
  if (maxChars <= 0) return "";
  if (t.length <= maxChars) return t;
  if (maxChars === 1) return "…";
  return t.slice(0, maxChars - 1).trimEnd() + "…";
}

/**
 * Greedy word wrap. Returns at most `maxLines` lines; if the text overflows
 * that budget the last line is ellipsised rather than silently dropped, so a
 * truncated label always looks truncated.
 */
export function wrapText(text: string, maxChars: number, maxLines: number): string[] {
  const words = String(text).trim().split(/\s+/).filter(Boolean);
  if (words.length === 0 || maxChars <= 0 || maxLines <= 0) return [];
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (next.length > maxChars && cur) {
      lines.push(cur);
      cur = w;
    } else {
      cur = next;
    }
  }
  if (cur) lines.push(cur);
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  kept[maxLines - 1] = truncateLabel(kept[maxLines - 1] + " …", maxChars);
  return kept;
}

/**
 * Approximate how many characters of a given font size fit in `width` pixels.
 * Arial/Helvetica averages ~0.55em per character across mixed-case text; the
 * factor is intentionally conservative so labels truncate rather than collide.
 */
export function maxCharsForWidth(width: number, fontSize: number, factor = 0.55): number {
  if (width <= 0 || fontSize <= 0) return 0;
  return Math.max(0, Math.floor(width / (fontSize * factor)));
}

export type Scale = {
  min: number;
  max: number;
  step: number;
  ticks: number[];
  decimals: number;
};

const NICE_STEPS = [1, 2, 2.5, 5, 10];

/** Decimal places needed to print `step` without floating-point noise. */
function decimalsForStep(step: number): number {
  if (!Number.isFinite(step) || step <= 0) return 0;
  if (step >= 1) return 0;
  return Math.min(6, Math.ceil(-Math.log10(step)));
}

function roundTo(value: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}

/**
 * Compute a rounded axis for real values.
 *
 * Returns `null` when there is nothing to scale — no finite values at all.
 * The caller MUST treat that as "do not draw a chart"; an axis with no data
 * behind it is a picture of nothing pretending to be a measurement.
 *
 * `zeroBaseline` pins the axis to zero, which is why bar charts default to it:
 * a bar whose axis starts at 90 exaggerates a 2% difference into a 10x one.
 */
export function niceScale(
  values: Measure[],
  opts: { targetTicks?: number; zeroBaseline?: boolean } = {}
): Scale | null {
  const finite = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (finite.length === 0) return null;

  const targetTicks = Math.max(2, opts.targetTicks ?? 5);
  let lo = Math.min(...finite);
  let hi = Math.max(...finite);

  if (opts.zeroBaseline) {
    lo = Math.min(0, lo);
    hi = Math.max(0, hi);
  }

  if (lo === hi) {
    // A single distinct value still has to render somewhere sensible. Padding
    // the AXIS is not inventing data — the datum itself is unchanged.
    if (lo === 0) {
      lo = 0;
      hi = 1;
    } else if (opts.zeroBaseline) {
      hi = lo > 0 ? lo : 0;
      lo = lo > 0 ? 0 : lo;
    } else {
      const pad = Math.abs(lo) * 0.1;
      lo -= pad;
      hi += pad;
    }
  }

  const rawStep = (hi - lo) / targetTicks;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const normalised = rawStep / magnitude;
  const niceStep = (NICE_STEPS.find((s) => normalised <= s) ?? 10) * magnitude;

  const decimals = decimalsForStep(niceStep);
  const min = roundTo(Math.floor(lo / niceStep) * niceStep, decimals + 2);
  const max = roundTo(Math.ceil(hi / niceStep) * niceStep, decimals + 2);

  const ticks: number[] = [];
  const count = Math.round((max - min) / niceStep);
  for (let i = 0; i <= count; i++) ticks.push(roundTo(min + i * niceStep, decimals + 2));

  return { min, max, step: niceStep, ticks, decimals };
}

/** Map a value onto a pixel Y within a plot box (y grows downward). */
export function valueToY(value: number, scale: Scale, top: number, height: number): number {
  if (scale.max === scale.min) return top + height;
  const t = (value - scale.min) / (scale.max - scale.min);
  return top + height - t * height;
}

export type Slot = { x: number; width: number };

/**
 * Evenly divide a horizontal band into `count` slots with proportional gaps.
 * `gapRatio` is the fraction of each slot given over to whitespace.
 */
export function bandSlots(count: number, x: number, width: number, gapRatio = 0.3): Slot[] {
  if (count <= 0 || width <= 0) return [];
  const slotWidth = width / count;
  const barWidth = slotWidth * (1 - gapRatio);
  const pad = (slotWidth - barWidth) / 2;
  const slots: Slot[] = [];
  for (let i = 0; i < count; i++) slots.push({ x: x + i * slotWidth + pad, width: barWidth });
  return slots;
}

/** Sub-divide one band slot between grouped series bars. */
export function groupedSlots(slot: Slot, seriesCount: number, innerGap = 4): Slot[] {
  if (seriesCount <= 0) return [];
  if (seriesCount === 1) return [slot];
  const totalGap = innerGap * (seriesCount - 1);
  const each = Math.max(1, (slot.width - totalGap) / seriesCount);
  const out: Slot[] = [];
  for (let i = 0; i < seriesCount; i++) out.push({ x: slot.x + i * (each + innerGap), width: each });
  return out;
}

/**
 * Split a series into runs of consecutive present values.
 *
 * This is the anti-fabrication rule for line charts: a gap is a break in the
 * line, never a straight segment drawn across missing months. Interpolating
 * across a `null` would draw values that were never measured.
 */
export function lineSegments(points: Measure[]): number[][] {
  const segments: number[][] = [];
  let cur: number[] = [];
  points.forEach((p, i) => {
    if (typeof p === "number" && Number.isFinite(p)) {
      cur.push(i);
    } else if (cur.length) {
      segments.push(cur);
      cur = [];
    }
  });
  if (cur.length) segments.push(cur);
  return segments;
}

export type ParsedDate = {
  /** Sortable numeric time (ms) at the START of the stated precision window. */
  time: number;
  precision: "year" | "month" | "day";
  /** Display form at the precision actually supplied — never invents a day. */
  display: string;
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * Parse YYYY, YYYY-MM or YYYY-MM-DD. Precision is preserved: a spec that says
 * "2024-03" is displayed as "Mar 2024", never as "1 March 2024" — inventing a
 * day of the month is inventing a fact.
 */
export function parseEventDate(input: string): ParsedDate | null {
  const s = String(input).trim();
  let m = /^(\d{4})$/.exec(s);
  if (m) {
    return { time: Date.UTC(Number(m[1]), 0, 1), precision: "year", display: m[1] };
  }
  m = /^(\d{4})-(\d{2})$/.exec(s);
  if (m) {
    const mon = Number(m[2]);
    if (mon < 1 || mon > 12) return null;
    return {
      time: Date.UTC(Number(m[1]), mon - 1, 1),
      precision: "month",
      display: `${MONTHS[mon - 1]} ${m[1]}`,
    };
  }
  m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) {
    const mon = Number(m[2]);
    const day = Number(m[3]);
    if (mon < 1 || mon > 12 || day < 1 || day > 31) return null;
    const time = Date.UTC(Number(m[1]), mon - 1, day);
    const d = new Date(time);
    if (d.getUTCMonth() !== mon - 1 || d.getUTCDate() !== day) return null;
    return { time, precision: "day", display: `${day} ${MONTHS[mon - 1]} ${m[1]}` };
  }
  return null;
}

export type PlacedEvent = {
  event: TimelineEvent;
  parsed: ParsedDate;
  x: number;
  lane: number;
};

export type TimelineLayout = {
  placed: PlacedEvent[];
  /**
   * False when every event shares one instant, so positions carry no temporal
   * meaning and the graphic must say "order only — not to scale".
   */
  proportional: boolean;
  spanStart: number;
  spanEnd: number;
};

/**
 * Place events along an axis in proportion to their real dates (NOT evenly —
 * even spacing would misrepresent a five-year gap as identical to a two-month
 * one), then assign alternating lanes so crowded labels do not overlap.
 *
 * Returns null if no event has a parseable date.
 */
export function timelineLayout(
  events: TimelineEvent[],
  opts: { x0: number; x1: number; minGap?: number; lanes?: number }
): TimelineLayout | null {
  const parsedAll = events
    .map((event) => ({ event, parsed: parseEventDate(event.date) }))
    .filter((e): e is { event: TimelineEvent; parsed: ParsedDate } => e.parsed !== null);
  if (parsedAll.length === 0) return null;

  parsedAll.sort((a, b) => a.parsed.time - b.parsed.time || a.event.label.localeCompare(b.event.label));

  const spanStart = parsedAll[0].parsed.time;
  const spanEnd = parsedAll[parsedAll.length - 1].parsed.time;
  const span = spanEnd - spanStart;
  const proportional = span > 0;
  const { x0, x1 } = opts;
  const minGap = opts.minGap ?? 180;
  const laneCount = Math.max(1, opts.lanes ?? 2);

  const lastX: number[] = new Array(laneCount).fill(Number.NEGATIVE_INFINITY);

  const placed: PlacedEvent[] = parsedAll.map((e, i) => {
    const x = proportional
      ? x0 + ((e.parsed.time - spanStart) / span) * (x1 - x0)
      : parsedAll.length === 1
        ? (x0 + x1) / 2
        : x0 + (i / (parsedAll.length - 1)) * (x1 - x0);

    let lane = 0;
    let found = false;
    for (let l = 0; l < laneCount; l++) {
      if (x - lastX[l] >= minGap) {
        lane = l;
        found = true;
        break;
      }
    }
    if (!found) {
      // Everything collides: pick the lane whose last label is furthest away.
      let best = 0;
      for (let l = 1; l < laneCount; l++) if (lastX[l] < lastX[best]) best = l;
      lane = best;
    }
    lastX[lane] = x;
    return { event: e.event, parsed: e.parsed, x, lane };
  });

  return { placed, proportional, spanStart, spanEnd };
}

/**
 * Format a measure for display. `null` returns null — callers must render the
 * explicit "no data" treatment rather than substituting a zero or a dash that
 * could be read as a value.
 */
export function formatMeasure(value: Measure, decimals = 0): string | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const fixed = value.toFixed(Math.max(0, Math.min(6, decimals)));
  const [intPart, frac] = fixed.split(".");
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return frac ? `${grouped}.${frac}` : grouped;
}
