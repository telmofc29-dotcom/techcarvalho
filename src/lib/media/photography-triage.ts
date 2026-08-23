// Turning the shooting list into a screen somebody can chip away at.
//
// WHY THIS EXISTS AND WHAT IT REFUSES TO BE
// -----------------------------------------
// photo-requests.ts already ranks products by how many pages a photograph would
// improve. That ranking is correct and this file does NOT redo it, reweight it,
// or second-guess it — there is exactly one ranking in this codebase and it
// lives there.
//
// What this file adds is the triage question, which is different: of the ranked
// list, which rows can a person resolve RIGHT NOW with one click? Those are the
// rows nobody has assessed. Every 'unknown' is a fork in the road — one answer
// creates a real shooting task, the other deletes a phantom one — and until it
// is answered the whole list below it is partly fiction.
//
// So orderForTriage() PARTITIONS the ranked list; it does not re-sort within
// each part. Array.prototype.sort has been required to be stable since ES2019,
// so sorting on the group key alone provably preserves photo-requests.ts's
// ordering inside each group: unassessed rows arrive already ordered by pages
// improved, which is exactly "the unassessed product whose answer matters most,
// first".
//
// AND THE COUNTING RULE
// ---------------------
// 'unknown' means NOBODY HAS ASSESSED IT. isShootable() returns true for it on
// purpose — an unassessed product still belongs in the backlog rather than
// being buried. But a HEADLINE TOTAL is a claim about the world, and
// "44 shootable" when nobody has looked at a single one would be a fabricated
// measurement of exactly the kind this project has shipped before. So
// summariseAssessment() counts only assessed states as confirmed, and reports
// the unassessed count as its own number rather than folding it into either
// side.
//
// Pure. No I/O.

import type { OwnerAccess } from "./resolution.ts";

/**
 * The five states, in the order the CHECK constraint on
 * public.products.owner_access accepts them (see
 * supabase/migrations/20260825_product_owner_access.sql). The database is the
 * source of truth; this array exists so a Server Action can reject anything
 * else BEFORE the round-trip rather than relying on a 23514 to come back.
 */
export const OWNER_ACCESS_VALUES = [
  "owned",
  "borrowable",
  "retail_display",
  "not_accessible",
  "unknown",
] as const satisfies readonly OwnerAccess[];

/** Narrowing guard for untrusted input (form fields, query strings). */
export function isOwnerAccess(value: unknown): value is OwnerAccess {
  return typeof value === "string" && (OWNER_ACCESS_VALUES as readonly string[]).includes(value);
}

/** True only for a state a person has actually recorded. */
export function isAssessed(access: OwnerAccess): boolean {
  return access !== "unknown";
}

/**
 * True when the object has been assessed AND the assessment says a camera can
 * reach it. Deliberately NOT the same predicate as isShootable() in
 * resolution.ts, which answers "should this stay in the backlog" and therefore
 * says yes to 'unknown'. This one answers "do we know we can shoot it", which
 * an unassessed product cannot satisfy.
 */
export function isConfirmedShootable(access: OwnerAccess): boolean {
  return access === "owned" || access === "borrowable" || access === "retail_display";
}

function triageGroup(access: OwnerAccess): number {
  return access === "unknown" ? 0 : 1;
}

/**
 * Unassessed rows first, everything else after, each group keeping the order
 * photo-requests.ts gave it.
 *
 * Generic over the row shape so it can order either raw PhotoRequests or the
 * enriched rows the admin page renders, without either side importing the
 * other's type.
 */
export function orderForTriage<T extends { ownerAccess: OwnerAccess }>(ranked: readonly T[]): T[] {
  return [...ranked].sort((a, b) => triageGroup(a.ownerAccess) - triageGroup(b.ownerAccess));
}

export type AssessmentTotals = {
  /** Every product considered, assessed or not. */
  products: number;
  assessed: number;
  unassessed: number;
  /** Assessed AND reachable — see isConfirmedShootable. Never includes 'unknown'. */
  confirmedShootable: number;
  /** Assessed as out of reach. A camera will not fix these; a licence or an illustration will. */
  notAccessible: number;
  byAccess: Record<OwnerAccess, number>;
  /**
   * False when nothing has been assessed at all.
   *
   * The page uses this to decide whether to draw a progress indicator. A 0%
   * bar asserts that a process is underway and merely early; with 44 of 44
   * untouched, no process is underway, and saying so plainly is the honest
   * rendering.
   */
  hasProgress: boolean;
};

export function summariseAssessment(accesses: readonly OwnerAccess[]): AssessmentTotals {
  const byAccess: Record<OwnerAccess, number> = {
    owned: 0,
    borrowable: 0,
    retail_display: 0,
    not_accessible: 0,
    unknown: 0,
  };
  for (const access of accesses) byAccess[access]++;

  const assessed = accesses.filter(isAssessed).length;

  return {
    products: accesses.length,
    assessed,
    unassessed: byAccess.unknown,
    confirmedShootable: accesses.filter(isConfirmedShootable).length,
    notAccessible: byAccess.not_accessible,
    byAccess,
    hasProgress: assessed > 0,
  };
}

/**
 * One sentence stating where the assessment actually stands.
 *
 * The nothing-assessed case gets its own wording on purpose: "0 of 44 assessed"
 * reads like a metric ticking upward, whereas the truth is that this column has
 * never been touched and every downstream number that depends on it is
 * currently a default rather than a finding.
 */
export function assessmentHeadline(totals: AssessmentTotals): string {
  if (totals.products === 0) {
    return "No products in the catalogue to assess.";
  }
  if (!totals.hasProgress) {
    return (
      `Nobody has assessed any of the ${totals.products} products yet. Every one is recorded as ` +
      `"not assessed", which means no one has looked — not that it cannot be photographed. ` +
      `Marking one is a single click and either creates a real shooting task or removes a phantom one.`
    );
  }
  return (
    `${totals.assessed} of ${totals.products} assessed — ` +
    `${totals.confirmedShootable} confirmed reachable, ` +
    `${totals.notAccessible} out of reach, ` +
    `${totals.unassessed} still untouched.`
  );
}
