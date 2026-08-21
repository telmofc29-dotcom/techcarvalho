// Canon EOS R system comparisons + two DSLR-crossover/generation comparisons,
// plus a standalone sensor-size explainer. Every spec cited below is read
// directly from data/catalogue/canon-eos-r-full-frame.ts,
// data/catalogue/canon-eos-r-aps-c.ts, data/catalogue/canon-eos-r5.ts,
// data/catalogue/canon-eos-6d.ts, and data/catalogue/canon-eos-xxd.ts —
// nothing here is recalled from memory or asserted beyond what those files'
// `specs` arrays actually contain. Where a source spec entry doesn't state
// something (e.g. R10's screen dot count, R's exact 4K crop factor), this
// file says so explicitly rather than guessing.
//
// "canon-eos-r-vs-rp" is the EOS R system pillar per
// docs/content-launch-plan.md (Tier 2 table marks it "Pillar: EOS R guide"
// while the R5-vs-R6 and R10-vs-R7 rows are marked "Supporting") — mirrors
// how canon-dslr-buying-guide anchors the DSLR cluster in
// canon-dslr-cluster.ts. canon-6d-vs-6d-mark-ii and canon-90d-vs-eos-r10
// are wired supporting_of canon-dslr-buying-guide instead, matching how
// canon-70d-80d-90d-generation-differences and
// dslr-vs-mirrorless-real-tradeoffs already relate to that same pillar.
// sensor-size-explained-crop-vs-full-frame is deliberately left unlinked to
// any pillar — general optics reasoning, not specific to one product line
// or cluster, same treatment as do-you-need-4k-8k-video in
// old-vs-new-tech.ts.

import type { ContentBatchImport } from "@/lib/content/import-types";

const CATEGORY = "cameras-photography";

export const canonEosRCluster: ContentBatchImport = {
  content: [
    {
      slug: "canon-6d-vs-6d-mark-ii",
      title: "Canon 6D vs 6D Mark II: Is the Upgrade Actually Worth It",
      type: "comparison",
      status: "published",
      categorySlug: CATEGORY,
      searchIntent: "commercial",
      primaryQuery: "canon 6d vs 6d mark ii",
      intentFingerprint: "canon-6d-vs-6d-mark-ii",
      tagSlugs: ["canon", "dslr", "comparison"],
      metaTitle: "Canon 6D vs 6D Mark II: Is the Upgrade Worth It?",
      metaDescription:
        "What actually changed between Canon's original entry-level full-frame DSLR and its 2017 successor — autofocus, screen, ISO — and the video limit that didn't move.",
      linkedProducts: [
        { productSlug: "canon-eos-6d", role: "primary_subject" },
        { productSlug: "canon-eos-6d-mark-ii", role: "primary_subject" },
      ],
      relatedContent: [{ relatedSlug: "canon-dslr-buying-guide", type: "supporting_of" }],
      body: `Canon's entry point into full-frame DSLRs got a five-year gap between the original 6D (2012) and the 6D Mark II (2017). Five years is a long time in camera development, and most of what changed in that gap shows up in one specific area — autofocus — while one area that a lot of buyers expect to have moved genuinely didn't.

## Autofocus: the biggest jump on this list, by far

The original 6D shipped with an 11-point AF system, only one of which was cross-type, centered and sensitive down to -3 EV — genuinely good for that single center point in low light, but sparse everywhere else in the frame. The 6D Mark II replaced this with 45 points, all cross-type, with the center point sensitive to -3 EV at f/2.8. That's not an incremental refinement — it's a completely different AF system, with far more usable coverage away from dead-center and much more reliable performance on anything not perfectly centered in the frame.

## Resolution, ISO ceiling, and burst rate

The 6D's 20.2MP sensor gave way to 26.2MP on the Mark II — a real but modest resolution gain. ISO ceiling moved more: 100-25600 native (expanded to 102400) on the original 6D versus 100-40000 native (also expanded to 102400 at the top end) on the Mark II. Burst rate went from 4.5fps to 6.5fps — still not a fast-action camera by any modern standard, but a meaningful step for anything beyond static subjects.

## Screen and connectivity

The original 6D's 3.0in rear screen is fixed, non-touch. The Mark II's is a vari-angle touchscreen — a genuinely different, more flexible shooting experience for low or high angles, tripod work, or video framing. Connectivity moved from Wi-Fi (plus GPS on the separate WG variant) to Wi-Fi, Bluetooth, and NFC on the Mark II, making phone pairing considerably less fiddly.

## The video ceiling that didn't move

Here's the part that surprises people checking the spec sheet cold: despite five years and two full sensor/processor generations between them, the 6D Mark II still tops out at 1080p video — its only 4K capability is a 4K time-lapse mode, not actual 4K video recording. If 4K video matters to you at all, neither of these bodies gets you there, and it's worth knowing that going in rather than assuming a 2017 camera automatically covers it.

## Who should actually buy the original 6D

Someone prioritizing price above almost everything else, shooting mostly static subjects — landscapes, architecture, tripod-based portraiture — where a single strong center AF point does most of the real work anyway.

## Who should buy the 6D Mark II

Anyone who'll shoot handheld or with any subject movement, where the 45-point AF coverage genuinely changes your keeper rate. Anyone who wants a vari-angle screen for video or awkward angles. Anyone who'll actually use Bluetooth/NFC phone pairing day to day.

## The honest bottom line

This is a real, meaningful upgrade in exactly one area — autofocus — plus useful but secondary gains in ISO ceiling, burst rate, and screen flexibility. It is not an upgrade in video capability at all, which is worth sitting with before assuming five years automatically bought you more.`,
    },
    {
      slug: "canon-90d-vs-eos-r10",
      title: "Canon 90D vs Entry Mirrorless: Which Should You Actually Buy",
      type: "comparison",
      status: "published",
      categorySlug: CATEGORY,
      searchIntent: "commercial",
      primaryQuery: "canon 90d vs r10",
      intentFingerprint: "canon-90d-vs-r10",
      tagSlugs: ["canon", "dslr", "mirrorless", "comparison"],
      metaTitle: "Canon 90D vs EOS R10: Which Should You Actually Buy?",
      metaDescription:
        "Canon's last major APS-C DSLR against a current entry-level APS-C mirrorless body — autofocus generation, battery life, weather sealing, and lens ecosystem compared.",
      linkedProducts: [
        { productSlug: "canon-eos-90d", role: "primary_subject" },
        { productSlug: "canon-eos-r10", role: "primary_subject" },
      ],
      relatedContent: [{ relatedSlug: "canon-dslr-buying-guide", type: "supporting_of" }],
      body: `The 90D (2019) is the last major statement in Canon's APS-C DSLR line before its development attention moved fully to mirrorless. The R10 (2022) is a current-generation entry-level APS-C mirrorless body, positioned as the lighter, cheaper sibling to the R7. Both are realistically buyable today, which makes this a genuine live decision rather than an abstract "old vs new" exercise — see our general DSLR vs mirrorless trade-offs guide for the structural version of this same choice.

## Resolution and autofocus: a counterintuitive gap

The 90D actually has more resolution — 32.5MP against the R10's 24.2MP — which runs against the usual assumption that newer means higher-resolution. Where the R10 pulls ahead is autofocus generation: the 90D pairs 45 cross-type AF points in the viewfinder with 5,481 phase-detect points in live view via Dual Pixel CMOS AF, while the R10 runs Dual Pixel CMOS AF II across 651 zones — a full autofocus generation newer, even on the lower-resolution body.

## Burst rate

90D: 10fps mechanical, 7fps electronic. R10: 15fps mechanical, 23fps electronic. The R10 is meaningfully faster, especially on the electronic-shutter ceiling.

## Battery life — a dramatic number that needs context

The 90D is CIPA-rated for 1,300 shots per charge; the R10 for 350. That gap looks alarming in isolation, but it's not really about battery capacity — it's the same structural difference covered in our DSLR vs mirrorless guide: an optical viewfinder draws essentially no power, while a mirrorless EVF and continuously-active sensor draw power the entire time the camera is on. Budget for spare batteries with the R10 in a way you likely wouldn't with the 90D.

## Weather sealing and body weight

The 90D's specs confirm weather sealing; the R10's confirmed specs don't list it. The 90D also weighs more (701g vs 426g) — a substantial grip and body against a noticeably lighter one, which cuts differently depending on whether you want heft or portability.

## Video

Both do 4K UHD at 30p without a crop. The 90D adds uncropped 1080p up to 120p; the R10 adds a higher-frame-rate 4K option (up to 59.94fps) but only with a sensor crop at that rate. Broadly comparable at the headline 4K30 level, with each body offering something the other doesn't past that.

## Lens ecosystem — the part the spec sheet won't tell you

The 90D uses Canon's EF-S mount, backed by two decades of EF/EF-S lenses, a large share of them inexpensive on the used market. The R10 uses the newer RF mount, whose native lineup is still growing and generally costs more new — though EF/EF-S lenses adapt onto RF bodies via Canon's own adapter, so an R10 buyer isn't locked out of that older, cheaper glass, just adding an adapter into the chain.

## Who should actually buy which

The 90D: buyers who want long battery life, confirmed weather sealing, and access to the cheapest available used lens market, and who are comfortable with an optical viewfinder. The R10: buyers who want a current-generation autofocus system and Canon's ongoing RF lens development, don't mind carrying spare batteries, and want the lighter body.

## The honest bottom line

Neither camera is simply "better" — the 90D wins on battery life, weather sealing, and lens-market price; the R10 wins on autofocus generation and burst rate. Which one is right depends on whether autofocus performance or all-day battery/weather resilience matters more for what you actually shoot.`,
    },
    {
      slug: "canon-eos-r-vs-rp",
      title: "Canon EOS R vs RP: Canon's First Full-Frame Mirrorless Bodies Compared",
      type: "comparison",
      status: "published",
      categorySlug: CATEGORY,
      searchIntent: "commercial",
      primaryQuery: "canon eos r vs rp",
      intentFingerprint: "canon-eos-r-vs-rp",
      tagSlugs: ["canon", "mirrorless", "comparison"],
      metaTitle: "Canon EOS R vs RP: Canon's First Full-Frame Mirrorless Bodies",
      metaDescription:
        "Canon's original full-frame RF mirrorless body against the smaller, cheaper RP that followed five months later — viewfinder, burst rate, battery, and video crop compared.",
      linkedProducts: [
        { productSlug: "canon-eos-r", role: "primary_subject" },
        { productSlug: "canon-eos-rp", role: "primary_subject" },
      ],
      body: `The EOS R (September 2018) was Canon's first full-frame mirrorless camera and the debut of the RF lens mount, launched at $2,299. The EOS RP followed just five months later at $1,299 — a deliberately smaller, cheaper entry point rather than a direct successor. Understanding it as a price-tier split, not a generational one, makes most of the spec differences below make immediate sense.

## Viewfinder: the difference you'll notice before any spec sheet

The R's EVF is a 3.69-million-dot OLED unit at 0.76x magnification. The RP's is 2.36 million dots at 0.70x — a visibly lower-resolution, smaller-feeling viewfinder image. This is exactly the kind of spec that reads as a minor number difference on paper and is obvious the moment you actually look through both.

## Resolution, autofocus, and burst rate

The R carries a 30.3MP sensor with Dual Pixel CMOS AF and Eye Detection AF explicitly listed in its specs. The RP's 26.2MP sensor also runs Dual Pixel CMOS AF, with 4,779 manually selectable points — its confirmed spec entry doesn't separately call out Eye Detection AF the way the R's does, though both share the same underlying Dual Pixel CMOS AF foundation. Burst rate is a clearer gap: 8fps on the R versus 5fps on the RP, worth flagging for anyone photographing any kind of movement.

## Battery and size

The R uses the LP-E6N, the same higher-capacity battery family shared across much of Canon's DSLR line, and weighs 580g. The RP uses the smaller LP-E17 — the same battery as Canon's Rebel-series DSLRs — and weighs 440g, a real and noticeable difference in hand and in a bag, at the cost of shooting stamina per charge.

## Video: both crop for 4K, one much more severely

The R records 4K at 30fps with a sensor crop (the exact crop factor isn't stated in confirmed spec data for the R). The RP's 4K is capped at 23.98fps with a documented 1.7x crop — a genuinely severe crop that narrows the field of view considerably and works against low-light video performance. Don't assume "both do 4K" means comparable 4K; the RP's is the more compromised of the two.

## Price positioning explains most of the rest

A $1,000 gap at launch isn't small, and it accounts for nearly everything above — the smaller battery, the lower-resolution EVF, the slower burst rate. None of it makes the RP a bad camera; it's what Canon removed to hit a meaningfully lower price point for buyers moving into full-frame RF for the first time.

## Who should pick which

The R: stills-focused shooters who'll spend real time looking through the viewfinder and want the faster burst rate. The RP: anyone entering full-frame RF on a tighter budget, travel and lightweight setups, or an APS-C upgrader who wants full-frame image quality without paying for best-in-class AF or burst performance.

## The honest bottom line

These are Canon's two entry points into full-frame RF mirrorless, five months and $1,000 apart, and the spec gaps track that price gap closely rather than representing one camera simply outclassing the other.`,
    },
    {
      slug: "canon-eos-r5-vs-r6",
      title: "Canon EOS R5 vs R6: Which Full-Frame R Body Do You Need",
      type: "comparison",
      status: "published",
      categorySlug: CATEGORY,
      searchIntent: "commercial",
      primaryQuery: "canon eos r5 vs r6",
      intentFingerprint: "canon-eos-r5-vs-r6",
      tagSlugs: ["canon", "mirrorless", "comparison"],
      metaTitle: "Canon EOS R5 vs R6: Which Full-Frame R Body Do You Need?",
      metaDescription:
        "Resolution, video ceiling, and the ISO advantage that actually favors the cheaper R6 — a spec-by-spec look at Canon's two July 2020 full-frame flagships.",
      linkedProducts: [
        { productSlug: "canon-eos-r5", role: "primary_subject" },
        { productSlug: "canon-eos-r6", role: "primary_subject" },
      ],
      relatedContent: [{ relatedSlug: "canon-eos-r-vs-rp", type: "supporting_of" }],
      body: `The R5 and R6 launched the same day in July 2020, at $3,899 and $2,499 respectively — a genuine $1,400 gap. That's not a simple better/worse hierarchy; Canon split these two bodies deliberately into a resolution-and-video flagship and a speed-and-low-light body, and most of what separates them traces back to that split.

## Resolution: the headline difference everything else follows from

The R5's 44.8MP sensor is more than double the R6's 20.1MP. This isn't just a print-size number — it directly drives the video capability, storage demands, and buffer behavior discussed below.

## Video ceiling, including a real caveat on the R5

The R5 records 8K RAW at 29.97fps and 4K up to 119.9fps — but its own spec data includes a documented limit of approximately 20 minutes of 8K recording before thermal shutdown on the base R5, a real-world constraint worth knowing rather than a hypothetical one. The R6 tops out at 4K up to 59.94fps with no 8K mode at all, a ceiling that also means it isn't pushing the same data throughput that produces the R5's thermal limit in the first place.

## Autofocus: both dense, worth reading carefully

The R5's specs list 5,940 selectable AF points; the R6's list 1,053 — both cover 100% of the frame according to their own spec sheets. The point-count gap is often cited as proof the R5 autofocuses better, but a higher point count alone doesn't necessarily translate to meaningfully better real-world tracking — both share the same DIGIC X-generation Dual Pixel CMOS AF II system, and treating the R5 as simply "smarter" at autofocus because its spec sheet lists more points overstates what that specific number confirms.

## ISO and low light: where the cheaper body actually wins

Counterintuitively, the R6 has the higher expanded ISO ceiling — up to 204800, against the R5's 102400. This is a direct consequence of the R6's larger individual pixels at lower resolution gathering more light each. If low-light stills performance matters more to you than resolution, this is a genuine point in the R6's favor, not just a consolation spec for the cheaper body.

## Viewfinder and storage

The R5's EVF is a 5.76-million-dot unit with 120fps refresh — meaningfully sharper and smoother than the R6's 3.69-million-dot EVF. Storage follows the same split: the R5 uses a CFexpress slot alongside SDXC (CFexpress being necessary to sustain its highest-bitrate 8K modes), while the R6 uses dual SDXC UHS-II slots — cheaper, more flexible media that can't sustain the R5's top modes.

## Where they don't differ

Both share 5-axis in-body stabilization rated to 8 stops, and the same 12fps mechanical / 20fps electronic burst ceiling — despite the price and resolution gap, Canon didn't hold either of those back on the R6.

## Who should pick which

The R5: video-first shooters who need 8K or high-frame-rate 4K, high-resolution stills for large prints or heavy cropping, and anyone prepared to shoot on CFexpress media. The R6: stills-focused shooters who value low-light performance and faster, cheaper file workflows over resolution, anyone not planning to shoot 8K, and — the honest budget case — anyone for whom the $1,400 difference is better spent on lenses.

## The honest bottom line

This isn't "R5 better, R6 cheaper" — the R6 genuinely outperforms the R5 in expanded ISO ceiling, and matches it on stabilization and burst rate. The real decision is resolution and video ceiling versus low-light stills performance and cost, not a straightforward hierarchy.`,
    },
    {
      slug: "canon-eos-r10-vs-r7",
      title: "Canon R10 vs R7: Canon's APS-C Mirrorless Lineup Explained",
      type: "comparison",
      status: "published",
      categorySlug: CATEGORY,
      searchIntent: "commercial",
      primaryQuery: "canon r10 vs r7",
      intentFingerprint: "canon-r10-vs-r7",
      tagSlugs: ["canon", "mirrorless", "comparison"],
      metaTitle: "Canon R10 vs R7: Two Tiers of the Same APS-C Generation",
      metaDescription:
        "Why the R10 and R7 aren't a generational succession, and the one spec — in-body stabilization — that matters more than everything else on this comparison.",
      linkedProducts: [
        { productSlug: "canon-eos-r10", role: "primary_subject" },
        { productSlug: "canon-eos-r7", role: "primary_subject" },
      ],
      relatedContent: [{ relatedSlug: "canon-eos-r-vs-rp", type: "supporting_of" }],
      body: `Canon announced the R10 and R7 on the same day — 24 May 2022 — as two tiers of one APS-C mirrorless generation, not a succession from one to the other. The R7 launched at $1,499, the R10 at $979.99. Treating this as "which is the better camera" misses the point; Canon built these to serve different buyers simultaneously, and the spec gaps reflect that.

## In-body stabilization: the single biggest functional gap on this list

The R7 has 5-axis in-body stabilization rated to 7 stops. The R10 has none — lens-based stabilization only. Of everything compared below, this is arguably the most consequential difference for handheld shooting in low light or with lenses that don't have their own stabilization.

## Resolution and burst rate

The R7's 32.5MP sensor sits well above the R10's 24.2MP. Mechanical burst rate is actually identical at 15fps for both; the real gap is on the electronic shutter, where the R7 reaches 30fps against the R10's 23fps.

## Autofocus tracking detail

The R7's confirmed specs explicitly document human/animal/vehicle subject tracking across 651 automatic zones and 5,915 total AF points. The R10's confirmed specs list the same core Dual Pixel CMOS AF II system across 651 focus zones, without the same explicit tracking-mode detail recorded for that product. Both bodies run the same underlying AF generation — the difference here is what's confirmed in each product's own spec data, not necessarily a difference in the underlying feature set.

## Build: viewfinder, screen, weather sealing, storage

The R7's EVF sits at 1.15x magnification against the R10's 0.95x — a noticeably larger apparent image. The R7's rear screen resolution is documented at 1.62 million dots; the R10's confirmed specs list a fully articulating touchscreen without a stated dot count. The R7 has dual SDXC UHS-II card slots and confirmed weather sealing; the R10 has a single SDXC UHS-II slot, with no weather sealing listed in its confirmed specs.

## Weight and price

The R7 weighs 530g at $1,499. The R10 weighs 426g at $979.99 — over $500 cheaper and noticeably lighter, a real factor for travel or all-day carry.

## Who should pick which

The R7: wildlife, action, and sports shooters who'll benefit from in-body stabilization paired with unstabilized telephoto lenses, and anyone who wants confirmed weather sealing and dual card slots for reliability. The R10: buyers starting out on a tighter budget, and general, travel, or family photography where in-body stabilization matters less because you're not routinely shooting handheld in low light with long lenses.

## The honest bottom line

This isn't old-vs-new — it's two genuinely different tools from the same generation. The R7 is built for anyone whose subject or lens choice makes stabilization and tracking detail worth the extra cost and weight; the R10 is built for everyone else.`,
    },
    {
      slug: "sensor-size-explained-crop-vs-full-frame",
      title: "Sensor Size Explained: Crop vs Full-Frame, What It Actually Changes",
      type: "guide",
      status: "published",
      categorySlug: CATEGORY,
      searchIntent: "informational",
      primaryQuery: "crop sensor vs full frame",
      intentFingerprint: "sensor-size-crop-vs-full-frame",
      tagSlugs: ["sensor-size", "comparison"],
      metaTitle: "Sensor Size Explained: Crop vs Full-Frame, What Changes",
      metaDescription:
        "What sensor size actually controls — field of view, depth of field, high-ISO tendencies, lens size — and why neither format is objectively the correct choice.",
      body: `Sensor size gets discussed constantly in camera buying decisions, and just as constantly conflated with resolution, as if a bigger number on a spec sheet automatically means a better camera. It doesn't work that way. Sensor size is a physical dimension that changes a specific set of trade-offs — not a simple hierarchy where bigger always wins.

## What "sensor size" actually means

It's the physical dimensions of the light-capturing chip, measured in millimeters, not the pixel count. Two cameras can carry the same megapixel count on very differently sized sensors — resolution and physical size are separate facts, and conflating them is the single most common source of confusion in this topic.

## Crop factor: what it actually does

A smaller-than-full-frame sensor (APS-C, most commonly) doesn't change what a lens optically does — the lens's actual focal length and aperture don't change. What changes is how much of the image the lens projects actually lands on the sensor: a full-frame sensor captures the whole image circle a lens produces, while an APS-C sensor captures a smaller subsection of it, which reads as a narrower field of view. This is usually expressed as a "crop factor" (roughly 1.5x-1.6x for APS-C, depending on manufacturer) multiplied against a lens's actual focal length to describe its full-frame-equivalent field of view — a framing effect, not a change to the lens itself.

## Depth of field

At the same aperture, framing, and subject distance, a larger sensor produces shallower depth of field than a smaller one. This surprises people who assume depth of field is purely an aperture question — sensor size plays a real, independent role, which is part of why full-frame cameras are often associated with more pronounced background blur at a given f-stop compared to an APS-C camera shooting the same scene at the same settings.

## Low-light and high-ISO performance

Larger individual photosites, all else equal, generally gather more light per pixel, which typically gives a full-frame sensor an advantage in high-ISO noise performance over an APS-C sensor of a similar generation and resolution. "Similar generation" is doing real work in that sentence, though — a newer APS-C sensor can outperform an older full-frame one, so sensor size predicts a tendency, not a guarantee, independent of the specific sensor's actual age and design.

## Lens size, weight, and cost

A full-frame lens generally needs to be physically larger to project a bigger image circle onto a bigger sensor, which usually means more weight and a higher price than an equivalent-spec APS-C lens. This is a real, practical part of why APS-C systems are frequently lighter and cheaper to build out as a complete kit, independent of the camera body price itself.

## Reach: the flip side of crop factor

For subjects where more apparent magnification from a given lens is the goal — wildlife, sports, some astrophotography — the crop factor works in your favor. The same physical telephoto lens produces a tighter-looking frame on an APS-C body than on full-frame, which is exactly why some telephoto-focused shooters deliberately choose a crop-sensor body rather than treating APS-C as a compromise they're settling for.

## What sensor size doesn't determine

It isn't the same thing as resolution, and it isn't a fixed ranking of better and worse — it changes a specific set of trade-offs (field of view, depth-of-field control, high-ISO tendencies, lens size and cost), and which side of each trade-off actually matters to you depends entirely on what you shoot.

## The honest bottom line

Full-frame trades size, weight, and cost for shallower depth-of-field control and typically stronger low-light performance. APS-C trades some of that away for a lighter, cheaper system and effectively free extra reach for telephoto work. Neither is objectively correct — the right format is whichever set of trade-offs actually matches what you photograph.`,
    },
  ],
};
