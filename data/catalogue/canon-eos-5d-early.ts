// Original Canon EOS 5D and EOS 5D Mark II — the earlier two generations of
// the "canon-eos-5d" full-frame DSLR family, whose Mark III/Mark IV entries
// already live in canon-eos-5d.ts. Completes the full chain: 5D -> 5D Mark
// II -> 5D Mark III -> 5D Mark IV. This file deliberately does NOT redeclare
// the "canon-eos-5d" productFamily — it already exists in canon-eos-5d.ts
// and both files are loaded together by the ingestion script's glob.
//
// Researched via WebFetch against Wikipedia camera infoboxes. The original
// 5D predates on-camera video recording, so no video-resolutions spec is
// given for it. Neither camera had an explicit weather-sealing statement in
// its infobox, so that field is omitted rather than assumed false — same
// for battery-life-shots (CIPA), which neither infobox provided.
//
// categorySlug uses a placeholder "cameras-photography" — VERIFY/ADJUST
// against the real taxonomy_categories table before running the ingestion
// script.

import type { CatalogueImport } from "@/lib/catalogue/import-types";

export const canonEos5dEarly: CatalogueImport = {
  products: [
    {
      slug: "canon-eos-5d",
      name: "Canon EOS 5D",
      manufacturerSlug: "canon",
      categorySlug: "cameras-photography",
      familySlug: "canon-eos-5d",
      modelNumber: "EOS 5D",
      releaseDate: "2005-08-22",
      status: "discontinued",
      summary: "Canon's first full-frame DSLR under $3,500, bringing 35mm-equivalent field of view to EF lenses without the professional-body bulk of the EOS-1Ds.",
      specs: [
        { specSlug: "sensor-format", value: "Full-frame (35.8 x 23.9 mm)" },
        { specSlug: "sensor-type", value: "CMOS" },
        { specSlug: "effective-megapixels", value: 12.7 },
        { specSlug: "processor", value: "DIGIC II" },
        { specSlug: "lens-mount", value: "Canon EF" },
        { specSlug: "autofocus-system", value: "9 AF points plus 6 invisible assist points" },
        { specSlug: "iso-range", value: "100-1600" },
        { specSlug: "iso-range-expanded", value: "L: 50, H: 3200" },
        { specSlug: "burst-rate-mechanical", value: 3 },
        { specSlug: "shutter-speed-range", value: "30 s to 1/8000 s and Bulb; X-sync at 1/200 s" },
        { specSlug: "evf", value: "Optical pentaprism, approx. 96% coverage" },
        { specSlug: "rear-display", value: "2.5in, 230,000 dots" },
        { specSlug: "storage-slots", value: "CompactFlash (Type I/II)" },
        { specSlug: "battery-model", value: "BP-511A" },
        { specSlug: "dimensions", value: "152 x 113 x 75 mm" },
        { specSlug: "weight", value: 810 },
        { specSlug: "announcement-date", value: "22 August 2005" },
        { specSlug: "launch-msrp-usd", value: "$3,299 (body only)" },
      ],
      sources: [
        { url: "https://en.wikipedia.org/wiki/Canon_EOS_5D", publisher: "Wikipedia", reliabilityTier: "secondary" },
      ],
    },
    {
      slug: "canon-eos-5d-mark-ii",
      name: "Canon EOS 5D Mark II",
      manufacturerSlug: "canon",
      categorySlug: "cameras-photography",
      familySlug: "canon-eos-5d",
      modelNumber: "EOS 5D Mark II",
      releaseDate: "2008-09-17",
      status: "discontinued",
      summary: "Nearly doubled the original 5D's resolution to 21MP and added 1080p video recording — the first full-frame DSLR to do so, which drove rapid adoption in independent film and broadcast production.",
      specs: [
        { specSlug: "sensor-format", value: "Full-frame (36 x 24 mm)" },
        { specSlug: "sensor-type", value: "CMOS" },
        { specSlug: "effective-megapixels", value: 21.0 },
        { specSlug: "processor", value: "DIGIC 4" },
        { specSlug: "lens-mount", value: "Canon EF" },
        { specSlug: "autofocus-system", value: "9 user-selectable AF points plus 6 assist points" },
        { specSlug: "iso-range", value: "100-6400" },
        { specSlug: "iso-range-expanded", value: "L: 50, H: 25600" },
        { specSlug: "burst-rate-mechanical", value: 3.9 },
        { specSlug: "shutter-speed-range", value: "30 s to 1/8000 s" },
        { specSlug: "video-resolutions", value: "1080p at 29.97/25/23.976fps; 640x480 (SDTV) at similar rates" },
        { specSlug: "evf", value: "Fixed eye-level pentaprism, 98% coverage, 0.71x magnification" },
        { specSlug: "rear-display", value: "3.0in, 921,600 dots" },
        { specSlug: "storage-slots", value: "CompactFlash (Type I/II)" },
        { specSlug: "battery-model", value: "LP-E6 (1800 mAh)" },
        { specSlug: "dimensions", value: "152 x 113.5 x 75 mm" },
        { specSlug: "weight", value: 810 },
        { specSlug: "connectivity", value: "HDMI (Mini HDMI Type C)" },
        { specSlug: "announcement-date", value: "17 September 2008" },
        { specSlug: "launch-msrp-usd", value: "$2,699 (body only)" },
      ],
      relationships: [{ relatedProductSlug: "canon-eos-5d", type: "successor_of" }],
      sources: [
        { url: "https://en.wikipedia.org/wiki/Canon_EOS_5D_Mark_II", publisher: "Wikipedia", reliabilityTier: "secondary" },
      ],
    },
  ],
};
