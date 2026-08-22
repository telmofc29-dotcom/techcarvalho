// Daily rate limits and budgets for the Growth Engine.
//
// The scenario this exists for: a source starts republishing its entire back
// catalogue, or a dedupe key stops matching, and one unattended pass mints
// hundreds of pages. Nothing in the pipeline is wrong in that moment — every
// individual record is created correctly — which is exactly why a ceiling has
// to sit outside the pipeline's own judgement.
//
// Two layers, and both matter:
//
//   PER-PASS caps bound how much a single invocation can do. Several already
//   exist as `p_limit` arguments inside the RPCs; the values here mirror them so
//   the bound is stated in one readable place rather than being an argument
//   buried in a function call.
//
//   DAILY caps bound the total across every pass in a UTC day. This is the one
//   that actually stops a runaway, because a runaway is a series of individually
//   reasonable passes.
//
// Consequence worth stating plainly: a stage is gated on ENTRY, so a pass that
// begins under the daily cap may finish over it by at most one pass's worth.
// The worst-case daily total is therefore `daily + perPass`, not `daily`. That
// is a deliberate trade — the alternative is threading an allocator through
// every RPC call site — and it is bounded, small, and written down here rather
// than being a surprise.
//
// Pure and testable. The spend figures come from engine_job_runs, which the
// jobs already write.

import type { JobRunRecord } from "./health.ts";

export type BudgetKey =
  /** Drafts assembled from approved briefs — the closest thing to "a new page". */
  | "new_articles"
  /** Update proposals raised against existing pages. */
  | "updated_articles"
  /** Unpublished product shells. */
  | "new_products"
  /** Briefs proposed for human review. */
  | "new_briefs"
  /** Discovery candidates recorded. */
  | "new_discoveries"
  /** Media candidate proposals. */
  | "new_media_candidates"
  /** Money spent at external providers, in USD. */
  | "external_cost_usd";

export const BUDGET_KEYS: readonly BudgetKey[] = [
  "new_articles",
  "updated_articles",
  "new_products",
  "new_briefs",
  "new_discoveries",
  "new_media_candidates",
  "external_cost_usd",
];

/**
 * Daily ceilings (UTC day).
 *
 * These are editorial judgements, not schema facts, and they are set at the
 * scale a human review queue can actually absorb. A queue nobody can work
 * through is the same as no queue: the point of the engine is to propose work a
 * person will genuinely look at, not to maximise row count.
 *
 * external_cost_usd is 0 on purpose. No AI provider is enabled in this
 * codebase (src/lib/engine/ai-provider.ts is deliberately inert), so the honest
 * daily external spend is zero and any non-zero declared cost should be refused
 * until someone raises this on purpose.
 */
export const DAILY_BUDGETS: Readonly<Record<BudgetKey, number>> = {
  new_articles: 5,
  updated_articles: 25,
  new_products: 10,
  new_briefs: 15,
  new_discoveries: 300,
  new_media_candidates: 120,
  external_cost_usd: 0,
};

/** Per-invocation ceilings, mirroring the `p_limit` values the RPCs enforce. */
export const PER_PASS_BUDGETS: Readonly<Record<BudgetKey, number>> = {
  new_articles: 10,
  updated_articles: 30,
  new_products: 30,
  new_briefs: 15,
  new_discoveries: 100,
  new_media_candidates: 100,
  external_cost_usd: 0,
};

/**
 * Which job's `items_created` counts against which budget.
 *
 * engine_discover is counted even though a discovery is not a page: a runaway
 * shows up here first, one stage before it becomes briefs and two before it
 * becomes drafts, and stopping it at the earliest point is cheaper than
 * unpicking it later.
 */
export const JOB_BUDGET_KEYS: Readonly<Record<string, BudgetKey>> = {
  engine_draft_assembly: "new_articles",
  engine_update_proposals: "updated_articles",
  engine_product_assembly: "new_products",
  engine_briefs: "new_briefs",
  engine_discover: "new_discoveries",
  engine_media_acquisition: "new_media_candidates",
};

export type BudgetDecision = {
  key: BudgetKey;
  requested: number;
  /** How much of the request the budget permits. Zero means fully refused. */
  granted: number;
  spent: number;
  cap: number;
  remaining: number;
  exhausted: boolean;
  /** WHY, in words an admin can act on. */
  why: string;
};

/** Today's spend against every budget, derived from the audit log. */
export type BudgetLedger = Record<BudgetKey, number>;

export function emptyLedger(): BudgetLedger {
  return {
    new_articles: 0,
    updated_articles: 0,
    new_products: 0,
    new_briefs: 0,
    new_discoveries: 0,
    new_media_candidates: 0,
    external_cost_usd: 0,
  };
}

/**
 * Sum today's spend from engine_job_runs.
 *
 * Skipped runs are excluded (they created nothing by definition) and the day
 * boundary is UTC, matching how the rest of the engine buckets time.
 */
export function ledgerFromJobRuns(
  runs: readonly JobRunRecord[],
  opts: { now: Date; externalCostUsdToday?: number }
): BudgetLedger {
  const ledger = emptyLedger();
  const today = opts.now.toISOString().slice(0, 10);

  for (const run of runs) {
    if (run.status === "skipped") continue;
    if (run.startedAt.slice(0, 10) !== today) continue;
    const key = JOB_BUDGET_KEYS[run.jobName];
    if (!key) continue;
    ledger[key] += run.itemsCreated;
  }

  // No provider is enabled, so this is 0 unless a caller measured a real cost.
  // It is never estimated — an invented spend figure is as dishonest as an
  // invented review.
  ledger.external_cost_usd = opts.externalCostUsdToday ?? 0;
  return ledger;
}

/**
 * How much of `requested` may be spent, given what is already spent today.
 * Never returns more than the per-pass cap, and never returns a negative.
 */
export function checkBudget(
  key: BudgetKey,
  spent: number,
  requested: number,
  overrides?: { daily?: number; perPass?: number }
): BudgetDecision {
  const cap = overrides?.daily ?? DAILY_BUDGETS[key];
  const perPass = overrides?.perPass ?? PER_PASS_BUDGETS[key];
  const safeSpent = Math.max(0, spent);
  const safeRequested = Math.max(0, requested);
  const remaining = Math.max(0, cap - safeSpent);
  const granted = Math.min(safeRequested, remaining, perPass);

  if (cap === 0) {
    return {
      key,
      requested: safeRequested,
      granted: 0,
      spent: safeSpent,
      cap,
      remaining: 0,
      exhausted: true,
      why:
        `The daily budget for ${key} is 0, so nothing may be spent against it. This is a deliberate ` +
        `setting, not an exhausted allowance — raise DAILY_BUDGETS.${key} on purpose if it should be permitted.`,
    };
  }

  if (remaining === 0) {
    return {
      key,
      requested: safeRequested,
      granted: 0,
      spent: safeSpent,
      cap,
      remaining: 0,
      exhausted: true,
      why:
        `The daily budget for ${key} is exhausted: ${safeSpent} of ${cap} already spent today (UTC). ` +
        `Further work of this kind is refused until tomorrow. Nothing is lost — the inputs remain ` +
        `queued and are picked up on the next pass after the reset.`,
    };
  }

  if (granted < safeRequested) {
    return {
      key,
      requested: safeRequested,
      granted,
      spent: safeSpent,
      cap,
      remaining,
      exhausted: false,
      why:
        `Partially granted: ${granted} of ${safeRequested} requested for ${key}. ` +
        `${safeSpent} of the daily ${cap} is already spent and the per-pass ceiling is ${perPass}.`,
    };
  }

  return {
    key,
    requested: safeRequested,
    granted,
    spent: safeSpent,
    cap,
    remaining,
    exhausted: false,
    why: `Granted ${granted} for ${key}; ${safeSpent} of ${cap} spent today, ${remaining} remaining.`,
  };
}

/**
 * Should a stage be allowed to start at all?
 *
 * Coarse by design — see the header note about the bounded one-pass overshoot.
 * A stage with no budget key (a pure measurement stage) is always allowed.
 */
export function budgetGateForJob(
  job: string,
  ledger: BudgetLedger
): { allow: boolean; key: BudgetKey | null; why: string } {
  const key = JOB_BUDGET_KEYS[job];
  if (!key) {
    return {
      allow: true,
      key: null,
      why: `${job} creates no budgeted artefacts, so no daily cap applies to it.`,
    };
  }
  const decision = checkBudget(key, ledger[key], 1);
  return {
    allow: !decision.exhausted,
    key,
    why: decision.exhausted
      ? `${job} is halted: ${decision.why}`
      : `${job} may run: ${decision.why}`,
  };
}

/**
 * A stateful allocator for a single pass, for callers that draw down a budget
 * item by item. Deterministic: the same sequence of `take` calls against the
 * same starting ledger always produces the same grants.
 */
export type BudgetAllocator = {
  take(key: BudgetKey, amount?: number): BudgetDecision;
  spent(key: BudgetKey): number;
  ledger(): BudgetLedger;
  /** Everything refused during this pass, for the job's detail payload. */
  refusals(): readonly BudgetDecision[];
};

export function createBudgetAllocator(starting: BudgetLedger): BudgetAllocator {
  const ledger: BudgetLedger = { ...starting };
  const perPassSpent = emptyLedger();
  const refusals: BudgetDecision[] = [];

  return {
    take(key, amount = 1) {
      const perPassRemaining = Math.max(0, PER_PASS_BUDGETS[key] - perPassSpent[key]);
      const decision = checkBudget(key, ledger[key], amount, { perPass: perPassRemaining });
      if (decision.granted > 0) {
        ledger[key] += decision.granted;
        perPassSpent[key] += decision.granted;
      }
      if (decision.granted < decision.requested) refusals.push(decision);
      return decision;
    },
    spent(key) {
      return ledger[key];
    },
    ledger() {
      return { ...ledger };
    },
    refusals() {
      return refusals;
    },
  };
}

/** Human-readable state of every budget, for the job run detail payload. */
export function describeBudgets(ledger: BudgetLedger): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of BUDGET_KEYS) {
    out[key] = `${ledger[key]}/${DAILY_BUDGETS[key]} used today`;
  }
  return out;
}
