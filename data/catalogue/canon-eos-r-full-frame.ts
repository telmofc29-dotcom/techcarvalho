// Canon EOS R full-frame RF-mount mirrorless bodies: EOS R, EOS RP, EOS R6.
// No successor_of relationships are asserted between these three — EOS RP
// (2019) was an entry-level body released alongside/after the original
// EOS R (2018), not a replacement for it, and EOS R6 (2020) launched
// alongside the R5 as a new enthusiast tier rather than a direct successor
// to either R or RP. Asserting a generation chain here would not be
// defensible, per the batch's explicit instruction not to imply every
// newer product succeeds an older one — so none of these three carry a
// `relationships` entry. Researched via WebFetch against Wikipedia camera
// infoboxes.
//
// categorySlug uses a placeholder "cameras-photography" — VERIFY/ADJUST
// against the real taxonomy_categories table before running the ingestion
// script.

import type { CatalogueImport } from "@/lib/catalogue/import-types";

export const canonEosRFullFrame: CatalogueImport = {
  productFamilies: [
    {
      slug: "canon-eos-r-full-frame",
      name: "Canon EOS R (full-frame)",
      categorySlug: "cameras-photography",
      description: "Canon's full-frame RF-mount mirrorless system.",
    },
  ],
  products: [
    {
      slug: "canon-eos-r",
      isPublished: true,
      name: "Canon EOS R",
      manufacturerSlug: "canon",
      categorySlug: "cameras-photography",
      familySlug: "canon-eos-r-full-frame",
      modelNumber: "EOS R",
      releaseDate: "2018-09-05",
      status: "discontinued",
      summary: "Canon's first full-frame mirrorless camera, introducing the RF lens mount. No in-body stabilisation.",
      specs: [
        { specSlug: "sensor-format", value: "Full-frame (36 x 24 mm)" },
        { specSlug: "sensor-type", value: "CMOS" },
        { specSlug: "effective-megapixels", value: 30.3 },
        { specSlug: "processor", value: "DIGIC 8" },
        { specSlug: "lens-mount", value: "Canon RF" },
        { specSlug: "autofocus-system", value: "Dual Pixel CMOS AF with Eye Detection AF" },
        { specSlug: "iso-range", value: "100-40000" },
        { specSlug: "iso-range-expanded", value: "50-102400" },
        { specSlug: "burst-rate-mechanical", value: 8 },
        { specSlug: "shutter-speed-range", value: "30 s to 1/8000 s" },
        { specSlug: "video-resolutions", value: "4K at 30fps (cropped sensor)" },
        { specSlug: "image-stabilisation", value: "None (lens-based IS only)" },
        { specSlug: "evf", value: "3.69m-dot OLED EVF, 0.76x magnification, 100% coverage" },
        { specSlug: "rear-display", value: "3.2in vari-angle touchscreen, 2.1m dots" },
        { specSlug: "storage-slots", value: "1x SDXC (UHS-II)" },
        { specSlug: "battery-model", value: "LP-E6N (also compatible with LP-E6, LP-E6NH)" },
        { specSlug: "dimensions", value: "135.8 x 98.3 x 84.4 mm" },
        { specSlug: "weight", value: 580 },
        { specSlug: "connectivity", value: "Wi-Fi, Bluetooth" },
        { specSlug: "announcement-date", value: "5 September 2018" },
        { specSlug: "launch-msrp-usd", value: "$2,299 (body only)" },
      ],
      sources: [
        { url: "https://en.wikipedia.org/wiki/Canon_EOS_R", publisher: "Wikipedia", reliabilityTier: "secondary" },
      ],
      metaTitle: "Canon EOS R: Canon's First Full-Frame Mirrorless Camera",
      metaDescription:
        "Launched in 2018, the EOS R introduced Canon's RF lens mount on a 30.3MP full-frame sensor. No in-body stabilisation — relies on lens-based IS only.",
    },
    {
      slug: "canon-eos-rp",
      isPublished: true,
      name: "Canon EOS RP",
      manufacturerSlug: "canon",
      categorySlug: "cameras-photography",
      familySlug: "canon-eos-r-full-frame",
      modelNumber: "EOS RP",
      releaseDate: "2019-02-13",
      status: "discontinued",
      summary: "Canon's entry-level full-frame RF mirrorless body — smaller and lighter than the EOS R, at a lower price point.",
      specs: [
        { specSlug: "sensor-format", value: "Full-frame (36 x 24 mm)" },
        { specSlug: "sensor-type", value: "CMOS" },
        { specSlug: "effective-megapixels", value: 26.2 },
        { specSlug: "processor", value: "DIGIC 8" },
        { specSlug: "lens-mount", value: "Canon RF" },
        { specSlug: "autofocus-system", value: "Dual Pixel CMOS AF, 4,779 manually selectable points" },
        { specSlug: "iso-range", value: "100-40000" },
        { specSlug: "iso-range-expanded", value: "L: 50, H1: 51200, H2: 102400" },
        { specSlug: "burst-rate-mechanical", value: 5 },
        { specSlug: "shutter-speed-range", value: "30 s to 1/4000 s" },
        { specSlug: "video-resolutions", value: "4K UHD at 23.98fps with 1.7x crop; Full HD/HD at various rates" },
        { specSlug: "image-stabilisation", value: "None (lens-based IS only)" },
        { specSlug: "evf", value: "2.36m-dot OLED EVF, 0.70x magnification" },
        { specSlug: "rear-display", value: "3.0in vari-angle touchscreen" },
        { specSlug: "storage-slots", value: "1x SDXC (UHS-II)" },
        { specSlug: "battery-model", value: "LP-E17" },
        { specSlug: "dimensions", value: "132.5 x 85.0 x 70.0 mm" },
        { specSlug: "weight", value: 440 },
        { specSlug: "connectivity", value: "Wi-Fi, Bluetooth" },
        { specSlug: "announcement-date", value: "13 February 2019" },
        { specSlug: "launch-msrp-usd", value: "$1,299 (body only)" },
      ],
      sources: [
        { url: "https://en.wikipedia.org/wiki/Canon_EOS_RP", publisher: "Wikipedia", reliabilityTier: "secondary" },
      ],
      metaTitle: "Canon EOS RP: Canon's Smallest Full-Frame RF Camera",
      metaDescription:
        "Canon's entry-level full-frame RF mirrorless body is smaller and lighter than the EOS R at a lower price. 26.2MP sensor, no in-body stabilisation.",
    },
    {
      slug: "canon-eos-r6",
      isPublished: true,
      name: "Canon EOS R6",
      manufacturerSlug: "canon",
      categorySlug: "cameras-photography",
      familySlug: "canon-eos-r-full-frame",
      modelNumber: "EOS R6",
      releaseDate: "2020-07-09",
      status: "discontinued",
      summary: "Enthusiast full-frame mirrorless body launched alongside the higher-resolution R5, sharing its 5-axis in-body stabilisation and fast burst shooting on a lower-resolution 20.1MP sensor.",
      specs: [
        { specSlug: "sensor-format", value: "Full-frame (36 x 24 mm)" },
        { specSlug: "sensor-type", value: "CMOS" },
        { specSlug: "effective-megapixels", value: 20.1 },
        { specSlug: "processor", value: "DIGIC X" },
        { specSlug: "lens-mount", value: "Canon RF" },
        { specSlug: "autofocus-system", value: "Dual Pixel CMOS AF II, 1,053 AF points, 100% coverage" },
        { specSlug: "iso-range", value: "100-102400" },
        { specSlug: "iso-range-expanded", value: "50-204800" },
        { specSlug: "burst-rate-mechanical", value: 12 },
        { specSlug: "burst-rate-electronic", value: 20 },
        { specSlug: "shutter-speed-range", value: "30 s to 1/8000 s" },
        { specSlug: "video-resolutions", value: "4K at 59.94fps; 1080p up to 120fps" },
        { specSlug: "image-stabilisation", value: "5-axis in-body, up to 8 stops" },
        { specSlug: "evf", value: "3.69m-dot OLED EVF, 0.76x magnification, 100% coverage" },
        { specSlug: "rear-display", value: "3.2in, 1.62m dots" },
        { specSlug: "storage-slots", value: "2x SDXC (UHS-II)" },
        { specSlug: "battery-model", value: "LP-E6NH/LP-E6N/LP-E6" },
        // battery-life-shots omitted: CIPA rating differs between EVF (360)
        // and LCD (510) use, and the field can only hold one number — see
        // the same note on the R5/R7/R10/R50 entries.
        { specSlug: "dimensions", value: "138.4 x 97.5 x 88.4 mm" },
        { specSlug: "weight", value: 598 },
        { specSlug: "connectivity", value: "USB-C (USB 3.1 Gen 2), Wi-Fi, Bluetooth 4.2" },
        { specSlug: "announcement-date", value: "9 July 2020" },
        { specSlug: "launch-msrp-usd", value: "$2,499 (body only)" },
      ],
      sources: [
        { url: "https://en.wikipedia.org/wiki/Canon_EOS_R6", publisher: "Wikipedia", reliabilityTier: "secondary" },
      ],
      metaTitle: "Canon EOS R6: Full-Frame Stabilisation and Speed",
      metaDescription:
        "Launched alongside the R5 in 2020, the R6 pairs a 20.1MP full-frame sensor with 5-axis in-body stabilisation and up to 20fps electronic-shutter bursts.",
    },
  ],
};
