// Recorded executions of the autonomy failure proofs.
//
// WHY THIS IS A FILE IN THE REPOSITORY AND NOT A DATABASE TABLE
// -------------------------------------------------------------
// A proof is a claim that the system was deliberately broken and behaved
// correctly. If that claim lived in a table, the admin UI could write it, and
// "AUTONOMOUS MODE: LOCKED" would become a value somebody could edit. Here,
// changing a proof requires a commit — reviewable, attributable, reversible,
// and unreachable from any browser request.
//
// It is a TypeScript module rather than JSON so the shape is type-checked: a
// malformed record fails the build instead of being silently discarded.
//
// Each record must state what was actually DONE and what was actually
// OBSERVED. src/lib/engine/proofs.ts rejects records with no method or
// observation, records that FAILED, records below the level their kind
// requires, and records older than 30 days — because a proof about code from
// 200 commits ago is not a proof about this code.
//
// DO NOT add a record for something that was not run.

import type { ProofRecord } from "@/lib/engine/proofs";

export const PROOF_RECORDS: ProofRecord[] = [
  {
    kind: "concurrency_test",
    level: "production_proven",
    observedAt: "2026-08-22T00:00:00.000Z",
    commit: "b03e2a4",
    method:
      "Called engine_begin_run twice against the PRODUCTION database with the same job name and the same idempotency key, back to back, as anon — the exact shape of a double scheduler invocation. Then called engine_complete_run on the acquired lease and removed the probe rows.",
    observed:
      "The first call returned 'acquired:625625e8-7e27-4e6a-a488-92dfed247178'. The second returned 'already_running' rather than a second lease, so a duplicate invocation cannot execute the same pass twice. engine_complete_run then returned 'completed', and returned 'not_running' for a lease that was never acquired.",
    passed: true,
  },
  {
    kind: "duplicate_scheduler_test",
    level: "production_proven",
    observedAt: "2026-08-22T00:00:00.000Z",
    commit: "4b4bf86",
    method:
      "Ran scripts/verify-anon-surface-migration.ts against the PRODUCTION database as anon, using the publishable key only. It rebuilds the idempotency key with the same bucket arithmetic as idempotencyKeyFor() (5-minute buckets), acquires the lease for the current window, completes it, then immediately re-attempts the same window — the exact shape of two schedulers firing into one window. It also attempted the previously-successful shutdown attack: leasing a window in 2027, leasing one in 2020, a malformed key, and a key naming a different job than the one being started. Probe rows used the job name 'engine_security_probe', never 'engine_tick', and were deleted afterwards with the remaining count re-checked as 0.",
    observed:
      "Current window: 'acquired:119f4c52-46d8-4b43-953a-21129d07cf45', then 'completed', then 'already_running' for the second worker — so a duplicate scheduler cannot run the same window twice, and the guarantee survived the security migration. All four attack shapes were refused: the 2027 and 2020 windows both returned 'rejected_window' (before 20260823_engine_rpc_anon_surface.sql the 2027 case returned a real lease, which could then be frozen as 'success' and never reaped, silently disabling the engine forever), and the malformed key and the mismatched job name both returned 'rejected_invalid'. 19/19 checks passed, cleanup verified 0 leftover rows.",
    passed: true,
  },
];
