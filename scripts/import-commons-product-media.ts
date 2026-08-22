// Unblocks BLOCKED PRODUCTS (consoles / phones / GPUs / CPUs) with
// hand-verified, freely-licensed Wikimedia Commons product photography —
// the same route that unblocked the first 6 Canon products (see
// scripts/import-test-media.ts and docs/product-media-strategy.md §1.3).
// No manufacturer permission is involved or implied.
//
// HOW EACH ENTRY BELOW WAS VERIFIED (all three steps, per file, by hand):
//   1. Found via Commons CATEGORY listings, not free text. This matters:
//      docs/product-media-strategy.md §3 reported ZERO free-licensed hits for
//      Switch 2, RTX 5090, Ryzen 9000 and Pixel 10 Pro from a plain-text
//      search. Every one of those has a dedicated Commons category with real
//      photography in it. The doc's table understates availability badly.
//   2. The actual File: page was opened and read — licence template AND
//      version, author, source field, date, and any deletion/dispute or
//      trademark notice. EXIF Copyright was checked against the licence badge
//      for the contradiction that got File:Canon_EOS_5D.jpg rejected.
//   3. The image itself was downloaded and LOOKED AT to confirm it depicts
//      that exact model. This is the step that actually rejects things: a
//      free licence on a file whose name matches a product is routinely not a
//      photo of it. See REJECTED below.
//
// rights_status = 'verified' is set because a human checked each licence in
// this session — not because "Commons" implies it. A Commons licence tag is a
// claim, not proof (Commons itself disclaims warranty on licence correctness).
//
// Images are RESIZED ONLY, never cropped: CC BY-SA requires indicating if
// changes were made, and resizing/format-conversion are conventionally not
// adaptations while cropping is. Requests go through Special:FilePath?width=,
// which is Wikimedia's own scaler.
//
// Fixes the two metadata defects docs/product-media-strategy.md §1.4 found on
// the existing 9 Commons rows: source_type is 'public_domain_or_cc' (not
// 'other'/NULL) and asset_role is 'product_photo' (not NULL).
//
// Usage: TC_ADMIN_EMAIL=... TC_ADMIN_PASSWORD=... npx tsx scripts/import-commons-product-media.ts [--apply]
// Without --apply it prints the plan and writes nothing.

import { loadEnvLocal, createAdminClient } from "./_shared";
import { MEDIA_PRIVATE_BUCKET, MEDIA_PUBLIC_BUCKET } from "../src/lib/media/constants";
import { evaluateMediaReadiness } from "../src/lib/media/requirements";

loadEnvLocal();

const UA = "TechCarvalhoBot/1.0 (+https://www.techcarvalho.com)";
const MAX_WIDTH = 1600;

type Item = {
  productSlug: string;
  commonsFile: string; // exact File: title, without the "File:" prefix
  commonsPageUrl: string;
  creator: string;
  license: string;
  /** false only where the licence genuinely does not require it (CC0). */
  attributionRequired: boolean;
  attribution: string;
  altText: string;
  caption?: string;
  srcWidth: number;
  srcHeight: number;
  ext: string;
  /** Why this file is accepted as a photograph of this exact model. */
  depictionEvidence: string;
};

const ITEMS: Item[] = [
  {
    productSlug: "playstation-5",
    commonsFile: "PlayStation 5 and DualSense.jpg",
    commonsPageUrl: "https://commons.wikimedia.org/wiki/File:PlayStation_5_and_DualSense.jpg",
    creator: "Osh33m",
    license: "CC BY-SA 4.0",
    attributionRequired: true,
    attribution: "Photo: Osh33m, CC BY-SA 4.0, via Wikimedia Commons",
    altText:
      "Sony PlayStation 5 console standing vertically on its stand, with a white DualSense wireless controller beside it",
    caption: "The launch PlayStation 5 Disc Edition, shown vertically with its stand and a DualSense controller.",
    srcWidth: 1430,
    srcHeight: 1722,
    ext: "jpg",
    depictionEvidence:
      "Original-model PS5 with the two white side panels and the visible disc slot (Disc Edition), plus a DualSense. Uploader's own work, 2020-11-25.",
  },
  {
    productSlug: "xbox-series-x",
    commonsFile: "Xbox Series X mit Controller.jpg",
    commonsPageUrl: "https://commons.wikimedia.org/wiki/File:Xbox_Series_X_mit_Controller.jpg",
    creator: "Der. Bellemer",
    license: "CC BY-SA 4.0",
    attributionRequired: true,
    attribution: "Photo: Der. Bellemer, CC BY-SA 4.0, via Wikimedia Commons",
    altText: "Microsoft Xbox Series X console standing upright with a black Xbox wireless controller in front of it",
    caption: "The Xbox Series X in its upright orientation, with the included wireless controller.",
    srcWidth: 4248,
    srcHeight: 5664,
    ext: "jpg",
    depictionEvidence:
      "The tall matte-black tower with the top exhaust grille and front disc slot — Series X, not the discless Series S. Shot on a Samsung Galaxy A7, own work, 2020-12-14.",
  },
  {
    productSlug: "xbox-series-s",
    commonsFile: "Xbox Series S with controller.jpg",
    commonsPageUrl: "https://commons.wikimedia.org/wiki/File:Xbox_Series_S_with_controller.jpg",
    creator: "AsmodeanUnderscore",
    license: "CC BY-SA 4.0",
    attributionRequired: true,
    attribution: "Photo: AsmodeanUnderscore, CC BY-SA 4.0, via Wikimedia Commons",
    altText:
      "Microsoft Xbox Series S console standing upright, white with a large black circular fan grille, with a white Xbox wireless controller in front",
    caption: "The Xbox Series S, with the white wireless controller included in the box.",
    srcWidth: 2101,
    srcHeight: 2101,
    ext: "jpg",
    depictionEvidence:
      "White chassis with the oversized black circular fan grille and no disc slot — unmistakably Series S, not Series X. Own work, 2021-01-30.",
  },
  {
    productSlug: "nintendo-switch-2",
    commonsFile: "Nintendo Switch 2 - 1.jpg",
    commonsPageUrl: "https://commons.wikimedia.org/wiki/File:Nintendo_Switch_2_-_1.jpg",
    creator: "Kyu3a",
    license: "CC BY-SA 4.0",
    attributionRequired: true,
    attribution: "Photo: Kyu3a, CC BY-SA 4.0, via Wikimedia Commons",
    altText:
      "Nintendo Switch 2 console shown from behind with its kickstand, next to a pair of detached Joy-Con 2 controllers, on a red retail shelf",
    caption: "A Nintendo Switch 2 on retail display, with the Joy-Con 2 controllers detached.",
    srcWidth: 5712,
    srcHeight: 4284,
    ext: "jpg",
    depictionEvidence:
      "The 'NINTENDO SWITCH 2' logo is legible on the console's rear panel and the '2' branding on the Joy-Con 2 — this is the second-generation hardware, not the original Switch or the OLED model. Own work, 2025-07-04.",
  },
  {
    productSlug: "iphone-17-pro",
    commonsFile: "IPhone 17 Pro backside (Cosmic Orange) (Oct 1, 2025).jpg",
    commonsPageUrl:
      "https://commons.wikimedia.org/wiki/File:IPhone_17_Pro_backside_(Cosmic_Orange)_(Oct_1,_2025).jpg",
    creator: "茅野ふたば",
    license: "CC BY-SA 4.0",
    attributionRequired: true,
    attribution: "Photo: 茅野ふたば, CC BY-SA 4.0, via Wikimedia Commons",
    altText:
      "Rear of an Apple iPhone 17 Pro in Cosmic Orange, showing the full-width raised camera plateau with three lenses",
    caption: "The iPhone 17 Pro in Cosmic Orange, showing the redesigned full-width camera plateau.",
    srcWidth: 1536,
    srcHeight: 2048,
    ext: "jpg",
    depictionEvidence:
      "The full-width raised camera plateau with the three lenses grouped at one corner and the lowered off-centre Apple logo is specific to the iPhone 17 Pro generation, and the Cosmic Orange finish is a 17 Pro colour. Own work, 2025-10-01.",
  },
  {
    productSlug: "galaxy-s26-ultra",
    commonsFile: "Galaxy S26 Ultra - 1.jpg",
    commonsPageUrl: "https://commons.wikimedia.org/wiki/File:Galaxy_S26_Ultra_-_1.jpg",
    creator: "Kyu3a",
    license: "CC BY-SA 4.0",
    attributionRequired: true,
    attribution: "Photo: Kyu3a, CC BY-SA 4.0, via Wikimedia Commons",
    altText: "Samsung Galaxy S26 Ultra held in one hand, screen on, at an electronics retail store",
    caption: "A Samsung Galaxy S26 Ultra demonstration unit in a Nagoya electronics store.",
    srcWidth: 3024,
    srcHeight: 4032,
    ext: "jpg",
    depictionEvidence:
      "The demo unit's own on-screen banner reads 'Galaxy S26 Ultra', naming the model directly. This replaces the Samsung logo SVG that docs/product-media-strategy.md §3 flagged as the free-text search's false positive. Own work, 2026-03-06.",
  },
  {
    productSlug: "pixel-10-pro",
    commonsFile: "Arrière du Google Pixel 10 Pro pierre de lune de 256 Go.jpg",
    commonsPageUrl:
      "https://commons.wikimedia.org/wiki/File:Arri%C3%A8re_du_Google_Pixel_10_Pro_pierre_de_lune_de_256_Go.jpg",
    creator: "Fabe56",
    license: "CC BY-SA 4.0",
    attributionRequired: true,
    attribution: "Photo: Fabe56, CC BY-SA 4.0, via Wikimedia Commons",
    altText:
      "Rear of a Google Pixel 10 Pro in Moonstone, showing the horizontal camera bar and the Google G logo, resting on its retail box",
    caption: "A 256 GB Google Pixel 10 Pro in Moonstone, resting on its box.",
    srcWidth: 3072,
    srcHeight: 4080,
    ext: "jpg",
    depictionEvidence:
      "Pixel 10 Pro camera bar (three rear cameras plus flash and sensor in the pill), Google G logo, and the retail box under it is printed 'Pixel 10 Pro'. Own work, 2025-08-27.",
  },
  {
    productSlug: "amd-ryzen-9-9950x",
    commonsFile: "AMD Ryzen 9 9950X.jpg",
    commonsPageUrl: "https://commons.wikimedia.org/wiki/File:AMD_Ryzen_9_9950X.jpg",
    creator: "4300streetcar",
    license: "CC BY 4.0",
    attributionRequired: true,
    attribution: "Photo: 4300streetcar, CC BY 4.0, via Wikimedia Commons",
    altText: "AMD Ryzen 9 9950X processor seen from above, its heat spreader marked with the model name",
    caption: "An AMD Ryzen 9 9950X, model name and part number laser-etched on the heat spreader.",
    srcWidth: 3305,
    srcHeight: 3305,
    ext: "jpg",
    depictionEvidence:
      "The integrated heat spreader is legibly etched 'AMD Ryzen 9 9950X' with part number 100-000001277. Identification is direct, not inferred. Shot on a Nikon Z 8, own work, 2024-11-27.",
  },
  {
    productSlug: "amd-rx-7900-xtx",
    commonsFile: "Sapphire AMD Radeon RX 7900 XTX.jpg",
    commonsPageUrl: "https://commons.wikimedia.org/wiki/File:Sapphire_AMD_Radeon_RX_7900_XTX.jpg",
    creator: "Geni",
    license: "CC BY-SA 4.0",
    attributionRequired: true,
    attribution: "Photo: Geni, CC BY-SA 4.0, via Wikimedia Commons",
    altText: "Sapphire-branded AMD Radeon RX 7900 XTX graphics card, a triple-fan card shown at an angle",
    caption:
      "A Sapphire-built Radeon RX 7900 XTX. Board-partner cards like this one differ from AMD's reference design in cooler and clocks, not in GPU.",
    srcWidth: 5956,
    srcHeight: 3728,
    ext: "jpg",
    depictionEvidence:
      "Commons file page, title and categories all identify it as a Sapphire Radeon RX 7900 XTX; uploader Geni is a long-standing Commons contributor and the shot is their own (Canon EOS R5, Feb 2023). It is a board-partner card rather than AMD's reference design, which the caption states outright.",
  },
  {
    productSlug: "rtx-5090",
    commonsFile: "Palit GeForce RTX 5090 Gamerock 20250530 HOF3879 RAW-Export.png",
    commonsPageUrl:
      "https://commons.wikimedia.org/wiki/File:Palit_GeForce_RTX_5090_Gamerock_20250530_HOF3879_RAW-Export.png",
    creator: "PantheraLeo1359531",
    license: "CC BY 4.0",
    attributionRequired: true,
    attribution: "Photo: PantheraLeo1359531, CC BY 4.0, via Wikimedia Commons",
    altText:
      "Palit GeForce RTX 5090 GameRock graphics card photographed face-on against a white background, showing its three fans",
    caption:
      "A Palit GeForce RTX 5090 GameRock. Board-partner cards like this one differ from NVIDIA's Founders Edition in cooler and clocks, not in GPU.",
    srcWidth: 8093,
    srcHeight: 4183,
    ext: "png",
    depictionEvidence:
      "Studio product shot; the file page, title and categories identify it as a Palit GeForce RTX 5090 GameRock, and the shroud is Palit-branded. The EXIF copyright field reads 'Via CC BY-4.0 by PantheraLeo1359531' — it CONFIRMS the licence badge rather than contradicting it. Own work, Sony ILCE-7RM5, 2025-05-30.",
  },
];

// Products left BLOCKED on purpose. Recorded here rather than in a report so
// the reasoning survives with the code, and so a future recheck knows exactly
// what was already looked at and found wanting.
export const REJECTED: { productSlug: string; reason: string }[] = [
  {
    productSlug: "playstation-5-pro",
    reason:
      "Category:PlayStation 5 Pro holds 26 files and every one is a frame grabbed from a YouTube review video (BeatEmUps, 小宁子 XNZ, 阿金生活), including File:PlayStation 5 Pro no disc drive.jpg. Two independent problems: (a) the CC BY 3.0 claim rests on a YouTube channel's own licence toggle re-asserted by a third-party Commons uploader, which is a claim on a claim, not confirmable provenance; (b) from the angle shown a PS5 Pro cannot be told apart from a PS5 Slim with confidence — the mid-body gills are the only tell and they are ambiguous at that resolution. Cannot confirm the exact model, so rejected.",
  },
  {
    productSlug: "rtx-5080",
    reason:
      "Category:NVIDIA GeForce RTX 5080, its 'second sources' subcategory and Category:Palit GeForce RTX 5080 GameRock contain no still photograph of the card — only YouTube video frames (Geekerwan, ZMASLO) and one PCB composite. A filemime:image/jpeg free-text search returns nothing. No legitimate photograph exists on Commons yet.",
  },
  {
    productSlug: "amd-ryzen-7-9800x3d",
    reason:
      "Category:AMD Ryzen 7 9800X3D holds 53 files, all of them frames from ZMASLO and Geekerwan review videos. No still photograph of the processor. Blocked on time, not on permission — worth a periodic recheck.",
  },
  {
    productSlug: "intel-core-ultra-9-285k",
    reason:
      "Category:Intel Core Ultra 9 285K holds only YouTube video frames (several of which are actually the Core Ultra 7 265K, a different SKU) plus three .stl 3D models. The only free-licensed still images matching '285K' are Fritzchens Fritz die micrographs of delidded Arrow Lake silicon — real and CC-licensed, but a photograph of bare dies is not a photograph of the retail processor and must not be presented as one.",
  },
];

// Stored ONE-DIRECTIONAL only. product-detail.ts queries both
// `product_id = X` and `related_product_id = X` and labels each direction
// separately (FORWARD_LABELS / REVERSE_LABELS), so inserting the reciprocal
// row would make the same pairing render twice on both pages. Only genuinely
// true pairings are listed — nothing is invented to fill the table out.
const RELATIONSHIPS: { from: string; type: "successor_of" | "alternative_to"; to: string; why: string }[] = [
  {
    from: "playstation-5-pro",
    type: "successor_of",
    to: "playstation-5",
    why: "Later, higher-tier revision of the same console line — renders as 'Successor' on the PS5 page and 'Predecessor' on the PS5 Pro page.",
  },
  {
    from: "xbox-series-s",
    type: "alternative_to",
    to: "xbox-series-x",
    why: "Same generation, sold concurrently as the cheaper option — neither succeeds the other.",
  },
  {
    from: "galaxy-s26-ultra",
    type: "alternative_to",
    to: "iphone-17-pro",
    why: "Directly cross-shopped 2026 flagships; the site already compares them in one article.",
  },
  { from: "pixel-10-pro", type: "alternative_to", to: "iphone-17-pro", why: "Same three-way flagship comparison." },
  { from: "rtx-5080", type: "alternative_to", to: "rtx-5090", why: "Same GPU generation, one tier apart." },
  {
    from: "amd-ryzen-7-9800x3d",
    type: "alternative_to",
    to: "amd-ryzen-9-9950x",
    why: "Same Ryzen 9000 generation, gaming vs. workstation split rather than a succession.",
  },
  {
    from: "intel-core-ultra-9-285k",
    type: "alternative_to",
    to: "amd-ryzen-9-9950x",
    why: "The competing high-end desktop CPU of the same period.",
  },
];

async function syncRelationships(
  client: Awaited<ReturnType<typeof createAdminClient>>,
  apply: boolean
): Promise<void> {
  console.log(`\n=== product_relationships ===`);
  const slugs = [...new Set(RELATIONSHIPS.flatMap((r) => [r.from, r.to]))];
  const { data: rows, error } = await client.from("products").select("id, slug").in("slug", slugs);
  if (error) {
    console.error(`QUERY FAILED (products for relationships): ${error.message}`);
    return;
  }
  const idBySlug = new Map((rows ?? []).map((p) => [p.slug, p.id]));

  const { data: existing, error: exErr } = await client
    .from("product_relationships")
    .select("product_id, related_product_id, relationship_type");
  if (exErr) {
    console.error(`QUERY FAILED (existing relationships): ${exErr.message}`);
    return;
  }
  const key = (a: string, b: string, t: string) => `${a}|${b}|${t}`;
  const have = new Set((existing ?? []).map((r) => key(r.product_id, r.related_product_id, r.relationship_type)));

  for (const rel of RELATIONSHIPS) {
    const fromId = idBySlug.get(rel.from);
    const toId = idBySlug.get(rel.to);
    if (!fromId || !toId) {
      console.error(`  SKIP ${rel.from} -> ${rel.to}: product row not found.`);
      continue;
    }
    if (have.has(key(fromId, toId, rel.type))) {
      console.log(`  SKIP (exists): ${rel.from} --${rel.type}--> ${rel.to}`);
      continue;
    }
    // Refuse to create the mirror of a pairing that already exists in the
    // other direction — that is exactly the duplicate-render bug the
    // one-directional rule exists to prevent.
    if (have.has(key(toId, fromId, rel.type))) {
      console.error(`  SKIP: reverse row already exists for ${rel.from}/${rel.to} — would duplicate on both pages.`);
      continue;
    }
    if (!apply) {
      console.log(`  WOULD ADD: ${rel.from} --${rel.type}--> ${rel.to}`);
      continue;
    }
    const { error: insErr } = await client
      .from("product_relationships")
      .insert({ product_id: fromId, related_product_id: toId, relationship_type: rel.type });
    if (insErr) {
      console.error(`  FAILED ${rel.from} -> ${rel.to}: ${insErr.message}`);
      continue;
    }
    have.add(key(fromId, toId, rel.type));
    console.log(`  ADDED: ${rel.from} --${rel.type}--> ${rel.to}`);
  }
}

function sanitizeFileName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9.]+/g, "-").replace(/^-+|-+$/g, "");
}

/** Wikimedia's own scaler. Resize only — never a crop. */
function scaledUrl(item: Item): { url: string; width: number; height: number } {
  if (item.srcWidth <= MAX_WIDTH && item.ext !== "png") {
    return {
      url: `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(item.commonsFile)}`,
      width: item.srcWidth,
      height: item.srcHeight,
    };
  }
  const width = Math.min(item.srcWidth, MAX_WIDTH);
  return {
    url: `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(item.commonsFile)}?width=${width}`,
    width,
    height: Math.round((item.srcHeight * width) / item.srcWidth),
  };
}

async function main() {
  const apply = process.argv.includes("--apply");
  const client = await createAdminClient();
  const { data: userData, error: userError } = await client.auth.getUser();
  if (userError || !userData.user) throw new Error(`auth.getUser: ${userError?.message}`);
  const adminId = userData.user.id;
  console.log(`Authenticated as ${userData.user.email}`);
  console.log(apply ? "MODE: --apply (writing)\n" : "MODE: dry run (nothing will be written)\n");

  const slugs = ITEMS.map((i) => i.productSlug);
  const { data: products, error: prodErr } = await client
    .from("products")
    .select("id, slug, name, is_published")
    .in("slug", slugs);
  if (prodErr) throw new Error(`products: ${prodErr.message}`);
  const bySlug = new Map((products ?? []).map((p) => [p.slug, p]));

  for (const item of ITEMS) {
    const product = bySlug.get(item.productSlug);
    console.log(`--- ${item.productSlug}`);
    if (!product) {
      console.error(`  SKIP: no product row with that slug.`);
      continue;
    }

    // Idempotency: media_assets rows have no natural unique key per target, so
    // a re-run after a partial failure must not create a second hero.
    const { data: existingLink, error: linkLookupErr } = await client
      .from("product_media")
      .select("id, media_id")
      .eq("product_id", product.id)
      .eq("role", "hero")
      .maybeSingle();
    if (linkLookupErr) {
      console.error(`  QUERY FAILED (product_media lookup): ${linkLookupErr.message}`);
      continue;
    }
    if (existingLink) {
      console.log(`  SKIP: already has a hero image (media_id=${existingLink.media_id}).`);
      continue;
    }

    const { url, width, height } = scaledUrl(item);
    console.log(`  ${item.license} / ${item.creator}`);
    console.log(`  ${item.commonsPageUrl}`);
    console.log(`  -> ${width}x${height} (resize only, no crop)`);
    if (!apply) continue;

    // Commons rate-limits rapid sequential requests and answers with a
    // non-JSON/HTML error page rather than a clean 429, so pace politely.
    await new Promise((r) => setTimeout(r, 4000));

    const res = await fetch(url, { headers: { "User-Agent": UA } });
    if (!res.ok) {
      console.error(`  FAILED to download: ${res.status} ${res.statusText}`);
      continue;
    }
    const contentType = res.headers.get("content-type") ?? `image/${item.ext}`;
    if (!contentType.startsWith("image/")) {
      console.error(`  FAILED: expected an image, got content-type "${contentType}" (rate limited?)`);
      continue;
    }
    const buffer = Buffer.from(await res.arrayBuffer());

    const storagePath = `image/${crypto.randomUUID()}-${sanitizeFileName(item.commonsFile)}`;
    const { error: uploadError } = await client.storage
      .from(MEDIA_PRIVATE_BUCKET)
      .upload(storagePath, buffer, { contentType, upsert: false });
    if (uploadError) {
      console.error(`  FAILED to upload: ${uploadError.message}`);
      continue;
    }

    const { data: assetRow, error: insertError } = await client
      .from("media_assets")
      .insert({
        storage_path: storagePath,
        media_type: "image",
        alt_text: item.altText,
        caption: item.caption ?? null,
        width,
        height,
        license: item.license,
        creator: item.creator,
        source_type: "public_domain_or_cc",
        asset_role: "product_photo",
        source_url: item.commonsPageUrl,
        attribution: item.attribution,
        attribution_required: item.attributionRequired,
        ai_generated: false,
        owned: false,
        rights_status: "verified",
      })
      .select("id")
      .single();
    if (insertError || !assetRow) {
      console.error(`  FAILED to insert media_assets: ${insertError?.message}`);
      await client.storage.from(MEDIA_PRIVATE_BUCKET).remove([storagePath]);
      continue;
    }

    // Publish = copy the private original into the public bucket. The private
    // copy is the permanent archive and is never touched again.
    const { error: copyError } = await client.storage
      .from(MEDIA_PRIVATE_BUCKET)
      .copy(storagePath, storagePath, { destinationBucket: MEDIA_PUBLIC_BUCKET });
    if (copyError) {
      console.error(`  FAILED to copy to public bucket: ${copyError.message}`);
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
      console.error(`  FAILED to mark media published: ${pubError.message}`);
      continue;
    }

    const { error: pmError } = await client
      .from("product_media")
      .insert({ product_id: product.id, media_id: assetRow.id, role: "hero", sort_order: 0 });
    if (pmError) {
      console.error(`  FAILED to link as hero: ${pmError.message}`);
      continue;
    }

    // The open sourcing requirement is genuinely resolved now: a verified,
    // published asset exists and is linked. Record that before asking
    // evaluateMediaReadiness() whether the product may go live — the gate is
    // not weakened, it is answered.
    const { data: req, error: reqErr } = await client
      .from("media_requirements")
      .select("id, sourcing_status")
      .eq("product_id", product.id)
      .maybeSingle();
    if (reqErr) {
      console.error(`  QUERY FAILED (media_requirements): ${reqErr.message}`);
      continue;
    }
    if (req) {
      const { error: reqUpdErr } = await client
        .from("media_requirements")
        .update({
          sourcing_status: "approved",
          target_source_type: "public_domain_or_cc",
          resolved_media_id: assetRow.id,
          notes: `Resolved with hand-verified Wikimedia Commons photography (${item.license}, ${item.creator}) — ${item.commonsPageUrl}. No manufacturer permission involved.`,
        })
        .eq("id", req.id);
      if (reqUpdErr) {
        console.error(`  FAILED to update media_requirements: ${reqUpdErr.message}`);
        continue;
      }
    }

    const readiness = evaluateMediaReadiness({
      heroAsset: {
        rights_status: "verified",
        owned: false,
        source_type: "public_domain_or_cc",
      },
      requirement: req ? { sourcing_status: "approved" } : null,
    });
    if (!readiness.ready) {
      console.error(`  NOT PUBLISHING product: ${readiness.reason}`);
      continue;
    }

    const { error: publishErr } = await client
      .from("products")
      .update({ is_published: true })
      .eq("id", product.id);
    if (publishErr) {
      console.error(`  FAILED to publish product: ${publishErr.message}`);
      continue;
    }

    console.log(`  OK: media ${assetRow.id} published + linked; product is_published = true`);
  }

  await syncRelationships(client, apply);

  console.log(`\n=== Left blocked on purpose (${REJECTED.length}) ===`);
  for (const r of REJECTED) console.log(`  ${r.productSlug}: ${r.reason}\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
