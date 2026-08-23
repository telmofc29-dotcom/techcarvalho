// Smartphones cluster (August 2026 batch).
//
// Sourcing discipline: the support-window figures are quoted from Google's and
// Samsung's own support pages, including Samsung's "up to" qualifier, which is a
// ceiling rather than a commitment and is NOT flattened into a bare "7 years"
// anywhere in this file or in its graphic. Apple's window is recorded as not
// published because we could not verify an Apple page stating one — that is an
// acknowledged gap, not an inference that no such commitment exists.

import type { ContentBatchImport } from "@/lib/content/import-types";

export const smartphoneCluster2026: ContentBatchImport = {
  content: [
    {
      slug: "phone-software-support-how-long-will-it-get-updates",
      title: "How Long Will Your Phone Get Updates? The Spec That Now Decides Its Lifespan",
      type: "guide",
      status: "awaiting_media",
      categorySlug: "smartphones",
      searchIntent: "commercial",
      primaryQuery: "how many years of updates phone",
      intentFingerprint: "phone-software-support-window",
      tagSlugs: ["smartphones", "software-updates", "buying-guide", "consumer-hardware"],
      metaTitle: "How Long Will Your Phone Get Software Updates?",
      metaDescription:
        "Google promises seven years on recent Pixels and Samsung says up to seven. What those figures actually cover, what the clock starts from, and why one of them is a ceiling.",
      relatedContent: [
        { relatedSlug: "which-flagship-phone-should-you-buy-2026", type: "related_to" },
        { relatedSlug: "is-yearly-phone-upgrade-worth-it", type: "related_to" },
        { relatedSlug: "phone-battery-degradation-explained-when-to-worry", type: "related_to" },
        { relatedSlug: "iphone-17-pro-vs-galaxy-s26-ultra-vs-pixel-10-pro", type: "related_to" },
      ],
      sources: [
        { url: "https://support.google.com/pixelphone/answer/4457705", publisher: "Google", reliabilityTier: "primary", claimStatus: "confirmed_fact" },
        { url: "https://security.samsungmobile.com/workScope.smsb", publisher: "Samsung Mobile Security", reliabilityTier: "primary", claimStatus: "confirmed_fact" },
      ],
      body: `For about a decade, the honest answer to "how long will this phone last?" was about the battery and the screen. It is not any more. Phones now physically outlive their software support by years, and the date the updates stop is the date the phone stops being a sensible thing to put your bank app on.

That makes the support window a spec — arguably the most important one on the sheet, and the only one that manufacturers were not publishing at all until very recently. Two of them now do, in their own words, and the wording differs in a way that matters.

## What Google actually promises

Google's Pixel support page is unusually specific. For the newer devices: "Pixel 8 and later phones will get updates for 7 years starting from when the device first became available on the Google Store in the US." Google lists the covered models explicitly, running from the Pixel 8 and 8 Pro through the current generation.

For the models immediately before that, the figure is lower. Google states that the Pixel 6, Pixel 6 Pro, Pixel 6a, Pixel 7, Pixel 7 Pro, Pixel 7a and the original Pixel Fold receive "5 years of OS and security updates", again starting from their US Google Store availability date.

And Google is equally direct about the end of the road. It lists the Pixel 5a with 5G, Pixel 5, Pixel 4a (5G), Pixel 4a, Pixel 4, Pixel 3a, Pixel 3, Pixel 2 and the original Pixel under a plain heading: these phones "no longer receive Android version updates and security updates".

Two details in that wording are easy to skim past and both cost you real time:

- The clock starts from when the device first became available, not from when you bought it. Buy a phone eighteen months into its life — which is exactly what a discounted older model is — and eighteen months of that window is already gone. On a five-year device bought two years late, you are getting three.
- Google's phrasing covers OS and security updates together for the 5-year devices, and says "updates" for the 7-year devices. Those are the two things that matter, and it is worth checking the current page for your specific model rather than assuming the tier.

## What Samsung actually says, and why the wording matters

Samsung's own mobile security site states: "As of January 2024, we are extending our security update support for Samsung Galaxy devices by up to 7 years, to help our users enjoy the latest Galaxy experiences longer and securely."

Read that carefully, because "up to" is doing a lot of work. It is a ceiling, not a floor. It does not say every Galaxy device gets seven years; it says none gets more. Which devices reach the ceiling, and which get considerably less, is a per-model question.

Samsung is also explicit that the update cadence differs by device: "Samsung releases monthly, quarterly and biannual firmware security updates on selected Samsung devices." Its flagship foldables, the Galaxy S series and selected enterprise models sit in the monthly tier; older and mid-range devices are on quarterly. Both are legitimate — a quarterly cadence is not abandonment — but a monthly-patched phone and a biannually-patched one are not the same product in a security sense, and the box does not tell you which you are buying.

Samsung publishes the per-model lists on that same security page. It is the only reliable way to find out which tier a specific handset is in, and it is worth two minutes before purchase.

## What we could not verify about Apple

We are not going to give you a number for the iPhone, because we could not source one.

Apple has a long and well-observed track record of supporting iPhones with new iOS releases for a considerable number of years — longer than most Android manufacturers managed historically. But a track record is not a published commitment, and we could not locate an Apple support page that states a fixed support window in years the way Google's and Samsung's pages do.

So we are recording it as not published rather than inferring a figure from past behaviour. If Apple does publish such a commitment somewhere we have not found, that is a gap in our research rather than a statement that no commitment exists — and either way, an unstated policy is a weaker guarantee for a buyer than a stated one, however good the history behind it.

The practical check available to any iPhone buyer is a different one: look at which devices the current iOS release supports, and how old the oldest of them is. That tells you what Apple is doing now, which is the best available proxy in the absence of a promise.

## What "supported" actually gets you

Not all updates are the same thing, and conflating them is how a phone gets described as supported when it is not really.

- Security patches are the ones that matter for safety. They fix the vulnerabilities that let a malicious website or app get further than it should. A phone that has stopped receiving these is a phone you should not be doing banking on, regardless of how well it works.
- OS version upgrades bring new features and, usually, new platform-level protections. They are the visible ones, and the ones marketing counts.
- App compatibility is the third clock, and nobody controls it directly. App developers eventually raise their minimum OS version, and once your phone cannot run the last supported OS, apps start dropping off one by one. This typically begins to bite a year or two after OS upgrades stop, not immediately.

A phone that gets security patches but no new OS versions is in a perfectly reasonable state for a while. A phone that gets neither is on a timer.

## When this genuinely does not matter to you

- You replace your phone every two or three years anyway. A seven-year window is irrelevant if you will have moved on in year three. Buy on the things you will actually notice — camera, screen, battery life — and treat the support window as a resale-value factor rather than a personal one. Our piece on whether a yearly upgrade is worth it goes into that trade directly.
- The device is not doing anything sensitive. An old phone repurposed as a music player, a dashcam, a kids' camera or a smart-home controller on its own network is a genuinely good use for hardware past its support window. The risk comes from what it has access to, not from its age.
- You are buying a cheap phone with a short window on purpose. A two-year support window on an inexpensive handset is a coherent choice if you know that is what you are getting. The problem is paying flagship money for a short window, not the short window itself.

## When it should change what you buy

- You keep phones a long time. This is the whole argument. If your last phone lasted five years, the support window is the single most consequential spec on the page, and the gap between a five-year and a seven-year commitment is two extra years of the phone being safe to use.
- You are buying an older model to save money. Work out the remaining window, not the headline one. The discount on a two-year-old flagship is real, and so is the fact that you are buying into a support window already two years spent.
- You are buying for someone who will not upgrade on schedule. A phone bought for a parent or a child is likely to be kept until it dies. The support window is doing the work there, not the processor.
- You need a specific patch cadence. If your workplace requires monthly security patches, that puts a hard constraint on which devices qualify, and Samsung's own tier list is the place to check it.

## How to check before you buy

Three steps, none of which take long:

- Find the manufacturer's own support page for the exact model, not a review's summary of it. Google's Pixel update page and Samsung's mobile security site both list devices individually.
- Establish the start date of the window. It is the device's original availability, not your purchase.
- Subtract. The number you are left with is the one that matters, and on a discounted older model it is often startlingly small.

## The short version

Google publishes a firm seven years for Pixel 8 and later, and five for the Pixel 6 and 7 generations, counted from original availability rather than from your purchase. Samsung publishes up to seven years, which is a ceiling that not every model reaches, with a patch cadence that varies from monthly to biannual by device. We could not verify a published figure for the iPhone, and we would rather tell you that than print a number we cannot stand behind.

Whatever you buy, do the subtraction. A support window is measured from a date that has usually already passed.`,
    },
  ],
};
