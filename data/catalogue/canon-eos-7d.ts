// Canon EOS 7D Mark II — Canon's flagship APS-C DSLR. The original EOS 7D
// is now covered in canon-eos-7d-original.ts (same "canon-eos-7d" family,
// declared here), which also carries the successor_of edge back to it.
// Researched via WebFetch against Wikipedia's camera infobox.
//
// categorySlug uses a placeholder "cameras-photography" — VERIFY/ADJUST
// against the real taxonomy_categories table before running the ingestion
// script.

import type { CatalogueImport } from "@/lib/catalogue/import-types";

export const canonEos7d: CatalogueImport = {
  productFamilies: [
    {
      slug: "canon-eos-7d",
      name: "Canon EOS 7D",
      categorySlug: "cameras-photography",
      description: "Canon's flagship APS-C DSLR line, aimed at sports/wildlife shooters wanting DSLR speed with EF-S crop-sensor reach.",
    },
  ],
  products: [
    {
      slug: "canon-eos-7d-mark-ii",
      isPublished: true,
      name: "Canon EOS 7D Mark II",
      manufacturerSlug: "canon",
      categorySlug: "cameras-photography",
      familySlug: "canon-eos-7d",
      modelNumber: "EOS 7D Mark II",
      releaseDate: "2014-09-15",
      status: "discontinued",
      summary: "Flagship APS-C DSLR with a dense 65-point all cross-type AF system and a fully weather-sealed body, aimed at action/wildlife photography.",
      specs: [
        { specSlug: "sensor-format", value: "APS-C (22.4 x 15.0 mm)" },
        { specSlug: "sensor-type", value: "CMOS" },
        { specSlug: "effective-megapixels", value: 20.2 },
        { specSlug: "processor", value: "Dual DIGIC 6" },
        { specSlug: "lens-mount", value: "Canon EF-S" },
        { specSlug: "autofocus-system", value: "65 cross-type AF points, high-precision double cross-type centre point" },
        { specSlug: "iso-range", value: "100-16000" },
        { specSlug: "iso-range-expanded", value: "H1: 25600, H2: 51200" },
        { specSlug: "burst-rate-mechanical", value: 10 },
        { specSlug: "shutter-speed-range", value: "1/8000-30 s and Bulb; X-sync at 1/250 s" },
        { specSlug: "video-resolutions", value: "1080p and 720p up to 60fps" },
        { specSlug: "evf", value: "Eye-level pentaprism, 100% coverage, 1.0x magnification" },
        { specSlug: "rear-display", value: "3.0in Clear View II colour TFT LCD, 1,040,000 dots (fixed, not articulating)" },
        { specSlug: "storage-slots", value: "CompactFlash Type I (UDMA-7) + SD/SDHC/SDXC (UHS-I)" },
        { specSlug: "battery-model", value: "LP-E6/LP-E6N (1800/1865 mAh)" },
        { specSlug: "dimensions", value: "148.6 x 112.4 x 78.2 mm" },
        { specSlug: "weight", value: 820 },
        { specSlug: "weather-sealing", value: true },
        { specSlug: "connectivity", value: "Mini-HDMI, stereo mic port, headphone jack, USB 3.0" },
        { specSlug: "announcement-date", value: "15 September 2014" },
        { specSlug: "launch-msrp-usd", value: "$1,799 (body only)" },
      ],
      relationships: [{ relatedProductSlug: "canon-eos-7d", type: "successor_of" }],
      sources: [
        { url: "https://en.wikipedia.org/wiki/Canon_EOS_7D_Mark_II", publisher: "Wikipedia", reliabilityTier: "secondary" },
      ],
      metaTitle: "Canon EOS 7D Mark II: Flagship APS-C DSLR for Action",
      metaDescription:
        "Canon's fastest APS-C DSLR pairs a 65-point all cross-type AF system with full weather sealing and 10fps burst shooting — built for sports and wildlife.",
    },
  ],
};
