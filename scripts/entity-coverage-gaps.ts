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
import { researchDiscovery } from "../src/lib/engine/research/research-pipeline.ts";
import { fetchArticle } from "../src/lib/engine/research/article-fetch.ts";
import { subjectDomainsForText } from "../src/lib/engine/research/entity-model.ts";
import { assembleDraft, proposeSeo } from "../src/lib/engine/draft-assembly.ts";
import { proposeSlug } from "../src/lib/engine/entity-resolution.ts";
import { decideCoverage, consolidateOpportunities, type ExistingPiece } from "../src/lib/engine/coverage-decision.ts";
import {
  PRIORITY_ENTITIES, assessPriority, classifyImportance, TIER_LABELS,
  type PriorityEntity,
} from "../src/lib/engine/priority-entities.ts";
import { titleSimilarity } from "../src/lib/engine/dedupe.ts";

/** Independent origins required before an unattended run creates anything. */
const MIN_ORIGINS = 2;

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
        const hay = `${item.title} ${item.summary ?? ""}`;
        // The ENTITY is the filter. Every story it appears in becomes a
        // candidate, and the story keeps its own identity.
        const mentions = entity.aliases.some((a) => {
          const p = new RegExp(`(^|[^a-z0-9])${a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`, "i");
          return p.test(hay);
        });
        if (mentions) {
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
  const byCat = new Map<string, number>();

  for (const gap of uncovered.slice(0, 30)) {
    const entity = PRIORITY_ENTITIES.find((e) => e.name === gap.entity)!;
    const category = entity.categories[0];
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

      if (verdict.decision !== "NEW_ARTICLE" && verdict.decision !== "SUPPORTING") {
        console.log(`  ${verdict.decision.padEnd(16)} ${gap.headline.slice(0, 56)}`);
        continue;
      }
      if (origins < MIN_ORIGINS) {
        console.log(`  HELD (${origins}org)      ${gap.headline.slice(0, 56)}`);
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
        review_state: "approved", state: "planned", reviewed_at: new Date().toISOString(),
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
  for (const [c, n] of [...byCat].sort((a, b) => b[1] - a[1])) console.log(`    ${String(n).padStart(2)}  ${c}`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
