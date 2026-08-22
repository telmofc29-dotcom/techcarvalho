# Engine source registry — diversity and the promotional problem

Updated 2026-08-22. Companion to `src/lib/engine/promotional.ts` and
`src/lib/engine/jobs/brief-job.ts`.

## The problem this records

On 2026-08-22 the engine had produced 16 briefs. **Every one was a manufacturer
press release**, and several were not about consumer technology at all:

- "Pre-order Call of Duty: Modern Warfare 4 and Play the Beta Today"
- "Get closer to the game with Gemini and Pixel"
- "Free Play Days – Train Sim World 6, Icarus: Console Edition"
- "Universitas Gadjah Mada, Indosat and NVIDIA Open Indonesia's First University
  AI Center to Develop Local AI Talent"
- "Firebird Launches CIS Region's Largest AI Factory in Armenia"

The cause was structural, not a bug. **All four active sources were vendor
newsrooms** — Google, Intel, Xbox and NVIDIA. A newsroom publishes marketing
alongside news, and the brief builder took the vendor's headline verbatim as
the proposed article title. The review queue was a stack of press releases
waiting to be reprinted.

## Two independent fixes

### 1. Vendor newsrooms stay, as evidence

Manufacturer newsrooms remain active and remain `trust_level = primary`. A
vendor is the most reliable source for what that vendor is doing, and that is
exactly what primary evidence means.

What changed is that a promotional discovery no longer becomes an *article*.
`brief-job.ts` classifies before creating a brief and skips promotional ones.

**The discovery and its evidence are untouched.** Verified against production:

| Rejected brief | Discovery | Evidence |
|---|---|---|
| "Pre-order Call of Duty: Modern Warfare 4…" | present, `relevant` | 1 row, `confirmed_primary` / `primary` |
| "Keep your SAT prep on track with… Gemini." | present, `relevant` | 1 row, `confirmed_primary` / `primary` |
| "Best in Class: Stream PC Games…" | present, `relevant` | 1 row, `confirmed_primary` / `primary` |

So a press release announcing a real product is still available to corroborate
a future article. It just cannot become one by itself.

### 2. Source diversity

| | Before | After |
|---|---|---|
| Sources in registry | 19 | **29** |
| Active feeds | 4 | **13** |
| Active vendor newsrooms | 4 (100%) | 4 (31%) |
| **Active non-vendor** | **0** | **9 (69%)** |
| With `media_republication_permitted` | 0 | **0** |

## Active sources

| Organisation | Categories | Trust | Why |
|---|---|---|---|
| Google, Intel, Microsoft Xbox, NVIDIA | various | primary | Vendor newsrooms — primary evidence for their own announcements |
| NASA | astrophotography | primary | Space agency; genuinely fresh (daily) |
| ESA | astrophotography | primary | Complements NASA |
| DPReview | cameras, action cameras | **secondary** | Independent camera journalism |
| Mozilla | computing, AI | primary | Open-source foundation; non-vendor voice |
| Raspberry Pi | computing | primary | Genuine engineering posts |
| Arduino | computing | primary | Open hardware |
| Home Assistant | smart home | primary | Non-vendor voice on Matter and local control |
| VESA | computing | primary | Display standards (DisplayPort, DisplayHDR) |
| Bluetooth SIG | networking, smart home | primary | Bluetooth standards |

**DPReview is deliberately `secondary`.** An editorial outlet is not a primary
source for a manufacturer's own facts. Secondary trust means it cannot reach
`confirmed_primary` in the confidence engine and cannot corroborate itself —
which is the point. It was added because the Cameras category (13 published
articles) had no non-vendor source at all.

Standards bodies are checked weekly (`check_frequency_hours = 168`) rather than
daily. They publish infrequently by nature; infrequent is not stale.

## Candidates probed and rejected

Every source was fetched and parsed before being added, and its newest item
checked for staleness. These were rejected on evidence:

| Candidate | Reason |
|---|---|
| USB-IF | **2,943 days stale** — newest item was CES 2019. Dead feed. |
| Wi-Fi Alliance | 72 days, and content is member meetings, not news |
| ESA/Hubble (feedburner) | 236 days stale — the general ESA feed was used instead |
| Steam / Valve news | Repetitive Team Fortress 2 patch notes; low editorial value |
| CPSC recalls | 404 on both documented feed URLs |
| FCC | 403 |
| UK ASA | 404 |
| ESO, NOIRLab, Linux Foundation, CIPA | 404 |
| Khronos | Parsed empty |
| Blender | 39 days; 3D software, off-topic |
| **IETF** | **Added, then deactivated after measurement.** All 6 most recent posts scored 0 or below: NOC lead appointments, secretariat restructuring, community surveys, Birds of a Feather sessions. Standards are published as RFCs, not via this blog. Kept in the registry as a recorded negative so it is not re-added by the same reasoning. |
| W3C, LWN | Reachable and fresh, but web-standards and kernel-niche rather than consumer tech |
| EFF, Signal | Reachable and fresh, but policy/privacy-heavy; would need heavy filtering |

Consumer-safety recalls would be a genuinely high-value addition — the
relevance engine already weights `recall` at 9 — but **no reachable recall feed
was found.** Worth revisiting.

## Standing rules

- `media_republication_permitted` is `false` on all 29 rows. Discovery is not
  permission, and no source here has been checked for image rights.
- Relevance and promotional are **different axes**. "Intel Gamer Days 2026" is
  genuinely consumer-gaming relevant *and* promotional, so one classifier
  cannot do both jobs.
- The promotional classifier flags copy written to sell rather than to inform.
  It does not decide a topic is uninteresting — a real launch announced in a
  press release is still a real launch.

## Relevance vocabulary was measured against these sources

Adding non-vendor sources exposed that the relevance classifier had been tuned
entirely on vendor product PR. Measured against real feed titles, it scored
genuine category news at zero and rejected it:

| Headline | Before | After |
|---|---|---|
| "VESA Introduces DisplayHDR True Black 1400…" | 0 · rejected | 5 · relevant |
| "VESA Elevates PC and Laptop HDR Display Performance…" | 20 · relevant | 25 · relevant |
| "A total solar eclipse is coming to Europe" | 4 · uncertain | 11 · relevant |
| "FireAvert joins Works with Home Assistant" | 14 · relevant | 19 · relevant |

The whole VESA feed went from **2 of 6 relevant to 6 of 6**. Four vocabulary
groups were added: observable sky events, astronomy subjects and gear, display
technology, and smart-home ecosystem.

Two guards accompany it. Organisational posts from the *same* good sources must
stay rejected ("Meet our new IETF NOC Lead", "Raspberry Pi Book of Making
2027", "Community Day 2026: Save the date!"), and the earlier B2B/corporate
rejections must still hold ("Intel Announces Upsize and Pricing of $20 Billion
Common Stock Offering"). Both are permanent regression tests.

One case was deliberately **not** forced: "Fly around Schiaparelli Crater with
Mars Express" scores 0 on its title alone. A Mars orbiter flyover is space news
rather than astrophotography a reader can act on, and stretching the vocabulary
to catch it would start pulling in general space-agency PR.
