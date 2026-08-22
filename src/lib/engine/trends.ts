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
//  - A measurement is only a claim about the window it was taken in. See the
//    decay section at the bottom of this file: as the evidence behind a score
//    ages, the trend decays toward EXPIRED ("we can no longer say this is
//    trending") rather than toward a smaller number that still looks measured.

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

// ===========================================================================
// Decay, expiry and continuous re-ranking
// ===========================================================================
//
// The problem this solves: computeTrend() produces a number from a 14-day
// window of evidence and that number is then stored. Without decay, the score
// keeps describing a window that has since elapsed, and a topic that was hot a
// month ago sits at the top of the admin ranking looking exactly as current as
// one measured this morning. "Old trend pinned at #1 forever" is the default
// failure mode of every trend table that only scores at creation.
//
// THE LINE THIS MUST NOT CROSS
// ---------------------------
// This module's whole reason to exist is that a MEASUREMENT ("readers searched
// for this 40 times") is a different kind of claim from an INFERENCE ("we think
// this still matters"). Decay is squarely an inference — it is our belief about
// how much a past measurement still describes the present — so it must never be
// laundered back into the measurement.
//
// Concretely, three rules, all enforced below and all covered by tests:
//
//   1. `measuredScore` is returned untouched. Decay NEVER rewrites trend_score
//      in the database. The stored number stays the honest thing that was
//      actually measured at `last_observed_at`.
//   2. The decayed value is returned as `rankScore` and is for ORDERING and for
//      the expiry decision only. It is named, labelled and explained as a
//      currency discount on an ageing measurement, never presented as a fresh
//      one.
//   3. A null measurement stays null. Decay of "nothing was measurable" is
//      still "nothing was measurable" — it must never become 0, or some small
//      positive number, because both of those are numeric claims about reader
//      interest that nobody made. "No data" and "no interest" remain different
//      statements after decay, exactly as they are before it.
//
// Ageing evidence therefore moves a trend toward EXPIRED — "we can no longer
// say this is trending" — and not toward a smaller fabricated score that still
// implies somebody measured something.

/**
 * Half-life, in hours, of a trend measurement's claim on the present.
 *
 * Chosen from the two cadences that actually constrain it:
 *
 *  - The engine tick runs daily (`vercel.json`: `30 4 * * *`), so in a healthy
 *    pipeline every topic is re-measured every ~24h and decay is nearly a
 *    no-op: 0.5^(24/72) = 0.79. Decay only bites once measurement has actually
 *    stopped for a topic, which is the situation we care about.
 *  - `engine_trend_inputs` measures a 14-day window. Once 14 days have passed
 *    with no fresh pass, *none* of the evidence behind the stored score is
 *    still inside a current window.
 *
 * 72h (3 days) sits between them: one missed pass is a visible demotion rather
 * than a cliff (x0.79), a week of silence is a heavy one (x0.20), and — see
 * TREND_EXPIRY_SCORE — even a perfect 100 falls under the expiry floor before
 * the 14-day window has fully elapsed.
 */
export const TREND_EVIDENCE_HALF_LIFE_HOURS = 72;

/**
 * Decayed rank score below which a trend is no longer presented as trending.
 *
 * 5.0 on the 0-100 scale, and picked *together with* the half-life rather than
 * independently: 100 x 0.5^(t/72) crosses 5.0 at t = 72 x log2(20) = 311h
 * = 13.0 days. So the strongest measurement this module can produce still
 * expires inside the 14-day measurement window if nothing renews it. That is
 * the guarantee — no trend, however hot it once was, can outlive the evidence
 * window that produced it.
 */
export const TREND_EXPIRY_SCORE = 5;

/**
 * Hard evidence horizon: 336h = 14 days = one full `engine_trend_inputs`
 * window. Past this, a trend is expired regardless of how high it scored,
 * because every signal behind it has aged out of the window that measured it.
 *
 * This also catches ORPHANS — a topic whose category was renamed or deleted
 * stops being returned by engine_trend_inputs entirely, so nothing would ever
 * update it again. Without the horizon such a row would sit in the ranking
 * indefinitely; it is the one rule that does not depend on the score at all.
 */
export const TREND_EVIDENCE_HORIZON_HOURS = 24 * 14;

/**
 * Grace period before the floor rule can expire anything: 24h, one full
 * scheduled pass.
 *
 * Within it the stored score is the CURRENT measurement, so a low number means
 * "we looked today and there is barely anything here" — honest and worth
 * showing — rather than "this is stale". Expiring on the floor alone would
 * conflate weak-but-current with old-and-unverified, which is the exact
 * confusion this module exists to prevent. The horizon rule ignores the grace
 * period, since 336h > 24h makes it moot.
 */
export const TREND_DECAY_GRACE_HOURS = 24;

/**
 * Lifecycle of a stored trend, derived — never stored as its own column, so it
 * can never drift out of sync with the score and timestamp it describes.
 *
 *  - `measured`  the measurement is current (younger than one scheduled pass).
 *  - `decaying`  no fresh measurement since; still above the floor.
 *  - `unscored`  measured, and nothing measurable was found. Not a low score.
 *  - `expired`   below the floor, or past the evidence horizon. Not trending.
 */
export type TrendLifecycle = "measured" | "decaying" | "unscored" | "expired";

export type DecayedTrend = {
  /** Exactly as measured. Decay never alters this. */
  measuredScore: number | null;
  /**
   * Decayed value used for ORDERING and for the expiry decision only. Null
   * whenever measuredScore is null — an unmeasurable trend never acquires a
   * number by ageing.
   */
  rankScore: number | null;
  /** 0..1 multiplier actually applied. 1.0 at age 0. */
  decayFactor: number;
  evidenceAgeHours: number;
  lifecycle: TrendLifecycle;
  /** Convenience mirror of `lifecycle !== "expired"`, matching engine_trends.is_active. */
  isActive: boolean;
  /**
   * Plain-language statement of what the decay did, written so it can be shown
   * next to the score without implying the discounted number was measured.
   */
  decayNote: string;
};

function roundTo(value: number, places: number): number {
  return Number(value.toFixed(places));
}

/** Age of a measurement in hours, clamped at 0 (a future timestamp is not negative age). */
export function evidenceAgeHours(lastObservedAt: string | Date | null, now: number = Date.now()): number {
  if (!lastObservedAt) return Number.POSITIVE_INFINITY;
  const observed = lastObservedAt instanceof Date ? lastObservedAt : new Date(lastObservedAt);
  const ms = observed.getTime();
  if (Number.isNaN(ms)) return Number.POSITIVE_INFINITY;
  return Math.max((now - ms) / 3_600_000, 0);
}

/**
 * Apply evidence decay to a measured trend score.
 *
 * Deterministic and pure: the caller supplies the age, so the same inputs
 * always give the same answer and nothing here reads the clock.
 *
 * @param trend the measurement — `{ score }` from computeTrend(), or a stored
 *   `trend_score` read back from engine_trends.
 * @param ageHoursInput hours since the measurement was taken. `Infinity` (an
 *   unknown/absent `last_observed_at`) is treated as beyond the horizon: we
 *   cannot date the evidence, so we cannot claim it is current.
 */
export function decayTrend(
  trend: { score: number | null },
  ageHoursInput: number
): DecayedTrend {
  const ageHours = Number.isFinite(ageHoursInput)
    ? Math.max(ageHoursInput, 0)
    : Number.POSITIVE_INFINITY;
  const pastHorizon = ageHours >= TREND_EVIDENCE_HORIZON_HOURS;
  const decayFactor = pastHorizon
    ? 0
    : roundTo(Math.pow(0.5, ageHours / TREND_EVIDENCE_HALF_LIFE_HOURS), 6);
  const ageLabel = Number.isFinite(ageHours) ? `${Math.round(ageHours)}h` : "an unknown time";

  // Rule 3: nothing measurable stays nothing measurable. No floor, no zero, no
  // invented number — only the horizon can move it, and only to "expired".
  if (trend.score === null) {
    return {
      measuredScore: null,
      rankScore: null,
      decayFactor,
      evidenceAgeHours: ageHours,
      lifecycle: pastHorizon ? "expired" : "unscored",
      isActive: !pastHorizon,
      decayNote: pastHorizon
        ? `Unscored and last measured ${ageLabel} ago, beyond the ${TREND_EVIDENCE_HORIZON_HOURS}h evidence horizon. Expired: there is nothing to decay and nothing to report.`
        : "Unscored — no measurable signal. Decay does not apply: an unmeasured trend never becomes a number by ageing.",
    };
  }

  const rankScore = roundTo(trend.score * decayFactor, 2);
  const belowFloor = rankScore < TREND_EXPIRY_SCORE && ageHours >= TREND_DECAY_GRACE_HOURS;
  const lifecycle: TrendLifecycle = pastHorizon
    ? "expired"
    : belowFloor
      ? "expired"
      : ageHours < TREND_DECAY_GRACE_HOURS
        ? "measured"
        : "decaying";

  let decayNote: string;
  if (pastHorizon) {
    decayNote = `Measured ${trend.score} ${ageLabel} ago — past the ${TREND_EVIDENCE_HORIZON_HOURS}h evidence horizon, so every signal behind it has aged out of the measurement window. Expired, not re-scored.`;
  } else if (belowFloor) {
    decayNote = `Measured ${trend.score} ${ageLabel} ago; discounted to ${rankScore} for ranking, below the ${TREND_EXPIRY_SCORE} floor. Expired — no longer measurably trending.`;
  } else if (lifecycle === "measured") {
    decayNote = `Measured ${trend.score} ${ageLabel} ago (current). Ranking value ${rankScore}.`;
  } else {
    decayNote = `Measured ${trend.score} ${ageLabel} ago and not re-measured since; ranked at ${rankScore} after a ${TREND_EVIDENCE_HALF_LIFE_HOURS}h half-life discount. The discount reflects the age of the evidence, not a new measurement.`;
  }

  return {
    measuredScore: trend.score,
    rankScore,
    decayFactor,
    evidenceAgeHours: ageHours,
    lifecycle,
    isActive: lifecycle !== "expired",
    decayNote,
  };
}

/**
 * Ranking comparator over decayed trends. Same contract as byTrendScore —
 * unscored sorts last, never as zero — with expired sorting below everything
 * still live, so an expired row can never appear above a current one.
 */
export function byDecayedTrendScore(
  a: Pick<DecayedTrend, "rankScore" | "lifecycle">,
  b: Pick<DecayedTrend, "rankScore" | "lifecycle">
): number {
  const aExpired = a.lifecycle === "expired";
  const bExpired = b.lifecycle === "expired";
  if (aExpired !== bExpired) return aExpired ? 1 : -1;
  return byTrendScore({ score: a.rankScore }, { score: b.rankScore });
}

export type RankableTrend = {
  score: number | null;
  lastObservedAt: string | Date | null;
};

/**
 * Continuous re-ranking: decay every row against the *current* clock and sort.
 *
 * Called on every trend-job pass and on every admin render, so ordering always
 * reflects how old each measurement is right now rather than the order things
 * happened to be scored in. Cheap and pure — no query, no stored rank to go
 * stale.
 */
export function rankTrends<T extends RankableTrend>(
  rows: readonly T[],
  now: number = Date.now()
): (T & { decay: DecayedTrend })[] {
  return rows
    .map((row) => ({ ...row, decay: decayTrend(row, evidenceAgeHours(row.lastObservedAt, now)) }))
    .sort((a, b) => byDecayedTrendScore(a.decay, b.decay));
}
