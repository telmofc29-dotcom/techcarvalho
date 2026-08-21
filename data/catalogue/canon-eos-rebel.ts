// Canon's entry-level Rebel / xxxD line. Canon markets these bodies under
// three different names depending on region — confirmed via WebFetch
// against each camera's Wikipedia infobox:
//   - EOS 800D (EU/UK) = EOS Rebel T7i (Americas) = EOS Kiss X9i (Japan)
//   - EOS 2000D (EU/UK) = EOS Rebel T7 (Americas) = EOS Kiss X90 (Japan)
//     = EOS 1500D (Southeast Asia)
// This file standardises on the Americas "Rebel T#" naming for `name`/slug
// (most commonly used in English-language tech coverage, the site's likely
// audience), and records every regional name in each product's `summary`
// so the alternate names aren't lost. This is a deliberate, documented
// choice, not an assumption that one name is more "correct."
//
// Two bodies researched (the low end of this batch's 2-4 target): the
// mid-range 800D/T7i and the more clearly entry-level 2000D/T7, chosen for
// genuine differentiation rather than two near-identical models.
//
// launch-msrp-usd is omitted for the Rebel T7/2000D: the only launch price
// found (US$549.99) was a kit price bundled with an 18-55mm lens, not a
// body-only figure — the spec slug's definition is body-only, so a kit
// price would misrepresent it rather than inform it. Mentioned as a kit
// price in the summary/source instead of being forced into that field.
//
// categorySlug uses a placeholder "cameras-photography" — VERIFY/ADJUST
// against the real taxonomy_categories table before running the ingestion
// script.

import type { CatalogueImport } from "@/lib/catalogue/import-types";

export const canonEosRebel: CatalogueImport = {
  productFamilies: [
    {
      slug: "canon-eos-rebel",
      name: "Canon EOS Rebel",
      categorySlug: "cameras-photography",
      description: "Canon's entry-level DSLR line, sold as EOS Rebel (Americas) / EOS xxxD (EU/UK) / EOS Kiss (Japan) depending on region.",
    },
  ],
  products: [
    {
      slug: "canon-eos-rebel-t7i",
      isPublished: true,
      name: "Canon EOS Rebel T7i",
      manufacturerSlug: "canon",
      categorySlug: "cameras-photography",
      familySlug: "canon-eos-rebel",
      modelNumber: "Rebel T7i / EOS 800D / EOS Kiss X9i",
      releaseDate: "2017-02-14",
      status: "discontinued",
      summary: "Mid-range entry-level DSLR sold as the Rebel T7i in the Americas, EOS 800D in the EU/UK, and EOS Kiss X9i in Japan. Brought a 45-point all cross-type AF system and a vari-angle touchscreen to Canon's entry-level line.",
      specs: [
        { specSlug: "sensor-format", value: "APS-C (22.3 x 14.9 mm)" },
        { specSlug: "sensor-type", value: "CMOS" },
        { specSlug: "effective-megapixels", value: 24.2 },
        { specSlug: "processor", value: "DIGIC 7" },
        { specSlug: "lens-mount", value: "Canon EF-S" },
        { specSlug: "autofocus-system", value: "45 cross-type AF points" },
        { specSlug: "iso-range", value: "100-25600" },
        { specSlug: "iso-range-expanded", value: "H: 51200" },
        { specSlug: "burst-rate-mechanical", value: 6 },
        { specSlug: "shutter-speed-range", value: "1/4000 s to 30 s and Bulb; X-sync at 1/200 s" },
        { specSlug: "video-resolutions", value: "1080p at up to 60fps with Movie Electronic IS" },
        { specSlug: "evf", value: "Eye-level pentamirror, 95% coverage, 0.82x magnification" },
        { specSlug: "rear-display", value: "3.0in vari-angle touchscreen, 1,040,000 dots" },
        { specSlug: "storage-slots", value: "SD/SDHC/SDXC (UHS-I)" },
        { specSlug: "battery-model", value: "LP-E17 (1040 mAh)" },
        { specSlug: "battery-life-shots", value: 600 },
        { specSlug: "dimensions", value: "131 x 99.9 x 76.2 mm" },
        { specSlug: "weight", value: 485 },
        { specSlug: "weather-sealing", value: false },
        { specSlug: "connectivity", value: "Built-in Wi-Fi, NFC, Bluetooth" },
        { specSlug: "announcement-date", value: "14 February 2017" },
        { specSlug: "launch-msrp-usd", value: "$750 (body only)" },
      ],
      sources: [
        { url: "https://en.wikipedia.org/wiki/Canon_EOS_800D", publisher: "Wikipedia", reliabilityTier: "secondary" },
      ],
    },
    {
      slug: "canon-eos-rebel-t7",
      isPublished: true,
      name: "Canon EOS Rebel T7",
      manufacturerSlug: "canon",
      categorySlug: "cameras-photography",
      familySlug: "canon-eos-rebel",
      modelNumber: "Rebel T7 / EOS 2000D / EOS Kiss X90 / EOS 1500D",
      releaseDate: "2018-02-25",
      status: "discontinued",
      summary: "Canon's baseline entry-level DSLR, sold as the Rebel T7 in the Americas, EOS 2000D in the EU/UK, EOS Kiss X90 in Japan, and EOS 1500D in Southeast Asia. A simpler, fixed-screen, non-touch body positioned below the T7i. Launch price found (US$549.99) was for the kit with an EF-S 18-55mm f/3.5-5.6 IS II lens — no body-only price was found, so launch-msrp-usd is omitted rather than presenting a kit price as one.",
      specs: [
        { specSlug: "sensor-format", value: "APS-C (22.3 x 14.9 mm)" },
        { specSlug: "sensor-type", value: "CMOS" },
        { specSlug: "effective-megapixels", value: 24.1 },
        { specSlug: "processor", value: "DIGIC 4+" },
        { specSlug: "lens-mount", value: "Canon EF/EF-S" },
        { specSlug: "autofocus-system", value: "9-point AF, 1 cross-type centre point" },
        { specSlug: "iso-range", value: "100-6400" },
        { specSlug: "iso-range-expanded", value: "H: 12800" },
        { specSlug: "burst-rate-mechanical", value: 3 },
        { specSlug: "shutter-speed-range", value: "1/4000 s to 30 s and Bulb; X-sync at 1/200 s" },
        { specSlug: "video-resolutions", value: "1080p at 24/25/30fps; 720p at 50/60fps" },
        { specSlug: "evf", value: "Eye-level pentamirror, 95% coverage, 0.80x magnification" },
        { specSlug: "rear-display", value: "3.0in, 920,000 dots (fixed, non-touch)" },
        { specSlug: "storage-slots", value: "SD/SDHC/SDXC (single slot)" },
        { specSlug: "battery-model", value: "LP-E10 (860 mAh)" },
        { specSlug: "dimensions", value: "129 x 101.3 x 77.6 mm" },
        { specSlug: "weight", value: 475 },
        { specSlug: "weather-sealing", value: false },
        { specSlug: "announcement-date", value: "25 February 2018" },
      ],
      sources: [
        { url: "https://en.wikipedia.org/wiki/Canon_EOS_2000D", publisher: "Wikipedia", reliabilityTier: "secondary" },
      ],
    },
  ],
};
