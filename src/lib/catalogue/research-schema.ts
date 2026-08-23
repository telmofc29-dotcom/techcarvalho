// The contract between research and the catalogue.
//
// Research arrives as JSON written by a separate process. This module is the
// only place that knows its shape, and it is deliberately strict: a field that
// does not validate is REJECTED rather than coerced, because a coerced spec is
// a fabricated one, and fabricated specifications are the single thing this
// catalogue cannot afford.
//
// WHY VALIDATION LIVES HERE AND NOT IN THE IMPORTER
// -------------------------------------------------
// So it can be unit-tested without a database. The importer does I/O; this does
// judgement. Every rule below is a rule about what may enter the catalogue, and
// each one is asserted in research-schema.test.ts.
//
// THE CENTRAL RULE
// ----------------
// null means "the manufacturer does not state this". It is a FACT and it is
// written as absence — no spec row at all. It must never become 0, "", "N/A",
// "Unknown" or a plausible-looking default. Three separate incidents in this
// project came from unmeasured state being read as a finding.
//
// Pure. No I/O.

export type SpecValue = string | number | boolean;

/** A spec definition the importer may need to create. */
export type SpecField = {
  /** Key in the research JSON. */
  key: string;
  /** Human name for spec_definitions.name. */
  name: string;
  /** spec_definitions.slug. */
  slug: string;
  dataType: "text" | "number" | "boolean" | "enum";
  unit: string | null;
};

/**
 * Lens specification fields.
 *
 * Note what is NOT here: `stabilisation_stops_claim` and anything else a
 * manufacturer asserts about performance. Those are claims and are routed to
 * product_claims, never to product_specs, because a spec row reads as a fact
 * about the object rather than a statement by the party selling it.
 */
export const LENS_SPEC_FIELDS: SpecField[] = [
  { key: "mount", name: "Lens mount", slug: "lens-mount-type", dataType: "text", unit: null },
  { key: "coverage", name: "Sensor coverage", slug: "sensor-coverage", dataType: "text", unit: null },
  { key: "lens_type", name: "Lens type", slug: "lens-type", dataType: "text", unit: null },
  { key: "focal_min_mm", name: "Focal length (min)", slug: "focal-length-min", dataType: "number", unit: "mm" },
  { key: "focal_max_mm", name: "Focal length (max)", slug: "focal-length-max", dataType: "number", unit: "mm" },
  { key: "aperture_max", name: "Maximum aperture", slug: "aperture-max", dataType: "number", unit: "f/" },
  { key: "aperture_max_tele", name: "Maximum aperture (tele)", slug: "aperture-max-tele", dataType: "number", unit: "f/" },
  { key: "aperture_min", name: "Minimum aperture", slug: "aperture-min", dataType: "number", unit: "f/" },
  { key: "stabilisation", name: "Stabilisation", slug: "lens-stabilisation", dataType: "text", unit: null },
  { key: "focus_motor", name: "Focus motor", slug: "focus-motor", dataType: "text", unit: null },
  { key: "elements", name: "Elements", slug: "optical-elements", dataType: "number", unit: null },
  { key: "groups", name: "Groups", slug: "optical-groups", dataType: "number", unit: null },
  { key: "aperture_blades", name: "Aperture blades", slug: "aperture-blades", dataType: "number", unit: null },
  { key: "min_focus_m", name: "Minimum focus distance", slug: "min-focus-distance", dataType: "number", unit: "m" },
  { key: "max_magnification", name: "Maximum magnification", slug: "max-magnification", dataType: "number", unit: "x" },
  { key: "filter_diameter_mm", name: "Filter diameter", slug: "filter-diameter", dataType: "number", unit: "mm" },
  { key: "weight_g", name: "Weight", slug: "lens-weight", dataType: "number", unit: "g" },
  { key: "diameter_mm", name: "Diameter", slug: "lens-diameter", dataType: "number", unit: "mm" },
  { key: "length_mm", name: "Length", slug: "lens-length", dataType: "number", unit: "mm" },
  { key: "weather_sealed", name: "Weather sealing", slug: "weather-sealed", dataType: "boolean", unit: null },
  { key: "control_ring", name: "Control ring", slug: "control-ring", dataType: "boolean", unit: null },
  { key: "tripod_collar", name: "Tripod collar", slug: "tripod-collar", dataType: "boolean", unit: null },
  { key: "focus_limiter", name: "Focus limiter", slug: "focus-limiter", dataType: "boolean", unit: null },
  { key: "internal_zoom", name: "Internal zoom", slug: "internal-zoom", dataType: "boolean", unit: null },
  { key: "internal_focus", name: "Internal focusing", slug: "internal-focus", dataType: "boolean", unit: null },
  { key: "extender_compatible", name: "Extender compatible", slug: "extender-compatible", dataType: "boolean", unit: null },
  { key: "teleconverter_compatible", name: "Teleconverter compatible", slug: "extender-compatible", dataType: "boolean", unit: null },
  { key: "macro", name: "Macro", slug: "macro-capable", dataType: "boolean", unit: null },
];

/** 3D printer specification fields. Speed and acceleration are absent by design. */
export const PRINTER_SPEC_FIELDS: SpecField[] = [
  { key: "technology", name: "Printing technology", slug: "print-technology", dataType: "text", unit: null },
  { key: "kinematics", name: "Motion system", slug: "print-kinematics", dataType: "text", unit: null },
  { key: "enclosed", name: "Enclosed", slug: "printer-enclosed", dataType: "boolean", unit: null },
  { key: "heated_chamber", name: "Heated chamber", slug: "heated-chamber", dataType: "boolean", unit: null },
  { key: "chamber_temp_max_c", name: "Chamber temperature (max)", slug: "chamber-temp-max", dataType: "number", unit: "°C" },
  { key: "build_volume_x_mm", name: "Build volume (X)", slug: "build-volume-x", dataType: "number", unit: "mm" },
  { key: "build_volume_y_mm", name: "Build volume (Y)", slug: "build-volume-y", dataType: "number", unit: "mm" },
  { key: "build_volume_z_mm", name: "Build volume (Z)", slug: "build-volume-z", dataType: "number", unit: "mm" },
  { key: "nozzle_diameter_mm", name: "Nozzle diameter", slug: "nozzle-diameter", dataType: "number", unit: "mm" },
  { key: "nozzle_temp_max_c", name: "Nozzle temperature (max)", slug: "nozzle-temp-max", dataType: "number", unit: "°C" },
  { key: "bed_temp_max_c", name: "Bed temperature (max)", slug: "bed-temp-max", dataType: "number", unit: "°C" },
  { key: "hotend_type", name: "Hotend", slug: "hotend-type", dataType: "text", unit: null },
  { key: "direct_drive", name: "Direct drive extruder", slug: "direct-drive", dataType: "boolean", unit: null },
  { key: "auto_bed_levelling", name: "Automatic bed levelling", slug: "auto-bed-levelling", dataType: "boolean", unit: null },
  { key: "levelling_method", name: "Levelling method", slug: "levelling-method", dataType: "text", unit: null },
  { key: "input_shaping", name: "Input shaping", slug: "input-shaping", dataType: "boolean", unit: null },
  { key: "multi_material", name: "Multi-material", slug: "multi-material", dataType: "boolean", unit: null },
  { key: "multi_material_system", name: "Multi-material system", slug: "multi-material-system", dataType: "text", unit: null },
  { key: "max_colours", name: "Maximum colours", slug: "max-colours", dataType: "number", unit: null },
  { key: "filament_diameter_mm", name: "Filament diameter", slug: "filament-diameter", dataType: "number", unit: "mm" },
  { key: "lcd_resolution", name: "LCD resolution", slug: "lcd-resolution", dataType: "text", unit: null },
  { key: "lcd_size_in", name: "LCD size", slug: "lcd-size", dataType: "number", unit: "in" },
  { key: "layer_min_mm", name: "Minimum layer height", slug: "layer-height-min", dataType: "number", unit: "mm" },
  { key: "light_source", name: "Light source", slug: "light-source", dataType: "text", unit: null },
  { key: "camera", name: "Built-in camera", slug: "built-in-camera", dataType: "boolean", unit: null },
  { key: "firmware", name: "Firmware", slug: "firmware", dataType: "text", unit: null },
];

/**
 * Camera BODY specification fields.
 *
 * Absent by design: burst rate and IBIS stops. Both are conditional on lens, AF
 * mode and buffer state, so a maker's figure is a claim under conditions nobody
 * states — they route to product_claims like every other performance assertion.
 */
export const CAMERA_BODY_SPEC_FIELDS: SpecField[] = [
  { key: "mount", name: "Lens mount", slug: "lens-mount", dataType: "text", unit: null },
  { key: "sensor_format", name: "Sensor format", slug: "sensor-format", dataType: "text", unit: null },
  { key: "sensor_type", name: "Sensor type", slug: "sensor-type", dataType: "text", unit: null },
  { key: "effective_megapixels", name: "Effective megapixels", slug: "effective-megapixels", dataType: "number", unit: "MP" },
  { key: "processor", name: "Processor", slug: "processor", dataType: "text", unit: null },
  { key: "image_stabilisation", name: "In-body stabilisation", slug: "ibis", dataType: "text", unit: null },
  { key: "iso_min", name: "ISO (min)", slug: "iso-min", dataType: "number", unit: null },
  { key: "iso_max", name: "ISO (max)", slug: "iso-max", dataType: "number", unit: null },
  { key: "af_system", name: "Autofocus system", slug: "autofocus-system", dataType: "text", unit: null },
  { key: "af_points", name: "Autofocus points", slug: "autofocus-points", dataType: "number", unit: null },
  { key: "video_max_resolution", name: "Maximum video resolution", slug: "video-max-resolution", dataType: "text", unit: null },
  { key: "video_max_fps", name: "Maximum video frame rate", slug: "video-max-fps", dataType: "number", unit: "fps" },
  { key: "viewfinder_type", name: "Viewfinder", slug: "viewfinder-type", dataType: "text", unit: null },
  { key: "viewfinder_resolution", name: "Viewfinder resolution", slug: "viewfinder-resolution", dataType: "text", unit: null },
  { key: "screen_type", name: "Screen", slug: "screen-type", dataType: "text", unit: null },
  { key: "screen_size_in", name: "Screen size", slug: "screen-size", dataType: "number", unit: "in" },
  { key: "card_slots", name: "Card slots", slug: "card-slots", dataType: "number", unit: null },
  { key: "battery", name: "Battery", slug: "battery", dataType: "text", unit: null },
  { key: "weight_g", name: "Weight", slug: "body-weight", dataType: "number", unit: "g" },
  { key: "width_mm", name: "Width", slug: "body-width", dataType: "number", unit: "mm" },
  { key: "height_mm", name: "Height", slug: "body-height", dataType: "number", unit: "mm" },
  { key: "depth_mm", name: "Depth", slug: "body-depth", dataType: "number", unit: "mm" },
  { key: "weather_sealed", name: "Weather sealing", slug: "weather-sealed", dataType: "boolean", unit: null },
];

export type ResearchProduct = Record<string, unknown> & {
  name?: unknown;
  slug?: unknown;
};

export type ValidationIssue = { slug: string; field: string; problem: string };

export type ValidatedProduct = {
  slug: string;
  name: string;
  manufacturerSlug: string;
  familySlug: string | null;
  summary: string | null;
  announced: string | null;
  /** How precisely `announced` is known. 'month' means the day is a storage artefact. */
  announcedPrecision: DatePrecision;
  status: "active" | "discontinued" | "rumored";
  maturity: string;
  /** Only fields the source actually stated. Absent fields are simply not here. */
  specs: { field: SpecField; value: SpecValue }[];
  claims: { claim: string; sourceUrl: string | null; kind: string }[];
  sourceUrls: string[];
  retrievedAt: string | null;
  /** Fields the research explicitly recorded as unsourced. */
  unsourced: string[];
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_MONTH = /^\d{4}-\d{2}$/;
const ISO_YEAR = /^\d{4}$/;

export type DatePrecision = "day" | "month" | "year" | "unknown";

/**
 * Read an announcement date at whatever precision the source actually gives.
 *
 * Canon, Nikon and Sony announce lenses with MONTH precision — "September
 * 2019" — and that is genuinely all that is known. Two wrong answers were
 * available here and both were taken at some point:
 *
 *   reject it   -> throws away real information, leaving the release date empty
 *                  on most of the catalogue.
 *   store it as
 *   the 1st     -> the site renders "1 Sep 2019", a fabricated day printed on
 *                  several hundred pages.
 *
 * So the date is normalised for storage AND its precision is carried, and the
 * display layer renders only what is known.
 */
export function readReleaseDate(raw: unknown): { date: string; precision: DatePrecision } | null {
  const t = typeof raw === "string" ? raw.trim() : "";
  if (!t) return null;
  if (ISO_DATE.test(t)) return { date: t, precision: "day" };
  if (ISO_MONTH.test(t)) return { date: `${t}-01`, precision: "month" };
  if (ISO_YEAR.test(t)) return { date: `${t}-01-01`, precision: "year" };
  return null;
}

function isBlank(v: unknown): boolean {
  return (
    v === null ||
    v === undefined ||
    (typeof v === "string" && v.trim() === "")
  );
}

/**
 * Values that look like data and are not.
 *
 * A researcher — human or otherwise — under pressure to fill a field will write
 * "N/A" or "Unknown" rather than leave it empty. Accepting those would put the
 * string "Unknown" in a specification table, which reads to a visitor as
 * something the manufacturer said.
 */
const NON_VALUES = new Set([
  "n/a", "na", "none", "unknown", "unspecified", "not stated", "not specified",
  "tbd", "tba", "-", "—", "?", "null", "undefined",
]);

function isNonValue(v: unknown): boolean {
  return typeof v === "string" && NON_VALUES.has(v.trim().toLowerCase());
}

/**
 * Coerce one research value into a spec value, or reject it.
 *
 * Returns null for "no value" (which the caller writes as absence) and an issue
 * for "value present but wrong shape" — the two must not be confused, because
 * the first is normal and the second is a defect in the research.
 */
export function readSpecValue(
  field: SpecField,
  raw: unknown
): { value: SpecValue } | { skip: true } | { issue: string } {
  if (isBlank(raw) || isNonValue(raw)) return { skip: true };

  switch (field.dataType) {
    case "number": {
      if (typeof raw === "number") {
        if (!Number.isFinite(raw)) return { issue: `non-finite number` };
        return { value: raw };
      }
      if (typeof raw === "string") {
        // A bare numeric string is acceptable; anything carrying units or words
        // is not, because it would silently become text in a number column.
        const trimmed = raw.trim().replace(",", ".");
        if (!/^-?\d+(\.\d+)?$/.test(trimmed)) {
          return { issue: `expected a bare number, got ${JSON.stringify(raw)}` };
        }
        return { value: Number(trimmed) };
      }
      return { issue: `expected number, got ${typeof raw}` };
    }
    case "boolean": {
      if (typeof raw === "boolean") return { value: raw };
      // "true"/"false" strings are accepted; anything else is rejected rather
      // than being treated as truthy, which is how "no" becomes yes.
      if (typeof raw === "string") {
        const t = raw.trim().toLowerCase();
        if (t === "true" || t === "yes") return { value: true };
        if (t === "false" || t === "no") return { value: false };
      }
      return { issue: `expected boolean, got ${JSON.stringify(raw)}` };
    }
    case "text":
    case "enum": {
      if (typeof raw === "string") return { value: raw.trim() };
      if (typeof raw === "number" || typeof raw === "boolean") return { value: String(raw) };
      return { issue: `expected text, got ${typeof raw}` };
    }
  }
}

const VALID_MATURITY = new Set([
  "announced", "demonstrated", "prototype", "pilot", "production",
  "commercially_available", "discontinued", "unknown",
]);

/**
 * Turn one research record into something the importer may write, or explain
 * why it may not.
 *
 * A product with no name or no slug is rejected outright: those are identity,
 * and a catalogue entry without identity is not a partial record, it is noise.
 */
export function validateProduct(
  raw: ResearchProduct,
  fields: SpecField[],
  defaults: { manufacturerSlug?: string } = {}
): { product: ValidatedProduct; issues: ValidationIssue[] } | { rejected: string } {
  const slug = typeof raw.slug === "string" ? raw.slug.trim() : "";
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  if (!slug) return { rejected: "no slug" };
  if (!name) return { rejected: `no name (${slug})` };
  if (!/^[a-z0-9-]+$/.test(slug)) return { rejected: `slug is not url-safe: ${slug}` };

  const manufacturerSlug =
    (typeof raw.manufacturer_slug === "string" && raw.manufacturer_slug.trim()) ||
    (typeof raw.manufacturer === "string" && raw.manufacturer.trim().toLowerCase().replace(/\s+/g, "-")) ||
    defaults.manufacturerSlug ||
    "";
  if (!manufacturerSlug) return { rejected: `no manufacturer (${slug})` };

  const issues: ValidationIssue[] = [];
  const specs: { field: SpecField; value: SpecValue }[] = [];
  const seen = new Set<string>();

  for (const field of fields) {
    const read = readSpecValue(field, raw[field.key]);
    if ("skip" in read) continue;
    if ("issue" in read) {
      issues.push({ slug, field: field.key, problem: read.issue });
      continue;
    }
    // Two research keys can map to one definition (extender/teleconverter
    // compatibility). First wins; a conflicting second is reported rather than
    // silently overwriting.
    if (seen.has(field.slug)) {
      issues.push({ slug, field: field.key, problem: `duplicate spec slug ${field.slug}` });
      continue;
    }
    seen.add(field.slug);
    specs.push({ field, value: read.value });
  }

  const claims: ValidatedProduct["claims"] = [];
  if (Array.isArray(raw.manufacturer_claims)) {
    for (const c of raw.manufacturer_claims as Record<string, unknown>[]) {
      const text = typeof c?.claim === "string" ? c.claim.trim() : "";
      if (!text) continue;
      claims.push({
        claim: text,
        sourceUrl: typeof c.source_url === "string" ? c.source_url : null,
        kind: typeof c.claim_kind === "string" ? c.claim_kind : "manufacturer_marketing",
      });
    }
  }
  // A stabilisation stops figure is a CLAIM even when the research put it in a
  // top-level field, so it is captured here rather than dropped.
  if (!isBlank(raw.stabilisation_stops_claim)) {
    claims.push({
      claim: `Stabilisation: up to ${String(raw.stabilisation_stops_claim)} stops (manufacturer figure)`,
      sourceUrl: Array.isArray(raw.source_urls) && typeof raw.source_urls[0] === "string" ? raw.source_urls[0] : null,
      kind: "manufacturer_performance",
    });
  }

  const announcedRaw = typeof raw.announced === "string" ? raw.announced.trim() : "";
  const read = readReleaseDate(announcedRaw);
  const announced = read?.date ?? null;
  const announcedPrecision: DatePrecision = read?.precision ?? "unknown";
  if (announcedRaw && !read) {
    issues.push({ slug, field: "announced", problem: `unparseable date: ${announcedRaw}` });
  }

  const statusRaw = typeof raw.status === "string" ? raw.status.trim() : "";
  const status: ValidatedProduct["status"] =
    statusRaw === "discontinued" ? "discontinued" : statusRaw === "announced" ? "rumored" : "active";

  const maturityRaw = typeof raw.maturity === "string" ? raw.maturity.trim() : "";
  let maturity = "unknown";
  if (maturityRaw) {
    if (VALID_MATURITY.has(maturityRaw)) maturity = maturityRaw;
    else issues.push({ slug, field: "maturity", problem: `unknown maturity: ${maturityRaw}` });
  } else if (statusRaw === "shipping" || statusRaw === "current") {
    maturity = "commercially_available";
  } else if (statusRaw === "discontinued") {
    maturity = "discontinued";
  }

  return {
    product: {
      slug,
      name,
      manufacturerSlug,
      familySlug: typeof raw.family_slug === "string" ? raw.family_slug : null,
      summary: typeof raw.summary === "string" && raw.summary.trim() ? raw.summary.trim() : null,
      announced,
      announcedPrecision,
      status,
      maturity,
      specs,
      claims,
      sourceUrls: Array.isArray(raw.source_urls)
        ? (raw.source_urls as unknown[]).filter((u): u is string => typeof u === "string" && u.startsWith("http"))
        : [],
      retrievedAt: typeof raw.retrieved_at === "string" ? raw.retrieved_at : null,
      unsourced: Array.isArray(raw.unsourced_fields)
        ? (raw.unsourced_fields as unknown[]).filter((f): f is string => typeof f === "string")
        : [],
    },
    issues,
  };
}

/** Relationship types the catalogue accepts, mirroring the database CHECK. */
export const VALID_RELATIONSHIP_TYPES = new Set([
  "successor_of", "alternative_to", "accessory_for", "compatible_with", "requires",
  "same_family", "modern_equivalent", "mount_successor", "requires_adapter",
  "supports_extender", "competes_with",
]);

export type ValidatedRelationship = {
  fromSlug: string;
  toSlug: string;
  type: string;
  basis: string | null;
  sourceUrl: string | null;
};

/**
 * A relationship is only accepted with a BASIS.
 *
 * The expansion brief is explicit that a successor must not be inferred from
 * similar specifications. That is only enforceable if the reason travels with
 * the edge, so an edge without one is rejected rather than imported with an
 * empty justification nobody will ever fill in.
 */
export function validateRelationship(raw: Record<string, unknown>): ValidatedRelationship | { rejected: string } {
  const fromSlug = typeof raw.from_slug === "string" ? raw.from_slug.trim() : String(raw.from ?? "").trim();
  const toSlug = typeof raw.to_slug === "string" ? raw.to_slug.trim() : String(raw.to ?? "").trim();
  const type = typeof raw.type === "string" ? raw.type.trim() : "";
  const basis = typeof raw.basis === "string" && raw.basis.trim() ? raw.basis.trim() : null;

  if (!fromSlug || !toSlug) return { rejected: "missing endpoint" };
  if (fromSlug === toSlug) return { rejected: `self-relationship: ${fromSlug}` };
  if (!VALID_RELATIONSHIP_TYPES.has(type)) return { rejected: `unknown type '${type}' (${fromSlug} -> ${toSlug})` };
  if (type === "predecessor" || type === "predecessor_of") {
    return { rejected: "predecessor is not a stored type; the reverse of successor_of is inferred" };
  }
  if (!basis) return { rejected: `no basis given (${fromSlug} ${type} ${toSlug})` };

  return {
    fromSlug,
    toSlug,
    type,
    basis,
    sourceUrl: typeof raw.source_url === "string" && raw.source_url.startsWith("http") ? raw.source_url : null,
  };
}
