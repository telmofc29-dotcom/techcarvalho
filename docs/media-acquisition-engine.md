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
| Embedded rights metadata | EXIF `Artist` and `Copyright` via `commonmetadata` |
| Content hash | `imageinfo sha1` of the original, plus SHA-256 of the bytes on acquisition |
| Dimensions, MIME, byte size | `imageinfo` |

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
| Entity validation | wrong model number in the title; files whose only categories are capturing-device categories; files whose title says "taken with"; logo SVGs; die micrographs; **anything ambiguous** |
| Provenance | a source page that could not be resolved. An unavailable check is a stop, never a skip. |
| Media type | anything that is not JPEG, PNG or WebP. A correctly-licensed `.stl` mesh, PDF, vector logo or video of the right product is not a photograph of it. |
| Rights verification | NC/ND/all-rights-reserved; conflicting licence reads; **a licence readable only from generated metadata**; **an upload sourced from a video platform or social post without a confirmed licence review**; missing creator under an attribution licence; no primary licence evidence at all |
| Synthetic imagery | anything the source says was AI-generated, *however good the licence* |
| Quality floor | long edge under 800px |
| Duplicate reconciliation | the worse-evidenced of two copies of the same bytes; **both** copies when providers disagree about the licence |
| Ranking | nothing — it chooses among candidates already accepted, and records why the winner beat the runner-up criterion by criterion |
| Publication validation | asserts the proposed row is *not* publishable, and aborts if it is |

Ambiguity fails closed at every one of them.

## Finding nothing is a result

The pipeline reports four statuses and they are deliberately not interchangeable:

- `resolved` — a candidate cleared every gate.
- `no_acceptable_candidate` — candidates were found and every one was refused. **The search
  worked and the material is unsuitable.**
- `no_results` — every query ran successfully and returned nothing. Blocked on photography,
  not on permission; worth a scheduled recheck, not a negotiation.
- `provider_unavailable` — **the search did not happen.** Never recorded as a candidate row,
  never counted as "nothing found". This is the 2026-08 empty-vs-failed lesson from CLAUDE.md
  applied to searches instead of queries.

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
everything.** There is now a test for a field name containing a space.
