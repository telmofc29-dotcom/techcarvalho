// Canon EOS 6D full-frame entry-level DSLR generation: 6D -> 6D Mark II.
// Researched via WebFetch against Wikipedia camera infoboxes. Every
// numeric/dated field below was read from a fetch, not recalled from
// memory; unconfirmed fields (e.g. weather sealing on either body — neither
// source stated it either way) were omitted rather than guessed.
//
// categorySlug uses a placeholder "cameras-photography" — VERIFY/ADJUST
// against the real taxonomy_categories table before running the ingestion
// script (see canon-eos-xxd.ts for the same note).

import type { CatalogueImport } from "@/lib/catalogue/import-types";

export const canonEos6d: CatalogueImport = {
  productFamilies: [
    {
      slug: "canon-eos-6d",
      name: "Canon EOS 6D",
      categorySlug: "cameras-photography",
      description: "Canon's entry point into full-frame EF-mount DSLRs.",
    },
  ],
  products: [
    {
      slug: "canon-eos-6d",
      isPublished: true,
      name: "Canon EOS 6D",
      manufacturerSlug: "canon",
      categorySlug: "cameras-photography",
      familySlug: "canon-eos-6d",
      modelNumber: "EOS 6D",
      releaseDate: "2012-09-17", // Announcement date; Wikipedia gives retail availability as "late November 2012" without an exact day.
      status: "discontinued",
      summary: "Canon's first entry-level full-frame DSLR, positioned below the 5D line, with built-in GPS/Wi-Fi on the WG variant.",
      specs: [
        { specSlug: "sensor-format", value: "Full-frame (35.8 x 23.9 mm)" },
        { specSlug: "sensor-type", value: "CMOS" },
        { specSlug: "effective-megapixels", value: 20.2 },
        { specSlug: "processor", value: "DIGIC 5+" },
        { specSlug: "lens-mount", value: "Canon EF" },
        { specSlug: "autofocus-system", value: "11-point AF, 1 cross-type centre point (sensitive to -3 EV)" },
        { specSlug: "iso-range", value: "100-25600" },
        { specSlug: "iso-range-expanded", value: "L: 50, H1: 51200, H2: 102400" },
        { specSlug: "burst-rate-mechanical", value: 4.5 },
        { specSlug: "shutter-speed-range", value: "30 s to 1/4000 s, Bulb; X-sync at 1/180 s" },
        { specSlug: "video-resolutions", value: "1920x1080 at 24/25/30p; 1280x720 at 50/60p; 640x480 at 50/60p" },
        { specSlug: "evf", value: "Optical pentaprism, 97% coverage, 0.71x magnification" },
        { specSlug: "rear-display", value: "3.0in, approx. 1,040,000 dots" },
        { specSlug: "storage-slots", value: "SD/SDHC/SDXC (UHS-I)" },
        { specSlug: "battery-model", value: "LP-E6 (1800 mAh)" },
        { specSlug: "dimensions", value: "144.5 x 110.5 x 71.2 mm" },
        { specSlug: "weight", value: 680 },
        { specSlug: "connectivity", value: "Wi-Fi; GPS (WG variant only)" },
        { specSlug: "announcement-date", value: "17 September 2012" },
        { specSlug: "launch-msrp-usd", value: "$1,899 (body only)" },
      ],
      sources: [
        { url: "https://en.wikipedia.org/wiki/Canon_EOS_6D", publisher: "Wikipedia", reliabilityTier: "secondary" },
      ],
      metaTitle: "Canon EOS 6D: Canon's First Entry-Level Full-Frame DSLR",
      metaDescription:
        "Launched in 2012 below the 5D line, the original 6D pairs a 20.2MP full-frame sensor with built-in Wi-Fi and, on the WG variant, GPS.",
    },
    {
      slug: "canon-eos-6d-mark-ii",
      isPublished: true,
      name: "Canon EOS 6D Mark II",
      manufacturerSlug: "canon",
      categorySlug: "cameras-photography",
      familySlug: "canon-eos-6d",
      modelNumber: "EOS 6D Mark II",
      releaseDate: "2017-06-29",
      status: "discontinued",
      summary: "Adds a vari-angle touchscreen, a much denser 45-point all cross-type AF system, and Bluetooth/NFC over the original 6D.",
      specs: [
        { specSlug: "sensor-format", value: "Full-frame (36 x 24 mm)" },
        { specSlug: "sensor-type", value: "CMOS" },
        { specSlug: "effective-megapixels", value: 26.2 },
        { specSlug: "processor", value: "DIGIC 7" },
        { specSlug: "lens-mount", value: "Canon EF" },
        { specSlug: "autofocus-system", value: "45 cross-type AF points, centre point sensitive to -3 EV at f/2.8" },
        { specSlug: "iso-range", value: "100-40000" },
        { specSlug: "iso-range-expanded", value: "L: 50, H2: 102400" },
        { specSlug: "burst-rate-mechanical", value: 6.5 },
        { specSlug: "shutter-speed-range", value: "1/4000 s - 30 s, Bulb; X-sync at 1/180 s" },
        { specSlug: "video-resolutions", value: "1080p at 60/50 fps; 4K time-lapse only (no 4K video recording)" },
        { specSlug: "evf", value: "Optical pentaprism, 98% coverage, 0.71x magnification" },
        { specSlug: "rear-display", value: "3.0in vari-angle touchscreen, 1,040,000 dots" },
        { specSlug: "storage-slots", value: "SD/SDHC/SDXC (UHS-I)" },
        { specSlug: "battery-model", value: "LP-E6N" },
        { specSlug: "battery-life-shots", value: 1200 },
        { specSlug: "dimensions", value: "144.0 x 110.5 x 74.8 mm" },
        { specSlug: "weight", value: 685 },
        { specSlug: "connectivity", value: "NFC, Bluetooth, Wi-Fi" },
        { specSlug: "announcement-date", value: "29 June 2017" },
        { specSlug: "launch-msrp-usd", value: "$1,999 (body only)" },
      ],
      relationships: [{ relatedProductSlug: "canon-eos-6d", type: "successor_of" }],
      sources: [
        { url: "https://en.wikipedia.org/wiki/Canon_EOS_6D_Mark_II", publisher: "Wikipedia", reliabilityTier: "secondary" },
      ],
      metaTitle: "Canon EOS 6D Mark II: 26MP Full-Frame, Vari-Angle Screen",
      metaDescription:
        "Canon's 2017 update adds a vari-angle touchscreen, a 45-point all cross-type AF system, and Bluetooth/NFC over the original 6D — still no 4K video.",
    },
  ],
};
