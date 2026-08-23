# 3D printing research notes

Retrieved 2026-08-23. All figures come from manufacturer product, spec or support pages only. No
retailer listing, review, video or recollection was used to fill a field: where the manufacturer
does not state something, the field is `null` and the field name is listed in `unsourced_fields`.

## Dataset shape

- 26 printers: Bambu Lab 7, Creality 9, Elegoo 5, Anycubic 5. 21 FDM, 5 resin.
- 17 technology entries, 14 families, 21 relationships.

## Are AMS / AMS lite / AMS 2 an accessory or their own entity?

**Accessory, modelled as a printer attribute, not as its own product record — for now.**

Reasoning:

1. They are not printers. Every field in the `printers.json` shape that carries meaning (build
   volume, nozzle, bed, kinematics, levelling) is inapplicable to a filament changer, so an AMS
   record would be a row of nulls plus a name.
2. Bambu sells them as separate SKUs with their own prices (AMS 2 Pro $299, AMS $249, AMS HT $139
   on <https://bambulab.com/en/compare/ams>), which argues for eventual product records — but the
   information that a *reader* needs is compatibility-shaped: which printer, which filaments, how
   many colours. That is already captured on the printer via `multi_material`,
   `multi_material_system` and `max_colours`.
3. The compatibility data that would justify separate entities is real and non-obvious — the AMS
   supports a *narrower* filament list than the printers it attaches to (no TPE, no generic TPU, no
   damp PVA/BVOH, no third-party carbon- or glass-filled filament), and the AMS HT exists mainly to
   provide a bypass outlet for exactly those. If this vertical ever grows an accessories catalogue,
   AMS / AMS lite / AMS 2 Pro / AMS HT and Creality's CFS should become product records with
   `compatible_with` and `requires` relationships to printers, and the filament exclusion list
   becomes the interesting content. Until then, promoting them would create four almost-empty
   records for no reader benefit.

Note that **AMS lite could not be sourced at all in this pass**. Bambu's A1 and A1 mini tech-spec
pages (the authoritative spec source for those machines) do not mention AMS lite anywhere — they
list `Connectivity: Wi-Fi, Bambu-Bus` and `Filament Cutter: Yes` and stop. So both A1 records carry
`multi_material: null` and `multi_material_system: null`, which is honest rather than convenient.

## Where the manufacturers do not publish specs

This was the dominant failure mode, and it is worth recording because it is a fact about the
vendors, not about the research.

- **Bambu Lab X1-Carbon, X1E, P1P.** Bambu publishes `/tech-specs` pages for the A1, A1 mini, H2D,
  H2S and H2D Pro, but the sitemap has no equivalent for the X1 or P1 series — their specs are
  inline marketing tables on `/en/x1` and `/en/p1`, which omit build volume entirely. The P1 numbers
  in this dataset come from the store page's `Parameters Comparison` table
  (<https://uk.store.bambulab.com/products/p1s>), which covers P1P and P1S in two columns. No such
  table survives for the X1-Carbon or X1E, so **their build volumes are null.** The widely known
  256 mm figure is deliberately not filled in — it would be a guess dressed as a spec.
- **Creality pre-V3 Ender-3 models.** The support pages for Ender-3, Ender-3 V2, Ender-3 S1 and
  Ender-3 S1 Pro load without a parameter table at all. The Ender-3 record here is therefore almost
  entirely null; Ender-3 V2, S1 and S1 Pro were dropped rather than add three more all-null rows.
- **Creality HALOT resin line.** No HALOT page (ONE, MAGE, MAGE PRO, MAGE S) served a parameter
  table. The single HALOT-MAGE record is a placeholder so the resin side of Creality is at least
  represented as a known gap.
- **Creality K1 Max.** Build volume, connectivity and slicer list came through; the core
  specification block (nozzle/bed temperature, materials) sits behind a "Show More" control that is
  rendered client-side and did not return.
- **Elegoo.** Spec tables are Shopify metafields rendered client-side. The usable source was
  `products/<handle>.json`, whose `body_html` carries Elegoo's own feature copy — good for build
  volume, nozzle temperature, levelling point count and LCD resolution, silent on bed temperature,
  filament diameter and connectivity. The **Centauri Carbon** record is nearly empty for this
  reason; the only manufacturer statement retrievable was the page title describing it as a
  "High-Speed CoreXY 3D Printer". No Saturn model could be sourced, so the Saturn family appears in
  `families.json` with no printers attached.
- **Anycubic.** `anycubic.com` 403s to normal fetching and redirects to `store.anycubic.com`
  (Shopify). The Kobra 2 generation and the Photon Mono line publish full "Tech Specs" blocks in
  `body_html`; the newer Kobra 3, Kobra S1, Photon Mono 4 and Photon M5s records contain only a
  title, so those models were left out entirely rather than added as null rows.

**Fields most often unsourceable, counted across all 26 records:** `announced` 26/26,
`discontinued` 26/26 (neither is stated by any of the four makers on any page retrieved),
`chamber_temp_max_c` 24, `max_colours` 23, `layer_min_mm` 22, `firmware` 21, `camera` 20,
`multi_material_system` 20, `input_shaping` 19, `filament_diameter_mm` 18, `kinematics` 18.

`kinematics` deserves its own note: **no manufacturer in this dataset states a kinematic
architecture as a spec-table field except Creality**, which publishes a `Motion System` row
("i3 Gantry" for the Ender-3 V3 SE and KE, "CoreXZ Gantry" for the Ender-3 V3). Everywhere else the
value is either present in marketing prose (Bambu says "CoreXY" on the X1, X1E and P1 pages; Elegoo
calls the Centauri Carbon a "CoreXY 3D Printer" in its page title) or absent entirely. It is
recorded only where the manufacturer used the word — so the Bambu A1 and A1 mini, the whole Creality
K1/K2 line, the Elegoo Neptune 4s and every Anycubic Kobra carry `kinematics: null`, even where the
architecture is not in doubt.

`status` is "unknown" on 9 records because no maker states a lifecycle status anywhere; nothing was
inferred to be discontinued. The invariant enforced across the file is that **any field named in
`unsourced_fields` is null** (or "unknown" for `status`) — there are no fields carrying an
unsourced value while also being declared unsourced.

## Speed and acceleration claims — all moved to `manufacturer_claims`

Not one speed or acceleration figure appears in a plain spec field anywhere in `printers.json`.
Every one below is a manufacturer maximum under unstated or narrowly stated conditions:

| Printer | Claim as written | Source |
|---|---|---|
| Bambu X1-Carbon | "CoreXY 20 m/s² Acceleration" / "500 mm/s Velocity" / "32 mm³/s Flow" / "16 mins 30 s Benchy" | bambulab.com/en/x1 |
| Bambu X1E | "toolhead acceleration of 20,000 mm/s²" / "maximum travel speed of 500 mm/s" | bambulab.com/en/x1e |
| Bambu P1S, P1P | "Max Speed of Tool Head 500 mm/s" / "Max Acceleration of Tool Head 20 m/s²" / "CoreXY up to 20000 mm/s² Acceleration" / "acceleration from zero to 500 mm/s takes just 0.025 seconds" | store.bambulab.com/products/p1s, bambulab.com/en/p1 |
| Bambu A1, A1 mini | "Max Speed of Toolhead: 500 mm/s" / "Max Acceleration of Toolhead: 10000 mm/s²" / "Max Hot End Flow: 28 mm³/s @ABS (Model: 150*150 mm single wall; Material: Bambu ABS; Temperature: 280 ℃)" | bambulab.com/en/a1/tech-specs |
| Bambu H2D | "Max Speed of Toolhead 1000 mm/s" / "Max Acceleration of Toolhead 20,000 mm/s²" / "40 mm³/s" and "65 mm³/s" flow, each with the test model, material and temperature stated | bambulab.com/en/h2d/tech-specs |
| Creality Ender-3 V3 SE | "Printing Speed 250mm/s" / "Acceleration ≤2500mm/s²" | creality.com/support/creality-ender-3-v3-se |
| Creality Ender-3 V3 KE | "Printing Speed 500mm/s" / "Acceleration ≤8000mm/s²" / "500mm/s Max Printing Speed" | creality.com/support/creality-ender-3-v3-ke |
| Creality Ender-3 V3 | "Printing Speed 600mm/s" / "Acceleration 20000mm/s²" | creality.com/support/creality-ender-3-v3 |
| Elegoo Neptune 4 | "Up to 500mm/s High-Speed" / "up to 500mm/s (recommended 250mm/s)" | elegoo.com/products/elegoo-neptune-4-fdm-3d-printer |
| Elegoo Neptune 4 Pro | "Up to 500mm/s Printing Speed" / "amazing speed of up to 500mm/s (recommended 250mm/s)" | elegoo.com/products/elegoo-neptune-4-pro-fdm-3d-printer |
| Elegoo Mars 4 Ultra | "less release tension for a high printing success rate even at a faster printing speed" | elegoo.com/products/elegoo-mars-4-ultra-... |
| Anycubic Kobra 2 | "Printing Speed 300mm/s(Max.) 200mm/s(Typ)" | store.anycubic.com/products/kobra-2 |
| Anycubic Kobra 2 Neo | "250mm/s(Max.) 150mm/s(Typ.)" / "5X High-Speed ... Compared to products an average printing speed of 50mm/s, data from Anycubic Lab, results are for reference only" | store.anycubic.com/products/kobra-2-neo |
| Anycubic Kobra 2 Pro | "500mm/s(Max.) 300mm/s(Typ.)" / "10X Boost in Speed ... Compared with products with a standard printing speed of 50mm/s. The data comes from Anycubic Lab, and the results are for reference only." | store.anycubic.com/products/kobra-2-pro |
| Anycubic Photon Mono | "Printing Speed: MAX 50mm/h" / "exposure time is reduced to 1.5 seconds" / "print up to 2000 hours" | store.anycubic.com/products/photon-mono-resin-3d-printer |
| Anycubic Photon Mono 2 | "Printing Speed ≤50mm/hr" | store.anycubic.com/products/photon-mono-2-3d-printer |

Two of these deserve a flag for any editorial use:

- Anycubic's "10X" and "5X" multipliers are baselined against "products with a standard printing
  speed of 50mm/s" and footnoted "data from Anycubic Lab, results are for reference only" — the
  comparison is against an arbitrary reference printer, not a measurement.
- Elegoo is the only manufacturer here that publishes a **recommended** speed next to the maximum
  ("up to 500mm/s (recommended 250mm/s)"). That gap — half the headline number — is the single most
  useful piece of context in this entire table, and it is worth surfacing wherever a speed figure is
  shown.

Also treated as a claim rather than a spec: **Bambu's "Chamber Temperature 60℃" on the X1 page.**
It appears in a materials-capability panel, but Bambu's own X1E comparison table records "Active
Chamber Heating: No" for the X1-Carbon. So the X1-Carbon record has `heated_chamber: false`,
`chamber_temp_max_c: null`, and the 60 ℃ figure sits in `manufacturer_claims` with that
contradiction spelled out.

## Data-quality problems found in manufacturer sources

- **Creality Ender-3 V3 SE parameter table is internally broken**: the row `Filament Diameter` shows
  the value `metal`, with the real values shifted one row out of alignment. `filament_diameter_mm`
  is therefore null for that printer even though Creality nominally publishes it.
- **Anycubic labels resin build volumes `(HWD)`**, e.g. the Photon Mono 2 as "165x89x143mm(HWD)".
  Taken literally that gives width 89 mm and depth 143 mm, which is what is recorded
  (`build_volume_x_mm: 89`, `y: 143`, `z: 165`). Note this conflicts with the usual convention of
  quoting the long LCD axis first, and Anycubic's own Photon Mono entry uses `L/W/H` instead. The
  axis assignment for resin printers in this dataset should be treated as low-confidence.
- **Creality's "K2" page ambiguity**: the page at `/support/k2-series-3d-printer` is titled "K2" but
  its SEO title reads "K2 Combo | K2 Series". Its build volume is 260 x 260 x 260 mm, which is the
  base K2, not the K2 Plus that the brief asked for. The record is named "K2" accordingly; **K2 Plus
  specs could not be sourced** and it is not in the dataset.

## Relationships deliberately NOT asserted

- **No cross-brand `successor_of` anywhere.** Only two `successor_of` links exist at all
  (Ender-3 V3 SE → Ender-3, Photon Mono 2 → Photon Mono), both inside a single named family from a
  single manufacturer.
- **Bambu H2D → X1-Carbon.** Tempting as a "flagship succession", but Bambu names them as different
  families (H2 vs X1) and sells both; there is no manufacturer statement of succession. Not
  asserted in any form, not even `modern_equivalent`.
- **Creality K2 → K1 was recorded as `modern_equivalent`, not `successor_of`**, with the basis field
  saying explicitly that Creality does not describe the K2 as replacing the K1. This is the weakest
  link in the file and is flagged as positional.
- **P1S → P1P as succession.** Not asserted. Bambu compares them but sells both concurrently, so
  they are `same_family` + `alternative_to`.
- **Anycubic Kobra 2 Neo → Kobra Neo.** Anycubic's own comparison table supports this generation
  link, but the Kobra Neo is not in the dataset, so the relationship was omitted rather than
  pointing at a non-existent slug.
- **Elegoo Neptune 4 → Neptune 3.** No Neptune 3 record was sourceable in this pass, so no link.
- **Any `requires` or `compatible_with` link involving AMS / AMS lite / CFS.** Those systems are not
  entities in this dataset (see above), so there is nothing to point at. When they become records,
  `bambu-lab-p1s requires AMS for multi-colour` and the AMS filament-exclusion list become the
  obvious first relationships.
- **Any competes_with based on price.** Price is not in this dataset and was not retrieved for most
  models, so every `competes_with` basis is stated in terms of technology, architecture and build
  volume only.
- **Anycubic Kobra 3 / Kobra S1 / Photon Mono 4 and Elegoo Saturn / Neptune 3.** Named in
  `families.json` for taxonomic completeness but excluded from `printers.json` because no
  manufacturer specification could be retrieved. They are gaps, not omissions.

## Method

`WebSearch` was unavailable (session budget exhausted), so discovery ran off manufacturer sitemaps:
`bambulab.com/sitemap/en/sitemap.xml`, `elegoo.com/sitemap_products_1.xml`,
`store.anycubic.com/collections/all/products.json`, plus a Creality product-URL list captured in an
earlier session. Pages were fetched directly and stripped to text; Shopify stores (Elegoo, Anycubic)
were read through their public `products.json` endpoints because their spec tables render
client-side.
