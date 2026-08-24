import "server-only";

// THE I/O HALF OF THE OWNER QUEUE.
//
// Gathers work from the four tables that can produce an owner decision, applies
// each source's admission rule through owner-queue.ts, and returns one ranked
// list. The ranking and admission logic is pure and lives next door; this file
// only fetches and joins.
//
// FAILURE IS NOT EMPTINESS
// -----------------------
// Every read here is checked, and a failed read is reported as a FAILURE rather
// than contributing zero items. That distinction is the whole lesson of the
// 2026-08 grants incident: `anon` had no table grants, every query returned
// `{ data: [], error: null }`, and the site rendered honest-looking empty states
// for weeks. An owner queue is exactly the surface where that bug would be most
// dangerous — "nothing needs your attention" is the single most reassuring thing
// this application can say, and it must never be able to say it because a query
// broke.
//
// So `failures` is part of the return type rather than a logged side effect, and
// the page renders a banner whenever it is non-empty. A queue that could not
// read one of its four sources reports that it is INCOMPLETE, not that it is
// empty.
//
// PARTIAL RESULTS ARE STILL USEFUL
// --------------------------------
// One failing source does not abort the others. An owner who can still action
// three of four categories is better served than one who sees an error page,
// provided the page is honest about what is missing — which it is.

import { createClient } from "@/lib/supabase/server";
import { logQueryError } from "@/lib/log/query-error";
import { classifyBriefQuality, summariseQuality, type BriefQualityVerdict } from "./brief-quality.ts";
import {
  briefQueueItem,
  mediaRightsQueueItem,
  updateProposalQueueItem,
  freshnessQueueItem,
  rankOwnerQueue,
  summariseOwnerQueue,
  type OwnerQueueItem,
  type QueueSummary,
} from "./owner-queue.ts";
import type { QualityBreakdown } from "./brief-quality.ts";
import { loadCorroborationContext } from "./corroboration-context.ts";

export type QueueFailure = { source: string; message: string };

export type OwnerQueueResult = {
  items: OwnerQueueItem[];
  summary: QueueSummary;
  /** Non-empty means the list below is INCOMPLETE. Render a banner. */
  failures: QueueFailure[];
  /**
   * What the quality gate did to the brief backlog. Shown as "N found,
   * M worth reviewing, K filtered" so the owner can see the engine is working
   * even when the queue is short.
   */
  briefQuality: QualityBreakdown;
};

type BriefRow = {
  id: string;
  proposed_title: string;
  brief_kind: string | null;
  content_type: string | null;
  rationale: string | null;
  verified_facts: string[] | null;
  uncertainties: string[] | null;
  source_urls: string[] | null;
  freshness_sensitivity: "breaking" | "time_sensitive" | "evergreen" | null;
  discovery_id: string | null;
  opportunity_id: string | null;
  related_product_slugs: string[] | null;
  created_at: string;
};

export async function loadOwnerQueue(): Promise<OwnerQueueResult> {
  const supabase = await createClient();
  const failures: QueueFailure[] = [];

  const [briefsRes, publishedRes, mediaRes, proposalsRes, freshnessRes] = await Promise.all([
    supabase
      .from("engine_briefs")
      .select(
        "id, proposed_title, brief_kind, content_type, rationale, verified_facts, uncertainties, " +
          "source_urls, freshness_sensitivity, discovery_id, opportunity_id, related_product_slugs, created_at"
      )
      .eq("review_state", "pending")
      .is("assembled_content_id", null),
    supabase.from("content_items").select("id, title").eq("status", "published"),
    supabase
      .from("media_requirements")
      .select("id, product_id, content_id, sourcing_status, notes, created_at")
      .eq("sourcing_status", "blocked"),
    supabase
      .from("engine_update_proposals")
      .select("id, content_id, product_id, reason, summary, evidence_urls, created_at")
      .eq("state", "open"),
    supabase
      .from("engine_freshness_reviews")
      .select("id, product_id, content_id, reason, detail, severity, detected_at")
      .eq("state", "open")
      .eq("severity", "high"),
  ]);

  // ---- published corpus, needed before briefs can be judged ---------------
  // A cannibalisation verdict computed against an unknown corpus would be
  // worse than none: it would silently report "no duplicate risk" for every
  // brief. So a failure here suppresses the duplicate CHECK rather than
  // producing false clearances, and says so.
  let existingTitles: string[] = [];
  let corpusKnown = true;
  if (publishedRes.error) {
    corpusKnown = false;
    logQueryError("loadOwnerQueue published corpus", publishedRes.error);
    failures.push({
      source: "Published content (cannibalisation reference)",
      message:
        "Could not read published titles, so briefs below have NOT been checked for duplication " +
        "against the existing site.",
    });
  } else {
    existingTitles = (publishedRes.data ?? []).map((c: { title: string }) => c.title);
  }

  const items: OwnerQueueItem[] = [];
  let briefVerdicts: BriefQualityVerdict[] = [];

  // ---- briefs ------------------------------------------------------------
  if (briefsRes.error) {
    logQueryError("loadOwnerQueue briefs", briefsRes.error);
    failures.push({
      source: "Content briefs",
      message: briefsRes.error.message,
    });
  } else {
    const rows = (briefsRes.data ?? []) as unknown as BriefRow[];

    // Corroboration context. A brief sourced to a registered `primary`-trust
    // domain is a first-party announcement and is authoritative on one source;
    // everything else keeps the strict two-independent-publishers rule. See
    // corroboration-context.ts — this cannot weaken the bar, only make it
    // correct for the class of claim being made.
    const context = await loadCorroborationContext(
      rows.map((r) => ({
        id: r.id,
        discoveryId: r.discovery_id,
        sourceUrls: r.source_urls ?? [],
      }))
    );

    briefVerdicts = rows.map((row) =>
      classifyBriefQuality({
        ...(context.has(row.id)
          ? {
              claimStatus: context.get(row.id)!.claimStatus,
              subjectDomains: context.get(row.id)!.subjectDomains,
              aboutUnreleasedProduct: context.get(row.id)!.aboutUnreleasedProduct,
            }
          : {}),
        id: row.id,
        title: row.proposed_title,
        briefKind: row.brief_kind,
        contentType: row.content_type,
        verifiedFacts: row.verified_facts ?? [],
        uncertainties: row.uncertainties ?? [],
        sourceUrls: row.source_urls ?? [],
        freshnessSensitivity: row.freshness_sensitivity,
        hasDiscovery: row.discovery_id !== null,
        hasOpportunity: row.opportunity_id !== null,
        createdAt: row.created_at,
        summary: row.rationale,
        // Deliberately empty when the corpus read failed, so no brief is
        // cleared of duplication on the strength of a query that did not run.
        existingTitles: corpusKnown ? existingTitles : [],
      })
    );

    rows.forEach((row, i) => {
      const item = briefQueueItem({
        id: row.id,
        title: row.proposed_title,
        quality: briefVerdicts[i],
        freshnessSensitivity: row.freshness_sensitivity,
        createdAt: row.created_at,
        productLinkMissing: (row.related_product_slugs ?? []).length === 0,
      });
      if (item) items.push(item);
    });
  }

  // ---- media rights ------------------------------------------------------
  // Titles are resolved for the things these requirements block, because
  // "Rights review needed" without saying what it is holding up is not a
  // decision anyone can make.
  if (mediaRes.error) {
    logQueryError("loadOwnerQueue media requirements", mediaRes.error);
    failures.push({ source: "Media rights blockers", message: mediaRes.error.message });
  } else {
    const rows = (mediaRes.data ?? []) as {
      id: string;
      product_id: string | null;
      content_id: string | null;
      notes: string | null;
      created_at: string;
    }[];
    const labels = await resolveTargets(supabase, rows, failures);
    for (const row of rows) {
      items.push(
        mediaRightsQueueItem({
          id: row.id,
          title: labels.get(targetKey(row)) ?? "Media requirement",
          blockerReason: row.notes ?? "Sourcing is blocked and the reason was not recorded.",
          forTitle: labels.get(targetKey(row)) ?? null,
          detectedAt: row.created_at,
        })
      );
    }
  }

  // ---- update proposals --------------------------------------------------
  if (proposalsRes.error) {
    logQueryError("loadOwnerQueue update proposals", proposalsRes.error);
    failures.push({ source: "Update proposals", message: proposalsRes.error.message });
  } else {
    const rows = (proposalsRes.data ?? []) as {
      id: string;
      content_id: string | null;
      product_id: string | null;
      reason: string;
      summary: string | null;
      evidence_urls: string[] | null;
      created_at: string;
    }[];
    const labels = await resolveTargets(supabase, rows, failures);
    for (const row of rows) {
      items.push(
        updateProposalQueueItem({
          id: row.id,
          title: row.summary ?? row.reason,
          targetTitle: labels.get(targetKey(row)) ?? null,
          reason: row.summary ?? humaniseReason(row.reason),
          sourceCount: (row.evidence_urls ?? []).length,
          detectedAt: row.created_at,
        })
      );
    }
  }

  // ---- freshness ---------------------------------------------------------
  if (freshnessRes.error) {
    logQueryError("loadOwnerQueue freshness", freshnessRes.error);
    failures.push({ source: "Freshness reviews", message: freshnessRes.error.message });
  } else {
    const rows = (freshnessRes.data ?? []) as {
      id: string;
      product_id: string | null;
      content_id: string | null;
      reason: string;
      detail: string | null;
      severity: string;
      detected_at: string;
    }[];
    const labels = await resolveTargets(supabase, rows, failures);
    for (const row of rows) {
      const item = freshnessQueueItem({
        id: row.id,
        title: labels.get(targetKey(row)) ?? "Published page",
        reason: row.detail ?? humaniseReason(row.reason),
        severity: row.severity,
        detectedAt: row.detected_at,
      });
      if (item) items.push(item);
    }
  }

  const ranked = rankOwnerQueue(items);
  return {
    items: ranked,
    summary: summariseOwnerQueue(ranked),
    failures,
    briefQuality: summariseQuality(briefVerdicts),
  };
}

// ---------------------------------------------------------------------------
// Target resolution
// ---------------------------------------------------------------------------

type Targeted = { product_id: string | null; content_id: string | null };

function targetKey(row: Targeted): string {
  if (row.content_id) return `content:${row.content_id}`;
  if (row.product_id) return `product:${row.product_id}`;
  return "none";
}

/**
 * Resolve product/content ids to display names in two batched reads.
 *
 * A failure here degrades to the id-less fallback label rather than dropping
 * the item: an unlabelled rights blocker is still a rights blocker, and
 * removing it from the queue because its title could not be read would hide
 * work rather than surface it.
 */
async function resolveTargets(
  supabase: Awaited<ReturnType<typeof createClient>>,
  rows: readonly Targeted[],
  failures: QueueFailure[]
): Promise<Map<string, string>> {
  const labels = new Map<string, string>();
  const contentIds = [...new Set(rows.map((r) => r.content_id).filter((v): v is string => !!v))];
  const productIds = [...new Set(rows.map((r) => r.product_id).filter((v): v is string => !!v))];
  if (contentIds.length === 0 && productIds.length === 0) return labels;

  const [contentRes, productRes] = await Promise.all([
    contentIds.length > 0
      ? supabase.from("content_items").select("id, title").in("id", contentIds)
      : Promise.resolve({ data: [], error: null }),
    productIds.length > 0
      ? supabase.from("products").select("id, name").in("id", productIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (contentRes.error) {
    logQueryError("loadOwnerQueue resolveTargets content", contentRes.error);
    failures.push({
      source: "Queue item titles (content)",
      message: "Some items below show a generic label because their title could not be read.",
    });
  }
  if (productRes.error) {
    logQueryError("loadOwnerQueue resolveTargets products", productRes.error);
    failures.push({
      source: "Queue item titles (products)",
      message: "Some items below show a generic label because their name could not be read.",
    });
  }

  for (const c of (contentRes.data ?? []) as { id: string; title: string }[]) {
    labels.set(`content:${c.id}`, c.title);
  }
  for (const p of (productRes.data ?? []) as { id: string; name: string }[]) {
    labels.set(`product:${p.id}`, p.name);
  }
  return labels;
}

function humaniseReason(value: string): string {
  return value.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

// ---------------------------------------------------------------------------
// Engine health — the "is it running" line
// ---------------------------------------------------------------------------

export type EngineHealthSummary = {
  masterEnabled: boolean;
  /** True when the last tick completed without a failed stage. */
  healthy: boolean;
  lastRunAt: string | null;
  lastRunStatus: string | null;
  /** Stage names whose most recent run failed or was partial. */
  failingStages: string[];
  /** Null when settings could not be read — distinct from "disabled". */
  unknown: boolean;
};

/**
 * The four-line health block the owner sees.
 *
 * `unknown` exists because "we could not read the settings" and "the engine is
 * off" are different facts with opposite implications, and a boolean alone
 * cannot carry that. A page that renders `masterEnabled === false` as "Engine
 * stopped" when the read actually failed would send the owner to debug the
 * wrong thing.
 */
export async function loadEngineHealth(): Promise<EngineHealthSummary> {
  const supabase = await createClient();
  const [settingsRes, runsRes] = await Promise.all([
    supabase.from("engine_settings").select("master_enabled").eq("id", true).maybeSingle(),
    supabase
      .from("engine_job_runs")
      .select("job_name, status, started_at")
      .order("started_at", { ascending: false })
      .limit(200),
  ]);

  if (settingsRes.error || runsRes.error) {
    logQueryError("loadEngineHealth", settingsRes.error ?? runsRes.error);
    return {
      masterEnabled: false,
      healthy: false,
      lastRunAt: null,
      lastRunStatus: null,
      failingStages: [],
      unknown: true,
    };
  }

  const runs = (runsRes.data ?? []) as { job_name: string; status: string; started_at: string }[];
  const tick = runs.find((r) => r.job_name === "engine_tick") ?? runs[0] ?? null;

  // Most recent run per job, then the ones that ended badly.
  const seen = new Set<string>();
  const failingStages: string[] = [];
  for (const r of runs) {
    if (seen.has(r.job_name)) continue;
    seen.add(r.job_name);
    if (r.status === "failed" || r.status === "partial") failingStages.push(r.job_name);
  }

  return {
    masterEnabled: settingsRes.data?.master_enabled === true,
    healthy: failingStages.length === 0 && tick?.status === "success",
    lastRunAt: tick?.started_at ?? null,
    lastRunStatus: tick?.status ?? null,
    failingStages,
    unknown: false,
  };
}
