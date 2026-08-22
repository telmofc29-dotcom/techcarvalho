// SVG renderers for the original-graphic generator.
//
// Pure string builders — no DOM, no filesystem, no network. Every renderer
// draws ONLY values found on the spec it was handed. The seeded PRNG reaches
// the background motif and nothing else, so no drawn datum can ever depend on
// randomness.
//
// Everything here is abstract and diagrammatic by construction: geometric
// primitives, type, rules and leader lines. There is no code path that accepts
// an arbitrary path, bitmap or silhouette, so no output can pass for a
// photograph of a real product. Every canvas is stamped with a line saying so.

import {
  bandSlots,
  formatMeasure,
  groupedSlots,
  lineSegments,
  maxCharsForWidth,
  niceScale,
  seeded,
  timelineLayout,
  truncateLabel,
  valueToY,
  wrapText,
} from "./layout.ts";
import type { Scale } from "./layout.ts";
import type {
  ChartSpec,
  ComparisonSpec,
  GraphicSpec,
  SpecDiagramSpec,
  TimelineSpec,
} from "./types.ts";

export const CANVAS_W = 1600;
export const CANVAS_H = 900;

const FONT = "Arial,Helvetica,sans-serif";

/** Wording used everywhere a value is genuinely absent. Never a dash or a 0. */
export const NO_DATA_LABEL = "not published";

export type Theme = { a: string; b: string; accent: string; motif: string };

// Shares the palette vocabulary of scripts/generate-editorial-heroes.mjs so a
// chart and its article hero look like they belong to the same publication.
export const THEME: Record<string, Theme> = {
  "cameras-photography": { a: "#0f172a", b: "#334155", accent: "#38bdf8", motif: "grid" },
  astrophotography: { a: "#0b1026", b: "#1e1b4b", accent: "#a78bfa", motif: "dots" },
  computing: { a: "#0c1a2b", b: "#123a5c", accent: "#38bdf8", motif: "grid" },
  gaming: { a: "#1b0f2b", b: "#3b1a5c", accent: "#c084fc", motif: "grid" },
  networking: { a: "#062b2b", b: "#0e4f4f", accent: "#2dd4bf", motif: "dots" },
  "smart-home-robots": { a: "#12240f", b: "#22491c", accent: "#84cc16", motif: "grid" },
  "drones-fpv": { a: "#2b1405", b: "#5c2c0b", accent: "#fb923c", motif: "grid" },
  "action-cameras": { a: "#2b0b0b", b: "#5c1717", accent: "#f87171", motif: "grid" },
  smartphones: { a: "#06241c", b: "#0b4a38", accent: "#34d399", motif: "grid" },
  "ai-hardware": { a: "#2b0a1e", b: "#5c1440", accent: "#f472b6", motif: "dots" },
  _default: { a: "#111827", b: "#334155", accent: "#ea580c", motif: "grid" },
};

/** Series colours, applied in order. Categorical only — never value-mapped. */
const SERIES_COLORS = ["#38bdf8", "#fbbf24", "#f472b6", "#34d399"];

export const esc = (s: unknown): string =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const n = (v: number): string => (Math.round(v * 100) / 100).toString();

function text(
  x: number,
  y: number,
  content: string,
  opts: {
    size?: number;
    weight?: number | string;
    fill?: string;
    anchor?: "start" | "middle" | "end";
    opacity?: number;
    spacing?: number;
    italic?: boolean;
  } = {}
): string {
  const attrs = [
    `x="${n(x)}"`,
    `y="${n(y)}"`,
    `font-family="${FONT}"`,
    `font-size="${opts.size ?? 20}"`,
    `font-weight="${opts.weight ?? 400}"`,
    `fill="${opts.fill ?? "#ffffff"}"`,
  ];
  if (opts.anchor) attrs.push(`text-anchor="${opts.anchor}"`);
  if (opts.opacity !== undefined) attrs.push(`opacity="${opts.opacity}"`);
  if (opts.spacing !== undefined) attrs.push(`letter-spacing="${opts.spacing}"`);
  if (opts.italic) attrs.push(`font-style="italic"`);
  return `<text ${attrs.join(" ")}>${esc(content)}</text>`;
}

/** Decorative background texture. Seeded; carries no information. */
function motif(kind: string, accent: string, rnd: () => number): string {
  const out: string[] = [];
  if (kind === "dots") {
    for (let i = 0; i < 120; i++) {
      const x = rnd() * CANVAS_W;
      const y = rnd() * CANVAS_H;
      out.push(`<circle cx="${n(x)}" cy="${n(y)}" r="${n(rnd() * 1.6 + 0.4)}" fill="#ffffff" opacity="${n(0.06 + rnd() * 0.14)}"/>`);
    }
  } else {
    for (let x = 0; x < CANVAS_W; x += 64) {
      out.push(`<line x1="${x}" y1="0" x2="${x}" y2="${CANVAS_H}" stroke="${accent}" stroke-width="1" opacity="0.055"/>`);
    }
    for (let y = 0; y < CANVAS_H; y += 64) {
      out.push(`<line x1="0" y1="${y}" x2="${CANVAS_W}" y2="${y}" stroke="${accent}" stroke-width="1" opacity="0.055"/>`);
    }
  }
  return out.join("");
}

const KIND_LABEL: Record<GraphicSpec["kind"], string> = {
  comparison: "COMPARISON",
  spec_diagram: "SPEC DIAGRAM",
  chart: "CHART",
  timeline: "TIMELINE",
};

function header(spec: GraphicSpec, theme: Theme): string {
  const label = KIND_LABEL[spec.kind];
  const chipW = label.length * 13 + 36;
  const out: string[] = [
    `<rect x="80" y="62" width="${chipW}" height="38" rx="19" fill="${theme.accent}"/>`,
    text(98, 88, label, { size: 18, weight: 700, fill: "#0b1020", spacing: 1.6 }),
    text(80, 158, truncateLabel(spec.title, maxCharsForWidth(1440, 44)), { size: 44, weight: 700 }),
  ];
  if (spec.subtitle) {
    out.push(
      text(80, 196, truncateLabel(spec.subtitle, maxCharsForWidth(1440, 22)), {
        size: 22,
        weight: 400,
        fill: "#cbd5e1",
        opacity: 0.9,
      })
    );
  }
  return out.join("");
}

/**
 * Footer. Always prints the provenance the spec supplied and always states
 * that this is a drawn diagram, so the graphic is self-describing once it
 * leaves the page it was made for.
 */
function footer(spec: GraphicSpec, theme: Theme): string {
  const prov =
    `Source: ${spec.provenance.sourceLabel} · as of ${spec.provenance.asOf}` +
    (spec.provenance.sourceUrl ? ` · ${spec.provenance.sourceUrl}` : "");
  return [
    `<line x1="80" y1="${CANVAS_H - 96}" x2="${CANVAS_W - 80}" y2="${CANVAS_H - 96}" stroke="#ffffff" stroke-width="1" opacity="0.16"/>`,
    text(80, CANVAS_H - 62, truncateLabel(prov, maxCharsForWidth(1000, 17)), {
      size: 17,
      fill: "#cbd5e1",
      opacity: 0.85,
    }),
    text(CANVAS_W - 80, CANVAS_H - 62, "TechCarvalho · original diagram, not a photograph", {
      size: 17,
      weight: 700,
      fill: "#ffffff",
      anchor: "end",
      opacity: 0.9,
    }),
    `<rect x="0" y="${CANVAS_H - 12}" width="${CANVAS_W}" height="12" fill="${theme.accent}"/>`,
  ].join("");
}

function frame(spec: GraphicSpec, theme: Theme, body: string): string {
  const rnd = seeded(spec.slug);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CANVAS_W}" height="${CANVAS_H}" viewBox="0 0 ${CANVAS_W} ${CANVAS_H}">
  <defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="${theme.a}"/><stop offset="1" stop-color="${theme.b}"/>
  </linearGradient></defs>
  <rect width="${CANVAS_W}" height="${CANVAS_H}" fill="url(#bg)"/>
  ${motif(theme.motif, theme.accent, rnd)}
  ${header(spec, theme)}
  ${body}
  ${footer(spec, theme)}
</svg>`;
}

/** The single visual treatment for "we do not have this figure". */
function gapMark(x: number, y: number, width: number, anchor: "start" | "middle" | "end"): string {
  const x0 = anchor === "start" ? x : anchor === "end" ? x - width : x - width / 2;
  return [
    `<rect x="${n(x0)}" y="${n(y - 24)}" width="${n(width)}" height="34" rx="6" fill="none" stroke="#94a3b8" stroke-width="1.5" stroke-dasharray="6 5" opacity="0.7"/>`,
    text(anchor === "start" ? x0 + width / 2 : x, y, NO_DATA_LABEL, {
      size: 16,
      fill: "#94a3b8",
      anchor: "middle",
      italic: true,
    }),
  ].join("");
}

// ---------------------------------------------------------------- comparison

function renderComparison(spec: ComparisonSpec, theme: Theme): string {
  const out: string[] = [];
  const midX = CANVAS_W / 2;
  const leftCx = 440;
  const rightCx = 1160;
  const headY = 268;

  out.push(text(leftCx, headY, truncateLabel(spec.left.name, maxCharsForWidth(560, 32)), {
    size: 32,
    weight: 700,
    anchor: "middle",
  }));
  out.push(text(rightCx, headY, truncateLabel(spec.right.name, maxCharsForWidth(560, 32)), {
    size: 32,
    weight: 700,
    anchor: "middle",
  }));
  if (spec.left.sublabel) {
    out.push(text(leftCx, headY + 28, truncateLabel(spec.left.sublabel, maxCharsForWidth(560, 18)), {
      size: 18, fill: "#cbd5e1", anchor: "middle", opacity: 0.85,
    }));
  }
  if (spec.right.sublabel) {
    out.push(text(rightCx, headY + 28, truncateLabel(spec.right.sublabel, maxCharsForWidth(560, 18)), {
      size: 18, fill: "#cbd5e1", anchor: "middle", opacity: 0.85,
    }));
  }

  const top = 320;
  const bottom = CANVAS_H - 120;
  out.push(`<line x1="${midX}" y1="${top - 76}" x2="${midX}" y2="${bottom}" stroke="#ffffff" stroke-width="1.5" opacity="0.18"/>`);
  out.push(`<circle cx="${midX}" cy="${top - 52}" r="24" fill="${theme.accent}"/>`);
  out.push(text(midX, top - 45, "VS", { size: 18, weight: 800, fill: "#0b1020", anchor: "middle" }));

  const rowH = Math.min(74, (bottom - top) / Math.max(1, spec.rows.length));
  spec.rows.forEach((row, i) => {
    const y = top + i * rowH + rowH / 2;
    if (i % 2 === 0) {
      out.push(`<rect x="80" y="${n(y - rowH / 2)}" width="${CANVAS_W - 160}" height="${n(rowH)}" fill="#ffffff" opacity="0.035"/>`);
    }
    out.push(text(midX, y + 30, truncateLabel(row.label, 26).toUpperCase(), {
      size: 14, weight: 700, fill: "#cbd5e1", anchor: "middle", opacity: 0.8, spacing: 1.2,
    }));

    const leftFav = row.favours === "left";
    const rightFav = row.favours === "right";

    if (row.left === null) out.push(gapMark(leftCx, y + 6, 190, "middle"));
    else {
      out.push(text(leftCx, y + 8, truncateLabel(row.left, maxCharsForWidth(600, 26)), {
        size: 26, weight: leftFav ? 700 : 500, fill: leftFav ? theme.accent : "#ffffff", anchor: "middle",
      }));
    }

    if (row.right === null) out.push(gapMark(rightCx, y + 6, 190, "middle"));
    else {
      out.push(text(rightCx, y + 8, truncateLabel(row.right, maxCharsForWidth(600, 26)), {
        size: 26, weight: rightFav ? 700 : 500, fill: rightFav ? theme.accent : "#ffffff", anchor: "middle",
      }));
    }

    // The marker only appears where the SPEC declared a preference; nothing is
    // inferred from the values themselves.
    if (leftFav) out.push(`<circle cx="140" cy="${n(y)}" r="6" fill="${theme.accent}"/>`);
    if (rightFav) out.push(`<circle cx="${CANVAS_W - 140}" cy="${n(y)}" r="6" fill="${theme.accent}"/>`);
  });

  return out.join("");
}

// -------------------------------------------------------------- spec diagram

function renderSpecDiagram(spec: SpecDiagramSpec, theme: Theme): string {
  const out: string[] = [];
  const cx = CANVAS_W / 2;
  const cy = 520;
  const bw = 300;
  const bh = 220;

  if (spec.bodyShape === "circle") {
    out.push(`<circle cx="${cx}" cy="${cy}" r="${bh / 2 + 20}" fill="none" stroke="${theme.accent}" stroke-width="2.5" opacity="0.85"/>`);
    out.push(`<circle cx="${cx}" cy="${cy}" r="${bh / 2 - 22}" fill="none" stroke="#ffffff" stroke-width="1" opacity="0.22"/>`);
  } else {
    const rx = spec.bodyShape === "rounded" ? 34 : 0;
    out.push(`<rect x="${cx - bw / 2}" y="${cy - bh / 2}" width="${bw}" height="${bh}" rx="${rx}" fill="none" stroke="${theme.accent}" stroke-width="2.5" opacity="0.85"/>`);
    out.push(`<rect x="${cx - bw / 2 + 22}" y="${cy - bh / 2 + 22}" width="${bw - 44}" height="${bh - 44}" rx="${Math.max(0, rx - 12)}" fill="none" stroke="#ffffff" stroke-width="1" opacity="0.2"/>`);
  }

  out.push(text(cx, cy - 6, truncateLabel(spec.subject, 22), { size: 22, weight: 700, anchor: "middle" }));
  if (spec.bodyLabel) {
    out.push(text(cx, cy + 26, truncateLabel(spec.bodyLabel, 24).toUpperCase(), {
      size: 14, weight: 700, fill: theme.accent, anchor: "middle", spacing: 2,
    }));
  }
  out.push(text(cx, cy + bh / 2 + 52, "Schematic — proportions are not to scale", {
    size: 14, fill: "#94a3b8", anchor: "middle", italic: true, opacity: 0.85,
  }));

  const leftItems = spec.callouts.filter((_, i) => i % 2 === 0);
  const rightItems = spec.callouts.filter((_, i) => i % 2 === 1);

  const drawSide = (items: typeof spec.callouts, side: "left" | "right") => {
    const count = items.length;
    if (count === 0) return;
    const boxW = 400;
    const x = side === "left" ? 90 : CANVAS_W - 90 - boxW;
    const anchorX = side === "left" ? x + boxW : x;
    const topY = 300;
    const bandH = 400;
    const step = count > 1 ? bandH / (count - 1) : 0;
    items.forEach((c, i) => {
      const y = count === 1 ? cy : topY + i * step;
      const edgeX = side === "left" ? cx - bw / 2 : cx + bw / 2;
      out.push(
        `<path d="M${n(anchorX)} ${n(y)} H${n(side === "left" ? anchorX + 60 : anchorX - 60)} L${n(edgeX)} ${n(cy + (y - cy) * 0.25)}" fill="none" stroke="${theme.accent}" stroke-width="1.4" opacity="0.45"/>`
      );
      out.push(`<circle cx="${n(anchorX)}" cy="${n(y)}" r="4" fill="${theme.accent}" opacity="0.8"/>`);

      const align = side === "left" ? "end" : "start";
      const labelX = side === "left" ? anchorX - 14 : anchorX + 14;
      out.push(text(labelX, y - 12, truncateLabel(c.label, maxCharsForWidth(boxW, 15)).toUpperCase(), {
        size: 15, weight: 700, fill: "#cbd5e1", anchor: align, spacing: 1.1, opacity: 0.85,
      }));
      if (c.value === null) {
        out.push(gapMark(labelX, y + 22, 180, align));
      } else {
        out.push(text(labelX, y + 22, truncateLabel(c.value, maxCharsForWidth(boxW, 26)), {
          size: 26, weight: 700, anchor: align,
        }));
        if (c.note) {
          out.push(text(labelX, y + 44, truncateLabel(c.note, maxCharsForWidth(boxW, 14)), {
            size: 14, fill: "#94a3b8", anchor: align, italic: true,
          }));
        }
      }
    });
  };

  drawSide(leftItems, "left");
  drawSide(rightItems, "right");
  return out.join("");
}

// --------------------------------------------------------------------- chart

function chartAxes(scale: Scale, plot: { x: number; y: number; w: number; h: number }, unit: string): string {
  const out: string[] = [];
  for (const t of scale.ticks) {
    const y = valueToY(t, scale, plot.y, plot.h);
    out.push(`<line x1="${plot.x}" y1="${n(y)}" x2="${plot.x + plot.w}" y2="${n(y)}" stroke="#ffffff" stroke-width="1" opacity="${t === 0 ? 0.32 : 0.12}"/>`);
    out.push(text(plot.x - 14, y + 6, formatMeasure(t, scale.decimals) ?? "", {
      size: 16, fill: "#cbd5e1", anchor: "end", opacity: 0.85,
    }));
  }
  out.push(text(plot.x - 14, plot.y - 22, unit, { size: 15, fill: "#94a3b8", anchor: "end", spacing: 0.6 }));
  return out.join("");
}

function chartLegend(spec: ChartSpec, y: number): string {
  if (spec.series.length < 2) return "";
  const out: string[] = [];
  let x = 140;
  spec.series.forEach((s, i) => {
    const color = SERIES_COLORS[i % SERIES_COLORS.length];
    out.push(`<rect x="${n(x)}" y="${n(y - 12)}" width="14" height="14" rx="3" fill="${color}"/>`);
    const label = truncateLabel(s.name, 28);
    out.push(text(x + 22, y, label, { size: 16, fill: "#e2e8f0" }));
    x += 22 + label.length * 9 + 34;
  });
  return out.join("");
}

function renderChart(spec: ChartSpec, theme: Theme): string {
  const plot = { x: 150, y: 270, w: CANVAS_W - 150 - 90, h: 440 };
  const zeroBaseline = spec.zeroBaseline ?? spec.chartType === "bar";
  const all = spec.series.flatMap((s) => s.points);
  const scale = niceScale(all, { targetTicks: 5, zeroBaseline });
  // validateGraphicSpec guarantees at least one real value, so a null scale
  // here would mean the spec bypassed validation. Refuse rather than draw an
  // empty axis that looks like a measurement of zero.
  if (!scale) throw new Error(`chart '${spec.slug}' has no finite values — refusing to render an empty axis`);

  const out: string[] = [chartAxes(scale, plot, spec.unit)];
  const decimals = spec.decimals ?? 0;
  const slots = bandSlots(spec.categories.length, plot.x, plot.w, spec.chartType === "bar" ? 0.34 : 0);
  const baseY = valueToY(Math.max(scale.min, Math.min(0, scale.max)), scale, plot.y, plot.h);

  const centreOf = (i: number) =>
    spec.chartType === "bar" ? slots[i].x + slots[i].width / 2 : plot.x + (spec.categories.length === 1 ? plot.w / 2 : (i / (spec.categories.length - 1)) * plot.w);

  if (spec.chartType === "bar") {
    spec.categories.forEach((_, ci) => {
      const inner = groupedSlots(slots[ci], spec.series.length, 6);
      spec.series.forEach((s, si) => {
        const slot = inner[si];
        const color = SERIES_COLORS[si % SERIES_COLORS.length];
        const v = s.points[ci];
        if (v === null || typeof v !== "number") {
          out.push(`<rect x="${n(slot.x)}" y="${n(plot.y + plot.h - 46)}" width="${n(slot.width)}" height="46" fill="none" stroke="#94a3b8" stroke-width="1.4" stroke-dasharray="5 5" opacity="0.65"/>`);
          out.push(text(slot.x + slot.width / 2, plot.y + plot.h - 56, NO_DATA_LABEL, {
            size: 12, fill: "#94a3b8", anchor: "middle", italic: true,
          }));
          return;
        }
        const y = valueToY(v, scale, plot.y, plot.h);
        const top = Math.min(y, baseY);
        const h = Math.max(1, Math.abs(baseY - y));
        out.push(`<rect x="${n(slot.x)}" y="${n(top)}" width="${n(slot.width)}" height="${n(h)}" rx="3" fill="${color}" opacity="0.9"/>`);
        out.push(text(slot.x + slot.width / 2, top - 10, formatMeasure(v, decimals) ?? "", {
          size: 15, weight: 700, fill: "#ffffff", anchor: "middle",
        }));
      });
    });
  } else {
    spec.series.forEach((s, si) => {
      const color = SERIES_COLORS[si % SERIES_COLORS.length];
      // Segments break at every gap: no line is ever drawn across a value we
      // do not have.
      for (const seg of lineSegments(s.points)) {
        const d = seg
          .map((idx, k) => `${k === 0 ? "M" : "L"}${n(centreOf(idx))} ${n(valueToY(s.points[idx] as number, scale, plot.y, plot.h))}`)
          .join(" ");
        out.push(`<path d="${d}" fill="none" stroke="${color}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`);
      }
      s.points.forEach((v, ci) => {
        if (v === null || typeof v !== "number") return;
        const x = centreOf(ci);
        const y = valueToY(v, scale, plot.y, plot.h);
        out.push(`<circle cx="${n(x)}" cy="${n(y)}" r="5" fill="${color}" stroke="#0b1020" stroke-width="1.5"/>`);
        if (spec.series.length === 1) {
          out.push(text(x, y - 16, formatMeasure(v, decimals) ?? "", {
            size: 14, weight: 700, fill: "#ffffff", anchor: "middle",
          }));
        }
      });
    });

    // Gaps are annotated once per category, outside the series loop, and the
    // annotation distinguishes "nobody reported this period" from "this one
    // series has no reading" — a full-height rule for a partial gap would
    // imply the other series are missing too.
    let partialGaps = 0;
    spec.categories.forEach((_, ci) => {
      const missing = spec.series.filter((s) => typeof s.points[ci] !== "number");
      if (missing.length === 0) return;
      const x = centreOf(ci);
      if (missing.length === spec.series.length) {
        out.push(`<line x1="${n(x)}" y1="${plot.y}" x2="${n(x)}" y2="${plot.y + plot.h}" stroke="#94a3b8" stroke-width="1.2" stroke-dasharray="4 6" opacity="0.55"/>`);
        out.push(text(x, plot.y - 6, NO_DATA_LABEL, { size: 12, fill: "#94a3b8", anchor: "middle", italic: true }));
        return;
      }
      missing.forEach((s) => {
        partialGaps++;
        const si = spec.series.indexOf(s);
        const color = SERIES_COLORS[si % SERIES_COLORS.length];
        out.push(`<circle cx="${n(x)}" cy="${n(plot.y + plot.h)}" r="6" fill="none" stroke="${color}" stroke-width="1.6" stroke-dasharray="3 3"/>`);
      });
    });
    if (partialGaps > 0) {
      out.push(text(CANVAS_W - 90, plot.y + plot.h + 68, `Open markers on the axis: ${NO_DATA_LABEL} for that series`, {
        size: 13, fill: "#94a3b8", anchor: "end", italic: true,
      }));
    }
  }

  out.push(`<line x1="${plot.x}" y1="${n(baseY)}" x2="${plot.x + plot.w}" y2="${n(baseY)}" stroke="${theme.accent}" stroke-width="2" opacity="0.7"/>`);

  const catChars = maxCharsForWidth(plot.w / spec.categories.length, 16);
  spec.categories.forEach((c, i) => {
    out.push(text(centreOf(i), plot.y + plot.h + 30, truncateLabel(c, Math.max(6, catChars)), {
      size: 16, fill: "#e2e8f0", anchor: "middle",
    }));
  });

  out.push(chartLegend(spec, plot.y + plot.h + 68));
  if (!zeroBaseline) {
    out.push(text(CANVAS_W - 90, plot.y - 22, "axis does not start at zero", {
      size: 13, fill: "#94a3b8", anchor: "end", italic: true,
    }));
  }
  return out.join("");
}

// ------------------------------------------------------------------ timeline

function renderTimeline(spec: TimelineSpec, theme: Theme): string {
  const x0 = 170;
  const x1 = CANVAS_W - 170;
  const layout = timelineLayout(spec.events, { x0, x1, minGap: 210, lanes: 2 });
  if (!layout) throw new Error(`timeline '${spec.slug}' has no parseable dates — refusing to render`);
  // When nothing needed the lower lane, drop the axis so the single band of
  // labels sits centred rather than leaving half the canvas empty.
  const usesLowerLane = layout.placed.some((p) => p.lane !== 0);
  const axisY = usesLowerLane ? 520 : 600;

  const out: string[] = [
    `<line x1="${x0 - 50}" y1="${axisY}" x2="${x1 + 50}" y2="${axisY}" stroke="${theme.accent}" stroke-width="3" opacity="0.85"/>`,
  ];

  for (const p of layout.placed) {
    const above = p.lane === 0;
    const stemLen = above ? 96 : 96;
    const tipY = above ? axisY - stemLen : axisY + stemLen;
    out.push(`<line x1="${n(p.x)}" y1="${axisY}" x2="${n(p.x)}" y2="${n(tipY)}" stroke="#ffffff" stroke-width="1.4" opacity="0.35"/>`);
    out.push(`<circle cx="${n(p.x)}" cy="${axisY}" r="8" fill="${theme.accent}" stroke="#0b1020" stroke-width="2"/>`);

    const labelY = above ? tipY - 8 : tipY + 26;
    out.push(text(p.x, above ? labelY - 52 : labelY - 26, p.parsed.display, {
      size: 16, weight: 700, fill: theme.accent, anchor: "middle", spacing: 0.8,
    }));
    const lines = wrapText(p.event.label, 22, 2);
    lines.forEach((l, i) => {
      out.push(text(p.x, (above ? labelY - 26 : labelY) + i * 24, l, {
        size: 20, weight: 700, fill: "#ffffff", anchor: "middle",
      }));
    });
    if (p.event.detail) {
      const detail = wrapText(p.event.detail, 26, 2);
      detail.forEach((l, i) => {
        out.push(text(p.x, (above ? labelY - 26 : labelY) + lines.length * 24 + i * 19 + 4, l, {
          size: 15, fill: "#cbd5e1", anchor: "middle", opacity: 0.88,
        }));
      });
    }
  }

  const first = layout.placed[0];
  const last = layout.placed[layout.placed.length - 1];
  out.push(text(x0 - 56, axisY + 6, first.parsed.display.slice(-4), {
    size: 15, fill: "#94a3b8", anchor: "end",
  }));
  out.push(text(x1 + 56, axisY + 6, last.parsed.display.slice(-4), { size: 15, fill: "#94a3b8" }));
  out.push(
    text(
      CANVAS_W / 2,
      CANVAS_H - 122,
      layout.proportional
        ? "Positions are proportional to real dates"
        : "Order only — all events share one date, so spacing is not to scale",
      { size: 14, fill: "#94a3b8", anchor: "middle", italic: true, opacity: 0.9 }
    )
  );
  return out.join("");
}

// -------------------------------------------------------------------- public

export function themeFor(spec: GraphicSpec): Theme {
  return THEME[spec.theme ?? "_default"] ?? THEME._default;
}

/**
 * Render a validated spec to SVG. Deterministic: the same spec always produces
 * byte-identical output, because the only stochastic element is seeded from
 * `spec.slug` and only touches the background texture.
 */
export function renderGraphicSvg(spec: GraphicSpec): string {
  const theme = themeFor(spec);
  switch (spec.kind) {
    case "comparison":
      return frame(spec, theme, renderComparison(spec, theme));
    case "spec_diagram":
      return frame(spec, theme, renderSpecDiagram(spec, theme));
    case "chart":
      return frame(spec, theme, renderChart(spec, theme));
    case "timeline":
      return frame(spec, theme, renderTimeline(spec, theme));
  }
}
