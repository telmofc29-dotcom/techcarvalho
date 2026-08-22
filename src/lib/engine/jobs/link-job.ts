import "server-only";
import type { createClient } from "@/lib/supabase/server";
import { newCounters, recordJobRun, readFlag } from "@/lib/engine/cron";
import {
  createPostconditionLog,
  statusFromPostconditions,
  worstStatus,
} from "@/lib/engine/postconditions";
import { postconditionDetail, writeCountsFrom } from "@/lib/engine/silent-success";
import {
  findOrphans, suggestLinksFor, pairKey, AUTO_LINK_THRESHOLD,
  type LinkCandidate,
} from "@/lib/engine/link-suggestions";
import type { StageResult } from "./discovery";

type Client = Awaited<ReturnType<typeof createClient>>;
const JOB = "engine_internal_links";

// Orphan detection.
//
// An article can be published and still be invisible: if nothing links to it
// and it links to nothing, no reader reaches it from anywhere else on the site
// and search engines see a page with no internal support. The project standard
// is that such an article is not finished.
//
// WHY THIS PROPOSES RATHER THAN AUTO-LINKS
// ----------------------------------------
// Measured, not assumed. Nine real orphans were linked by hand, producing 29
// editorial links. Scoring those same 29 pairs with the term-overlap heuristic
// in link-suggestions.ts reproduced only 6 of them, even after adding concept
// expansion. Every miss was conceptual rather than lexical — "When Does
// Upgrading Actually Matter?" and "AMD vs Intel in 2026" are obviously related
// and share no significant word.
//
// Lowering the threshold to catch them would have produced far more weak links
// than good ones, and a bad "related" link is worse than none: it wastes the
// reader's click and dilutes the real relationships. So the heuristic is used
// for the half of the job it is genuinely good at — finding orphans exactly —
// and its link candidates go to a human as suggestions.
//
// NO MIGRATION REQUIRED. It reuses engine_upsert_freshness with the
// 'missing_internal_links' reason, which has existed in the schema since
// Phase 3 and was never wired up to anything.
export async function runInternalLinks(supabase: Client): Promise<StageResult> {
  const counters = newCounters();

  const freshnessFlag = await readFlag(supabase, "freshness");
  if (!freshnessFlag.enabled) {
    // An UNREADABLE flag is a failure, not a deliberate skip. Recording it as
    // 'skipped' used to hide it twice over: the reason said the flag was off
    // when it had never been read, and silent-success.ts filters skipped runs
    // out entirely, so one denied RPC switched the engine off and still
    // produced a clean detector report.
    const status = freshnessFlag.readable ? "skipped" : "failed";
    await recordJobRun(
      supabase,
      JOB,
      status,
      counters,
      { reason: freshnessFlag.reason },
      freshnessFlag.error
    );
    return { status, ...counters, detail: { reason: freshnessFlag.reason } };
  }

  const [entityResult, relResult, prodResult] = await Promise.all([
    supabase.rpc("engine_existing_entities"),
    supabase.from("content_relationships").select("content_id, related_content_id"),
    supabase.from("content_products").select("content_id, product_id"),
  ]);

  const anyError = entityResult.error ?? relResult.error ?? prodResult.error;
  if (anyError) {
    await recordJobRun(supabase, JOB, "failed", counters, {}, anyError.message);
    return { status: "failed", ...counters, detail: { error: anyError.message } };
  }

  const entities = (entityResult.data ?? []) as {
    kind: string; id: string; name: string; slug: string; is_published: boolean;
  }[];

  // Only PUBLISHED content can be orphaned in a way that matters — a draft is
  // supposed to be unreachable.
  const published: LinkCandidate[] = entities
    .filter((e) => e.kind === "content" && e.is_published)
    .map((e) => ({ id: e.id, title: e.name, categoryId: null, type: "content" }));

  if (published.length === 0) {
    await recordJobRun(supabase, JOB, "success", counters, { reason: "no_published_content" });
    return { status: "success", ...counters };
  }

  // Anything touched by a relationship in either direction, or associated with
  // a product, counts as connected.
  //
  // content_products is read as `anon`, so RLS scopes it to PUBLISHED products
  // only. That is the correct signal rather than a limitation: an article whose
  // sole connection is to an unpublished product is genuinely unreachable for a
  // reader, and should still be reported as an orphan.
  const linkedIds = new Set<string>();
  const existingPairs = new Set<string>();
  for (const r of relResult.data ?? []) {
    linkedIds.add(r.content_id);
    linkedIds.add(r.related_content_id);
    existingPairs.add(pairKey(r.content_id, r.related_content_id));
  }
  for (const p of prodResult.data ?? []) linkedIds.add(p.content_id);

  const orphans = findOrphans(published, linkedIds);
  counters.examined = published.length;

  const log = createPostconditionLog(counters);
  const reported: string[] = [];
  for (const orphan of orphans) {
    const suggestions = suggestLinksFor(orphan, published, existingPairs, 4);

    // The detail text is what a human acts on, so it carries the candidates
    // and their scores rather than just announcing a problem.
    const detail = suggestions.length
      ? `"${orphan.title}" is published but links to nothing and nothing links to it. ` +
        `Suggested (heuristic only — confirm each is genuinely useful to a reader): ` +
        suggestions.map((s) => `"${s.toTitle}" (${s.score.toFixed(2)})`).join("; ") +
        `. Scores at or above ${AUTO_LINK_THRESHOLD} are the stronger candidates, but this ` +
        `heuristic matched only 6 of 29 links chosen by an editor, so treat all of them as ` +
        `starting points rather than answers.`
      : `"${orphan.title}" is published but links to nothing and nothing links to it, and the ` +
        `heuristic found no candidate worth suggesting. This one needs an editor to place it.`;

    // 'missing_internal_links' has to be in engine_upsert_freshness's guard
    // list for this to do anything at all. It is today — but that list and the
    // table's CHECK constraint have already drifted apart once in this project,
    // and when they did the RPC answered 'rejected_invalid' to every call. So
    // the answer is checked rather than assumed: 'rejected_invalid' is not
    // named as benign, which makes it a failure by construction.
    const result = await log.rpc({
      operation: "engine_upsert_freshness",
      subject: `content/${orphan.id} reason=missing_internal_links`,
      run: () =>
        supabase.rpc("engine_upsert_freshness", {
          p_kind: "content",
          p_entity_id: orphan.id,
          p_reason: "missing_internal_links",
          p_detail: detail,
          // High: an orphan is not cosmetic, it is a page nobody reaches.
          p_severity: "high",
        }),
      accepted: ["created"],
      benign: ["deduped"],
    });

    if (result.data === "created") reported.push(orphan.title.slice(0, 60));
  }

  // Zero orphans is a success and the goal, not an empty result.
  const jobView =
    counters.failed === 0
      ? "success"
      : counters.created + counters.deduped > 0
        ? "partial"
        : "failed";
  const postconditions = log.summarise();
  const status = worstStatus(jobView, statusFromPostconditions(postconditions));

  const detail = {
    publishedExamined: published.length,
    orphansFound: orphans.length,
    reported,
    postconditions: postconditionDetail(postconditions),
  };
  await recordJobRun(supabase, JOB, status, counters, detail, undefined, writeCountsFrom(postconditions));
  return { status, ...counters, detail };
}
