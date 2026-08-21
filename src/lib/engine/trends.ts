// Trend scoring — multi-signal, deterministic, no AI.
//
// The distinction this module exists to preserve: a TREND is a measurement of
// what is being talked about and looked at. It is NOT a decision that
// TechCarvalho should publish something (that is engine_opportunities). Mixing
// the two is how a publication ends up chasing whatever a manufacturer posted
// most recently.
//
// Consequences of that stance, both deliberate:
//  - Feed volume alone cannot produce a high trend score. A vendor posting ten
//    press releases in a day is not a trend; it is a vendor with a busy PR
//    department. Audience signals are weighted far more heavily.
//  - When there is no audience data at all, confidence collapses and the score
//    is reported with that low confidence rather than being presented as a
//    reliable measurement. We never fabricate demand.

export type TrendInputs = {
  /** Discoveries in this category within the window. */
  recentDiscoveries: number;
  /** Of those, how many passed the relevance filter. */
  relevantDiscoveries: number;
  /** Category page views in the window. */
  recentViews: number;
  /** Views in the preceding equal window, for velocity. */
  priorViews: number;
  searches: number;
  zeroResultSearches: number;
  commercialClicks: number;
  /** Published articles in this category within the window. */
  publishedCoverage: number;
  /** Age in hours of the newest relevant discovery, or null if none. */
  hoursSinceNewestDiscovery: number | null;
};

export type TrendResult = {
  score: number | null;
  confidence: number;
  velocity: number | null;
  signals: Record<string, number>;
  whyTrending: string;
  recommendedContentType: "review" | "guide" | "comparison" | "news" | "troubleshooting" | null;
  hasAudienceSignal: boolean;
};

// Audience signals outweigh feed signals roughly 3:1. This ratio is the whole
// editorial stance of the module.
const WEIGHTS = {
  audienceVolume: 0.28,
  audienceGrowth: 0.22,
  unmetDemand: 0.20,
  commercialIntent: 0.12,
  feedActivity: 0.10,
  recency: 0.08,
} as const;

function norm(value: number, softCap: number): number {
  if (value <= 0) return 0;
  return Math.min(value / softCap, 1);
}

export function computeTrend(inputs: TrendInputs): TrendResult {
  const audienceTotal = inputs.recentViews + inputs.searches;
  const hasAudienceSignal = audienceTotal > 0;

  // Confidence reflects how much of the score rests on actual audience data
  // rather than on a vendor's posting cadence. With no audience data at all,
  // confidence is deliberately very low even if feeds are busy — the number is
  // then a statement about press-release volume, and is labelled as such.
  let confidence = 0;
  if (hasAudienceSignal) {
    confidence += Math.min(audienceTotal / 50, 0.6);
    if (inputs.priorViews > 0) confidence += 0.2; // a real baseline to compare against
  }
  if (inputs.relevantDiscoveries > 0) confidence += 0.15;
  confidence = Number(Math.min(confidence, 1).toFixed(3));

  const velocity =
    inputs.priorViews > 0
      ? Number((((inputs.recentViews - inputs.priorViews) / inputs.priorViews) * 100).toFixed(2))
      : null;

  const signals = {
    audienceVolume: norm(audienceTotal, 150) * WEIGHTS.audienceVolume,
    audienceGrowth:
      (velocity === null ? (inputs.recentViews > 0 ? 0.5 : 0) : norm(velocity, 100)) *
      WEIGHTS.audienceGrowth,
    unmetDemand: norm(inputs.zeroResultSearches * 4, 20) * WEIGHTS.unmetDemand,
    commercialIntent: norm(inputs.commercialClicks, 20) * WEIGHTS.commercialIntent,
    feedActivity: norm(inputs.relevantDiscoveries, 12) * WEIGHTS.feedActivity,
    recency:
      inputs.hoursSinceNewestDiscovery === null
        ? 0
        : Math.max(0, 1 - inputs.hoursSinceNewestDiscovery / 168) * WEIGHTS.recency,
  };

  const raw = Object.values(signals).reduce((a, b) => a + b, 0) * 100;

  // A category with literally nothing measurable is unscored, not zero —
  // "no data" and "no interest" are different claims.
  if (audienceTotal === 0 && inputs.relevantDiscoveries === 0) {
    return {
      score: null,
      confidence,
      velocity,
      signals: {},
      whyTrending: "No measurable signals in this window (no audience activity, no relevant discoveries). Reported as unscored rather than zero.",
      recommendedContentType: null,
      hasAudienceSignal,
    };
  }

  return {
    score: Number(Math.min(raw, 100).toFixed(2)),
    confidence,
    velocity,
    signals: Object.fromEntries(Object.entries(signals).map(([k, v]) => [k, Number(v.toFixed(4))])),
    whyTrending: explain(inputs, signals, velocity, hasAudienceSignal, confidence),
    recommendedContentType: recommend(inputs),
    hasAudienceSignal,
  };
}

function explain(
  i: TrendInputs,
  signals: Record<string, number>,
  velocity: number | null,
  hasAudience: boolean,
  confidence: number
): string {
  const ranked = Object.entries(signals).filter(([, v]) => v > 0.0001).sort((a, b) => b[1] - a[1]);
  const parts: string[] = [];

  for (const [name] of ranked.slice(0, 3)) {
    switch (name) {
      case "audienceVolume":
        parts.push(`${i.recentViews} view(s) and ${i.searches} search(es) in the window`);
        break;
      case "audienceGrowth":
        parts.push(velocity === null ? "newly measurable traffic with no prior baseline" : `traffic moved ${velocity}% versus the previous window`);
        break;
      case "unmetDemand":
        parts.push(`${i.zeroResultSearches} search(es) returned nothing`);
        break;
      case "commercialIntent":
        parts.push(`${i.commercialClicks} outbound/affiliate click(s)`);
        break;
      case "feedActivity":
        parts.push(`${i.relevantDiscoveries} consumer-relevant item(s) from monitored sources`);
        break;
      case "recency":
        parts.push(`newest relevant item is ${Math.round(i.hoursSinceNewestDiscovery ?? 0)}h old`);
        break;
    }
  }

  const base = parts.length ? `Driven by: ${parts.join("; ")}.` : "No dominant signal.";

  if (!hasAudience) {
    return `${base} NOTE: no audience data in this window — this score reflects source/feed activity only and is a measure of publisher output, not reader interest. Confidence ${confidence}.`;
  }
  return `${base} Confidence ${confidence}.`;
}

function recommend(i: TrendInputs): TrendResult["recommendedContentType"] {
  // Unmet search demand is the clearest instruction the audience can give.
  if (i.zeroResultSearches > 0) return "guide";
  if (i.commercialClicks > 0) return "comparison";
  if (i.relevantDiscoveries > 0 && i.publishedCoverage === 0) return "news";
  if (i.recentViews > 0 && i.publishedCoverage === 0) return "guide";
  return null;
}

/** Ranking helper — unscored trends sort last, never as zero. */
export function byTrendScore(a: { score: number | null }, b: { score: number | null }): number {
  if (a.score === null && b.score === null) return 0;
  if (a.score === null) return 1;
  if (b.score === null) return -1;
  return b.score - a.score;
}
