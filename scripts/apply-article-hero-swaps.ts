// Route A — lead published articles with photographs we ALREADY hold.
//
// Nothing is acquired, nothing is published for the first time, no new media
// row is created. Every asset named here is already `publication_status =
// 'published'` on a product page; this only changes WHICH held image leads an
// already-published article.
//
// For each entry:
//   1. the existing hero content_media row is demoted to role='gallery' (never
//      deleted — a TechCarvalho graphic stays associated with its article and
//      keeps rendering inside the body);
//   2. a new content_media row with role='hero' points at the product's
//      photograph.
// Demote-then-insert, in that order: there is no unique constraint on
// (content_id, role), so two 'hero' rows can coexist and
// getPublishedHeroImage() would then pick one arbitrarily.
//
// ---------------------------------------------------------------------------
// WHY SOME ENTRIES ARE HELD BACK: the article hero has no credit line
// ---------------------------------------------------------------------------
// src/app/(public)/articles/[slug]/page.tsx renders the hero as a bare
// <Image>. Unlike the product page (ProductLeadMedia) and unlike the article's
// own gallery, it never renders <MediaCredit>. Verified against production
// HTML: /articles/canon-dslr-buying-guide leads with a Commons photograph and
// the page contains no figcaption, no creator name, no licence link and no
// source link.
//
// A CC BY / CC BY-SA credit is a licence CONDITION. Moving an
// attribution-required photograph into that slot would publish it without the
// attribution its licence requires — on a page this repo cannot fix and deploy
// from here (code changes only reach the site on a push, which this assistant
// does not do; data changes are live immediately).
//
// So each entry declares `attributionRequired`. Entries that need attribution
// are SKIPPED unless --allow-uncredited is passed, which exists so the whole
// set can be applied in one command the moment the hero slot renders a credit.
// It is not a way to opt out of the licence.
//
// THE UNBLOCK CONDITION, precisely: the article hero must render <MediaCredit>
// for an asset with attribution_required. src/components/public/
// article-lead-media.tsx does exactly that and the article page now uses it —
// but code only reaches the site on a deploy, and data changes are live
// immediately. So the check is not "does the component exist in the repo", it
// is "does https://www.techcarvalho.com/articles/canon-dslr-buying-guide show
// a creator name, a licence link and a source link under its lead image".
// Confirm that against the live page, then re-run with --allow-uncredited.
//
// Usage:
//   npx tsx scripts/apply-article-hero-swaps.ts                 # dry run
//   TC_ADMIN_EMAIL=... TC_ADMIN_PASSWORD=... npx tsx scripts/apply-article-hero-swaps.ts --apply
//   ... --apply --allow-uncredited   # only once the hero renders MediaCredit

import { loadEnvLocal, createAdminClient, IngestPlan } from "./_shared.ts";

type Swap = {
  slug: string;
  /** The product photograph to lead with, by media_assets.id. */
  newAssetId: string;
  /** Why this photograph, in this article. Editorial record, not machinery. */
  rationale: string;
  /** Whether the asset's licence makes the credit line a condition of use. */
  attributionRequired: boolean;
};

// Curated by hand from scripts/audit-hero-opportunities.ts. Every entry is a
// content_products row of role 'primary_subject', except the last, which is a
// 'mentioned' row where the product is unambiguously the article's subject —
// the title asks whether you need that exact card.
const SWAPS: Swap[] = [
  {
    slug: "canon-70d-80d-90d-generation-differences",
    newAssetId: "d446d292-1026-4693-8097-173bef32b3c3", // Canon EOS 80D, public domain
    rationale:
      "Three-generation piece; the 80D is the middle body of the line and representative of all three. Its photograph is public domain, so it also carries no attribution condition the article hero cannot currently satisfy.",
    attributionRequired: false,
  },
  {
    slug: "canon-eos-r-vs-rp",
    newAssetId: "acc5753f-6edf-4cee-8759-09cb62cf5319", // Canon EOS R, CC0
    rationale:
      "The EOS R is the first-named body of the pair and the reference point the RP is judged against. CC0, so no attribution condition.",
    attributionRequired: false,
  },
  {
    slug: "canon-6d-vs-6d-mark-ii",
    newAssetId: "bb5178a2-c299-4f57-a43d-bd8a47b61f74", // Canon EOS 6D Mark II
    rationale: "The article asks whether to upgrade TO the Mark II; that is the body to show.",
    attributionRequired: true,
  },
  {
    slug: "canon-90d-vs-eos-r10",
    newAssetId: "aef1ee15-3021-4814-80dd-ecab19df13e7", // Canon EOS 90D
    rationale: "The 90D is the piece's starting point — the body a reader already owns or is considering against mirrorless.",
    attributionRequired: true,
  },
  {
    slug: "canon-eos-r5-vs-r6",
    newAssetId: "b59b01fe-6339-46b5-91a4-53f897bf689d", // Canon EOS R5
    rationale: "First-named body of the pair; the R6 is defined against it throughout.",
    attributionRequired: true,
  },
  {
    slug: "canon-eos-60d-still-worth-it",
    newAssetId: "a3946f65-ac23-4183-86b6-7004c0bbdb2d", // Canon EOS 60D
    rationale: "The article is entirely about one camera. Its photograph is the hero.",
    attributionRequired: true,
  },
  {
    slug: "canon-eos-r10-vs-r7",
    newAssetId: "a9d18ea1-50e9-4031-983d-e1473cf569a9", // Canon EOS R10
    rationale: "First-named body of the pair and the cheaper entry point the piece leads with.",
    attributionRequired: true,
  },
  {
    slug: "ps5-storage-expansion-compatible-ssd-guide",
    newAssetId: "cefdf09a-b7dd-4911-bf4e-3fee7750edff", // Sony PlayStation 5
    rationale:
      "The article is about the PS5's own storage rules, not about SSDs in general — a PS5 photograph names the right subject. Currently led by the shared 'Gaming & Consoles' category card.",
    attributionRequired: true,
  },
  {
    slug: "do-you-need-rtx-5090-for-1440p-gaming",
    newAssetId: "bb6439da-8aef-4815-a0c1-5e56e7460540", // NVIDIA GeForce RTX 5090
    rationale:
      "Linked only as 'mentioned', but the title asks whether you need this exact card and every section is about it. Currently led by the shared 'Computing' category card.",
    attributionRequired: true,
  },
];

async function main() {
  loadEnvLocal();
  const apply = process.argv.includes("--apply");
  const allowUncredited = process.argv.includes("--allow-uncredited");
  const db = await createAdminClient();
  const plan = new IngestPlan();

  for (const swap of SWAPS) {
    const { data: content, error: contentErr } = await db
      .from("content_items")
      .select("id, title, status")
      .eq("slug", swap.slug)
      .maybeSingle();
    if (contentErr || !content) {
      plan.record({ entity: "article", identifier: swap.slug, action: "error", detail: contentErr?.message ?? "not found" });
      continue;
    }
    if (content.status !== "published") {
      plan.record({ entity: "article", identifier: swap.slug, action: "error", detail: `status is '${content.status}', expected 'published'` });
      continue;
    }

    if (swap.attributionRequired && !allowUncredited) {
      plan.record({
        entity: "article",
        identifier: swap.slug,
        action: "skip",
        detail: "held: article hero slot renders no credit line and this asset's licence requires one",
      });
      continue;
    }

    // The asset must already be published and rights-cleared. This script
    // never publishes anything, so an unpublished asset is a hard error rather
    // than something to fix here.
    const { data: asset, error: assetErr } = await db
      .from("media_assets")
      .select("id, publication_status, public_storage_path, rights_status, alt_text, attribution_required")
      .eq("id", swap.newAssetId)
      .maybeSingle();
    if (assetErr || !asset) {
      plan.record({ entity: "article", identifier: swap.slug, action: "error", detail: assetErr?.message ?? "asset not found" });
      continue;
    }
    if (asset.publication_status !== "published" || !asset.public_storage_path) {
      plan.record({ entity: "article", identifier: swap.slug, action: "error", detail: "asset is not published — this script never publishes" });
      continue;
    }
    // Guard against the declaration in SWAPS drifting from the row itself.
    if (asset.attribution_required !== swap.attributionRequired) {
      plan.record({
        entity: "article",
        identifier: swap.slug,
        action: "error",
        detail: `attribution_required mismatch: row says ${asset.attribution_required}, script says ${swap.attributionRequired}`,
      });
      continue;
    }

    const { data: existing, error: existingErr } = await db
      .from("content_media")
      .select("id, media_id, role, sort_order")
      .eq("content_id", content.id);
    if (existingErr) {
      plan.record({ entity: "article", identifier: swap.slug, action: "error", detail: existingErr.message });
      continue;
    }
    const rows = existing ?? [];
    const currentHeroes = rows.filter((r) => r.role === "hero");

    if (currentHeroes.some((r) => r.media_id === swap.newAssetId)) {
      plan.record({ entity: "article", identifier: swap.slug, action: "skip", detail: "already leads with this asset" });
      continue;
    }

    if (!apply) {
      for (const h of currentHeroes) {
        plan.record({ entity: "demote-graphic", identifier: `${swap.slug} <- ${h.media_id}`, action: "update", detail: "hero -> gallery" });
      }
      plan.record({ entity: "set-hero", identifier: `${swap.slug} <- ${swap.newAssetId}`, action: "create", detail: swap.rationale });
      continue;
    }

    // 1. Demote first, so the article is never momentarily two-hero'd.
    let demoteFailed = false;
    for (const h of currentHeroes) {
      // A row for this asset may already exist as gallery (unique is on
      // content_id+media_id+role); if so, just drop the hero role by deleting
      // the duplicate rather than violating the constraint.
      const clash = rows.some((r) => r.media_id === h.media_id && r.role === "gallery");
      const { error } = clash
        ? await db.from("content_media").delete().eq("id", h.id)
        : await db.from("content_media").update({ role: "gallery" }).eq("id", h.id);
      if (error) {
        plan.record({ entity: "demote-graphic", identifier: `${swap.slug} <- ${h.media_id}`, action: "error", detail: error.message });
        demoteFailed = true;
      } else {
        plan.record({ entity: "demote-graphic", identifier: `${swap.slug} <- ${h.media_id}`, action: "update", detail: clash ? "hero row removed (gallery row already existed)" : "hero -> gallery" });
      }
    }
    if (demoteFailed) continue;

    // 2. Install the photograph as the hero.
    const { error: insertErr } = await db
      .from("content_media")
      .insert({ content_id: content.id, media_id: swap.newAssetId, role: "hero", sort_order: 0 });
    if (insertErr) {
      plan.record({ entity: "set-hero", identifier: `${swap.slug} <- ${swap.newAssetId}`, action: "error", detail: insertErr.message });
      continue;
    }
    plan.record({ entity: "set-hero", identifier: `${swap.slug} <- ${swap.newAssetId}`, action: "create", detail: swap.rationale });
  }

  plan.print(apply ? "apply" : "dry-run");
  if (!allowUncredited) {
    const held = SWAPS.filter((s) => s.attributionRequired).length;
    console.log(
      `${held} swap(s) held back — their licences require a credit line the article hero did not render when this was written.\n` +
        `Check the LIVE page /articles/canon-dslr-buying-guide for a creator name + licence link + source link under the lead\n` +
        `image. Once that is deployed, re-run with --apply --allow-uncredited to land the rest.\n`
    );
  }
  if (plan.hasErrors) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
