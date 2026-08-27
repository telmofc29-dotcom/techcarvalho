// IS THIS STORY ACCELERATING, OR IS IT ONE FEED ITEM SITTING STILL?
//
// WHAT THE EXISTING RANKING CANNOT SEE
// ------------------------------------
// opportunity-score.ts ranks a development on what is known about it NOW:
// significance, confirmation, entity priority, freshness, evidence, coverage
// gap. Every one of those is a snapshot. Two opportunities with three
// independent origins each score identically — even when one collected all
// three overnight and the other has been sitting on the same three for a
// fortnight.
//
// That difference is the whole of breaking-news judgement, and it is invisible
// to a snapshot. This module adds the missing dimension: CHANGE OVER TIME.
//
// IT DOES NOT REPLACE THE RANKING. Momentum is a separate axis. The score still
// decides how important a development is; momentum decides how urgently it is
// moving. Owner Today needs both, and conflating them would mean a big slow
// story and a small fast one became indistinguishable.
//
// SIGNALS THIS SITE ACTUALLY HAS
// ------------------------------
// Every input below comes from engine_discoveries and engine_opportunities:
// when each independent origin was first seen, whether any of them is the
// subject's own domain, how significant the development is, whether we already
// cover it. Nothing here reads a trend line, a search volume, a share count or
// a traffic number, because TechCarvalho has none of those and inventing them
// would be fabricating evidence.
//
// FAMOUS IS NOT THE SAME AS MOVING
// --------------------------------
// Entity priority is deliberately absent from the state machine. A Tier 1 name
// cannot make a story accelerate; only new corroboration can. Apple posting a
// discount is a Tier 1 entity with no momentum, and a Canon launch nobody has
// picked up yet is a Tier 2 entity with real momentum. Tier is used to ORDER
// stories that are already moving, never to decide that one is.
//
// Pure. No I/O.

/** How a development is behaving, on this site's own evidence. */
export type MomentumState =
  /** Recent, real, and not yet corroborated. Worth watching. */
  | "EMERGING"
  /** New independent origins are still arriving. */
  | "ACCELERATING"
  /** Accelerating AND significant AND corroborated. The front of the queue. */
  | "MAJOR"
  /** Real and established, but nothing new is arriving. */
  | "STABLE"
  /** Old, and no new corroboration since. */
  | "STALE";

/** One sighting of the development, from a named independent origin. */
export type OriginSighting = {
  /** Registrable domain or source id. Two sightings from one origin count once. */
  origin: string;
  /** When this origin was FIRST seen carrying it. */
  firstSeen: Date;
  /** True when the origin is the subject's own domain. */
  firstParty?: boolean;
};

export type MomentumInput = {
  sightings: readonly OriginSighting[];
  /** From classifySignificance(). A launch behaves differently from a price cut. */
  significant: boolean;
  /** True when this site has no page covering it. */
  coverageGap: boolean;
  /** Days until a known launch, when there is one. */
  daysToLaunch?: number;
  now: Date;
};

export type MomentumAssessment = {
  state: MomentumState;
  /** Distinct independent origins. */
  origins: number;
  /** Origins that first appeared inside the acceleration window. */
  newOrigins: number;
  /** Days since the FIRST origin was seen. */
  ageDays: number;
  /** Days since the most recent NEW origin. */
  daysSinceLastOrigin: number;
  firstParty: boolean;
  /** Ordered, human-readable. First entry is the primary reason. */
  reasons: string[];
};

/**
 * How recently a new origin must have appeared for a story to count as moving.
 *
 * Three days, because the engine's own tick cadence means an origin discovered
 * today may not be the last: a window shorter than a couple of runs would call
 * a story stale between polls rather than because it stopped.
 */
export const ACCELERATION_WINDOW_DAYS = 3;

/** Beyond this with no new origin, a development has stopped developing. */
export const STALE_AFTER_DAYS = 21;

/** Corroboration floor. One origin is a report; two is a story. */
export const CORROBORATED_ORIGINS = 2;

const dayDiff = (a: Date, b: Date): number => (a.getTime() - b.getTime()) / 86_400_000;

/**
 * Assess how a development is moving.
 *
 * ORDER OF THE CHECKS MATTERS. Staleness is decided first, because a story that
 * stopped a month ago is stale whatever else is true of it, and reporting it as
 * MAJOR because it is significant would put a dead story at the top of the
 * queue — the exact failure the freshness rules exist to prevent.
 */
export function assessMomentum(input: MomentumInput): MomentumAssessment {
  // Distinct origins only. Five articles from one outlet are one origin, which
  // is the difference between corroboration and syndication.
  const byOrigin = new Map<string, OriginSighting>();
  for (const s of input.sightings) {
    const existing = byOrigin.get(s.origin);
    if (!existing || s.firstSeen < existing.firstSeen) byOrigin.set(s.origin, s);
  }
  const distinct = [...byOrigin.values()].sort((a, b) => a.firstSeen.getTime() - b.firstSeen.getTime());
  const origins = distinct.length;
  const firstParty = distinct.some((s) => s.firstParty === true);

  if (origins === 0) {
    return {
      state: "STALE",
      origins: 0,
      newOrigins: 0,
      ageDays: 0,
      daysSinceLastOrigin: 0,
      firstParty: false,
      reasons: ["No independent origin has been recorded for this development."],
    };
  }

  const ageDays = dayDiff(input.now, distinct[0].firstSeen);
  const daysSinceLastOrigin = dayDiff(input.now, distinct[distinct.length - 1].firstSeen);
  const newOrigins = distinct.filter((s) => dayDiff(input.now, s.firstSeen) <= ACCELERATION_WINDOW_DAYS).length;
  const reasons: string[] = [];

  const describe = () =>
    `${origins} independent origin${origins === 1 ? "" : "s"}, first seen ${Math.floor(ageDays)} day${Math.floor(ageDays) === 1 ? "" : "s"} ago` +
    (firstParty ? ", including the subject's own domain" : "");

  // ---- 1. has it stopped? ----------------------------------------------
  if (daysSinceLastOrigin > STALE_AFTER_DAYS) {
    reasons.push(
      `No new independent origin for ${Math.floor(daysSinceLastOrigin)} days. The development has stopped developing.`
    );
    reasons.push(describe());
    return { state: "STALE", origins, newOrigins, ageDays, daysSinceLastOrigin, firstParty, reasons };
  }

  // ---- 2. is it still gathering corroboration? -------------------------
  //
  // The one signal a snapshot cannot produce: origins arriving NOW. A story
  // that had two origins yesterday and four today is behaving differently from
  // one that has had four for a fortnight, and only this can tell them apart.
  const accelerating = newOrigins >= 2 || (newOrigins >= 1 && origins >= CORROBORATED_ORIGINS && ageDays > ACCELERATION_WINDOW_DAYS);

  if (accelerating) {
    reasons.push(
      `${newOrigins} new independent origin${newOrigins === 1 ? "" : "s"} in the last ` +
        `${ACCELERATION_WINDOW_DAYS} days — corroboration is still arriving.`
    );
    reasons.push(describe());

    // MAJOR is ACCELERATING plus weight. Significance and corroboration are
    // both required: a fast-moving trivial story is still trivial, and a
    // significant story with one source is still one source.
    if (input.significant && origins >= CORROBORATED_ORIGINS && (firstParty || origins >= 3)) {
      reasons.unshift(
        "Significant development, corroborated" +
          (firstParty ? " by the subject itself" : ` across ${origins} independent origins`) +
          ", and still gathering sources."
      );
      if (input.coverageGap) reasons.push("TechCarvalho has no page covering it.");
      return { state: "MAJOR", origins, newOrigins, ageDays, daysSinceLastOrigin, firstParty, reasons };
    }
    if (input.coverageGap) reasons.push("TechCarvalho has no page covering it.");
    return { state: "ACCELERATING", origins, newOrigins, ageDays, daysSinceLastOrigin, firstParty, reasons };
  }

  // ---- 3. new, but not yet corroborated --------------------------------
  if (origins < CORROBORATED_ORIGINS && ageDays <= ACCELERATION_WINDOW_DAYS * 2) {
    reasons.push(
      `A single origin, ${Math.floor(ageDays)} day${Math.floor(ageDays) === 1 ? "" : "s"} old. ` +
        "Worth watching, not yet corroborated."
    );
    return { state: "EMERGING", origins, newOrigins, ageDays, daysSinceLastOrigin, firstParty, reasons };
  }

  // ---- 4. established, not moving --------------------------------------
  reasons.push(
    `No new origin in ${Math.floor(daysSinceLastOrigin)} day${Math.floor(daysSinceLastOrigin) === 1 ? "" : "s"}; ` +
      "the story is established rather than breaking."
  );
  reasons.push(describe());
  if (input.daysToLaunch !== undefined && input.daysToLaunch >= 0 && input.daysToLaunch <= 14) {
    reasons.push(`A launch is ${input.daysToLaunch} day${input.daysToLaunch === 1 ? "" : "s"} away, so this will move again.`);
  }
  return { state: "STABLE", origins, newOrigins, ageDays, daysSinceLastOrigin, firstParty, reasons };
}

/** Queue order within Owner Today. Higher comes first. */
export const MOMENTUM_RANK: Record<MomentumState, number> = {
  MAJOR: 4,
  ACCELERATING: 3,
  EMERGING: 2,
  STABLE: 1,
  STALE: 0,
};

/**
 * Order stories for display.
 *
 * Momentum first, then the existing opportunity score, then entity tier as the
 * LAST tiebreak. That ordering is the point: a Tier 1 name can separate two
 * stories that are otherwise equal and can never lift a still story above a
 * moving one.
 */
export function compareForQueue(
  a: { momentum: MomentumState; score: number; entityTier: number | null },
  b: { momentum: MomentumState; score: number; entityTier: number | null }
): number {
  const byMomentum = MOMENTUM_RANK[b.momentum] - MOMENTUM_RANK[a.momentum];
  if (byMomentum !== 0) return byMomentum;
  if (b.score !== a.score) return b.score - a.score;
  return (a.entityTier ?? 9) - (b.entityTier ?? 9);
}
