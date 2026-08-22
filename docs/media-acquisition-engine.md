# The media acquisition engine: what it can actually do

Written 2026-08-22. Describes `src/lib/media/providers/`, the stage it added to
`src/lib/engine/jobs/media-acquisition-job.ts`, and the harness
`scripts/engine-media-search.ts`. Read alongside `docs/product-media-strategy.md`, which is
the audit this was built in response to, and `docs/stock-provider-assessment.md`, which
records the two providers that were investigated and left switched off.

## The one sentence that governs everything here

**Finding an image is not permission to publish it.**

That is not a slogan in this codebase, it is a type. `DiscoveredCandidate` — what a search
returns — has no licence field, no creator field and no rights field of any kind. A provider
that "saw a licence" in a search response has nowhere to record it and must resolve the
item's own source page before it can say anything about rights. Discovery and rights
verification are different stages producing different types, and the compiler will not let
one stand in for the other.

## What the engine can ACTUALLY search

One provider: **Wikimedia Commons**. It is the only entry in
`src/lib/media/providers/registry.ts` with `approvedForSearch: true`.

"Approved provider" means **the engine may issue requests to this source**. It never means
its assets are approved. In the first real run against a product with known-good Commons
photography, 60 candidates were examined and 52 were rejected before rights were even
consulted.

Four other providers are listed with `approvedForSearch: false` and the reason each is off:
Openverse (exposes a licence badge with no route to the evidence underneath), Flickr (not yet
assessed; would need its API terms read and quoted), Pexels and Unsplash (investigated — see
`docs/stock-provider-assessment.md`; both explicitly withhold the right to use the trademarks
and brands that a product photograph consists of).

The pipeline imports **no** provider. It takes the list as a parameter. Adding a second
source is implementing `MediaProvider` and adding a registry entry; there is no branch
anywhere that special-cases Commons.

### The search method, which is the part that took a failure to learn

`docs/product-media-strategy.md` §3 records a plain-text Commons probe reporting **zero**
freely-licensed files for the DJI Mini 4 Pro, GoPro HERO13 and Osmo Action 5 Pro. All three
had perfectly good CC BY-SA 4.0 photography. The engine therefore searches
**categories first, enumerated in full**:

1. Search namespace 14 for the product name in several spellings.
2. **Walk the manufacturer's subcategory tree.** This is the step that reaches
   `Category:GoPro Hero 13 black` — lowercase, and `Category:GoPro Héro 13 black` — French
   and accented. Neither is guessable from "GoPro HERO13 Black"; both were found by the
   engine on its first live run.
3. Filter every candidate category through `matchCategoryTitle()`, which refuses capturing-
   device categories (`Category:Taken with …`, and the DJI trap `Category:DJI FC8482` — an
   opaque EXIF model code that looks like a product category and is not).
4. Enumerate each accepted category in full, following continuations.
5. Only then `intitle:`, `insource:` and free text, in that order of trust.

Requests are spaced 2500ms. Every response body is checked to start with `{` before parsing,
because Commons returns an HTML error page when it throttles and a bare `.json()` would throw
something unrelated to the real problem.

## What the engine can ACTUALLY acquire

`scripts/engine-media-search.ts --acquire` will, for a candidate that cleared every gate:

- download Commons' own downscale of the untouched original (a pure resize — aspect preserved
  to the pixel, so no "changes were made" disclosure is owed beyond the scale);
- read the real pixel dimensions out of the JPEG's SOF marker rather than trusting the API,
  which reports the *requested* thumbnail size while serving a larger bucket;
- compute a SHA-256 of the bytes actually stored;
- upload to `media-private`;
- insert an **unpublished** `media_assets` row with `rights_status='pending_verification'`.

It does **not** copy to `media-public`, does **not** link a hero, does **not** set the
requirement to `approved`, and does **not** publish the product. It sets the requirement to
`available` — which `evaluateMediaReadiness()` correctly treats as not ready, because having
a file is not having a permission.

## What the engine can ACTUALLY rights-verify independently

It can establish, from primary evidence it fetched itself:

| Evidence | Where it is read from |
|---|---|
| Licence template | the file's **raw wikitext** — the declaration the badge is generated from, not the badge |
| Licence metadata | `imageinfo extmetadata` `LicenseShortName` / `UsageTerms` |
| Creator + creator page | `extmetadata Artist` (HTML stripped, href recovered) or `{{Information|author=}}` |
| Source / credit | `extmetadata Credit` or `{{Information|source=}}` |
| Permission field | `{{Information|permission=}}` — empty is the healthy state for an own-work CC upload |
| Restrictions | `extmetadata Restrictions` |
| Embedded rights metadata | `Copyright`, **`UsageTerms`**, `CopyrightNotice`, `Rights`, `WebStatement` and `Artist`, read from **both** `commonmetadata` and `metadata`, in whatever shape MediaWiki returns them |
| Content hash | `imageinfo sha1` of the original, plus SHA-256 of the bytes on acquisition |
| Dimensions, MIME, byte size | `imageinfo` |

> **The Canon EOS 5D lesson, 2026-08-22.** This file has been cited for months as the
> reason the embedded-rights cross-check exists, and it was passing that check.
> Two defects in the same costume. Its EXIF `Copyright` reads `©2008 Charles
> Lanteigne` — a bare notice, correctly NOT a conflict, because CC does not waive
> copyright. The real reservation sits in `UsageTerms`: *"No Usage Rights Granted
> Without Written Authorization from Charles Lanteigne"* — a field the reader
> never looked at, whose sentence matched none of the reservation patterns
> because those had been written from a phrase a human once quoted rather than
> from what the file says. It came out `evidence_complete`, `mayAcquire=true`.
>
> Two consequences worth carrying: a rights reader must scan **every string in
> the value, whatever shape it is in** — a reservation buried in an
> uninterpretable structure is a fact about the FILE and beats a fact about the
> reader — and an **unreadable** rights-bearing field must block rather than
> return "says nothing", because those two answers arrive at the gate as the same
> word and that word is *proceed*.
>
> Also note: `insource:` indexes wikitext only, so `insource:"No Usage Rights
> Granted"` returns **zero hits** for a file carrying exactly that in its EXIF.
> EXIF-borne reservations cannot be found by search; only by reading the embedded
> metadata of each candidate.

It cross-checks them. The two independent licence reads must agree. An EXIF **reservation**
of rights blocks (this is the `File:Canon_EOS_5D.jpg` failure); an EXIF `Copyright` naming
the photographer does **not**, because CC does not waive copyright and naming the author is
exactly what a correctly-licensed file looks like. A NonCommercial or NoDerivatives template
anywhere on the page wins over a permissive one on the same page.

**Its strongest possible conclusion is `evidence_complete`, and that is a statement about
evidence, not a permission.** `RightsAssessment.mayPublish` is typed `false` — not defaulted
to false, *typed* false, so no future edit can set it without changing the type and every
test that asserts on it. The strongest `media_assets.rights_status` any autonomous path may
write is `pending_verification`, held in the constant `ENGINE_MAX_RIGHTS_STATUS`.

`rights_status='verified'` is what clears `evaluatePublishEligibility()`. **No code path in
`src/lib/media/providers/` produces it.** A test asserts that the row the pipeline builds is
*refused* by the publication gate — `safe: true` in `validateEnginePublicationSafety()` means
"correctly blocked", and a `safe: false` is a defect that aborts the write.

## What still needs a human

1. **Setting `rights_status='verified'`.** Commons states that the Foundation "does not
   provide any warranty regarding the copyright status or correctness of licensing terms".
   The engine checks the uploader's claim against everything that could contradict it; it
   does not become the claim's guarantor.
2. **Looking at the picture.** Nothing here can confirm that the model name printed on the
   product in frame is the right one. The 2026-08 batch accepted files specifically because a
   human read "MINI 4 PRO" off the arm and "ACTION 5 PRO" off the front face. The engine's
   entity match works on text; a HERO12 and a HERO13 are near-identical at a glance.
3. **Approving the requirement** and linking the hero.
4. **Writing alt text.** The engine does not invent descriptions of images it has not seen.
5. **Judging a populated `permission=` field**, which usually points at a VRT ticket.

## The gates, in order, and what each refuses

| Stage | Refuses |
|---|---|
| Query expansion | any query that drops a discriminator — `Canon EOS` for a 60D, `PlayStation 5` for a PS5 Pro. Brand-only searches are generated and explicitly declined, and the refusal is logged. |
| Entity validation | wrong model number in the title; **a title naming two products at once** (capped at `ambiguous`, see below); files whose only categories are capturing-device categories; files whose title says "taken with"; logo SVGs; die micrographs; **anything ambiguous** |
| Provenance | a source page that could not be resolved. An unavailable check is a stop, never a skip. |
| Media type | anything that is not JPEG, PNG or WebP. A correctly-licensed `.stl` mesh, PDF, vector logo or video of the right product is not a photograph of it. |
| Rights verification | NC/ND/all-rights-reserved; conflicting licence reads; **a licence readable only from generated metadata**; **an upload sourced from a video platform or social post without a confirmed licence review**; missing creator under an attribution licence; no primary licence evidence at all |
| Synthetic imagery | anything the source says was AI-generated, *however good the licence* |
| Quality floor | long edge under 800px |
| Duplicate reconciliation | the worse-evidenced of two copies of the same bytes; **both** copies when providers disagree about the licence |
| Ranking | nothing — it chooses among candidates already accepted, and records why the winner beat the runner-up criterion by criterion |
| Publication validation | asserts the proposed row is *not* publishable, and aborts if it is |

Ambiguity fails closed at every one of them.

## What it found: the eight blocked products, 2026-08-22

Every one was searched end to end. **Nothing was acquired, and that is the honest answer.**

| Product | Result | Why |
|---|---|---|
| TP-Link Deco XE75 | `no_results` | 14 queries, every one zero. The TP-Link category tree was walked in full. |
| TP-Link Deco BE85 | `no_results` | Same. No Wi-Fi 7 Deco of any model exists on Commons. |
| Roborock Saros 10R | `no_acceptable_candidate` | 26 candidates, all wrong product. |
| Amazon Echo Show 8 (4th Gen) | `no_acceptable_candidate` | 56 candidates — free text matched 19th-century newspaper PDFs, the same "light echo" class of nonsense Openverse produced. |
| Sony PlayStation 5 Pro | `no_acceptable_candidate` | 60 candidates, all wrong product. |
| NVIDIA GeForce RTX 5080 | `no_acceptable_candidate` | 60 candidates: a `.webm` B-roll, dozens of review-video frame grabs, and a bare-PCB composite of the 5080 *and* 5090. |
| AMD Ryzen 7 9800X3D | `no_acceptable_candidate` | 56 candidates; 48 refused on `licence_not_in_primary_source` + `third_party_relicence_unreviewed` — the ZMASLO/Geekerwan video frames. |
| Intel Core Ultra 9 285K | `no_acceptable_candidate` | 30 candidates; 3 `.stl` meshes refused on media type, the rest wrong product (including a Core Ultra 7 265K). |

Control, run identically against a product with known-good Commons photography:

| GoPro HERO13 Black | `resolved` | 60 examined, 8 cleared every gate — including the accented `Category:GoPro Héro 13 black` that a name search cannot reach. |

Those statuses are the legacy four-value vocabulary that run predated the outcome taxonomy. In
today's states the two TP-Link rows are `NO_RESULTS` and the six
`no_acceptable_candidate` rows resolve to `WRONG_ENTITY_RESULTS` (Roborock, Echo Show, PS5 Pro,
RTX 5080, Core Ultra 285K) and `RIGHTS_UNCERTAIN` (Ryzen 9800X3D). **The re-run is worth doing:**
the Ryzen row — 48 of 56 candidates refused on the same two codes — is close enough to the
uniform-refusal shape that it is exactly the sort of result the plausibility check exists to
make somebody look at, and the whole point of this change is that nobody has to notice it by
reading sixty candidate blocks.

The eight remain blocked **on photography, not on permission**, which is what
`docs/product-media-strategy.md` §3a concluded by hand. The engine reached the same conclusion
independently, from the same sources, with the working written down.

## Finding nothing is a result — and it has to prove it

The pipeline reports **one of seven states**, defined in
`src/lib/media/providers/outcome.ts` and printed at the top of every subject block in
`scripts/engine-media-search.ts`. They exist because the four statuses this section used to
describe were not fine-grained enough to distinguish "the material is unsuitable" from "our
parser is broken" — see the bug at the end of this document, which lived in exactly that gap.

| State | Means | Established by |
|---|---|---|
| `USABLE_CANDIDATE_FOUND` | at least one candidate cleared every automated check | an accepted evaluation, plus a proposed row the publication gate still refuses |
| `NO_RESULTS` | the provider was reached, understood, and genuinely has nothing | zero candidates **and** a `ProviderAttestation` showing responses parsed > 0, responses failed = 0, no parse anomalies |
| `WRONG_ENTITY_RESULTS` | candidates found, none is the exact subject | every refusal in the `entity` family — wrong model, `.stl` mesh, vector logo, AI render, below the quality floor |
| `RIGHTS_UNCERTAIN` | right subject, rights not establishable | a refusal whose blockers name the licence: absent, unrecognised, prohibitive, badge-only, conflicting, unreviewed third-party re-licence |
| `PROVENANCE_INCOMPLETE` | rights adequate, a required provenance field missing | blockers are exactly `creator_absent` / `source_page_absent` / `original_file_absent`, or the source page would not resolve |
| `PROVIDER_OUTAGE` | the provider could not be reached, or no approved provider existed | a non-answer status (`outage`, `rate_limited`), or nothing was searched at all |
| `PROVIDER_PARSE_FAILURE` | we got something we could not read, or read implausibly | a `malformed` response, a parse anomaly, a uniform parser-derived refusal, **or the classifier being unable to prove any other state** |

Three properties of that table are the whole point.

**1. `NO_RESULTS` is never a fallback.** It is reachable through exactly one branch, and that
branch demands positive proof: the provider answered, we counted the responses we parsed, none
failed, and no reader reported an implausible value. A provider that returns `ok` with an empty
array and cannot attest to a single response it read reports `PROVIDER_PARSE_FAILURE`, because
an empty shelf and a reader that never read anything are the same picture from the outside.
`SearchResult.attestation` (`src/lib/media/providers/types.ts`) is where that proof lives, and
the Commons provider fills it by routing every API call through one counted wrapper.

**2. A response we do not recognise is not an empty one.** `r.data.query?.search ?? []` was the
old shape of this failure: MediaWiki returns `query.search: []` for a search with no hits, so an
*absent* key is a body we do not understand. It is now recorded as a parse anomaly, and a search
carrying any anomaly cannot classify as `NO_RESULTS`.

**3. When the code cannot say which state applies, the answer is `PROVIDER_PARSE_FAILURE`.**
Not "no acceptable candidate", not "nothing found". Uncertainty about our own reading of a
response is a defect in us, and a reported defect is one somebody investigates.

The four legacy statuses (`resolved` / `no_acceptable_candidate` / `no_results` /
`provider_unavailable`) still exist and are still what the engine job and the admin surfaces
read, but they are now **derived** from the state above via `legacyStatusFor()` rather than
computed separately, so the coarse and the precise answer cannot drift apart. Both
`PROVIDER_PARSE_FAILURE` and `PROVIDER_OUTAGE` map to `provider_unavailable`, which the engine
job records **nowhere** as a candidate — a run whose reader may be broken must not deposit
"no source found" rows that are later read as evidence somebody looked.

### The plausibility check: one bug repeated does not look like a clean negative

`assessRefusalPlausibility()` asks a question no per-candidate check can: **if every single
candidate was refused for the same parser-derived reason, is that a fact about the world?**

Four or more candidates, none accepted, all sharing one refusal signature (rejection code plus
its blocker codes), and that code derived from parsing provider markup — `rights_conflicting`,
`rights_incomplete`, `unsupported_media_type`, `provenance_unresolvable` — is reported as
`PROVIDER_PARSE_FAILURE`, not as a clean negative. **This is what would have caught the 2026-08
bug automatically**: eight files in one category, eight identical `rights_conflicting`
refusals, one broken regex underneath all of them.

`entity_mismatch` is deliberately excluded. Sixty candidates all refused as the wrong product is
the normal, correct shape of a PlayStation 5 Pro search, and an alarm that fires on the ordinary
case is an alarm nobody reads — which is the same mistake as the ten false-alarm credit
comparisons recorded further down this document.

## Three rules the first live run forced, and what each cost

None of these were designed in advance. Each is a case where the engine returned a confident,
well-documented answer that a human reviewer had already rejected — the exact failure the
brief warned about, caught by running it rather than by reasoning about it.

**1. A licence readable only from generated metadata is now a blocker, not a warning.**
Searching for the AMD Ryzen 7 9800X3D returned dozens of files tagged `CC BY 3.0` where the
licence appeared only in `extmetadata` and nowhere in the file's own markup. They were video
frame-grabs from the ZMASLO and Geekerwan YouTube channels — the same files
`docs/product-media-strategy.md` §6 records a reviewer rejecting, because that CC claim rests
on a channel-wide licence toggle re-asserted by a third-party uploader. The engine accepted
them. This module's whole claim is that it reads the primary declaration rather than a
rendered badge, and it was not honouring that claim where it mattered most.

The cost is real and accepted: this also refuses legitimate files whose licence template the
parser does not yet recognise. That is the correct direction — the fix for a parsing gap is to
add the pattern, which is visible and reviewable; the fix for a trust gap is nothing at all.
Four template forms were added in the same change after checking which files the new rule
would have wrongly refused.

**2. An upload sourced from a video platform or social post is refused unless a licence review
confirmed it.** Generalised from the same finding, and directly from the brief: Google/Bing
Images, Pinterest, Reddit, retailer listings, YouTube frames and social posts are not
reusable-image libraries.

**3. Media type is now a gate.** Searching for the Intel Core Ultra 9 285K accepted three
candidates and **all three were `.stl` files** — 3D-printable meshes of the processor. Right
product, CC0, entity confidence high, not a photograph in any sense. Commons is a media
repository, not an image library: it holds STL, PDF, SVG, OGV and MIDI, and every one of them
can carry an impeccable licence.

**4. Video frames and wrong-subject shots sink on identity, not on rights.** The RTX 5080
search accepted 60 of 60 candidates, and they were: a `.webm` B-roll clip, dozens of PNG frame
grabs titled `RTX 5080 FE首发评测：赛博工艺品 (2160p 60fps VP9-128kbit AAC)-00.01.24.019.png`, and
`Nvidia RTX 5080 5090 FE PCB.png` — a bare circuit board, of two cards at once. Titles carrying
a timecode, frame rate, codec or "B-roll" now score -0.6, and `pcb` / `die` / `micrograph` /
`logo` / `teardown` / `screenshot` moved from -0.3 to -0.5. A reader arriving at a
graphics-card page expects a graphics card.

## Re-verification: the library was re-checked, and it is clean

`--reverify` re-resolves every asset in the library against its source and runs
`detectRightsDrift()`. Run against production on 2026-08-22: **39 assets carry a source URL,
all 39 are Commons files, and not one has lost the licence it was recorded with.**

The first run of it reported **ten INVALIDATED assets**, and every one was a false alarm. The
comparison was strict string equality on the creator, and the ten differences were of this
shape:

| stored credit | current source field |
|---|---|
| `CEphoto / Uwe Aranas` | `CEphoto, Uwe Aranas` |
| `Mlogic (Yan Li)` | `Mlogic` |
| `Kārlis Dambrāns` | `Kārlis Dambrāns from Latvia` |
| `Ashley Pomeroy` | `Ashley Pomeroy ( talk ) at en.wikipedia` |
| `Gode Nehler` | `GodeNehler` |
| `François Leblond (User:François de Dijon)` | `François de Dijon` |

Not one is a different photographer. The stored value is a human tidying a location or a wiki
link out of a rendered credit line, which is the correct thing to have done. **Ten false alarms
is not a cautious system; it is a system whose warnings nobody will read the day a real one
appears.** `compareCredits()` now folds diacritics, drops wiki noise words and URLs, and
compares token sets — a name-form difference is a warning, only a genuinely different person is
a blocker. All ten pairs above are regression tests.

## Proving the acquisition path without writing anything

`--dry-acquire` runs every step that can be run without a write: resolve, build the thumbnail
URL, download, measure the real pixels out of the bytes, SHA-256 them, build the row, and put
it through the publication gate. It exists because the alternative way to test acquisition is
to run it against production and clean up afterwards, and a cleanup that goes wrong deletes
somebody's evidence.

It immediately earned itself. The download failed with

> HTTP 400 `Use thumbnail sizes listed on https://w.wiki/GHai`

for two independent reasons: `imageinfo` now appends analytics parameters to the file URL
(`?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&…`), which a naive
`split("/").pop()` planted in the middle of the constructed path; and Commons no longer serves
arbitrary thumbnail widths, so the 1600px the earlier import requested is now rejected outright
— it had only ever worked because Commons silently served the 1920 bucket instead, which is the
same discrepancy that recorded four rows' dimensions 20% too small.

After the fix, on `GoPro HERO13 Black`:

```
Downloaded 87344 bytes, 1920x1281, sha256:bd48e3617d297ddd…
DRY ACQUIRE — nothing written.
  would insert rights_status='pending_verification' publication_status='private' owned=false
  licence='CC BY-SA 4.0' creator='François de Dijon'
  publication gate: refused (Usage rights for this asset haven't been verified…)
```

## A bug worth recording, because of how it hid

The first live run rejected all eight files in `Category:GoPro Hero 13 black` as
`rights_conflicting`. The cause was a regex: `informationField()` looked ahead for the next
field as `\n|<name>=` with `<name>` matching `[a-zA-Z_]+`, which does not match
`other versions` — the space. So `permission=` captured the literal text `|other versions=`,
the pipeline saw a populated permission field, and refused four perfectly good CC BY-SA 4.0
photographs.

It failed in the safe direction, and that is exactly why it was nearly invisible: the summary
line read "candidates were found and every one was rejected", which is indistinguishable from
a genuinely unusable set. Only the per-candidate reason showed that the search had worked and
the parser had not. **A fail-closed system still has to be right, or it fails closed on
everything.**

Three defences now exist, and the third is the one that generalises:

1. **The regex is correct**, and there is a test for a field name containing a space.
2. **The extracted value is checked for the signature of having been extracted wrongly.**
   `fieldValueAnomaly()` asks whether a permission field could plausibly say what it says: a
   `|name=` at brace depth zero inside a value means a neighbouring field was swallowed, and an
   unbalanced `{{` means the value was cut mid-template. Depth matters — a legitimate
   `{{fr|1=Caméra GoPro}}` contains `|1=` and is fine. The regression test feeds it the exact
   string the old parser produced, `|other versions=`, so if that bug ever returns it fires on
   its output. An ambiguous field makes `resolve()` return `malformed`, which becomes
   `PROVIDER_PARSE_FAILURE` — a refusal that says *fix this parser*, not *read this file's
   permission note*.
3. **The outcome is checked for being one bug repeated.** Even if 1 and 2 both fail, a whole
   search refused for a single parser-derived reason reports `PROVIDER_PARSE_FAILURE` rather
   than a clean negative. See the plausibility rule above.

## A second bug of the same family: a photograph of two products

Found by adversarial testing on 2026-08-22, in `entity-match.ts` rather than in a parser, and
worth recording beside the one above because the failure direction is the opposite and the
lesson is identical.

`assessEntityMatch()` hard-rejects a title carrying a foreign model number — *unless* this
product's own discriminators are in the title too, in which case the rejection was downgraded
to a -0.05 nudge on the reasoning that the extra number is probably a sequence number ("(03)")
or a resolution ("2160p"). That reasoning is correct for those cases and wrong for the one
that matters:

| File | Was | Now |
|---|---|---|
| `File:NVIDIA GeForce RTX 5080 and RTX 5090 side by side.jpg` | confirmed **0.99 for the 5080 *and* 0.99 for the 5090** | ambiguous 0.74 for both |
| `File:Intel Core Ultra 9 285K and Core Ultra 7 265K.jpg` | confirmed **1.00 for both chips** | ambiguous 0.74 for both |
| `File:Nvidia RTX 5080 5090 FE coolers.png` | confirmed 0.99 | ambiguous 0.74 |
| `File:RTX 5070 5080 5090 lineup.jpg` | confirmed 0.80 | rejected 0.05 |

The real production trap named in `docs/product-media-strategy.md`,
`File:Nvidia RTX 5080 5090 FE PCB.png`, failed closed **only by luck**: the word "pcb" carries
-0.5, which dragged it into the ambiguous band. Change one word — as the "coolers" variant of
the identical two-card frame shows — and it confirmed at 0.99. The consequence would have been
one image published on two product pages, each caption implying it depicts that product, which
is a false claim about a product.

A foreign number is now treated as a **sibling model** when it has the same digit width as one
of our own model numbers (5090 against 5080, 265 against 285) or when it is led by the same
alphabetic token that leads ours ("HERO9" beside "HERO13", "Ultra 7" beside "Ultra 9"). Such a
title is capped at `MULTI_PRODUCT_CEILING`, one hundredth below the confirmation threshold, so
it can never confirm however good everything else looks. The cap is applied to the confidence
NUMBER and not only to the verdict, so no future re-weighting can lift a composite back over
the line. `File:2024 Dron DJI Mini 4 Pro (03).jpg`, `File:GoPro Héro 13 Black - 01.jpg` and a
PS5 Pro photographed "with 2 controllers" all still confirm — the fix distinguishes a sibling
model from a quantity, a date and a sequence number rather than refusing every extra digit.
