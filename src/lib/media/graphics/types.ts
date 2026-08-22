// Spec types for the original-graphic generator (scripts/generate-editorial-graphics.mjs).
//
// DESIGN RULE THAT EVERYTHING ELSE HANGS OFF:
// a graphic spec is *data in*, never *data invented*. Every number, label and
// date that ends up on the canvas has to appear in the spec the caller passed.
// There is no default value, no placeholder series, no "sensible estimate" and
// no interpolation anywhere in this module. Where a datum is genuinely unknown
// the spec says so explicitly (`null`), and the renderer draws a visible gap
// rather than something that looks like a measurement.
//
// The second rule: these are ABSTRACT, DIAGRAMMATIC graphics. The shape
// vocabulary is a closed set of geometric primitives (see DiagramBodyShape) —
// there is deliberately no way to pass an SVG path, image, or silhouette, so
// nothing produced here can be mistaken for a photograph of a real product.

import type { MediaAssetRole, MediaRole } from "@/lib/types/database";

/**
 * A single datum. `null` means "we do not have this figure" and is rendered as
 * a visible gap — it is NOT zero, and it is never filled in, smoothed over, or
 * interpolated across.
 */
export type Measure = number | null;

/**
 * Where the figures came from. Required on every spec and printed on every
 * graphic, so a reader can always see the provenance of what they are looking
 * at. `asOf` matters because specs change: an undated spec chart is a claim
 * about the present that quietly rots.
 */
export type Provenance = {
  /** Human-readable source, e.g. "Manufacturer published specifications". */
  sourceLabel: string;
  /** Optional canonical URL for the source. */
  sourceUrl?: string;
  /** ISO date (YYYY-MM-DD) the figures were captured/verified. */
  asOf: string;
};

/** Optional association to an existing record, applied only in --ingest mode. */
export type GraphicAttachment = {
  contentSlug?: string;
  productSlug?: string;
  role: MediaRole;
};

type SpecBase = {
  /** Stable identifier — also the PRNG seed, so output is byte-identical across runs. */
  slug: string;
  title: string;
  subtitle?: string;
  /**
   * Palette key from the generator's THEME table. Purely decorative; it never
   * changes, orders, or emphasises any datum.
   */
  theme?: string;
  provenance: Provenance;
  attach?: GraphicAttachment;
};

/** A cell in a comparison table. `null` = not known, rendered as a visible gap. */
export type ComparisonCell = string | null;

export type ComparisonRow = {
  label: string;
  left: ComparisonCell;
  right: ComparisonCell;
  /**
   * Which side this row favours. EXPLICIT ONLY — the generator never infers a
   * winner from the values, because "higher is better" is an editorial
   * judgement, not arithmetic. Omitted means the graphic makes no claim.
   */
  favours?: "left" | "right";
};

export type ComparisonSpec = SpecBase & {
  kind: "comparison";
  left: { name: string; sublabel?: string };
  right: { name: string; sublabel?: string };
  rows: ComparisonRow[];
};

/**
 * Abstract primitives only. No product outlines, no silhouettes, no paths —
 * the point is that a spec diagram reads as a schematic, not as a picture of a
 * thing that was never photographed.
 */
export type DiagramBodyShape = "rect" | "rounded" | "circle";

export type DiagramCallout = {
  label: string;
  /** The specification value exactly as supplied. `null` renders as "not published". */
  value: string | null;
  /** Optional qualifier shown under the value (e.g. "manufacturer figure"). */
  note?: string;
};

export type SpecDiagramSpec = SpecBase & {
  kind: "spec_diagram";
  /** The named thing the specs belong to. */
  subject: string;
  bodyShape: DiagramBodyShape;
  /** Short abstract label drawn inside the body outline (e.g. "SENSOR"). */
  bodyLabel?: string;
  callouts: DiagramCallout[];
};

export type ChartSeries = {
  name: string;
  /** One entry per category, same order. Length is validated, not padded. */
  points: Measure[];
};

export type ChartSpec = SpecBase & {
  kind: "chart";
  chartType: "bar" | "line";
  /** Required — a bare number with no unit is not a fact, it is decoration. */
  unit: string;
  categories: string[];
  series: ChartSeries[];
  /** Decimal places for printed value labels. Default 0; never changes the value. */
  decimals?: number;
  /**
   * Force the value axis to start at zero. Defaults to true for bar charts
   * (a truncated bar axis exaggerates differences) and false for line charts.
   */
  zeroBaseline?: boolean;
};

export type TimelineEvent = {
  /** ISO-ish date: YYYY, YYYY-MM or YYYY-MM-DD. Precision is preserved and shown. */
  date: string;
  label: string;
  detail?: string;
};

export type TimelineSpec = SpecBase & {
  kind: "timeline";
  events: TimelineEvent[];
};

export type GraphicSpec = ComparisonSpec | SpecDiagramSpec | ChartSpec | TimelineSpec;

export type GraphicKind = GraphicSpec["kind"];

/**
 * asset_role for each kind. Fixed mapping — a spec file cannot choose its own
 * role, so a chart can never be filed as a product photo.
 */
export const ASSET_ROLE_BY_KIND: Record<GraphicKind, MediaAssetRole> = {
  comparison: "comparison_graphic",
  spec_diagram: "diagram",
  chart: "chart",
  timeline: "diagram",
};

/**
 * The ONLY rights metadata this pipeline may emit, as literals.
 *
 * These four values are the ones — and the only ones — that the generator has
 * actually established: it drew the image itself from a vector description, so
 * Tech Carvalho owns it outright, its rights are genuinely verified, no
 * attribution is owed to anyone, and no generative model was involved
 * (`ai_generated: false` is a statement of fact about SVG drawing code, not a
 * convenient default).
 *
 * They are deliberately NOT read from the spec file. `validateGraphicSpec()`
 * rejects any spec that so much as mentions a rights field, so there is no
 * input through which a caller could assert rights the generator has not
 * established.
 */
export const TC_ORIGINAL_GRAPHIC_RIGHTS = {
  source_type: "tc_graphic",
  owned: true,
  rights_status: "verified",
  ai_generated: false,
  attribution_required: false,
} as const;

/** Keys a spec file is forbidden from carrying, at any depth. */
export const FORBIDDEN_SPEC_KEYS = [
  "owned",
  "rights_status",
  "source_type",
  "ai_generated",
  "attribution_required",
  "attribution",
  "license",
  "creator",
  "publication_status",
  "public_storage_path",
  "published_at",
  "published_by",
] as const;
