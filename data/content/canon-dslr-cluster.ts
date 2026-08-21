// Content cluster: Canon DSLR buying guide (pillar) + 5 supporting pieces.
// categorySlug uses "cameras-photography" as a placeholder consistent slug —
// verify against the real taxonomy_categories table before/during ingestion
// and adjust if the live slug differs.
//
// These pieces deliberately avoid citing precise, unverified specs for
// individual camera bodies (sensor resolution, exact burst rates, etc.) —
// that data is being researched separately for the product catalogue
// (see data/catalogue/). Where a specific camera is discussed here, claims
// stay at the level of well-established, general facts (sensor format
// class, viewfinder type, general generational positioning) rather than
// precise numbers this fork did not independently verify.
//
// linkedProducts now wired up to the real Canon catalogue product slugs
// (confirmed against data/catalogue/*.ts after both were applied to
// production) — deliberately not indiscriminate: only products a piece
// actually discusses by name/line get linked, and only with a role that
// matches how the piece actually treats that product (primary_subject for
// a piece that's centrally about it, mentioned for lineup-context
// references, compared_against reserved for a review that centers on one
// product but references another as a comparison point). The 90D/6D/5D
// generation pieces don't exist yet, and the EOS R6 V announcement piece
// deliberately links to nothing — it's about a camera not in this
// catalogue (a distinct, newer product from our catalogue's R6), and the
// R6 Mark II it's actually positioned against isn't in the catalogue
// either; linking to the unrelated original R6 would be more misleading
// than helpful. metaTitle/metaDescription are genuinely written per piece
// from its actual content, not templated.

import type { ContentBatchImport } from "@/lib/content/import-types";

const CATEGORY = "cameras-photography";

export const canonDslrCluster: ContentBatchImport = {
  content: [
    {
      slug: "canon-dslr-buying-guide",
      title: "Canon DSLR Buying Guide: Which EOS Body Actually Makes Sense Now",
      type: "guide",
      status: "published",
      categorySlug: CATEGORY,
      searchIntent: "commercial",
      primaryQuery: "canon dslr buying guide",
      intentFingerprint: "canon-dslr-buying-guide",
      tagSlugs: ["canon", "dslr", "buying-guide"],
      metaTitle: "Canon DSLR Buying Guide 2026: Which EOS Body Fits You",
      metaDescription:
        "A practical breakdown of when a Canon DSLR still makes sense in 2026, and how to choose between the xxD, 6D, and 5D lines based on what you actually shoot.",
      linkedProducts: [
        { productSlug: "canon-eos-60d", role: "mentioned" },
        { productSlug: "canon-eos-70d", role: "mentioned" },
        { productSlug: "canon-eos-80d", role: "mentioned" },
        { productSlug: "canon-eos-90d", role: "mentioned" },
        { productSlug: "canon-eos-6d", role: "mentioned" },
        { productSlug: "canon-eos-6d-mark-ii", role: "mentioned" },
        { productSlug: "canon-eos-5d-mark-iii", role: "mentioned" },
        { productSlug: "canon-eos-5d-mark-iv", role: "mentioned" },
      ],
      body: `Canon stopped treating the DSLR as its flagship line years ago — the EOS R mirrorless system gets the new sensors, the new autofocus systems, and the new lens designs. That doesn't mean the DSLR lineup stopped being useful. It means buying one today is a different decision than it was a decade ago, and it's worth being explicit about what that decision actually involves.

## Why anyone would still buy a DSLR

Three practical reasons keep coming up. First, price: a used DSLR body, especially an APS-C enthusiast model, is often dramatically cheaper than an equivalent mirrorless body with a comparable feature set, because the used market is flooded with them. Second, lens availability: Canon's EF mount has two decades of lenses behind it, many of them excellent and now inexpensive secondhand, and EF lenses adapt cleanly onto EOS R bodies if you do eventually move to mirrorless. Third, battery life and handling: DSLRs generally run longer on a charge than mirrorless bodies of the same era, because an optical viewfinder doesn't draw power the way an electronic one does, and many photographers simply prefer the grip and control layout Canon refined over multiple DSLR generations.

## Why you might not

An optical viewfinder shows you the scene, not the exposure — you don't get a live preview of how a shot will actually look until you take it, which mirrorless corrects for. Autofocus in live view (as opposed to through the viewfinder) tends to be slower and less confident on DSLRs than on any modern mirrorless body, which matters a lot if you shoot video or rely on the rear screen. And because Canon's own development attention has moved on, you're buying into a system that will not get new bodies, only a shrinking pool of used and remaining new stock.

## How to actually choose

Start from what you photograph, not from a model number. If you shoot mostly static subjects — landscapes, architecture, product work, posed portraits — the live-view autofocus gap matters much less, and a DSLR's viewfinder and battery advantages are a real, ongoing benefit. If you shoot moving subjects, sports, wildlife, kids, events, autofocus performance matters more than almost anything else in the camera, and this is the area where the mirrorless generation genuinely moved ahead.

Within Canon's APS-C DSLR line, the xxD series (60D, 70D, 80D, 90D and their predecessors) represents the enthusiast tier — physically larger bodies, more direct external controls, generally better build than the entry-level Rebel/xxxD line, and each generation added incremental autofocus, video, and connectivity improvements over the last. See the individual model guides linked below for what specifically changed between them. Full-frame DSLRs (the 6D and 5D lines) trade some of that for a bigger sensor and correspondingly better low-light and depth-of-field control, at a real cost premium even used.

## The honest bottom line

A DSLR is not "obsolete" in the sense of being unable to take good photos — sensor and image quality on a 2016-era enthusiast DSLR is still genuinely good. It's a trade-off: you're accepting a slower, more dated autofocus and live-view experience in exchange for a lower price, a mature lens ecosystem, and often better handling and battery life. Whether that trade is worth it depends entirely on what you shoot, not on chasing whatever is newest.`,
    },
    {
      slug: "canon-eos-60d-still-worth-it",
      title: "Canon EOS 60D: Is It Still Worth Buying?",
      type: "troubleshooting",
      status: "published",
      categorySlug: CATEGORY,
      searchIntent: "commercial",
      primaryQuery: "canon 60d still worth it",
      intentFingerprint: "canon-60d-worth-it",
      tagSlugs: ["canon", "dslr", "used-gear"],
      metaTitle: "Canon EOS 60D in 2026: Is It Still Worth Buying?",
      metaDescription:
        "What the EOS 60D's age actually costs you in autofocus and video, and who it still makes sense for as a cheap, capable stills camera today.",
      linkedProducts: [
        { productSlug: "canon-eos-60d", role: "primary_subject" },
        { productSlug: "canon-eos-70d", role: "mentioned" },
      ],
      relatedContent: [{ relatedSlug: "canon-dslr-buying-guide", type: "supporting_of" }],
      body: `The 60D is now an old camera by any reasonable definition — it belongs to an early generation of Canon's enthusiast APS-C DSLR line, well before the 70D, 80D, and 90D that followed it. That age is exactly why it still comes up as a buying question: it's cheap, it's plentiful on the used market, and the specific things that make a camera feel dated don't affect every kind of photography equally.

## What "old" actually costs you here

The autofocus system predates the on-sensor phase-detect technology Canon introduced with the 70D, which means live-view and video autofocus on the 60D is noticeably slower and hunts more than on any Canon body from the 70D onward. Video capability is limited by the standards of a modern camera — no 4K, and the video autofocus limitation above applies directly. ISO performance and dynamic range, while perfectly usable, are behind what Canon's later sensors delivered. None of this is a surprise for a camera of its era; it's the expected gap.

## What doesn't really change

Through-the-viewfinder autofocus — the mode you'd use holding the camera up to your eye for a static or slow-moving subject — is far less affected by the camera's age than live-view autofocus is. Basic image quality for a well-lit, non-action photo (a portrait, a landscape, a product shot) holds up better than the spec sheet gap suggests, because good light does most of the work regardless of sensor generation. And it takes the same EF lens mount as every Canon DSLR before it, so lens choice isn't a downgrade.

## Who it actually makes sense for

Someone learning photography on a tight budget, who wants to understand exposure, composition, and manual control without a large investment. Someone who shoots deliberately — tripod work, still subjects, learning off-camera flash — where autofocus speed isn't the bottleneck. Someone who already owns EF lenses and wants a cheap second body.

## Who should look elsewhere

Anyone shooting fast-moving subjects, anyone who wants competent video, and anyone who will mostly compose and shoot using the rear screen rather than the viewfinder — live view autofocus is the 60D's clearest weak point, and it's a daily-use one for a lot of casual shooters.

The honest framing: the 60D is a genuinely capable stills camera held back by one specific, well-defined limitation. If that limitation doesn't touch how you actually shoot, its age matters much less than the price difference suggests it should.`,
    },
    {
      slug: "canon-70d-80d-90d-generation-differences",
      title: "Canon EOS 70D vs 80D vs 90D: What Actually Changed Between Generations",
      type: "comparison",
      status: "published",
      categorySlug: CATEGORY,
      searchIntent: "commercial",
      primaryQuery: "canon 70d vs 80d vs 90d",
      intentFingerprint: "canon-70d-80d-90d-comparison",
      tagSlugs: ["canon", "dslr", "comparison"],
      metaTitle: "Canon 70D vs 80D vs 90D: What Really Changed",
      metaDescription:
        "A generation-by-generation breakdown of what actually improved between the Canon EOS 70D, 80D, and 90D, and how to pick the right one for your budget.",
      linkedProducts: [
        { productSlug: "canon-eos-70d", role: "primary_subject" },
        { productSlug: "canon-eos-80d", role: "primary_subject" },
        { productSlug: "canon-eos-90d", role: "primary_subject" },
      ],
      relatedContent: [{ relatedSlug: "canon-dslr-buying-guide", type: "supporting_of" }],
      body: `These three cameras sit back-to-back in Canon's enthusiast APS-C DSLR line, and because Canon iterates rather than reinvents this series each generation, the differences between adjacent models are often smaller than the model-number jump suggests. Knowing what actually changed — rather than assuming "newer number, better camera" across the board — is the difference between paying a premium for something you'll use and paying it for a spec you won't.

## The shared foundation

All three share the core formula that defines this line: an APS-C sensor, an enthusiast-grade body with a top status LCD and more external controls than Canon's entry-level Rebel/xxxD series, an optical viewfinder, and Canon's on-sensor Dual Pixel autofocus for live view and video (introduced with the 70D — this is the single biggest jump in the line's history, more significant than anything that came after it). If you're deciding between these three specifically, you've already decided Dual Pixel autofocus in live view/video matters to you, since all three have it and the 60D before them didn't.

## What moved between 70D and 80D

The 80D refined rather than reinvented: an updated autofocus system with more points and better low-light sensitivity, an updated sensor with a meaningful resolution and dynamic-range improvement, and general refinements to metering and build. For someone deciding between a used 70D and a used 80D at similar prices, the 80D is the more capable camera across the board — the question is only whether the price gap is worth it for improvements that matter most in low light and fast autofocus situations.

## What moved between 80D and 90D

The 90D pushed resolution notably higher and added 4K video (with a crop, and with the video autofocus caveats that implies), plus uncropped 4K at a lower frame rate and improved burst shooting. It also arrived years after the 80D, by which point Canon's attention had visibly shifted toward the EOS R mirrorless system — the 90D is, in a real sense, the last major statement in this DSLR line rather than the start of a new phase of it.

## How to actually pick one

If 4K video matters to you at all, that alone points to the 90D — it's the only one of the three with it. If you never shoot video and care mainly about stills autofocus and low-light performance, the 80D closes most of the gap to the 90D for typically less money. The 70D is the value pick if Dual Pixel autofocus for live view/video is what you actually wanted and everything past that is a "nice to have" rather than a requirement — but check current used pricing carefully, since the gap between 70D and 80D prices has narrowed over time as older stock ages out of the market.

There's no universally "correct" pick here. There's a correct pick for what you shoot, and the honest answer is that the jump from 70D to 80D matters more for stills shooters than the jump from 80D to 90D does, while the reverse is true if video is part of the decision.`,
    },
    {
      slug: "dslr-vs-mirrorless-real-tradeoffs",
      title: "DSLR vs Mirrorless: The Real Trade-offs, Not the Marketing Version",
      type: "guide",
      status: "published",
      categorySlug: CATEGORY,
      searchIntent: "informational",
      primaryQuery: "dslr vs mirrorless",
      intentFingerprint: "dslr-vs-mirrorless-tradeoffs",
      tagSlugs: ["dslr", "mirrorless", "comparison"],
      metaTitle: "DSLR vs Mirrorless: The Real Trade-offs in 2026",
      metaDescription:
        "Beyond the marketing claim that mirrorless is simply better — where DSLRs still win on battery life and price, and where mirrorless autofocus genuinely pulls ahead.",
      relatedContent: [{ relatedSlug: "canon-dslr-buying-guide", type: "supporting_of" }],
      body: `Every camera manufacturer has moved its new-product development to mirrorless. That fact alone gets treated as the whole argument — "mirrorless is simply better now" — and it isn't quite that simple. There are real, structural trade-offs between the two designs, and some of them cut in the DSLR's favor even in 2026.

## The core structural difference

A DSLR uses a mirror to send the lens's image up into an optical viewfinder — you're looking through the actual lens, in real time, with no lag and no battery draw for the viewfinder itself. A mirrorless camera has no mirror; the sensor is exposed to light continuously, and the viewfinder (electronic, or "EVF") is a small screen showing you what the sensor is currently capturing. Everything else follows from that one structural choice.

## Where mirrorless genuinely wins

Autofocus, unambiguously. Because the sensor is always exposed to light, mirrorless cameras can run sophisticated autofocus continuously, including in live view and video — this is exactly the area where DSLRs (outside dedicated through-viewfinder phase-detect AF) have always struggled. Mirrorless EVFs also show you a real preview of exposure, white balance, and depth of field before you shoot, which a DSLR's optical viewfinder cannot do. Mirrorless bodies are also generally smaller and lighter for an equivalent sensor size, since there's no mirror box or pentaprism to accommodate.

## Where DSLRs still win

Battery life is a real, consistent, structural advantage — no EVF or continuously-active sensor to power means a DSLR on an optical viewfinder can shoot vastly more frames per charge than a comparable mirrorless body. Optical viewfinders have zero lag and don't degrade in extreme cold the way some electronic displays can. And because DSLR systems are mature and no longer being actively developed, the used market is large and prices are typically lower for equivalent capability — you're buying yesterday's technology, but at yesterday's-technology prices.

## What doesn't actually matter as much as people think

Image quality from the sensor itself is not meaningfully different between a DSLR and a mirrorless camera using an equivalent sensor generation and size — the mirror (or lack of one) doesn't affect the pixels. "Mirrorless is the future so DSLRs are worthless" is also an overstatement: a camera doesn't stop taking good photos because the manufacturer stopped making new bodies in that format.

## How to actually decide

If you shoot video, or fast-moving subjects, or rely heavily on the rear screen rather than a viewfinder, mirrorless autofocus advantages are real and will show up in your keeper rate. If you shoot mostly static subjects through the viewfinder and value battery life and lower cost over the newest autofocus tech, a DSLR remains a genuinely rational choice — not a compromise you're settling for, but a different set of trade-offs that happens to suit that kind of shooting.`,
    },
    {
      slug: "best-used-canon-dslr-beginners",
      title: "Best Used Canon DSLRs for Beginners",
      type: "guide",
      status: "published",
      categorySlug: CATEGORY,
      searchIntent: "transactional",
      primaryQuery: "best used canon dslr for beginners",
      intentFingerprint: "best-used-canon-dslr-beginners",
      tagSlugs: ["canon", "dslr", "buying-guide", "used-gear"],
      metaTitle: "Best Used Canon DSLRs for Beginners",
      metaDescription:
        "Why a used Canon DSLR is still a smart first camera, what actually matters for learning photography, and how to buy used gear safely.",
      linkedProducts: [
        { productSlug: "canon-eos-60d", role: "mentioned" },
        { productSlug: "canon-eos-70d", role: "mentioned" },
        { productSlug: "canon-eos-80d", role: "mentioned" },
        { productSlug: "canon-eos-90d", role: "mentioned" },
      ],
      relatedContent: [{ relatedSlug: "canon-dslr-buying-guide", type: "supporting_of" }],
      body: `A beginner doesn't need the newest camera. A beginner needs a camera that won't get in the way of learning exposure, composition, and how a lens actually behaves — and a used Canon DSLR, bought carefully, does that for a fraction of the price of anything current.

## What actually matters for a first camera

Manual controls you can reach without digging through menus — a real mode dial, ideally a rear control wheel. A viewfinder you're comfortable composing through, since DSLRs are built around that experience. Compatibility with widely available, inexpensive lenses, so you can actually afford to try a 50mm prime or a longer zoom once you outgrow the kit lens. None of this requires a recent camera.

## What matters less than it seems

Megapixel count, past a fairly low threshold, has almost no bearing on whether beginner photos look good — composition, light, and exposure decide that. The newest autofocus system matters far more for action photography than for a beginner learning fundamentals on mostly static subjects. 4K video is irrelevant if you're learning stills.

## Where to actually look

Canon's enthusiast APS-C line (the 60D through 90D covered elsewhere in this guide) and the entry-level Rebel/xxxD line are both reasonable starting points; the enthusiast line generally has better build and more external controls, at a higher used price, while the Rebel line is smaller, lighter, and cheaper. Either is a legitimate way to start — the enthusiast line rewards you as you grow into manual control, but a Rebel-series body with a decent kit lens is a completely capable way to learn.

## Buying used, practically

Check shutter count if the seller can provide it (a rough guide: DSLR shutters are typically rated for well into six figures of actuations, so a used body with a modest shutter count has plenty of life left). Test autofocus on a real subject before buying, not just that the camera powers on. Prioritize a clean sensor and no fungus/haze on any included lens over cosmetic body wear, which rarely affects performance. Buy the body and a single versatile lens rather than a bundle of lenses you won't use yet — you'll learn faster with one lens you know well than three you don't.

## The actual first purchase

Body, one lens you'll actually use regularly, and nothing else. A beginner kit padded with accessories is money that would be better spent later, once you know what you're missing rather than guessing at it in advance.`,
    },
    {
      slug: "canon-ef-lenses-worth-buying-used",
      title: "Canon EF Lenses Still Worth Buying Used",
      type: "guide",
      status: "published",
      categorySlug: CATEGORY,
      searchIntent: "transactional",
      primaryQuery: "best used canon ef lenses",
      intentFingerprint: "canon-ef-lenses-worth-buying-used",
      tagSlugs: ["canon", "lenses", "used-gear"],
      metaTitle: "Canon EF Lenses Still Worth Buying Used",
      metaDescription:
        "Which used Canon EF lenses hold up today, from nifty-fifty primes to L-series glass, and what to check before buying secondhand.",
      relatedContent: [{ relatedSlug: "canon-dslr-buying-guide", type: "supporting_of" }],
      body: `Canon's EF mount ran for close to three decades before the company shifted its development focus to the mirrorless RF mount. That long run is exactly why the used EF lens market is worth paying attention to: a huge number of genuinely good lenses were made for it, prices have fallen as the mount ages out of new production, and — important if you ever move to an EOS R body — EF lenses adapt onto RF-mount cameras cleanly via Canon's own adapter, autofocus and all.

## Why buy an old lens mount at all

Optical design doesn't age the way sensors and autofocus processors do. A well-regarded EF lens from over a decade ago still produces the same sharpness, the same bokeh character, and the same color rendering it always did — what's changed is the price, and usually only in one direction. Lenses also hold their value differently than camera bodies; a good used lens, cared for, can be resold for close to what you paid, which makes trying one a much lower-risk decision than it feels like upfront.

## The categories worth knowing about

**Nifty-fifty primes**: Canon made 50mm f/1.8 lenses across several generations, all optically similar and all inexpensive — this is the standard first "real" lens recommendation for a reason: wide aperture, compact, cheap, and genuinely useful.

**L-series zooms and primes**: Canon's professional "L" line carries better build quality, generally better optics, and weather sealing on many models — used prices are still a real step up from consumer glass, but far below buying new, and L lenses tend to hold value exceptionally well.

**Macro lenses**: EF macro primes are a category where an older design is rarely a real handicap, since macro work depends more on optical design and manual focus precision than on autofocus speed.

**Older third-party EF-mount lenses**: from manufacturers who made EF-compatible glass, quality varies far more than with Canon's own lenses — research the specific model rather than assuming the brand name guarantees anything.

## What to actually check before buying used

Autofocus motor type matters for how the lens will sound and behave — ring-type ultrasonic motors are generally quieter and faster than older micromotor designs, worth confirming for a lens you'll use for video or quiet environments. Inspect for fungus and haze, which affect image quality directly and aren't always visible in seller photos. Test aperture blades move smoothly and autofocus doesn't hunt excessively on a real body before committing, where that's possible.

## The bottom line

A good used EF lens is frequently the single best value decision in a Canon kit — better glass, for less money, with essentially no functional downside compared to buying new, and a clean upgrade path if a future body swap to mirrorless ever happens.`,
    },
  ],
};
