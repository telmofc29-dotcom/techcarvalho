// Finding I8 of docs/adsense-readiness-audit.md: two undated current-market
// price claims in one published article body.
//
// THE PROBLEM
// -----------
// `gopro-hero13-vs-osmo-action-5-pro` said, with no date and no source:
//
//   "HERO13 Black: $399 MSRP (street pricing has dropped toward $329-379).
//    Osmo Action 5 Pro: $349 MSRP, now listed around $319 on DJI's own store."
//
// The two MSRPs are fine: they come from the GoPro and DJI launch announcements
// that are already recorded as this piece's source_records, and a launch price
// does not change. "Street pricing has dropped toward…" and "now listed around…"
// are claims about the market *right now*, made on a page that also renders an
// "Updated" date. They were true on the day they were written and they become
// false silently, with nothing on the page to tell a reader when they were made.
//
// THE FIX, AND WHY IT IS TWO DIFFERENT FIXES
// ------------------------------------------
//  - "now listed around $319 on DJI's own store" carries an attribution, so
//    dating it makes it a complete, checkable statement about a moment:
//    "As of 21 August 2026, DJI's own store listed…". Kept, dated.
//  - "street pricing has dropped toward $329-379" has no attribution at all.
//    "Street pricing" is an aggregate over retailers this site does not track,
//    so a date cannot rescue it — it would just be an unsourced claim with a
//    timestamp. Removed, and replaced with the honest instruction to check a
//    retail listing.
//  - The closing "$20-30 difference" depended on the street prices. With those
//    gone it no longer follows from anything on the page, so it is re-anchored
//    to the MSRP gap, which is durable. This is not an unrelated edit: it is the
//    rest of the same claim.
//
// No price is invented, and no price that was not already on the page appears
// on it afterwards. The article stays 206-ish words and stays on the thin-page
// triage list — this is a truthfulness fix, not a length fix.
//
// RE-RUNNABLE
// -----------
// Three outcomes, and it prints which one happened:
//   * body still carries the original text  -> rewrite (with --apply)
//   * body already carries the fixed text   -> nothing to do, exit 0
//   * body carries neither                  -> throw. Someone else edited it,
//                                              and silently overwriting their
//                                              work would be worse than failing.
// Default is a dry run. `--apply` writes.
//
// Editing `body` bumps `content_items.translatable_revision` via the trigger
// from 20260824_translation_model.sql. That is correct — the prose genuinely
// changed, and any translation of this piece genuinely is now out of date.
// (Checked at the time of writing: this piece has no translations.)
//
// Usage:
//   npx tsx scripts/fix-undated-price-claims.ts
//   TC_ADMIN_EMAIL=... TC_ADMIN_PASSWORD=... npx tsx scripts/fix-undated-price-claims.ts --apply

import { loadEnvLocal, createAdminClient } from "./_shared.ts";
import { countBodyWords } from "../src/lib/content/reading-time.ts";

const SLUG = "gopro-hero13-vs-osmo-action-5-pro";

/** Exactly as published on 2026-08-21. Matched literally, not by regex. */
const BEFORE =
  "HERO13 Black: $399 MSRP (street pricing has dropped toward $329-379). " +
  "Osmo Action 5 Pro: $349 MSRP, now listed around $319 on DJI's own store. " +
  "Don't let a $20-30 difference be the deciding factor — battery life and low-light performance should be.";

/**
 * The article's own published_at, written out. Deliberately a constant and not
 * `new Date()`: the date belongs to when the observation was made, not to when
 * this script happens to run. Re-running it next year must not re-date the
 * claim to next year.
 */
const PUBLICATION_DATE = "21 August 2026";

const AFTER =
  "HERO13 Black: $399 MSRP. Osmo Action 5 Pro: $349 MSRP. Those are the launch prices in the " +
  "manufacturers' own announcements, and they are the only price figures on this page that stay true. " +
  `As of ${PUBLICATION_DATE}, DJI's own store listed the Action 5 Pro at around $319; street prices move ` +
  "constantly and are not tracked here, so check a current retail listing before treating any number on " +
  "this page as today's price. A $50 gap in MSRP should not be the deciding factor — battery life and " +
  "low-light performance should be.";

async function main(): Promise<void> {
  loadEnvLocal();
  const apply = process.argv.includes("--apply");
  const supabase = await createAdminClient();

  const read = await supabase
    .from("content_items")
    .select("id, slug, title, body, status, locale, published_at, translatable_revision")
    .eq("slug", SLUG)
    .eq("locale", "en");
  if (read.error) throw new Error(`reading content_items failed — ${read.error.message}`);
  if (read.data === null) throw new Error("reading content_items returned null rather than rows");
  if (read.data.length !== 1) throw new Error(`expected exactly 1 row for ${SLUG}, got ${read.data.length}`);

  const item = read.data[0];
  const body = item.body;
  if (!body) throw new Error(`${SLUG} has no body`);

  console.log(`article : ${item.title}`);
  console.log(`slug    : ${item.slug}  (${item.status}, published ${item.published_at})`);
  console.log(`revision: translatable_revision=${item.translatable_revision}`);
  console.log(`words   : ${countBodyWords(body)}\n`);

  if (body.includes(AFTER)) {
    console.log("ALREADY APPLIED — the body already carries the dated text. Nothing to do.\n");
    console.log("current text:");
    console.log(`  ${AFTER}`);
    return;
  }

  if (!body.includes(BEFORE)) {
    throw new Error(
      `${SLUG} carries neither the original price paragraph nor the fixed one. The body has been edited ` +
        `by something else since this script was written; refusing to guess. Re-read the body and update ` +
        `BEFORE/AFTER in this file deliberately.`
    );
  }

  console.log("BEFORE:");
  console.log(`  ${BEFORE}\n`);
  console.log("AFTER:");
  console.log(`  ${AFTER}\n`);

  const next = body.replace(BEFORE, AFTER);
  console.log(`word count: ${countBodyWords(body)} -> ${countBodyWords(next)}\n`);

  if (!apply) {
    console.log("DRY RUN — nothing written. Re-run with --apply to write it.");
    return;
  }

  const write = await supabase.from("content_items").update({ body: next }).eq("id", item.id);
  if (write.error) throw new Error(`updating content_items failed — ${write.error.message}`);

  const verify = await supabase
    .from("content_items")
    .select("body, translatable_revision, updated_at")
    .eq("id", item.id)
    .single();
  if (verify.error) throw new Error(`verifying the write failed — ${verify.error.message}`);
  if (verify.data === null) throw new Error("verifying the write returned null rather than a row");
  if (!verify.data.body?.includes(AFTER)) {
    throw new Error("the write reported success but the body read back does not contain the new text");
  }
  if (verify.data.body.includes("street pricing has dropped")) {
    throw new Error("the write reported success but the undated street-price claim is still present");
  }

  console.log("APPLIED and read back.");
  console.log(`translatable_revision: ${item.translatable_revision} -> ${verify.data.translatable_revision}`);
  console.log(`updated_at: ${verify.data.updated_at}`);
}

main().catch((err) => {
  console.error(`\nFAILED: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
