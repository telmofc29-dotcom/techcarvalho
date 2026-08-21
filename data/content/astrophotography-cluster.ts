// Content cluster: Astrophotography for beginners (pillar) + 4 supporting
// pieces. categorySlug uses "astrophotography" as a placeholder consistent
// slug — verify against the real taxonomy_categories table before/during
// ingestion. These are general technique guides; no camera-specific specs
// are cited (see the note in canon-dslr-cluster.ts for why).

import type { ContentBatchImport } from "@/lib/content/import-types";

const CATEGORY = "astrophotography";

export const astrophotographyCluster: ContentBatchImport = {
  content: [
    {
      slug: "astrophotography-for-beginners",
      title: "Astrophotography for Beginners: A Practical Starting Guide",
      type: "guide",
      status: "published",
      categorySlug: CATEGORY,
      searchIntent: "informational",
      primaryQuery: "astrophotography for beginners",
      intentFingerprint: "astrophotography-beginners-guide",
      tagSlugs: ["astrophotography", "beginner-guide"],
      metaTitle: "Astrophotography for Beginners: A Practical Starting Guide",
      metaDescription:
        "The camera settings and gear that actually matter for your first night-sky photos — and why understanding exposure matters more than owning better equipment.",
      body: `Astrophotography has a reputation for requiring expensive, specialized equipment before you can take a single usable photo. That reputation is mostly wrong for the entry point — a huge amount of genuinely satisfying night-sky photography is possible with a camera capable of manual exposure control, a wide-aperture lens, and a tripod. What actually determines whether your first attempts work isn't the gear tier, it's understanding a small number of concepts that don't apply to daytime photography.

## The one thing that's different about night photography

In daylight, your camera has more light than it needs and exposure is mostly about creative choices. At night, you have the opposite problem: not enough light, and every setting becomes a trade-off against a specific limitation. Understanding those limitations, not owning better gear, is what separates a usable astrophotography result from a disappointing one.

## The four settings that actually matter

**Aperture**: as wide open as your lens allows (the lowest f-number). This is not optional the way it sometimes is in daylight — a wider aperture lets in more light per second, which is the single most valuable thing you can do at night.

**Shutter speed**: long enough to gather light, short enough that stars don't visibly trail into streaks due to the Earth's rotation. There's a rough starting guideline photographers use — divide a number (roughly 500, adjusted down for higher-resolution sensors and cropped formats) by your lens's focal length to estimate a maximum shutter speed before trailing becomes visible — but treat it as a starting point to test and adjust, not a fixed rule, since sensor resolution and pixel-level scrutiny change how visible trailing actually is.

**ISO**: high enough to produce a usable image at your chosen aperture and shutter speed, but every camera has a point where higher ISO trades brightness for visible noise. There's no universal "correct" ISO — it depends on your specific camera's sensor, and the only way to know your camera's actual limit is to test it yourself on a real night sky and examine the results.

**Focus**: autofocus generally does not work reliably on stars — there isn't enough contrast for the camera to lock onto. Manual focus, checked by zooming into the live view image on the brightest star or planet you can find, is the standard approach.

## What you need before you start

A camera with manual exposure mode (M) and manual focus capability — most interchangeable-lens cameras from the last decade or more qualify, this is not a spec that requires recent gear. A lens with a reasonably wide aperture — f/2.8 or wider is a common recommendation, though narrower apertures still work with longer exposures and higher ISO. A tripod, which is non-negotiable; no exposure long enough to gather adequate starlight can be held steady by hand. A remote shutter release or the camera's self-timer, to avoid the vibration of physically pressing the shutter button during a long exposure.

## Where to actually start

A clear night, away from significant light pollution if possible, photographing a wide starfield or the Milky Way if it's visible from your location and season. Don't start with something that requires tracking equipment (see the tripod-vs-tracker guide linked below) — a static wide-field shot teaches you the fundamentals without adding the complexity of a second piece of gear to learn simultaneously.

The honest expectation for a first attempt: it probably won't look like the photos that motivated you to try this. That's normal. The gap between a first attempt and a genuinely good result is mostly about repetition — learning your specific camera's noise behavior, your lens's real usable aperture, and how to judge focus in the dark — not about buying more equipment.`,
    },
    {
      slug: "astrophotography-camera-settings-manual-mode",
      title: "Camera Settings for Astrophotography: Manual Mode Explained",
      type: "guide",
      status: "published",
      categorySlug: CATEGORY,
      searchIntent: "informational",
      primaryQuery: "astrophotography camera settings manual mode",
      intentFingerprint: "astrophotography-manual-mode-settings",
      tagSlugs: ["astrophotography", "camera-settings"],
      metaTitle: "Astrophotography Camera Settings: Manual Mode Explained",
      metaDescription:
        "Why automatic modes fail at night, and how to build a manual exposure from aperture, shutter speed, and ISO for genuinely usable astrophotography.",
      relatedContent: [{ relatedSlug: "astrophotography-for-beginners", type: "supporting_of" }],
      body: `Manual mode intimidates a lot of photographers moving from automatic shooting, but for night photography it isn't optional — every automatic mode a camera offers is built around assumptions (adequate ambient light, a focusable subject with contrast) that don't hold true pointed at a dark sky. Understanding why each manual setting exists for this specific use case makes the whole process much less arbitrary.

## Why automatic modes fail here

Auto-exposure tries to average a scene to a "correct" middle brightness — pointed at a mostly black sky with small bright points, it will either underexpose trying to protect the bright stars or overexpose trying to brighten the dark sky, and it has no way to know which trade-off you actually want. Autofocus needs contrast to lock onto, and a night sky mostly doesn't have any at a normal focus-point scale. Both failures are structural, not a matter of the camera being "bad" at night photography — they're automatic systems doing exactly what they're designed to do, for a scenario they weren't designed for.

## Building an exposure from scratch

Start with aperture wide open — this isn't a starting point to refine later, it's close to a fixed decision for most astrophotography, since you rarely have light to spare. From there, shutter speed is a balance against star trailing (see the beginner guide for the rough focal-length-based estimate) — pick the longest shutter speed you can before trailing becomes objectionable at the size you'll view the image. ISO fills whatever gap remains between the brightness those two settings produce and a usable exposure — raise it until the image is bright enough to work with in editing, accepting that this introduces visible noise past a certain point specific to your camera.

## White balance

Auto white balance is usually a reasonable starting point for night sky photography and can be adjusted freely afterward if you shoot in RAW format — which you should, for astrophotography specifically, since RAW preserves far more shadow and color detail for the noise reduction and adjustment this genre typically needs.

## A practical starting recipe

Aperture wide open. Shutter speed from the focal-length estimate in the beginner guide, tested and adjusted against your actual results. ISO started around a moderate-high value and adjusted based on how the image looks on your camera's rear screen, zoomed in — not just at the thumbnail-sized preview, which hides noise. Manual focus, checked by zooming into live view on a bright star. RAW file format, always, for this genre.

## The single biggest mistake

Chasing a "correct" exposure the way you would in daylight. Astrophotography exposures are usually deliberately bright compared to how the scene will ultimately look, specifically because the image gets adjusted afterward — a slightly-too-bright RAW file with detail in the shadows is recoverable in editing; an underexposed one with noise in the shadows generally isn't. Expose to protect shadow detail, not to match what you remember the sky looking like to your eye.`,
    },
    {
      slug: "how-to-photograph-the-moon",
      title: "How to Photograph the Moon (Without a Telescope)",
      type: "guide",
      status: "published",
      categorySlug: CATEGORY,
      searchIntent: "informational",
      primaryQuery: "how to photograph the moon",
      intentFingerprint: "how-to-photograph-the-moon",
      tagSlugs: ["astrophotography", "moon-photography"],
      metaTitle: "How to Photograph the Moon Without a Telescope",
      metaDescription:
        "Why Moon photography uses the opposite settings from the rest of the night sky, and what focal length and exposure actually produce visible surface detail.",
      relatedContent: [{ relatedSlug: "astrophotography-for-beginners", type: "supporting_of" }],
      body: `The Moon is, counterintuitively, one of the easier astrophotography subjects rather than one of the harder ones — and most beginners approach it with settings tuned for the rest of the night sky, which is exactly backwards. The Moon is extremely bright compared to almost everything else you'd photograph at night, and treating it that way is the entire trick.

## Why Moon photography breaks the usual night-sky rules

Every setting discussed for general astrophotography assumes a dark subject requiring long exposures and high ISO. The Moon is sunlit rock — from a camera's perspective, it behaves much closer to a daylight subject than a night one. Expose it like the rest of the night sky and you'll get a featureless white blob with none of the surface detail (craters, maria, the terminator line between light and shadow) that makes a Moon photo worth taking.

## The actual exposure approach

Treat the Moon closer to a bright daylight subject: a relatively fast shutter speed, a moderate-to-narrow aperture, and low ISO — roughly the inverse of the settings you'd use for a starfield. There's no single universal setting because the Moon's apparent brightness changes with its phase (a full Moon is dramatically brighter than a thin crescent) and with atmospheric conditions, so treat any starting point as exactly that — a starting point to check against your camera's histogram and adjust, not a fixed recipe.

## Focal length matters more here than almost anywhere else

The Moon is small in the sky relative to how large it needs to appear in a photo to show real detail. A wide-angle lens will render it as a tiny dot — fine for a landscape composition where the Moon is a small element in a bigger scene, useless if you want the Moon itself to be the subject. Meaningful surface detail generally requires significantly more focal length than most general-purpose lenses provide, which is the real reason dedicated Moon photography often involves a telephoto lens, a teleconverter, or in some cases a telescope used as the "lens" — but a long telephoto zoom lens alone, without any telescope, can produce a genuinely detailed Moon photo.

## Two different kinds of Moon photo

A Moon-as-landscape-element photo (small in frame, part of a wider scene) uses ordinary landscape or night photography technique and whatever lens suits the composition. A Moon-as-subject photo (the Moon filling a meaningful part of the frame, showing craters and surface texture) needs the longest focal length you have access to, a stable tripod, and ideally a remote shutter release or timer to eliminate camera shake at high magnification, where even small vibrations are visible.

## A realistic starting checklist

Tripod, always — handheld won't hold steady enough at the focal lengths that show real detail. The longest lens you have. A manual or spot-metering approach rather than trusting the camera's general auto-exposure, which will typically overexpose the Moon trying to average the surrounding dark sky. Manual focus, checked by zooming into live view on the Moon's edge or a crater, since autofocus can struggle with the Moon's relatively low contrast at a distance despite its brightness.

The realistic expectation without a telescope: recognizable surface detail and craters are achievable with enough focal length; the kind of extreme close-up detail seen in dedicated astrophotography generally does require actual telescope-level magnification.`,
    },
    {
      slug: "meteor-shower-photography-settings",
      title: "Meteor Shower Photography: Camera Settings and Realistic Expectations",
      type: "guide",
      status: "published",
      categorySlug: CATEGORY,
      searchIntent: "informational",
      primaryQuery: "meteor shower photography settings",
      intentFingerprint: "meteor-shower-photography-settings",
      tagSlugs: ["astrophotography", "meteor-photography"],
      metaTitle: "Meteor Shower Photography: Settings and Realistic Expectations",
      metaDescription:
        "How to set up a wide-field meteor shoot, why most exposures come back empty, and what actually improves your odds of capturing a meteor.",
      relatedContent: [{ relatedSlug: "astrophotography-for-beginners", type: "supporting_of" }],
      body: `Meteor photography has a specific challenge none of the rest of astrophotography really shares: you can't aim at the subject, because you don't know exactly where or when it will appear. The entire approach is built around that constraint, and setting realistic expectations about it up front will save a lot of frustration.

## The core strategy: wide field and patience, not precision aiming

Because meteors can streak across a large portion of the sky and you generally only get a fraction of a second's notice (if any) before one appears, the standard approach is a wide-angle lens pointed at a general region of sky — often toward, but not directly at, the radiant point a given meteor shower is named for and appears to originate from — and a long series of consecutive exposures, hoping to capture meteors across dozens or hundreds of frames rather than trying to time a single shot to one.

## Settings, and why they're close to standard night-sky settings

Aperture wide open, for the same light-gathering reason as any other astrophotography. Shutter speed set by the same star-trailing consideration as general night photography — you're not trying to do anything different here regarding stars themselves, just hoping a meteor happens to cross the frame during one of your exposures. ISO high enough for a usable exposure, tested against your specific camera's noise behavior. The meaningful difference from general astrophotography isn't the settings — it's running continuous exposures back-to-back for an extended period, which usually means an intervalometer (built into many cameras, or an external accessory) taking one exposure immediately after another for the duration of the session.

## Realistic expectations

Even during a strong, well-known meteor shower, most individual exposures will contain no visible meteor — you're photographing a large area of sky for a long period specifically because any single frame has a real chance of catching nothing. Success is measured across a whole night's worth of frames, not any individual exposure. Light pollution matters enormously here — fainter meteors simply won't register against a bright sky background, so a genuinely dark location matters more for meteor photography than for most other astrophotography subjects.

## Practical session setup

Check a meteor shower's predicted peak date and time before planning a session — showers have well-defined peak windows, and shooting outside them dramatically reduces meteor frequency for no gain. Frame a wide, interesting foreground if possible (a horizon, a landscape feature) rather than pointing straight up at featureless sky — a meteor streak is more compelling with visual context in frame. Bring a way to stay warm and comfortable for an extended session; meteor photography sessions productively run for hours, and discomfort is the most common reason people cut a session short before it produces results.

## After the shoot

Review every frame rather than assuming you'd have noticed a meteor in the moment — faint meteors are often easier to spot reviewing images afterward than watching the live sky, and it's common to find a meteor in a frame you didn't consciously see happen.`,
    },
    {
      slug: "tripod-vs-star-tracker",
      title: "Tripod vs Star Tracker: Which Do You Actually Need First?",
      type: "guide",
      status: "published",
      categorySlug: CATEGORY,
      searchIntent: "commercial",
      primaryQuery: "tripod vs star tracker astrophotography",
      intentFingerprint: "tripod-vs-star-tracker",
      tagSlugs: ["astrophotography", "equipment"],
      metaTitle: "Tripod vs Star Tracker: What Beginners Actually Need First",
      metaDescription:
        "Why a star tracker isn't usually the right first astrophotography purchase, and the real signal that tells you when you've outgrown a static tripod.",
      relatedContent: [{ relatedSlug: "astrophotography-for-beginners", type: "supporting_of" }],
      body: `A star tracker is one of the more tempting early upgrades in astrophotography, because it promises to fix the single biggest limitation of tripod-based shooting: the shutter-speed ceiling imposed by star trailing. Whether it's actually the right next purchase depends heavily on what kind of astrophotography you're trying to do — and for a genuine beginner, the answer is usually "not yet."

## What a tripod actually does and doesn't fix

A tripod solves camera shake — it holds the camera perfectly still, which is necessary but not sufficient for astrophotography. It does nothing about the Earth's own rotation, which is what causes stars to trail into streaks during a long exposure regardless of how still the camera itself is held. A tripod is what makes any night photography possible at all; it just has a hard ceiling on exposure length before that rotation becomes visible.

## What a star tracker adds

A star tracker sits between the tripod and the camera and physically rotates the camera to match the sky's apparent motion, counteracting Earth's rotation. This removes the shutter-speed ceiling that limits tripod-only shooting — exposures of many minutes become possible instead of the roughly-tens-of-seconds ceiling a static tripod imposes at typical focal lengths, which means dramatically more light gathered, dramatically lower usable ISO, and dramatically less noise in the final image.

## Why this isn't automatically the right first purchase

A tracker adds real complexity: it requires polar alignment (physically aiming the tracker's rotation axis at the celestial pole) before it works correctly, which is a genuine skill with its own learning curve, separate from camera settings. It adds cost on top of the tripod and camera you already need. And critically, it solves a problem — the shutter-speed ceiling — that a genuine beginner usually hasn't run into the limits of yet; most of the early learning curve in astrophotography (manual exposure, manual focus, understanding your camera's noise behavior) happens entirely within what a static tripod already supports.

## A more useful way to frame the decision

Learn the fundamentals on a tripod first — manual exposure, manual focus, reading a histogram, understanding your specific camera's usable ISO ceiling. If you reach a point where you're regularly limited by shutter speed specifically — noticing star trails you don't want, or finding your ISO ceiling is the thing holding image quality back rather than your technique — that's the actual signal a tracker will solve a real problem you have, rather than a problem you're anticipating.

## The honest trade-off

A tracker is a meaningful capability upgrade for deep-sky and long-exposure wide-field work specifically, and a genuinely poor use of money for someone still learning basic manual exposure and focus, where the limiting factor isn't shutter speed at all. Buy the skill first; buy the tracker when the tripod's specific limitation is what's actually stopping you.`,
    },
  ],
};
