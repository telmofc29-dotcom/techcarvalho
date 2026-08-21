// Original Canon EOS 7D — completes the "canon-eos-7d" family alongside the
// existing EOS 7D Mark II entry in canon-eos-7d.ts. This file deliberately
// does NOT redeclare the "canon-eos-7d" productFamily — it already exists
// in canon-eos-7d.ts and both files are loaded together by the ingestion
// script's glob.
//
// Researched via WebFetch against Wikipedia's camera infobox. The
// `dimensions` spec is deliberately omitted: it was not present in the
// fetched infobox content, and per this project's data-quality rule an
// unverified field is left out rather than estimated from similar-era
// bodies.
//
// categorySlug uses a placeholder "cameras-photography" — VERIFY/ADJUST
// against the real taxonomy_categories table before running the ingestion
// script.

import type { CatalogueImport } from "@/lib/catalogue/import-types";

export const canonEos7dOriginal: CatalogueImport = {
  products: [
    {
      slug: "canon-eos-7d",
      name: "Canon EOS 7D",
      manufacturerSlug: "canon",
      categorySlug: "cameras-photography",
      familySlug: "canon-eos-7d",
      modelNumber: "EOS 7D",
      releaseDate: "2009-09-01",
      status: "discontinued",
      summary: "Introduced the 7D line as Canon's flagship APS-C DSLR, pairing dual DIGIC 4 processors with a dense 19-point all cross-type AF array and a weather-resistant magnesium-alloy body.",
      specs: [
        { specSlug: "sensor-format", value: "APS-C (22.3 x 14.9 mm)" },
        { specSlug: "sensor-type", value: "CMOS" },
        { specSlug: "effective-megapixels", value: 18.0 },
        { specSlug: "processor", value: "Dual DIGIC 4" },
        { specSlug: "lens-mount", value: "Canon EF-S" },
        { specSlug: "autofocus-system", value: "19 cross-type AF points, double cross-type centre point at f/2.8 or faster" },
        { specSlug: "iso-range", value: "100-6400" },
        { specSlug: "iso-range-expanded", value: "H: 12800" },
        { specSlug: "burst-rate-mechanical", value: 8 },
        { specSlug: "shutter-speed-range", value: "30 s to 1/8000 s and Bulb; X-sync at 1/250 s" },
        { specSlug: "video-resolutions", value: "1080p at 24/25/30fps; 720p at 50/60fps; 480p (VGA) at 50/60fps" },
        { specSlug: "evf", value: "Optical pentaprism with electronic Live View overlay, 100% coverage, 1.0x magnification" },
        { specSlug: "rear-display", value: "3.0in Clear View, 921,600 dots" },
        { specSlug: "storage-slots", value: "CompactFlash (Type I/II)" },
        { specSlug: "battery-model", value: "LP-E6 (1800 mAh)" },
        { specSlug: "weight", value: 820 },
        { specSlug: "weather-sealing", value: true },
        { specSlug: "announcement-date", value: "1 September 2009" },
        { specSlug: "launch-msrp-usd", value: "$1,699 (body only)" },
      ],
      sources: [
        { url: "https://en.wikipedia.org/wiki/Canon_EOS_7D", publisher: "Wikipedia", reliabilityTier: "secondary" },
      ],
    },
  ],
};
