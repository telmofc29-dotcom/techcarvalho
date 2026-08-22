// Loads the recorded proof executions.
//
// The records live in data/engine/proof-records.ts, checked into the
// repository, NOT in the database. That is deliberate and it is the whole
// security argument for the readiness dashboard:
//
//   * A proof asserts that the system was deliberately broken and behaved
//     correctly. If it lived in a table, the admin UI could write it, and
//     "AUTONOMOUS MODE: LOCKED" would become a value somebody could edit.
//   * In the repository, changing one requires a commit — reviewable,
//     attributable, reversible, and unreachable from any browser request.
//
// This module is READ-ONLY by construction. There is no writer here, and
// adding one would defeat the point.

import { PROOF_RECORDS } from "../../../data/engine/proof-records.ts";
import { PROOF_KINDS, type ProofKind, type ProofLevel, type ProofRecord } from "./proofs.ts";

const VALID_KINDS = new Set<string>(PROOF_KINDS);
const VALID_LEVELS = new Set<ProofLevel>([
  "code_exists", "unit_tested", "integration_proven", "chaos_proven", "production_proven",
]);

type RawRecord = {
  kind?: unknown; level?: unknown; observedAt?: unknown; commit?: unknown;
  method?: unknown; observed?: unknown; passed?: unknown;
};

/**
 * The recorded proofs, with anything malformed DISCARDED rather than coerced.
 *
 * A record with an unrecognised kind or level is dropped, not guessed at: the
 * safe reading of "this record does not parse" is that the proof was not
 * obtained. Dropping it keeps the capability NOT_PROVEN, which is the correct
 * direction to fail.
 */
export function loadProofRecords(): ProofRecord[] {
  const raw = PROOF_RECORDS as unknown as RawRecord[];
  const out: ProofRecord[] = [];

  for (const r of raw) {
    if (typeof r.kind !== "string" || !VALID_KINDS.has(r.kind)) continue;
    if (typeof r.level !== "string" || !VALID_LEVELS.has(r.level as ProofLevel)) continue;
    if (typeof r.observedAt !== "string" || Number.isNaN(Date.parse(r.observedAt))) continue;
    if (typeof r.method !== "string" || typeof r.observed !== "string") continue;
    // `passed` must be an explicit true. Missing or truthy-ish is not a pass.
    if (r.passed !== true && r.passed !== false) continue;

    out.push({
      kind: r.kind as ProofKind,
      level: r.level as ProofLevel,
      observedAt: r.observedAt,
      commit: typeof r.commit === "string" ? r.commit : null,
      method: r.method,
      observed: r.observed,
      passed: r.passed,
    });
  }
  return out;
}
