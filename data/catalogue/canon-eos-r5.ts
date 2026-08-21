// Canon EOS R5 — Canon's high-resolution full-frame mirrorless flagship,
// launched alongside the R6. Kept in its own file since it doesn't share
// the R/RP/R6 family grouping cleanly (positioned above all three as the
// resolution/video flagship rather than a like-for-like tier). Researched
// via WebFetch against Wikipedia's camera infobox.
//
// categorySlug uses a placeholder "cameras-photography" — VERIFY/ADJUST
// against the real taxonomy_categories table before running the ingestion
// script.

import type { CatalogueImport } from "@/lib/catalogue/import-types";

export const canonEosR5: CatalogueImport = {
  products: [
    {
      slug: "canon-eos-r5",
      isPublished: true,
      name: "Canon EOS R5",
      manufacturerSlug: "canon",
      categorySlug: "cameras-photography",
      familySlug: "canon-eos-r-full-frame",
      modelNumber: "EOS R5",
      releaseDate: "2020-07-09",
      status: "active",
      summary: "Canon's high-resolution full-frame mirrorless flagship, with 8K video recording, 5-axis in-body stabilisation, and a 45MP sensor — launched alongside the lower-resolution R6.",
      specs: [
        { specSlug: "sensor-format", value: "Full-frame (36 x 24 mm)" },
        { specSlug: "sensor-type", value: "Dual Pixel CMOS" },
        { specSlug: "effective-megapixels", value: 44.8 },
        { specSlug: "processor", value: "DIGIC X" },
        { specSlug: "lens-mount", value: "Canon RF" },
        { specSlug: "autofocus-system", value: "Dual Pixel CMOS AF II, 5,940 selectable points, 100% coverage" },
        { specSlug: "iso-range", value: "100-51200" },
        { specSlug: "iso-range-expanded", value: "50-102400" },
        { specSlug: "burst-rate-mechanical", value: 12 },
        { specSlug: "burst-rate-electronic", value: 20 },
        { specSlug: "shutter-speed-range", value: "30 s to 1/8000 s" },
        { specSlug: "video-resolutions", value: "8K RAW at 29.97fps; 4K at up to 119.9fps" },
        { specSlug: "video-recording-limit", value: "Approx. 20 minutes at 8K before thermal shutdown on the base R5" },
        { specSlug: "image-stabilisation", value: "5-axis in-body, up to 8 stops" },
        { specSlug: "evf", value: "5.76m-dot OLED EVF, 0.76x magnification, 120fps refresh" },
        { specSlug: "rear-display", value: "3.2in vari-angle touchscreen, 2.1m dots" },
        { specSlug: "storage-slots", value: "1x CFexpress + 1x SDXC (UHS-II)" },
        { specSlug: "battery-model", value: "LP-E6NH/LP-E6N/LP-E6" },
        // battery-life-shots omitted: CIPA rating differs between EVF (320)
        // and LCD (490) use, and the field can only hold one number.
        { specSlug: "dimensions", value: "138 x 97.5 x 88 mm" },
        { specSlug: "weight", value: 650 },
        { specSlug: "connectivity", value: "2.4GHz/5GHz Wi-Fi, Bluetooth" },
        { specSlug: "announcement-date", value: "9 July 2020" },
        { specSlug: "launch-msrp-usd", value: "$3,899 (body only)" },
      ],
      sources: [
        { url: "https://en.wikipedia.org/wiki/Canon_EOS_R5", publisher: "Wikipedia", reliabilityTier: "secondary" },
      ],
      metaTitle: "Canon EOS R5: 45MP Full-Frame with 8K Video",
      metaDescription:
        "Canon's high-resolution mirrorless flagship pairs a 44.8MP full-frame sensor with 8K RAW video and 5-axis in-body stabilisation — launched alongside the R6.",
    },
  ],
};
