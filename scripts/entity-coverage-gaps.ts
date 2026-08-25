// ACTIVE COVERAGE-GAP CHECK for watchlist entities.
//
// THE INVERSION THAT MATTERS
// --------------------------
// The previous expansion asked "is there a story called 'Samsung Galaxy'?" and
// got NO_COVERAGE, because a brand-only query is TOPICAL — it identifies a
// company, not a development, and the matcher correctly refuses to treat
// "mentions Samsung" as "is about this story".
//
// This asks the opposite question: "what is the corpus actually saying about
// Samsung, and which of those are we not covering?". The entity is the FILTER,
// not the search term, so the stories surface as themselves.
//
// WHAT IT WILL NOT DO
// -------------------
// Manufacture a development. If a watched company has genuinely done nothing
// newsworthy in the feed window, it reports exactly that. "No recent article"
// is never on its own a reason to write one.
//
//   npx tsx scripts/entity-coverage-gaps.ts                 (report)
//   npx tsx scripts/entity-coverage-gaps.ts --apply         (create drafts for urgent gaps)
//   npx tsx scripts/entity-coverage-gaps.ts --tier 1
//   npx tsx scripts/entity-coverage-gaps.ts --entity Samsung

import { loadEnvLocal, createAdminClient } from "./_shared.ts";
import { buildCorpus } from "../src/lib/engine/research/feed-index.ts";
import { researchDiscovery, subjectNoun } from "../src/lib/engine/research/research-pipeline.ts";
import { fetchArticle } from "../src/lib/engine/research/article-fetch.ts";
import { subjectDomainsForText } from "../src/lib/engine/research/entity-model.ts";
import { assembleDraft, proposeSeo } from "../src/lib/engine/draft-assembly.ts";
import { proposeSlug } from "../src/lib/engine/entity-resolution.ts";
import { decideCoverage, consolidateOpportunities, type ExistingPiece } from "../src/lib/engine/coverage-decision.ts";
import { assessSubject } from "../src/lib/engine/subject-quality.ts";
import { categoryForSubject } from "../src/lib/engine/subject-category.ts";
import { assessCorroboration } from "../src/lib/engine/corroboration.ts";
import {
  PRIORITY_ENTITIES, assessPriority, classifyImportance, TIER_LABELS,
  type PriorityEntity,
} from "../src/lib/engine/priority-entities.ts";
import { titleSimilarity } from "../src/lib/engine/dedupe.ts";

type Gap = {
  entity: string;
  tier: number;
  headline: string;
  link: string | null;
  publisher: string;
  importance: string;
  score: number;
  reason: string;
  urgent: boolean;
  covered: boolean;
};

/**
 * Confidence to record on an update proposal, from independent origins.
 *
 * Deliberately conservative and capped below certainty: this is "how sure are
 * we that there is something new here", not "how sure are we that it is true".
 * The claim's truth is the corroboration model's job, not this number's.
 */
function corroborationConfidence(origins: number): number {
  if (origins >= 3) return 0.8;
  if (origins === 2) return 0.6;
  return 0.4;
}

async function main(): Promise<void> {
  loadEnvLocal();
  const apply = process.argv.includes("--apply");
  const tierIdx = process.argv.indexOf("--tier");
  const onlyTier = tierIdx >= 0 ? Number(process.argv[tierIdx + 1]) : null;
  const entIdx = process.argv.indexOf("--entity");
  const onlyEntity = entIdx >= 0 ? process.argv[entIdx + 1] : null;

  const db = await createAdminClient();

  const [{ data: content }, { data: cats }, { data: makers }, { data: briefs }] = await Promise.all([
    db.from("content_items").select("id, title, slug, status, category_id, published_at"),
    db.from("taxonomy_categories").select("id, slug"),
    db.from("manufacturers").select("name"),
    db.from("engine_briefs").select("proposed_title, review_state"),
  ]);
  const catIdBySlug = new Map(((cats ?? []) as { id: string; slug: string }[]).map((c) => [c.slug, c.id]));
  const catSlugById = new Map(((cats ?? []) as { id: string; slug: string }[]).map((c) => [c.id, c.slug]));
  const knownMakers = ((makers ?? []) as { name: string }[]).map((m) => m.name);

  const existing: ExistingPiece[] = ((content ?? []) as {
    id: string; title: string; slug: string; status: string;
    category_id: string | null; published_at: string | null;
  }[]).map((c) => ({
    id: c.id, title: c.title, slug: c.slug, status: c.status,
    categorySlug: c.category_id ? (catSlugById.get(c.category_id) ?? null) : null,
    publishedAt: c.published_at,
  }));
  for (const b of (briefs ?? []) as { proposed_title: string; review_state: string }[]) {
    if (b.review_state === "rejected") continue;
    existing.push({ id: `brief:${b.proposed_title}`, title: b.proposed_title, slug: "", status: "draft", categorySlug: null, publishedAt: null });
  }
  // Two different headlines can reduce to the same templated title, which is
  // how one run produced "Apple: what has been reported so far" twice. The
  // subject-level duplicate check cannot see that, because it compares
  // subjects and this collides at the TITLE.
  const usedTitles = new Set(
    ((content ?? []) as { title: string }[]).map((c) => c.title.toLowerCase().trim())
  );
  const takenSlugs = new Set(((content ?? []) as { slug: string }[]).map((c) => c.slug));

  const entities = PRIORITY_ENTITIES.filter(
    (e) => (onlyTier === null || e.tier === onlyTier) && (onlyEntity === null || e.name === onlyEntity)
  );

  console.log("");
  console.log("=".repeat(80));
  console.log(`ENTITY COVERAGE GAPS  ${apply ? "(APPLYING)" : "(report)"}  —  ${entities.length} entities`);
  console.log("=".repeat(80));

  // One corpus per category, shared across every entity in it.
  const corpusCache = new Map<string, Awaited<ReturnType<typeof buildCorpus>>>();
  const allGaps: Gap[] = [];
  const perEntity = new Map<
    string,
    { tier: number; found: number; developments: number; gaps: number; urgent: number; latestCoverage: string | null; latestDevelopment: string | null }
  >();

  for (const entity of entities) {
    const items: { title: string; summary: string | null; link: string | null; publisher: string; group: string; publishedAt: string | null }[] = [];

    for (const category of entity.categories) {
      if (!corpusCache.has(category)) corpusCache.set(category, await buildCorpus(category));
      for (const item of corpusCache.get(category)!.items) {
        // ATTRIBUTION COMES FROM THE HEADLINE, NOT THE BODY.
        //
        // Matching on title + summary attributed "Nikon has ended their
        // relationship with Pro Distributors" to SONY, because Sony was
        // mentioned somewhere in the summary. The story was then drafted as a
        // Sony coverage gap, which is simply false.
        //
        // A development belongs to the company its HEADLINE is about. Aliases
        // already include product names ("iphone", "ender", "neptune"), so a
        // headline that names the product without the maker still matches.
        const matches = (text: string) =>
          entity.aliases.some((a) => {
            const p = new RegExp(`(^|[^a-z0-9])${a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`, "i");
            return p.test(text);
          });
        if (matches(item.title)) {
          items.push({
            title: item.title, summary: item.summary, link: item.link,
            publisher: item.source.organisation, group: item.source.independenceGroup,
            publishedAt: item.publishedAt ?? null,
          });
        }
      }
    }

    // Existing coverage of this entity, and when it was last written about.
    const covering = existing.filter((e) =>
      entity.aliases.some((a) => new RegExp(`(^|[^a-z0-9])${a}([^a-z0-9]|$)`, "i").test(e.title))
    );
    const latest = covering
      .map((c) => c.publishedAt)
      .filter((d): d is string => !!d)
      .sort()
      .pop() ?? null;

    // Collapse reports of one development into one opportunity.
    const groups = consolidateOpportunities(
      items.map((i) => ({ subject: i.title, independentOrigins: 1, ...i }))
    );

    const entityGaps: Gap[] = [];
    for (const g of groups) {
      const headline = g.primary.title;
      const covered = covering.some((c) => titleSimilarity(headline, c.title) >= 0.42);
      const a = assessPriority({
        headline,
        ageDays: 1,
        independentOrigins: 1 + g.duplicates.length,
        alreadyCovered: covered,
      });
      // Only real developments are worth reporting as gaps. A routine or
      // trivial item is not a gap; it is noise we correctly ignore.
      if (a.importance === "trivial" || a.importance === "routine") continue;
      entityGaps.push({
        entity: entity.name, tier: entity.tier, headline,
        link: g.primary.link, publisher: g.primary.publisher,
        importance: a.importance, score: a.score, reason: a.reason,
        urgent: a.urgent, covered,
      });
    }

    entityGaps.sort((x, y) => y.score - x.score);
    perEntity.set(entity.name, {
      tier: entity.tier,
      found: items.length,
      developments: entityGaps.length,
      gaps: entityGaps.filter((x) => !x.covered).length,
      urgent: entityGaps.filter((x) => !x.covered && x.urgent).length,
      latestCoverage: latest,
      latestDevelopment:
        items.map((i) => i.publishedAt).filter((d): d is string => !!d).sort().pop() ?? null,
    });
    allGaps.push(...entityGaps);

    const uncovered = entityGaps.filter((x) => !x.covered);
    console.log(
      `\n  ${entity.name.padEnd(18)} T${entity.tier}  corpus:${String(items.length).padStart(3)}  ` +
      `developments:${String(entityGaps.length).padStart(2)}  gaps:${String(uncovered.length).padStart(2)}  ` +
      `last article: ${latest ? latest.slice(0, 10) : "none"}`
    );
    for (const g of uncovered.slice(0, 3)) {
      console.log(`      ${g.urgent ? "URGENT " : "       "}${g.importance.padEnd(8)} ${g.headline.slice(0, 66)}`);
    }
  }

  // ---- ranked gap list ---------------------------------------------------
  const uncovered = allGaps.filter((g) => !g.covered).sort((a, b) => b.score - a.score);
  console.log(`\n${"=".repeat(80)}\nTOP UNCOVERED DEVELOPMENTS FROM WATCHED COMPANIES\n${"=".repeat(80)}`);
  for (const g of uncovered.slice(0, 20)) {
    console.log(`\n  [${g.score}] ${g.urgent ? "URGENT " : ""}${TIER_LABELS[g.tier as 1 | 2 | 3]} — ${g.entity}`);
    console.log(`      ${g.headline.slice(0, 74)}`);
    console.log(`      ${g.publisher} · ${g.importance}`);
    console.log(`      ${g.reason.slice(0, 100)}`);
  }
  console.log(`\n  ${uncovered.length} uncovered developments; ${uncovered.filter((g) => g.urgent).length} urgent.`);

  // ---- coverage health, per entity ---------------------------------------
  //
  // Three dates side by side answer the question the gap list cannot: is this
  // company being covered at all, and how far behind are we? "Last article"
  // older than "last development" with a non-zero gap count is a beat going
  // cold, which is invisible when only totals are reported.
  //
  // A blank is a blank. Feeds frequently omit a publication date and this
  // prints "unknown" rather than substituting today, because a fabricated
  // recency reading is worse than an absent one.
  console.log(`\n${"=".repeat(80)}\nCOVERAGE HEALTH BY ENTITY\n${"=".repeat(80)}`);
  console.log(
    `\n  ${"entity".padEnd(18)} ${"tier".padEnd(5)} ${"seen".padStart(5)} ${"devs".padStart(5)} ` +
    `${"gaps".padStart(5)} ${"urgent".padStart(6)}  ${"last development".padEnd(18)} last article`
  );
  console.log(`  ${"-".repeat(94)}`);

  const health = [...perEntity.entries()].sort(
    (a, b) => a[1].tier - b[1].tier || b[1].gaps - a[1].gaps || a[0].localeCompare(b[0])
  );
  for (const [name, h] of health) {
    const dev = h.latestDevelopment ? h.latestDevelopment.slice(0, 10) : "unknown";
    const art = h.latestCoverage ? h.latestCoverage.slice(0, 10) : "never";
    // Behind = there is something uncovered AND we have never published, or
    // our newest piece predates the newest development.
    const behind =
      h.gaps > 0 && (!h.latestCoverage || (h.latestDevelopment !== null && h.latestCoverage < h.latestDevelopment));
    console.log(
      `  ${name.padEnd(18)} T${String(h.tier).padEnd(4)} ${String(h.found).padStart(5)} ` +
      `${String(h.developments).padStart(5)} ${String(h.gaps).padStart(5)} ${String(h.urgent).padStart(6)}  ` +
      `${dev.padEnd(18)} ${art}${behind ? "   BEHIND" : ""}`
    );
  }

  const behindCount = health.filter(
    ([, h]) => h.gaps > 0 && (!h.latestCoverage || (h.latestDevelopment !== null && h.latestCoverage < h.latestDevelopment))
  ).length;
  const neverCovered = health.filter(([, h]) => !h.latestCoverage).map(([n]) => n);
  console.log(`\n  ${behindCount} of ${health.length} entities are behind their own newest development.`);
  if (neverCovered.length > 0) {
    console.log(`  never covered at all: ${neverCovered.join(", ")}`);
  }

  // ---- create drafts for the strongest gaps ------------------------------
  if (!apply) {
    console.log("\n  REPORT ONLY — re-run with --apply to research and draft the strongest gaps.");
    return;
  }

  console.log(`\n${"=".repeat(80)}\nRESEARCHING AND DRAFTING\n${"=".repeat(80)}`);
  let created = 0;
  let updatesProposed = 0;
  const byCat = new Map<string, number>();

  // SPREAD THE RUN ACROSS THE WATCHLIST.
  //
  // Gaps are processed strongest-first, and Apple alone accounts for 32 of
  // them. Without a cap one company consumes the entire run: the previous pass
  // produced seven drafts, all Apple, all smartphones, while 3D printing and
  // networking gaps sat untouched at the bottom of the same list.
  //
  // These caps do not lower the evidence bar. A capped entity's remaining gaps
  // stay in the report and are picked up by the next run.
  const MAX_PER_ENTITY = 3;
  const MAX_PER_CATEGORY = 6;
  const perEntityCreated = new Map<string, number>();

  for (const gap of uncovered.slice(0, 90)) {
    const entity = PRIORITY_ENTITIES.find((e) => e.name === gap.entity)!;
    // The SUBJECT decides the section, not the company. Reading
    // entity.categories[0] filed every Mac, Mac mini, MacBook and iPad story
    // under smartphones, because that is Apple's first listed category.
    const chosen = categoryForSubject(subjectNoun(gap.headline, null), entity.categories);
    const category = chosen.category;

    // A subject that cannot be a headline must never reach research. Checking
    // this only in queue triage meant the same broken subject was removed and
    // then recreated by the very next scan.
    // Check the FULL headline as well as the trimmed subject: subjectNoun caps
    // at nine words, which cut "...that I'm very excited about" off the end and
    // let a first-person column through the screen into the queue.
    const quality = assessSubject(gap.headline).usable
      ? assessSubject(subjectNoun(gap.headline, null))
      : assessSubject(gap.headline);
    if (!quality.usable) {
      console.log(`  SKIP (${quality.flaw})  ${gap.headline.slice(0, 50)}`);
      continue;
    }
    if ((perEntityCreated.get(gap.entity) ?? 0) >= MAX_PER_ENTITY) continue;
    if ((byCat.get(category) ?? 0) >= MAX_PER_CATEGORY) continue;
    if (!corpusCache.has(category)) corpusCache.set(category, await buildCorpus(category));
    const corpus = corpusCache.get(category)!;

    try {
      const shortlist = researchDiscovery({
        title: gap.headline, subjectDomains: subjectDomainsForText(gap.headline),
        corpus: corpus.items, sourcesAttempted: corpus.attempted,
        sourcesRead: corpus.read, sourcesFailed: corpus.failed, knownMakers,
      });
      const articleText = new Map<string, { text: string; contentSource: "full_text" | "feed_summary"; note: string | null }>();
      for (const m of shortlist.matches.slice(0, 4)) {
        if (!m.item.link) continue;
        const got = await fetchArticle(m.item.link, `${m.item.title}. ${m.item.summary ?? ""}`);
        articleText.set(m.item.link, { text: got.text, contentSource: got.contentSource, note: got.note });
      }
      const result = researchDiscovery({
        title: gap.headline, subjectDomains: subjectDomainsForText(gap.headline),
        corpus: corpus.items, sourcesAttempted: corpus.attempted,
        sourcesRead: corpus.read, sourcesFailed: corpus.failed, knownMakers, articleText,
      });

      const origins = result.lineage.independentOrigins;
      const verdict = decideCoverage({
        subject: gap.headline, categorySlug: category,
        independentOrigins: origins, framing: result.decision.framing,
        claimCount: result.claimBreakdown.total, existing,
      });

      // UPDATE_EXISTING MUST PRODUCE SOMETHING.
      //
      // The decision was previously logged and thrown away, so the engine
      // correctly recognised "we already cover this, enrich it instead of
      // publishing a second page" and then did neither. The story was dropped.
      //
      // It files an update PROPOSAL, not an edit. The existing article is not
      // touched: overwriting a page that a human wrote, from feed evidence, on
      // an unattended run, is exactly the blind overwrite that must never
      // happen. The proposal carries the new evidence and the owner decides.
      if (verdict.decision === "UPDATE_EXISTING" && verdict.target) {
        const targetId = verdict.target.id;
        // A brief has no row to update — its id is a synthetic "brief:" key.
        if (targetId.startsWith("brief:")) {
          console.log(`  UPDATE (brief)   ${gap.headline.slice(0, 52)}`);
          continue;
        }
        const evidence = result.matches
          .map((m) => m.item.link)
          .filter((l): l is string => !!l)
          .slice(0, 8);
        const newFacts = result.claims
          .filter((c) => c.hedges.length === 0)
          .slice(0, 6)
          .map((c) => (c.attributedTo ? `${c.attributedTo}: ${c.text}` : c.text));

        const { data: status, error: upErr } = await db.rpc("engine_upsert_update_proposal", {
          p_content_id: targetId,
          p_product_id: null,
          p_discovery_id: null,
          // 'newer_evidence' is the reason this is: newer reporting about a
          // development the page already covers.
          p_reason: "newer_evidence",
          p_summary:
            `${gap.headline}\n\nNewer reporting on a development this page already covers ` +
            `(${Math.round(verdict.similarity * 100)}% subject match). ${verdict.reasons[0] ?? ""}`,
          p_changes: newFacts.length > 0 ? newFacts : ["Review the new reporting and update if it adds anything."],
          p_evidence: evidence,
          p_confidence: Math.min(0.9, corroborationConfidence(origins)),
        });
        if (upErr) {
          console.log(`  UPDATE FAILED    ${upErr.message.slice(0, 60)}`);
        } else if (status !== "created" && status !== "refreshed") {
          // A refusal is a real outcome and must not read as success.
          console.log(`  UPDATE REFUSED   ${String(status)}  ${gap.headline.slice(0, 40)}`);
        } else {
          updatesProposed++;
          console.log(`  UPDATE (${String(status)}) ${verdict.target.title.slice(0, 46)}`);
        }
        continue;
      }

      if (verdict.decision !== "NEW_ARTICLE" && verdict.decision !== "SUPPORTING") {
        console.log(`  ${verdict.decision.padEnd(16)} ${gap.headline.slice(0, 56)}`);
        continue;
      }
      // USE THE ENGINE'S OWN CORROBORATION RULE, NOT A FLAT NUMBER.
      //
      // `MIN_ORIGINS = 2` was a blanket threshold that contradicted the
      // corroboration model it sits on top of. That model is claim-class
      // aware: a company announcing its own product needs ONE first-party
      // source, a third-party report needs two, and a claim about an
      // unreleased product from anyone but the maker needs three.
      //
      // The flat 2 held every 3D-printing story in the corpus — including
      // "Bambu Lab launches PLA Pure filament" published by Bambu Lab, which
      // is the single clearest first-party announcement there is. It also
      // silently ACCEPTED two-source claims about unreleased products that
      // the real rule requires three for. Deferring to the model is stricter
      // where it matters and correct where the flat number was simply wrong.
      const evidenceUrls = result.matches
        .map((m) => m.item.link)
        .filter((l): l is string => !!l);
      const corroboration = assessCorroboration({
        sourceUrls: evidenceUrls,
        subjectDomains: subjectDomainsForText(gap.headline),
        // The research stage's framing maps onto the claim status the
        // corroboration model expects. "rumoured" must stay a rumour here:
        // downgrading it would let a leak through on a single source with the
        // confidence of a report.
        claimStatus:
          result.decision.framing === "rumoured" ? "rumour"
            : result.decision.framing === "confirmed" ? "confirmed_primary"
              : "reported_secondary",
        aboutUnreleasedProduct: result.decision.framing === "rumoured",
      });
      if (!corroboration.sufficient) {
        console.log(
          `  HELD (${corroboration.independentPublishers}/${corroboration.required} ${corroboration.claimClass})  ${gap.headline.slice(0, 44)}`
        );
        continue;
      }

      const facts: string[] = [];
      const uncertainties: string[] = [];
      for (const c of result.claims.slice(0, 14)) {
        const text = c.attributedTo ? `${c.attributedTo}: ${c.text}` : c.text;
        if (c.hedges.length > 0) uncertainties.push(`${text} [unconfirmed: ${c.hedges.join(", ")}]`);
        else facts.push(text);
      }
      if (facts.length === 0) {
        console.log(`  ALL HEDGED       ${gap.headline.slice(0, 56)}`);
        continue;
      }

      const title = result.decision.suggestedTitle ?? gap.headline;
      const sourceUrls = result.matches.map((m) => m.item.link).filter((u): u is string => !!u);

      const { data: briefRow, error: briefErr } = await db.from("engine_briefs").insert({
        proposed_title: title,
        rationale:
          `${TIER_LABELS[entity.tier as 1 | 2 | 3]} entity ${entity.name}. ${gap.reason} ` +
          `${origins} independent origin(s): ${result.matches.map((m) => m.item.source.organisation).join(", ")}.`,
        content_type: "news", category_slug: category,
        brief_kind: result.decision.framing === "confirmed" ? "breaking" : "explainer",
        freshness_sensitivity: "time_sensitive",
        verified_facts: facts, uncertainties, source_urls: sourceUrls,
        // review_state IS THE HUMAN GATE. A SCRIPT MUST NEVER WRITE 'approved'.
        //
        // This line used to insert review_state:'approved' with a reviewed_at
        // timestamp. It did not need to: the draft is assembled directly below
        // by calling assembleDraft, so approval was never a precondition for
        // anything this script does. It was set only so the brief's own record
        // looked settled.
        //
        // The cost was real. brief-quality.ts documents review_state as "what a
        // HUMAN decided" and draft-job.ts guards draft assembly on it, so this
        // manufactured owner consent that no owner gave — 52 briefs carried it,
        // 9 of them stamped within a single minute. Any report citing "approved"
        // as evidence of owner control was false.
        //
        // The brief stays PENDING. That a draft exists is recorded by
        // assembled_content_id, which is what that column is for.
        review_state: "pending", state: "planned",
      }).select("id").single();
      if (briefErr || !briefRow) { console.log(`  brief failed: ${briefErr?.message}`); continue; }

      const draft = assembleDraft({
        title, contentType: "news", categorySlug: category,
        primaryQuestion: `What has actually been reported about ${gap.headline}?`,
        supportingQuestions: ["What is confirmed?", "What is still unknown?", "What does it mean in practice?"],
        verifiedFacts: facts, uncertainties, sourceUrls,
        suggestedStructure: ["What has been reported", "Why it matters", "What is not confirmed", "What to watch"],
        briefKind: "explainer", freshnessSensitivity: "time_sensitive",
        rationale: `${entity.name} is a ${TIER_LABELS[entity.tier as 1 | 2 | 3].toLowerCase()} entity; ${origins} independent origin(s).`,
        relatedContent: [], relatedProducts: [],
      });

      if (usedTitles.has(title.toLowerCase().trim())) {
        console.log(`  TITLE TAKEN      ${title.slice(0, 56)}`);
        continue;
      }
      usedTitles.add(title.toLowerCase().trim());

      const seo = proposeSeo({ title, primaryQuestion: null });
      const slug = proposeSlug(title, takenSlugs);
      if (!slug) continue;
      takenSlugs.add(slug);

      const { data: out, error: rpcErr } = await db.rpc("engine_assemble_draft", {
        p_brief_id: (briefRow as { id: string }).id,
        p_title: title, p_slug: slug, p_body: draft.body,
        p_content_type: "news", p_category_slug: category,
        p_search_intent: null, p_primary_query: null, p_source_urls: sourceUrls,
        p_meta_title: seo.metaTitle, p_meta_description: seo.metaDescription,
      });

      if (rpcErr) { console.log(`  assemble failed: ${rpcErr.message}`); continue; }
      if (typeof out === "string" && /^[0-9a-f-]{36}$/i.test(out)) {
        created++;
        byCat.set(category, (byCat.get(category) ?? 0) + 1);
        perEntityCreated.set(gap.entity, (perEntityCreated.get(gap.entity) ?? 0) + 1);
        const catId = catIdBySlug.get(category);
        if (catId) await db.from("content_items").update({ category_id: catId }).eq("id", out);
        existing.push({ id: out, title: gap.headline, slug, status: "draft", categorySlug: category, publishedAt: null });
        console.log(`  DRAFT  [${entity.name}] ${title.slice(0, 58)}`);
      }
    } catch (err) {
      console.log(`  FAILED ${gap.headline.slice(0, 48)}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.log(`\n  drafts created: ${created}`);
  console.log(`  update proposals filed: ${updatesProposed}`);
  for (const [c, n] of [...byCat].sort((a, b) => b[1] - a[1])) console.log(`    ${String(n).padStart(2)}  ${c}`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
