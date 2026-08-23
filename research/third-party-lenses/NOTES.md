# Third-party lens research — notes

Retrieved 2026-08-23. All data comes from manufacturer primary sources. No retailer, review
site, aggregator, or recalled-from-memory value is present in any spec field.

## Output

| File | Records |
|---|---|
| `lenses.json` | 49 |
| `technologies.json` | 23 |
| `families.json` | 11 |
| `relationships.json` | 29 |

49 lens records covering 32 distinct lens models. One record per mount, per the brief:
a lens sold in several mounts gets distinct slugs (`sigma-35mm-f1-4-dg-dn-art-e`,
`...-l`). No exceptions were taken to that rule.

## Sourcing outcome per manufacturer

| Manufacturer | Records | Source | Outcome |
|---|---|---|---|
| Sigma | 23 | sigma-global.com | Full. Spec tables are per-mount and complete. |
| Tamron | 14 | tamron.com | Full, via the `/spec.html` sub-page. |
| Viltrox | 5 | viltrox.com | Partial — see below. |
| Samyang | 4 | lksamyang.com | Full spec tables; no release dates published. |
| Tokina | 3 | tokinalens.com | Partial — see below. |
| Laowa / Venus Optics | 0 | venuslens.net | **Blocked (HTTP 403).** |
| ZEISS | 0 | zeiss.com | **Not reachable.** |

### Sites that blocked or defeated retrieval

- **venuslens.net (Laowa / Venus Optics) — HTTP 403 Forbidden.** Both `/collections/all`
  and the site root returned 403. Per the brief this was not retried further. **No Laowa
  lens is in this dataset** — the 15mm f/4 Macro, 100mm f/2.8 2x Ultra Macro and 9mm f/5.6
  are all missing. They need either a different retrieval route or manual entry.
- **zeiss.com — no 403, but no product pages reachable.** `photography.html` and
  `photonics-and-optics/en/photography/products.html` both fetched successfully but neither
  exposes URLs for the Batis, Loxia, Milvus or Otus family pages or any individual lens
  page. The products page names the families in prose only. **No ZEISS lens is in this
  dataset.** With the web-search budget exhausted (see below) there was no way to discover
  the real URLs.
- **Sigma `/specifications/` sub-path — HTTP 404.** Sigma serves the full spec table on
  the base product URL; there is no separate spec page. Three calls were lost to this.
- **tokina.com — HTTP 404 on every product path.** The correct host is **tokinalens.com**.
  Also, `tokinalens.com/product/atx_i_11_20mm_f2_8_cf_plus/` resolves but returns a catalog
  listing rather than a spec table, so the atx-i 11-20mm F2.8 CF PLUS is **not** included.
- **viltrox.com collection pages — HTTP 404** on `/collections/lens`, `/collections/af-lens`;
  `/collections/all` returns a truncated listing with no product URLs. Product URLs had to
  be scavenged from the homepage. `/products/af-27mm-f1-2` is 404, so that URL guess failed.

### Web search budget

The session's WebSearch allowance (200/200) was **already exhausted before this task
issued its first search**. All URL discovery was therefore done by fetching manufacturer
index pages and following links. This is the direct cause of the ZEISS gap and of several
lost calls to guessed URLs.

## Scope deviations

Requested but **absent**, with reason:

- **All Laowa lenses** (15mm f/4 Macro, 100mm f/2.8 2x Ultra Macro, 9mm f/5.6) — source 403.
- **All ZEISS lenses** (Batis, Loxia, Milvus) — product URLs undiscoverable, see above.
- **Viltrox AF 27mm F1.2, AF 75mm F1.2, AF 35mm F1.8, AF 85mm F1.8** — no reachable product
  page. Substituted with four Viltrox lenses whose pages *were* reachable: AF 16mm F1.8
  (E and Z), AF 85mm F1.4 Pro FE, AF 35mm F1.2 LAB FE, AF 85mm F2.0 EVO FE.
- **Samyang 12mm manual focus** — lives under a different category code (C) than the AF
  listing that was retrieved; not fetched before budget ran short.
- **Tokina atx-i 11-20mm F2.8 CF PLUS** — page returns a catalog listing, not specs.
- **Tokina atx-i 100mm F2.8 FF MACRO PLUS, Nikon F version** — Tokina offers it in Canon EF
  *and* Nikon F, but the target schema's `mount` vocabulary (`E|FE|L|RF|Z|EF|X|MFT`) has
  **no value for Nikon F**. Only the EF record exists. Adding Nikon F to the vocabulary
  would let the second record be created; the data for it is already in the source.

Added beyond the brief, to keep the count in the 45-60 band after the Laowa/ZEISS losses:
Sigma 105mm F2.8 DG DN MACRO | Art (L, E) and Sigma 16-28mm F2.8 DG DN | Contemporary (L, E).
The macro adds the only 1:1 Sigma record and the 16-28 adds a sourced `internal_zoom: true`.

## Field conventions and judgement calls

Each of these is a deliberate decision, not an oversight.

- **`stabilisation: "none"`** is recorded — rather than null — only where a complete
  manufacturer spec table was retrieved and lists no stabilisation, and the manufacturer's
  own product name carries no stabilisation token (Sigma `OS`, Tamron `VC`). Absence from a
  complete spec table is treated as evidence; absence from a partial page is not.
- **`weather_sealed`** is `true` only where the manufacturer states it (Sigma "dust and
  splash resistant structure", Tamron "Moisture-Resistant Construction", Samyang's sealing
  point counts, Viltrox's explicit weather-sealed marketing). Otherwise `null`. Notably it
  is **null for both Tamron Di III-A lenses** and for the **Sigma 18-50mm DC DN and 16-28mm
  DG DN** — those pages do not state sealing, and it has not been assumed from line membership.
- **`aperture_min`** for variable-aperture zooms uses the **wide-end** figure where the
  manufacturer quotes a range (Tamron A058 "F16-22" → 16; Sigma 150-600 "F22-29" → 22).
- **`tripod_collar: false`** on the Sigma 100-400mm Contemporary means *not supplied*. Sigma
  sells a magnesium-alloy tripod socket for it separately. The Sigma 150-600 Sports is
  `true` because the TS-121 socket ships in the box.
- **`teleconverter_compatible`** is `true` only on **L-mount** records of the Sigma 100-400
  and 150-600, because Sigma states TC-1411/TC-2011 support for L-Mount only. The Sony E
  records are `false` on that same statement.
- **`premium_line_name`** is constrained by the brief to `Art|Contemporary|Sports|Di III|
  Batis|Loxia|null`. Viltrox's LAB/Pro/EVO and Tokina's atx-i/atx-m lines therefore have
  `premium_line: false` and `premium_line_name: null` in `lenses.json`, and are captured in
  `families.json` instead. Tamron Di III-A records use `"Di III"`, the nearest permitted value.
- **Samyang mount** is recorded as `FE` (Samyang's own wording, "Sony FE") rather than `E`.
  Sigma/Tamron Sony records use `E`, matching those manufacturers' wording. Both values
  exist in the permitted vocabulary; consumers should treat them as the same physical mount.
- **Marketing statements never entered a spec field.** Every performance claim is in
  `manufacturer_claims` with its exact wording and source URL — including Sigma's
  "record-high performance", Tamron's "world's first* starting at F2" (asterisk preserved as
  published), Tokina's "Performs the lowest distortion, compared to other brands" and
  Samyang's lightest-85mm claim. None of these were converted into a boolean or number.
- **Two abbreviation expansions were removed after the fact.** Tamron `RXD` and `VC` are
  recorded as bare designations because Tamron's technology glossary page 404'd and no
  retrieved page expanded them. Expansions that *were* published are kept (Tamron VXD
  "Voice-coil eXtreme-torque Drive", Sigma HLA "High-response Linear Actuator", Sigma HSM
  "Hyper-Sonic Motor", Samyang DLSM "Dual Linear Sonic Motor").
- **`status`** is `current` for lenses on the manufacturer's live catalogue, `discontinued`
  for the Tamron 70-180mm F/2.8 A056 (Tamron marks the Sony E mount "End of sale"), and
  `unknown` for the first-generation Samyang AF 35mm F1.4 FE — it still appears in Samyang's
  AF listing alongside its FE II successor, which is not sufficient evidence either way.
  `discontinued` (the date field) is null on all 49 records; no manufacturer published one.

## Data completeness

- **41 of 49** records have a complete core spec set (elements, groups, blades, min focus,
  magnification, filter, weight, diameter, length).
- **8 partial records**: the four Tamron 17-70mm B070 mount variants (Tamron publishes
  per-mount length and weight, but the retrieval returned only the aggregate ranges
  117.3-121.3mm / 525-540g — recorded as null rather than guessing which value belongs to
  which mount), plus Viltrox AF 35mm F1.2 LAB and AF 85mm F2.0 EVO (no spec table published
  on the product page at all) and the Sigma 14-24mm Art pair (no filter thread — the lens
  has no front filter thread, and Sigma prints a dash).

### Fields most often unsourceable

| Field | Null count / 49 | Comment |
|---|---|---|
| `discontinued` | 49 | No manufacturer publishes a discontinuation date. |
| `internal_focus` | 46 | Almost never stated; only Viltrox and Tokina mention it. |
| `teleconverter_compatible` | 43 | Only Sigma states it, and only for L-mount. |
| `tripod_collar` | 42 | Stated only where one is supplied or sold separately. |
| `focus_limiter` | 41 | Stated on telephotos and macros only. |
| `control_ring` | 37 | Sigma enumerates aperture-ring controls; others rarely do. |
| `announced` | 31 | **Sigma publishes no release date on product pages at all** — all 23 Sigma records except the 100-400 (which states "2020") have a null. Tamron by contrast publishes an exact per-mount release date, so all 14 Tamron records carry month precision. Samyang and Viltrox publish none; Tokina publishes some. |
| `internal_zoom` | 21 | Stated only where marketed as a feature. |
| `weather_sealed` | 19 | See convention above. |

The `announced` gap is the single biggest quality issue and is entirely a Sigma problem.
Sigma's dated press releases exist under a separate newsroom path that was not reached
before the call budget ran out; that is the cheapest available fix.

## Relationships — and what was deliberately NOT asserted

29 relationships: 13 `alternative_to`, 11 `same_family`, 4 `supports_extender`,
1 `successor_of`. All `from_slug` and `to_slug` values resolve to records in `lenses.json`,
except four `supports_extender` targets (`sigma-tc-1411`, `sigma-tc-2011`) which are
teleconverter **accessories** and intentionally absent from a lenses-only file.

Deliberately **not** asserted:

1. **No `competes_with` against any Canon or Sony first-party lens.** The brief invited
   these and they would be valuable, but no Canon or Sony primary source was fetched in this
   session. Asserting that a Sigma 24-70mm F2.8 competes with a Sony FE 24-70mm F2.8 GM II
   would require the Sony lens's focal range, aperture and mount — which I could only supply
   from memory. That is exactly the defect the brief forbids. **This is the largest
   deliberate omission and the highest-value thing to add next**, needing only a few fetches
   against sony.net / canon.com.
2. **No `successor_of` from the Tamron 28-75mm G2 (A063) to the first-generation A036.** The
   A063 page does say its AF is "approximately twice as fast" as "the first-generation
   model", which is good evidence — but A036 is not in this dataset, so the edge would
   dangle. Add A036, then add the edge.
3. **No `successor_of` from the Sigma 24-70mm F2.8 DG DN II to the Mark I.** Same reason —
   the Mark I is not in the dataset.
4. **No `successor_of` from the Samyang AF 85mm F1.4 FE II to the FE.** The first-generation
   85mm (seq=418) was not fetched. Only the 35mm pair had both generations present, so only
   that one `successor_of` exists.
5. **No successor inferred from matching focal lengths anywhere.** The single `successor_of`
   asserted rests on Samyang's own product naming ("FE" vs "FE II"), and its `basis` says so
   explicitly.
6. **No `modern_equivalent` edges at all.** Every candidate would have required a
   cross-generation judgement not backed by a retrieved manufacturer statement.
7. **No `requires_adapter` edge for the Tokina atx-i 100mm (EF).** Mounting an EF lens on a
   mirrorless body does require an adapter, but that is general knowledge rather than a
   sourced statement from Tokina, and no adapter product record exists to point at.
8. **No `compatible_with` edges.** Nothing in the retrieved sources supported one that
   wasn't already better expressed as `same_family` or `supports_extender`.

`alternative_to` edges are grounded in specs already inside this dataset — same coverage,
comparable aperture, same mount — and each `basis` states the concrete differences
(weight, range, filter thread) rather than asserting a preference. No edge implies one lens
is better than another.

## Suggested next steps

1. Fetch Sigma's dated press releases to backfill `announced` on 22 Sigma records.
2. Find a working route to venuslens.net for the Laowa lenses (403 on direct fetch).
3. Discover the ZEISS Batis/Loxia/Milvus product URLs — needs a working web search.
4. Add Canon/Sony first-party equivalents from primary sources, then add the
   `competes_with` edges that were deliberately withheld.
5. Add `Nikon F` to the mount vocabulary if DSLR-era third-party glass is in scope; the
   Tokina atx-i 100mm Nikon F data is already retrieved and ready.
6. Re-fetch Tamron B070 per-mount length and weight.
