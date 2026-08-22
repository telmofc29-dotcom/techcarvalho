// Networking / Wi-Fi cluster (August 2026 batch).
//
// Sourcing discipline for this file:
//  * Wi-Fi generation dates are split deliberately into "Wi-Fi Alliance
//    certification" and "IEEE amendment published", because they are different
//    events that are years apart for the recent generations, and collapsing
//    them is the most common factual error in Wi-Fi explainers.
//  * The familiar headline maxima (600 Mbps / 6.9 Gbps / 9.6 Gbps / 46 Gbps)
//    are NOT printed anywhere here: they could not be sourced to Wi-Fi Alliance
//    or IEEE. The IEEE throughput objectives that COULD be sourced are used
//    instead, and labelled as objectives.
//  * The Ofcom upper-6 GHz decision is attributed to Wi-Fi Alliance's account
//    of it, not to Ofcom, because Ofcom's own statement was not retrieved. The
//    body says so, and also flags that Wi-Fi Alliance's own regulatory map
//    still contradicts its own press release on this point.

import type { ContentBatchImport } from "@/lib/content/import-types";

export const networkingCluster2026: ContentBatchImport = {
  content: [
    {
      slug: "wifi-generations-explained-wifi-4-to-wifi-7",
      title: "Wi-Fi 4 to Wi-Fi 7: What Each Generation Actually Changed",
      type: "guide",
      status: "awaiting_media",
      categorySlug: "networking",
      searchIntent: "informational",
      primaryQuery: "wifi generations explained",
      intentFingerprint: "wifi-generations-explained",
      tagSlugs: ["networking", "wifi", "router", "buying-guide"],
      metaTitle: "Wi-Fi 4 to Wi-Fi 7: What Each Generation Actually Changed",
      metaDescription:
        "What each Wi-Fi generation genuinely added, why the certification date and the IEEE date are years apart, and when a newer number on the box changes nothing you can feel.",
      relatedContent: [
        { relatedSlug: "wifi-7-explained-what-changes", type: "related_to" },
        { relatedSlug: "mesh-router-buying-guide-2026", type: "related_to" },
        { relatedSlug: "ethernet-vs-wifi-gaming-video-calls", type: "related_to" },
        { relatedSlug: "home-wifi-troubleshooting-before-buying-hardware", type: "related_to" },
        { relatedSlug: "mesh-wifi-vs-single-router", type: "related_to" },
      ],
      sources: [
        { url: "https://www.wi-fi.org/discover-wi-fi/wi-fi-certified-n", publisher: "Wi-Fi Alliance", reliabilityTier: "primary", claimStatus: "confirmed_fact" },
        { url: "https://www.wi-fi.org/discover-wi-fi/wi-fi-certified-ac", publisher: "Wi-Fi Alliance", reliabilityTier: "primary", claimStatus: "confirmed_fact" },
        { url: "https://www.wi-fi.org/news-events/newsroom/wi-fi-certified-ac-brings-new-advances-in-wi-fi-performance", publisher: "Wi-Fi Alliance", reliabilityTier: "primary", claimStatus: "official_announcement" },
        { url: "https://www.wi-fi.org/discover-wi-fi/wi-fi-certified-6", publisher: "Wi-Fi Alliance", reliabilityTier: "primary", claimStatus: "confirmed_fact" },
        { url: "https://www.wi-fi.org/news-events/newsroom/wi-fi-certified-6-delivers-new-wi-fi-era", publisher: "Wi-Fi Alliance", reliabilityTier: "primary", claimStatus: "official_announcement" },
        { url: "https://www.wi-fi.org/news-events/newsroom/wi-fi-alliance-brings-wi-fi-6-into-6-ghz", publisher: "Wi-Fi Alliance", reliabilityTier: "primary", claimStatus: "official_announcement" },
        { url: "https://www.wi-fi.org/news-events/newsroom/wi-fi-alliance-delivers-wi-fi-6e-certification-program", publisher: "Wi-Fi Alliance", reliabilityTier: "primary", claimStatus: "official_announcement" },
        { url: "https://www.wi-fi.org/discover-wi-fi/wi-fi-certified-7", publisher: "Wi-Fi Alliance", reliabilityTier: "primary", claimStatus: "confirmed_fact" },
        { url: "https://www.wi-fi.org/news-events/newsroom/wi-fi-alliance-introduces-wi-fi-certified-7", publisher: "Wi-Fi Alliance", reliabilityTier: "primary", claimStatus: "official_announcement" },
        { url: "https://www.wi-fi.org/news-events/newsroom/wi-fi-alliance-extends-wi-fi-certified-7-20-mhz-only-devices", publisher: "Wi-Fi Alliance", reliabilityTier: "primary", claimStatus: "official_announcement" },
        { url: "https://standards.ieee.org/ieee/802.11ax/7180/", publisher: "IEEE Standards Association", reliabilityTier: "primary", claimStatus: "confirmed_fact" },
        { url: "https://standards.ieee.org/ieee/802.11be/7516/", publisher: "IEEE Standards Association", reliabilityTier: "primary", claimStatus: "confirmed_fact" },
        { url: "https://www.ieee802.org/11/Reports/802.11_Timelines.htm", publisher: "IEEE 802.11 Working Group", reliabilityTier: "primary", claimStatus: "confirmed_fact" },
        { url: "https://ieeexplore.ieee.org/document/5307322", publisher: "IEEE Xplore", reliabilityTier: "primary", claimStatus: "confirmed_fact" },
        { url: "https://www.wi-fi.org/regulations-enabling-6-ghz-wi-fi", publisher: "Wi-Fi Alliance", reliabilityTier: "primary", claimStatus: "confirmed_fact" },
        { url: "https://www.fcc.gov/document/fcc-opens-6-ghz-band-wi-fi-and-other-unlicensed-uses", publisher: "US Federal Communications Commission", reliabilityTier: "primary", claimStatus: "official_announcement" },
        { url: "https://www.wi-fi.org/news-events/newsroom/wi-fi-alliance-applauds-ofcoms-landmark-decision-enable-wi-fi-access-across", publisher: "Wi-Fi Alliance", reliabilityTier: "primary", claimStatus: "reputable_report" },
      ],
      body: `Router boxes sell a number. Wi-Fi 6, Wi-Fi 6E, Wi-Fi 7 — each arrives with a bigger figure on the front and an implication that the previous one is now obsolete. Some of those numbers describe changes you will genuinely feel. Most describe changes that are real engineering and completely invisible in an ordinary home. This is which is which.

Two things are worth establishing before the history, because almost every wrong claim about Wi-Fi generations comes from getting them muddled.

## Two different dates, and marketing blurs them

Wi-Fi generations have two birthdays.

One is the IEEE amendment — the actual engineering standard, published by the IEEE Standards Association. The other is the Wi-Fi Alliance certification programme, which is the industry body that owns the "Wi-Fi 6" style names and tests products for interoperability.

For the recent generations these are not close together. IEEE lists 802.11ax as published on 19 May 2021, but Wi-Fi Alliance announced that "the Wi-Fi CERTIFIED 6 certification program from Wi-Fi Alliance is now available" on 16 September 2019 — roughly twenty months earlier. The same pattern repeats with Wi-Fi 7: certification arrived on 8 January 2024, while IEEE lists 802.11be as published on 22 July 2025.

That is not a scandal; certification programmes are deliberately built on stable drafts so the industry does not have to wait years for final publication. But it does mean that "the standard wasn't even finished" is a common and technically true criticism of early hardware for any generation, and that dates you see quoted for the same generation can legitimately differ by two years depending on which event is being described.

The second complication: Wi-Fi Alliance's own product pages give a third set of years — it says Wi-Fi 4 "was introduced in 2009", Wi-Fi 5 in 2014, Wi-Fi 6 in 2018 and Wi-Fi 7 in 2024. For Wi-Fi 6, "2018" is when the generation was named, a year before you could buy anything certified. Where this article gives a precise date, it is from the Alliance's own press releases or IEEE's own records, and it says which.

## Wi-Fi 4 (2009): where home Wi-Fi became normal

IEEE published 802.11n on 29 October 2009 as "Amendment 5: Enhancements for Higher Throughput". Its stated design objective was modest by today's standards and worth quoting because it puts the rest of this list in scale: modes of operation "capable of much higher throughputs, with a maximum throughput of at least 100 Mb/s, as measured at the MAC data service access point".

Wi-Fi Alliance's own summary of Wi-Fi 4 is marketing rather than specification — "enhanced performance and speed", "extended reach throughout the home", "support for many users without sacrificing signal strength" — and its current page does not state the bands or channel widths, so this article will not either.

The practical position today: Wi-Fi 4 is the oldest generation still worth tolerating. A smart plug or an old printer sitting on Wi-Fi 4 is not hurting anything. A Wi-Fi 4 router is from a different era of home broadband, and replacing it is one of the few genuinely straightforward upgrade cases in this entire article.

## Wi-Fi 5 (2013/2014): the 5 GHz generation, in two waves

IEEE's 802.11 Working Group timelines put 802.11ac's publication at 18 December 2013; Wi-Fi Alliance says Wi-Fi 5 "was introduced in 2014".

The thing to understand about Wi-Fi 5 is that it shipped in two distinct waves, and the second one matters more than most people realise. Wi-Fi Alliance's June 2016 announcement of the expanded programme describes what wave 2 added: channels went "from 80 MHz to 160 MHz maximum bandwidth", spatial streams went from three to four, and multi-user MIMO arrived — described by the Alliance as networks "capable of multitasking by sending data to multiple devices at once rather than one-at-a-time". The Alliance claimed devices with these features could reach "up to three times the speed of devices supporting only original Wi-Fi CERTIFIED ac features".

So MU-MIMO is a Wi-Fi 5 feature, not a Wi-Fi 6 one. Plenty of coverage gets this wrong.

One structural note that explains a lot of confusion: 802.11ac itself is a 5 GHz specification. A "dual-band Wi-Fi 5 router" is a Wi-Fi 5 radio on 5 GHz sitting alongside an older-generation radio on 2.4 GHz. Wi-Fi Alliance's own product page reflects the product reality rather than the amendment, noting that "most Wi-Fi 5 products are dual-band, operating in both the 2.4 GHz and 5 GHz bands".

This is also the generation that made "is my device on 2.4 GHz or 5 GHz?" the single most useful diagnostic question in home networking — a question that comes up again in our Wi-Fi troubleshooting guide and, unavoidably, in almost every smart-home setup problem.

## Wi-Fi 6 (certified September 2019): efficiency, not headline speed

This is the generation people most often misread, because its additions are about handling many devices at once rather than making one device faster. From Wi-Fi Alliance's own certification announcement:

- OFDMA "effectively shares channels to increase network efficiency and lower latency"
- Downlink MU-MIMO "allows more downlink data to be transferred at once"
- Target Wake Time "significantly improves battery life in Wi-Fi devices"
- 1024-QAM "increases throughput in Wi-Fi devices"
- and the programme "requires the latest generation of Wi-Fi security, Wi-Fi CERTIFIED WPA3"

Read that as a whole and the design intent is unmistakable. Wi-Fi 6 was built for a home with forty connected things in it, not for making a single laptop download faster. If your household has a handful of devices and no congestion, Wi-Fi 6 is solving a problem you do not have. If your network is dense and busy — a shared flat, a house full of smart-home gear — this is the generation where the difference is real, and it shows up as consistency under load rather than as a bigger number in a speed test.

The WPA3 requirement is the quiet one on that list and arguably the most consequential, since it is a security floor rather than a performance feature. It is also, as it happens, a recurring cause of smart-home devices refusing to join a new router.

Target Wake Time is worth singling out for battery-powered devices: it lets a device negotiate when it needs to be awake to talk to the router instead of listening constantly.

## Wi-Fi 6E (named January 2020, certified January 2021): new spectrum, same radio

Wi-Fi 6E is not a new generation. Wi-Fi Alliance is explicit: "Wi-Fi 6E certification as part of Wi-Fi CERTIFIED 6 offers the features and capabilities of Wi-Fi 6, extended to the 6 GHz band."

The name was announced on 3 January 2020 so buyers would have a way to identify 6 GHz-capable devices once regulators opened the band. Certification followed on 7 January 2021, after the US FCC's decision of 23 April 2020 to open the 6 GHz band to unlicensed use — 1,200 megahertz of it.

What that extra spectrum buys, in the Alliance's own words, is room: 6 GHz "addresses Wi-Fi spectrum shortage by providing contiguous spectrum blocks to accommodate 14 additional 80 MHz channels and 7 additional 160 MHz channels".

Contiguous is the operative word. The 2.4 and 5 GHz bands are crowded, fragmented by regulation, and shared with every neighbour in range. 6 GHz arrived clean and wide. That is why a 6 GHz link can feel dramatically better than a 5 GHz one in a block of flats — not because the radio is cleverer, but because nobody else is standing on it yet.

The trade-off is physics and it is not negotiable: higher frequencies attenuate faster through walls and floors. A 6 GHz link is superb in the same room as the router and degrades faster than 5 GHz as you move away. Anyone selling 6 GHz as a coverage improvement has it backwards.

## The 6 GHz catch nobody puts on the box

How much 6 GHz you may legally use depends entirely on where you live, and the world is split into two tiers.

According to Wi-Fi Alliance's regulatory tracker, one group of countries has opened the full 5925 to 7125 MHz range — the whole 1,200 MHz — including the United States, Canada, Brazil, Mexico, Argentina, Colombia, Peru, Costa Rica, Panama, Guatemala, El Salvador, the Dominican Republic, Kazakhstan, Saudi Arabia and South Korea. A much larger group, including the EU member states, Japan, Australia, India, Israel, New Zealand, Singapore, South Africa and the UAE, has opened only the lower portion, 5925 to 6425 MHz — around 500 MHz, well under half. Australia has additionally allowed 6425 to 6585 MHz.

The practical consequence: a Wi-Fi 7 router advertising 320 MHz channels needs enough contiguous 6 GHz spectrum to fit them. In a lower-6 GHz-only country, that capability is substantially constrained by regulation regardless of what the hardware can do. A review written for the US market does not transfer to a European one on this point.

The UK is currently a genuinely confusing case, and we would rather flag that than smooth it over. Wi-Fi Alliance published a press release describing an Ofcom decision of 20 July 2026 making the UK "the first European country to enable Wi-Fi access across the entire 6 GHz band" — licence-exempt access across the full 1,200 MHz. We have not been able to read Ofcom's own statement to confirm the detail directly, so treat that as reported rather than verified here. Adding to the confusion, Wi-Fi Alliance's own regulatory map still lists the UK in the narrower 5925 to 6425 MHz tier, contradicting its own announcement. If you are in the UK and this matters to your purchase, check Ofcom directly rather than trusting any secondary summary, this one included.

## Wi-Fi 7 (certified January 2024): wider channels, and using two bands at once

Wi-Fi Alliance introduced Wi-Fi CERTIFIED 7 on 8 January 2024. IEEE lists 802.11be as published on 22 July 2025, which as noted is the usual pattern rather than an anomaly.

The headline capabilities, in the Alliance's own descriptions:

- 320 MHz channels "available in the 6 GHz band provide twice the throughput of Wi-Fi 6". Twice the width of the widest Wi-Fi 6 channel, and only possible in 6 GHz, because that is the only band with room for it.
- Multi-link operation, "which increases throughput and lowers latency by enabling devices to combine different channels across frequency bands together". The Alliance also frames MLO as supporting "more efficient load balancing of traffic among links, resulting in increased throughput and enhanced reliability".
- 4K QAM, delivering "20% higher transmission rates than 1024 QAM".
- Plus multi-RU, 512 compressed block-ack, triggered uplink access and EPCS.

Of those, multi-link operation is the genuinely new idea. Until Wi-Fi 7, a device was attached to one band at a time and switched between them, with a brief interruption at each switch. MLO lets a device use more than one link simultaneously. The Alliance's own framing puts "enhanced reliability" alongside throughput, and reliability is the half that matters for real use — a connection that survives one band briefly going bad is a better connection even when its peak number is unchanged.

Wi-Fi 7 is also still evolving. On 6 January 2026 Wi-Fi Alliance extended the programme to 20 MHz-only devices, bringing MLO, MU-MIMO and multi-RU to the narrow-channel radios used in Internet-of-Things hardware — a meaningful development for smart-home reliability that has nothing to do with speed.

## About those headline speed numbers

You have seen the figures: 600 Mbps for Wi-Fi 4, several gigabits for Wi-Fi 5, 9.6 Gbps for Wi-Fi 6, tens of gigabits for Wi-Fi 7. We are not printing them, because we could not source a single one of them to Wi-Fi Alliance or to IEEE. They circulate widely, they are broadly in the right region, and they are also theoretical aggregate maxima that assume channel widths, spatial streams and modulation rates no home device combines in practice.

What can be sourced are the IEEE throughput objectives, which are honest about being objectives: 802.11n targeted "at least 100 Mb/s" measured at the MAC service access point, and 802.11be requires "at least one mode of operation capable of supporting a maximum throughput of at least 30 Gbit/s". The gap between those two figures across sixteen years is the real story; the precise decimal on a box is not.

## The number that actually limits you

Your Wi-Fi standard sets a ceiling on the link between your device and your router. It has no effect whatsoever on the speed of the line coming into your building. If your broadband is 100 Mbps, a Wi-Fi 7 router cannot deliver more than that to the internet — it can only ensure the local link is never the bottleneck, and Wi-Fi 5 already was not the bottleneck at that speed.

The second ceiling people forget is the client. A Wi-Fi 7 router talking to a Wi-Fi 5 laptop produces a Wi-Fi 5 connection. Every link negotiates down to what both ends support, so a new router upgrades nothing until the devices you actually care about are also on the new generation.

## When this genuinely does not matter to you

- Your internet connection is the bottleneck. If your line is a few hundred megabits and your devices already reach it in the rooms you use, every generation from Wi-Fi 5 onwards is fast enough and no new standard will move your speed test.
- Your problem is coverage, not throughput. Dead zones are about walls, distance and access-point placement. A newer standard on a higher frequency makes coverage marginally worse, not better. Start with the free checks in our Wi-Fi troubleshooting guide, and treat mesh as a separate question.
- Your devices are older than your router. Buying Wi-Fi 7 for a house of Wi-Fi 5 devices buys a future capability and nothing today.
- You are in a lower-6 GHz-only country and the sales pitch is 320 MHz channels. Check what your regulator has actually opened before paying for a capability the law limits.
- The workload you care about could be wired. For a desktop that never moves, a cable sidesteps this entire article, as our Ethernet versus Wi-Fi piece sets out.

## When a newer generation genuinely is worth buying

- Your network is congested rather than slow: many devices, evening slowdowns, video calls that fall apart when the household is busy. This is exactly what Wi-Fi 6's efficiency features address.
- You live with heavy neighbouring-network interference and 6 GHz is legally available to you. Clean spectrum is the most immediate real-world upgrade on this list.
- You have a multi-gigabit internet connection and want a wireless client to actually use it. Here the Wi-Fi generation genuinely is the limiting factor.
- Your router is old enough to predate WPA3, and you would like a security floor rather than a speed increase.
- You are replacing a failing or genuinely ancient router anyway. Buying current when you are buying regardless is sensible; that is a different decision from replacing a working router because a bigger number exists.

## The short version

Wi-Fi 4 made home wireless usable. Wi-Fi 5 made 5 GHz standard and, in its second wave, introduced MU-MIMO. Wi-Fi 6 made crowded networks behave and made WPA3 a requirement. Wi-Fi 6E opened new spectrum without changing the radio. Wi-Fi 7 widened the channels and let a device use more than one link at once.

Every one of those is a real advance. For most households, on most broadband connections, the last one that changed anything they could feel was the arrival of a working 5 GHz band.`,
    },

    {
      slug: "wifi-connected-but-no-internet",
      title: "Wi-Fi Connected But No Internet: Find the Cause Before You Start Resetting Things",
      type: "troubleshooting",
      status: "awaiting_media",
      categorySlug: "networking",
      searchIntent: "informational",
      primaryQuery: "wifi connected but no internet",
      intentFingerprint: "wifi-connected-but-no-internet",
      tagSlugs: ["networking", "wifi", "router", "troubleshooting"],
      metaTitle: "Wi-Fi Connected But No Internet: The Right Order to Diagnose It",
      metaDescription:
        "Four tests that tell you whether the fault is your device, your router, or your ISP — before you reach for a network reset that erases every saved Wi-Fi password.",
      relatedContent: [
        { relatedSlug: "home-wifi-troubleshooting-before-buying-hardware", type: "related_to" },
        { relatedSlug: "ethernet-vs-wifi-gaming-video-calls", type: "related_to" },
        { relatedSlug: "wifi-generations-explained-wifi-4-to-wifi-7", type: "related_to" },
        { relatedSlug: "mesh-wifi-vs-single-router", type: "related_to" },
      ],
      sources: [
        { url: "https://support.microsoft.com/en-us/windows/fix-wi-fi-connection-issues-in-windows-9424a1f7-6a3b-65a6-4d78-7f07eee84d2c", publisher: "Microsoft Support", reliabilityTier: "primary", claimStatus: "confirmed_fact" },
        { url: "https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/ipconfig", publisher: "Microsoft Learn", reliabilityTier: "primary", claimStatus: "confirmed_fact" },
        { url: "https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/netsh-winsock", publisher: "Microsoft Learn", reliabilityTier: "primary", claimStatus: "confirmed_fact" },
        { url: "https://support.apple.com/en-us/HT204051", publisher: "Apple Support", reliabilityTier: "primary", claimStatus: "confirmed_fact" },
        { url: "https://support.google.com/android/answer/2651367", publisher: "Google", reliabilityTier: "primary", claimStatus: "confirmed_fact" },
        { url: "https://support.google.com/android/answer/9654714", publisher: "Google", reliabilityTier: "primary", claimStatus: "confirmed_fact" },
        { url: "https://www.rfc-editor.org/rfc/rfc3927.html", publisher: "IETF", reliabilityTier: "primary", claimStatus: "confirmed_fact" },
        { url: "https://www.rfc-editor.org/rfc/rfc8910.html", publisher: "IETF", reliabilityTier: "primary", claimStatus: "confirmed_fact" },
        { url: "https://www.rfc-editor.org/rfc/rfc5280.html", publisher: "IETF", reliabilityTier: "primary", claimStatus: "confirmed_fact" },
      ],
      body: `The Wi-Fi icon shows a full connection. The network name is right. And nothing loads.

This is a genuinely useful symptom, because it rules out a whole class of problems immediately. Your device successfully found the access point, authenticated to it, and joined the network. The radio link works. Whatever is broken sits above that link — in the addressing, in name resolution, in the router, or out on your provider's network.

That is why the advice you will most often be given — restart the router, or reset your network settings — is a poor first move. Both are blunt instruments that can work by accident, and one of them destroys real configuration you will have to rebuild. Four quick tests will tell you which part of the chain is at fault, and they take about three minutes.

## Before anything: what a network reset actually costs

Two of the "fixes" commonly recommended for this symptom are destructive, so it is worth knowing the price before you pay it rather than after.

On iPhone and iPad, Apple describes Reset Network Settings as follows: it "resets all Wi-Fi networks and passwords, cellular settings, and VPN and APN settings". Every saved Wi-Fi password on the device, gone — including networks you cannot easily rejoin, like a workplace network you no longer have credentials for.

On Windows, Microsoft describes the network reset as one that "removes any network adapters you have installed and the settings for them. After your PC restarts, any network adapters are reinstalled, and the settings for them are set to the defaults." Microsoft adds that afterwards "you might need to reinstall and set up other networking software you might be using, such as VPN client software". Microsoft itself lists network reset as the last step in its troubleshooting sequence, not the first.

A router factory reset is more expensive again. It typically clears your Wi-Fi name and password, any port forwards, static DHCP leases and, on many setups, the broadband credentials your ISP provided. Do not start there.

## Test 1: is it one device, or all of them?

Pick up a phone and try a website on it, ideally over the same Wi-Fi network. Then, if you can, turn Wi-Fi off on that phone and try again over mobile data.

This single test splits the problem in half, and both Apple and Google put it in their own guidance — Apple advises testing another device on the same network, and Google's Android guidance suggests switching between Wi-Fi and mobile data to isolate where the failure is.

- Only one device is affected: the fault is on that device. Skip to Test 3.
- Every device on the Wi-Fi is affected, but mobile data works: the fault is in your router or upstream of it. Go to Test 2.
- Mobile data is also failing on a site you know is up: the site may simply be down. Try a couple of different, well-known sites before assuming your network is broken.

## Test 2: is it your router, or your ISP?

If everything on the network is affected, the next question is whether the break is inside your home or outside it.

The clearest indicator most people already have: check your router's status lights, and specifically whether the internet or WAN light shows an established connection. Most routers distinguish "the local network is up" from "there is a working line to the provider", and that distinction is exactly what you need here.

If your setup has a separate modem and router — two boxes rather than one — treat them as two separate things to check. Both Apple and Microsoft do: Apple's guidance is to "restart your router and cable modem by unplugging the devices and then plugging them back in", and Microsoft's sequence has you restart the modem and the router, waiting around 30 seconds before powering them back up.

Also worth two minutes: check whether your ISP is reporting an outage, via their status page or app on mobile data. Apple's own guidance ends at exactly this point — if you are connected to Wi-Fi but cannot reach the internet, contact your provider. A surprising share of these incidents are simply someone else's problem, and no amount of resetting your equipment will help.

## Test 3: what address did your device actually get?

This is the test that most often produces an actual diagnosis rather than a guess, and it is the reason this symptom exists as a distinct category.

Joining a Wi-Fi network and getting a usable IP address are two separate steps. Your device can complete the first and fail the second. When that happens on Windows, the device gives itself an address in the 169.254 range — a link-local address, defined in IETF RFC 3927, which a host self-assigns when no address configuration is available. Microsoft calls this Automatic Private IP Addressing, and lists it as one of the three ways a Windows adapter gets configured, alongside DHCP and a manual alternate configuration.

The critical property of these addresses is in the RFC itself: link-local addresses "MUST NOT be sent to any router for forwarding", and they are "not suitable for communication with devices not directly connected to the same physical (or logical) link". In plain terms, a device with a 169.254 address can talk to the local link and nothing beyond it. That is precisely the "connected, no internet" symptom.

On Windows, run ipconfig /all in a command prompt and read the IPv4 address for your Wi-Fi adapter. On a phone, the assigned IP address is usually visible in the network's details screen.

- An address starting 169.254 means DHCP failed. Your router did not hand out an address — because its DHCP service is not running, because its address pool is exhausted, or because something between you and it is interfering. Restarting the router is a legitimate fix for this specific finding, which is quite different from restarting it hopefully.
- A normal private address (typically starting 192.168, 10., or in the 172.16 to 172.31 range) means addressing worked, and you should move on to Test 4.
- A static address someone configured manually, on a network whose addressing has since changed, will produce exactly this symptom too. Microsoft documents a relevant trap here: ipconfig /renew "is available only on computers with adapters that are configured to obtain an IP address automatically", so on a statically configured adapter the command you were told to run does nothing at all.

## Test 4: is it DNS?

If addressing is fine, the next most common culprit is name resolution — your device can reach the network but cannot turn a website name into an address.

The fast test: try to load a site by IP address rather than by name, or try a different app that does not depend on the same resolution path. If numeric addresses work and names do not, you have a DNS problem.

On Windows, Microsoft documents ipconfig /flushdns as flushing and resetting the DNS client resolver cache, noting that "during DNS troubleshooting, you can use this procedure to discard negative cache entries from the cache, as well as any other entries that have been added dynamically". A negative cache entry — a remembered failure — is a real and under-appreciated cause of a name that stays broken after the underlying problem is fixed.

On Android specifically, there is a modern cause worth knowing about: Private DNS. Google documents that "by default, your device uses Private DNS with all networks that can use Private DNS". If a Private DNS provider has been set manually and that provider is unreachable — or is blocked on the network you are currently using — name resolution fails on that network while everything else looks fine. It is found under the network settings on the device and is worth checking before anything more drastic.

## The other real causes, and how to recognise them

**A captive portal you have not signed into.** Hotel, café, airport and campus networks commonly require you to accept terms or log in first. IETF RFC 8910 describes the arrangement directly: users "need to connect to a captive portal device and agree to an Acceptable Use Policy (AUP) and/or provide billing information before they can access the Internet". Modern devices usually detect this and pop up a sign-in page, but detection fails often enough that the symptom presents as plain "connected, no internet". The test is to open a browser and try to load any plain, non-encrypted page and see whether you are redirected.

**A VPN or security product that is intercepting traffic.** Apple's guidance is explicit about this: uninstall VPN or security software, restart, and test again. A VPN whose server is unreachable, or whose kill-switch is active, produces a network that is connected and carries nothing. Disconnect it fully — not just disconnect the tunnel, but disable the client — as a test.

**A wrong system clock.** This one presents strangely: some sites work and secure sites fail with certificate warnings. Certificates carry a validity period, defined in RFC 5280 as "the time interval during which the CA warrants that it will maintain information about the status of the certificate", with explicit start and end times. A device whose clock is badly wrong — often after a battery removal, a long period switched off, or a fresh install — sees valid certificates as not-yet-valid or expired, and refuses the connection. Setting the date and time correctly, or re-enabling automatic time, fixes it instantly.

**Two devices with the same IP address.** If somebody has manually assigned a static address that the router later handed to something else, both devices behave erratically. This is a real failure mode, though we could not find a manufacturer document describing it, so treat it as a hypothesis to test rather than a documented cause: the test is to set the device back to automatic addressing and see whether the problem disappears.

## The Windows commands, and what they actually do

Microsoft's own Wi-Fi troubleshooting sequence includes a step of running network commands, so these are legitimate — but each does something specific, and knowing what saves you from cargo-culting.

- ipconfig /release "sends a DHCPRELEASE message to the DHCP server to release the current DHCP configuration and discard the IP address configuration", and Microsoft warns that it "disables TCP/IP for adapters configured to obtain an IP address automatically". Between release and renew, that machine is off the network. Do not run it over a remote connection.
- ipconfig /renew requests a fresh lease, and as noted works only on adapters set to obtain an address automatically.
- ipconfig /flushdns clears the resolver cache, including remembered failures.
- netsh winsock reset "resets the Winsock catalog to a clean state, removing any custom LSPs to resolve network problems caused by corrupted Winsock settings", though Microsoft notes "it doesn't affect Winsock Name Space Provider entries". Reserve this for a machine where a badly-behaved network product has been installed and removed.
- netsh int ip reset appears in Microsoft's own troubleshooting article, but we could not locate current Microsoft documentation describing exactly what it resets — the reference pages that used to cover it now return errors. We are telling you that rather than inventing a description of it.

Microsoft's broader advice, on the same documentation, is that PowerShell is now the recommended way to manage networking on Windows rather than netsh.

Microsoft's full published order is worth following, because it moves from cheap to expensive: check the connection, confirm airplane mode is off, forget and rejoin the network, restart the modem and router, try the other band, test another device, run the network commands, reinstall the adapter driver, ping the default gateway, disable adapter power saving, check Windows Update, restart — and only then, as a last resort, network reset.

## When this does not matter to you

- One app is broken and everything else works. That is an application or a service outage, not a network problem, and no network change will fix it.
- It resolved itself in under a minute and has not returned. Brief DHCP renewals, band switches and provider blips all produce a momentary version of this symptom. A single, self-healing incident is not worth investigating.
- You are on a public network you have just joined. Assume a captive portal first; everything else on this list is unlikely by comparison.
- Only your work laptop is affected, on a machine your employer manages. Corporate VPN, DNS and certificate policy can all produce this symptom by design. Contact your IT support rather than running resets that may breach policy or lock you out further.

## If nothing here worked

You should now be able to say which of four things is true: the fault is one device, the fault is your router, the fault is upstream at your ISP, or the fault is a specific service. That is a far better position than where you started, and it is the difference between a five-minute support call that gets somewhere and one that does not.

If everything points at the router and it is old, our guide on what to check before buying new hardware covers whether a replacement is genuinely warranted — and if you decide it is, which Wi-Fi generation is actually worth paying for.`,
    },
  ],
};
