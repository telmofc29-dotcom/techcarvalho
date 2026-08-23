# Canon lens research — sourcing notes

Retrieved 2026-08-23. Output: `lenses.json` (78), `technologies.json` (19), `families.json` (12),
`relationships.json` (49).

## Where the data came from

**Canon Camera Museum (`global.canon/en/c-museum`) is the sole specification source.** Every lens
record cites its own museum product page in `source_urls`, and every numeric spec field is read
directly out of that page's `<table class="spec">`. Supporting Canon pages used for
`technologies.json`:

- `https://global.canon/en/c-museum/history/lens-mount.html` — Canon's mount-evolution feature
  (EF "1987-", EF-M "2012-", RF "2018-", with Canon's own one-line descriptions).
- `https://global.canon/en/c-museum/lens-series.html` — Lens Hall series index with date ranges.
- `https://global.canon/en/news/2018/20180905.html` — EOS R System launch release (RF mount
  rationale, back-focus definition, EF/EF-S adapter statement, adapter list).

**Nothing else was used.** No retailer, no review site, no encyclopedia, no recall from memory.

### Canon sources that could not be reached

`canon.co.uk`, `usa.canon.com`, `canon-europe.com`, `snapshot.canon-asia.com` and
`cpn.canon-europe.com` returned **HTTP 403 to every request** from this environment, via both
`curl` and WebFetch. Those regional product pages are where Canon publishes weather-sealing
statements, control-ring presence, tripod-collar and focus-limiter switches, IS stop ratings as a
formal spec, and the flange-focal-distance figures. Their inaccessibility is the single biggest
cause of nulls in this dataset.

WebSearch was unavailable (session budget exhausted before this task began), so URL discovery was
done by probing known Canon URL shapes rather than searching.

## Field-level honesty decisions

| Field | Status |
|---|---|
| `announced` | Museum's **"Marketed"** month, as `YYYY-MM`. This is a marketing/release month, not an announcement date — Canon does not publish an announcement date on these pages. Treat as "first marketed". |
| `status` | **`"unknown"` for all 78.** The museum carries no current/discontinued marker and Canon's current-lineup pages are 403. Nothing here distinguishes a lens still in production from one long gone, so nothing is asserted. |
| `discontinued` | Null for all 78, same reason. |
| `focus_limiter`, `internal_zoom`, `internal_focus` | Null for all 78. Canon states none of these on museum pages. |
| `stabilisation_stops_claim` | **Deliberately null for all 78.** Canon's stop figures are always footnoted to a specific body and focal length ("When used with the EOS R at a focal length of 70 mm. Based on CIPA standards."). They are marketing performance statements, so the exact sentence goes in `manufacturer_claims` and never into a spec field. 49 such claims are recorded across 34 lenses. |
| `weather_sealed` | True on **8** lenses only — the ones where Canon's own prose says so (RF10-20mm F4 L IS STM, EF24-70mm f/2.8L II USM, EF70-200mm f/2.8L IS II USM, EF100mm f/2.8L Macro IS USM, all four extenders). Null on the other 70, **including L lenses that are widely known to be sealed**. Absence of a `true` here means "Canon did not say so on the page I read", not "not sealed". |
| `control_ring` | True on **8** RF lenses whose museum pages name the ring. Null on the other RF/RF-S lenses even though the control ring is an RF-system feature — per-lens confirmation was not available. |
| `tripod_collar` | True on 2 (EF100-400mm f/4.5-5.6L IS II USM, MP-E65mm). Null elsewhere. |
| `extender_compatible` | True on 2 (RF70-200mm F2.8 L IS USM Z, RF200-800mm F6.3-9 IS USM) where the lens page names the extender. Canon's actual per-lens extender compatibility table was not reachable. |
| `focus_motor` | Set on 47 of 78. STM and VCM come from Canon's own product naming. Nano USM (11 lenses) and Ring USM (1 lens) come from explicit Canon prose. **22 lenses named "…USM" are left null** because Canon does not say which USM they use on the museum page — see list below. |
| `l_series`, `macro`, `do_optics`, focal lengths, max aperture | Derived from Canon's own product name as Canon writes it. Not inference from third parties. |
| `categories` | Includes a `canon-museum:*` entry carrying Canon's own Lens Hall category (e.g. `canon-museum:standard-zoom-lens`) for 77 of 78 lenses, plus derived shape tags. |

### The 22 USM lenses with no Canon-sourced motor type

RF14-35mm F4 L IS USM; RF24-105mm F2.8 L IS USM Z; RF100-500mm F4.5-7.1 L IS USM; RF28-70mm F2 L
USM; RF50mm F1.2 L USM; RF85mm F1.2 L USM; RF85mm F1.2 L USM DS; RF100mm F2.8 L MACRO IS USM;
RF135mm F1.8 L IS USM; EF70-200mm f/2.8L IS II USM; EF70-200mm f/2.8L IS III USM; EF100-400mm
f/4.5-5.6L IS II USM; EF16-35mm f/2.8L III USM; EF24-105mm f/4L IS II USM; EF100mm f/2.8L Macro IS
USM; EF85mm f/1.8 USM; EF-S17-55mm f/2.8 IS USM; EF24-70mm f/2.8L USM; EF16-35mm f/2.8L II USM;
EF24-105mm f/4L IS USM; EF70-300mm f/4-5.6 IS USM; EF100-400mm f/4.5-5.6L IS USM.

### Core-spec gaps (11 of 78 records)

67 of 78 lenses have a complete core spec set (elements, groups, blades, min focus, magnification,
filter, weight, diameter, length, min aperture, marketed date). The gaps:

- **Extenders (all 4)** legitimately have no blades / min focus / min aperture / filter thread.
- **RF600mm F11 IS STM, RF800mm F11 IS STM** — Canon publishes no diaphragm-blade count (fixed
  aperture designs).
- **RF10-20mm F4 L IS STM, TS-E17mm f/4L** — no front filter thread stated (bulbous front elements).
- **EF40mm f/2.8 STM, EF100-400mm f/4.5-5.6L IS USM, EF-S18-135mm f/3.5-5.6 IS STM** — the museum
  spec table omits maximum diameter × length for these three.

## Flange focal distance — deliberately not answered

The brief asked for the EF and RF flange distances "with a source". **No figure is recorded.**
Canon's reachable pages describe the RF mount only qualitatively ("a large mount diameter and short
back focus") and define back focus in a footnote, but publish no millimetre value; the Canon
regional sites that do publish it are 403 from here. Per the project's hard rule against fabricated
specifications, the numbers were left out rather than filled from memory. See the
`flange-focal-distance` entry in `technologies.json`, which records the failure explicitly rather
than silently omitting the topic.

`micro-usm` in `technologies.json` is likewise recorded with an empty `source_urls` and a summary
that says so — Micro USM was in scope but no Canon page describing it was reachable.

## Relationships: what was asserted and why

49 edges. `successor_of` means "from is the successor of to"; no reverse edges are written.

| Type | n | Basis |
|---|---|---|
| `successor_of` | 7 | 4 where Canon **names** the predecessor ("renewed version of the …", "developed as successor to …"); 3 where Canon says "its predecessor"/"the earlier model" without naming it and the target was identified from Canon's own generation naming (the "II"/"III" of an otherwise identical product name). Each of those 3 spells the reasoning out in its `basis`. |
| `alternative_to` | 2 | The two RF "Z" lenses vs their non-Z counterparts. Canon compares them directly ("on par with", "equal to or greater than") but uses **no** succession language and lists both, so these are explicitly *not* `successor_of`. |
| `modern_equivalent` | 1 | RF100-500L → EF100-400L II, because Canon's own RF page uses the EF lens as its reference point. |
| `supports_extender` | 2 | Only where the lens page itself names the extender and the gain. |
| `same_family` | 8 | 6 pairs across the RF L VCM primes (shared Canon naming + shared focus-design prose) and 1 pair each for the RF and EF extenders (same museum category, same marketed month). Symmetric, so each unordered pair appears once. |
| `requires_adapter` | 29 | Every EF and EF-S lens → `rf-mount`, on Canon's launch-release statement that "through the use of a dedicated adapter, the rich lineup of existing EF and EF-S lenses can be used". |

### Considered and rejected

- **EF50mm f/1.8 STM `successor_of` EF50mm f/1.8 II.** Canon's page says the STM keeps "the proven
  optical design of its predecessor" and that its 7-bladed aperture is "an improvement over the
  previous model's 5-bladed aperture" — but it never names the lens, and unlike the II/III cases
  the two product names do not encode a generation relationship. Rejected as inference.
- **RF70-200mm F2.8 L IS USM Z `successor_of` RF70-200mm F2.8 L IS USM** and
  **RF24-105mm F2.8 L IS USM Z `successor_of` RF24-70mm F2.8 L IS USM.** Canon markets the Z lenses
  alongside the originals and uses only quality-comparison language. Downgraded to `alternative_to`.
- **RF ↔ EF "modern equivalent" pairs generally** (RF24-70 ↔ EF24-70 II, RF70-200 ↔ EF70-200 III,
  RF16-35 ↔ EF16-35 III, RF50 f/1.2 ↔ EF50 f/1.2, RF85 f/1.2 ↔ EF85 f/1.2, RF100 Macro ↔ EF100
  Macro, RF50 f/1.8 ↔ EF50 f/1.8 STM, RF-S18-45 ↔ EF-S18-55, RF-S55-210 ↔ EF-S55-250, …). These are
  obvious to a reader and tempting to bulk-generate, but they would be inferred purely from matching
  focal length and aperture, which the brief forbids. Only the one pair Canon itself draws
  (RF100-500L → EF100-400L II) was asserted.
- **EF-M `requires_adapter` → `rf-mount`.** Canon's launch release names EF and EF-S only. EF-M is
  not stated to be adaptable and no edge was written. (This is also why no EF-M lens carries a
  `requires_adapter` edge while every EF/EF-S lens does.)
- **`competes_with` (any).** Would require third-party lenses, which are out of scope and would need
  a non-Canon source.
- **EF-S / EF-M `compatible_with` their APS-C bodies.** Canon's per-lens body-compatibility lists
  were not reachable; the one museum statement available ("specifically designed for the EOS DIGITAL
  REBEL / EOS 300D") is about a single 2004 lens and does not generalise.
- **EF-M as "a discontinued mount".** The brief asked for EF-M to be marked discontinued. Canon has
  published no discontinuation statement on any page reachable here, so no EF-M lens is marked
  `status: "discontinued"`. What *is* recorded, and is sourced, is that the newest EF-M lens in the
  Canon Camera Museum is the EF-M32mm f/1.4 STM, marketed September 2018 — the factual observation
  that supports the inference without making it.

## Coverage

| Mount | Count | L-series | Non-L |
|---|---|---|---|
| RF | 38 | 20 | 18 |
| RF-S | 4 | — | 4 |
| EF | 23 | 14 | 9 |
| EF-S | 6 | — | 6 |
| EF-M | 7 | — | 7 |
| **Total** | **78** | **34** | **44** |

Marketed dates span 1990-12 (EF50mm f/1.8 II) to 2025-04 (RF20mm F1.4 L VCM). Six EF/EF-S lenses
beyond the original brief (EF24-70mm f/2.8L USM, EF16-35mm f/2.8L II USM, EF24-105mm f/4L IS USM,
EF70-300mm f/4-5.6 IS USM, EF100-400mm f/4.5-5.6L IS USM, EF-S18-135mm f/3.5-5.6 IS STM) were added
specifically so that Canon-sourced `successor_of` edges had both endpoints present in the dataset.

## Not done (constraints respected)

No database writes, no changes under `src/`, no npm installs, no image downloads, no commits, no
pushes. All raw HTML was cached in the session scratchpad, not in the repo.
