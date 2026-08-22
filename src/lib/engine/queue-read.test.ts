import { test } from "node:test";
import assert from "node:assert/strict";
import {
  concludeQueueRead,
  controlRead,
  filteredQueue,
  inputProbeFor,
  livenessStrength,
  NO_LIVENESS,
  rpcQueue,
  type QueueReadFacts,
} from "./queue-read.ts";

// The rules that separate "the queue was empty" from "we were not allowed to
// look". Every one of these is decidable from plain values, which is what makes
// the historical incident reconstructable rather than merely described.

// ---------------------------------------------------------------------------
// The one-way door: zero rows never reaches NOTHING_TO_DO on its own
// ---------------------------------------------------------------------------

test("THE 2026-08 SHAPE: zero rows, no error, no corroboration -> UNCLASSIFIED and status FAILED", () => {
  // `{ data: [], error: null }` from a read the caller was not permitted to
  // make. Byte-identical to an empty queue. Every job in this repo turned it
  // into `status: success, examined: 0` and nothing anywhere differed from the
  // run of a healthy engine on a quiet night.
  const outcome = concludeQueueRead({
    stage: "engine_draft_assembly",
    reason: "no_approved_briefs",
    facts: rpcQueue({
      source: "engine_assemblable_briefs",
      errored: false,
      rowsReturned: 0,
      eligible: 0,
      liveness: NO_LIVENESS,
    }),
  });

  assert.equal(outcome.verdict.outcome, "UNCLASSIFIED");
  assert.equal(outcome.verdict.ambiguity, "emptiness_unproven");
  assert.equal(outcome.status, "failed", "an unproven empty queue must not record success");
  assert.ok(outcome.error, "the run must carry an error string so has_error is set");
  assert.match(outcome.error, /UNCLASSIFIED/);
  // The job's own reason survives, so nothing an operator used to read is lost.
  assert.equal(outcome.detail.reason, "no_approved_briefs");
});

test("an errored read proves nothing, and says so in its own words", () => {
  const probe = inputProbeFor(
    rpcQueue({
      source: "engine_freshness_candidates",
      errored: true,
      rowsReturned: null,
      eligible: 0,
      liveness: controlRead("engine_reference_data", 40),
    })
  );
  assert.equal(probe.proof, "none");
  assert.match(probe.corroboration ?? "", /prove nothing/);
});

test("an EMPTY corroborator corroborates nothing — the failure is not allowed one level up", () => {
  // The tempting shortcut: "we did a control read, therefore the reader is
  // alive". If the control read itself came back empty, it is exactly as
  // ambiguous as the queue read, and treating it as reassurance reproduces the
  // bug in the corroborator instead of the queue.
  const facts = rpcQueue({
    source: "engine_briefable_discoveries",
    errored: false,
    rowsReturned: 0,
    eligible: 0,
    liveness: controlRead("engine_reference_data", 0),
  });
  assert.equal(livenessStrength("security_definer_rpc", facts.liveness), "none");
  const probe = inputProbeFor(facts);
  assert.equal(probe.proof, "zero_rows_only");
  assert.match(probe.corroboration ?? "", /corroborates nothing/);

  const outcome = concludeQueueRead({ stage: "engine_briefs", facts });
  assert.equal(outcome.status, "failed");
});

// ---------------------------------------------------------------------------
// The three forms of liveness, and what each actually rules out
// ---------------------------------------------------------------------------

test("SAME-READ FILTERING is object-specific proof and earns NOTHING_TO_DO", () => {
  // engine_existing_entities returned 81 rows; application code filtered them to
  // zero published. Rows came OUT of the read, so the read was not denied — same
  // statement, same grant, same policy. This is the strongest form available.
  const facts = filteredQueue({
    source: "engine_existing_entities",
    errored: false,
    rowsReturned: 81,
    eligible: 0,
  });
  assert.equal(livenessStrength("security_definer_rpc", facts.liveness), "object_specific");

  const outcome = concludeQueueRead({ stage: "engine_internal_links", facts });
  assert.equal(outcome.verdict.outcome, "NOTHING_TO_DO");
  assert.equal(outcome.status, "success");
  assert.equal(outcome.error, null);
  assert.match(outcome.detail.stageOutcomeWhy as string, /provably alive/);
});

test("same-read filtering with ZERO rows returned is not proof of anything", () => {
  // The degenerate case, and the one a careless implementation gets wrong:
  // "rowsReturned >= eligible" is trivially true at 0 >= 0.
  const facts = filteredQueue({
    source: "engine_existing_entities",
    errored: false,
    rowsReturned: 0,
    eligible: 0,
  });
  assert.equal(livenessStrength("security_definer_rpc", facts.liveness), "none");
  assert.equal(concludeQueueRead({ stage: "engine_internal_links", facts }).status, "failed");
});

test("a CONTROL READ is sufficient for an RPC queue and NOT for a table SELECT", () => {
  // The asymmetry is the whole argument, and it is about how each kind of
  // denial ARRIVES:
  //
  //   * Revoking EXECUTE on a function makes PostgREST answer PGRST202 — an
  //     error, which the job already treats as a failure. So a call that
  //     SUCCEEDED is itself evidence about that specific object, and the control
  //     read supplies what is left (the role is not blanket-denied).
  //   * An RLS policy denies one TABLE by returning zero rows and no error. A
  //     control read of a different object says nothing whatsoever about it.
  const shared = { errored: false, rowsReturned: 0, eligible: 0, liveness: controlRead("engine_reference_data", 40) };

  const asRpc: QueueReadFacts = { ...shared, source: "engine_assemblable_briefs", kind: "security_definer_rpc" };
  const asTable: QueueReadFacts = { ...shared, source: "content_products", kind: "rls_table_select" };

  assert.equal(livenessStrength("security_definer_rpc", shared.liveness), "blanket_only");
  assert.equal(livenessStrength("rls_table_select", shared.liveness), "none");

  assert.equal(inputProbeFor(asRpc).proof, "reader_alive");
  assert.equal(inputProbeFor(asTable).proof, "zero_rows_only");

  assert.equal(concludeQueueRead({ stage: "a", facts: asRpc }).status, "success");
  assert.equal(concludeQueueRead({ stage: "b", facts: asTable }).status, "failed");
});

test("a control read's corroboration text states what it does NOT establish", () => {
  // The honesty requirement. `blanket_only` means the 2026-08 shape is excluded
  // and a defect inside the queue function's own body is not, and the record has
  // to say that rather than implying more.
  const probe = inputProbeFor(
    rpcQueue({
      source: "engine_assemblable_briefs",
      errored: false,
      rowsReturned: 0,
      eligible: 0,
      liveness: controlRead("engine_reference_data", 40),
    })
  );
  assert.match(probe.corroboration ?? "", /does not exclude a defect inside/);
  assert.match(probe.corroboration ?? "", /PGRST202/);
});

test("deniableUnderRls is TRUE for every engine read — liveness is earned, never declared", () => {
  // The single edit that would turn this whole module back into a rubber stamp
  // is a call site setting deniableUnderRls: false. It is not a per-call-site
  // choice: engine jobs run as anon, so every read they make is one RLS could
  // deny, and the LIVENESS evidence has to be produced.
  for (const kind of ["security_definer_rpc", "rls_table_select"] as const) {
    for (const liveness of [NO_LIVENESS, controlRead("x", 5), { form: "same_read_filtered" as const, rowsReturned: 3 }]) {
      const probe = inputProbeFor({
        source: "s",
        kind,
        errored: false,
        rowsReturned: 3,
        eligible: 0,
        liveness,
      });
      assert.equal(probe.deniableUnderRls, true);
    }
  }
});

// ---------------------------------------------------------------------------
// Work that was available and not picked up is a different fault again
// ---------------------------------------------------------------------------

test("eligible rows that were never examined is UNCLASSIFIED, not NOTHING_TO_DO", () => {
  const outcome = concludeQueueRead({
    stage: "engine_relevance",
    facts: rpcQueue({
      source: "engine_unclassified_discoveries",
      errored: false,
      rowsReturned: 12,
      eligible: 12,
      liveness: { form: "same_read_filtered", rowsReturned: 12 },
    }),
    counters: { examined: 0 },
  });
  assert.equal(outcome.verdict.outcome, "UNCLASSIFIED");
  assert.equal(outcome.verdict.ambiguity, "unaccounted_items");
  assert.equal(outcome.status, "failed");
});

// ---------------------------------------------------------------------------
// The detail payload carries enough to act on
// ---------------------------------------------------------------------------

test("the recorded detail names the read, the proof and the strength — not just a verdict", () => {
  const outcome = concludeQueueRead({
    stage: "engine_product_assembly",
    reason: "no_manufacturer_records",
    facts: rpcQueue({
      source: "engine_reference_data",
      errored: false,
      rowsReturned: 0,
      eligible: 0,
      liveness: NO_LIVENESS,
    }),
  });
  const probe = outcome.detail.inputProbe as Record<string, unknown>;
  assert.equal(probe.source, "engine_reference_data");
  assert.equal(probe.kind, "security_definer_rpc");
  assert.equal(probe.proof, "zero_rows_only");
  assert.equal(probe.livenessStrength, "none");
  assert.ok(typeof probe.corroboration === "string" && probe.corroboration.length > 40);

  // And an incident, with somewhere to start.
  const incident = outcome.detail.incident as Record<string, unknown>;
  assert.equal(incident.severity, "critical");
  assert.ok(Array.isArray(incident.whereToLook) && incident.whereToLook.length > 0);
});
