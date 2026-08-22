// One-off, hand-verified Wikimedia Commons import for the drones /
// action-camera product group. Same proven route as
// scripts/import-test-media.ts (which unblocked the first 6 Canon products)
// and deliberately NOT a general-purpose importer.
//
// WHY THIS EXISTS AS A SCRIPT AND NOT A UI CLICK-THROUGH: the record of
// *which* file page was opened, *what* was on it, and *why* it was accepted
// has to survive the session that did the work. Each entry below was
// individually verified by opening the Commons file page (raw wikitext, so
// the licence template is read directly rather than inferred from a rendered
// badge) AND the file's full EXIF block, checking for the failure mode that
// got File:Canon_EOS_5D.jpg rejected in the earlier batch: an EXIF copyright
// statement contradicting the CC badge on the page.
//
// Findings recorded per file in VERIFICATION below. Products in the same
// group that could NOT be unblocked, and exactly why, are written up in
// docs/product-media-strategy.md — a rejection is a finding, not an absence.
//
// Rights posture, unchanged from the rest of this project:
//   - A Commons licence tag is a CLAIM, not proof. rights_status='verified'
//     is set only because a human opened each page, not because the source
//     category implies it.
//   - No cropping. The image fetched is Commons' own downscale of the
//     untouched original (a pure resize, conventionally not an adaptation
//     under CC BY-SA 4.0 §1(a)); nothing is cut off the frame, so there is
//     no "changes were made" to disclose beyond the scale.
//   - attribution_required=true and a real creator/source_url on every row:
//     the credit line is a licence CONDITION, and it is rendered by
//     src/components/public/product-lead-media.tsx.
//
// Usage: TC_ADMIN_EMAIL=... TC_ADMIN_PASSWORD=... npx tsx scripts/import-commons-media-drones-actioncams.ts

import { loadEnvLocal, createAdminClient } from "./_shared";
import { MEDIA_PRIVATE_BUCKET, MEDIA_PUBLIC_BUCKET } from "../src/lib/media/constants";
import { evaluatePublishEligibility } from "../src/lib/media/rights.ts";
import { evaluateMediaReadiness } from "../src/lib/media/requirements.ts";

loadEnvLocal();

const COMMONS_API = "https://commons.wikimedia.org/w/api.php";
const USER_AGENT = "TechCarvalhoBot/1.0 (+https://www.techcarvalho.com)";
// Wikimedia rate-limits rapid sequential requests even with a descriptive
// User-Agent (a real 429 was hit on the 3rd request during the earlier
// import). Deliberately slow for a one-time, single-digit-file batch.
const REQUEST_SPACING_MS = 7000;
// Pure downscale of the untouched original, produced by Commons' own
// thumbnailer. Not a crop: aspect ratio and framing are preserved exactly.
const TARGET_WIDTH = 1600;

type Item = {
  productSlug: string;
  commonsTitle: string;
  commonsPageUrl: string;
  creator: string;
  license: string;
  attribution: string;
  altText: string;
  /** What was actually checked on the file page, kept with the data it justifies. */
  verification: string;
};

const ITEMS: Item[] = [
  {
    productSlug: "dji-mini-4-pro",
    commonsTitle: "File:2024 Dron DJI Mini 4 Pro (03).jpg",
    commonsPageUrl: "https://commons.wikimedia.org/wiki/File:2024_Dron_DJI_Mini_4_Pro_(03).jpg",
    creator: "Jacek Halicki",
    license: "CC BY-SA 4.0",
    attribution: "Photo: Jacek Halicki, CC BY-SA 4.0, via Wikimedia Commons",
    altText:
      "DJI Mini 4 Pro folding camera drone photographed head-on against a white background, arms extended, gimbal camera centred",
    verification:
      "Wikitext: {{Information|source={{own}}|author=[[User:Jacek Halicki]]|permission=(empty)}} + {{self|cc-by-sa-4.0}}. " +
      "EXIF: Artist='Jacek Halicki', NO Copyright field and no reserved-rights assertion; shot on a Nikon D5300, so it is a " +
      "photograph OF the drone, not one taken BY it. Commons Quality Image. " +
      "MODEL CONFIRMED VISUALLY: 'MINI 4 PRO' is printed on the port-side arm and legible in frame — this is not a Mini 3 Pro.",
  },
  {
    productSlug: "dji-air-3s",
    commonsTitle: "File:2024 Dron DJI Air 3S (2).jpg",
    commonsPageUrl: "https://commons.wikimedia.org/wiki/File:2024_Dron_DJI_Air_3S_(2).jpg",
    creator: "Jacek Halicki",
    license: "CC BY-SA 4.0",
    attribution: "Photo: Jacek Halicki, CC BY-SA 4.0, via Wikimedia Commons",
    altText:
      "DJI Air 3S camera drone photographed head-on against a white background, arms extended, dual-lens gimbal camera centred",
    verification:
      "Wikitext: {{Information|source={{own}}|author=[[User:Jacek Halicki]]|permission=(empty)}} + {{self|cc-by-sa-4.0}}. " +
      "EXIF: Artist='Jacek Halicki', NO Copyright field; Nikon D5300. Commons Quality Image. " +
      "MODEL CONFIRMED VISUALLY: 'AIR 3S' is printed on the starboard arm and legible in frame — not an Air 3 or Air 2S.",
  },
  {
    productSlug: "dji-osmo-action-5-pro",
    commonsTitle: "File:Osmo Action Pro 5 Camera ZVE05411.jpg",
    commonsPageUrl: "https://commons.wikimedia.org/wiki/File:Osmo_Action_Pro_5_Camera_ZVE05411.jpg",
    creator: "Habib M'henni",
    license: "CC BY-SA 4.0",
    attribution: "Photo: Habib M'henni, CC BY-SA 4.0, via Wikimedia Commons",
    altText:
      "DJI Osmo Action 5 Pro action camera, front three-quarter view showing the rear touchscreen and the f/2.8 lens ring",
    verification:
      "Wikitext: {{Information|source={{Own work}}|author=[[User:Dyolf77|Habib M'henni]]|permission=(empty)}} + " +
      "{{self|cc-by-sa-4.0}}. EXIF: no Artist and NO Copyright field — nothing contradicting the licence; shot on a Sony " +
      "ZV-E10. The author's own credit template states 'You are free to use it for any purpose as long as you credit me and " +
      "follow the terms of the license', preferred credit 'Habib Mhenni / Wikimedia Commons'. " +
      "MODEL CONFIRMED VISUALLY: 'ACTION 5 PRO' is printed on the front face — not an Action 4 or Action 3.",
  },
  {
    productSlug: "gopro-hero13-black",
    commonsTitle: "File:GoPro Héro 13 Black - 01.jpg",
    commonsPageUrl: "https://commons.wikimedia.org/wiki/File:GoPro_H%C3%A9ro_13_Black_-_01.jpg",
    creator: "François Leblond (User:François de Dijon)",
    license: "CC BY-SA 4.0",
    attribution: "Photo: François Leblond, CC BY-SA 4.0, via Wikimedia Commons",
    altText:
      "GoPro HERO13 Black action camera mounted on a flexible tripod, front view showing the front screen and lens",
    verification:
      "Wikitext: {{Information|source={{own}}|author=[[User:François de Dijon]]|permission=(empty)}} + {{self|cc-by-sa-4.0}}. " +
      "EXIF: Artist='Francois Leblond', Copyright='Francois Leblond' — a bare authorship assertion naming the same person, " +
      "NOT an 'all rights reserved' statement, and therefore not in conflict with CC BY-SA (which leaves copyright with the " +
      "author). The uploader's Commons user page identifies a long-standing French amateur photographer with a large " +
      "own-work catalogue, consistent with the real name in EXIF. Shot on a Nikon D750. " +
      "MODEL CONFIRMED VISUALLY: sibling frames from the same session (files 05 and 06 in Category:GoPro Hero 13 black) " +
      "show '13 BLACK' printed on the side of this same camera on this same tripod — not a HERO12.",
  },
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Commons returns an HTML error page (not JSON) when it rate-limits, so a
// bare .json() would throw something unrelated to the real problem.
async function commonsApi(params: Record<string, string>): Promise<unknown> {
  const url = `${COMMONS_API}?${new URLSearchParams({ format: "json", formatversion: "2", ...params })}`;
  await sleep(REQUEST_SPACING_MS);
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT, Accept: "application/json" } });
  const text = await res.text();
  if (!text.startsWith("{")) {
    throw new Error(`Commons returned a non-JSON response (${res.status}) for ${url}: ${text.slice(0, 200)}`);
  }
  return JSON.parse(text);
}

type ThumbInfo = { thumburl: string; width: number; height: number; mime: string };

async function resolveThumb(title: string): Promise<ThumbInfo> {
  const json = (await commonsApi({
    action: "query",
    titles: title,
    prop: "imageinfo",
    iiprop: "url|size|mime",
    iiurlwidth: String(TARGET_WIDTH),
  })) as {
    query?: {
      pages?: {
        missing?: boolean;
        imageinfo?: { thumburl?: string; thumbwidth?: number; thumbheight?: number; mime?: string }[];
      }[];
    };
  };
  const page = json.query?.pages?.[0];
  if (!page || page.missing) throw new Error(`Commons file page not found: ${title}`);
  const ii = page.imageinfo?.[0];
  if (!ii?.thumburl || !ii.thumbwidth || !ii.thumbheight) {
    throw new Error(`No thumbnail available for ${title}`);
  }
  return { thumburl: ii.thumburl, width: ii.thumbwidth, height: ii.thumbheight, mime: ii.mime ?? "image/jpeg" };
}

function sanitizeFileName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9.]+/g, "-").replace(/^-+|-+$/g, "");
}

// Reads the real pixel dimensions out of the JPEG we actually downloaded.
//
// This is NOT belt-and-braces. MediaWiki's imageinfo API will hand back a
// `thumburl` for a LARGER pre-rendered bucket than the `iiurlwidth` asked for
// (asking for 1600 returned .../1920px-... every time in this batch) while
// still reporting `thumbwidth`/`thumbheight` as the *requested* size. Trusting
// those fields recorded media_assets.width/height 20% too small on all four
// rows of the first run. The bytes are the only authority on their own size.
function jpegDimensions(buf: Buffer): { width: number; height: number } | null {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) {
      i++;
      continue;
    }
    const marker = buf[i + 1];
    // SOF0..SOF15, excluding DHT (c4), JPG (c8) and DAC (cc) which share the range.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    }
    i += 2 + buf.readUInt16BE(i + 2);
  }
  return null;
}

async function main() {
  const client = await createAdminClient();
  const { data: userData, error: userError } = await client.auth.getUser();
  if (userError || !userData.user) throw new Error(`Could not resolve authenticated admin user: ${userError?.message}`);
  const adminId = userData.user.id;
  console.log(`Authenticated as ${userData.user.email}`);

  const slugs = ITEMS.map((i) => i.productSlug);
  const { data: products, error: productsError } = await client
    .from("products")
    .select("id, slug, name, is_published")
    .in("slug", slugs);
  if (productsError) throw new Error(`products lookup failed: ${productsError.message}`);
  const bySlug = new Map((products ?? []).map((p) => [p.slug, p]));

  for (const item of ITEMS) {
    const product = bySlug.get(item.productSlug);
    if (!product) {
      console.error(`SKIP: product slug "${item.productSlug}" not found — check spelling.`);
      continue;
    }
    console.log(`\n=== ${product.name} [${product.slug}] ===`);

    // Idempotency: media_assets rows have no natural upsert key per target,
    // so a re-run after a partial failure must not create a second hero.
    const { data: existingLink, error: linkLookupError } = await client
      .from("product_media")
      .select("id")
      .eq("product_id", product.id)
      .eq("role", "hero")
      .maybeSingle();
    if (linkLookupError) {
      console.error(`  FAILED to check existing hero link: ${linkLookupError.message}`);
      continue;
    }
    if (existingLink) {
      console.log("  SKIP: already has a hero image.");
      continue;
    }

    const thumb = await resolveThumb(item.commonsTitle);
    console.log(`  Downloading ${thumb.thumburl} (${thumb.width}x${thumb.height})`);
    await sleep(REQUEST_SPACING_MS);
    const res = await fetch(thumb.thumburl, { headers: { "User-Agent": USER_AGENT } });
    if (!res.ok) {
      console.error(`  FAILED to download: ${res.status} ${res.statusText}`);
      continue;
    }
    const contentType = res.headers.get("content-type") ?? thumb.mime;
    const buffer = Buffer.from(await res.arrayBuffer());

    const measured = jpegDimensions(buffer);
    if (!measured) {
      console.error("  FAILED: could not read dimensions from the downloaded bytes — refusing to record a guess.");
      continue;
    }
    if (measured.width !== thumb.width) {
      console.log(
        `  NOTE: Commons served a ${measured.width}px bucket for a ${thumb.width}px request; recording the real size.`
      );
    }

    const fileName = sanitizeFileName(`${item.productSlug}-${item.commonsTitle.replace(/^File:/, "")}`);
    const storagePath = `image/${crypto.randomUUID()}-${fileName}`;

    const { error: uploadError } = await client.storage
      .from(MEDIA_PRIVATE_BUCKET)
      .upload(storagePath, buffer, { contentType, upsert: false });
    if (uploadError) {
      console.error(`  FAILED to upload: ${uploadError.message}`);
      continue;
    }

    const assetRow = {
      storage_path: storagePath,
      media_type: "image" as const,
      alt_text: item.altText,
      width: measured.width,
      height: measured.height,
      license: item.license,
      creator: item.creator,
      // The two fields docs/product-media-strategy.md §1.4 flagged as wrong
      // on the first 9 Commons assets. Set correctly from the start here.
      source_type: "public_domain_or_cc" as const,
      asset_role: "product_photo" as const,
      source_url: item.commonsPageUrl,
      attribution: item.attribution,
      attribution_required: true,
      ai_generated: false,
      owned: false,
      rights_status: "verified" as const,
    };

    // The rights gate is the real boundary, so it runs here too rather than
    // being assumed satisfied because this script wrote the row itself.
    const eligibility = evaluatePublishEligibility(assetRow);
    if (!eligibility.allowed) {
      console.error(`  ABORT (rights gate): ${eligibility.reason}`);
      await client.storage.from(MEDIA_PRIVATE_BUCKET).remove([storagePath]);
      continue;
    }

    const { data: inserted, error: insertError } = await client
      .from("media_assets")
      .insert(assetRow)
      .select("id")
      .single();
    if (insertError || !inserted) {
      console.error(`  FAILED to insert media_assets row: ${insertError?.message}`);
      await client.storage.from(MEDIA_PRIVATE_BUCKET).remove([storagePath]);
      continue;
    }

    const { error: copyError } = await client.storage
      .from(MEDIA_PRIVATE_BUCKET)
      .copy(storagePath, storagePath, { destinationBucket: MEDIA_PUBLIC_BUCKET });
    if (copyError) {
      console.error(`  FAILED to publish (copy to public bucket): ${copyError.message}`);
      continue;
    }

    const { error: publishError } = await client
      .from("media_assets")
      .update({
        publication_status: "published",
        public_storage_path: storagePath,
        published_at: new Date().toISOString(),
        published_by: adminId,
      })
      .eq("id", inserted.id);
    if (publishError) {
      console.error(`  FAILED to mark published: ${publishError.message}`);
      continue;
    }

    const { error: heroLinkError } = await client
      .from("product_media")
      .insert({ product_id: product.id, media_id: inserted.id, role: "hero", sort_order: 0 });
    if (heroLinkError) {
      console.error(`  FAILED to link as hero image: ${heroLinkError.message}`);
      continue;
    }
    console.log(`  Published and linked as hero (media_assets.id=${inserted.id})`);

    // Close out the sourcing workflow: the requirement is what
    // evaluateMediaReadiness() consults, so leaving it at 'needed' would
    // (correctly) keep the product blocked.
    const { data: requirement, error: reqError } = await client
      .from("media_requirements")
      .select("id, sourcing_status")
      .eq("product_id", product.id)
      .maybeSingle();
    if (reqError) {
      console.error(`  FAILED to read media_requirements: ${reqError.message}`);
      continue;
    }
    if (requirement) {
      const { error: reqUpdateError } = await client
        .from("media_requirements")
        .update({
          sourcing_status: "approved",
          target_source_type: "public_domain_or_cc",
          resolved_media_id: inserted.id,
          notes: item.verification,
          updated_at: new Date().toISOString(),
        })
        .eq("id", requirement.id);
      if (reqUpdateError) {
        console.error(`  FAILED to approve media_requirements row: ${reqUpdateError.message}`);
        continue;
      }
      console.log("  media_requirements -> approved");
    }

    const readiness = evaluateMediaReadiness({
      heroAsset: assetRow,
      requirement: { sourcing_status: "approved" },
    });
    if (!readiness.ready) {
      console.error(`  NOT PUBLISHING PRODUCT (media readiness): ${readiness.reason}`);
      continue;
    }

    const { error: productPublishError } = await client
      .from("products")
      .update({ is_published: true, updated_at: new Date().toISOString() })
      .eq("id", product.id);
    if (productPublishError) {
      console.error(`  FAILED to publish product: ${productPublishError.message}`);
      continue;
    }
    console.log(`  PRODUCT PUBLISHED: /products/${product.slug}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
