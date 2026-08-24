import "server-only";

// RESEARCHED TOPICS AS OWNER PACKAGES.
//
// The research stage now persists corroborating evidence against a discovery.
// This turns that persisted state into the thing the owner actually wants: one
// topic, one package, one decision — instead of a discovery here, evidence
// there, and a brief somewhere else.
//
// It reads ONLY what is stored. No feeds are fetched to render the queue: the
// owner opening a page must not trigger twenty-three HTTP requests, and a
// package that changes every time it is refreshed is not a thing anyone can
// approve. Research happens on the nightly tick; this reports its results.
//
// A TOPIC QUALIFIES WHEN
// ----------------------
//   * the discovery has corroborating evidence beyond its own source, and
//   * TechCarvalho has not already covered it.
//
// The second is a cannibalisation check against published titles, and a failed
// corpus read suppresses the claim rather than producing a false clearance —
// the same rule as everywhere else in this codebase.

import { createClient } from "@/lib/supabase/server";
import { logQueryError } from "@/lib/log/query-error";
import { assessLineage } from "./research/lineage.ts";
import { extractClaims, summariseClaims } from "./research/claim-extraction.ts";
import { primarySubject } from "./research/entity-model.ts";
import { decide } from "./research/research-pipeline.ts";
import { assessCorroboration } from "./corroboration.ts";
import { titleSimilarity, NEAR_DUPLICATE_THRESHOLD } from "./dedupe.ts";
import { SEED_SOURCES } from "./research/source-seed.ts";
import { hostOf, registrableDomain } from "./independence.ts";

/** Evidence rows beyond the discovery's own source before a topic is a package. */
export const MIN_EVIDENCE_FOR_PACKAGE = 2;

export type ResearchedTopic = {
  discoveryId: string;
  title: string;
  categorySlug: string | null;
  detectedAt: string;
  publishers: string[];
  independentOrigins: number;
  collapsed: { url: string; reason: string }[];
  claimsTotal: number;
  claimsAttributed: number;
  claimsHedged: number;
  claimsWithValues: number;
  sampleClaims: { text: string; hedges: string[]; attributedTo: string | null }[];
  evidence: { url: string; publisher: string | null; originatesFrom: string | null }[];
  framing: "confirmed" | "reported" | "rumoured" | "insufficient";
  articleEligible: boolean;
  productEligible: boolean;
  suggestedTitle: string | null;
  reasons: string[];
  /** Set when an existing published page already covers this. */
  alreadyCovered: { title: string; similarity: number } | null;
  corpusKnown: boolean;
};

type EvidenceRow = {
  discovery_id: string;
  url: string;
  publisher: string | null;
  excerpt: string | null;
  originates_from_url: string | null;
};

/** Independence group for a domain, from the registry. Falls back to the domain. */
function groupForUrl(url: string): string {
  const domain = registrableDomain(hostOf(url));
  if (!domain) return url;
  const source = SEED_SOURCES.find((s) => s.domain === domain);
  return source?.independenceGroup ?? domain;
}

export async function loadResearchedTopics(limit = 20): Promise<{
  topics: ResearchedTopic[];
  failures: { source: string; message: string }[];
}> {
  const supabase = await createClient();
  const failures: { source: string; message: string }[] = [];

  const [discRes, evRes, contentRes] = await Promise.all([
    supabase
      .from("engine_discoveries")
      .select("id, title, summary, category_slug, claim_status, first_seen_at, content_id")
      .order("first_seen_at", { ascending: false })
      .limit(200),
    supabase
      .from("engine_discovery_evidence")
      .select("discovery_id, url, publisher, excerpt, originates_from_url")
      .limit(2000),
    supabase.from("content_items").select("title").eq("status", "published"),
  ]);

  if (discRes.error) {
    logQueryError("loadResearchedTopics discoveries", discRes.error);
    failures.push({ source: "Researched topics", message: discRes.error.message });
    return { topics: [], failures };
  }
  if (evRes.error) {
    logQueryError("loadResearchedTopics evidence", evRes.error);
    failures.push({ source: "Research evidence", message: evRes.error.message });
    return { topics: [], failures };
  }

  let corpusKnown = true;
  let publishedTitles: string[] = [];
  if (contentRes.error) {
    corpusKnown = false;
    logQueryError("loadResearchedTopics corpus", contentRes.error);
    failures.push({
      source: "Published content",
      message: "Topics below have NOT been checked against existing coverage.",
    });
  } else {
    publishedTitles = (contentRes.data ?? []).map((c: { title: string }) => c.title);
  }

  const byDiscovery = new Map<string, EvidenceRow[]>();
  for (const row of (evRes.data ?? []) as unknown as EvidenceRow[]) {
    const list = byDiscovery.get(row.discovery_id) ?? [];
    list.push(row);
    byDiscovery.set(row.discovery_id, list);
  }

  const discoveries = (discRes.data ?? []) as unknown as {
    id: string;
    title: string;
    summary: string | null;
    category_slug: string | null;
    claim_status: string;
    first_seen_at: string;
    content_id: string | null;
  }[];

  const topics: ResearchedTopic[] = [];

  for (const d of discoveries) {
    if (d.content_id) continue; // already turned into coverage
    const evidence = byDiscovery.get(d.id) ?? [];
    if (evidence.length < MIN_EVIDENCE_FOR_PACKAGE) continue;

    const lineage = assessLineage(
      evidence.map((e) => ({
        url: e.url,
        publisher: e.publisher,
        text: e.excerpt ?? "",
        independenceGroup: groupForUrl(e.url),
        // A row the research stage already marked derivative stays derivative,
        // rather than being re-judged from an excerpt that may not contain the
        // citation the original article carried.
        ...(e.originates_from_url ? { text: `according to ${e.originates_from_url}` } : {}),
      }))
    );

    const claims = evidence.flatMap((e) => extractClaims(e.excerpt ?? "", { max: 8 }));
    const breakdown = summariseClaims(claims);

    const subject = primarySubject(`${d.title} ${d.summary ?? ""}`);
    const corroboration = assessCorroboration({
      sourceUrls: lineage.nodes.filter((n) => n.role === "origin").map((n) => `https://${n.domain}/`),
      subjectDomains: subject?.organisation.domains ?? [],
      claimStatus: "unverified",
      aboutUnreleasedProduct: false,
    });

    const decision = decide({
      title: d.title,
      subject,
      lineage,
      claimBreakdown: breakdown,
      corroboration,
      aboutUnreleasedProduct: false,
    });

    let alreadyCovered: { title: string; similarity: number } | null = null;
    if (corpusKnown) {
      for (const t of publishedTitles) {
        const sim = titleSimilarity(d.title, t);
        if (sim >= NEAR_DUPLICATE_THRESHOLD && (!alreadyCovered || sim > alreadyCovered.similarity)) {
          alreadyCovered = { title: t, similarity: sim };
        }
      }
    }
    if (alreadyCovered) continue; // an update proposal, not a new package

    topics.push({
      discoveryId: d.id,
      title: d.title,
      categorySlug: d.category_slug,
      detectedAt: d.first_seen_at,
      publishers: [...new Set(evidence.map((e) => e.publisher).filter((p): p is string => !!p))],
      independentOrigins: lineage.independentOrigins,
      collapsed: lineage.collapsed,
      claimsTotal: breakdown.total,
      claimsAttributed: breakdown.attributed,
      claimsHedged: breakdown.hedged,
      claimsWithValues: breakdown.withValues,
      sampleClaims: claims.slice(0, 8).map((c) => ({
        text: c.text,
        hedges: c.hedges,
        attributedTo: c.attributedTo,
      })),
      evidence: evidence.map((e) => ({
        url: e.url,
        publisher: e.publisher,
        originatesFrom: e.originates_from_url,
      })),
      framing: decision.framing,
      articleEligible: decision.articleEligible,
      productEligible: decision.productEligible,
      suggestedTitle: decision.suggestedTitle,
      reasons: decision.reasons,
      alreadyCovered,
      corpusKnown,
    });

    if (topics.length >= limit) break;
  }

  return { topics, failures };
}

export async function loadResearchedTopic(discoveryId: string): Promise<ResearchedTopic | null> {
  const { topics } = await loadResearchedTopics(200);
  return topics.find((t) => t.discoveryId === discoveryId) ?? null;
}
