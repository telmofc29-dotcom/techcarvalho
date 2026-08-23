# Camera body research — sourcing notes

Retrieved 2026-08-23. Output: `products.json` (42 bodies), `technologies.json` (18),
`families.json` (25), `relationships.json` (95).

Every figure in `products.json` comes from a manufacturer-owned page or a manufacturer-published
PDF, recorded per body in `source_urls`. Nothing was filled from a retailer, a review site, an
encyclopedia, or memory. Where the maker does not state a field it is `null` and named in
`unsourced_fields`.

## Counts

| Manufacturer | Bodies | Mounts |
|---|---|---|
| Canon | 17 | RF 13, EF-S 3, EF 1 |
| Sony | 11 | E 11 |
| Nikon | 9 | Z 8, F 1 |
| Fujifilm | 5 | X 4, none 1 (X100VI is a fixed-lens body — `mount: null`) |

Sensor format: full-frame 25, APS-C 17. No micro-four-thirds and no L-mount body is present —
see "Manufacturers not covered" below.

**22 of 42 have a complete core spec set** (sensor type, effective megapixels, ISO min/max, AF
system, viewfinder type, screen type and size, card types, battery, weight, and all three body
dimensions). **20 are partial**, and the gaps cluster tightly:

- 10 Canon RF bodies are missing only `battery` — Canon's manual specification appendix names the
  battery pack in the *Power* chapter of the manual body, not in the specification table, and only
  the older PDFs (R, RP, 6D II, 90D, 250D, 2000D) repeated it there.
- 6 Sony bodies are missing only `card_types` — Sony's newer specification tables (α1 II, α9 III,
  α7 V, α7C II, α6700, ZV-E10 II) use a recording-media label that did not surface in the table
  extraction, while the older ones (α1, α7 IV, α7R V, α7S III, α6400) state it plainly.
- **EOS R1 is the thinnest record in the set.** Only weight, dimensions, mount, ISO and the IBIS
  line were extracted before the pass ended; sensor type, effective pixels, viewfinder, screen and
  card types are all null. This is the flagship, so it is the first record worth completing.
- **EOS R** (2018) is nearly as thin: the 2019 PDF for it is a two-column layout that `pdftotext`
  interleaves badly, so ISO, effective pixels, viewfinder and screen could not be read reliably and
  were left null rather than guessed from a scrambled line.

## Sources that worked

| Source | Used for |
|---|---|
| `global.canon/en/c-museum/camera.html?s=dslr` | The complete Canon camera index — 782 model→URL pairs, plus each model's "Marketed" month. This is the only `announced` data in the whole dataset. |
| `global.canon/en/c-museum/product/dslr***.html` → linked `*_en.pdf` | **Canon camera museum pages carry no HTML spec table** (unlike the lens pages used in `research/canon/`). They link a PDF of the camera manual's specification appendix. 17 of the 22 target Canon bodies had one; it was downloaded and read with `pdftotext -layout`. |
| `onlinemanual.nikonimglib.com/{model}/en/` | Nikon Reference Guide, whose "Specifications" page carries the full HTML table. Working slugs: `z9`, `z8`, `z6III`, `z5II`, `z50II`, `zf`, `zfc`, `z30`, `d850`, `d780`, `d7500`. |
| `imaging.nikon.com/imaging/lineup/mirrorless/` and `/dslr/` | Nikon's current-lineup index. Used only to establish that a model is in Nikon's current lineup — this is why Nikon bodies are the only ones with `status: "current"` / `maturity: "commercially_available"`. |
| `www.sony.jp/ichigan/products/{MODEL}/spec.html` | Sony's Japanese specification tables, same source the lens pass used. **These pages are Shift-JIS, not UTF-8** — decoding as UTF-8 silently yields an empty document rather than an error. |
| `http://www.fujifilm-x.com/global/products/cameras/{model}/specifications/` | Fujifilm X-series specs. Only reachable over **plain `http://`** via WebFetch (see below). |

## Sources that blocked or failed (each was actually attempted)

| Host / URL | Result |
|---|---|
| `https://fujifilm-x.com/...` and `https://www.fujifilm-x.com/...` | HTTP 403 to `curl`; the `https` URL 301-redirects to the `http` one, which WebFetch then fetches successfully. `curl` gets 403 on the `http` URL too — **only WebFetch works for Fujifilm.** |
| `www.panasonic.com/global/consumer/lumix/...` | HTTP 403. No Lumix body is in this dataset. |
| `www.omsystem.com/...`, `www.om-digitalsolutions.com/...`, `explore.omsystem.com/...` | 404 / redirect-only on every path tried. No OM System body is in this dataset. |
| `www.nikon.co.jp/products/...` | HTTP 404 on the `z-mount` and `mirrorless` lineup paths. |
| `imaging.nikon.com/imaging/lineup/mirrorless/{model}/` | Reachable (200) but the page is a **stub** — it contains navigation and images only, no specification content at all. This is why Nikon specs come from the online manual instead. |
| `downloadcenter.nikonimglib.com/en/products/510/Z_9.html` | HTTP 404. |
| `www.nikonusa.com/p/z9/1669/overview` | HTTP 404. |
| `onlinemanual.nikonimglib.com/{z6_2,z7_2,z6ii,z7ii,z62,z72,z6ii_z7ii,...}/en/` | HTTP 404 on every slug tried. **Z6II and Z7II are therefore absent** from this dataset despite being in scope. |
| `onlinemanual.nikonimglib.com/d5600/en/` | HTTP 404. **D5600 is absent.** |
| Canon regional sites (`canon.co.uk`, `usa.canon.com`, `canon-europe.com`) | Not re-attempted this pass — the lens pass (`research/canon/NOTES.md`) recorded them as HTTP 403 to every request. These are where Canon publishes DIGIC branding, weather-sealing statements and continuous-shooting rates. |

### Canon models in scope with no reachable specification at all

`EOS 5D Mark III` (dslr808), `EOS 5D Mark IV` (dslr849), `EOS 6D` (dslr813), `EOS 7D Mark II`
(dslr819) and `EOS 80D` (dslr844) **have museum pages but no linked specification PDF.** Their
museum page carries only a "Marketed" month and an "Original Price" row. Rather than create five
records that would be a name and a date with every spec null, they were left out entirely. Their
museum URLs and marketed months are known and are the obvious starting point if a second source
becomes reachable.

### Nikon D850 and D7500

Both manual index pages resolve and both link a Specifications page (`19_technical_notes_11.html`
and `25_technical_notes_09.html`), but those pages returned no parseable specification rows in this
pass. They are **not** in `products.json`. D780 is the only F-mount body present.

## Field-level honesty decisions

| Field | Status |
|---|---|
| `announced` | **Canon only (17 of 42).** The value is the museum's **"Marketed"** month as `YYYY-MM` — a marketing/release month, not an announcement date. Nikon's manual, Sony's spec table and Fujifilm's spec table state no date at all, so all 25 non-Canon bodies have `announced: null`. |
| `status` / `maturity` | `"current"` / `"commercially_available"` for the **9 Nikon bodies only**, because they appear on Nikon's own current-lineup index — that is a manufacturer statement about the lineup. Canon's museum carries no current/discontinued marker, and appearing on a Sony or Fujifilm product page is not itself proof of current sale, so all 33 other bodies are `"unknown"` / `"unknown"`. `discontinued` is null for all 42. |
| `weather_sealed` | **Null for all 42.** No reachable page stated dust- or drip-resistance for any body. This includes bodies that are universally understood to be sealed. Absence of `true` here means "no reachable manufacturer page said so", not "not sealed". |
| `processor` | **Set on 5 of 42 — the Fujifilm bodies only** ("X-Processor 5", stated in Fujifilm's table). Canon's manual appendix, Nikon's manual and Sony's spec table name no processor. DIGIC X and BIONZ XR are *not* recorded anywhere; see the `canon-digic-x` entry in `technologies.json`, which states the gap explicitly. |
| `ibis_stops_claim` | **Null for all 42, by design.** Every stop figure is a marketing performance statement footnoted to a specific lens and CIPA revision, so the exact wording goes in `manufacturer_claims` instead. See the list below. |
| `af_points` | **Null for every Canon mirrorless body.** Canon does not publish an "AF points" count — it publishes AF *zones* available for automatic selection and, separately, selectable AF *positions*, and footnotes the latter "Values for the selectable positions for AF points do not represent AF performance". Populated only for the four Canon DSLRs (45/45/9/9), the Nikon bodies (Nikon's own "Focus points" row) and the Sony bodies (Sony's 測距点数 phase-detection count). The `canon-af-zones-not-points` technology entry explains why these three numbers are not comparable across brands. |
| `image_stabilisation` | Set to `"IBIS"` where the maker's own body specification carries a stabilisation entry: Canon's `"Image stabilization (IS mode): Provided"` line (present on R5, R5 II, R6, R6 II, R3, R7, R1; absent on R8, R10, R50, R100, RP, R), Nikon's `"Vibration reduction (VR)"` body section (present on Z9, Z8, Z6III, Z5II, Zf; absent on Z50II, Zfc, Z30, D780), Sony's 補正効果 row, and Fujifilm's sensor-shift statement. **The Nikon and Canon readings are inferences from the presence of a section heading**, not from a sentence saying "in-body". They are recorded here because the presence/absence pattern matches exactly across nine Nikon and thirteen Canon bodies, but that is the reasoning, and it is worth replacing with an explicit statement when one is reachable. |
| `video_max_resolution` / `video_max_fps` | **Null for all 11 Sony bodies.** Sony's table lists movie modes as separate sub-tables per codec (`XAVC HS 8K`, `XAVC S 4K`, …) whose *headings* are present even when the mode is not available on that body — the α7 IV page carries an "XAVC HS 8K" heading. Reading a resolution off the heading would have produced a false 8K claim, so nothing was recorded. Canon and Nikon figures come from their movie tables; where the maximum frame rate at the maximum resolution was ambiguous, `video_max_fps` is null (20 bodies). |
| `card_slots` | Null for all Nikon, Sony and Fujifilm bodies — none of those tables state a slot count, only a media list. Canon states it plainly ("Equipped with dual card slots", "Equipped with a single slot") for 11 bodies. |
| `iso_expanded_min` / `iso_expanded_max` | Recorded only from an explicit expanded-ISO row. Nikon states its expansions as EV offsets ("approx. 0.3, 0.7, 1, or 2 EV above ISO 25600"), so only the offsets that Nikon itself resolves to a number (ISO 32 below base) were converted; the upper expansions are null. |
| Weight | Always the maker's **with battery and memory card** (CIPA) figure, for cross-brand comparability. Body-only figures were also captured for most bodies and are not stored. |

## Every burst / IBIS figure moved into `manufacturer_claims`

22 claims across 21 bodies. None of these appears in any spec field.

**Burst / frame-advance rates (Nikon, 8 claims)** — Nikon is the only maker whose reachable page
publishes them, and it footnotes them "maximum frame advance rate as measured by in-house tests":

- Z9 and Z8 (identical wording): "Continuous low-speed: Approx. 1 – 10 fps; Continuous high-speed:
  Approx. 10 – 20 fps; High-speed frame capture + (C15): Approx. 15 fps; High-speed frame capture +
  (C30): Approx. 30 fps"
- Z6III: "Continuous low-speed: Approx. 1 – 7 fps; Continuous high speed: Approx. 8.1 fps (when
  using the electronic shutter and image quality settings other than NEF (RAW) and NEF (RAW) +:
  approx. 14 fps)"
- Z5II: "Continuous high-speed: Approx. 7.8 fps (when the shutter type is set to [Auto] or
  [Mechanical shutter]); Approx. 9.4 fps (when the shutter type is set to the electronic shutter)"
- Z50II: "Continuous high-speed: Approx. 5.6 fps (when using silent mode and image quality settings
  other than NEF (RAW) and NEF (RAW) +: Approx. 9.7 fps)"
- Zf: "Continuous high-speed: Approx. 7.8 fps; Continuous high-speed (extended): Approx. 14 fps;
  High-speed frame capture + (C30): Approx. 30 fps"
- Zfc and Z30 (identical wording): "Continuous L: Approx. 1 – 4 fps; Continuous H: Approx. 5 fps;
  Continuous H (extended): Approx. 11 fps"

**IBIS stop figures (Sony, 9 claims)** — recorded in Sony's original Japanese with an English gloss,
because the CIPA revision and reference lens are part of the claim:

- α1: 5.5 stops (CIPA, pitch/yaw, with Planar T* FE 50mm F1.4 ZA)
- α1 II: 8.5 stops centre / 7.0 stops periphery (CIPA2024, pitch/yaw/roll, with FE 50mm F1.2 GM)
- α9 III: 8.0 stops (CIPA, with FE 50mm F1.2 GM)
- α7 IV: 5.5 stops (CIPA, with Planar T* FE 50mm F1.4 ZA)
- α7 V: 7.5 stops centre / 6.5 stops periphery (CIPA2024, with FE 50mm F1.2 GM)
- α7R V: 8.0 stops (CIPA, with FE 50mm F1.2 GM)
- α7C II: 7.0 stops (CIPA, with FE 50mm F1.2 GM)
- α7S III: 5.5 stops (CIPA, with Planar T* FE 50mm F1.4 ZA)
- α6700: 5.0 stops (CIPA, with FE 50mm F1.2 GM)

Note the α1 II and α7 V figures are quoted against **CIPA2024**, a different standard revision from
the other seven — they are not directly comparable, which is exactly why they are claims.

**IBIS mechanism + stops (Fujifilm, 5 claims)**: X-T5, X-H2, X-H2S, X-S20 all "7.0 stops"; X100VI
"6.0 stops", each with the "image sensor shift mechanism with 5-axis compensation" wording.

**Canon: no burst or IBIS-stop claim recorded at all.** Canon's manual specification appendix
carries neither a continuous-shooting row nor a stop rating; the only stabilisation statement is
the bare line "Image stabilization (IS mode): Provided".

## Relationships deliberately NOT asserted

- **No cross-brand `successor_of` and no cross-mount `successor_of`.** All four `successor_of` edges
  are inside one maker's own named line and the basis quotes the maker's own naming: R5 → R5 Mark II,
  R6 → R6 Mark II, α1 → α1 II (ILCE-1 → ILCE-1M2), α7 IV → α7 V (ILCE-7M4 → ILCE-7M5).
- **No `successor_of` between EOS R3 and EOS R1.** They share a body class and are grouped
  `same_family`, but Canon's naming does not present R1 as the next R3; asserting it would be an
  editorial reading of the model numbers.
- **No `successor_of` from a DSLR to a mirrorless body.** 90D → R7, 6D Mark II → R8, 250D → R50 and
  D780 → Z6III are `modern_equivalent`, whose basis in each case is a matching sensor format and a
  matching stated effective-pixel count — not a claim that the maker replaced one with the other.
- **No `successor_of` Zfc → Zf.** Different formats (DX vs FX); they are `same_family` on design
  line only, and the basis says so.
- **No Z6II → Z6III edge**, because Z6II is not in this dataset (its manual slug 404s). The same
  applies to Z7II → Z7II-successor and to anything involving D850, D7500 or D5600.
- **No `competes_with` without a stated numeric basis.** Every one of the 11 cross-brand edges
  names the sensor format plus the two makers' own stated sensor dimensions or effective-pixel
  counts. Cross-brand pairings that are commonly made but that no reachable page supports with a
  comparable number — for example any Fujifilm-vs-full-frame pairing — were not created.
- **No `compatible_with` from a body to an individual lens.** The 44 `compatible_with` edges point
  from a body to a *mount concept* (`canon-rf-mount`, `canon-ef-mount`, `nikon-z-mount`,
  `nikon-f-mount`, `sony-e-mount`, `fujifilm-x-mount`), which is what makes the 194-lens catalogue
  navigable from a body page without asserting per-lens compatibility nobody published.
- **13 `requires_adapter` edges**, all Canon RF-body → `canon-ef-mount`, each quoting Canon's own
  "using Mount Adapter EF-EOS R" sentence. **No Nikon FTZ edge was created** — the FTZ II adapter
  page 404'd in the lens pass and was not reachable here either, so the F→Z adapter path is
  asserted nowhere.

## Manufacturers not covered

OM System and Panasonic were in scope "if budget allows". Neither has a reachable specification
source from this environment (see the blocked table), so **no micro-four-thirds and no L-mount body
exists in this dataset**, and `technologies.json` contains no MFT or L-mount entry. Fujifilm is the
one new manufacturer this pass adds.

## Reproducing this

The Canon path is the non-obvious one: fetch `camera.html?s=dslr` once to get the whole 782-model
index (name → `/en/c-museum/product/{id}.html`), then for each model fetch the product page, pull
the `*_en.pdf` link out of it, download that, and run `pdftotext -layout`. `pdftotext` prints
`Syntax Error: Unknown filter 'Crypt'` on these PDFs and still extracts correctly — the warning is
not a failure. Single-column PDFs (R5 onward) extract cleanly; the pre-2020 two-column ones do not,
and every null on the EOS R, RP, 90D and 6D Mark II traces to that.
