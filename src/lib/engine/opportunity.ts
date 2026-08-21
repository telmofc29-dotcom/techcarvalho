import type { EngineOpportunity } from "./types.ts";

// Opportunity scoring: "What should TechCarvalho create or update next, and why?"
//
// Explicitly NOT "whatever technology story is newest". Novelty is one input
// among several, and demand signals from our own visitors outweigh it — the
// point of the feedback loop is to let real visitor behaviour steer the
// catalogue rather than chasing news cycles.
//
// Every score keeps its inputs and emits a sentence explaining itself. A score
// we can't explain is a score we shouldn't act on, so `explain()` is part of
// the contract rather than a debugging afterthought.
//
// Reuses the existing first-party analytics vocabulary (searches, zero-result
// searches, views, engagement) rather than introducing a second measurement
// system — see src/lib/analytics/first-party-dashboard.ts.

export type OpportunityInputs = {
  /** Internal searches for this subject in the window. */
  searchVolume: number;
  /** Searches that returned nothing — the sharpest possible gap signal. */
  zeroResultSearches: number;
  /** Page views for the subject (category/product/content) in the window. */
  views: number;
  /** Views in the preceding equal-length window, for trend. */
  previousViews: number;
  /** How many published articles already cover this subject. */
  existingContentCount: number;
  /** Outbound/affiliate clicks — genuine commercial interest. */
  commercialClicks: number;
  /** Days since the newest related content was published/reviewed. */
  daysSinceFreshest: number | null;
  /** A live discovery is attached (something actually happened). */
  hasActiveDiscovery: boolean;
};

// Below this combined demand, we don't score at all — a "100/100 opportunity"
// derived from two searches is noise dressed as insight. Returning null is the
// honest answer, exactly as MIN_TREND_VOLUME does in the analytics dashboard.
export const MIN_DEMAND_SIGNAL = 5;

const WEIGHTS = {
  demand: 0.3,
  gap: 0.25,
  growth: 0.2,
  commercial: 0.15,
  freshness: 0.1,
} as const;

function normalise(value: number, softCap: number): number {
  if (value <= 0) return 0;
  return Math.min(value / softCap, 1);
}

export type OpportunityScore = {
  score: number | null;
  inputs: OpportunityInputs;
  explanation: string;
  /** Component contributions, retained so the dashboard can show the maths. */
  components: Record<string, number>;
};

export function computeOpportunityScore(inputs: OpportunityInputs): OpportunityScore {
  const totalDemand = inputs.searchVolume + inputs.views + inputs.zeroResultSearches;

  if (totalDemand < MIN_DEMAND_SIGNAL) {
    return {
      score: null,
      inputs,
      components: {},
      explanation:
        `Not enough measured demand to score (${totalDemand} combined searches/views, ` +
        `minimum ${MIN_DEMAND_SIGNAL}). Reported as unscored rather than guessed.`,
    };
  }

  // Demand: raw appetite from our own visitors.
  const demand = normalise(inputs.searchVolume + inputs.views, 200);

  // Gap: demand that existing content does not satisfy. Zero-result searches
  // are weighted hardest because they are literal, unambiguous evidence of
  // someone wanting something we don't have.
  const unmet = inputs.zeroResultSearches * 3 + Math.max(0, inputs.searchVolume - inputs.existingContentCount * 10);
  const gap = normalise(unmet, 60);

  // Growth: trend vs the previous window. A real zero baseline with meaningful
  // current volume counts as growth; a zero-to-zero does not.
  let growth = 0;
  if (inputs.previousViews > 0) {
    growth = normalise((inputs.views - inputs.previousViews) / inputs.previousViews, 1);
  } else if (inputs.views >= MIN_DEMAND_SIGNAL) {
    growth = 0.6;
  }

  const commercial = normalise(inputs.commercialClicks, 25);

  // Freshness: only contributes when something already exists and has aged.
  const freshness =
    inputs.daysSinceFreshest === null ? 0 : normalise(inputs.daysSinceFreshest, 180);

  const components = {
    demand: demand * WEIGHTS.demand,
    gap: gap * WEIGHTS.gap,
    growth: growth * WEIGHTS.growth,
    commercial: commercial * WEIGHTS.commercial,
    freshness: freshness * WEIGHTS.freshness,
  };

  let score = Object.values(components).reduce((a, b) => a + b, 0) * 100;
  // A live, corroborated discovery is a modest nudge, not a takeover — this is
  // the guard against simply chasing the newest headline.
  if (inputs.hasActiveDiscovery) score = Math.min(score + 5, 100);

  return {
    score: Number(Math.min(score, 100).toFixed(2)),
    inputs,
    components,
    explanation: explain(inputs, components, inputs.hasActiveDiscovery),
  };
}

function explain(
  inputs: OpportunityInputs,
  components: Record<string, number>,
  hasDiscovery: boolean
): string {
  const ranked = Object.entries(components)
    .filter(([, v]) => v > 0.001)
    .sort((a, b) => b[1] - a[1]);

  if (ranked.length === 0) {
    return "Measured demand exists but no component scored above zero.";
  }

  const reasons: string[] = [];
  for (const [name] of ranked.slice(0, 3)) {
    switch (name) {
      case "demand":
        reasons.push(`${inputs.searchVolume} searches and ${inputs.views} views in this window`);
        break;
      case "gap":
        reasons.push(
          inputs.zeroResultSearches > 0
            ? `${inputs.zeroResultSearches} searches returned no results against ${inputs.existingContentCount} existing article(s)`
            : `demand outpaces the ${inputs.existingContentCount} existing article(s)`
        );
        break;
      case "growth":
        reasons.push(
          inputs.previousViews > 0
            ? `views moved from ${inputs.previousViews} to ${inputs.views} versus the previous period`
            : `newly measurable traffic with no prior baseline`
        );
        break;
      case "commercial":
        reasons.push(`${inputs.commercialClicks} outbound/affiliate click(s) indicate buying intent`);
        break;
      case "freshness":
        reasons.push(`existing coverage is ${inputs.daysSinceFreshest} day(s) old`);
        break;
    }
  }

  const base = `Ranked mainly on ${ranked[0][0]}: ${reasons.join("; ")}.`;
  return hasDiscovery
    ? `${base} A live discovery is attached, adding a small recency bonus (capped at 5 points so news cannot dominate measured demand).`
    : base;
}

/** Sort helper — unscored subjects sort last, never as if they were zero. */
export function byScoreDescending(a: EngineOpportunity, b: EngineOpportunity): number {
  if (a.score === null && b.score === null) return 0;
  if (a.score === null) return 1;
  if (b.score === null) return -1;
  return b.score - a.score;
}
