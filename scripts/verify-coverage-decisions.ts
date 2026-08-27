// COVERAGE GAP INTELLIGENCE, AGAINST THE REAL CORPUS.
//
// Runs decideCoverage() over the ACTUAL 128 content_items in production and
// asks the four questions the brief asks:
//
//   NEW ARTICLE      nothing close enough exists
//   UPDATE EXISTING  a page covers this subject and this is more of it
//   SUPPORTING       related, genuinely distinct, adds something
//   NO COVERAGE      not worth a page
//
// AND — the part that matters most — whether an article about one model is
// wrongly counted as coverage of its sibling. A missed story the system reports
// as handled is worse than a missed story.
//
// Subjects are drawn from the entities the owner named. Nothing here invents
// demand data, search volume or popularity: a subject is fed in with a stated
// framing and origin count, and the decision is reported as the engine makes it.
//
//   TC_ADMIN_EMAIL=... TC_ADMIN_PASSWORD=... npx tsx scripts/verify-coverage-decisions.ts
//
// It writes nothing.

import { loadEnvLocal, createAdminClient } from "./_shared.ts";
import { decideCoverage, SAME_STORY_THRESHOLD, type ExistingPiece } from "../src/lib/engine/coverage-decision.ts";
import { compareModelIdentity } from "../src/lib/engine/model-identity.ts";
import { FALSE_MATCH_PAIRS } from "../src/lib/media/false-match-corpus.ts";

loadEnvLocal();

type Probe = {
  subject: string;
  categorySlug: string | null;
  framing: "confirmed" | "reported" | "rumoured" | "insufficient";
  independentOrigins: number;
  claimCount: number;
  /** What a careful editor would expect, so a surprise is visible as a surprise. */
  expect: string;
};

// Deliberately spread across the ecosystems the owner named, and deliberately
// including subjects this site HAS covered as well as ones it has not — a test
// where everything is NEW_ARTICLE proves only that the corpus is small.
const PROBES: Probe[] = [
  { subject: "Samsung Galaxy S26 Ultra announced with new camera system", categorySlug: "smartphones", framing: "reported", independentOrigins: 3, claimCount: 4, expect: "the site has an S26 Ultra comparison piece" },
  { subject: "One UI 8.5 begins rolling out to Galaxy S25", categorySlug: "smartphones", framing: "confirmed", independentOrigins: 3, claimCount: 3, expect: "no One UI coverage exists" },
  { subject: "Apple iPhone 18 Pro event date confirmed", categorySlug: "smartphones", framing: "confirmed", independentOrigins: 4, claimCount: 2, expect: "iPhone 17 Pro piece exists; 18 Pro is a different model" },
  { subject: "Google Pixel 10 Pro camera update ships", categorySlug: "smartphones", framing: "reported", independentOrigins: 2, claimCount: 3, expect: "Pixel 10 Pro appears in a flagship comparison" },
  { subject: "NVIDIA GeForce RTX 5090 review embargo lifts", categorySlug: "computing", framing: "confirmed", independentOrigins: 3, claimCount: 3, expect: "RTX 5090 is in the catalogue" },
  { subject: "AMD Ryzen 7 9800X3D price cut confirmed", categorySlug: "computing", framing: "confirmed", independentOrigins: 2, claimCount: 2, expect: "a 9800X3D vs 9950X piece exists" },
  { subject: "Canon EOS R5 Mark II firmware 2.0 adds subject detection", categorySlug: "cameras-photography", framing: "confirmed", independentOrigins: 2, claimCount: 3, expect: "R5 exists; Mark II is a DIFFERENT camera" },
  { subject: "Nikon Z9 firmware 6.0 released", categorySlug: "cameras-photography", framing: "confirmed", independentOrigins: 2, claimCount: 2, expect: "no Nikon coverage" },
  { subject: "Microsoft confirms next-generation Xbox hardware", categorySlug: "gaming", framing: "reported", independentOrigins: 3, claimCount: 2, expect: "a PS6/Xbox rumour tracker exists" },
  { subject: "Sony PlayStation 5 Pro stock returns", categorySlug: "gaming", framing: "reported", independentOrigins: 2, claimCount: 2, expect: "PS5 vs PS5 Pro piece exists" },
  { subject: "Nintendo Switch 2 system update improves load times", categorySlug: "gaming", framing: "confirmed", independentOrigins: 2, claimCount: 2, expect: "a Switch 2 comparison exists" },
  { subject: "DJI Mini 4 Pro receives new obstacle-avoidance firmware", categorySlug: "drones-fpv", framing: "confirmed", independentOrigins: 2, claimCount: 3, expect: "Mini 4 Pro is in the catalogue" },
  { subject: "Bambu Lab H2D launches with dual-nozzle system", categorySlug: "3d-printing", framing: "confirmed", independentOrigins: 3, claimCount: 4, expect: "little/no Bambu coverage" },
  { subject: "Wi-Fi 8 draft specification published", categorySlug: "networking", framing: "reported", independentOrigins: 2, claimCount: 2, expect: "Wi-Fi 7 pieces exist; Wi-Fi 8 is different" },
];

async function main(): Promise<void> {
  const db = await createAdminClient();

  const { data, error } = await db
    .from("content_items")
    .select("id, title, slug, status, category_id, published_at");
  if (error) throw new Error(`content_items: ${error.message}`);

  const { data: cats } = await db.from("taxonomy_categories").select("id, slug");
  const catSlug = new Map(((cats ?? []) as { id: string; slug: string }[]).map((c) => [c.id, c.slug]));

  const existing: ExistingPiece[] = (
    (data ?? []) as {
      id: string;
      title: string;
      slug: string;
      status: string;
      category_id: string | null;
      published_at: string | null;
    }[]
  ).map((c) => ({
    id: c.id,
    title: c.title,
    slug: c.slug,
    status: c.status,
    categorySlug: c.category_id ? (catSlug.get(c.category_id) ?? null) : null,
    publishedAt: c.published_at,
  }));

  console.log("=".repeat(78));
  console.log(`COVERAGE DECISIONS against ${existing.length} real content_items`);
  console.log("=".repeat(78));

  const tally: Record<string, number> = {};
  for (const probe of PROBES) {
    const v = decideCoverage({
      subject: probe.subject,
      categorySlug: probe.categorySlug,
      independentOrigins: probe.independentOrigins,
      framing: probe.framing,
      claimCount: probe.claimCount,
      existing,
    });
    tally[v.decision] = (tally[v.decision] ?? 0) + 1;

    console.log(`\n  SUBJECT   ${probe.subject}`);
    console.log(`  DECISION  ${v.decision}${v.target ? `  ->  "${v.target.title}"` : ""}`);
    console.log(`  SIMILARITY ${v.similarity.toFixed(2)}   (same-story line is ${SAME_STORY_THRESHOLD})`);
    console.log(`  WHY       ${v.reasons[0] ?? "(none)"}`);
    for (const r of v.reasons.slice(1, 3)) console.log(`            ${r}`);
    if (v.nearby.length > 0) {
      console.log(`  CONSIDERED ${v.nearby.slice(0, 3).map((n) => `${n.similarity.toFixed(2)} "${n.piece.title.slice(0, 52)}"`).join("  |  ")}`);
    }
  }

  console.log(`\n  TALLY  ${JSON.stringify(tally)}`);

  // -------------------------------------------------------------------------
  // PRODUCT SPECIFICITY: the failure that reports a missed story as handled.
  // -------------------------------------------------------------------------
  console.log(`\n${"=".repeat(78)}`);
  console.log("PRODUCT SPECIFICITY — is one model's article counted as coverage of its sibling?");
  console.log("=".repeat(78));

  let leaked = 0;
  for (const pair of FALSE_MATCH_PAIRS) {
    const subject = `${pair.subject} announced`;
    const sibling = `${pair.sibling} announced`;
    const identity = compareModelIdentity(subject, sibling);

    // Feed the engine a corpus that contains ONLY the sibling's article. If it
    // says UPDATE_EXISTING, it has decided the older model's page covers the
    // newer product.
    const siblingOnly: ExistingPiece[] = [
      {
        id: "sibling",
        title: sibling,
        slug: "sibling",
        status: "published",
        categorySlug: null,
        publishedAt: new Date(Date.now() - 30 * 86400_000).toISOString(),
      },
    ];
    const v = decideCoverage({
      subject,
      categorySlug: null,
      independentOrigins: 3,
      framing: "confirmed",
      claimCount: 3,
      existing: siblingOnly,
      now: new Date(),
    });

    const wrong = v.decision === "UPDATE_EXISTING";
    if (wrong) leaked++;
    console.log(`\n  ${wrong ? "*** LEAKED" : "OK       "}  "${pair.subject}"  vs existing  "${pair.sibling}"`);
    console.log(`             decision ${v.decision}   similarity ${v.similarity.toFixed(2)}   identity: ${identity.sameModel ? "SAME MODEL" : `different (${identity.differing.join(", ")})`}`);
    if (!identity.sameModel) console.log(`             ${v.reasons.find((r) => /model|designation/i.test(r)) ?? v.reasons[0] ?? ""}`);
  }

  console.log(`\n  ${FALSE_MATCH_PAIRS.length - leaked}/${FALSE_MATCH_PAIRS.length} sibling pairs correctly NOT treated as covered`);
  console.log(`  PHASE 3 PRODUCT SPECIFICITY: ${leaked === 0 ? "PASS" : "FAIL"}\n`);
  if (leaked > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
