// Seeds engine_sources with the manufacturer press-terms findings actually
// verified during Growth Phase 2 research.
//
// Run once after 20260821_growth_engine.sql is applied:
//   TC_ADMIN_EMAIL=... TC_ADMIN_PASSWORD=... node scripts/seed-engine-sources.mjs
//
// Every row here reflects what the research actually found. Critically:
//   - media_republication_permitted is FALSE for every single row, because no
//     manufacturer's terms were confirmed as clearing republication for a
//     commercial editorial site. That column is only ever flipped by a human
//     after reading the terms.
//   - discovery_permitted (may we read facts) is separate and is TRUE only for
//     sources whose newsroom is openly readable. Reading facts from a public
//     newsroom is not the same as reusing its photographs.
//   - is_active is FALSE by default so nothing is polled until deliberately
//     switched on in /admin/engine/sources.

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";

const envLocal = readFileSync(".env.local", "utf8");
const env = {};
for (const line of envLocal.split("\n")) {
  const m = line.match(/^([A-Z_0-9]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}

const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
const { error: authError } = await admin.auth.signInWithPassword({
  email: process.env.TC_ADMIN_EMAIL,
  password: process.env.TC_ADMIN_PASSWORD,
});
if (authError) {
  console.error("Sign-in failed:", authError.message);
  process.exit(1);
}

const sources = [
  {
    organisation: "Nintendo",
    url: "https://www.nintendo-europe-press.com",
    source_type: "manufacturer_newsroom",
    categories: ["gaming"],
    trust_level: "primary",
    discovery_permitted: false,
    media_republication_permitted: false,
    media_rights_status: "requires_registration",
    terms_notes:
      "Terms read in full. Editorial/review use of Portal Content is EXPLICITLY permitted once registered as press/content creator, with commentary required (no gallery-format reposting, no strategy guides, no modification). Clearest path of any manufacturer researched. Requires completing registration first.",
    attribution_required: false,
  },
  {
    organisation: "Microsoft Xbox",
    url: "https://news.xbox.com/en-us/media/",
    source_type: "manufacturer_newsroom",
    categories: ["gaming"],
    trust_level: "primary",
    discovery_permitted: true,
    media_republication_permitted: false,
    media_rights_status: "requires_registration",
    terms_notes:
      "Assets licensed 'solely for use by members of the press and media, for editorial and informational purposes'. Attribution 'Used with permission from Microsoft' is mandatory. Practical access appears gated behind the xbox.pxn.world journalist portal. Compliance rules apply (no standalone b-roll reposting, age-gating for trailers).",
    attribution_required: true,
    attribution_text: "Used with permission from Microsoft",
  },
  {
    organisation: "Intel",
    url: "https://newsroom.intel.com/press-kits",
    source_type: "manufacturer_newsroom",
    categories: ["computing"],
    trust_level: "primary",
    discovery_permitted: true,
    media_republication_permitted: false,
    media_rights_status: "unclear_manual_review",
    terms_notes:
      "STRONGEST terms found: indexed newsroom text states media assets are 'free for editorial broadcast, print, online and radio use' with 'Credit: Intel Corporation' attribution. NOT marked confirmed_usable because the primary page could not be loaded live during research — needs one human verification visit to newsroom.intel.com before relying on it.",
    attribution_required: true,
    attribution_text: "Credit: Intel Corporation",
  },
  {
    organisation: "Google",
    url: "https://blog.google/press/",
    source_type: "manufacturer_newsroom",
    categories: ["smartphones", "ai-hardware"],
    trust_level: "primary",
    discovery_permitted: true,
    media_republication_permitted: false,
    media_rights_status: "unclear_manual_review",
    terms_notes:
      "Only stated term is one sentence: 'Images on this page may be used for publication with credit: Source: Google.' Most permissive language found, but too thin to certify commercial-affiliate use. Confirm scope with press@google.com.",
    attribution_required: true,
    attribution_text: "Source: Google",
  },
  {
    organisation: "DJI",
    url: "https://www.mynewsdesk.com/uk/dji/latest_media",
    source_type: "manufacturer_newsroom",
    categories: ["drones-fpv", "action-cameras"],
    trust_level: "primary",
    discovery_permitted: false,
    media_republication_permitted: false,
    media_rights_status: "requires_registration",
    terms_notes:
      "Press assets live on a gated Mynewsdesk newsroom requiring journalist registration; assets carry a 'Media Use' licence whose scope must be read at download. IMPORTANT: DJI's main site terms (dji.com/terms) explicitly prohibit reproducing DJI photographs without prior written consent — the retail site is NOT a source.",
    attribution_required: false,
  },
  {
    organisation: "Apple",
    url: "https://www.apple.com/newsroom/",
    source_type: "manufacturer_newsroom",
    categories: ["smartphones", "computing"],
    trust_level: "primary",
    discovery_permitted: true,
    media_republication_permitted: false,
    media_rights_status: "unclear_manual_review",
    terms_notes:
      "Historic Image Usage Agreement (images.apple.com) is no longer live at its old URL; only third-party quotations remain. Quoted language limits use to 'editorial use by press and/or industry analysts' and bars promotional use — genuinely ambiguous for a monetised review site. Requires written confirmation from Apple PR.",
    attribution_required: false,
  },
  {
    organisation: "Samsung",
    url: "https://www.samsungmobilepress.com/media-assets",
    source_type: "manufacturer_newsroom",
    categories: ["smartphones"],
    trust_level: "primary",
    discovery_permitted: true,
    media_republication_permitted: false,
    media_rights_status: "unclear_manual_review",
    terms_notes:
      "Terms of Use literally restrict to 'personal, informational and non-commercial use', which read literally excludes a commercial editorial site — in tension with the site being a dedicated press portal. Needs Samsung PR clarification.",
    attribution_required: false,
  },
  {
    organisation: "NVIDIA",
    url: "https://nvidianews.nvidia.com/multimedia",
    source_type: "manufacturer_newsroom",
    categories: ["computing"],
    trust_level: "primary",
    discovery_permitted: true,
    media_republication_permitted: false,
    media_rights_status: "unclear_manual_review",
    terms_notes:
      "Openly browsable media library but NO usage terms found either way. Adjacent brand/logo page requires express written authorisation, suggesting a restrictive default. Get written confirmation from press@nvidia.com.",
    attribution_required: false,
  },
  {
    organisation: "AMD",
    url: "https://newsroom.amd.com/media-center/",
    source_type: "manufacturer_newsroom",
    categories: ["computing"],
    trust_level: "primary",
    discovery_permitted: true,
    media_republication_permitted: false,
    media_rights_status: "unclear_manual_review",
    terms_notes:
      "The only readable AMD media terms are a partner/reseller co-marketing licence ('solely in connection with advertising/marketing/sale of Licensee products that include an AMD CPU/GPU') — that does NOT cover independent editorial use. The actual press-image channel (Amplify) could not be accessed. Do not rely on the media-library terms.",
    attribution_required: false,
  },
  {
    organisation: "Sony Interactive Entertainment",
    url: "https://sonyinteractive.com/en/news/asset-library/",
    source_type: "manufacturer_newsroom",
    categories: ["gaming"],
    trust_level: "primary",
    discovery_permitted: true,
    media_republication_permitted: false,
    media_rights_status: "unclear_manual_review",
    terms_notes:
      "Asset Library shows no usage terms; site ToS sets a restrictive default (personal/non-commercial) but states asset-specific terms exist that must be accepted at download — those were JS-gated and unreadable. A separate PlayStation Press Center registration portal also exists.",
    attribution_required: false,
  },
  {
    organisation: "Canon",
    url: "https://www.canon.co.uk/news/image-library/",
    source_type: "manufacturer_newsroom",
    categories: ["cameras-photography", "astrophotography"],
    trust_level: "primary",
    discovery_permitted: true,
    media_republication_permitted: false,
    media_rights_status: "unclear_manual_review",
    terms_notes:
      "Contradictory: the image library says 'press use only, must not be altered', while Canon's general Terms of Use bar reproducing content for any public/commercial purpose and bar use on any other website. No document reconciles these. Needs Canon press-office clarification for our region.",
    attribution_required: false,
  },
  {
    organisation: "GoPro",
    url: "https://gopro.com/en/us/news",
    source_type: "manufacturer_newsroom",
    categories: ["action-cameras"],
    trust_level: "primary",
    discovery_permitted: true,
    media_republication_permitted: false,
    media_rights_status: "requires_registration",
    terms_notes:
      "No self-serve press image library with visible terms (gopro.com/media-library is customer cloud storage, not press assets). Press kit access is by request to pr@gopro.com; resulting terms unknown until that exchange happens.",
    attribution_required: false,
  },
  {
    organisation: "Roborock",
    url: "https://newsroom.roborock.com/us/media",
    source_type: "manufacturer_newsroom",
    categories: ["smart-home-robots"],
    trust_level: "primary",
    discovery_permitted: true,
    media_republication_permitted: false,
    media_rights_status: "unclear_manual_review",
    terms_notes:
      "Real press/media library with downloadable product image packages, but NO usage terms anywhere — only a generic 'Copyright Roborock. All Rights Reserved.' A licence file may exist inside the ZIPs; a human needs to open one or contact press.",
    attribution_required: false,
  },
  {
    organisation: "Amazon Devices",
    url: "https://press.aboutamazon.com/images-and-videos",
    source_type: "manufacturer_newsroom",
    categories: ["smart-home-robots"],
    trust_level: "primary",
    discovery_permitted: true,
    media_republication_permitted: false,
    media_rights_status: "unclear_manual_review",
    terms_notes:
      "Global Press Center image library with a Devices category, no login wall observed, but no explicit licence grant, scope-of-use statement, or attribution requirement found. Non-press parties are redirected to the Trademarks page.",
    attribution_required: false,
  },
  {
    organisation: "TP-Link",
    url: "https://www.tp-link.com/us/press/news/",
    source_type: "manufacturer_newsroom",
    categories: ["networking"],
    trust_level: "primary",
    discovery_permitted: true,
    media_republication_permitted: false,
    media_rights_status: "no_source_found",
    terms_notes:
      "No downloadable press/media image library or media-kit page found anywhere on tp-link.com. Press-release pages carry inline images only, with no separate asset library or usage terms.",
    attribution_required: false,
  },
];

let created = 0;
let skipped = 0;
for (const s of sources) {
  const { error } = await admin.from("engine_sources").insert({
    ...s,
    // Nothing is polled until a human activates it.
    is_active: false,
    check_frequency_hours: 24,
  });
  if (error) {
    if (error.message.includes("duplicate") || error.code === "23505") {
      skipped++;
      continue;
    }
    console.error("FAILED", s.organisation, error.message);
    continue;
  }
  created++;
  console.log("seeded", s.organisation, `(media_rights=${s.media_rights_status})`);
}
console.log(`\nDone. created=${created} already_present=${skipped}`);
console.log("All rows: media_republication_permitted=false, is_active=false — nothing is polled or reusable until a human verifies terms.");
