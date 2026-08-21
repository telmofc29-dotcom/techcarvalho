// Three additional supporting pieces for the astrophotography-for-beginners
// pillar (see astrophotography-cluster.ts). Kept in a separate file rather
// than appended to that one so the original cluster file's diff stays
// clean. Same categorySlug placeholder and no-camera-specific-specs
// approach as the original cluster.
//
// solar-photography-safety is the one piece in this batch backed by real
// WebSearch research rather than established-technique reasoning alone —
// eye/sensor safety claims are sourced explicitly (see `sources` below) per
// the batch's rule that safety-critical claims need real citations, not
// just hedged phrasing.

import type { ContentBatchImport } from "@/lib/content/import-types";

const CATEGORY = "astrophotography";

export const astrophotographyCluster2: ContentBatchImport = {
  content: [
    {
      slug: "solar-photography-safety",
      title: "Solar Photography Safety: What You Must Know Before You Point a Camera at the Sun",
      type: "guide",
      status: "draft",
      categorySlug: CATEGORY,
      searchIntent: "informational",
      primaryQuery: "solar photography safety",
      intentFingerprint: "solar-photography-safety",
      tagSlugs: ["astrophotography", "solar-photography"],
      metaTitle: "Solar Photography Safety: What You Must Know First",
      metaDescription:
        "Why sunglasses and stacked ND filters aren't safe substitutes for a real solar filter, where the filter actually goes, and the one moment during an eclipse when removing it is safe.",
      relatedContent: [{ relatedSlug: "astrophotography-for-beginners", type: "supporting_of" }],
      sources: [
        {
          url: "https://eclipse.aas.org/eye-safety/iso12312-2",
          publisher: "American Astronomical Society",
          reliabilityTier: "primary",
          claimStatus: "confirmed_fact",
        },
        {
          url: "https://www.dpreview.com/articles/how-to-photograph-a-solar-eclipse/",
          publisher: "DPReview",
          reliabilityTier: "secondary",
          claimStatus: "reputable_report",
        },
      ],
      body: `Every other guide in this series treats camera settings as the main event. This one doesn't, because getting the settings wrong here produces a bad photo, and getting the safety wrong can cause permanent eye damage or destroy a camera. Read this before you point any camera, with or without a telephoto lens attached, anywhere near the sun.

## The core danger, stated plainly

Looking directly at the sun — with your naked eye, through an unfiltered optical viewfinder, or through an unfiltered lens — can injure the retina, a form of damage called solar retinopathy that can cause lasting changes to vision. That's not a general "be careful" caveat tacked onto a technique guide; it's the entire reason every recommendation below exists.

## What actually protects you: a purpose-built solar filter, not a substitute

A proper solar filter for a camera lens is designed to block sunlight to a safe level across the wavelengths that matter — visible, ultraviolet, and infrared — and mounts securely over the front of the lens, so no unfiltered sunlight can enter the optical path at all. According to the American Astronomical Society's eclipse eye-safety guidance, the ISO 12312-2 standard is written specifically for unaided-eye products like eclipse glasses and handheld solar viewers, and doesn't itself certify telescope or camera filters — but material that meets that standard's transmittance, uniformity, and quality requirements is considered suitable for that use too. Treat ISO 12312-2 as a reasonable baseline to look for in the filter material, but confirm what you're buying is specifically sold as a camera or telescope optical filter, not a handheld eclipse viewer being repurposed as one.

## What is never a safe substitute

Sunglasses, exposed or undeveloped photographic film, smoked glass, or stacked neutral-density filters not rated for solar use. None of these reliably block the specific combination of visible, UV, and infrared wavelengths that cause actual damage, no matter how dark they look to the eye.

## Where the filter goes, and why that matters

A solar filter belongs on the front of the lens, before any light enters the optical system — never as a rear or eyepiece-side filter, and never used as something you hold up and look through with the naked eye. A handheld eclipse viewer and an optical filter built for mounting on a lens or telescope are not interchangeable; the AAS is explicit that optical solar filters must never be used as handheld viewers, and eclipse glasses must never be used with optical instruments like telephoto lenses or telescopes.

## Composing your shot doesn't make it safe

Using an electronic viewfinder or a mirrorless camera's rear screen to compose doesn't remove the risk. Concentrated, unfiltered sunlight passing through a telephoto lens can generate enough heat to damage a camera's shutter, internal components, or sensor, independent of whether anyone is looking through an optical viewfinder at the time — the equipment risk and the eye risk are separate problems, and a proper front-mounted filter protects against both.

## The one exception: totality during a total solar eclipse

During the brief period of totality in a total solar eclipse — when the Moon fully covers the sun's disk — it becomes safe to remove filters, for both eyes and camera, for that specific window only. Every other phase of an eclipse, including the partial phases immediately before and after totality, needs the same filtering as any other day you'd point a camera at the sun. Timing matters enormously here: removing a filter even seconds before totality actually begins, or leaving it off seconds after totality ends, risks the same damage as never using a filter at all. If you aren't located within the path of totality, none of this exception applies to you — treat the entire event as requiring a filter throughout.

## A practical checklist before you shoot

Confirm your filter is sold specifically for camera or telescope use, not a handheld-only eclipse viewer. Mount it securely on the front of the lens before pointing the camera anywhere near the sun. Never look through an unfiltered optical viewfinder at the sun, even briefly, even just to check framing. If you're shooting a total eclipse, know your local totality start and end times precisely, and treat the filter-off window as strictly limited to that period.

## The honest bottom line

Get the filter and the timing right first. The actual astrophotography technique — exposure, framing, focus — only matters once that's settled, and none of it is worth attempting with equipment or a method you're not certain is actually safe.`,
    },
    {
      slug: "wide-field-astrophotography-milky-way",
      title: "Wide-Field Astrophotography: Getting the Milky Way Without a Tracker",
      type: "guide",
      status: "draft",
      categorySlug: CATEGORY,
      searchIntent: "informational",
      primaryQuery: "milky way photography without tracker",
      intentFingerprint: "wide-field-astrophotography-milky-way",
      tagSlugs: ["astrophotography", "wide-field"],
      metaTitle: "Wide-Field Astrophotography: The Milky Way Without a Tracker",
      metaDescription:
        "Why the Milky Way's core is a special case among astrophotography subjects, when it's actually visible from your location, and why a wide lens on a tripod gets you further than you'd expect.",
      relatedContent: [{ relatedSlug: "astrophotography-for-beginners", type: "supporting_of" }],
      body: `The Milky Way's core is the single most common aspirational target in astrophotography, and it's different enough from general night-sky photography to deserve its own guide rather than being treated as an incidental result of "pointing a camera up on a clear night."

## Why the Milky Way is a special case, not just "night sky in general"

Most astrophotography treats the night sky as a fairly uniform faint subject. The Milky Way's core is different — a genuinely brighter, more structured band across the sky than the average starfield around it, which is exactly why it photographs so much more dramatically, and why it's worth planning for as a specific target rather than hoping it shows up in a general night shot.

## Visibility is a when-and-where problem before it's a settings problem

The Milky Way's core isn't visible from every location or every night of the year — it depends on your hemisphere, the season, and moonlight. In much of the Northern Hemisphere, the core sits favorably in the pre-dawn or evening sky roughly from spring through early autumn, and is very low or effectively absent from the evening sky during winter months; the exact window shifts with latitude, so check a dedicated planning app or star chart for your specific location rather than assuming a fixed calendar date applies everywhere. A bright Moon above the horizon washes out the same faint detail that light pollution does, so checking the lunar calendar matters as much as checking the season.

## Settings: the general astrophotography approach, pushed further

Everything from wide-open aperture, manual focus, and RAW capture in the general astrophotography settings guide applies here, pushed slightly further — the Milky Way's core, while brighter than the average sky, is still a genuinely faint subject. Expect to run close to your lens's widest practical aperture and a higher ISO than a simple starfield shot would need, and to hold more strictly to the focal-length-based shutter speed estimate from the beginner guide, since trailing is more visually obvious against the Milky Way's structured band than against scattered points of light.

## What a wide-angle lens buys you here specifically

A wide field of view lets you frame the Milky Way's core alongside a foreground element — a horizon, a landscape feature, a silhouette — which is usually what separates a genuinely compelling result from a technically correct but flat one. It's also why this specific genre tolerates a static tripod so well when other deep-sky subjects don't: a wide lens's shorter focal length gives you a much longer maximum shutter speed before trailing appears, since the focal-length-based estimate scales directly with focal length — so a tripod alone gathers meaningfully more usable light here than it would behind a telephoto lens.

## Where a tracker would help, and why you can skip it for now

A star tracker removes the shutter-speed ceiling entirely, letting you stack far more total light and pull out fainter dust-lane structure and color than a static tripod ever will. But wide-field, foreground-inclusive Milky Way photography is specifically the genre where a tripod-only approach gets closest to a genuinely satisfying result before a tracker becomes necessary — see our tripod vs star tracker guide for the general version of this decision. The short version for this specific subject: a wide lens's forgiving shutter-speed ceiling means you're not fighting the same trailing constraint that pushes other astrophotography subjects toward needing a tracker sooner, so there's real room to learn focus, exposure, and composition on a tripod first.

## Processing expectations, honestly

A single wide-field frame, even a well-exposed one, usually needs real post-processing — contrast and color adjustments — to look like the results that motivated the attempt. Stacking multiple exposures of the same composition (aligning and averaging several frames in software afterward) is a common way to reduce noise beyond what any single exposure achieves, without needing a tracker at all, since the stacking happens after capture rather than during it.

## A realistic first-session checklist

Check the Milky Way core's visibility window and rise/set time for your specific location and date. Check the lunar calendar and avoid a night with a bright Moon above the horizon. Find the darkest sky location reasonably available to you. Bring a wide-aperture lens, a tripod, and a remote shutter release or timer. Plan a foreground element in advance rather than discovering the composition in the dark.`,
    },
    {
      slug: "equatorial-mounts-explained",
      title: "Equatorial Mounts Explained: Do Beginners Actually Need One",
      type: "guide",
      status: "draft",
      categorySlug: CATEGORY,
      searchIntent: "commercial",
      primaryQuery: "equatorial mount for beginners",
      intentFingerprint: "equatorial-mounts-explained",
      tagSlugs: ["astrophotography", "equatorial-mount", "equipment"],
      metaTitle: "Equatorial Mounts Explained: Do Beginners Need One?",
      metaDescription:
        "What an equatorial mount actually does mechanically, how it differs from the compact camera star tracker most beginners start with, and the real signal you're ready to step up.",
      relatedContent: [{ relatedSlug: "astrophotography-for-beginners", type: "supporting_of" }],
      body: `"Equatorial mount" and "star tracker" get used almost interchangeably in beginner astrophotography discussions, which causes real confusion — they're related, but a full equatorial mount built for a telescope is a meaningfully bigger step than the compact camera trackers covered in our tripod vs star tracker guide. This piece is specifically about that bigger step, and when a beginner has actually reached the point of needing it.

## What an equatorial mount actually is, mechanically

An equatorial mount is built around two rotational axes aligned to Earth's rotational axis, rather than the simple horizontal/vertical pivot of a standard photo tripod head. Once one axis is aligned with the celestial pole — a process called polar alignment — the mount can track the sky's apparent motion by rotating around that single axis at a constant rate, instead of needing continuous adjustment on two independent axes the way an ordinary tripod head would. That single-axis tracking is the entire point: once polar-aligned, a motorized equatorial mount keeps a target centered as the Earth rotates, for as long as the tracking motor runs.

## Not the same thing as the star tracker in our tripod-vs-tracker guide

The compact camera star trackers covered elsewhere on this site are, mechanically, a simplified single-axis equatorial mount sized for the weight of a camera and lens. This guide is about the larger, more capable equatorial mounts built to carry a telescope's weight, usually with a camera attached to it too — a meaningfully bigger step up in capability, cost, weight, and setup complexity than a compact camera tracker.

## What a full equatorial mount adds over a compact camera tracker

Payload capacity rated for a telescope and imaging camera together, often several kilograms, well beyond what a compact tracker is built to carry. Tracking precision suited to the much longer effective focal lengths a telescope uses, where even small tracking errors become visible far sooner than they would through a wide camera lens. Often, support for autoguiding — a second, smaller camera and control loop that corrects the mount's tracking in real time against a guide star, which becomes necessary at the focal lengths and exposure lengths telescope imaging typically involves, once the mount's own tracking accuracy alone isn't quite enough.

## Polar alignment: the skill that gates everything here

Every equatorial mount, compact tracker or full telescope mount, requires polar alignment before tracking works correctly. A full equatorial mount's alignment process is generally more involved than a compact tracker's simplified version — often using a polar scope or an electronic alignment routine — and getting it meaningfully wrong shows up directly as trailing or drift across every image the session produces, not as a minor quality loss you can fix later.

## Do beginners actually need one

For a genuine beginner, almost always not yet. The entire early learning curve in astrophotography — manual exposure, manual focus, understanding a specific camera's noise behavior, basic composition — happens on a static tripod or, at most, a compact camera tracker, well before a telescope and full equatorial mount enter the picture. A full equatorial mount is specifically a telescope-imaging purchase; if you don't yet own or aren't yet planning to use a telescope for imaging, there's nothing for the mount to do that a compact tracker or static tripod doesn't already cover.

## The actual signal you're ready for one

You've outgrown wide-field, camera-lens astrophotography specifically because you want the magnification and detail only a telescope provides — deep-sky objects like nebulae and galaxies at a scale no camera lens reaches — and you're prepared to take on polar alignment, autoguiding, and the general setup complexity that comes with it. That's a meaningfully bigger commitment, in both cost and learning curve, than anything else in this guide series, and it's worth being sure telescope imaging specifically is what you actually want before buying the mount that only makes sense once you're there.

## The honest bottom line

A compact camera star tracker is the right next step for the vast majority of people asking this question. A full equatorial mount is a telescope-imaging purchase, not a general astrophotography upgrade, and buying one before you own or plan to use a telescope means buying capability you have no current use for.`,
    },
  ],
};
