// Canon EOS xxD enthusiast APS-C DSLR generation chain: 60D -> 70D -> 80D -> 90D.
// Researched via WebFetch against Canon's own press release (90D) and
// Wikipedia camera infoboxes (which are themselves sourced from Canon
// press materials/manuals) — every numeric/dated field below was read from
// one of those fetches, not recalled from memory. Anything not confirmed
// was left out rather than guessed.
//
// categorySlug uses a placeholder "cameras-photography" — this fork had no
// admin access to confirm the exact live taxonomy_categories.slug value.
// VERIFY/ADJUST this against the real taxonomy_categories table before
// running the ingestion script.

import type { CatalogueImport } from "@/lib/catalogue/import-types";

const CANON: CatalogueImport["manufacturers"] = [
  {
    slug: "canon",
    name: "Canon",
    website: "https://global.canon/",
    description: "Japanese manufacturer of cameras, lenses, and imaging equipment.",
  },
];

export const canonEosXxd: CatalogueImport = {
  manufacturers: CANON,
  productFamilies: [
    {
      slug: "canon-eos-xxd",
      name: "Canon EOS xxD",
      categorySlug: "cameras-photography",
      description: "Canon's enthusiast/prosumer APS-C DSLR line — the double-digit EOS bodies (60D, 70D, 80D, 90D).",
    },
  ],
  products: [
    {
      slug: "canon-eos-60d",
      name: "Canon EOS 60D",
      manufacturerSlug: "canon",
      categorySlug: "cameras-photography",
      familySlug: "canon-eos-xxd",
      modelNumber: "EOS 60D",
      releaseDate: "2010-08-26", // Wikipedia gives this as the announcement date; a separate retail availability date wasn't confirmed.
      status: "discontinued",
      summary: "Enthusiast APS-C DSLR, the first in the xxD line with a fully articulating screen.",
      specs: [
        { specSlug: "sensor-format", value: "APS-C (22.3 x 14.9 mm)" },
        { specSlug: "sensor-type", value: "CMOS" },
        { specSlug: "effective-megapixels", value: 18.1 },
        { specSlug: "processor", value: "DIGIC 4" },
        { specSlug: "lens-mount", value: "Canon EF-S" },
        { specSlug: "autofocus-system", value: "9 cross-type AF points" },
        { specSlug: "iso-range", value: "100-6400" },
        { specSlug: "iso-range-expanded", value: "H: 12800" },
        { specSlug: "burst-rate-mechanical", value: 5.3 },
        { specSlug: "shutter-speed-range", value: "1/8000 sec. - 30 sec. and Bulb; X-sync at 1/250 sec." },
        { specSlug: "video-resolutions", value: "1080p at 24/25/30p; 720p at 50/60p; 480p at 50/60p" },
        { specSlug: "evf", value: "Eye-level pentaprism, 96% coverage, 0.95x magnification" },
        { specSlug: "rear-display", value: "Fully articulating 3.0in Clear View II colour LCD, 1,040,000 dots" },
        { specSlug: "storage-slots", value: "SD/SDHC/SDXC" },
        { specSlug: "battery-model", value: "LP-E6 (1800 mAh)" },
        { specSlug: "dimensions", value: "144.5 x 105.8 x 78.6 mm" },
        { specSlug: "weight", value: 755 },
        { specSlug: "connectivity", value: "3.5mm stereo mic jack; external shutter release port" },
        { specSlug: "announcement-date", value: "26 August 2010" },
        { specSlug: "launch-msrp-usd", value: "$1,099 (body only)" },
      ],
      sources: [
        { url: "https://en.wikipedia.org/wiki/Canon_EOS_60D", publisher: "Wikipedia", reliabilityTier: "secondary" },
      ],
      metaTitle: "Canon EOS 60D: 18MP APS-C DSLR with Vari-Angle Screen",
      metaDescription:
        "Canon's 2010 enthusiast APS-C DSLR, the first xxD-series body with a fully articulating screen. 18.1MP sensor, DIGIC 4 processor, 5.3fps burst shooting.",
    },
    {
      slug: "canon-eos-70d",
      name: "Canon EOS 70D",
      manufacturerSlug: "canon",
      categorySlug: "cameras-photography",
      familySlug: "canon-eos-xxd",
      modelNumber: "EOS 70D",
      releaseDate: "2013-08-01", // Wikipedia: announced 2 July 2013, released August 2013 — day-of-month for release wasn't given, so the 1st is a placeholder for "August 2013"; VERIFY before treating as exact.
      status: "discontinued",
      summary: "Introduced Dual Pixel CMOS AF, Canon's on-sensor phase-detection system, to the xxD line.",
      specs: [
        { specSlug: "sensor-format", value: "APS-C (22.5 x 15.0 mm)" },
        { specSlug: "sensor-type", value: "CMOS" },
        { specSlug: "effective-megapixels", value: 20.2 },
        { specSlug: "processor", value: "DIGIC 5+" },
        { specSlug: "lens-mount", value: "Canon EF-S" },
        { specSlug: "autofocus-system", value: "19 cross-type AF points, Dual Pixel CMOS AF" },
        { specSlug: "iso-range", value: "100-12800" },
        { specSlug: "iso-range-expanded", value: "25600" },
        { specSlug: "burst-rate-mechanical", value: 7 },
        { specSlug: "shutter-speed-range", value: "1/8000 sec. to 30 sec.; X-sync at 1/250 sec." },
        { specSlug: "video-resolutions", value: "Full HD (1080p)" },
        { specSlug: "evf", value: "Eye-level pentaprism, 98% coverage, 0.95x magnification" },
        { specSlug: "rear-display", value: "3.0in Clear View II colour TFT vari-angle touchscreen, 1,040,000 dots" },
        { specSlug: "storage-slots", value: "SD/SDHC/SDXC (UHS-I)" },
        { specSlug: "battery-model", value: "LP-E6 (1800 mAh)" },
        { specSlug: "dimensions", value: "139.0 x 104.3 x 78.5 mm" },
        { specSlug: "weight", value: 755 },
        { specSlug: "connectivity", value: "Built-in Wi-Fi; 3.5mm stereo microphone jack" },
        { specSlug: "announcement-date", value: "2 July 2013" },
        { specSlug: "launch-msrp-usd", value: "$1,199 (body only)" },
      ],
      relationships: [{ relatedProductSlug: "canon-eos-60d", type: "successor_of" }],
      sources: [
        { url: "https://en.wikipedia.org/wiki/Canon_EOS_70D", publisher: "Wikipedia", reliabilityTier: "secondary" },
        { url: "https://cameradecision.com/specs/Canon-EOS-70D", publisher: "CameraDecision", reliabilityTier: "secondary" },
      ],
      metaTitle: "Canon EOS 70D: The DSLR That Introduced Dual Pixel AF",
      metaDescription:
        "Announced in 2013, the 70D brought Canon's Dual Pixel CMOS AF to the xxD line for smoother live-view and video autofocus. 20.2MP sensor, 7fps burst.",
    },
    {
      slug: "canon-eos-80d",
      name: "Canon EOS 80D",
      manufacturerSlug: "canon",
      categorySlug: "cameras-photography",
      familySlug: "canon-eos-xxd",
      modelNumber: "EOS 80D",
      releaseDate: "2016-02-18",
      status: "discontinued",
      summary: "Refined the 70D's Dual Pixel AF with a new 45-point all cross-type phase-detect array and a higher-resolution sensor.",
      specs: [
        { specSlug: "sensor-format", value: "APS-C (22.3 x 14.9 mm)" },
        { specSlug: "sensor-type", value: "CMOS" },
        { specSlug: "effective-megapixels", value: 24.2 },
        { specSlug: "processor", value: "DIGIC 6" },
        { specSlug: "lens-mount", value: "Canon EF-S" },
        { specSlug: "autofocus-system", value: "45 cross-type AF points" },
        { specSlug: "iso-range", value: "100-16000" },
        { specSlug: "iso-range-expanded", value: "H: 25600" },
        { specSlug: "burst-rate-mechanical", value: 7 },
        { specSlug: "shutter-speed-range", value: "1/8000 sec. - 30 sec., Bulb; X-sync at 1/250 sec." },
        { specSlug: "video-resolutions", value: "1080p at 60/50 fps" },
        { specSlug: "evf", value: "Optical pentaprism, 100% coverage, 0.95x magnification" },
        { specSlug: "rear-display", value: "3.0in Clear View II colour TFT vari-angle touchscreen" },
        { specSlug: "storage-slots", value: "SD/SDHC/SDXC (UHS-I)" },
        { specSlug: "battery-model", value: "LP-E6N" },
        { specSlug: "battery-life-shots", value: 960 },
        { specSlug: "dimensions", value: "139 x 105.2 x 78.5 mm" },
        { specSlug: "weight", value: 650 },
        { specSlug: "connectivity", value: "Built-in NFC, Wi-Fi" },
        { specSlug: "announcement-date", value: "18 February 2016" },
      ],
      relationships: [{ relatedProductSlug: "canon-eos-70d", type: "successor_of" }],
      sources: [
        { url: "https://en.wikipedia.org/wiki/Canon_EOS_80D", publisher: "Wikipedia", reliabilityTier: "secondary" },
      ],
      metaTitle: "Canon EOS 80D: 24MP APS-C DSLR with 45-Point AF",
      metaDescription:
        "Canon's 2016 enthusiast DSLR refined Dual Pixel AF with a 45-point all cross-type system and a 24.2MP sensor, plus a vari-angle touchscreen and 7fps burst.",
    },
    {
      slug: "canon-eos-90d",
      name: "Canon EOS 90D",
      manufacturerSlug: "canon",
      categorySlug: "cameras-photography",
      familySlug: "canon-eos-xxd",
      modelNumber: "EOS 90D",
      releaseDate: "2019-08-28",
      status: "discontinued",
      summary: "The most recent xxD-series DSLR, with a 32.5MP sensor, 4K video without a crop, and a weather-sealed body — announced alongside the mirrorless EOS M6 Mark II, which shares its sensor.",
      specs: [
        { specSlug: "sensor-format", value: "APS-C (22.3 x 14.9 mm)" },
        { specSlug: "sensor-type", value: "CMOS" },
        { specSlug: "effective-megapixels", value: 32.5 },
        { specSlug: "processor", value: "DIGIC 8" },
        { specSlug: "lens-mount", value: "Canon EF-S" },
        { specSlug: "autofocus-system", value: "45 cross-type AF points (OVF); 5,481 phase-detect points (Live View, Dual Pixel CMOS AF)" },
        { specSlug: "iso-range", value: "100-25600" },
        { specSlug: "iso-range-expanded", value: "H: 51200" },
        { specSlug: "burst-rate-mechanical", value: 10 },
        { specSlug: "burst-rate-electronic", value: 7 },
        { specSlug: "shutter-speed-range", value: "30 sec. - 1/8000 sec. (mechanical); 1/16000 sec. (electronic)" },
        { specSlug: "video-resolutions", value: "4K UHD 30p and 1080p FHD up to 120p, no crop" },
        { specSlug: "image-stabilisation", value: "None (lens-based IS only)" },
        { specSlug: "evf", value: "Optical pentaprism, 100% coverage, 0.95x magnification" },
        { specSlug: "rear-display", value: "3.0in Clear View II colour TFT vari-angle touchscreen" },
        { specSlug: "storage-slots", value: "SD/SDHC/SDXC (UHS-II)" },
        { specSlug: "battery-model", value: "LP-E6N (1800 mAh)" },
        { specSlug: "battery-life-shots", value: 1300 },
        { specSlug: "dimensions", value: "140.8 x 104.8 x 76.8 mm" },
        { specSlug: "weight", value: 701 },
        { specSlug: "weather-sealing", value: true },
        { specSlug: "connectivity", value: "Bluetooth, Wi-Fi" },
        { specSlug: "announcement-date", value: "28 August 2019" },
        { specSlug: "launch-msrp-usd", value: "$1,199 (body only)" },
      ],
      relationships: [{ relatedProductSlug: "canon-eos-80d", type: "successor_of" }],
      sources: [
        { url: "https://www.usa.canon.com/newsroom/2019/20190828-camera", publisher: "Canon U.S.A.", reliabilityTier: "primary" },
        { url: "https://en.wikipedia.org/wiki/Canon_EOS_90D", publisher: "Wikipedia", reliabilityTier: "secondary" },
      ],
      metaTitle: "Canon EOS 90D: 32.5MP APS-C DSLR with Uncropped 4K",
      metaDescription:
        "The last xxD-series DSLR, launched in 2019 with a 32.5MP sensor, uncropped 4K video, full weather sealing, and a 10fps mechanical burst rate.",
    },
  ],
};
