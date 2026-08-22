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
];
