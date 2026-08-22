// CHAOS: the observation log.
//
// A proof record's `observed` field is required to be what ACTUALLY HAPPENED,
// with real values — `evaluateProof` in proofs.ts rejects a record whose
// observation is shorter than eleven characters precisely because "an assertion
// is not a proof". An assertion is also what you get if the person writing the
// record simply restates what the test asserted, so the harness emits the real
// numbers instead of anybody remembering them.
//
// Set CHAOS_EVIDENCE=1 to print the log. Off by default so `npm test` stays
// readable; the assertions run either way.

export type Observation = { proof: string; step: string; observed: string };

const log: Observation[] = [];

export function observe(proof: string, step: string, observed: string): void {
  log.push({ proof, step, observed });
  if (process.env.CHAOS_EVIDENCE) {
    console.log(`[CHAOS/${proof}] ${step}\n            ${observed}`);
  }
}

export function observations(proof?: string): Observation[] {
  return proof ? log.filter((o) => o.proof === proof) : [...log];
}
