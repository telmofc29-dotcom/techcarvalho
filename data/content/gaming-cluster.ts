// Gaming cluster — GAMES THEMSELVES rather than gaming hardware.
//
// The existing gaming category on the site is entirely platform/hardware
// coverage (PS5 vs PS5 Pro, Series X vs S, Game Pass vs PS Plus, HDMI 2.1,
// PS5 storage expansion). Nothing covered the thing readers actually search
// for most: what a specific game needs, what a published requirements box
// really promises, what is genuinely dated, and what is still unannounced.
// That is the gap this batch fills.
//
// SOURCING DISCIPLINE FOR THIS BATCH
// Every figure below — every system requirement, storage number, release
// date, price and hardware-support statement — was read directly from the
// publisher's or vendor's own page (Steam store listings, PlayStation Blog,
// Nintendo's news page, NVIDIA's DLSS page, AMD's GPUOpen FSR 4 page, Intel's
// XeSS repository) on 2026-08-22. Nothing here is a benchmark result:
// TechCarvalho has not run these games, and the copy says so where it
// matters. Where two official sources disagree (Call of Duty: Modern Warfare
// 4's launch date on Steam vs the PlayStation Blog) the disagreement is
// reported as a disagreement rather than silently resolved. Where a figure
// simply is not published (MW4's PC requirements, usable console capacity)
// the copy says it is not published rather than estimating it.

import type { ContentBatchImport } from "@/lib/content/import-types";

// MUST be in the PAST in UTC. RLS requires `status = 'published' AND
// published_at <= now()`, so a date-only intuition ("today is the 22nd, so
// noon on the 22nd is fine") silently publishes a row that no anonymous
// visitor can see — the page 404s while the admin list cheerfully says
// "published". This batch hit exactly that on the first apply.
const PUBLISHED_AT = "2026-08-22T00:30:00.000Z";

export const gamingCluster: ContentBatchImport = {
  content: [
    // ---------------------------------------------------------------- 1
    {
      slug: "pc-game-system-requirements-what-they-mean",
      title: "Minimum and Recommended System Requirements: What They Actually Promise",
      type: "guide",
      status: "published",
      publishedAt: PUBLISHED_AT,
      categorySlug: "gaming",
      searchIntent: "informational",
      primaryQuery: "what do minimum and recommended system requirements mean",
      metaTitle: "Minimum vs Recommended System Requirements: What They Really Mean",
      metaDescription:
        "Publishers rarely say what resolution or frame rate their minimum spec buys you — but a few now do. What current PC requirement boxes actually promise, using their own published wording.",
      tagSlugs: ["gaming", "pc-hardware", "gpu", "buying-guide"],
      relatedContent: [
        { relatedSlug: "game-storage-requirements-2026", type: "related_to" },
        { relatedSlug: "game-upscaling-dlss-fsr-xess-explained", type: "related_to" },
        { relatedSlug: "do-you-need-rtx-5090-for-1440p-gaming", type: "related_to" },
        { relatedSlug: "pc-building-basics-first-build-guide", type: "related_to" },
        { relatedSlug: "what-3d-v-cache-x3d-does-for-gaming", type: "related_to" },
      ],
      linkedProducts: [
        { productSlug: "rtx-5090", role: "mentioned" },
        { productSlug: "rtx-5080", role: "mentioned" },
      ],
      sources: [
        { url: "https://store.steampowered.com/app/3764200/Resident_Evil_Requiem/", publisher: "Capcom / Steam store listing", reliabilityTier: "primary", claimStatus: "confirmed_fact" },
        { url: "https://store.steampowered.com/app/3017860/DOOM_The_Dark_Ages/", publisher: "id Software / Bethesda / Steam store listing", reliabilityTier: "primary", claimStatus: "confirmed_fact" },
        { url: "https://store.steampowered.com/app/4115450/Phantom_Blade_Zero/", publisher: "S-GAME / Steam store listing", reliabilityTier: "primary", claimStatus: "confirmed_fact" },
        { url: "https://store.steampowered.com/app/2713000/Resonance_A_Plague_Tale_Legacy/", publisher: "Asobo Studio / Focus Entertainment / Steam store listing", reliabilityTier: "primary", claimStatus: "confirmed_fact" },
        { url: "https://store.steampowered.com/app/2358720/Black_Myth_Wukong/", publisher: "Game Science / Steam store listing", reliabilityTier: "primary", claimStatus: "confirmed_fact" },
        { url: "https://store.steampowered.com/app/2807960/Battlefield_6/", publisher: "EA / Battlefield Studios / Steam store listing", reliabilityTier: "primary", claimStatus: "confirmed_fact" },
        { url: "https://store.steampowered.com/app/2246340/Monster_Hunter_Wilds/", publisher: "Capcom / Steam store listing", reliabilityTier: "primary", claimStatus: "confirmed_fact" },
        { url: "https://store.steampowered.com/app/3159330/Assassins_Creed_Shadows/", publisher: "Ubisoft / Steam store listing", reliabilityTier: "primary", claimStatus: "confirmed_fact" },
        { url: "https://store.steampowered.com/app/2537590/Microsoft_Flight_Simulator_2024/", publisher: "Asobo Studio / Xbox Game Studios / Steam store listing", reliabilityTier: "primary", claimStatus: "confirmed_fact" },
        { url: "https://store.steampowered.com/app/4435490/Call_of_Duty_Modern_Warfare_4/", publisher: "Activision / Steam store listing", reliabilityTier: "primary", claimStatus: "confirmed_fact" },
      ],
      body: `The two boxes on a PC store page are the most-read and least-explained numbers in gaming. "Minimum" and "Recommended" look like they mean something precise. Usually they don't say what they mean at all — and the handful of publishers who do spell it out have made the gap impossible to ignore.

Everything below is quoted from the publisher's own store listing, checked on 22 August 2026. There are no benchmark numbers in this article, because TechCarvalho has not tested these games. What we can do is read what the publishers actually wrote, which turns out to be more revealing than most people expect.

## The short version

A minimum spec is the configuration below which the publisher will not support you. It is not a promise of a good experience, and unless the listing says otherwise it is not a promise of any particular resolution or frame rate. Recommended is the publisher's idea of a comfortable target — which is very often 1080p or 1440p at 60fps, not 4K, and not maximum settings.

## Most publishers don't tell you the target. A few now do

This is the single most useful thing to check, and most listings omit it entirely. Elden Ring, Cyberpunk 2077 and Baldur's Gate 3 all state hardware without ever saying what resolution or frame rate that hardware is supposed to deliver.

A small group of recent releases do state it, and the wording is worth reading closely:

- Resident Evil Requiem (released 26 February 2026). Minimum: "Supports 1080p gameplay (using upscaling, native resolution of 640p)/30fps." Recommended: "Supports 1080p gameplay (using upscaling, native resolution of 720p)/60fps."
- DOOM: The Dark Ages (released 14 May 2025). Minimum: "1080p / 60 FPS / Low Quality Settings, NVME SSD storage required." Recommended: "1440p / 60 FPS / High Quality Settings, NVME SSD storage required."
- Phantom Blade Zero (dated 28 October 2026). Minimum: "1080p / 30 FPS with upscaling enabled. SSD installation required." Recommended: "1440p / 60 FPS with upscaling enabled."
- Resonance: A Plague Tale Legacy (dated 27 August 2026). Minimum: "30 FPS in 1920x1080 with 'Low' preset." Recommended: "60 FPS in 1920x1080 with the 'Ultra' preset."

Read that Resident Evil Requiem line again, because it is the most honest requirements box currently on Steam. The minimum specification renders the game internally at 640p and upscales it to 1080p, at 30 frames per second. The recommended specification renders at 720p internally and upscales to 1080p at 60. Capcom is telling you exactly what you are buying, and almost nobody else does.

## "Minimum" increasingly means "minimum, with upscaling turned on"

Black Myth: Wukong states it plainly in both its minimum and recommended blocks: "The above specifications were tested with DLSS/FSR/XeSS enabled."

That single sentence changes how you read every number above it. A GTX 1060 6GB is listed as the minimum GPU — but for a scenario where the game is not rendering at the output resolution. Phantom Blade Zero says the same thing in fewer words ("with upscaling enabled") on both columns. Resident Evil Requiem quantifies it.

The practical consequence: if you were planning to play at native resolution with upscaling off, the published minimum spec is not describing your situation, and neither is the recommended one. We have a separate explainer on how the three upscalers differ and which GPUs can run which.

## Recommended is not "max settings"

Of the four listings above that state a target, the most ambitious recommended figure is 1440p at 60fps. Not one of them promises 4K. Resonance: A Plague Tale Legacy is the only one whose recommended tier names its highest preset, and it pairs "Ultra" with 1080p, not 1440p or 4K.

If your goal is 4K, or high-refresh 1440p, or ray tracing turned up, the recommended column is a floor rather than a target, and you are into territory the publisher has not made any claim about at all.

## The requirement that has nothing to do with performance

Some entries in a requirements box are hard gates. No amount of GPU fixes them.

- Battlefield 6 lists, in both columns, "TPM 2.0 Enabled UEFI SECURE BOOT Enabled HVCI Capable VBS Capable". These are platform-security features for its anti-cheat. A machine that cannot enable Secure Boot and TPM 2.0 does not run the game, regardless of how fast it is.
- Assassin's Creed Shadows appends "(REBAR ON)" to its GPU line in both columns — Resizable BAR, a motherboard/firmware setting, not a graphics option.
- Microsoft Flight Simulator 2024 lists a network requirement alongside the hardware: "Network Speed of 10 Mbps Bandwidth" at minimum, "Network Speed of 50 Mbps Bandwidth" at recommended. Very few games put a bandwidth figure in the spec box; this one does because of how much of its content is delivered over the network rather than installed.
- Several 2025 and 2026 listings now say SSD required outright. DOOM: The Dark Ages specifies NVMe.

Check these lines first. They are pass/fail, and they are the ones people discover after buying.

## When the two columns are nearly identical, that is information too

Monster Hunter Wilds lists the same CPU in both columns — "Intel Core i5-10400 or Intel Core i3-12100 or AMD Ryzen 5 3600" appears verbatim as both the minimum and recommended processor. Only the GPU changes, from a GTX 1660 6GB to an RTX 2060 Super 8GB. That tells you where Capcom thinks the bottleneck is, and it tells you that upgrading the CPU alone is unlikely to move you between those two tiers.

Storage behaves the same way. Baldur's Gate 3, Cyberpunk 2077, Elden Ring, Assassin's Creed Shadows and Borderlands 4 all list an identical storage figure in both columns, because the install is the install. Battlefield 6 is the exception worth knowing about: 55 GB at minimum and 80 GB at recommended, which is a hint that higher-quality assets are an optional download rather than a fixed part of the install.

## Sometimes the requirements simply don't exist yet

Call of Duty: Modern Warfare 4 is dated 22 October 2026 on its own Steam listing and priced at $69.99. As of 22 August 2026, roughly two months before launch, both its minimum and its recommended requirement blocks read: "Requires a 64-bit processor and operating system. Additional Notes: TBD."

That is Activision's own listing. Any specific Modern Warfare 4 system requirement circulating right now did not come from the publisher's store page, and should be treated as unverified until that page changes.

## How to read a requirements box in under a minute

- Look for a stated target first — a resolution and a frame rate. If there isn't one, the hardware figures are unanchored and you cannot compare them to another game's.
- Look for the word "upscaling", or a mention of DLSS, FSR or XeSS. If it's there, the numbers assume it is on.
- Look for hard gates: Secure Boot, TPM, Resizable BAR, SSD or NVMe, network bandwidth.
- Compare the two columns to each other. Whatever changes between them is the component the publisher believes is limiting.
- Check the VRAM figure separately from the GPU model. Several listings above specify VRAM independently, and a card that matches the model name with less memory is not the card they tested.

## When this doesn't matter

If you play on console, none of this applies to you: platform holders certify a single fixed configuration, and that is the whole point of a console.

If your PC already exceeds the recommended column by a wide margin on a game of this generation, you can stop reading the boxes and start looking at settings guides instead — the requirements box has nothing left to tell you.

If you are playing games that are more than a few years old, the minimum column is almost certainly irrelevant, because it was written for a hardware landscape that has moved on.

And if you are genuinely happy at 1080p with a controller on a TV, the minimum tier on most of these listings is describing something quite close to what you already want, and the upgrade the recommended column implies may buy you less than the price suggests.

## What this article deliberately does not contain

No frame-rate measurements, no "we tested this on an RTX 4070" claims, and no estimates of what a card not named in a listing would do. TechCarvalho has not benchmarked these titles. Everything above is the publisher's own published wording, read on 22 August 2026, and requirement boxes are edited after launch — if a figure here disagrees with the store page today, the store page is right.`,
    },

    // ---------------------------------------------------------------- 2
    {
      slug: "game-storage-requirements-2026",
      title: "How Much Storage Modern Games Actually Need",
      type: "guide",
      status: "published",
      publishedAt: PUBLISHED_AT,
      categorySlug: "gaming",
      searchIntent: "informational",
      primaryQuery: "how much storage do modern games need",
      metaTitle: "Game Storage Requirements in 2026: How Much SSD You Actually Need",
      metaDescription:
        "Published install sizes for current PC games, why the SSD stopped being optional, and what console storage really leaves you. Every figure quoted from the publisher's own listing.",
      tagSlugs: ["gaming", "pc-hardware", "playstation", "xbox", "buying-guide"],
      relatedContent: [
        { relatedSlug: "pc-game-system-requirements-what-they-mean", type: "related_to" },
        { relatedSlug: "ps5-storage-expansion-compatible-ssd-guide", type: "related_to" },
        { relatedSlug: "xbox-series-x-vs-series-s", type: "related_to" },
        { relatedSlug: "ps5-digital-vs-disc-edition", type: "related_to" },
        { relatedSlug: "pc-building-basics-first-build-guide", type: "related_to" },
      ],
      linkedProducts: [
        { productSlug: "playstation-5", role: "mentioned" },
        { productSlug: "xbox-series-x", role: "mentioned" },
        { productSlug: "xbox-series-s", role: "mentioned" },
      ],
      sources: [
        { url: "https://store.steampowered.com/app/1086940/Baldurs_Gate_3/", publisher: "Larian Studios / Steam store listing", reliabilityTier: "primary", claimStatus: "confirmed_fact" },
        { url: "https://store.steampowered.com/app/2358720/Black_Myth_Wukong/", publisher: "Game Science / Steam store listing", reliabilityTier: "primary", claimStatus: "confirmed_fact" },
        { url: "https://store.steampowered.com/app/3159330/Assassins_Creed_Shadows/", publisher: "Ubisoft / Steam store listing", reliabilityTier: "primary", claimStatus: "confirmed_fact" },
        { url: "https://store.steampowered.com/app/1285190/Borderlands_4/", publisher: "Gearbox / 2K / Steam store listing", reliabilityTier: "primary", claimStatus: "confirmed_fact" },
        { url: "https://store.steampowered.com/app/3017860/DOOM_The_Dark_Ages/", publisher: "id Software / Bethesda / Steam store listing", reliabilityTier: "primary", claimStatus: "confirmed_fact" },
        { url: "https://store.steampowered.com/app/2807960/Battlefield_6/", publisher: "EA / Battlefield Studios / Steam store listing", reliabilityTier: "primary", claimStatus: "confirmed_fact" },
        { url: "https://store.steampowered.com/app/1938090/Call_of_Duty/", publisher: "Activision / Steam store listing", reliabilityTier: "primary", claimStatus: "confirmed_fact" },
        { url: "https://store.steampowered.com/app/1808500/ARC_Raiders/", publisher: "Embark Studios / Steam store listing", reliabilityTier: "primary", claimStatus: "confirmed_fact" },
        { url: "https://www.playstation.com/en-us/ps5/", publisher: "Sony Interactive Entertainment", reliabilityTier: "primary", claimStatus: "confirmed_fact" },
        { url: "https://www.xbox.com/en-US/consoles/xbox-series-x", publisher: "Microsoft", reliabilityTier: "primary", claimStatus: "confirmed_fact" },
      ],
      body: `A 1TB drive sounded generous a few years ago. Five current games can fill more than half of it. Here is what publishers are actually asking for, taken from their own store listings on 22 August 2026, and what that means for how much space to buy.

## Published install sizes, current PC releases

These are the figures in the "Storage" line of each game's own Steam listing:

- Baldur's Gate 3 — 150 GB, with "SSD required" in both columns.
- Black Myth: Wukong — 130 GB. Minimum says "HDD Supported, SSD Recommended"; recommended says "SSD Required".
- Assassin's Creed Shadows — 115 GB, "The game must be installed on a SSD."
- Borderlands 4 — 100 GB, "SSD storage required".
- DOOM: The Dark Ages — 100 GB, "NVME SSD storage required".
- Monster Hunter Wilds — 75 GB.
- Resonance: A Plague Tale Legacy — 75 GB, "SSD Required".
- Cyberpunk 2077 — 70 GB.
- Elden Ring — 60 GB.
- The Blood of Dawnwalker — 60 GB, "Storage on SSD".
- Battlefield 6 — 55 GB minimum, 80 GB recommended.
- Onimusha: Way of the Sword — 50 GB.
- Microsoft Flight Simulator 2024 — 50 GB, alongside a stated network bandwidth requirement.
- Call of Duty (the shared Call of Duty HQ listing) — "SSD with 161 GB available space at launch".

Two things jump out. The first is that the biggest number on this list belongs to a 2023 role-playing game, not a 2026 shooter — install size tracks how much uncompressed audio, video and texture data a game ships, not how new it is. The second is that Call of Duty's figure is the only one carrying an explicit hedge: "at launch". Activision is telling you the number will move.

## The SSD stopped being optional, and you can watch it happen

Black Myth: Wukong (August 2024) is the clean illustration. Its minimum tier still says "HDD Supported". Its recommended tier says "SSD Required". That is a game shipped during the transition.

Everything on the list from 2025 onward that mentions storage type at all requires an SSD, and DOOM: The Dark Ages goes further and specifies NVMe in both columns. If you are still running games from a mechanical hard drive, that is now the constraint, not a preference.

## Some publishers don't publish a figure at all

ARC Raiders, released 30 October 2025, has no storage line in either its minimum or its recommended block on Steam. Neither does Resident Evil Requiem, and neither does Phantom Blade Zero. Call of Duty: Modern Warfare 4's entire requirements block currently reads "TBD".

There is no way to plan around a number that has not been published, and estimating one would just be guessing with extra steps. If a game you are waiting for has no storage figure, budget generously and check again nearer launch.

## Console storage: what is advertised and what we can't tell you

From the platform holders' own product pages:

- PlayStation 5 — 1TB on the current standard model; the Digital Edition is listed at 825GB.
- Xbox Series X — "1TB Custom NVME SSD", with a "2TB Custom NVME SSD" Galaxy Black Special Edition.

Here is the honest part: neither Sony's nor Microsoft's product page states how much of that is actually free after system software and formatting overhead. Figures for usable capacity circulate widely, but we could not verify one from a first-party source while researching this piece, so we are not going to print one. What is certain is that the usable figure is meaningfully lower than the advertised figure, on every console, for the same reasons it is on every drive.

Put that next to the install sizes above and the arithmetic is uncomfortable: on a 1TB console, three or four current big-budget games plus their updates is a full drive.

Expanding PS5 storage has a specific and easily-mistaken set of requirements — interface, sequential read speed, and a heatsink height limit that catches people out. We have a separate guide covering exactly which drives qualify.

## What the install-size number still doesn't include

The storage line covers the base install. It does not cover the day-one patch, later seasonal content, locally-cached shader compilation, screenshots and video captures, or a second copy that exists mid-update while a patch is being applied. None of those have published figures either. The practical effect is that a game listed at 100 GB should be planned for as noticeably more than 100 GB, and a drive that is 95 percent full will cause update failures long before it causes performance problems.

## A sizing rule that holds up

- Count the games you genuinely keep installed at once, not the size of your library. For most people that number is between three and six.
- Multiply by roughly 100 GB for current big-budget titles. Older or smaller games pull the average down a lot.
- Add the operating system, and leave real headroom on top — a drive kept near capacity is a drive that fails updates.
- Buy capacity over peak sequential speed if you have to choose. Every game above requires an SSD; only DOOM specifies NVMe; none of them list a required read speed on PC.

## When this doesn't matter

If you play two or three games and rotate slowly, a 1TB drive is genuinely fine and a bigger one is money spent on nothing. Deleting a finished 100 GB game takes thirty seconds.

If your library is mostly indie, older, or competitive multiplayer titles, the figures above are wildly unrepresentative — the games that dominate playtime charts are frequently a tenth of the size of the ones that dominate install-size charts.

If you are a console player who only ever has one live-service game installed, storage expansion is likely the least valuable upgrade available to you, and the money is better spent almost anywhere else.

And if you are choosing between a faster small drive and a slower large one for gaming specifically, note again that not one PC listing above states a required read speed. Capacity is the constraint that current games actually name.`,
    },

    // ---------------------------------------------------------------- 3
    {
      slug: "game-upscaling-dlss-fsr-xess-explained",
      title: "DLSS, FSR and XeSS: Why Game Requirements Now Assume You're Upscaling",
      type: "guide",
      status: "published",
      publishedAt: PUBLISHED_AT,
      categorySlug: "gaming",
      searchIntent: "informational",
      primaryQuery: "dlss vs fsr vs xess difference",
      metaTitle: "DLSS vs FSR vs XeSS: What Each One Needs and What It Does",
      metaDescription:
        "Vendor-documented differences between NVIDIA DLSS, AMD FSR 4 and Intel XeSS — which GPUs support what, and why published game requirements now assume upscaling is switched on.",
      tagSlugs: ["gaming", "gpu", "nvidia", "amd", "pc-hardware"],
      relatedContent: [
        { relatedSlug: "pc-game-system-requirements-what-they-mean", type: "related_to" },
        { relatedSlug: "do-you-need-rtx-5090-for-1440p-gaming", type: "related_to" },
        { relatedSlug: "rtx-5090-vs-rtx-5080-worth-the-upgrade", type: "related_to" },
        { relatedSlug: "nvidia-rtx-gpu-market-2026-state", type: "related_to" },
        { relatedSlug: "why-amd-has-no-2026-flagship-gpu", type: "related_to" },
      ],
      linkedProducts: [
        { productSlug: "rtx-5090", role: "mentioned" },
        { productSlug: "rtx-5080", role: "mentioned" },
        { productSlug: "amd-rx-7900-xtx", role: "mentioned" },
      ],
      sources: [
        { url: "https://www.nvidia.com/en-us/geforce/technologies/dlss/", publisher: "NVIDIA", reliabilityTier: "primary", claimStatus: "confirmed_fact" },
        { url: "https://gpuopen.com/fidelityfx-super-resolution-4/", publisher: "AMD (GPUOpen)", reliabilityTier: "primary", claimStatus: "confirmed_fact" },
        { url: "https://github.com/intel/xess", publisher: "Intel", reliabilityTier: "primary", claimStatus: "confirmed_fact" },
        { url: "https://store.steampowered.com/app/3764200/Resident_Evil_Requiem/", publisher: "Capcom / Steam store listing", reliabilityTier: "primary", claimStatus: "confirmed_fact" },
        { url: "https://store.steampowered.com/app/2358720/Black_Myth_Wukong/", publisher: "Game Science / Steam store listing", reliabilityTier: "primary", claimStatus: "confirmed_fact" },
        { url: "https://store.steampowered.com/app/4115450/Phantom_Blade_Zero/", publisher: "S-GAME / Steam store listing", reliabilityTier: "primary", claimStatus: "confirmed_fact" },
      ],
      body: `Upscaling moved from an optional setting to a load-bearing assumption without most people noticing. It is now written into published system requirements — sometimes explicitly, sometimes as a footnote — and the three vendor implementations have meaningfully different hardware rules. Here is what each vendor documents, and what that means when you are reading a store page.

## What upscaling actually does

The game renders at a lower internal resolution than the one on your monitor, then a reconstruction step produces the output image. Fewer pixels rendered means more frames per second. How good the result looks depends entirely on the quality of that reconstruction step, which is where the three vendors differ.

This is separate from frame generation, which is a different technology that gets bundled under the same brand names. More on that below, because conflating them causes most of the confusion in this area.

## The evidence that requirements now assume it

You do not have to take anyone's word for this. It is in the requirement boxes:

- Black Myth: Wukong, in both its minimum and recommended blocks: "The above specifications were tested with DLSS/FSR/XeSS enabled."
- Resident Evil Requiem, minimum: "Supports 1080p gameplay (using upscaling, native resolution of 640p)/30fps." Recommended: the same, from a native 720p, at 60fps.
- Phantom Blade Zero, minimum: "1080p / 30 FPS with upscaling enabled." Recommended: "1440p / 60 FPS with upscaling enabled."

The hardware named in those boxes is not the hardware required to run the game at native output resolution. It is the hardware required to run it with reconstruction doing part of the work.

## NVIDIA DLSS

NVIDIA describes DLSS as "a revolutionary suite of neural rendering technologies that uses AI to boost FPS, reduce latency, and improve image quality." It is a suite, not one feature, and the suite is where the GPU-generation rules live. Per NVIDIA's own support table:

- Super Resolution — the upscaler itself. RTX 20, 30, 40 and 50 series.
- DLAA — anti-aliasing at native resolution, no upscaling. RTX 20, 30, 40 and 50 series.
- Ray Reconstruction — improves ray-traced scenes. RTX 20, 30, 40 and 50 series.
- Frame Generation — RTX 40 and 50 series only.
- Multi Frame Generation — RTX 50 series only. NVIDIA describes it as generating up to five frames per rendered frame.
- Dynamic Multi Frame Generation — RTX 50 series only.

The practical takeaway: if a game's requirement box assumes DLSS, an RTX 20-series card can satisfy the upscaling part of that assumption. The frame-generation features are a much narrower hardware window.

## AMD FSR 4

AMD describes FSR 4 as "a cutting-edge ML upscaler combined with analytical frame generation to deliver a massive increase in framerates in supported games."

The hardware rule is stricter than the older FSR versions people remember, and it comes with a fallback that is easy to miss. AMD's own wording: "AMD FidelityFX Super Resolution 4 upscaling requires an AMD Radeon RX 9000 Series GPU or better and can only be used on appropriate hardware. When running on other hardware the AMD FidelityFX API will automatically select AMD FidelityFX Super Resolution 3.1.5."

That fallback matters. Turning "FSR" on in a game on an older Radeon card does not give you FSR 4 — it silently gives you FSR 3.1.5, which is a different, non-machine-learning algorithm. If you have read that FSR 4 substantially closed the image-quality gap with DLSS, that improvement is tied to RX 9000-series hardware and AMD's RDNA 4 architecture, not to the FSR brand name in a settings menu.

## Intel XeSS

XeSS is the vendor-agnostic one, and Intel documents it that way. Intel describes XeSS as "a set of real-time AI-based technologies that drastically boost your frame rate at the highest visual quality while keeping your game responsive," currently shipping as the XeSS 3 SDK. Its components:

- XeSS Super Resolution — "boosts frame rates on all GPUs with SM 6.4 (DP4a) support."
- XeSS Frame Generation — "available on discrete and integrated Intel Arc GPUs, as well as non-Intel GPUs with SM 6.4 support."
- Xe Low Latency (XeLL) — "available on discrete and integrated Intel Arc GPUs, as well as non-Intel GPUs when combined with XeSS-FG."

Shader Model 6.4 with DP4a support is a broad target that includes plenty of non-Intel hardware. In practice XeSS is the option most likely to be available to you on an older or mixed-vendor system, which is exactly why Black Myth: Wukong lists all three brands together rather than one.

## Upscaling and frame generation are not the same thing

Upscaling reduces the work needed to produce each rendered frame. Frame generation produces additional frames between rendered ones. Both raise the number on your frame counter; they do not do the same thing to how the game feels.

One structural signal worth noting — and this is our reading of the vendors' own documentation rather than something either company states as a caveat: both NVIDIA and Intel pair frame generation with a dedicated latency-reduction technology, and Intel goes as far as making XeLL a requirement of XeSS-FG integration. A generated frame does not carry new input sampling, so a latency-reduction layer exists alongside frame generation for a reason. If you are chasing responsiveness rather than smoothness, that is the distinction to hold onto.

## How to read this when buying

- If a game states a requirement "with upscaling enabled", check that your card supports the specific upscaler that game implements, not just "an upscaler".
- On Radeon, check the FSR version, not the FSR logo. FSR 4 upscaling means RX 9000 series or newer, per AMD.
- On GeForce, upscaling support goes back to RTX 20; frame generation does not.
- If your GPU is from neither vendor's recent generations, XeSS Super Resolution is the widest-compatibility option, by Intel's own description.

## When this doesn't matter

If you already hit your monitor's refresh rate at native resolution in the games you play, upscaling is solving a problem you do not have, and enabling it costs image quality for frames you cannot display.

If you play primarily competitive multiplayer titles, most players in that category are better served by lowering settings than by reconstruction — and frame generation in particular is a poor fit for the thing those players actually care about.

If you play at 1080p, upscaling has the least raw material to work with. Reconstruction quality improves as the internal resolution rises, which is why the 4K case is the one vendors demonstrate.

And if your GPU predates the relevant feature entirely, no settings menu will change that. The fallback behaviour AMD documents is the clearest example: the option still appears, but you are not getting the technology you read about.

## What we have not done here

TechCarvalho has not run image-quality comparisons or measured frame rates for any of these technologies. Every hardware-support statement above is quoted from NVIDIA's, AMD's or Intel's own documentation as published on 22 August 2026, and every requirement quote is from the game's own store listing. Vendor support matrices change with driver and SDK releases; check the vendor page before making a purchase decision on the strength of one.`,
    },

    // ---------------------------------------------------------------- 4
    {
      slug: "call-of-duty-modern-warfare-4-confirmed-details",
      title: "Call of Duty: Modern Warfare 4: What's Actually Confirmed",
      type: "news",
      status: "published",
      publishedAt: PUBLISHED_AT,
      categorySlug: "gaming",
      searchIntent: "informational",
      primaryQuery: "call of duty modern warfare 4 release date system requirements",
      metaTitle: "Call of Duty: Modern Warfare 4 — Confirmed Date, Price, Beta and Open Questions",
      metaDescription:
        "What Activision and Sony have actually published about Modern Warfare 4: the launch date (and the two-source discrepancy), price, beta schedule, and why there are still no PC system requirements.",
      tagSlugs: ["gaming", "playstation", "xbox", "pc-hardware"],
      relatedContent: [
        { relatedSlug: "confirmed-game-release-dates-late-2026", type: "related_to" },
        { relatedSlug: "pc-game-system-requirements-what-they-mean", type: "related_to" },
        { relatedSlug: "game-storage-requirements-2026", type: "related_to" },
        { relatedSlug: "xbox-game-pass-vs-playstation-plus-comparison", type: "related_to" },
        { relatedSlug: "ps5-vs-ps5-pro-worth-it", type: "related_to" },
      ],
      linkedProducts: [
        { productSlug: "playstation-5", role: "mentioned" },
        { productSlug: "playstation-5-pro", role: "mentioned" },
      ],
      sources: [
        { url: "https://store.steampowered.com/app/4435490/Call_of_Duty_Modern_Warfare_4/", publisher: "Activision / Steam store listing", reliabilityTier: "primary", claimStatus: "confirmed_fact" },
        { url: "https://blog.playstation.com/2026/08/21/call-of-duty-modern-warfare-4-new-multiplayer-and-early-access-beta-details/", publisher: "PlayStation Blog (Sony Interactive Entertainment)", reliabilityTier: "primary", claimStatus: "official_announcement" },
        { url: "https://news.xbox.com/en-us/", publisher: "Xbox Wire (Microsoft)", reliabilityTier: "primary", claimStatus: "official_announcement" },
      ],
      body: `Modern Warfare 4 is close enough to launch that a lot of specific-sounding information is circulating. This is the subset that comes from Activision's or Sony's own pages, checked on 22 August 2026 — plus, just as usefully, the things that are still not published.

## The release date, and a discrepancy worth flagging

Two official sources give two different dates.

Activision's own Steam store listing dates the game 22 October 2026. The PlayStation Blog post published on 21 August 2026 states: "Call of Duty: Modern Warfare 4 launches October 23."

Both are first-party. Neither page reconciles the other. The most likely explanation is the ordinary one — storefront dates and regional launch times often land either side of midnight, and Call of Duty has historically unlocked in the evening of the day before its nominal date in some regions — but that is our inference, not a statement either company has made. Until one of them clarifies, treat the launch as the 22nd-to-23rd of October 2026 and check your own storefront for the local unlock time. Anyone giving you a single confident date is choosing one of two official sources without telling you the other exists.

## Price

$69.99 on the Steam listing, in the US market. That is the figure Activision itself is publishing.

## Premise

From the store listing's own description: "War erupts on the Korean Peninsula as North Korea launches an invasion that threatens to destabilize the world in Call of Duty: Modern Warfare 4."

## The beta schedule

From the PlayStation Blog post of 21 August 2026:

- Early Access Beta — running through 25 August at 10:00am PT.
- Open Beta, weekend two — 28 August at 10:00am PT through 1 September at 10:00am PT.
- The beta period detailed in that post is PlayStation 5.

Sony also lists what is playable during it: classic 6v6 modes including Team Deathmatch, Domination, Hardpoint, Kill Confirmed and Search and Destroy; two new modes named Inflation and Hijack; a Kill Block mode running in 3v3 and 10v10 Gunfight variants with dynamic map reconfiguration; and Ground War: Combat Outpost, a 24v24 vehicle-and-infantry mode. One campaign mission, "Entrenched", is playable. Twenty-two weapons are available. Progression to level 30 earns eight beta rewards that carry into the full release, and weekend two adds a Warzone Resurgence mode on a new map called Zodiac.

## Not published: PC system requirements

This is the most-searched thing about the game and the answer is that Activision has not published it.

As of 22 August 2026, both the minimum and the recommended blocks on the official Steam listing read: "Requires a 64-bit processor and operating system. Additional Notes: TBD."

Two months from a dated launch, there is no published CPU, GPU, memory or storage figure. Any specific Modern Warfare 4 requirement you see quoted right now did not come from that page. For what it is worth as context rather than prediction, the shared Call of Duty HQ listing that current Call of Duty titles install through states "SSD with 161 GB available space at launch" — that is a real published figure for the existing install, not a forecast for this game.

## Not confirmed here: subscription availability

We could not verify from a first-party Xbox source, during research for this piece, whether Modern Warfare 4 is a day-one Game Pass title. Xbox Wire's published Game Pass announcements as of 22 August 2026 do not address it. Rather than infer from the pattern of previous years, we are recording it as unverified — if this matters to your purchase, wait for an Xbox Wire post rather than a roundup.

Our existing comparison of what the two subscription services actually include covers how day-one access works on each platform generally.

## What is genuinely unknown

- PC system requirements, including storage.
- Whether the 22nd or the 23rd is the operative date in your region.
- Subscription availability at launch.
- Anything about post-launch content beyond the Warzone Resurgence map named for the beta.

## When this doesn't matter

If you buy Call of Duty every year regardless, none of the above changes your decision, and the beta is a better use of your time than any preview article including this one.

If you play exclusively on console, the missing PC requirements are irrelevant to you — the platform holders certify the hardware and the game will run.

And if you are building or upgrading a PC specifically to play this game, the honest advice is to wait. Building against unpublished requirements means building against a guess, and there is a dated launch two months away that will replace the guess with a number.`,
    },

    // ---------------------------------------------------------------- 5
    {
      slug: "confirmed-game-release-dates-late-2026",
      title: "Late 2026 Game Release Dates: What's Actually Dated",
      type: "news",
      status: "published",
      publishedAt: PUBLISHED_AT,
      categorySlug: "gaming",
      searchIntent: "informational",
      primaryQuery: "game release dates late 2026",
      metaTitle: "Confirmed Game Release Dates: Late 2026 Calendar",
      metaDescription:
        "Every date below is taken from the publisher's or platform holder's own listing, not a roundup — plus what is still undated, and how to check a release date yourself.",
      tagSlugs: ["gaming", "playstation", "xbox", "nintendo", "gta-6"],
      relatedContent: [
        { relatedSlug: "call-of-duty-modern-warfare-4-confirmed-details", type: "related_to" },
        { relatedSlug: "gta-6-release-date-status", type: "related_to" },
        { relatedSlug: "switch-2-vs-switch-whats-new", type: "related_to" },
        { relatedSlug: "next-gen-console-rumor-tracker-ps6-xbox", type: "related_to" },
        { relatedSlug: "pc-game-system-requirements-what-they-mean", type: "related_to" },
      ],
      linkedProducts: [
        { productSlug: "nintendo-switch-2", role: "mentioned" },
        { productSlug: "playstation-5", role: "mentioned" },
        { productSlug: "xbox-series-x", role: "mentioned" },
      ],
      sources: [
        { url: "https://store.steampowered.com/search/?filter=popularcomingsoon", publisher: "Valve / Steam store", reliabilityTier: "primary", claimStatus: "confirmed_fact" },
        { url: "https://store.steampowered.com/app/4115450/Phantom_Blade_Zero/", publisher: "S-GAME / Steam store listing", reliabilityTier: "primary", claimStatus: "confirmed_fact" },
        { url: "https://store.steampowered.com/app/2638890/Onimusha_Way_of_the_Sword/", publisher: "Capcom / Steam store listing", reliabilityTier: "primary", claimStatus: "confirmed_fact" },
        { url: "https://store.steampowered.com/app/3751260/The_Blood_of_Dawnwalker/", publisher: "Rebel Wolves / Bandai Namco / Steam store listing", reliabilityTier: "primary", claimStatus: "confirmed_fact" },
        { url: "https://store.steampowered.com/app/2713000/Resonance_A_Plague_Tale_Legacy/", publisher: "Asobo Studio / Focus Entertainment / Steam store listing", reliabilityTier: "primary", claimStatus: "confirmed_fact" },
        { url: "https://store.steampowered.com/app/4435490/Call_of_Duty_Modern_Warfare_4/", publisher: "Activision / Steam store listing", reliabilityTier: "primary", claimStatus: "confirmed_fact" },
        { url: "https://www.nintendo.com/us/whatsnew/", publisher: "Nintendo", reliabilityTier: "primary", claimStatus: "official_announcement" },
        { url: "https://blog.playstation.com/", publisher: "PlayStation Blog (Sony Interactive Entertainment)", reliabilityTier: "primary", claimStatus: "official_announcement" },
      ],
      body: `Release-date roundups are usually copied from other roundups, which is how a rumoured window becomes a "confirmed date" in about three hops. Every date below was read on 22 August 2026 from the publisher's own store listing or the platform holder's own site. Where something is not dated, it says so.

## Dated on the publisher's own store listing

- Resonance: A Plague Tale Legacy — 27 August 2026.
- METAL GEAR SOLID: MASTER COLLECTION Vol.2 — 27 August 2026.
- STAR WARS Zero Company — 27 August 2026.
- The Blood of Dawnwalker — 2 September 2026.
- Onimusha: Way of the Sword — 3 September 2026.
- Call of Duty: Modern Warfare 4 — 22 October 2026 on Steam. Note that the PlayStation Blog states 23 October; we cover that discrepancy separately.
- Phantom Blade Zero — 28 October 2026.

## Dated by the platform holder

From Nintendo's own news page:

- ELDEN RING Tarnished Edition, Nintendo Switch 2 — 28 August 2026.
- Minecraft for Nintendo Switch 2 — 27 October 2026.

## Dated, and covered separately

Grand Theft Auto VI is set for 19 November 2026 on PlayStation 5 and Xbox Series X/S. That date, the pricing, and the state of the unannounced PC version are covered in detail in our dedicated piece, which also explains why this particular date looks more solid than the two that preceded it.

## What a store date does and doesn't mean

A date on a "Coming soon" store listing is the publisher's current commitment, published by the publisher. That is the strongest signal available before launch, and it is a genuinely different thing from a window mentioned in an interview or a date attributed to an insider.

It is not a guarantee. Store listings are edited, and a date on a page in August is a statement about August. Three specific caveats are worth carrying:

- A date can be regional. Modern Warfare 4 currently shows 22 October on Steam and 23 October on the PlayStation Blog, which is exactly the sort of gap that turns into an argument in comment sections.
- A date can be platform-specific. A game dated on Steam is dated on Steam; console and PC dates diverge routinely, and a Nintendo listing says nothing about the PlayStation version.
- A dated listing with no system requirements is not fully specified. Modern Warfare 4's requirement blocks still read "TBD", and several dated 2026 titles publish no storage figure at all.

## What is not dated

Plenty of heavily-anticipated titles have no publisher-published date at this point, and we are not going to fill that gap with reporting-of-reporting. If a game is not in the list above, the honest status for the purposes of this article is: no date on a first-party page as of 22 August 2026. That is not the same as "delayed", and it is not the same as "coming soon" — it is simply unpublished.

Next-generation console timing sits in the same bucket, with one real exception: Microsoft has confirmed a 2027 developer-kit milestone for its next Xbox hardware, while consumer launch windows for both it and PlayStation's next console remain reporting rather than announcement. Our rumour tracker separates those layers properly.

## How to check a date yourself in thirty seconds

- Go to the game's own store page — Steam, PlayStation Store, Xbox, or Nintendo — rather than a news article about it.
- Check whether the page says "Coming soon" with a specific day, or only a month, quarter or year. A month-only listing is a window, not a date.
- Check the platform you actually own. The date on one storefront is not the date on another.
- If a date appears only in coverage and not on any first-party page, it is a report, not an announcement, regardless of how confident the headline sounds.

## When this doesn't matter

If you buy games months after release when they are patched and discounted — which is, statistically, the sensible thing to do — a launch calendar is entertainment rather than planning.

If you are on a single platform, most of this list is noise; three or four of these titles are the only ones you can actually buy.

And if you are timing a hardware purchase around a specific game, note that the two most-anticipated releases on this calendar have either no published PC requirements at all, or no announced PC version. A calendar tells you when. It does not yet tell you what you will need.`,
    },
  ],
};
