// THE DAILY SPOTLIGHT — quality, freshness, and a fair turn at the front.
//
// THE PROBLEM
// -----------
// `public_homepage_selection` orders by score and takes the top N. That is a
// correct ranking and a bad front page, because a score built from recency and
// centrality changes slowly: the same five articles win today, tomorrow and for
// most of a month. A technology publication whose front page does not move is
// not being edited, and a reader who visits twice a week sees nothing new.
//
// WHAT THIS ADDS, AND WHAT IT REUSES
// ----------------------------------
// It does NOT re-rank. `baseScore` comes from the existing scoring — the same
// per-type half-lives in trending.ts and the selection RPC — and is treated as
// given. This module decides, among things already judged good, WHICH GET THIS
// DAY'S TURN.
//
// Three rules do the work:
//
//   1. A HARD 30-DAY WINDOW. Older content is not merely deprioritised, it is
//      ineligible. The spotlight promotes current coverage; a six-month-old
//      guide can be excellent and still have no business occupying it. Evergreen
//      status does not exempt anything — that is stated explicitly because it is
//      the exception someone will reach for first.
//
//   2. ROTATION MEMORY. Exposure already received counts against a candidate,
//      and never having been spotlighted counts for it. Without this the engine
//      re-runs the same comparison every day and produces the same winners,
//      which is precisely the complaint.
//
//   3. CATEGORY DIVERSITY, ACROSS DAYS. Not just "no more than N gaming stories
//      today", but "gaming led yesterday, so equally-good smartphone coverage
//      gets the edge today".
//
// DETERMINISM
// -----------
// Pure and total: the same candidates and the same rotation date always produce
// the same selection. There is no randomness anywhere in this file. A visitor
// refreshing the homepage sees a stable page because the answer cannot change,
// not because a cache is hiding the churn.
//
// PURE. No `server-only`, no Supabase, no clock — `now` is passed in.

export const SPOTLIGHT_WINDOW_DAYS = 30;

/**
 * Freshness multipliers by age.
 *
 * These are a ROTATION PRIORITY, deliberately distinct from the ranking
 * half-lives in trending.ts, which they do not replace. The half-life answers
 * "how good is this story now?"; this answers "how badly does it need its turn
 * before it stops being current?". A 3-day-old story and a 25-day-old story can
 * score similarly on quality while having very different claims on the front
 * page.
 */
export const AGE_PRIORITY: readonly { maxDays: number; weight: number; label: string }[] = [
  { maxDays: 2, weight: 1.0, label: "very fresh" },
  { maxDays: 7, weight: 0.85, label: "fresh" },
  { maxDays: 14, weight: 0.65, label: "recent" },
  { maxDays: SPOTLIGHT_WINDOW_DAYS, weight: 0.45, label: "ageing" },
];

/**
 * Bonus for content that has never held a spotlight position.
 *
 * Large on purpose. This is the single rule that stops five strong stories
 * monopolising the front page for a month, and a timid value would leave the
 * incumbents winning on raw score forever.
 */
export const NEVER_SPOTLIGHTED_BONUS = 25;

/** Days of cool-down after an appearance before a candidate competes normally again. */
export const SPOTLIGHT_COOLDOWN_DAYS = 4;

/** Penalty applied at zero days since exposure, decaying to nothing at the cool-down. */
export const RECENTLY_SPOTLIGHTED_PENALTY = 45;

/** Additional penalty per prior appearance, so repeats have to earn it. */
export const PER_APPEARANCE_PENALTY = 8;

/** Most positions any one category may hold in a single day's spotlight. */
export const MAX_PER_CATEGORY = 2;

/** Penalty for a category that was prominent in the previous rotation. */
export const YESTERDAY_CATEGORY_PENALTY = 12;

/**
 * Score gap above which an important story overrides diversity and cool-down.
 *
 * The escape hatch that keeps the rules from being stupid: a genuinely major
 * development should not sit out because its category had a good day yesterday.
 * Set high enough that ordinary stories never reach it.
 */
export const OVERRIDE_MARGIN = 40;

const MS_PER_DAY = 86_400_000;

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export type SpotlightCandidate = {
  contentId: string;
  title: string;
  slug: string;
  contentType: string | null;
  categorySlug: string | null;
  publishedAt: string;
  /** From the EXISTING ranking. Never recomputed here. */
  baseScore: number;
  /** ISO date of the most recent spotlight appearance, or null for never. */
  lastSpotlightedAt: string | null;
  /** Total prior appearances. */
  spotlightCount: number;
  /** True when a published, subject-appropriate hero exists. A tie-breaker only. */
  hasStrongMedia: boolean;
  /** Editorial overrides, already filtered to those currently in force. */
  pinnedLead?: boolean;
  pinnedSupporting?: boolean;
  boosted?: boolean;
  suppressed?: boolean;
};

export type SpotlightHistory = {
  /** Category slugs prominent in the previous rotation. */
  previousCategories: string[];
  /** Content ids in the previous rotation. */
  previousContentIds: string[];
};

export type SpotlightSlot = {
  candidate: SpotlightCandidate;
  role: "lead" | "supporting";
  /** Final rotation score. Never shown to a reader; it orders the page. */
  score: number;
  /** Why this item is here, in plain words. For the admin view. */
  reasons: string[];
};

export type SpotlightSelection = {
  rotationDate: string;
  lead: SpotlightSlot | null;
  supporting: SpotlightSlot[];
  /** Eligible but not chosen, best first — the next rotation's likely candidates. */
  nextUp: SpotlightCandidate[];
  /** Excluded with the reason, so an absence is explainable. */
  excluded: { candidate: SpotlightCandidate; reason: string }[];
};

// ---------------------------------------------------------------------------
// Eligibility
// ---------------------------------------------------------------------------

export function ageInDays(publishedAt: string, now: Date): number {
  const t = new Date(publishedAt).getTime();
  if (Number.isNaN(t)) return Number.POSITIVE_INFINITY;
  return Math.max(0, (now.getTime() - t) / MS_PER_DAY);
}

/**
 * Whether a candidate may hold a spotlight position at all.
 *
 * A pin does NOT bypass the window. That is deliberate and worth stating: a
 * human pinning a two-month-old article to the front page is almost always a
 * stale override nobody cleared, and the window is the safeguard that stops the
 * homepage silently rotting around it. Pins win every OTHER contest.
 */
export function isEligible(
  candidate: SpotlightCandidate,
  now: Date
): { eligible: true } | { eligible: false; reason: string } {
  if (candidate.suppressed) {
    return { eligible: false, reason: "Suppressed by an editorial override." };
  }
  const age = ageInDays(candidate.publishedAt, now);
  if (!Number.isFinite(age)) {
    return { eligible: false, reason: "No usable publication date." };
  }
  if (age > SPOTLIGHT_WINDOW_DAYS) {
    return {
      eligible: false,
      reason:
        `Published ${Math.floor(age)} days ago; the spotlight is for content under ` +
        `${SPOTLIGHT_WINDOW_DAYS} days old. It stays available everywhere else on the site.`,
    };
  }
  return { eligible: true };
}

export function agePriority(ageDays: number): { weight: number; label: string } {
  for (const bucket of AGE_PRIORITY) {
    if (ageDays <= bucket.maxDays) return { weight: bucket.weight, label: bucket.label };
  }
  return { weight: 0, label: "outside the window" };
}

// ---------------------------------------------------------------------------
// Rotation scoring
// ---------------------------------------------------------------------------

export type RotationScore = {
  score: number;
  reasons: string[];
};

/**
 * Adjust an already-computed editorial score for rotation fairness.
 *
 * Everything here is an adjustment to `baseScore`, never a replacement for it.
 * A story the ranking considers weak cannot be promoted to the lead by having
 * waited its turn.
 */
export function rotationScore(
  candidate: SpotlightCandidate,
  now: Date,
  history: SpotlightHistory
): RotationScore {
  const reasons: string[] = [];
  const age = ageInDays(candidate.publishedAt, now);
  const { weight, label } = agePriority(age);

  let score = candidate.baseScore * weight;
  reasons.push(
    `Editorial score ${candidate.baseScore.toFixed(1)} weighted ${weight.toFixed(2)} for being ${label} (${Math.floor(age)}d).`
  );

  if (candidate.spotlightCount === 0) {
    score += NEVER_SPOTLIGHTED_BONUS;
    reasons.push(`Never spotlighted before (+${NEVER_SPOTLIGHTED_BONUS}).`);
  } else if (candidate.boosted) {
    // A BOOST WAIVES THE EXPOSURE PENALTIES, rather than merely outweighing
    // them. This is what a boost MEANS: "I know it ran recently, run it again."
    // Applying it as a bonus on top of the penalties made it a close-run thing
    // that a never-spotlighted ordinary story could still win -- which is not
    // an editorial instruction being honoured, it is one being negotiated with.
    reasons.push("Editorially boosted: recent-exposure and repeat penalties waived.");
  } else {
    const since = candidate.lastSpotlightedAt
      ? Math.max(0, (now.getTime() - new Date(candidate.lastSpotlightedAt).getTime()) / MS_PER_DAY)
      : SPOTLIGHT_COOLDOWN_DAYS;
    if (since < SPOTLIGHT_COOLDOWN_DAYS) {
      // Linear decay to zero at the cool-down: yesterday's lead is heavily
      // penalised, a four-day-old appearance not at all.
      const penalty = RECENTLY_SPOTLIGHTED_PENALTY * (1 - since / SPOTLIGHT_COOLDOWN_DAYS);
      score -= penalty;
      reasons.push(
        `Spotlighted ${since < 1 ? "today or yesterday" : `${Math.floor(since)} days ago`} (-${penalty.toFixed(0)}).`
      );
    }
    const repeat = PER_APPEARANCE_PENALTY * candidate.spotlightCount;
    score -= repeat;
    reasons.push(
      `${candidate.spotlightCount} previous appearance${candidate.spotlightCount === 1 ? "" : "s"} (-${repeat}).`
    );
  }

  if (candidate.categorySlug && history.previousCategories.includes(candidate.categorySlug)) {
    score -= YESTERDAY_CATEGORY_PENALTY;
    reasons.push(
      `${candidate.categorySlug} was prominent in the previous rotation (-${YESTERDAY_CATEGORY_PENALTY}).`
    );
  }

  if (candidate.boosted) {
    score += OVERRIDE_MARGIN;
    reasons.push(`Editorially boosted (+${OVERRIDE_MARGIN}).`);
  }

  // A boost cannot rescue content the ranking considers weak — it waives the
  // ROTATION penalties, not the editorial judgement underneath them.

  // Media is a TIE-BREAKER and nothing more. Deliberately small: the front page
  // must not become an image contest in which a thin story with a beautiful
  // render outranks a genuinely important one.
  if (candidate.hasStrongMedia) {
    score += 5;
    reasons.push("Has a published, subject-appropriate image (+5).");
  }

  return { score, reasons };
}

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

/**
 * Choose one day's spotlight.
 *
 * Deterministic: same inputs, same output, always. Ties break on content id so
 * that even an exact score tie is stable across calls rather than depending on
 * input order.
 */
export function selectSpotlight(input: {
  candidates: readonly SpotlightCandidate[];
  now: Date;
  /** Supporting positions, excluding the lead. */
  supportingSlots: number;
  history?: SpotlightHistory;
}): SpotlightSelection {
  const history = input.history ?? { previousCategories: [], previousContentIds: [] };
  const rotationDate = input.now.toISOString().slice(0, 10);

  const excluded: { candidate: SpotlightCandidate; reason: string }[] = [];
  const scored: SpotlightSlot[] = [];

  for (const candidate of input.candidates) {
    const eligibility = isEligible(candidate, input.now);
    if (!eligibility.eligible) {
      excluded.push({ candidate, reason: eligibility.reason });
      continue;
    }
    const { score, reasons } = rotationScore(candidate, input.now, history);
    scored.push({ candidate, role: "supporting", score, reasons });
  }

  scored.sort(
    (a, b) => b.score - a.score || a.candidate.contentId.localeCompare(b.candidate.contentId)
  );

  // ---- lead ------------------------------------------------------------
  // A pin wins outright. Otherwise the top-scoring eligible item leads, and
  // because yesterday's lead carries the cool-down penalty it will normally
  // have given way — which is the requirement, without a special case for it.
  const pinnedLead = scored.find((s) => s.candidate.pinnedLead) ?? null;
  const lead = pinnedLead ?? scored[0] ?? null;
  if (lead) {
    lead.role = "lead";
    if (pinnedLead) lead.reasons.unshift("Pinned as the lead by an editorial override.");
  }

  // ---- supporting ------------------------------------------------------
  const supporting: SpotlightSlot[] = [];
  const perCategory = new Map<string, number>();
  if (lead?.candidate.categorySlug) perCategory.set(lead.candidate.categorySlug, 1);

  const pinnedSupporting = scored.filter(
    (s) => s.candidate.pinnedSupporting && s.candidate.contentId !== lead?.candidate.contentId
  );
  for (const slot of pinnedSupporting) {
    if (supporting.length >= input.supportingSlots) break;
    slot.reasons.unshift("Pinned to a supporting position by an editorial override.");
    supporting.push(slot);
    const cat = slot.candidate.categorySlug;
    if (cat) perCategory.set(cat, (perCategory.get(cat) ?? 0) + 1);
  }

  const taken = new Set<string>([
    ...(lead ? [lead.candidate.contentId] : []),
    ...supporting.map((s) => s.candidate.contentId),
  ]);

  for (const slot of scored) {
    if (supporting.length >= input.supportingSlots) break;
    if (taken.has(slot.candidate.contentId)) continue;

    const cat = slot.candidate.categorySlug;
    if (cat) {
      const used = perCategory.get(cat) ?? 0;
      if (used >= MAX_PER_CATEGORY) {
        // THE ESCAPE HATCH IS RELATIVE TO WHAT IT DISPLACES, not to the global
        // best. Comparing against the overall top score was useless: when one
        // category supplies the top nine stories, every one of them sits within
        // a point of the leader and so every one qualified as "dominant" —
        // the quota swallowed itself and gaming took all five positions.
        //
        // The real question is whether this story is so much stronger than the
        // best ALTERNATIVE that excluding it would be perverse.
        const bestAlternative = scored.find(
          (other) =>
            !taken.has(other.candidate.contentId) &&
            other.candidate.contentId !== slot.candidate.contentId &&
            (other.candidate.categorySlug ?? "") !== cat &&
            (perCategory.get(other.candidate.categorySlug ?? "") ?? 0) < MAX_PER_CATEGORY
        );
        if (bestAlternative && slot.score - bestAlternative.score < OVERRIDE_MARGIN) continue;
        slot.reasons.push(
          bestAlternative
            ? `${cat} already holds ${used} positions, but this outscores the best alternative by ` +
              `${(slot.score - bestAlternative.score).toFixed(0)}.`
            : `${cat} already holds ${used} positions, but no other category has eligible content.`
        );
      }
      perCategory.set(cat, used + 1);
    }
    taken.add(slot.candidate.contentId);
    supporting.push(slot);
  }

  const chosen = new Set([
    ...(lead ? [lead.candidate.contentId] : []),
    ...supporting.map((s) => s.candidate.contentId),
  ]);

  return {
    rotationDate,
    lead,
    supporting,
    nextUp: scored
      .filter((s) => !chosen.has(s.candidate.contentId))
      .slice(0, 8)
      .map((s) => s.candidate),
    excluded,
  };
}

/**
 * Did the rotation actually rotate?
 *
 * Used by tests and by the admin view. A rotation that returns the identical
 * set two days running is the failure this module exists to prevent, so it is
 * measurable rather than a matter of opinion.
 */
export function rotationOverlap(
  previous: readonly string[],
  current: readonly string[]
): { shared: number; changed: number; ratio: number } {
  const prev = new Set(previous);
  const shared = current.filter((id) => prev.has(id)).length;
  return {
    shared,
    changed: current.length - shared,
    ratio: current.length === 0 ? 0 : shared / current.length,
  };
}
