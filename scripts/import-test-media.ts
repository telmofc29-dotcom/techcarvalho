// One-time script: imports a small, hand-verified set of real,
// properly-licensed images from Wikimedia Commons to populate a
// representative live media test set — see the batch that added this file
// for the full rationale. NOT a general-purpose media importer and not
// meant to be extended into one without a real design pass (the user
// explicitly asked to build/verify the architecture and populate a SMALL
// test set first, not to bulk-import).
//
// Every image below was individually checked via its Wikimedia Commons
// file page for: exact license, real photographer/uploader credit, and any
// conflicting rights statement (EXIF "all rights reserved" claims that
// contradict the CC badge on the page — one candidate, File:Canon_EOS_5D.jpg,
// was rejected for exactly this reason and is deliberately not used here).
// rights_status is set to "verified" because a human (this session)
// actually checked each license, not because the source category implies
// it — see src/lib/media/rights.ts's evaluatePublishEligibility, which this
// script satisfies deliberately, not by accident.
//
// Usage: TC_ADMIN_EMAIL=... TC_ADMIN_PASSWORD=... npx tsx scripts/import-test-media.ts

import { loadEnvLocal, createAdminClient } from "./_shared";
import { MEDIA_PRIVATE_BUCKET, MEDIA_PUBLIC_BUCKET } from "../src/lib/media/constants";

loadEnvLocal();

type ImportItem = {
  sourceImageUrl: string;
  commonsPageUrl: string;
  creator: string;
  license: string;
  attribution: string;
  altText: string;
  caption?: string;
  width?: number;
  height?: number;
  target: { kind: "product"; slug: string } | { kind: "content"; slug: string };
};

const ITEMS: ImportItem[] = [
  {
    sourceImageUrl: "https://upload.wikimedia.org/wikipedia/commons/9/96/Canon5d0195.jpg",
    commonsPageUrl: "https://commons.wikimedia.org/wiki/File:Canon5d0195.jpg",
    creator: "Ashley Pomeroy",
    license: "CC BY-SA 3.0",
    attribution: "Photo: Ashley Pomeroy, CC BY-SA 3.0, via Wikimedia Commons",
    altText: "Canon EOS 5D DSLR camera body, front three-quarter view",
    target: { kind: "product", slug: "canon-eos-5d" },
  },
  {
    sourceImageUrl:
      "https://upload.wikimedia.org/wikipedia/commons/3/30/Canon_EOS_5D_Mark_II_with_EF_24-70_f2.8L_lens.jpg",
    commonsPageUrl:
      "https://commons.wikimedia.org/wiki/File:Canon_EOS_5D_Mark_II_with_EF_24-70_f2.8L_lens.jpg",
    creator: "Mlogic (Yan Li)",
    license: "CC BY-SA 3.0",
    attribution: "Photo: Mlogic (Yan Li), CC BY-SA 3.0, via Wikimedia Commons",
    altText: "Canon EOS 5D Mark II DSLR camera fitted with an EF 24-70mm f/2.8L lens",
    target: { kind: "product", slug: "canon-eos-5d-mark-ii" },
  },
  {
    sourceImageUrl: "https://upload.wikimedia.org/wikipedia/commons/0/0d/Canon_EOS_5D_Mark_III.jpg",
    commonsPageUrl: "https://commons.wikimedia.org/wiki/File:Canon_EOS_5D_Mark_III.jpg",
    creator: "decltype",
    license: "CC BY-SA 3.0",
    attribution: "Photo: decltype, CC BY-SA 3.0, via Wikimedia Commons",
    altText: "Canon EOS 5D Mark III DSLR camera body, front view",
    width: 4203,
    height: 3152,
    target: { kind: "product", slug: "canon-eos-5d-mark-iii" },
  },
  {
    sourceImageUrl: "https://upload.wikimedia.org/wikipedia/commons/2/25/Canon_EOS-5D-Mark-IV-03.jpg",
    commonsPageUrl: "https://commons.wikimedia.org/wiki/File:Canon_EOS-5D-Mark-IV-03.jpg",
    creator: "CEphoto / Uwe Aranas",
    license: "CC BY-SA 3.0",
    attribution: "Photo by CEphoto, Uwe Aranas, CC BY-SA 3.0, via Wikimedia Commons",
    altText: "Canon EOS 5D Mark IV DSLR camera body, front three-quarter view",
    target: { kind: "product", slug: "canon-eos-5d-mark-iv" },
  },
  {
    sourceImageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/8/88/Canon_EOS_R5.jpg/1280px-Canon_EOS_R5.jpg",
    commonsPageUrl: "https://commons.wikimedia.org/wiki/File:Canon_EOS_R5.jpg",
    creator: "Harrison Jones",
    license: "CC BY-SA 4.0",
    attribution: "Photo: Harrison Jones, CC BY-SA 4.0, via Wikimedia Commons",
    altText: "Canon EOS R5 full-frame mirrorless camera body, front view",
    width: 1280,
    height: 853,
    target: { kind: "product", slug: "canon-eos-r5" },
  },
  {
    sourceImageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/2/21/Canon_EOS_90D.jpg/1280px-Canon_EOS_90D.jpg",
    commonsPageUrl: "https://commons.wikimedia.org/wiki/File:Canon_EOS_90D.jpg",
    creator: "Jean-Paul GALLOIS",
    license: "CC BY-SA 4.0",
    attribution: "Photo: Jean-Paul GALLOIS, CC BY-SA 4.0, via Wikimedia Commons",
    altText: "Canon EOS 90D APS-C DSLR camera body, front three-quarter view",
    width: 1280,
    height: 960,
    target: { kind: "product", slug: "canon-eos-90d" },
  },
  {
    sourceImageUrl:
      "https://upload.wikimedia.org/wikipedia/commons/thumb/c/c6/Milky_Way_Night_Sky_Black_Rock_Desert_Nevada.jpg/1280px-Milky_Way_Night_Sky_Black_Rock_Desert_Nevada.jpg",
    commonsPageUrl:
      "https://commons.wikimedia.org/wiki/File:Milky_Way_Night_Sky_Black_Rock_Desert_Nevada.jpg",
    creator: "Steve Jurvetson",
    license: "CC BY 2.0",
    attribution: "Photo: Steve Jurvetson, CC BY 2.0, via Wikimedia Commons",
    altText: "The Milky Way arching over the Black Rock Desert, Nevada, on a clear dark night",
    caption: "54-second exposure, Canon EOS 5D, 16mm lens, f/2.8, ISO 800.",
    target: { kind: "content", slug: "astrophotography-for-beginners" },
  },
  {
    sourceImageUrl:
      "https://upload.wikimedia.org/wikipedia/commons/thumb/1/12/Tp_Link_AC1200_Mesh_Wi-Fi_router.jpg/1280px-Tp_Link_AC1200_Mesh_Wi-Fi_router.jpg",
    commonsPageUrl: "https://commons.wikimedia.org/wiki/File:Tp_Link_AC1200_Mesh_Wi-Fi_router.jpg",
    creator: "Atudu",
    license: "CC BY-SA 4.0",
    attribution: "Photo: Atudu, CC BY-SA 4.0, via Wikimedia Commons",
    altText: "A TP-Link AC1200 mesh Wi-Fi router unit",
    target: { kind: "content", slug: "mesh-wifi-vs-single-router" },
  },
  {
    sourceImageUrl:
      "https://upload.wikimedia.org/wikipedia/commons/thumb/0/0c/Canon_EOS_line-up.jpg/1280px-Canon_EOS_line-up.jpg",
    commonsPageUrl: "https://commons.wikimedia.org/wiki/File:Canon_EOS_line-up.jpg",
    creator: "See-ming Lee",
    license: "CC BY 2.0",
    attribution: "Photo: See-ming Lee, CC BY 2.0, via Wikimedia Commons",
    altText: "A collection of Canon EOS camera bodies, lenses, and flash units laid out together",
    caption: "A personal Canon EOS collection spanning multiple camera generations.",
    width: 1280,
    height: 853,
    target: { kind: "content", slug: "canon-dslr-buying-guide" },
  },
];

function sanitizeFileName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9.]+/g, "-").replace(/^-+|-+$/g, "");
}

async function main() {
  const client = await createAdminClient();
  const { data: userData, error: userError } = await client.auth.getUser();
  if (userError || !userData.user) {
    throw new Error(`Could not resolve authenticated admin user: ${userError?.message}`);
  }
  const adminId = userData.user.id;

  const productSlugs = ITEMS.filter((i) => i.target.kind === "product").map((i) =>
    i.target.kind === "product" ? i.target.slug : ""
  );
  const contentSlugs = ITEMS.filter((i) => i.target.kind === "content").map((i) =>
    i.target.kind === "content" ? i.target.slug : ""
  );

  const { data: products } = await client
    .from("products")
    .select("id, slug")
    .in("slug", productSlugs.filter(Boolean));
  const { data: content } = await client
    .from("content_items")
    .select("id, slug")
    .in("slug", contentSlugs.filter(Boolean));

  const productIdBySlug = new Map((products ?? []).map((p) => [p.slug, p.id]));
  const contentIdBySlug = new Map((content ?? []).map((c) => [c.slug, c.id]));

  for (const item of ITEMS) {
    const targetId =
      item.target.kind === "product" ? productIdBySlug.get(item.target.slug) : contentIdBySlug.get(item.target.slug);
    if (!targetId) {
      console.error(`SKIP: ${item.target.kind} slug "${item.target.slug}" not found in production — check spelling.`);
      continue;
    }

    // Idempotency: this script has no upsert key of its own (media_assets
    // rows aren't naturally unique per target), so re-running it after a
    // partial failure — e.g. Wikimedia's rate limit below — must not
    // create a duplicate hero image for a target that already got one.
    const existingLink =
      item.target.kind === "product"
        ? (await client.from("product_media").select("id").eq("product_id", targetId).eq("role", "hero").maybeSingle())
            .data
        : (await client.from("content_media").select("id").eq("content_id", targetId).eq("role", "hero").maybeSingle())
            .data;
    if (existingLink) {
      console.log(`SKIP (already has a hero image): ${item.target.kind} ${item.target.slug}`);
      continue;
    }

    console.log(`Importing for ${item.target.kind} ${item.target.slug} <- ${item.sourceImageUrl}`);

    // Wikimedia rate-limits rapid sequential requests even with a
    // descriptive User-Agent — a real 429 was hit on the 3rd request in
    // the first run of this script. A few seconds between downloads is
    // well within normal, polite scraping etiquette for a one-time,
    // 9-image import.
    await new Promise((r) => setTimeout(r, 7000));

    const res = await fetch(item.sourceImageUrl, {
      headers: { "User-Agent": "TechCarvalho/1.0 (media test-set import; contact via techcarvalho.com)" },
    });
    if (!res.ok) {
      console.error(`  FAILED to download: ${res.status} ${res.statusText}`);
      continue;
    }
    const contentType = res.headers.get("content-type") ?? "image/jpeg";
    const buffer = Buffer.from(await res.arrayBuffer());

    const fileName = sanitizeFileName(item.sourceImageUrl.split("/").pop() ?? "image.jpg");
    const storagePath = `image/${crypto.randomUUID()}-${fileName}`;

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
        width: item.width ?? null,
        height: item.height ?? null,
        license: item.license,
        creator: item.creator,
        caption: item.caption ?? null,
        source_type: "other",
        source_url: item.commonsPageUrl,
        attribution: item.attribution,
        attribution_required: true,
        ai_generated: false,
        owned: false,
        rights_status: "verified",
      })
      .select("id")
      .single();
    if (insertError || !assetRow) {
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
      .eq("id", assetRow.id);
    if (publishError) {
      console.error(`  FAILED to mark published: ${publishError.message}`);
      continue;
    }

    const { error: linkError } =
      item.target.kind === "product"
        ? await client
            .from("product_media")
            .insert({ product_id: targetId, media_id: assetRow.id, role: "hero", sort_order: 0 })
        : await client
            .from("content_media")
            .insert({ content_id: targetId, media_id: assetRow.id, role: "hero", sort_order: 0 });
    if (linkError) {
      console.error(`  FAILED to link as hero image: ${linkError.message}`);
      continue;
    }

    console.log(`  OK: published and linked as hero image (media_assets.id=${assetRow.id})`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
