import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { FpCategoryRow, FpSearchIntelligence, FpTopEntityRow, FpPageDepthRow } from "./first-party-dashboard";

// Deterministic (no external AI) analytics insights — every statement here
// is generated from a real query result via a fixed rule, never free-form
// text generation. See docs/analytics-insights-scoring.md for the
// opportunity-score methodology specifically. On a low-traffic site (which
// TechCarvalho currently is) most periods will legitimately produce few or
// zero insights — that is the correct, honest output; thresholds below are
// deliberately not lowered just to always show something.

export type InsightKind = "observation" | "recommendation";
export type InsightConfidence = "high" | "medium" | "low";

export type Insight = {
  kind: InsightKind;
  text: string;
  evidence: Record<string, unknown>;
  confidence: InsightConfidence;
};

// A single, small volume floor shared across every insight rule below —
// matches first-party-dashboard.ts's own MIN_TREND_VOLUME reasoning
// exactly (a 1-to-2 jump is not a trend), kept as a separate local
// constant rather than importing the other module's private one, since
// insight-generation thresholds are a distinct editorial decision that may
// reasonably diverge from the dashboard's raw trend-display floor later.
const MIN_INSIGHT_VOLUME = 5;

function confidenceFromVolume(volume: number, highThreshold: number): InsightConfidence {
  if (volume >= highThreshold) return "high";
  if (volume >= MIN_INSIGHT_VOLUME) return "medium";
  return "low";
}

// ---- Category growth/decline (observation) ----

export function categoryTrendInsights(rows: FpCategoryRow[], labelBySlug: Map<string, string>): Insight[] {
  const insights: Insight[] = [];
  for (const row of rows) {
    if (row.trend === null || row.views < MIN_INSIGHT_VOLUME) continue;
    const label = labelBySlug.get(row.slug) ?? row.slug;
    if (row.trend >= 20) {
      insights.push({
        kind: "observation",
        text: `${label} interest increased ${row.trend}% vs the previous equivalent period (${row.views} views this period).`,
        evidence: { category: row.slug, views: row.views, sessions: row.sessions, trend: row.trend },
        confidence: confidenceFromVolume(row.views, 20),
      });
    } else if (row.trend <= -20) {
      insights.push({
        kind: "observation",
        text: `${label} interest fell ${Math.abs(row.trend)}% vs the previous equivalent period (${row.views} views this period).`,
        evidence: { category: row.slug, views: row.views, sessions: row.sessions, trend: row.trend },
        confidence: confidenceFromVolume(row.views, 20),
      });
    }
  }
  return insights;
}

// ---- Search demand vs content supply (recommendation) ----

export function searchGapInsights(search: FpSearchIntelligence): Insight[] {
  const insights: Insight[] = [];
  for (const row of search.zeroResultSearches) {
    if (row.count < MIN_INSIGHT_VOLUME) continue;
    insights.push({
      kind: "recommendation",
      text: `"${row.query}" was searched ${row.count} time${row.count === 1 ? "" : "s"} this period with zero matching results — a real content-gap candidate.`,
      evidence: { query: row.query, count: row.count },
      confidence: confidenceFromVolume(row.count, 15),
    });
  }
  for (const row of search.risingSearches) {
    if (row.count < MIN_INSIGHT_VOLUME || row.trend === null || row.trend < 30) continue;
    insights.push({
      kind: "observation",
      text: `Searches for "${row.query}" rose ${row.trend}% vs the previous period (${row.count} this period).`,
      evidence: { query: row.query, count: row.count, trend: row.trend },
      confidence: confidenceFromVolume(row.count, 15),
    });
  }
  for (const row of search.newSearches) {
    if (row.count < MIN_INSIGHT_VOLUME) continue;
    insights.push({
      kind: "observation",
      text: `"${row.query}" is a new search term this period, not seen the period before (${row.count} searches).`,
      evidence: { query: row.query, count: row.count },
      confidence: confidenceFromVolume(row.count, 15),
    });
  }
  return insights;
}

// ---- High-traffic, low-onward-engagement content (observation) ----

export function engagementInsights(topContent: FpTopEntityRow[], nameById: Map<string, string>): Insight[] {
  const insights: Insight[] = [];
  for (const row of topContent) {
    if (row.views < 15 || row.engagementRate === null) continue;
    if (row.engagementRate < 10) {
      const name = nameById.get(row.id) ?? `content ${row.id.slice(0, 8)}`;
      insights.push({
        kind: "observation",
        text: `"${name}" receives strong traffic (${row.views} views) but sends few readers onward — only ${row.engagementRate}% of viewing sessions generated another click.`,
        evidence: { id: row.id, views: row.views, engagementRate: row.engagementRate },
        confidence: confidenceFromVolume(row.views, 30),
      });
    }
  }
  return insights;
}

// ---- High-exit pages (observation) ----

export function exitPageInsights(highExit: FpPageDepthRow[]): Insight[] {
  const insights: Insight[] = [];
  for (const row of highExit) {
    if (row.entries < 10 || row.exitRate < 70) continue;
    insights.push({
      kind: "observation",
      text: `${row.path} has a high exit rate — ${row.exitRate}% of the ${row.entries} sessions that reached it ended there.`,
      evidence: { path: row.path, entries: row.entries, exitRate: row.exitRate },
      confidence: confidenceFromVolume(row.entries, 25),
    });
  }
  return insights;
}

// ---- Category engagement vs homepage prominence (recommendation) ----
// A category that's one of the seeded PLANNED_CATEGORIES (i.e. has a
// permanent homepage/footer link) but attracts disproportionately little
// activity relative to the others in the same range.

export function prominenceMismatchInsights(rows: FpCategoryRow[], labelBySlug: Map<string, string>): Insight[] {
  const withActivity = rows.filter((r) => r.views > 0);
  if (withActivity.length < 3) return []; // not enough categories with any signal to call one an outlier
  const totalViews = withActivity.reduce((s, r) => s + r.views, 0);
  const avgShare = 1 / withActivity.length;
  const insights: Insight[] = [];
  for (const row of rows) {
    const share = totalViews > 0 ? row.views / totalViews : 0;
    if (row.views >= MIN_INSIGHT_VOLUME * withActivity.length && share < avgShare * 0.25) {
      const label = labelBySlug.get(row.slug) ?? row.slug;
      insights.push({
        kind: "recommendation",
        text: `${label} has a permanent homepage/footer link but receives well below its even share of category traffic this period (${row.views} views, ${Math.round(share * 100)}% of category views vs an even ${Math.round(avgShare * 100)}%).`,
        evidence: { category: row.slug, views: row.views, share: Math.round(share * 100), evenShare: Math.round(avgShare * 100) },
        confidence: "low",
      });
    }
  }
  return insights;
}

// ---- Opportunity score ----
// See docs/analytics-insights-scoring.md for the full methodology writeup.
// Every number here is explainable via `evidence` — no hidden inputs.

export type OpportunityScore = {
  key: string;
  label: string;
  score: number | null; // null = insufficient data, never a misleading 0/50
  reasons: string[];
  evidence: Record<string, unknown>;
};

const OPPORTUNITY_WEIGHTS = { demand: 0.35, growth: 0.25, engagement: 0.15, commercial: 0.15, supply: 0.1 };
const MIN_OPPORTUNITY_VOLUME = MIN_INSIGHT_VOLUME;

function normalize(value: number, max: number): number {
  if (max <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((value / max) * 100)));
}

export async function computeOpportunityScores(
  categoryRows: FpCategoryRow[],
  labelBySlug: Map<string, string>
): Promise<OpportunityScore[]> {
  const supabase = await createClient();
  const { data: cats } = await supabase.from("taxonomy_categories").select("id, slug");
  const catIdBySlug = new Map((cats ?? []).map((c) => [c.slug, c.id]));

  // Content supply per category — a real count query, not guessed.
  const supplyBySlug = new Map<string, number>();
  await Promise.all(
    categoryRows.map(async (row) => {
      const catId = catIdBySlug.get(row.slug);
      if (!catId) {
        supplyBySlug.set(row.slug, 0);
        return;
      }
      const [{ count: productCount }, { count: contentCount }] = await Promise.all([
        supabase.from("products").select("*", { count: "exact", head: true }).eq("category_id", catId).eq("is_published", true),
        supabase.from("content_items").select("*", { count: "exact", head: true }).eq("category_id", catId).eq("status", "published"),
      ]);
      supplyBySlug.set(row.slug, (productCount ?? 0) + (contentCount ?? 0));
    })
  );

  // Normalise demand/growth/engagement/commercial relative to the max
  // across THIS batch of categories, not an absolute scale — an
  // opportunity score is inherently comparative ("more promising than our
  // other categories right now"), not a claim about the wider world.
  const maxViews = Math.max(...categoryRows.map((r) => r.views), 1);
  const maxSearches = Math.max(...categoryRows.map((r) => r.searches), 1);
  const maxCommercial = Math.max(...categoryRows.map((r) => r.affiliateOutboundClicks), 1);
  const maxSupply = Math.max(...[...supplyBySlug.values()], 1);
  const positiveTrends = categoryRows.map((r) => (r.trend !== null && r.trend > 0 ? r.trend : 0));
  const maxTrend = Math.max(...positiveTrends, 1);

  return categoryRows.map((row) => {
    const label = labelBySlug.get(row.slug) ?? row.slug;
    const supply = supplyBySlug.get(row.slug) ?? 0;

    if (row.views < MIN_OPPORTUNITY_VOLUME && row.searches < MIN_OPPORTUNITY_VOLUME) {
      return {
        key: row.slug,
        label,
        score: null,
        reasons: ["Insufficient traffic/search volume this period to score."],
        evidence: { views: row.views, searches: row.searches },
      };
    }

    const demandScore = normalize(row.views + row.searches, maxViews + maxSearches);
    const growthScore = row.trend !== null && row.trend > 0 ? normalize(row.trend, maxTrend) : 0;
    const engagementScore = row.sessions > 0 ? normalize(row.contentClicks, row.sessions) : 0;
    const commercialScore = normalize(row.affiliateOutboundClicks, maxCommercial);
    // Supply is INVERTED: low existing supply relative to real demand is
    // what makes something an "opportunity" rather than already-served
    // demand — high supply scores LOW here on purpose.
    const supplyScore = 100 - normalize(supply, maxSupply);

    const score = Math.round(
      demandScore * OPPORTUNITY_WEIGHTS.demand +
        growthScore * OPPORTUNITY_WEIGHTS.growth +
        engagementScore * OPPORTUNITY_WEIGHTS.engagement +
        commercialScore * OPPORTUNITY_WEIGHTS.commercial +
        supplyScore * OPPORTUNITY_WEIGHTS.supply
    );

    const reasons: string[] = [];
    if (demandScore >= 60) reasons.push(`High relative demand (${row.views} views, ${row.searches} searches).`);
    if (growthScore >= 40) reasons.push(`Growing ${row.trend}% vs the previous period.`);
    if (supplyScore >= 70) reasons.push(`Low existing catalogue/content supply (${supply} published items) relative to demand.`);
    if (commercialScore >= 40) reasons.push(`Already generating commercial clicks (${row.affiliateOutboundClicks}).`);
    if (reasons.length === 0) reasons.push("Moderate signal across all inputs, no single standout factor.");

    return {
      key: row.slug,
      label,
      score,
      reasons,
      evidence: {
        views: row.views,
        searches: row.searches,
        trend: row.trend,
        contentClicks: row.contentClicks,
        sessions: row.sessions,
        affiliateOutboundClicks: row.affiliateOutboundClicks,
        publishedSupply: supply,
        componentScores: { demandScore, growthScore, engagementScore, commercialScore, supplyScore },
      },
    };
  });
}

// ---- "TechCarvalho Today" briefing ----
// Template-based assembly of the highest-confidence insights into a short
// paragraph — string interpolation over a fixed set of sentence templates,
// NOT a call to any external AI/LLM API (deliberately, per this batch's
// directive: this must work with zero paid service dependency). See this
// module's own report for what a genuinely polished natural-language layer
// would require if that's wanted later.

export function buildTodayBriefing(insights: Insight[]): string | null {
  if (insights.length === 0) return null;
  const ranked = [...insights].sort((a, b) => {
    const order = { high: 0, medium: 1, low: 2 };
    return order[a.confidence] - order[b.confidence];
  });
  const top = ranked.slice(0, 4);
  return top.map((i) => i.text).join(" ");
}
