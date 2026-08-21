// Canonical, normalized spec_definitions vocabulary for the Cameras &
// Photography category — defined once here so catalogue imports never
// create near-duplicate definitions because two sources phrased a spec
// name slightly differently (e.g. "ISO Range" vs "ISO sensitivity").
// Every camera ProductImport should reference these slugs in its `specs`
// array; do not invent a new spec slug for a camera without adding it
// here first.
//
// `categorySlug` is left undefined (global) rather than scoped to a single
// taxonomy category slug, since the exact slug for "Cameras & Photography"
// depends on what's actually seeded in taxonomy_categories — the ingestion
// script resolves category scoping at import time if/when needed. Kept
// broad and reusable is the safer default per the spec_definitions design
// (CLAUDE.md: "spec_definitions... optionally scoped to a taxonomy
// category... same mechanism for a camera's sensor size as a GPU's memory
// bus width" — these are camera-specific in practice but nothing here
// prevents reuse).

import type { SpecDefinitionImport } from "./import-types";

export const CAMERA_SPEC_DEFINITIONS: SpecDefinitionImport[] = [
  { slug: "sensor-format", name: "Sensor format", dataType: "text" },
  { slug: "sensor-type", name: "Sensor type", dataType: "text" },
  { slug: "effective-megapixels", name: "Effective megapixels", dataType: "number", unit: "MP" },
  { slug: "processor", name: "Processor", dataType: "text" },
  { slug: "lens-mount", name: "Lens mount", dataType: "text" },
  { slug: "autofocus-system", name: "Autofocus system", dataType: "text" },
  { slug: "iso-range", name: "ISO range (native)", dataType: "text" },
  { slug: "iso-range-expanded", name: "ISO range (expanded)", dataType: "text" },
  { slug: "burst-rate-mechanical", name: "Burst rate (mechanical shutter)", dataType: "number", unit: "fps" },
  { slug: "burst-rate-electronic", name: "Burst rate (electronic shutter)", dataType: "number", unit: "fps" },
  { slug: "shutter-speed-range", name: "Shutter speed range", dataType: "text" },
  { slug: "video-resolutions", name: "Video resolutions/frame rates", dataType: "text" },
  { slug: "video-recording-limit", name: "Video recording time limit", dataType: "text" },
  { slug: "image-stabilisation", name: "Image stabilisation", dataType: "text" },
  { slug: "evf", name: "Electronic viewfinder", dataType: "text" },
  { slug: "rear-display", name: "Rear display", dataType: "text" },
  { slug: "storage-slots", name: "Storage/card slots", dataType: "text" },
  { slug: "battery-model", name: "Battery model", dataType: "text" },
  { slug: "battery-life-shots", name: "Battery life (CIPA shots)", dataType: "number", unit: "shots" },
  { slug: "dimensions", name: "Dimensions (W×H×D)", dataType: "text", unit: "mm" },
  { slug: "weight", name: "Weight (body only)", dataType: "number", unit: "g" },
  { slug: "weather-sealing", name: "Weather sealing", dataType: "boolean" },
  { slug: "connectivity", name: "Connectivity", dataType: "text" },
  { slug: "announcement-date", name: "Announcement date", dataType: "text" },
  { slug: "launch-msrp-usd", name: "Launch MSRP (USD, body only)", dataType: "text" },
];
