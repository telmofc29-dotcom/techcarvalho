// Smart home cluster (August 2026 batch).
//
// Sourcing discipline: Matter and Thread claims are quoted from the
// Connectivity Standards Alliance and the Thread Group respectively. What
// BREAKS without internet is largely architectural reasoning rather than a
// vendor claim, and the body labels it as such instead of dressing it up as
// documented behaviour — vendors do not generally publish "here is what stops
// working when your broadband dies" pages.

import type { ContentBatchImport } from "@/lib/content/import-types";

export const smartHomeCluster2026: ContentBatchImport = {
  content: [
    {
      slug: "smart-home-local-vs-cloud-control",
      title: "Local vs Cloud Smart Home: What Still Works When Your Internet Goes Down",
      type: "guide",
      status: "awaiting_media",
      categorySlug: "smart-home-robots",
      searchIntent: "informational",
      primaryQuery: "smart home local control vs cloud",
      intentFingerprint: "smart-home-local-vs-cloud-control",
      tagSlugs: ["smart-home", "matter", "thread", "networking", "buying-guide"],
      metaTitle: "Local vs Cloud Smart Home: What Works Without Internet",
      metaDescription:
        "Which parts of a smart home keep working when the broadband drops, which quietly do not, and how to tell which kind you are buying before you buy it.",
      relatedContent: [
        { relatedSlug: "matter-smart-home-standard-explained", type: "related_to" },
        { relatedSlug: "thread-vs-zigbee-vs-wifi-smart-home", type: "related_to" },
        { relatedSlug: "smart-home-starter-guide-where-to-begin", type: "related_to" },
        { relatedSlug: "wifi-connected-but-no-internet", type: "related_to" },
      ],
      sources: [
        { url: "https://csa-iot.org/all-solutions/matter/", publisher: "Connectivity Standards Alliance", reliabilityTier: "primary", claimStatus: "confirmed_fact" },
        { url: "https://csa-iot.org/newsroom/matter-arrives/", publisher: "Connectivity Standards Alliance", reliabilityTier: "primary", claimStatus: "official_announcement" },
        { url: "https://www.threadgroup.org/What-is-Thread/Thread-Benefits", publisher: "Thread Group", reliabilityTier: "primary", claimStatus: "confirmed_fact" },
        { url: "https://www.threadgroup.org/What-is-Thread/Overview", publisher: "Thread Group", reliabilityTier: "primary", claimStatus: "confirmed_fact" },
      ],
      body: `There is a specific and slightly humiliating moment that happens in a lot of smart homes: the broadband goes down, and the lights stop responding to the app. Not the lights themselves — the bulbs have power, the switch on the wall works — but the app on the phone in your hand, connected to the same Wi-Fi as the bulb four feet away, cannot turn it off.

That is not a fault. It is an architecture. And it is one you choose, usually without being told you are choosing it, at the moment you buy the device.

## The two paths a command can take

When you tap a button in a smart-home app, the instruction reaches the device by one of two routes.

The local path stays inside your house: your phone talks to a hub, a bridge or the device itself over your own network, and the device acts. Nothing leaves the building.

The cloud path leaves and comes back: your phone sends the instruction to the manufacturer's servers, those servers send it on to the device, and the device acts. The command travels perhaps hundreds of miles to move something four feet away.

The cloud path is not stupid. It is far simpler to build, it makes remote access from outside the home trivial, and it lets a manufacturer add features to devices already in people's houses. But it has two consequences that manufacturers rarely put on the box: the device stops responding when your internet is down or the manufacturer's servers have a bad day, and the device stops working entirely if the manufacturer ever switches those servers off.

## What Matter actually promises here

Matter is the interoperability standard from the Connectivity Standards Alliance, whose 1.0 specification and certification programme were announced on 4 October 2022.

On the question at hand, the Alliance lists "consistent and responsive local connectivity" as one of Matter's key features. That is the relevant claim, and it is a meaningful one: local connectivity is a design goal of the standard rather than an optional extra a vendor might implement.

The Alliance also describes what Matter runs on. Its 1.0 announcement states that "this initial release of Matter, running over Ethernet, Wi-Fi, and Thread, and using Bluetooth Low Energy for device commissioning, will support a variety of common smart home products", and its Matter page similarly describes the protocol running "on Wi-Fi and Thread network layers" and using "Bluetooth Low Energy for commissioning".

Two practical consequences follow. Bluetooth is used for setup, not for running the device — so a device that needs Bluetooth to be paired does not need it thereafter. And a Matter device is on one of Ethernet, Wi-Fi or Thread, which means the reliability of your smart home is the reliability of that underlying network, not of Matter itself.

## What Thread adds, in the Thread Group's own words

Thread is the low-power mesh many Matter devices use. The Thread Group describes it as "a low-power and low-latency wireless mesh networking protocol built using open and proven standards", and as an "open IPv6 based protocol" that "provides device-to-device and device-to-cloud connections".

The claim that matters most for resilience is this one: "Thread networks have no single point of failure and include the ability to self-heal."

That is a genuine architectural difference from a hub-and-spoke system where every device depends on one bridge. In a mesh, mains-powered devices relay for each other, and a route that breaks is re-formed around the gap. It is also worth being precise about what it does not promise: no single point of failure inside the Thread mesh is not the same as no single point of failure in your smart home. Something still has to connect that mesh to the rest of your network, and if you have exactly one of those, that is a single point of failure you have introduced yourself.

## What we can and cannot tell you about the outage case

Here the honest thing to do is separate what is documented from what is reasoning.

Documented: Matter is designed for local connectivity, and Thread is a self-healing mesh with no single point of failure. Both are direct claims from the bodies that define them.

Not documented, and presented here as our own analysis rather than as anyone's published claim: manufacturers do not generally publish a page explaining what stops working when your broadband dies. So the following is architectural inference — reliable inference, but you should know which kind of statement you are reading.

- Control from inside the home, on a local setup, should survive an internet outage, because the command never needed to leave the house. This is the entire point of local control.
- Control from inside the home, on a cloud-only device, will not survive it, because the command's route is broken at the first hop out of the building.
- Control from outside the home fails in both cases. Remote access is a cloud feature by definition; if your internet is down, nothing outside can reach in regardless of how local your setup is. Anyone promising otherwise is describing a VPN, which is a different thing.
- Voice assistants are the awkward middle case. Speech recognition on the major assistants has historically been a cloud operation, so a voice command can fail even when the device it targets is perfectly reachable on your local network. Some assistants have added local processing for some commands on some hardware; whether yours does is a question for your specific device's documentation, and we are not going to generalise it.
- Adding a new device usually needs the internet even on a local system, because commissioning typically involves account sign-in and certificate checks.
- Firmware updates need the internet, always. They come from the manufacturer.

## The failure mode nobody plans for

An internet outage lasts hours. A manufacturer shutting down its servers lasts forever.

Cloud-dependent devices have a dependency on a company's continued willingness to run infrastructure for hardware it already sold you. When that willingness ends, the hardware does too — not degraded, not reduced to local-only, but off. This has happened repeatedly across the smart-home industry, and it is the strongest practical argument for preferring local control on anything you are fitting semi-permanently: a light switch in a wall, a thermostat, a lock.

The corollary is a buying rule that costs nothing to apply: the more physically embedded a device is, the more it should be able to work without its manufacturer.

## How to tell what you are actually buying

Before you buy, three checks:

- Look for Matter or Thread support explicitly. Matter's local-connectivity design goal is the clearest signal available that a device is built for local control. Note that a device can be Matter-certified and still expose its more advanced features only through the manufacturer's own app, over the cloud — Matter guarantees a common baseline, not every feature.
- Check whether it needs an account to function, or only to set up. A device that will not operate without a signed-in cloud account is telling you where its control path goes.
- Check whether there is a physical control. A smart bulb you can also switch at the wall degrades gracefully. One controllable only by app does not.

After you buy, there is a decisive test, and it takes two minutes: unplug your router, wait for your phone to leave the Wi-Fi, then reconnect the phone to the router's Wi-Fi with the router's internet connection still down. Now try to control the device. Whatever still works is your local setup. Whatever does not was never local, whatever the marketing said.

## When this genuinely does not matter to you

- Your internet is reliable and your devices are conveniences. If a smart speaker and two lamps go quiet for the twenty minutes a year your connection drops, that is not a problem worth restructuring a house around.
- You are already committed to one ecosystem and happy in it. Ripping out working devices to chase local control is rarely worth the cost and effort. Apply this thinking to the next purchase instead.
- The devices are genuinely portable. A plug-in speaker or a lamp you can reach and switch by hand has an obvious manual fallback. The stakes rise with how hard the device is to reach or replace.
- You want remote access more than resilience. These pull in opposite directions, and remote control from anywhere is a legitimate thing to prioritise. Just make the trade knowingly.

## When it should change what you buy

- Anything wired into the fabric of the building. Switches, thermostats, valves, locks. These are ten-year purchases, and ten years is a long time to bet on a server staying up.
- Anything with a safety or security role. A lock or an alarm that depends on someone else's cloud has a failure mode you cannot fix from inside your own house.
- Any household where the internet is genuinely unreliable. If your connection drops weekly, cloud-dependent devices will annoy you weekly. This is the case where local control stops being a philosophical preference and becomes a functional requirement.
- If you are starting from scratch. The cost of choosing local-capable devices at the beginning is roughly zero. The cost of converting later is every device you already bought.

## The short version

Matter is designed for local connectivity, and Thread is a self-healing mesh with no single point of failure. Together they make a genuinely local smart home practical in a way it was not a few years ago.

But local capability is a property of each device, not of the standard, and the only way to know what you have is to test it: cut the internet, keep the Wi-Fi, and see what still answers.`,
    },
  ],
};
