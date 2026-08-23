# Nikon & Sony lens research — sourcing notes

Retrieved 2026-08-23. All figures in `lenses.json` come from a manufacturer-owned page,
recorded per lens in `source_urls`. Nothing was filled from a retailer, a review site, or
memory. Where the manufacturer does not state a field it is `null` and named in
`unsourced_fields`.

## Which manufacturer sources were usable, and which were not

Usable:

- **`imaging.nikon.com`** — Nikon's global imaging site. Full specification tables for every
  current NIKKOR Z and F-mount lens, plus a NIKKOR lens glossary at
  `https://imaging.nikon.com/imaging/lineup/lens/glossary/`. This was the source for all 32
  Nikon lenses.
- **`www.sony.jp/ichigan/products/{MODEL}/spec.html`** — Sony Japan's specification tables,
  and `.../feature_1.html` for the feature copy. Source for all 26 Sony lenses.

Blocked or missing (each was actually attempted):

| URL | Result |
|---|---|
| `www.nikon.com/products/imaging/lineup/lens/z-mount/` | HTTP 404 |
| `www.nikonusa.com/camera-lenses/mirrorless-lenses` | Reachable but paginated; only 13 lenses per page, no spec tab captured |
| `www.sony.co.uk/electronics/camera-lenses/...` | HTTP 403 on every request, category and product pages alike |
| `www.sony-asia.com/electronics/camera-lenses/...` | HTTP 403 |
| `electronics.sony.com/imaging/lenses/...` | Not fetchable from this environment |
| `imaging.nikon.com/.../accessory/mount_adapter/ftz2/` | HTTP 404 |
| `www.sony.jp/ichigan/technology/` and `/technology/emount/` | HTTP 404 |
| `imaging.nikon.com/imaging/lineup/z-mount/` | HTTP 404 |
| `imaging.nikon.com/imaging/lineup/lens/technology/` | HTTP 404 |
| `imaging.nikon.com/.../singlefocal/normal/af-s_nikkor_85mm_f18g/` | HTTP 404 — path from Nikon's own index page is stale |

The session's WebSearch budget was already exhausted (200/200) before this task began, so
URLs could not be discovered by search; every Sony model page was reached by constructing the
`SEL…` model-code URL directly.

## Flange focal distances — deliberately not recorded

The brief asks for Z-mount, F-mount and Sony E-mount flange distances with a source. **None
could be sourced from a manufacturer page in this pass.** Nikon's NIKKOR glossary defines
optical technologies but contains no mount geometry; the Nikon pages that carry mount
diagrams (`nikon.com` lineup paths, the FTZ II adapter page) 404'd; every Sony regional site
that publishes E-mount geometry returned 403.

Rather than fill in the numbers everyone knows, `technologies.json` carries two explicit
placeholder entries — `nikon-mount-flange-distances` and `sony-e-mount-flange-distance` —
whose summaries state that the figure is NOT SOURCED and why. This is the one field where a
remembered number would have been trivially easy to type and would have looked identical to a
sourced one. Fill these from `nikon.com` or `sony.co.uk` when those hosts are reachable.

## Reading Sony's Japanese specification tables

Sony JP writes lens construction as `N群M枚` — N **groups**, M **elements**, groups first.
The extraction pass returned these positionally, so `"15-20"` for the FE 24-70mm F2.8 GM II
means 15 groups / 20 elements, and it is recorded as `groups: 15, elements: 20`. Every Sony
construction figure in `lenses.json` was mapped with groups-first. Where the table's value did
not come through at all (13 lenses), both fields are `null` rather than guessed.

Sony states minimum focus distance and maximum magnification separately for AF and MF on
several lenses (FE 35mm F1.4 GM, FE 40mm F2.5 G, FE 20mm F1.8 G, E 11mm F1.8, E 15mm F1.4 G,
FE 85mm F1.4 GM). The **AF** figure is in the spec field; the full pair is quoted in
`manufacturer_claims` so nothing is lost.

## Weather sealing

Never asserted without documented wording.

- **Nikon** states dust- and drip-resistance in the product copy, usually as either
  "designed while carefully considering dust- and drip-resistant performance" or the footnote
  "Thorough dust- and drip-resistance is not guaranteed in all situations or under all
  conditions". Both are recorded as `weather_sealed: true` **with the exact wording quoted in
  `manufacturer_claims`**, because the hedge is Nikon's own and readers should see it.
- **Sony** puts 防塵防滴に配慮した設計 ("design with consideration for dust and moisture
  resistance") on feature pages, not in spec tables. Only two Sony feature pages were read in
  this pass, so only the FE 24-70mm F2.8 GM II and FE 200-600mm F5.6-6.3 G OSS carry
  `weather_sealed: true`. **The other 24 Sony lenses are `null`, not `false`** — several of
  them almost certainly are sealed. Do not read a Sony null as "unsealed".
- Nikon lenses with no sealing statement at all (Z 50mm f/1.4, Z DX 16-50mm, Z DX 50-250mm,
  Z DX 24mm, Z 180-600mm, Z 28-400mm, and all six F-mount lenses except the 70-200E FL) are
  likewise `null`.

## Fields that are structurally unsourceable

Out of 58 lenses:

- `focus_limiter` — 57 nulls. Neither maker puts it in a spec table.
- `internal_focus` — 57 nulls. Same.
- `announced` — 56 nulls. Neither maker's spec page carries an announcement date. The two
  exceptions (Z 100-400mm VR S, Z 24-120mm f/4 S) show **28 October 2021**, which Nikon gives
  as an availability/release date, not an announcement date. Treat those two with that caveat.
- `focus_motor` — 44 nulls. Nikon names STM on some Z lens pages and SWM on AF-S pages; Sony
  names the motor only on feature pages, so only two Sony lenses have it (XD Linear on the
  24-70 GM II, DDSSM recorded as `SSM` on the 200-600 G).
- `control_ring` (35), `internal_zoom` (34), `teleconverter_compatible` (30) — stated
  sporadically.
- `stabilisation_stops_claim` — 10 nulls, and **all of them are Sony**. Nikon quotes a CIPA
  stop figure for every VR lens; Sony's JP spec tables quote none at all. So the absence of a
  stop rating on a Sony lens says nothing about its stabiliser.

45 of 58 lenses have a complete core optical/physical spec set (focal range, apertures,
elements, groups, blades, min focus, magnification, filter, weight, dimensions). The 13
partial ones are all Sony, all missing element/group counts and in four cases blade counts.

## Marketing claims are quarantined

Every performance statement — "the world's shortest and lightest lens", "the shortest minimum
focus distance in its class", "approximately double the AF speed of the previous model",
"the lightest weight of approx. 630 g" against "competitors' products" — is stored in
`manufacturer_claims` with its source URL and never in a spec field. None of it is independent
testing and none of it should be rendered as a measured result.

One internal inconsistency worth flagging: Nikon's Z 180-600mm page gives the mass as
approx. 2,140 g with tripod collar / 1,955 g without in the spec table, while the marketing
copy on the same page says "approx. 1,995 g". `weight_g` uses the spec table's 1,955 g
(without collar, matching how the other collared lenses are recorded); the 1,995 g marketing
sentence is quoted verbatim in `manufacturer_claims` so the discrepancy is visible.

Weights for lenses supplied with a tripod collar (Z 70-200mm f/2.8 VR S, Z 100-400mm VR S,
Z 180-600mm VR, AF-S 200-500mm) are recorded **without** the collar, which is the figure both
makers publish alongside the with-collar one.

## Relationships: what was asserted and what was refused

`relationships.json` holds 35 edges. Only one direction is ever written — the reverse is
inferred at query time, and no `predecessor` type exists.

Asserted on a manufacturer statement:

- `successor_of` FE 24-70mm F2.8 GM II → FE 24-70mm F2.8 GM. Sony's own feature page names
  "the previous model (SEL2470GM)".
- `successor_of` FE 16-35mm F2.8 GM II → FE 16-35mm F2.8 GM. Sony's naming appends "II" to an
  otherwise identical designation under a distinct model code.
- `modern_equivalent` Z MC 105mm f/2.8 VR S → the F-mount 105mm Micro. Nikon makes the
  cross-mount comparison itself: "compared to the existing F-mount model".
- All `supports_extender` edges. Both makers list compatible teleconverters by model name.
- All `same_family` edges. Each cites the maker's own published grouping (Nikon's "S-Line
  Prime/Zoom Lenses" headings; Sony's G / GM / ZA badges; the APS-C 35mm-equivalent row).

Asserted as catalogue-level judgement, and **labelled as such in every `basis` string**:
the `alternative_to` and `competes_with` edges. These are shopping comparisons, not
manufacturer claims, and the basis field says so explicitly in each case.

### Considered and deliberately NOT asserted

- **AF-S NIKKOR 70-200mm f/2.8E FL ED VR → NIKKOR Z 70-200mm f/2.8 VR S as
  `modern_equivalent` or `successor_of`.** This is the textbook trap: same focal length, same
  aperture, same maker, adjacent mounts. Nikon never makes the comparison on either page.
  Rejected. The same reasoning rejects AF-S 24-70mm f/2.8E ED VR → Z 24-70mm f/2.8 S,
  AF-S 50mm f/1.8G → Z 50mm f/1.8 S, AF-S DX 35mm f/1.8G → Z DX 24mm f/1.7, and
  AF-S 200-500mm f/5.6E → Z 180-600mm VR.
- **`mount_successor` Z mount → F mount.** Obviously true in commercial terms, but no Nikon
  page read in this pass states it as a succession, and the type is defined over lenses here
  rather than mounts. Left to `technologies.json` prose instead.
- **`requires_adapter` for every F-mount lens onto a Z body (FTZ / FTZ II).** True, but the
  FTZ II product page 404'd and no other Nikon page consulted states the adapter's lens
  compatibility rules. Refused rather than written from memory. This is the single highest-
  value missing edge set — add it once the FTZ page is reachable.
- **`requires_adapter` for A-mount lenses onto E-mount bodies (LA-EA5).** The LA-EA5 page
  *was* readable and does state it, but no A-mount lens is in `lenses.json`, so there is
  nothing to attach the edge to. The substance is captured in the `sony-a-mount` technology
  entry instead.
- **`successor_of` NIKKOR Z 24-70mm f/2.8 S → nothing, and → its own "S II" version.** Nikon's
  index lists both a "Z 24-70mm f/2.8 S" and a "Z 24-70mm f/2.8 S II", and likewise a
  "70-200mm f/2.8 VR S II". The II variants' spec pages were not retrieved in this pass, so
  the edges are not written; they should be added when those two lenses are captured.
- **Zeiss ZA lenses as a grade above or below G.** Sony badges them neither. Any edge implying
  a tier ordering between ZA and G/GM would be invented. See the `sony-zeiss-branding`
  technology entry for what the branding actually is.

### Dangling `to_slug` values (intentional)

Eight targets are not rows in `lenses.json`: `sony-fe-24-70mm-f2-8-gm`,
`af-s-vr-micro-nikkor-105mm-f2-8g-if-ed`, and the six teleconverters
(`nikon-z-teleconverter-tc-14x`, `nikon-z-teleconverter-tc-2x`,
`nikon-af-s-teleconverter-tc-14e-iii`, `nikon-af-s-teleconverter-tc-20e-iii`,
`sony-sel14tc`, `sony-sel20tc`). Each is flagged in its own `basis` string. Teleconverters are
products, not lenses, and were out of scope; the two lens targets had unreachable spec pages.

## Coverage against the brief

Requested but not captured, with reason:

- **AF-S VR Micro-NIKKOR 105mm f/2.8G IF-ED** and **AF-P DX NIKKOR 18-55mm f/3.5-5.6G VR** —
  neither appears in Nikon's current F-mount index, so no live spec page exists to source
  them. Both are discontinued.
- **AF-S NIKKOR 85mm f/1.8G** — listed in Nikon's F-mount index but the path that index gives
  returns 404.
- **FE 50mm F1.2 GM element/group count, FE 16-35mm F2.8 GM II element/group and blade
  count** — Sony's spec table values did not come through; left null.

Substituted in to keep the counts within scope: Z 24-70mm f/4 S, Z 50mm f/1.2 S, Z 20mm f/1.8 S,
Z 17-28mm f/2.8, Z 28-400mm VR, Z MC 50mm f/2.8, Z DX 12-28mm PZ VR, AF-S Micro 60mm f/2.8G,
AF-S 200-500mm f/5.6E, and on the Sony side FE 35mm F1.4 GM, FE 24mm F1.4 GM, FE 90mm F2.8
Macro G OSS, FE 24-105mm F4 G OSS, FE 70-200mm F4 G OSS, FE 40mm F2.5 G, FE 35mm F1.8,
FE 50mm F1.8, FE 28-60mm F4-5.6 and the Vario-Tessar T* FE 24-70mm F4 ZA OSS.
