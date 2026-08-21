// Canon EOS R8 — added to the existing "canon-eos-r-full-frame" family
// (canon-eos-r-full-frame.ts: EOS R, EOS RP, EOS R6). This file deliberately
// does NOT redeclare that productFamily — both files are loaded together by
// the ingestion script's glob. No `successor_of` relationship is asserted:
// the R8 shares its sensor/processor with the R6 Mark II but is a distinct,
// lower/lighter tier launched alongside it, not a direct replacement for
// R, RP, or R6 — same non-assertion policy the family file's own header
// comment already documents for R/RP/R6 among themselves.
//
// Researched via WebFetch against Wikipedia's camera infobox.
//
// categorySlug uses a placeholder "cameras-photography" — VERIFY/ADJUST
// against the real taxonomy_categories table before running the ingestion
// script.

import type { CatalogueImport } from "@/lib/catalogue/import-types";

export const canonEosR8: CatalogueImport = {
  products: [
    {
      slug: "canon-eos-r8",
      isPublished: true,
      name: "Canon EOS R8",
      manufacturerSlug: "canon",
      categorySlug: "cameras-photography",
      familySlug: "canon-eos-r-full-frame",
      modelNumber: "EOS R8",
      releaseDate: "2023-04-18",
      status: "active",
      summary: "Compact, lightweight full-frame RF mirrorless body sharing its 24.2MP sensor and DIGIC X processor with the EOS R6 Mark II, but without in-body stabilisation to keep the body small.",
      specs: [
        { specSlug: "sensor-format", value: "Full-frame (36 x 24 mm)" },
        { specSlug: "sensor-type", value: "Dual Pixel CMOS" },
        { specSlug: "effective-megapixels", value: 24.2 },
        { specSlug: "processor", value: "DIGIC X" },
        { specSlug: "lens-mount", value: "Canon RF" },
        { specSlug: "autofocus-system", value: "Dual Pixel CMOS AF II, 4,897 AF points, up to 100% horizontal / 100% vertical coverage with Face + Tracking" },
        { specSlug: "iso-range", value: "100-102400" },
        { specSlug: "iso-range-expanded", value: "50-204800" },
        { specSlug: "burst-rate-mechanical", value: 6 },
        { specSlug: "burst-rate-electronic", value: 40 },
        { specSlug: "shutter-speed-range", value: "30 s to 1/16,000 s" },
        { specSlug: "video-resolutions", value: "4K UHD at up to 59.94fps; Full HD at up to 180fps; 10-bit with HDR PQ and C-Log3 support" },
        { specSlug: "image-stabilisation", value: "None (lens-based IS only)" },
        { specSlug: "evf", value: "2.36m-dot OLED EVF, 0.70x magnification, 100% coverage" },
        { specSlug: "rear-display", value: "3.0in fully articulating touchscreen, approx. 1.62m dots" },
        { specSlug: "storage-slots", value: "1x SD/SDHC/SDXC (UHS-II)" },
        { specSlug: "battery-model", value: "LP-E17" },
        { specSlug: "dimensions", value: "132.5 x 86.1 x 70.0 mm" },
        { specSlug: "weight", value: 414 },
        { specSlug: "weather-sealing", value: true },
        { specSlug: "connectivity", value: "Wi-Fi, Bluetooth" },
        { specSlug: "announcement-date", value: "8 February 2023" },
        { specSlug: "launch-msrp-usd", value: "$1,499 (body only)" },
      ],
      sources: [
        { url: "https://en.wikipedia.org/wiki/Canon_EOS_R8", publisher: "Wikipedia", reliabilityTier: "secondary" },
      ],
    },
  ],
};
