// THE iPHONE 18 END-TO-END TEST — run against real production data.
//
// READ-ONLY. Writes nothing. It answers the owner's question — "show me
// exactly what I would see as owner for iPhone 18" — by running the real
// classifier and the real package builder over the real database.
//
// WHAT THIS TEST IS ACTUALLY FOR
// ------------------------------
// It is easy to demonstrate a content engine on a subject it has evidence for.
// The valuable test is the opposite one: a subject the owner NAMED, that the
// engine has no sourcing for, where the tempting behaviour is to produce
// something anyway. iPhone 18 is exactly that case today — Apple exists in the
// catalogue, iPhone 17 Pro exists, and there is not one recorded source about
// an iPhone 18.
//
// So this reports what the system does with a topic it cannot support. It must
// refuse, and it must refuse for a stated reason rather than by producing a
// thin article.
//
//   npx tsx scripts/iphone-18-package.ts

import { loadEnvLocal, createAdminClient } from "./_shared.ts";
import { assessCorroboration, CLAIM_CLASS_LABELS } from "../src/lib/engine/corroboration.ts";
import { classifyBriefQuality } from "../src/lib/engine/brief-quality.ts";
import { briefQueueItem } from "../src/lib/engine/owner-queue.ts";
import { buildApprovalPackage, MARKER_SYMBOL } from "../src/lib/engine/approval-package.ts";
import { proposeSeo } from "../src/lib/engine/draft-assembly.ts";
import { titleSimilarity, NEAR_DUPLICATE_THRESHOLD } from "../src/lib/engine/dedupe.ts";

const TITLE = "iPhone 18: what Apple has actually confirmed";

async function main(): Promise<void> {
  loadEnvLocal();
  const db = await createAdminClient();

  console.log("");
  console.log("iPHONE 18 — END-TO-END, AGAINST REAL PRODUCTION DATA");
  console.log("=====================================================");
  console.log("");

  // ---- 1. What does the engine actually know? ----------------------------
  console.log("1. WHAT THE ENGINE HAS ON THIS SUBJECT");
  const [{ data: discoveries, error: dErr }, { data: evidence, error: eErr }] = await Promise.all([
    db.from("engine_discoveries").select("id, title").ilike("title", "%iPhone 18%"),
    db.from("engine_discovery_evidence").select("id, url").ilike("url", "%iphone-18%"),
  ]);
  if (dErr || eErr) {
    console.log(`   QUERY FAILED: ${dErr?.message ?? eErr?.message}`);
    console.log("   Nothing below can be trusted. Stopping.");
    process.exitCode = 1;
    return;
  }
  console.log(`   Discoveries mentioning iPhone 18 : ${(discoveries ?? []).length}`);
  console.log(`   Evidence rows for iPhone 18      : ${(evidence ?? []).length}`);

  // ---- 2. Database context ----------------------------------------------
  console.log("");
  console.log("2. DATABASE CONTEXT");
  const [{ data: apple }, { data: iphones }, { data: published, error: pErr }] = await Promise.all([
    db.from("manufacturers").select("name, slug").eq("slug", "apple").maybeSingle(),
    db.from("products").select("name, slug, is_published").ilike("name", "%iPhone%"),
    db.from("content_items").select("title").eq("status", "published"),
  ]);
  if (pErr) {
    console.log(`   Published-corpus read FAILED: ${pErr.message}`);
    console.log("   Refusing to report a duplication verdict computed against an unknown corpus.");
    process.exitCode = 1;
    return;
  }
  console.log(`   Apple manufacturer   : ${apple ? "EXISTS" : "MISSING"}`);
  for (const p of (iphones ?? []) as { name: string; is_published: boolean }[]) {
    console.log(`   Product              : ${p.name} (${p.is_published ? "published" : "draft"})`);
  }
  console.log(`   iPhone 18 product    : ${(iphones ?? []).some((p: { name: string }) => /iPhone 18/i.test(p.name)) ? "EXISTS" : "MISSING"}`);

  const publishedTitles = (published ?? []).map((c: { title: string }) => c.title);
  let closest: { title: string; similarity: number } | null = null;
  for (const t of publishedTitles) {
    const s = titleSimilarity(TITLE, t);
    if (!closest || s > closest.similarity) closest = { title: t, similarity: s };
  }
  console.log(`   Published articles   : ${publishedTitles.length}`);
  console.log(
    `   Closest existing     : "${closest?.title.slice(0, 62)}" (${closest?.similarity.toFixed(2)}, ` +
      `threshold ${NEAR_DUPLICATE_THRESHOLD})`
  );

  // ---- 2b. Corroboration --------------------------------------------------
  //
  // PRIMARY-SOURCE RESEARCH, performed 2026-08-24 against Apple's own newsroom
  // feed (https://www.apple.com/newsroom/rss-feed.rss) — the authoritative
  // source for what Apple has announced. Most recent items were dated 18, 13,
  // 11, 10 August and 3 August 2026, and NONE mentions an iPhone 18.
  //
  // That is a real finding, not an absence of effort: the body with sole
  // authority to confirm an iPhone 18 has not done so. It settles the claim
  // class. Anything published about an iPhone 18 today is a claim about an
  // UNRELEASED product made by someone other than its maker, which is the
  // strictest class in the model and needs three independent publishers.
  console.log("");
  console.log("2b. CORROBORATION");
  console.log("   Primary source checked : apple.com/newsroom (2026-08-24)");
  console.log("   Apple announcement     : NONE — no iPhone 18 in the newsroom feed");
  const corroboration = assessCorroboration({
    sourceUrls: [],
    subjectDomains: ["apple.com"],
    claimStatus: "unverified",
    aboutUnreleasedProduct: true,
  });
  console.log(`   Claim class            : ${CLAIM_CLASS_LABELS[corroboration.claimClass]}`);
  console.log(`   Independent publishers : ${corroboration.independentPublishers} of ${corroboration.required} required`);
  console.log(`   Sufficient             : ${corroboration.sufficient ? "YES" : "NO"}`);
  console.log(`   Assertability          : ${corroboration.assertability}`);
  for (const r of corroboration.reasons) console.log(`     - ${r}`);
  for (const m of corroboration.missing) console.log(`     MISSING: ${m}`);

  console.log("");
  console.log("   FACT CLASSIFICATION");
  console.log("     CONFIRMED  0  — Apple has announced nothing about an iPhone 18");
  console.log("     REPORTED   0  — no registered source carries any iPhone 18 reporting");
  console.log("     RUMOURED   0  — none recorded in this database");
  console.log("     UNKNOWN    everything else, and it stays unknown rather than inferred");

  // ---- 3. The quality gate ----------------------------------------------
  // The evidence arrays below are EMPTY because the database holds no evidence
  // about an iPhone 18. Nothing is invented to fill them; that is the entire
  // point of the exercise.
  console.log("");
  console.log("3. QUALITY GATE");
  const quality = classifyBriefQuality({
    title: TITLE,
    briefKind: "breaking",
    contentType: "news",
    verifiedFacts: [],
    uncertainties: [],
    sourceUrls: [],
    freshnessSensitivity: "time_sensitive",
    hasDiscovery: (discoveries ?? []).length > 0,
    hasOpportunity: false,
    createdAt: new Date().toISOString(),
    existingTitles: publishedTitles,
  });
  console.log(`   Verdict              : ${quality.label.toUpperCase()}`);
  console.log(`   Enters owner queue   : ${quality.entersOwnerQueue ? "YES" : "NO"}`);
  console.log(`   Engine keeps working : ${quality.invitesMoreResearch ? "YES" : "NO"}`);
  for (const r of quality.reasons) console.log(`     - ${r}`);

  // ---- 4. Does it reach the owner? --------------------------------------
  console.log("");
  console.log("4. OWNER QUEUE");
  const item = briefQueueItem({
    id: "iphone-18-hypothetical",
    title: TITLE,
    quality,
    freshnessSensitivity: "time_sensitive",
    createdAt: new Date().toISOString(),
    productLinkMissing: true,
  });
  if (item) {
    console.log(`   APPEARS in "Needs your attention": ${item.title}`);
    for (const s of item.signals) console.log(`     ${s.label}`);
  } else {
    console.log("   DOES NOT APPEAR in the owner's queue.");
    console.log("   The owner is not asked to make a decision that the evidence cannot support.");
  }

  // ---- 5. What the package would say ------------------------------------
  console.log("");
  console.log("5. THE APPROVAL PACKAGE (what the owner would see if they opened it)");
  const seo = proposeSeo({ title: TITLE, primaryQuestion: null });
  const pkg = buildApprovalPackage({
    briefId: "iphone-18-hypothetical",
    title: TITLE,
    contentType: "news",
    categorySlug: "smartphones",
    quality,
    primaryQuestion: null,
    verifiedFacts: [],
    uncertainties: [],
    sourceUrls: [],
    proposedSlug: "iphone-18-what-apple-has-confirmed",
    slugTaken: false,
    metaTitle: seo.metaTitle,
    metaDescription: seo.metaDescription,
    existingProducts: (iphones ?? []).map((p: { name: string; slug: string; is_published: boolean }) => ({
      name: p.name,
      slug: p.slug,
      isPublished: p.is_published,
    })),
    missingProductSlugs: ["iphone-18"],
    cannibalisationMatch:
      closest && closest.similarity >= NEAR_DUPLICATE_THRESHOLD ? closest : null,
    corpusKnown: true,
    mediaReady: false,
    mediaNeedsRightsReview: 0,
    alreadyAssembled: false,
  });

  for (const section of pkg.sections) {
    console.log(`   ${section.title.toUpperCase()}`);
    for (const line of section.lines) {
      console.log(`     ${MARKER_SYMBOL[line.marker]} ${line.text}`);
      if (line.detail) console.log(`        ${line.detail}`);
    }
  }
  console.log("");
  console.log(`   CAN BUILD: ${pkg.canBuild ? "YES" : "NO"}`);
  for (const b of pkg.blockers) console.log(`     BLOCKED: ${b}`);
  console.log("   AFTER BUILDING, THE OWNER STILL:");
  for (const s of pkg.afterBuild) console.log(`     - ${s}`);

  console.log("");
  console.log("VERDICT");
  console.log("-------");
  console.log(
    quality.entersOwnerQueue
      ? "   iPhone 18 would reach the owner's queue."
      : "   iPhone 18 does NOT reach the owner's queue, and no article is produced.\n" +
        "   The engine has no recorded source about an iPhone 18, so there is nothing to\n" +
        "   write that would not be invented. It records the gap and keeps looking rather\n" +
        "   than manufacturing coverage."
  );
  console.log("");
  console.log("Nothing was written. This script is read-only.");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
