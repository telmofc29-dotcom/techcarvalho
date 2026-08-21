// Canon EOS 5D professional/enthusiast full-frame DSLR generation:
// 5D Mark III -> 5D Mark IV. Researched via WebFetch against Wikipedia
// camera infoboxes. Every numeric/dated field below was read from a fetch.
//
// categorySlug uses a placeholder "cameras-photography" — VERIFY/ADJUST
// against the real taxonomy_categories table before running the ingestion
// script.

import type { CatalogueImport } from "@/lib/catalogue/import-types";

export const canonEos5d: CatalogueImport = {
  productFamilies: [
    {
      slug: "canon-eos-5d",
      name: "Canon EOS 5D",
      categorySlug: "cameras-photography",
      description: "Canon's flagship enthusiast/prosumer full-frame DSLR line.",
    },
  ],
  products: [
    {
      slug: "canon-eos-5d-mark-iii",
      isPublished: true,
      name: "Canon EOS 5D Mark III",
      manufacturerSlug: "canon",
      categorySlug: "cameras-photography",
      familySlug: "canon-eos-5d",
      modelNumber: "EOS 5D Mark III",
      releaseDate: "2012-03-02",
      status: "discontinued",
      summary: "Replaced the influential original 5D Mark II with a faster 61-point AF system, dual card slots, and improved weather sealing.",
      specs: [
        { specSlug: "sensor-format", value: "Full-frame (36 x 24 mm)" },
        { specSlug: "sensor-type", value: "CMOS" },
        { specSlug: "effective-megapixels", value: 22.3 },
        { specSlug: "processor", value: "DIGIC 5+" },
        { specSlug: "lens-mount", value: "Canon EF" },
        { specSlug: "autofocus-system", value: "61-point AF, 41 cross-type (High-density Reticular AF)" },
        { specSlug: "iso-range", value: "100-25600" },
        { specSlug: "iso-range-expanded", value: "L: 50, H2: 102400" },
        { specSlug: "burst-rate-mechanical", value: 6 },
        { specSlug: "shutter-speed-range", value: "30 sec. - 1/8000 sec. and Bulb; X-sync at 1/200 sec." },
        { specSlug: "evf", value: "Eye-level pentaprism, 100% coverage, 0.71x magnification" },
        { specSlug: "rear-display", value: "3.2in, 1,040,000 dots" },
        { specSlug: "storage-slots", value: "CompactFlash Type I (UDMA-7) + SD/SDHC/SDXC" },
        { specSlug: "battery-model", value: "LP-E6 (1800 mAh); also compatible with LP-E6NH" },
        { specSlug: "dimensions", value: "152 x 116.4 x 76.4 mm" },
        { specSlug: "weight", value: 860 },
        { specSlug: "weather-sealing", value: true },
        { specSlug: "announcement-date", value: "2 March 2012" },
        { specSlug: "launch-msrp-usd", value: "$3,499 (body only)" },
      ],
      relationships: [{ relatedProductSlug: "canon-eos-5d-mark-ii", type: "successor_of" }],
      sources: [
        { url: "https://en.wikipedia.org/wiki/Canon_EOS_5D_Mark_III", publisher: "Wikipedia", reliabilityTier: "secondary" },
      ],
      metaTitle: "Canon EOS 5D Mark III: 22MP Full-Frame, 61-Point AF",
      metaDescription:
        "Replaced the influential 5D Mark II in 2012 with a faster 61-point AF system, dual card slots, and improved weather sealing on a 22.3MP sensor.",
    },
    {
      slug: "canon-eos-5d-mark-iv",
      isPublished: true,
      name: "Canon EOS 5D Mark IV",
      manufacturerSlug: "canon",
      categorySlug: "cameras-photography",
      familySlug: "canon-eos-5d",
      modelNumber: "EOS 5D Mark IV",
      releaseDate: "2016-08-25",
      status: "discontinued",
      summary: "Added 4K video, a higher-resolution 30.4MP sensor, and Dual Pixel RAW over the 5D Mark III, while keeping the same enthusiast/professional positioning.",
      specs: [
        { specSlug: "sensor-format", value: "Full-frame (36 x 24 mm)" },
        { specSlug: "sensor-type", value: "CMOS" },
        { specSlug: "effective-megapixels", value: 30.4 },
        { specSlug: "processor", value: "DIGIC 6+ (imaging); DIGIC 6 (metering/tracking)" },
        { specSlug: "lens-mount", value: "Canon EF" },
        { specSlug: "autofocus-system", value: "61-point AF (41 cross-type at f/4, 21 cross-type at f/8), High-density Reticular AF II" },
        { specSlug: "iso-range", value: "100-32000" },
        { specSlug: "iso-range-expanded", value: "50-102400" },
        { specSlug: "burst-rate-mechanical", value: 7 },
        { specSlug: "shutter-speed-range", value: "30-1/8000 s plus Bulb; X-sync at 1/200 s" },
        { specSlug: "video-resolutions", value: "DCI 4K (4096x2160) at 30fps with 1.64x crop; 1080p to 60fps; 720p to 120fps" },
        { specSlug: "evf", value: "Eye-level pentaprism, 100% coverage, 0.71x magnification" },
        { specSlug: "rear-display", value: "3.2in touchscreen, 1,620,000 dots" },
        { specSlug: "storage-slots", value: "CompactFlash Type I + SD/SDHC/SDXC" },
        { specSlug: "battery-model", value: "LP-E6N" },
        { specSlug: "battery-life-shots", value: 900 },
        { specSlug: "dimensions", value: "150.7 x 116.4 x 75.9 mm" },
        { specSlug: "weight", value: 800 },
        { specSlug: "connectivity", value: "Built-in Wi-Fi, NFC" },
        { specSlug: "announcement-date", value: "25 August 2016" },
        { specSlug: "launch-msrp-usd", value: "$3,499 (body only)" },
      ],
      relationships: [{ relatedProductSlug: "canon-eos-5d-mark-iii", type: "successor_of" }],
      sources: [
        { url: "https://en.wikipedia.org/wiki/Canon_EOS_5D_Mark_IV", publisher: "Wikipedia", reliabilityTier: "secondary" },
      ],
      metaTitle: "Canon EOS 5D Mark IV: 30MP Full-Frame DSLR with 4K",
      metaDescription:
        "Canon's 2016 update to the 5D Mark III adds 4K video, a 30.4MP sensor, and Dual Pixel RAW, keeping the same enthusiast/professional positioning.",
    },
  ],
};
