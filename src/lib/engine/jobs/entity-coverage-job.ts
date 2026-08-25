import "server-only";
import { newCounters } from "@/lib/engine/cron";
import { buildCorpus } from "@/lib/engine/research/feed-index";
import { consolidateOpportunities } from "@/lib/engine/coverage-decision";
import { PRIORITY_ENTITIES, assessPriority } from "@/lib/engine/priority-entities";
import { assessSubject } from "@/lib/engine/subject-quality";
import { subjectNoun } from "@/lib/engine/research/research-pipeline";
import { titleSimilarity } from "@/lib/engine/dedupe";
import { logQueryError } from "@/lib/log/query-error";
import type { createClient } from "@/lib/supabase/server";
import type { StageResult } from "@/lib/engine/jobs/discovery";

type Client = Awaited<ReturnType<typeof createClient>>;

// WATCHLIST COVERAGE — the stage that stops a major launch depending on the
// owner noticing it.
//
// WHY THIS IS NOT THE DISCOVERY STAGE
// -----------------------------------
// Discovery asks "what is in the feeds?". This asks the opposite question:
// "for each company we have decided to watch, what is being said about it that
// we are NOT covering?". The entity is the FILTER, not the search term.
//
// That inversion is the whole point. Searching for the string "Samsung Galaxy"
// produces a TOPICAL query — it identifies a company, not a development — and
// the matcher correctly refuses to treat "mentions Samsung" as "is about this
// story". A previous pass reported mass NO_COVERAGE for exactly that reason,
// while the corpus it had just downloaded contained the very stories it said
// did not exist.
//
// WHAT IT WRITES
// --------------
// Opportunities only. It records what is uncovered and how urgent it is; it
// creates no drafts and publishes nothing. Draft assembly remains the only
// thing that builds an article, and it still requires evidence to pass the
// corroboration model first.
//
// A company that has genuinely done nothing newsworthy produces zero rows, and
// that is a real answer. "No recent article about X" is never on its own a
// reason to write one.

/** Beyond this, a development is old news and the moment to cover it has passed. */
const MAX_AGE_DAYS = 14;

/** How many uncovered developments one pass may record. Keeps a burst bounded. */
const MAX_OPPORTUNITIES = 40;

/** Same-story threshold used to decide we already cover something. */
const ALREADY_COVERED = 0.42;

/**
 * A stable key for one development.
 *
 * The RPC upserts on (subject_type, subject_key), so this is what makes a
 * re-run update yesterday's row instead of adding a second copy of the same
 * story. Derived from the headline rather than a timestamp for that reason.
 */
function keyOf(headline: string): string {
  return headline
    .toLowerCase()
    .replace(/&#\d+;/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 150);
}

export async function runEntityCoverage(supabase: Client): Promise<StageResult> {
  const counters = newCounters();

  const [contentRes, briefsRes] = await Promise.all([
    supabase.from("content_items").select("id, title, status, published_at"),
    supabase.from("engine_briefs").select("proposed_title, review_state"),
  ]);

  // A failed read is NOT an empty site. Reporting zero coverage here would
  // make every watched entity look uncovered and flood the queue.
  if (contentRes.error) {
    logQueryError("entity-coverage content", contentRes.error);
    return { status: "failed", examined: 0, created: 0, deduped: 0, failed: 1,
      detail: { reason: "could not read existing content; refusing to treat that as zero coverage" } };
  }
  if (briefsRes.error) {
    logQueryError("entity-coverage briefs", briefsRes.error);
    return { status: "failed", examined: 0, created: 0, deduped: 0, failed: 1,
      detail: { reason: "could not read briefs; refusing to treat that as zero coverage" } };
  }

  const existingTitles = [
    ...((contentRes.data ?? []) as { title: string }[]).map((c) => c.title),
    ...((briefsRes.data ?? []) as { proposed_title: string; review_state: string }[])
      .filter((b) => b.review_state !== "rejected")
      .map((b) => b.proposed_title),
  ];

  const corpusCache = new Map<string, Awaited<ReturnType<typeof buildCorpus>>>();
  const found: {
    entity: string; tier: number; headline: string; link: string | null;
    publisher: string; score: number; reason: string; urgent: boolean; origins: number;
  }[] = [];

  for (const entity of PRIORITY_ENTITIES) {
    const items: { title: string; summary: string | null; link: string | null; publisher: string; publishedAt: string | null }[] = [];

    for (const category of entity.categories) {
      if (!corpusCache.has(category)) {
        try {
          corpusCache.set(category, await buildCorpus(category));
        } catch {
          // One unreachable category must not abort the watchlist.
          counters.failed++;
          continue;
        }
      }
      const corpus = corpusCache.get(category);
      if (!corpus) continue;

      for (const item of corpus.items) {
        // ATTRIBUTION COMES FROM THE HEADLINE, NOT THE BODY. Matching on
        // title + summary attributed "Nikon has ended their relationship with
        // Pro Distributors" to Sony, because Sony appeared somewhere in the
        // summary. Aliases already include product names, so a headline naming
        // the product without the maker still matches.
        const namesEntity = entity.aliases.some((a) =>
          new RegExp(`(^|[^a-z0-9])${a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`, "i").test(item.title)
        );
        if (namesEntity) {
          items.push({
            title: item.title, summary: item.summary, link: item.link,
            publisher: item.source.organisation, publishedAt: item.publishedAt ?? null,
          });
        }
      }
    }
    counters.examined += items.length;

    // Collapse the many reports of one development into one opportunity.
    const groups = consolidateOpportunities(
      items.map((i) => ({ subject: i.title, independentOrigins: 1, ...i }))
    );

    for (const g of groups) {
      const headline = g.primary.title;

      const ageDays = g.primary.publishedAt
        ? (Date.now() - Date.parse(g.primary.publishedAt)) / 86_400_000
        : undefined;
      if (ageDays !== undefined && ageDays > MAX_AGE_DAYS) continue;

      // A subject that cannot be a headline must never enter the queue. This
      // check lived only in queue triage, so a broken subject was removed and
      // recreated by the next pass.
      if (!assessSubject(subjectNoun(headline, null)).usable) continue;

      const covered = existingTitles.some((t) => titleSimilarity(headline, t) >= ALREADY_COVERED);
      const origins = 1 + g.duplicates.length;
      const priority = assessPriority({ headline, ageDays, independentOrigins: origins, alreadyCovered: covered });

      // Trivial and routine items are not gaps. They are noise we correctly
      // ignore, and recording them would rebuild the queue this cleaned up.
      if (priority.importance === "trivial" || priority.importance === "routine") continue;
      if (covered) { counters.deduped++; continue; }

      found.push({
        entity: entity.name, tier: entity.tier, headline, link: g.primary.link,
        publisher: g.primary.publisher, score: priority.score, reason: priority.reason,
        urgent: priority.urgent, origins,
      });
    }
  }

  found.sort((a, b) => b.score - a.score);
  const shortlist = found.slice(0, MAX_OPPORTUNITIES);

  for (const gap of shortlist) {
    // engine_upsert_opportunity accepts a fixed set of subject types and
    // RETURNS a status string rather than throwing. 'rejected_invalid_*' comes
    // back as a successful call with a refusal inside it, so the status must be
    // inspected — treating a non-error response as a write is exactly how a
    // silent no-op gets counted as success.
    const { data: status, error } = await supabase.rpc("engine_upsert_opportunity", {
      p_subject_type: "topic",
      p_subject_key: `watchlist:${keyOf(gap.headline)}`,
      p_label: gap.headline.slice(0, 300),
      // engine_opportunities.score is numeric(5,2) CHECK 0..100, and priority
      // scores reach 110 (tier 1 + major + uncovered + recent). Every write in
      // the first run was rejected by that constraint. Clamped for storage, and
      // the unclamped value is kept in inputs so nothing is lost and the two
      // can never be confused for each other.
      p_score: Math.max(0, Math.min(100, gap.score)),
      p_inputs: {
        entity: gap.entity,
        tier: gap.tier,
        priorityScore: gap.score,
        independentOrigins: gap.origins,
        urgent: gap.urgent,
        publisher: gap.publisher,
        evidenceUrl: gap.link,
        source: "entity_watchlist",
      },
      p_explanation: gap.reason,
    });

    if (error) {
      logQueryError("entity-coverage upsert opportunity", error);
      counters.failed++;
    } else if (status !== "ok") {
      // A refusal is a real outcome and must not read as nothing to do.
      logQueryError("entity-coverage upsert opportunity", {
        message: `engine_upsert_opportunity returned ${String(status)} for ${gap.headline.slice(0, 60)}`,
      });
      counters.failed++;
    } else {
      counters.created++;
    }
  }

  return {
    status: counters.failed > 0 ? "partial" : "success",
    examined: counters.examined,
    created: counters.created,
    deduped: counters.deduped,
    failed: counters.failed,
    detail: {
      entitiesWatched: PRIORITY_ENTITIES.length,
      uncoveredFound: found.length,
      urgent: found.filter((f) => f.urgent).length,
      recorded: shortlist.length,
      topGaps: shortlist.slice(0, 5).map((g) => `${g.entity}: ${g.headline.slice(0, 60)}`),
    },
  };
}
