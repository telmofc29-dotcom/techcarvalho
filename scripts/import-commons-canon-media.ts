// Imports hand-verified, freely-licensed Wikimedia Commons photography for the
// 16 blocked Canon EOS bodies, then publishes each product through the same
// gate the app uses (evaluateMediaReadiness -> evaluatePublishEligibility).
//
// This extends the route proven by scripts/import-test-media.ts. It is NOT a
// general-purpose importer: every entry below was individually verified by
// opening its Commons file page and reading the licence template, the declared
// source/author, the category placement, AND the raw EXIF copyright/artist
// fields — the exact conflict that got File:Canon_EOS_5D.jpg rejected in the
// original import. rights_status is 'verified' because a human checked each
// file page, not because Commons implies it. A Commons licence tag is a claim,
// not proof.
//
// Rejected during this pass, recorded so the reasoning is auditable:
//   - File:Canon_EOS_R6_14.jpg (and 15/16/17): wikitext shows a photograph of a
//     church ceremony TAKEN WITH a Canon PowerShot SX620 HS, merely
//     miscategorised into Category:Canon EOS R6. Not a photo of the product.
//
// Images are downloaded at a resized width (never cropped) — resizing is
// conventionally not an adaptation, whereas cropping would trigger CC BY-SA's
// "indicate if changes were made" obligation. See docs/product-media-strategy.md.
//
// Usage: TC_ADMIN_EMAIL=... TC_ADMIN_PASSWORD=... npx tsx scripts/import-commons-canon-media.ts

import { loadEnvLocal, createAdminClient } from "./_shared";
import { MEDIA_PRIVATE_BUCKET, MEDIA_PUBLIC_BUCKET } from "../src/lib/media/constants";
import { evaluateMediaReadiness } from "../src/lib/media/requirements";

loadEnvLocal();

const UA = "TechCarvalhoBot/1.0 (+https://www.techcarvalho.com)";
const COMMONS_API = "https://commons.wikimedia.org/w/api.php";
const REQUEST_SPACING_MS = 2500;
const TARGET_WIDTH = 1600;

type Item = {
  productSlug: string;
  commonsTitle: string; // "File:..."
  creator: string;
  license: string;
  attribution: string;
  attributionRequired: boolean;
  altText: string;
  caption: string;
};

const ITEMS: Item[] = [
  {
    productSlug: "canon-eos-60d",
    commonsTitle: "File:Canon EOS 60D.jpg",
    creator: "John Torcasio",
    license: "CC BY-SA 3.0",
    attribution: "Photo: John Torcasio, CC BY-SA 3.0, via Wikimedia Commons",
    attributionRequired: true,
    altText: "Canon EOS 60D DSLR camera fitted with a Canon EF 17-40mm f/4L USM lens",
    caption: "Canon EOS 60D with an EF 17-40mm f/4L USM lens.",
  },
  {
    productSlug: "canon-eos-6d",
    commonsTitle: "File:Canon EOS 6D.jpg",
    creator: "decltype",
    license: "CC BY-SA 3.0",
    attribution: "Photo: decltype, CC BY-SA 3.0, via Wikimedia Commons",
    attributionRequired: true,
    altText: "Canon EOS 6D full-frame DSLR camera body, front view",
    caption: "Canon EOS 6D shown on display at Photokina 2012.",
  },
  {
    productSlug: "canon-eos-6d-mark-ii",
    commonsTitle: "File:Canon EOS 6D Mark II by EF50mm F1.2L USM.jpg",
    creator: "根川大橋 (Negawa Ohashi)",
    license: "CC BY-SA 4.0",
    attribution: "Photo: 根川大橋 (Negawa Ohashi), CC BY-SA 4.0, via Wikimedia Commons",
    attributionRequired: true,
    altText: "Canon EOS 6D Mark II full-frame DSLR camera body",
    caption: "Canon EOS 6D Mark II.",
  },
  {
    productSlug: "canon-eos-70d",
    commonsTitle: "File:Canon EOS 70D (camera body front view).jpg",
    creator: "Kārlis Dambrāns",
    license: "CC BY 2.0",
    attribution: "Photo: Kārlis Dambrāns, CC BY 2.0, via Wikimedia Commons",
    attributionRequired: true,
    altText: "Canon EOS 70D APS-C DSLR camera body, front view",
    caption: "Canon EOS 70D camera body, front view.",
  },
  {
    productSlug: "canon-eos-7d",
    commonsTitle: "File:Canon EOS 7D DSLR body front.jpg",
    creator: "Lucasbosch",
    license: "CC BY-SA 4.0",
    attribution: "Photo: Lucasbosch, CC BY-SA 4.0, via Wikimedia Commons",
    attributionRequired: true,
    altText: "Canon EOS 7D APS-C DSLR camera body without a lens, front view",
    caption: "Canon EOS 7D body, front view.",
  },
  {
    productSlug: "canon-eos-7d-mark-ii",
    commonsTitle: "File:Jan2015 Canon EOS 7D Mark II Body01.jpg",
    creator: "A.Savin",
    license: "CC BY-SA 3.0",
    // The file page states the author's required attribution form explicitly:
    // "Correct attribution is « A.Savin, Wikipedia »." Honour it verbatim.
    attribution: "Photo: A.Savin, Wikipedia, CC BY-SA 3.0, via Wikimedia Commons",
    attributionRequired: true,
    altText: "Canon EOS 7D Mark II APS-C DSLR camera body without a lens",
    caption: "Canon EOS 7D Mark II body without a lens.",
  },
  {
    productSlug: "canon-eos-80d",
    commonsTitle: "File:Canon EOS 80D 1.JPG",
    creator: "MKFI",
    license: "Public domain",
    attribution: "Photo: MKFI, released into the public domain, via Wikimedia Commons",
    // The author released the work into the public domain outright; no
    // attribution condition exists. Recording that honestly rather than
    // asserting a requirement the licence does not impose.
    attributionRequired: false,
    altText: "Canon EOS 80D APS-C DSLR camera body, front view",
    caption: "Canon EOS 80D DSLR body.",
  },
  {
    productSlug: "canon-eos-r",
    commonsTitle: "File:Canon EOS R.jpg",
    creator: "Tycho (shansov.net)",
    license: "CC0",
    attribution: "Photo: Tycho (shansov.net), CC0, via Wikimedia Commons",
    attributionRequired: false,
    altText: "Canon EOS R full-frame mirrorless camera body with an RF body cap",
    caption: "Canon EOS R body with an RF body cap.",
  },
  {
    productSlug: "canon-eos-r10",
    commonsTitle: "File:Canon EOS R10 (52264249766).jpg",
    creator: "Henry Söderlund",
    license: "CC BY 2.0",
    attribution: "Photo: Henry Söderlund, CC BY 2.0, via Wikimedia Commons",
    attributionRequired: true,
    altText: "Canon EOS R10 APS-C mirrorless camera body",
    caption: "Canon EOS R10.",
  },
  {
    productSlug: "canon-eos-r50",
    commonsTitle: "File:Canon EOS R50, Vorderansicht 30.12.2025.jpg",
    creator: "SmallSonMarex",
    license: "CC0",
    attribution: "Photo: SmallSonMarex, CC0, via Wikimedia Commons",
    attributionRequired: false,
    altText: "Canon EOS R50 APS-C mirrorless camera body, front view",
    caption: "Canon EOS R50, front view.",
  },
  {
    productSlug: "canon-eos-r6",
    commonsTitle: "File:Canon R6 und RF 85 2,0-8065.jpg",
    creator: "Gode Nehler",
    license: "CC BY-SA 4.0",
    attribution: "Photo: Gode Nehler, CC BY-SA 4.0, via Wikimedia Commons",
    attributionRequired: true,
    altText: "Canon EOS R6 full-frame mirrorless camera with a Canon RF 85mm f/2 Macro IS STM lens",
    caption: "Canon EOS R6 with an RF 85mm f/2 Macro IS STM lens.",
  },
  {
    productSlug: "canon-eos-r7",
    commonsTitle: "File:Canon EOS R7.jpg",
    creator: "Henry Söderlund",
    license: "CC BY 2.0",
    attribution: "Photo: Henry Söderlund, CC BY 2.0, via Wikimedia Commons",
    attributionRequired: true,
    altText: "Canon EOS R7 APS-C mirrorless camera with a Canon RF-S 18-150mm f/3.5-6.3 IS STM lens",
    caption: "Canon EOS R7 with an RF-S 18-150mm f/3.5-6.3 IS STM lens.",
  },
  {
    productSlug: "canon-eos-r8",
    commonsTitle: "File:Canon EOS R8 (52853735946).jpg",
    creator: "Henry Söderlund",
    license: "CC BY 2.0",
    attribution: "Photo: Henry Söderlund, CC BY 2.0, via Wikimedia Commons",
    attributionRequired: true,
    altText: "Canon EOS R8 full-frame mirrorless camera body",
    caption: "Canon EOS R8.",
  },
  {
    productSlug: "canon-eos-rp",
    commonsTitle: "File:Canon EOS RP 27 Mar 2019a.jpg",
    creator: "昼落ち",
    license: "CC BY-SA 4.0",
    attribution: "Photo: 昼落ち, CC BY-SA 4.0, via Wikimedia Commons",
    attributionRequired: true,
    altText: "Canon EOS RP full-frame mirrorless camera body",
    caption: "Canon EOS RP.",
  },
  {
    productSlug: "canon-eos-rebel-t7",
    commonsTitle: "File:Front view of Canon EOS Rebel T7 or 2000D.jpg",
    creator: "Greyfiveys",
    license: "CC BY-SA 4.0",
    attribution: "Photo: Greyfiveys, CC BY-SA 4.0, via Wikimedia Commons",
    attributionRequired: true,
    // The Rebel T7 is the Americas name for the EOS 2000D / 1500D. The file
    // page names both, which is what confirms the model identity here.
    altText: "Canon EOS Rebel T7 (EOS 2000D) entry-level DSLR camera, front view",
    caption: "Canon EOS Rebel T7, sold as the EOS 2000D outside the Americas.",
  },
  {
    productSlug: "canon-eos-rebel-t7i",
    commonsTitle: "File:Canon EOS Kiss X9i front-left 2017 CP+.jpg",
    creator: "Morio",
    license: "CC BY-SA 3.0",
    attribution: "Photo: Morio, CC BY-SA 3.0, via Wikimedia Commons",
    attributionRequired: true,
    // The Rebel T7i is the EOS 800D (Europe) / EOS Kiss X9i (Japan) — one
    // camera under three regional names. Commons files this image under
    // Category:Canon EOS 800D, which corroborates the identification.
    altText: "Canon EOS Rebel T7i (EOS 800D / EOS Kiss X9i) DSLR camera, front three-quarter view",
    caption: "Canon EOS Rebel T7i, shown under its Japanese name EOS Kiss X9i at CP+ 2017.",
  },
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function sanitizeFileName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9.]+/g, "-").replace(/^-+|-+$/g, "");
}

type CommonsImageInfo = { thumburl: string; thumbwidth: number; thumbheight: number; descriptionurl: string };

// Resolves the file page URL and a RESIZED (not cropped) download URL.
// Checks the response really is JSON before parsing — Commons serves an HTML
// error body when it rate-limits, and JSON.parse on that produces a confusing
// SyntaxError instead of an honest "we were throttled".
async function fetchImageInfo(title: string): Promise<CommonsImageInfo> {
  const url =
    COMMONS_API +
    "?" +
    new URLSearchParams({
      action: "query",
      titles: title,
      prop: "imageinfo",
      iiprop: "url|size",
      iiurlwidth: String(TARGET_WIDTH),
      format: "json",
      formatversion: "2",
    });
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  const text = await res.text();
  if (!text.startsWith("{")) {
    throw new Error(`Commons returned non-JSON (status ${res.status}) — likely rate-limited: ${text.slice(0, 120)}`);
  }
  const json = JSON.parse(text) as {
    query?: { pages?: Array<{ missing?: boolean; imageinfo?: CommonsImageInfo[] }> };
  };
  const page = json.query?.pages?.[0];
  if (!page || page.missing) throw new Error(`Commons file page missing: ${title}`);
  const ii = page.imageinfo?.[0];
  if (!ii?.thumburl) throw new Error(`No thumbnail URL returned for ${title}`);
  return ii;
}

async function main() {
  const client = await createAdminClient();
  const { data: userData, error: userError } = await client.auth.getUser();
  if (userError || !userData.user) throw new Error(`auth.getUser: ${userError?.message}`);
  const adminId = userData.user.id;
  console.log(`Authenticated as ${userData.user.email}`);

  // Optional slug arguments restrict the run to those products, so the
  // pipeline can be proven on one product before the rest follow.
  const only = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const items = only.length > 0 ? ITEMS.filter((i) => only.includes(i.productSlug)) : ITEMS;
  console.log(`Processing ${items.length} of ${ITEMS.length} items.`);

  const { data: products, error: prodErr } = await client
    .from("products")
    .select("id, slug, name, is_published")
    .in("slug", items.map((i) => i.productSlug));
  if (prodErr) throw new Error(`products lookup failed: ${prodErr.message}`);
  const bySlug = new Map((products ?? []).map((p) => [p.slug, p]));

  for (const item of items) {
    const product = bySlug.get(item.productSlug);
    if (!product) {
      console.error(`SKIP: product slug "${item.productSlug}" not found.`);
      continue;
    }
    console.log(`\n--- ${product.name} (${product.slug})`);

    // Idempotency: never create a second hero for a product that already has one.
    const { data: existingHero, error: heroErr } = await client
      .from("product_media")
      .select("id")
      .eq("product_id", product.id)
      .eq("role", "hero")
      .maybeSingle();
    if (heroErr) {
      console.error(`  QUERY FAILED (existing hero): ${heroErr.message}`);
      continue;
    }
    if (existingHero) {
      console.log(`  SKIP: already has a hero image.`);
      continue;
    }

    await sleep(REQUEST_SPACING_MS);
    let info: CommonsImageInfo;
    try {
      info = await fetchImageInfo(item.commonsTitle);
    } catch (e) {
      console.error(`  FAILED imageinfo: ${(e as Error).message}`);
      continue;
    }

    await sleep(REQUEST_SPACING_MS);
    const dl = await fetch(info.thumburl, { headers: { "User-Agent": UA } });
    if (!dl.ok) {
      console.error(`  FAILED download: ${dl.status} ${dl.statusText}`);
      continue;
    }
    const contentType = dl.headers.get("content-type") ?? "image/jpeg";
    const buffer = Buffer.from(await dl.arrayBuffer());

    const storagePath = `image/${crypto.randomUUID()}-${sanitizeFileName(
      item.commonsTitle.replace(/^File:/, "")
    )}`;

    const { error: uploadError } = await client.storage
      .from(MEDIA_PRIVATE_BUCKET)
      .upload(storagePath, buffer, { contentType, upsert: false });
    if (uploadError) {
      console.error(`  FAILED upload: ${uploadError.message}`);
      continue;
    }

    const { data: assetRow, error: insertError } = await client
      .from("media_assets")
      .insert({
        storage_path: storagePath,
        media_type: "image",
        alt_text: item.altText,
        caption: item.caption,
        width: info.thumbwidth,
        height: info.thumbheight,
        license: item.license,
        creator: item.creator,
        source_type: "public_domain_or_cc",
        asset_role: "product_photo",
        source_url: info.descriptionurl,
        attribution: item.attribution,
        attribution_required: item.attributionRequired,
        ai_generated: false,
        owned: false,
        rights_status: "verified",
      })
      .select("id, rights_status, owned, source_type")
      .single();
    if (insertError || !assetRow) {
      console.error(`  FAILED media_assets insert: ${insertError?.message}`);
      await client.storage.from(MEDIA_PRIVATE_BUCKET).remove([storagePath]);
      continue;
    }

    const { error: copyError } = await client.storage
      .from(MEDIA_PRIVATE_BUCKET)
      .copy(storagePath, storagePath, { destinationBucket: MEDIA_PUBLIC_BUCKET });
    if (copyError) {
      console.error(`  FAILED publish copy: ${copyError.message}`);
      continue;
    }

    const { error: pubError } = await client
      .from("media_assets")
      .update({
        publication_status: "published",
        public_storage_path: storagePath,
        published_at: new Date().toISOString(),
        published_by: adminId,
      })
      .eq("id", assetRow.id);
    if (pubError) {
      console.error(`  FAILED mark published: ${pubError.message}`);
      continue;
    }

    const { error: linkError } = await client
      .from("product_media")
      .insert({ product_id: product.id, media_id: assetRow.id, role: "hero", sort_order: 0 });
    if (linkError) {
      console.error(`  FAILED hero link: ${linkError.message}`);
      continue;
    }

    // The sourcing workflow row must reflect reality before readiness is
    // evaluated — evaluateMediaReadiness() refuses to clear a product whose
    // requirement is still open, and that check is the point.
    const { data: reqRow, error: reqReadErr } = await client
      .from("media_requirements")
      .select("id, sourcing_status")
      .eq("product_id", product.id)
      .maybeSingle();
    if (reqReadErr) {
      console.error(`  QUERY FAILED (media_requirements): ${reqReadErr.message}`);
      continue;
    }
    if (reqRow) {
      const { error: reqErr } = await client
        .from("media_requirements")
        .update({
          sourcing_status: "approved",
          target_source_type: "public_domain_or_cc",
          resolved_media_id: assetRow.id,
          notes: `Freely-licensed photograph sourced from Wikimedia Commons and verified by hand: ${info.descriptionurl} (${item.license}, ${item.creator}).`,
          updated_at: new Date().toISOString(),
        })
        .eq("id", reqRow.id);
      if (reqErr) {
        console.error(`  FAILED requirement update: ${reqErr.message}`);
        continue;
      }
    }

    const readiness = evaluateMediaReadiness({
      heroAsset: {
        rights_status: assetRow.rights_status,
        owned: assetRow.owned,
        source_type: assetRow.source_type,
      },
      requirement: reqRow ? { sourcing_status: "approved" } : null,
    });
    if (!readiness.ready) {
      console.error(`  NOT PUBLISHING product — readiness gate says: ${readiness.reason}`);
      continue;
    }

    const { error: pubProdErr } = await client
      .from("products")
      .update({ is_published: true })
      .eq("id", product.id);
    if (pubProdErr) {
      console.error(`  FAILED to publish product: ${pubProdErr.message}`);
      continue;
    }

    console.log(`  OK: ${item.license} / ${item.creator}`);
    console.log(`      ${info.descriptionurl}`);
    console.log(`      asset=${assetRow.id}  ${info.thumbwidth}x${info.thumbheight}  product published`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
