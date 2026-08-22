// Spec validation for the original-graphic generator.
//
// This is the layer that makes fabrication structurally impossible rather than
// merely discouraged:
//
//  1. Every rendered value must be present in the input. Validation rejects
//     ragged series, unparseable dates and non-numeric "numbers" instead of
//     coercing or padding them, so a renderer downstream never has to guess.
//  2. A graphic with no real data is refused outright. `null` is a legitimate
//     acknowledged gap, but an all-gaps graphic is decoration dressed as
//     evidence, so at least one genuine datum is required.
//  3. Provenance is mandatory and dated.
//  4. Rights metadata cannot be supplied at all — FORBIDDEN_SPEC_KEYS are
//     rejected at any depth. The generator emits TC_ORIGINAL_GRAPHIC_RIGHTS
//     literals, which describe what it actually did (drew an SVG itself).

import { FORBIDDEN_SPEC_KEYS } from "./types.ts";
import type {
  ChartSpec,
  ComparisonSpec,
  GraphicSpec,
  Measure,
  SpecDiagramSpec,
  TimelineSpec,
} from "./types.ts";
import { parseEventDate } from "./layout.ts";

export type ValidationResult =
  | { ok: true; spec: GraphicSpec }
  | { ok: false; errors: string[] };

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ISO_DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const KINDS = new Set(["comparison", "spec_diagram", "chart", "timeline"]);
const MEDIA_ROLES = new Set(["hero", "gallery", "thumbnail"]);
const BODY_SHAPES = new Set(["rect", "rounded", "circle"]);

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

/** True for a real number or an explicit, acknowledged gap — nothing else. */
function isMeasure(v: unknown): v is Measure {
  return v === null || (typeof v === "number" && Number.isFinite(v));
}

/** Walk the whole spec looking for rights/provenance keys a caller must not set. */
export function findForbiddenKeys(value: unknown, path = "spec"): string[] {
  const found: string[] = [];
  const walk = (node: unknown, at: string) => {
    if (Array.isArray(node)) {
      node.forEach((item, i) => walk(item, `${at}[${i}]`));
      return;
    }
    if (!isPlainObject(node)) return;
    for (const [key, child] of Object.entries(node)) {
      if ((FORBIDDEN_SPEC_KEYS as readonly string[]).includes(key)) {
        found.push(`${at}.${key}`);
      }
      walk(child, `${at}.${key}`);
    }
  };
  walk(value, path);
  return found;
}

function validateCommon(spec: Record<string, unknown>, errors: string[]): void {
  if (!isNonEmptyString(spec.slug)) errors.push("slug is required");
  else if (!SLUG_RE.test(spec.slug)) errors.push(`slug '${spec.slug}' must be lowercase kebab-case`);

  if (!isNonEmptyString(spec.title)) errors.push("title is required");
  if (spec.subtitle !== undefined && !isNonEmptyString(spec.subtitle)) {
    errors.push("subtitle, when present, must be a non-empty string");
  }

  const prov = spec.provenance;
  if (!isPlainObject(prov)) {
    errors.push("provenance is required (sourceLabel + asOf)");
  } else {
    if (!isNonEmptyString(prov.sourceLabel)) errors.push("provenance.sourceLabel is required");
    if (!isNonEmptyString(prov.asOf) || !ISO_DAY_RE.test(prov.asOf)) {
      errors.push("provenance.asOf is required and must be YYYY-MM-DD");
    } else if (!parseEventDate(prov.asOf)) {
      errors.push(`provenance.asOf '${prov.asOf}' is not a real date`);
    }
    if (prov.sourceUrl !== undefined && !isNonEmptyString(prov.sourceUrl)) {
      errors.push("provenance.sourceUrl, when present, must be a non-empty string");
    }
  }

  if (spec.attach !== undefined) {
    const attach = spec.attach;
    if (!isPlainObject(attach)) {
      errors.push("attach must be an object");
    } else {
      const hasContent = isNonEmptyString(attach.contentSlug);
      const hasProduct = isNonEmptyString(attach.productSlug);
      if (hasContent === hasProduct) {
        errors.push("attach must name exactly one of contentSlug or productSlug");
      }
      if (typeof attach.role !== "string" || !MEDIA_ROLES.has(attach.role)) {
        errors.push("attach.role must be one of hero, gallery, thumbnail");
      }
    }
  }
}

function validateComparison(spec: Record<string, unknown>, errors: string[]): void {
  for (const side of ["left", "right"] as const) {
    const col = spec[side];
    if (!isPlainObject(col) || !isNonEmptyString(col.name)) {
      errors.push(`${side}.name is required`);
    }
  }

  const rows = spec.rows;
  if (!Array.isArray(rows) || rows.length === 0) {
    errors.push("rows must be a non-empty array");
    return;
  }
  if (rows.length > 10) errors.push("rows: at most 10 fit the canvas legibly");

  let realCells = 0;
  rows.forEach((row, i) => {
    if (!isPlainObject(row)) {
      errors.push(`rows[${i}] must be an object`);
      return;
    }
    if (!isNonEmptyString(row.label)) errors.push(`rows[${i}].label is required`);
    for (const side of ["left", "right"] as const) {
      const cell = row[side];
      if (cell !== null && !isNonEmptyString(cell)) {
        errors.push(`rows[${i}].${side} must be a non-empty string or null (unknown)`);
      } else if (cell !== null) {
        realCells++;
      }
    }
    if (row.left === null && row.right === null) {
      errors.push(`rows[${i}]: both sides unknown — a row with no data on either side says nothing`);
    }
    if (row.favours !== undefined && row.favours !== "left" && row.favours !== "right") {
      errors.push(`rows[${i}].favours must be 'left' or 'right' when present`);
    }
  });

  if (realCells === 0) errors.push("comparison has no known values at all");
}

function validateSpecDiagram(spec: Record<string, unknown>, errors: string[]): void {
  if (!isNonEmptyString(spec.subject)) errors.push("subject is required");
  if (typeof spec.bodyShape !== "string" || !BODY_SHAPES.has(spec.bodyShape)) {
    errors.push("bodyShape must be one of rect, rounded, circle (abstract primitives only)");
  }
  if (spec.bodyLabel !== undefined && !isNonEmptyString(spec.bodyLabel)) {
    errors.push("bodyLabel, when present, must be a non-empty string");
  }

  const callouts = spec.callouts;
  if (!Array.isArray(callouts) || callouts.length === 0) {
    errors.push("callouts must be a non-empty array");
    return;
  }
  if (callouts.length > 8) errors.push("callouts: at most 8 fit the canvas legibly");

  let known = 0;
  callouts.forEach((c, i) => {
    if (!isPlainObject(c)) {
      errors.push(`callouts[${i}] must be an object`);
      return;
    }
    if (!isNonEmptyString(c.label)) errors.push(`callouts[${i}].label is required`);
    if (c.value !== null && !isNonEmptyString(c.value)) {
      errors.push(`callouts[${i}].value must be a non-empty string or null (not published)`);
    } else if (c.value !== null) {
      known++;
    }
    if (c.note !== undefined && !isNonEmptyString(c.note)) {
      errors.push(`callouts[${i}].note, when present, must be a non-empty string`);
    }
  });

  if (known === 0) errors.push("spec diagram has no known specification values at all");
}

function validateChart(spec: Record<string, unknown>, errors: string[]): void {
  if (spec.chartType !== "bar" && spec.chartType !== "line") {
    errors.push("chartType must be 'bar' or 'line'");
  }
  if (!isNonEmptyString(spec.unit)) {
    errors.push("unit is required — an unlabelled number is not a fact");
  }
  if (spec.decimals !== undefined) {
    if (typeof spec.decimals !== "number" || !Number.isInteger(spec.decimals) || spec.decimals < 0 || spec.decimals > 6) {
      errors.push("decimals must be an integer 0-6");
    }
  }
  if (spec.zeroBaseline !== undefined && typeof spec.zeroBaseline !== "boolean") {
    errors.push("zeroBaseline must be a boolean");
  }

  const categories = spec.categories;
  if (!Array.isArray(categories) || categories.length < 2) {
    errors.push("categories must be an array of at least 2 labels");
  } else if (categories.some((c) => !isNonEmptyString(c))) {
    errors.push("every category label must be a non-empty string");
  }
  if (Array.isArray(categories) && categories.length > 12) {
    errors.push("categories: at most 12 fit the canvas legibly");
  }

  const series = spec.series;
  if (!Array.isArray(series) || series.length === 0) {
    errors.push("series must be a non-empty array");
    return;
  }
  if (series.length > 4) errors.push("series: at most 4 are distinguishable");

  let finiteCount = 0;
  series.forEach((s, i) => {
    if (!isPlainObject(s)) {
      errors.push(`series[${i}] must be an object`);
      return;
    }
    if (!isNonEmptyString(s.name)) errors.push(`series[${i}].name is required`);
    const points = s.points;
    if (!Array.isArray(points)) {
      errors.push(`series[${i}].points must be an array`);
      return;
    }
    if (Array.isArray(categories) && points.length !== categories.length) {
      // Never padded or truncated to fit: a mismatch means the caller and the
      // generator disagree about what the data IS, and guessing which is right
      // is exactly how a fabricated datapoint gets drawn.
      errors.push(
        `series[${i}].points has ${points.length} values but there are ${categories.length} categories`
      );
    }
    points.forEach((p, j) => {
      if (!isMeasure(p)) {
        errors.push(`series[${i}].points[${j}] must be a finite number or null (unknown)`);
      } else if (p !== null) {
        finiteCount++;
      }
    });
  });

  if (finiteCount === 0) errors.push("chart has no known values at all");
}

function validateTimeline(spec: Record<string, unknown>, errors: string[]): void {
  const events = spec.events;
  if (!Array.isArray(events) || events.length < 2) {
    errors.push("events must be an array of at least 2 dated events");
    return;
  }
  if (events.length > 10) errors.push("events: at most 10 fit the canvas legibly");

  events.forEach((e, i) => {
    if (!isPlainObject(e)) {
      errors.push(`events[${i}] must be an object`);
      return;
    }
    if (!isNonEmptyString(e.label)) errors.push(`events[${i}].label is required`);
    if (!isNonEmptyString(e.date) || !parseEventDate(e.date)) {
      errors.push(`events[${i}].date must be YYYY, YYYY-MM or YYYY-MM-DD (got ${JSON.stringify(e.date)})`);
    }
    if (e.detail !== undefined && !isNonEmptyString(e.detail)) {
      errors.push(`events[${i}].detail, when present, must be a non-empty string`);
    }
  });
}

/**
 * Validate an untrusted spec object (typically parsed JSON).
 *
 * Fails closed: any error at all means no graphic is produced. The generator
 * treats a validation failure as a hard stop for the whole batch rather than
 * skipping the bad spec, because a partially-rendered batch is easy to mistake
 * for a complete one.
 */
export function validateGraphicSpec(input: unknown): ValidationResult {
  const errors: string[] = [];

  if (!isPlainObject(input)) {
    return { ok: false, errors: ["spec must be an object"] };
  }

  const forbidden = findForbiddenKeys(input);
  if (forbidden.length > 0) {
    errors.push(
      `rights/provenance metadata cannot be set from a spec file: ${forbidden.join(", ")}. ` +
        "The generator emits its own rights literals for work it actually produced."
    );
  }

  const kind = input.kind;
  if (typeof kind !== "string" || !KINDS.has(kind)) {
    return {
      ok: false,
      errors: [...errors, `kind must be one of comparison, spec_diagram, chart, timeline (got ${JSON.stringify(kind)})`],
    };
  }

  validateCommon(input, errors);

  if (kind === "comparison") validateComparison(input, errors);
  else if (kind === "spec_diagram") validateSpecDiagram(input, errors);
  else if (kind === "chart") validateChart(input, errors);
  else if (kind === "timeline") validateTimeline(input, errors);

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, spec: input as unknown as GraphicSpec };
}

/**
 * Deterministic, honest alt text. Describes what the graphic IS (an original
 * Tech Carvalho diagram) and what it shows, including how many figures are
 * missing — a screen-reader user gets the same caveat a sighted reader sees.
 */
export function buildAltText(spec: GraphicSpec): string {
  const source = `Source: ${spec.provenance.sourceLabel}, as of ${spec.provenance.asOf}.`;

  if (spec.kind === "comparison") {
    const s = spec as ComparisonSpec;
    const missing = s.rows.filter((r) => r.left === null || r.right === null).length;
    return (
      `Original Tech Carvalho comparison graphic: ${s.left.name} versus ${s.right.name}, ` +
      `comparing ${s.rows.length} specification${s.rows.length === 1 ? "" : "s"}` +
      (missing ? ` (${missing} with a value not available on one side)` : "") +
      `. ${source}`
    );
  }

  if (spec.kind === "spec_diagram") {
    const s = spec as SpecDiagramSpec;
    const missing = s.callouts.filter((c) => c.value === null).length;
    return (
      `Original Tech Carvalho labelled diagram (abstract, not a photograph) showing ` +
      `${s.callouts.length} specification${s.callouts.length === 1 ? "" : "s"} for ${s.subject}` +
      (missing ? `, ${missing} of which are not published` : "") +
      `. ${source}`
    );
  }

  if (spec.kind === "chart") {
    const s = spec as ChartSpec;
    const missing = s.series.reduce((n, ser) => n + ser.points.filter((p) => p === null).length, 0);
    return (
      `Original Tech Carvalho ${s.chartType} chart: ${s.title}, in ${s.unit}, across ` +
      `${s.categories.length} categories and ${s.series.length} series` +
      (missing ? ` (${missing} data point${missing === 1 ? "" : "s"} not available and shown as gaps)` : "") +
      `. ${source}`
    );
  }

  const s = spec as TimelineSpec;
  const dated = s.events
    .map((e) => parseEventDate(e.date))
    .filter((p): p is NonNullable<ReturnType<typeof parseEventDate>> => p !== null)
    .sort((a, b) => a.time - b.time);
  const range =
    dated.length > 1 ? ` from ${dated[0].display} to ${dated[dated.length - 1].display}` : "";
  return (
    `Original Tech Carvalho timeline diagram: ${s.title}, plotting ${s.events.length} dated events` +
    `${range}. ${source}`
  );
}
