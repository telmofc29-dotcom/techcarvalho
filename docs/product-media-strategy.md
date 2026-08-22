# Product media strategy — unblocking 38 products without faking anything

**Status: audit + recommendation, EXCEPT §3a, which was applied to production on
2026-08-22.** Sections 1–3 and 4–5 remain analysis that has not been acted on; §3a is a
record of work that has. Written 2026-08-22. Read alongside `docs/canon-media-rights-request.md` (the drafted,
unsent Canon permission request) and `src/lib/media/rights.ts` (the enforcement point).

## The rules this document works under

These are constraints, not preferences, and nothing below negotiates with them:

1. An image being publicly accessible is **not** permission to republish it. Discovery
   and republication permission stay separate concepts.
2. No fictional product photography. Never a generated image presented as, or
   mistakable for, a photograph of a real product.
3. No publishing a product page that lacks legitimate required photography — unless the
   page is honestly designed to have none (see [The no-photo page](#4-the-no-photo-page)).
4. No fabricated specifications, fake sources, or invented media rights.

---

## 1. Audit

### 1.1 What I could and could not see

I connected to production **read-only** with the `anon` key from `.env.local`. No
writes, no migrations, no deploys.

**`anon` cannot see the blocked products.** RLS denies by returning **zero rows, not an
error**, so these zero-counts are *not* evidence of absence:

| Table | `anon` count | Interpretation |
|---|---|---|
| `products` | 6 | Only `is_published = true` rows. The other 38 exist but are invisible. |
| `media_requirements` | 0 | **RLS denial.** Admin-only table. Says nothing about the real count. |
| `engine_media_candidates` | 0 | **RLS denial.** The 103 candidates / 38 in `rights_review` are unverifiable from here. |
| `engine_sources` | 0 | **RLS denial.** The 19 sources / 4 active / 0 with republication permission are unverifiable from here. |
| `media_assets` | 64 | Published assets only. |
| `content_items` | 72 | All published. |
| `manufacturers` | 15 | World-readable reference data — this one is a true total. |
| `taxonomy_categories` | 10 | World-readable — true total. |

So the headline figures in the brief (44 products, 103 candidates, 38 in `rights_review`,
19 sources, 0 with `media_republication_permitted`) **could not be independently
confirmed from the anon connection.** Everything below either derives from data `anon`
genuinely can see, or from the repository, and I say which.

### 1.2 What the catalogue actually is

`data/catalogue/*.ts` defines **exactly 22 products, all Canon EOS bodies.** `anon` shows
6 of them published. 22 − 6 = **16 blocked Canon products**, which matches
`docs/canon-media-rights-request.md`'s "16 of 38 blocked products (42%) are Canon" exactly.
That corroboration is the strongest evidence I have that the 38 figure is real.

**The other 22 blocked products are not in this repository at all.** No catalogue file
anywhere in git history defines a non-Canon product, so they were created directly against
production during an earlier growth batch rather than from a checked-in source.

> **Correction (verified 2026-08-22).** An earlier revision of this document attributed
> these 22 to `src/lib/engine/jobs/product-job.ts`. That is impossible: that file was
> written in this session, and the `engine_assemble_product` RPC it depends on is still
> unapplied — production returns "function not found" for it. Nothing in the engine has
> ever created a product row. **How the 22 were created is therefore unestablished**, and
> answering it needs an authenticated session, not a guess.

That gives the real shape of the problem, and it is **not** one problem but two:

| Cohort | Count | What they are | Why blocked |
|---|---|---|---|
| Canon EOS bodies | 16 | Researched catalogue entries, released 2009–2023 | No licensed photo associated yet |
| Engine-created stubs | 22 | Auto-created from launch announcements across 14 other manufacturers | Same — but these are *new* products |

I could not enumerate the 22 by name. Their manufacturers are drawn from the 15 in
`manufacturers` (Canon, Sony, Microsoft, Nintendo, NVIDIA, AMD, Intel, Apple, Samsung,
Google, DJI, GoPro, TP-Link, Roborock, Amazon), and the published comparison-graphic titles
in `media_assets` name the subjects the site is actually covering: RTX 5090/5080,
Ryzen 9800X3D/9950X, PS5/PS5 Pro, Xbox Series X/S, Switch 2, iPhone 17 Pro, Galaxy S26
Ultra, Pixel 10 Pro, DJI Mini 4 Pro/Air 3S, GoPro Hero 13, Osmo Action 5 Pro, mesh routers.

### 1.3 The finding that reframes the whole problem

**The 6 published products were never unblocked by manufacturer permission. They were
unblocked by Wikimedia Commons.**

Every one of the 6 published Canon products has a hero image sourced from Commons under a
CC licence, with full credit metadata:

| Product | Licence | Credit stored |
|---|---|---|
| Canon EOS 5D | CC BY-SA 3.0 | Photo: Ashley Pomeroy, CC BY-SA 3.0, via Wikimedia Commons |
| Canon EOS 5D Mark II | CC BY-SA 3.0 | Photo: Mlogic (Yan Li), CC BY-SA 3.0, via Wikimedia Commons |
| Canon EOS 5D Mark III | CC BY-SA 3.0 | Photo: decltype, CC BY-SA 3.0, via Wikimedia Commons |
| Canon EOS 5D Mark IV | CC BY-SA 3.0 | Photo by CEphoto, Uwe Aranas, CC BY-SA 3.0, via Wikimedia Commons |
| Canon EOS 90D | CC BY-SA 4.0 | Photo: Jean-Paul GALLOIS, CC BY-SA 4.0, via Wikimedia Commons |
| Canon EOS R5 | CC BY-SA 4.0 | Photo: Harrison Jones, CC BY-SA 4.0, via Wikimedia Commons |

All carry `rights_status = 'verified'`, `attribution_required = true`, a real `creator`,
and a `source_url` pointing at the Commons file page. `src/app/(public)/products/[slug]/page.tsx`
does render the credit line for gallery images, so the licence condition is being met.

This matters enormously: **the route that unblocked the first 6 products needs no
manufacturer's permission, and it has already been proven end-to-end in this codebase.**
The strategy below is mostly about extending it carefully rather than inventing something new.

The precedent was also set *honestly*. `scripts/import-test-media.ts` documents rejecting
`File:Canon_EOS_5D.jpg` because its EXIF asserted "all rights reserved", contradicting the
CC badge on the file page. That is exactly the standard to keep.

### 1.4 Two data-hygiene defects found

Neither is urgent, neither was changed:

1. **`source_type` is wrong on all 9 Commons assets.** They are recorded as `'other'`
   (7) or `NULL` (2). The schema has had a purpose-built `'public_domain_or_cc'` value
   since `20260821_media_sourcing_workflow.sql` and it is unused. This makes the media
   library unfilterable by the very category that matters most here.
2. **`asset_role` is NULL on every product photo.** `'product_photo'` exists in the
   enum and is unused, while the 27 article heroes are correctly tagged `'article_hero'`.

Both are metadata-only corrections on 9 rows. They need admin credentials and your
approval; I have not touched them.

---


## 2. Rights findings

### 2.1 The proven route: Wikimedia Commons freely-licensed photography

This is the route that actually unblocked the first 6 products, so it gets checked first
and hardest. **Verified against production 2026-08-22** — all 6 published products carry a
Commons `source_url`, a named `creator`, `attribution_required = true`, and
`rights_status = 'verified'`.

**Commercial use is permitted.** CC BY-SA 4.0's deed states you may "copy and redistribute
the material in any medium or format for any purpose, **even commercially**".
(<https://creativecommons.org/licenses/by-sa/4.0/>)

**What must be provided.** "Appropriate credit, provide a link to the license, and indicate
if changes were made" — which the deed's footnote expands to "the name of the creator and
attribution parties, a copyright notice, a license notice, a disclaimer notice, and a link
to the material."

**The ShareAlike question, which is the one that actually matters here.** The concern is
whether putting a CC BY-SA photo on a product page forces TechCarvalho to license the whole
page under CC BY-SA. On the face of the licence, it does not:

- Section 1(a) defines Adapted Material as material "derived from or based upon the
  Licensed Material and in which the Licensed Material is **translated, altered, arranged,
  transformed, or otherwise modified** in a manner requiring permission".
- Section 3(b) triggers ShareAlike only "**if You Share Adapted Material You produce**".

An unmodified photograph placed beside independently-written text is not a modification of
that photograph, so it does not appear to produce Adapted Material. Two honest caveats:

1. I could not find explicit "collections" language in the 4.0 legal code confirming this
   in so many words. Creative Commons' FAQ treats collections and adaptations as distinct
   categories, but the legal code itself does not spell out the collection case. This
   reading is well established in practice; it is not something I verified from a
   definitive clause.
2. **This is not legal advice.** It is a documented reading of the licence text, recorded
   so the reasoning is auditable rather than silently assumed.

**A practical consequence that does affect the pipeline.** The licence requires you to
"indicate if changes were made". The media pipeline uses `sharp` to trim and resize.
Format conversion and resizing are conventionally not treated as adaptations, but cropping
changes the work. If a Commons image is cropped, that must be disclosed in the credit line.
The safest default is not to crop Commons product photography at all.

**Commons' own warning, which is the important one.** Commons states that the Wikimedia
Foundation "does not provide any warranty regarding the copyright status or correctness of
licensing terms" and that reusers should verify independently.
(<https://commons.wikimedia.org/wiki/Commons:Reusing_content_outside_Wikimedia>)

That warning is not theoretical here. `scripts/import-test-media.ts` already records
rejecting `File:Canon_EOS_5D.jpg` because its EXIF asserted "all rights reserved",
contradicting the CC badge on the file page. **A Commons licence tag is a claim, not
proof** — the same principle as everywhere else in this project: discovery is not
permission. Human verification stays mandatory, and `evaluatePublishEligibility()` already
requires `rights_status = 'verified'`, which only a human can set.

### 2.2 Manufacturer press programmes — NOT COMPLETED

**This research is incomplete and must not be treated as a finding.** The agents
researching Sony, Samsung, ASUS, AMD, NVIDIA, Logitech and Anker press terms, plus stock
and affiliate/product APIs, were terminated by a session limit before reporting. Some had
already hit access barriers — Shutterstock blocks direct fetching, and `web.archive.org`
was unreachable.

What stands from earlier work is unchanged: `docs/canon-media-rights-request.md` documents
Canon's contradictory terms and remains unsent, and **zero** of the 19 `engine_sources`
rows have `media_republication_permitted = true`. Nothing established here changes that,
and nothing in this document should be read as implying otherwise.

The standing rule for whenever this research resumes: **an API returning an image URL does
not grant republication rights.** The terms must say so explicitly, and the clause must be
quoted with its source URL.

---

## 3. Which of the 38 can actually be unblocked

I probed the Wikimedia Commons API directly for the subjects the blocked catalogue covers.
Method and its limits, stated plainly: a plain-text search, top 8 file results per subject,
counting only files whose `LicenseShortName` begins CC BY / CC BY-SA / CC0 / Public domain.
This **understates** availability — a proper per-product search of Commons categories will
find more — and it does not confirm that any given hit is a usable photograph.

| Subject | Freely-licensed hits (of 8) | Example licence |
|---|---|---|
| Xbox Series X | 5 | Public domain (Evan-Amos) |
| iPhone 17 Pro | 5 | CC0 |
| PlayStation 5 | 2 | CC0 |
| Galaxy S26 Ultra | 2 | Public domain — **but see caveat** |
| PlayStation 5 Pro | 1 | Public domain |
| DJI Air 3S | 1 | CC0 |
| Steam Deck | 1 | Public domain (Valve) |
| Sony Alpha 7 IV | 1 | CC0 |
| Framework Laptop | 1 | CC0 |
| Nintendo Switch 2 | **0** | — |
| GeForce RTX 5090 / 5080 | **0** | — |
| Ryzen 9800X3D | **0** | — |
| Radeon RX 9070 | **0** | — |
| Pixel 9 Pro / 10 Pro | **0** | — |
| DJI Mini 4 Pro | **0** | — |
| GoPro Hero 13 | **0** | — |
| DJI Osmo Action 5 Pro | **0** | — |
| Canon EOS R6 Mark II | **0** | — |

> **Superseded in part — see [§3a](#3a-executed-drones-action-cameras-networking-and-smart-home-2026-08-22).**
> The **0** rows above for DJI Mini 4 Pro, GoPro Hero 13 and DJI Osmo Action 5 Pro are
> wrong: a category-based search found usable CC BY-SA 4.0 photography for all three, and
> all three are now published. The zero-counts in this table mean "not found by a
> plain-text file search", not "does not exist". Do not treat any row here as evidence of
> absence without repeating the search against Commons **categories**.

**Caveat that must not be skipped:** a freely-licensed file matching a product name is not
necessarily a *photograph of that product*. The Galaxy S26 Ultra hit is a Samsung logo SVG,
not a handset photo. Every candidate needs a human to confirm it actually depicts the
product before `rights_status` is set to `verified`.

### The pattern, which is the actionable finding

**Freely-licensed photography tracks how long hardware has been in enthusiast hands, not
how important it is.** Consoles, phones and older camera bodies are well covered, because
people photograph them and upload them. **Current-generation PC components are not covered
at all** — RTX 50-series, Ryzen 9000 and RX 9070 all returned nothing — and neither is very
recent hardware of any kind (Switch 2, GoPro Hero 13, Osmo Action 5 Pro).

So the 38 split into three groups, and they need three different answers:

1. **Plausibly unblockable now, via Commons, with no manufacturer permission** — consoles,
   phones, Steam Deck, some drones and older camera bodies. This route is already proven
   end-to-end in this codebase.
2. **Blocked on time, not on permission** — recent hardware that simply has not been
   photographed and uploaded yet. Re-checking Commons periodically will clear some of these
   with no negotiation at all. This is worth a scheduled recheck, not a decision.
3. **Genuinely blocked without permission** — current-generation PC components. These are
   the strongest candidates for a manufacturer request, and the best case for the no-photo
   page below.

**I am deliberately not putting a number on how many of the 38 are unblockable.** Doing so
would require listing the 38 blocked products, and `anon` cannot see unpublished rows — RLS
returns zero rows rather than an error, so any count produced from here would be a guess
dressed as a finding. The per-manufacturer breakdown needs an authenticated session against
`media_requirements`, which belongs in the admin Media Requirements surface that already
exists rather than in this document.

---

## 3a. Executed: drones, action cameras, networking and smart home (2026-08-22)

**Status: APPLIED to production.** Unlike the rest of this document, this section
describes work that was actually carried out, not a recommendation. Eight products were
worked by hand through the Commons route of §2.1; **four were unblocked and published,
four were rejected.** The script that did the ingest, with the per-file verification notes
kept beside the data they justify, is
`scripts/import-commons-media-drones-actioncams.ts`.

### What §3's probe got wrong, and why

§3's table reports **0** freely-licensed hits for DJI Mini 4 Pro, GoPro Hero 13 and DJI
Osmo Action 5 Pro. All three were in fact unblockable. The probe's own stated method
explains the miss: it was a **plain-text file search**, and Commons' full-text search does
not surface these files well.

- `File:2024 Dron DJI Mini 4 Pro (03).jpg` sits in `Category:DJI Mini 4 Pro` (46 members)
  but its description is in Polish.
- The GoPro files are titled **"GoPro Héro 13 Black"** — French spelling, with an accent —
  and are categorised under `Category:GoPro Hero 13 black` (lowercase *black*), which is
  why neither `"GoPro HERO13"` nor a `"GoPro HERO"` category search reaches them.
- A free-text search for `GoPro HERO13` returns 20 Mapillary street-level photos **taken
  with** a HERO13. Files taken *by* a device drown out files depicting it; Commons even has
  a parallel `Category:Taken with …` tree for exactly this, and DJI's are named by opaque
  EXIF model codes (`Category:DJI FC8482`) that look like product categories but are not.

**The generalisable lesson: search Commons CATEGORIES, and enumerate them in full.**
Category membership is human-curated and language-independent; full-text search is neither.
Every one of the four successes came from a category listing, and none of the four would
have been found by name search alone. §3's zero-counts should be read as "not found by that
method", not as "does not exist" — the same empty-vs-failed distinction CLAUDE.md draws for
queries applies to searches.

### Unblocked (4) — all published, all verified by hand

Every file below had its **raw wikitext** read (so the licence template is read directly
rather than inferred from a rendered badge) **and** its full EXIF block checked for the
failure mode that got `File:Canon_EOS_5D.jpg` rejected. All four are CC BY-SA 4.0,
`{{self}}` + own-work, `permission=` empty, commercial use permitted, no `NoDerivatives`
and no `NonCommercial` anywhere.

| Product | Commons file | Licence | Creator | Model proof |
|---|---|---|---|---|
| DJI Mini 4 Pro | [`2024 Dron DJI Mini 4 Pro (03).jpg`](https://commons.wikimedia.org/wiki/File:2024_Dron_DJI_Mini_4_Pro_(03).jpg) | CC BY-SA 4.0 | Jacek Halicki | "MINI 4 PRO" printed on the arm, legible in frame |
| DJI Air 3S | [`2024 Dron DJI Air 3S (2).jpg`](https://commons.wikimedia.org/wiki/File:2024_Dron_DJI_Air_3S_(2).jpg) | CC BY-SA 4.0 | Jacek Halicki | "AIR 3S" printed on the arm, legible in frame |
| DJI Osmo Action 5 Pro | [`Osmo Action Pro 5 Camera ZVE05411.jpg`](https://commons.wikimedia.org/wiki/File:Osmo_Action_Pro_5_Camera_ZVE05411.jpg) | CC BY-SA 4.0 | Habib M'henni (User:Dyolf77) | "ACTION 5 PRO" printed on the front face |
| GoPro HERO13 Black | [`GoPro Héro 13 Black - 01.jpg`](https://commons.wikimedia.org/wiki/File:GoPro_H%C3%A9ro_13_Black_-_01.jpg) | CC BY-SA 4.0 | François Leblond (User:François de Dijon) | sibling frames 05/06 of the same camera on the same tripod show "13 BLACK" |

**Model confirmation was treated as a separate gate from the licence**, because the
generation-confusion risk in this group is real: Mini 3 Pro vs Mini 4 Pro and HERO12 vs
HERO13 are near-identical at a glance. Every chosen file was opened and looked at, and only
files where the model name is physically printed on the product — or on an identical unit
from the same shoot — were accepted.

**One EXIF finding worth recording, because it is the near-miss.** The GoPro file carries
`Copyright: "Francois Leblond"` in EXIF while the Commons account is "François de Dijon".
This was **not** treated as a contradiction, and the distinction matters for future
batches: a CC licence does not waive copyright, so a bare authorship assertion naming the
photographer is exactly what a correctly-licensed CC file looks like. What disqualified
`File:Canon_EOS_5D.jpg` was an "**all rights reserved**" assertion, which is a licence
*conflict*. The name mismatch was resolved separately by reading the uploader's Commons
user page: a long-standing French amateur photographer with a large own-work catalogue,
consistent with the real name in EXIF.

**Two candidates were rejected despite carrying a clean CC BY-SA 4.0 tag and an "own work"
claim:** `File:GoPro Hero 13 Black in Polar White.png` and
`File:GoPro Hero 13 Black in Forest Green.png`. Both are 1920px PNGs of specific
colourways with no camera EXIF — the shape of a manufacturer press render, not of a
photograph someone took. §2.1's rule decided it: a Commons licence tag is a claim, not
proof, and an own-work claim that does not fit the artefact is not proof either.

### Rejected (4) — searched, nothing usable, and why

These are **findings, not gaps**. Each is also recorded on the product's
`media_requirements` row (`sourcing_status = 'blocked'` with the full search record in
`notes`), so the negative result is visible in the admin Media Requirements surface rather
than only in this file.

| Product | Searched | Found | Why rejected |
|---|---|---|---|
| **TP-Link Deco XE75** | category search `TP-Link`; `Category:TP-Link products` (27 members) and `Category:TP-Link Wi-Fi routers and access points` (33) enumerated in full; file search `TP-Link Deco`; `insource:"Deco XE75"` → **0** | Deco M4R and Deco M9 Plus only | Different, older, non-Wi-Fi-6E products. A Deco M9 Plus photo on an XE75 page is a wrong-product image. |
| **TP-Link Deco BE85** | file search `BE85` (returns Korean-glyph SVGs and Stockholm museum photos); `insource:"Deco BE85"` → **0**; both TP-Link categories enumerated in full | No Wi-Fi 7 Deco of any model | Nearest Wi-Fi 7 TP-Link file is `File:Archer GE800.jpg` — a gaming router, a different product line, not mesh. |
| **Roborock Saros 10R** | category search `Roborock` (exactly one category); `Category:Roborock` enumerated in full (5 members); file search `Roborock`; `Saros 10R`; `insource:"Saros"` | 3 logos, 1 Roborock Q8 Max Plus, 1 unidentified charging robot vacuum. `insource:"Saros"` returns only solar-eclipse **saros-cycle** diagrams — an unrelated homonym. | No Saros-series photography exists on Commons. Q8 Max Plus is a different product. |
| **Amazon Echo Show 8 (4th Gen)** | category search `Amazon Echo`; `Category:Amazon Echo` enumerated in full (84 members); `intitle:"Echo Show"` → 6 files; `insource:"Echo Show 8"` → **0** | Echo Show (1st/2nd gen) and Echo Show 5 only | **No Echo Show 8 of any generation is on Commons**, let alone 4th Gen. An Echo Show 5 is a visibly different device. |

All four are **§3 group 2 — blocked on time, not on permission.** Nobody has photographed
and uploaded one yet. They need a scheduled recheck, not a negotiation and not a
manufacturer request.

### A defect found in the ingest path

MediaWiki's `imageinfo` API returns a `thumburl` pointing at a **larger pre-rendered
bucket** than `iiurlwidth` asked for — requesting 1600px returned a `.../1920px-...` URL
on all four files — while still reporting `thumbwidth`/`thumbheight` as the *requested*
size. The first run therefore recorded `media_assets.width/height` 20% smaller than the
bytes actually stored. The four rows were corrected, and the script now reads the
dimensions out of the downloaded JPEG's SOF marker instead of trusting the API's numbers.
Nothing downstream renders from those columns today (the hero uses `next/image` with
`fill`), so this was wrong metadata rather than a visible bug — but it is exactly the kind
of quietly-wrong number that §1.4 already flags a pattern of.

### Notes on how these were wired up

- No cropping. Each file is Commons' own pure downscale of the untouched original — aspect
  ratio preserved to the pixel — so there is no "changes were made" disclosure owed beyond
  the scale. §2.1's advice to leave Commons photography uncropped was followed.
- `source_type = 'public_domain_or_cc'` and `asset_role = 'product_photo'` were set
  correctly from the start, i.e. these four rows do **not** repeat the §1.4 defect. The
  original 9 rows still carry `'other'`/`NULL` and remain uncorrected.
- All eight products in this group already had their `content_products` links. Article
  bodies were re-scanned for unlinked mentions of each product and **every genuine textual
  mention was already linked**, so no new content links were invented to pad the graph.
- Two `product_relationships` rows were added, each backed by a published comparison
  article and stored **one-directional only** per CLAUDE.md:
  `dji-mini-4-pro --alternative_to--> dji-air-3s` and
  `gopro-hero13-black --alternative_to--> dji-osmo-action-5-pro`.
- Pre-existing data defect, not touched: `canon-eos-r7 --alternative_to--> canon-eos-r10`
  and its reciprocal `canon-eos-r10 --alternative_to--> canon-eos-r7` both exist in
  `product_relationships`, which contradicts the one-directional rule and will render that
  pair's relationship twice.

---

## 4. The no-photo page

For group 3 — and as the honest default whenever photography is absent — a product page
should be **designed to have no photograph**, not display a placeholder implying one is
coming.

This enforces rule 2 above. An original TechCarvalho graphic is legitimate precisely
because it is obviously a graphic: a spec panel, a comparison table or a labelled diagram
is TechCarvalho's own work, owned outright, and cannot be mistaken for a photograph of the
real product. What is never acceptable is a generated image that *looks* like product
photography.

Implementation status: `src/lib/media/presentation.ts` and
`src/components/public/product-lead-media.tsx` exist for exactly this purpose, and
`src/lib/media/graphics/` plus `scripts/generate-editorial-graphics.mjs` provide the
original-graphic generators — the same mechanism that unblocked 27 articles.

---

## 5. Recommended next actions

Ordered by value per unit of effort. **None of these has been done.**

1. **Fix the metadata on the 9 existing Commons assets** — `source_type` to
   `'public_domain_or_cc'`, `asset_role` to `'product_photo'`. Metadata-only, 9 rows, and
   it makes the library filterable by the category that matters most here. Needs approval.
2. **Run the per-manufacturer breakdown of the 38 from an authenticated session**, so
   groups 1 / 2 / 3 become a real list instead of a pattern.
3. **Work group 1 through Commons by hand**, verifying each file page individually — the
   licence tag is a claim, not proof.
4. **Schedule a recheck for group 2.** Nothing needs deciding; the photography just does
   not exist yet.
5. **Resume the manufacturer press-terms research** that the session limit cut short.
6. **Establish how the 22 non-Canon product rows were actually created**, since the
   original explanation turned out to be impossible.
7. **Never** treat a Commons licence tag, an API image URL, or public accessibility as
   permission.
