// ACCEPTANCE TEST — run the real research pipeline over a real topic.
//
// READ-ONLY. Writes nothing to the database. It fetches the live editorial
// registry, searches it, and prints exactly what the owner would be shown.
//
// A REFUSAL IS A PASS. If the evidence does not support coverage, the correct
// output is CAN BUILD: NO with the reason. Inventing information is the only
// failure mode that matters here.
//
//   npx tsx scripts/research-topic.ts "iPhone 18"
//   npx tsx scripts/research-topic.ts "GTA 6" --category gaming
//   npx tsx scripts/research-topic.ts "RTX 5090" --category computing

import { buildCorpus } from "../src/lib/engine/research/feed-index.ts";
import { researchDiscovery } from "../src/lib/engine/research/research-pipeline.ts";
import { primarySubject, categoryForText, subjectDomainsForText } from "../src/lib/engine/research/entity-model.ts";
import { renderClaim } from "../src/lib/engine/research/claim-extraction.ts";
import { CLAIM_CLASS_LABELS } from "../src/lib/engine/corroboration.ts";
import { fetchArticle, summariseFetches } from "../src/lib/engine/research/article-fetch.ts";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const topic = args.find((a) => !a.startsWith("--"));
  if (!topic) {
    console.error('Usage: npx tsx scripts/research-topic.ts "<topic>" [--category slug] [--unreleased]');
    process.exitCode = 1;
    return;
  }
  const catFlag = args.indexOf("--category");
  const category = catFlag >= 0 ? args[catFlag + 1] : categoryForText(topic);
  const unreleased = args.includes("--unreleased");

  const subject = primarySubject(topic);

  console.log("");
  console.log("=".repeat(74));
  console.log(`RESEARCH: ${topic}`);
  console.log("=".repeat(74));
  console.log(`Subject resolved   : ${subject ? `${subject.organisation.name} (matched "${subject.matchedAlias}")` : "NONE"}`);
  console.log(`Category           : ${category ?? "unmapped"}`);
  console.log(`Treated as unreleased: ${unreleased ? "YES" : "no"}`);

  const corpus = await buildCorpus(category);
  console.log("");
  console.log(`SOURCES ATTEMPTED  : ${corpus.attempted.length}`);
  console.log(`SOURCES READ       : ${corpus.read.length}  (${corpus.read.join(", ")})`);
  if (corpus.failed.length > 0) {
    console.log(`SOURCES FAILED     : ${corpus.failed.length}`);
    for (const f of corpus.failed) console.log(`    ${f.organisation}: ${f.reason}`);
  }
  console.log(`CORPUS INDEXED     : ${corpus.items.length} recent items`);

  // First pass: find what is relevant. Then fetch only THOSE articles — a
  // research pass must not hit every publisher for every topic.
  const shortlist = researchDiscovery({
    title: topic,
    summary: null,
    subjectDomains: subjectDomainsForText(topic),
    aboutUnreleasedProduct: unreleased,
    corpus: corpus.items,
    sourcesAttempted: corpus.attempted,
    sourcesRead: corpus.read,
    sourcesFailed: corpus.failed,
  });

  const articleText = new Map<string, { text: string; contentSource: "full_text" | "feed_summary"; note: string | null }>();
  const fetches = [];
  for (const m of shortlist.matches) {
    if (!m.item.link) continue;
    const got = await fetchArticle(m.item.link, `${m.item.title}. ${m.item.summary ?? ""}`);
    fetches.push(got);
    articleText.set(m.item.link, { text: got.text, contentSource: got.contentSource, note: got.note });
  }

  const result = researchDiscovery({
    title: topic,
    summary: null,
    subjectDomains: subjectDomainsForText(topic),
    aboutUnreleasedProduct: unreleased,
    corpus: corpus.items,
    sourcesAttempted: corpus.attempted,
    sourcesRead: corpus.read,
    sourcesFailed: corpus.failed,
    articleText,
  });

  const fetchSummary = summariseFetches(fetches);

  console.log("");
  console.log("RESEARCH QUERIES GENERATED");
  for (const q of result.queries) console.log(`    [${q.kind.padEnd(11)}] "${q.query}"`);

  console.log("");
  console.log(`MATCHES FOUND      : ${result.matches.length}`);
  for (const m of result.matches) {
    console.log(`    [${m.strength.toFixed(2)}] ${m.item.source.organisation} — ${m.item.title.slice(0, 68)}`);
    console.log(`           ${m.item.link ?? "(no link)"}`);
  }

  console.log("");
  console.log("CONTENT PROVENANCE");
  console.log(`    full text          : ${fetchSummary.fullText} of ${fetchSummary.total}`);
  console.log(`    feed summary only  : ${fetchSummary.feedSummary}`);
  if (Object.keys(fetchSummary.reasons).length > 0) {
    for (const [reason, n] of Object.entries(fetchSummary.reasons)) {
      console.log(`        ${String(reason).padEnd(18)} ${n}`);
    }
  }
  for (const f of fetches) {
    console.log(`    [${f.contentSource === "full_text" ? "FULL" : "SUMM"}] ${String(f.charCount).padStart(6)}ch  ${f.url.slice(0, 60)}`);
    if (f.note) console.log(`             ${f.failureReason}: ${f.note}`);
  }

  console.log("");
  console.log(`INDEPENDENT ORIGINS: ${result.lineage.independentOrigins}`);
  console.log(`    ${result.lineage.explanation}`);
  for (const c of result.lineage.collapsed) {
    console.log(`    COLLAPSED ${c.url.slice(0, 58)}`);
    console.log(`              ${c.reason}`);
  }

  const cb = result.claimBreakdown;
  console.log("");
  console.log(`ATOMIC CLAIMS      : ${cb.total}`);
  console.log(`    assertable ${cb.assertable}  attributed ${cb.attributed}  hedged ${cb.hedged}  with values ${cb.withValues}`);
  for (const claim of result.claims.slice(0, 8)) {
    console.log(`    - ${renderClaim(claim).slice(0, 110)}`);
    if (claim.hedges.length > 0) console.log(`        hedges: ${claim.hedges.join(", ")}`);
    if (claim.values.length > 0) console.log(`        values: ${claim.values.join(", ")}`);
  }

  console.log("");
  console.log("CLAIM CLASSIFICATION");
  console.log(`    Class            : ${CLAIM_CLASS_LABELS[result.corroboration.claimClass]}`);
  console.log(`    Independent      : ${result.corroboration.independentPublishers} of ${result.corroboration.required} required`);
  console.log(`    Assertability    : ${result.corroboration.assertability}`);
  console.log(`    CONFIRMED        : ${result.decision.framing === "confirmed" ? cb.assertable : 0}`);
  console.log(`    REPORTED         : ${result.decision.framing === "reported" || result.decision.framing === "confirmed" ? cb.attributed : 0}`);
  console.log(`    RUMOURED         : ${cb.hedged}`);
  console.log(`    UNKNOWN          : everything not listed above, and it stays unknown`);

  console.log("");
  console.log("DECISION");
  console.log(`    Framing          : ${result.decision.framing.toUpperCase()}`);
  console.log(`    Article eligible : ${result.decision.articleEligible ? "YES" : "NO"}`);
  console.log(`    Product eligible : ${result.decision.productEligible ? "YES" : "NO"}`);
  console.log(`    Suggested title  : ${result.decision.suggestedTitle ?? "(none — nothing honest to write)"}`);
  for (const r of result.decision.reasons) console.log(`    - ${r}`);

  console.log("");
  console.log(`CAN BUILD          : ${result.decision.articleEligible ? "YES (article only)" : "NO"}`);
  console.log("");
  console.log("Read-only. Nothing was written.");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
