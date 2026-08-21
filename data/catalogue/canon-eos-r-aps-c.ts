// Canon EOS R APS-C RF-mount mirrorless bodies: EOS R7, EOS R10, EOS R50.
// R7 and R10 were announced the same day (24 May 2022) as two tiers of the
// same generation, not a succession — marked `alternative_to` each other
// rather than a successor_of chain, since Canon positioned them as
// simultaneous higher/lower-tier options. R50 (2023) is a distinct,
// smaller/simpler body that is not a direct replacement for either — no
// relationship asserted for it. Researched via WebFetch against
// Wikipedia camera infoboxes.
//
// categorySlug uses a placeholder "cameras-photography" — VERIFY/ADJUST
// against the real taxonomy_categories table before running the ingestion
// script.

import type { CatalogueImport } from "@/lib/catalogue/import-types";

export const canonEosRApsc: CatalogueImport = {
  productFamilies: [
    {
      slug: "canon-eos-r-aps-c",
      name: "Canon EOS R (APS-C)",
      categorySlug: "cameras-photography",
      description: "Canon's APS-C RF-mount mirrorless bodies.",
    },
  ],
  products: [
    {
      slug: "canon-eos-r7",
      isPublished: true,
      name: "Canon EOS R7",
      manufacturerSlug: "canon",
      categorySlug: "cameras-photography",
      familySlug: "canon-eos-r-aps-c",
      modelNumber: "EOS R7",
      releaseDate: "2022-05-24",
      status: "active",
      summary: "Canon's higher-tier APS-C RF mirrorless body, pairing a 32.5MP sensor with in-body stabilisation and a very fast electronic-shutter burst rate, aimed at action/wildlife shooters wanting APS-C reach.",
      specs: [
        { specSlug: "sensor-format", value: "APS-C (22.3 x 14.9 mm)" },
        { specSlug: "sensor-type", value: "Dual-Pixel CMOS" },
        { specSlug: "effective-megapixels", value: 32.5 },
        { specSlug: "processor", value: "DIGIC X" },
        { specSlug: "lens-mount", value: "Canon RF" },
        { specSlug: "autofocus-system", value: "Dual Pixel CMOS AF II, 651 automatic zones, 5,915 total AF points, human/animal/vehicle tracking" },
        { specSlug: "iso-range", value: "100-32000" },
        { specSlug: "iso-range-expanded", value: "51200" },
        { specSlug: "burst-rate-mechanical", value: 15 },
        { specSlug: "burst-rate-electronic", value: 30 },
        { specSlug: "shutter-speed-range", value: "30 s - 1/8000 s (mechanical); 1/16000 s (electronic)" },
        { specSlug: "video-resolutions", value: "4K up to 59.94fps; 1080p up to 119.9fps" },
        { specSlug: "image-stabilisation", value: "5-axis in-body, up to 7 stops" },
        { specSlug: "evf", value: "2.36m-dot OLED EVF, 1.15x magnification" },
        { specSlug: "rear-display", value: "3.2in fully articulating, 1.62m dots" },
        { specSlug: "storage-slots", value: "2x SDXC (UHS-II)" },
        { specSlug: "battery-model", value: "LP-E6NH" },
        { specSlug: "dimensions", value: "132 x 90 x 92 mm" },
        { specSlug: "weight", value: 530 },
        { specSlug: "weather-sealing", value: true },
        { specSlug: "connectivity", value: "USB-C (10Gbps), Wi-Fi 4, Bluetooth 4.2" },
        { specSlug: "announcement-date", value: "24 May 2022" },
        { specSlug: "launch-msrp-usd", value: "$1,499 (body only)" },
      ],
      relationships: [{ relatedProductSlug: "canon-eos-r10", type: "alternative_to" }],
      sources: [
        { url: "https://en.wikipedia.org/wiki/Canon_EOS_R7", publisher: "Wikipedia", reliabilityTier: "secondary" },
      ],
      metaTitle: "Canon EOS R7: 32.5MP APS-C RF Camera with IBIS",
      metaDescription:
        "Canon's higher-tier APS-C RF body pairs a 32.5MP sensor with in-body stabilisation and up to 30fps electronic bursts — built for action and wildlife.",
    },
    {
      slug: "canon-eos-r10",
      isPublished: true,
      name: "Canon EOS R10",
      manufacturerSlug: "canon",
      categorySlug: "cameras-photography",
      familySlug: "canon-eos-r-aps-c",
      modelNumber: "EOS R10",
      releaseDate: "2022-05-24",
      status: "active",
      summary: "Canon's lower-tier APS-C RF mirrorless body, announced alongside the R7 as a lighter, cheaper alternative without in-body stabilisation.",
      specs: [
        { specSlug: "sensor-format", value: "APS-C (22.3 x 14.9 mm)" },
        { specSlug: "sensor-type", value: "CMOS" },
        { specSlug: "effective-megapixels", value: 24.2 },
        { specSlug: "processor", value: "DIGIC X" },
        { specSlug: "lens-mount", value: "Canon RF" },
        { specSlug: "autofocus-system", value: "Dual Pixel CMOS AF II, 651 focus zones" },
        { specSlug: "iso-range", value: "100-32000" },
        { specSlug: "iso-range-expanded", value: "51200" },
        { specSlug: "burst-rate-mechanical", value: 15 },
        { specSlug: "burst-rate-electronic", value: 23 },
        { specSlug: "shutter-speed-range", value: "30s to 1/4000s (mechanical); 30s to 1/16000s (electronic)" },
        { specSlug: "video-resolutions", value: "4K UHD up to 29.97fps (59.94fps with crop); 1080p up to 119.88fps" },
        { specSlug: "image-stabilisation", value: "None (lens-based IS only)" },
        { specSlug: "evf", value: "2.36m-dot OLED EVF, 0.95x magnification" },
        { specSlug: "rear-display", value: "3.0in fully articulating touchscreen" },
        { specSlug: "storage-slots", value: "1x SDXC (UHS-II)" },
        { specSlug: "battery-model", value: "LP-E17" },
        { specSlug: "battery-life-shots", value: 350 },
        { specSlug: "dimensions", value: "122.5 x 87.8 x 83.4 mm" },
        { specSlug: "weight", value: 426 },
        { specSlug: "connectivity", value: "USB-C (USB 2.0), Wi-Fi 4, Bluetooth 4.2" },
        { specSlug: "announcement-date", value: "24 May 2022" },
        { specSlug: "launch-msrp-usd", value: "$979.99 (body only)" },
      ],
      relationships: [{ relatedProductSlug: "canon-eos-r7", type: "alternative_to" }],
      sources: [
        { url: "https://en.wikipedia.org/wiki/Canon_EOS_R10", publisher: "Wikipedia", reliabilityTier: "secondary" },
      ],
      metaTitle: "Canon EOS R10: Canon's Lighter, Cheaper APS-C RF Body",
      metaDescription:
        "Announced alongside the R7 in 2022, the R10 is a lighter, cheaper APS-C RF mirrorless alternative without in-body stabilisation. 24.2MP sensor, 15fps burst.",
    },
    {
      slug: "canon-eos-r50",
      isPublished: true,
      name: "Canon EOS R50",
      manufacturerSlug: "canon",
      categorySlug: "cameras-photography",
      familySlug: "canon-eos-r-aps-c",
      modelNumber: "EOS R50",
      releaseDate: "2023-02-27",
      status: "active",
      summary: "Canon's smallest and lightest RF mirrorless body, aimed at beginners and content creators moving up from a smartphone.",
      specs: [
        { specSlug: "sensor-format", value: "APS-C (22.3 x 14.9 mm)" },
        { specSlug: "sensor-type", value: "CMOS" },
        { specSlug: "effective-megapixels", value: 24 },
        { specSlug: "processor", value: "DIGIC X" },
        { specSlug: "lens-mount", value: "Canon RF" },
        { specSlug: "autofocus-system", value: "Dual Pixel CMOS AF II, 651 zones / 4,503 positions" },
        { specSlug: "iso-range", value: "100-32000" },
        { specSlug: "iso-range-expanded", value: "51200" },
        { specSlug: "burst-rate-mechanical", value: 12 },
        { specSlug: "burst-rate-electronic", value: 15 },
        { specSlug: "shutter-speed-range", value: "30s-1/4000s (electronic first curtain); 30s-1/8000s (fully electronic)" },
        { specSlug: "video-resolutions", value: "4K UHD up to 29.97fps; 1080p up to 119.88fps" },
        { specSlug: "image-stabilisation", value: "None (lens-based IS only)" },
        { specSlug: "evf", value: "1086x724 OLED EVF, 0.95x magnification" },
        { specSlug: "rear-display", value: "3.0in fully articulating touchscreen" },
        { specSlug: "storage-slots", value: "1x SDXC (UHS-I)" },
        { specSlug: "battery-model", value: "LP-E17" },
        { specSlug: "dimensions", value: "116 x 86 x 69 mm" },
        { specSlug: "weight", value: 328 },
        { specSlug: "connectivity", value: "USB-C (USB 2.0), Wi-Fi 4, Bluetooth 4.2" },
        { specSlug: "announcement-date", value: "27 February 2023" },
        { specSlug: "launch-msrp-usd", value: "$679.99 (body only)" },
      ],
      sources: [
        { url: "https://en.wikipedia.org/wiki/Canon_EOS_R50", publisher: "Wikipedia", reliabilityTier: "secondary" },
      ],
      metaTitle: "Canon EOS R50: Canon's Smallest, Lightest RF Camera",
      metaDescription:
        "Canon's smallest and lightest RF mirrorless body, aimed at beginners and content creators moving up from a smartphone. 24MP sensor, vari-angle screen.",
    },
  ],
};
