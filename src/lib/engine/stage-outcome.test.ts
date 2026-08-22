import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ALWAYS_INCIDENT,
  AMBIGUITY_MEANINGS,
  classifyStageOutcome,
  countersOf,
  detectUniformity,
  errorFamily,
  fromSearchOutcomeState,
  hasBlockingIncident,
  incidentAsFinding,
  incidentFor,
  incidentsFor,
  isBenign,
  isEngineFault,
  STAGE_OUTCOME_CLASSES,
  STAGE_OUTCOME_HEADLINES,
  STAGE_OUTCOME_MEANINGS,
  UNIFORM_OUTCOME_MIN_ITEMS,
  type ItemOutcome,
  type StageEvidence,
  type StageVerdictClass,
} from "./stage-outcome.ts";
import { summarisePostconditions, type PostconditionResult } from "./postconditions.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function evidence(p: Partial<StageEvidence> & { stage: string }): StageEvidence {
  return { counters: countersOf({}), ...p };
}

/** A postcondition summary built from real PostconditionResults, not a literal. */
function summaryOf(results: Partial<PostconditionResult>[]) {
  return summarisePostconditions(
    results.map((r) => ({
      operation: r.operation ?? "op",
      status: r.status ?? "verified",
      ok: r.ok ?? true,
      expectation: r.expectation ?? "something",
      detail: r.detail ?? "detail",
      data: r.data ?? null,
      error: r.error ?? null,
      subject: r.subject,
    }))
  );
}

function items(n: number, p: Partial<ItemOutcome> = {}): ItemOutcome[] {
  return Array.from({ length: n }, (_, i) => ({
    disposition: p.disposition ?? "rejected",
    reasonCode: p.reasonCode ?? "some_reason",
    derivedFromParsing: p.derivedFromParsing,
    subject: p.subject ?? `item-${i}`,
  }));
}

// ---------------------------------------------------------------------------
// The taxonomy itself
// ---------------------------------------------------------------------------

test("the taxonomy has exactly the ten declared classes, all mutually exclusive by name", () => {
  assert.equal(STAGE_OUTCOME_CLASSES.length, 10);
  assert.equal(new Set(STAGE_OUTCOME_CLASSES).size, 10);
  for (const cls of STAGE_OUTCOME_CLASSES) {
    assert.ok(STAGE_OUTCOME_MEANINGS[cls].length > 40, `${cls} needs a real meaning`);
    assert.ok(STAGE_OUTCOME_HEADLINES[cls].length > 0);
  }
});

test("UNCLASSIFIED is NOT one of the ten — it is the classifier declining to invent one", () => {
  assert.equal((STAGE_OUTCOME_CLASSES as readonly string[]).includes("UNCLASSIFIED"), false);
  assert.ok(STAGE_OUTCOME_MEANINGS.UNCLASSIFIED.includes("TREATED AS A PROBLEM"));
  assert.equal(isEngineFault("UNCLASSIFIED"), true);
  assert.equal(isBenign("UNCLASSIFIED"), false);
});

test("every class is either benign or an engine fault, and never both", () => {
  const all: StageVerdictClass[] = [...STAGE_OUTCOME_CLASSES, "UNCLASSIFIED"];
  for (const cls of all) {
    assert.equal(isBenign(cls) && isEngineFault(cls), false, `${cls} cannot be both`);
  }
  // PROVIDER_FAILURE and CIRCUIT_BREAKER_HALT are neither: the world is like
  // that, and we are not broken.
  assert.equal(isBenign("PROVIDER_FAILURE"), false);
  assert.equal(isEngineFault("PROVIDER_FAILURE"), false);
});

// ---------------------------------------------------------------------------
// INCIDENT #1 — the analytics_events DELETE denied by RLS, "0 rows", no error
// ---------------------------------------------------------------------------

test("INCIDENT #1 (analytics_events DELETE: RLS denied it with '0 rows deleted' and no error) is named PERMISSION_FAILURE, not an empty result", () => {
  const verdict = classifyStageOutcome(
    evidence({
      stage: "analytics_cleanup",
      counters: countersOf({ examined: 1 }),
      mutations: [
        {
          operation: "delete analytics_events",
          subject: "events older than 90 days",
          postcondition: "failed",
          error: null, // the whole point: there was no error
          rowsAffected: 0,
          rlsDeniable: true,
        },
      ],
    })
  );

  assert.equal(verdict.outcome, "PERMISSION_FAILURE");
  assert.notEqual(verdict.outcome, "NOTHING_TO_DO");
  assert.match(verdict.reason, /NO ERROR/);
  assert.match(verdict.reason, /analytics_events/);

  const incident = incidentFor(verdict);
  assert.ok(incident, "a silently denied write must always produce an incident");
  assert.equal(incident.severity, "critical");
  assert.ok(incident.whereToLook.some((w) => /anon/.test(w)));
});

test("INCIDENT #1 variant: the same no-op WITHOUT a declared RLS-deniable path is NO_OP_MUTATION, still critical", () => {
  const verdict = classifyStageOutcome(
    evidence({
      stage: "analytics_cleanup",
      counters: countersOf({ examined: 1 }),
      mutations: [
        {
          operation: "delete analytics_events",
          postcondition: "failed",
          error: null,
          rowsAffected: 0,
          rlsDeniable: false,
        },
      ],
    })
  );
  assert.equal(verdict.outcome, "NO_OP_MUTATION");
  assert.equal(incidentFor(verdict)?.severity, "critical");
});

// ---------------------------------------------------------------------------
// INCIDENT #2 — engine_upsert_update_proposal answered 'rejected_invalid' to
// every call and the freshness job discarded the answer
// ---------------------------------------------------------------------------

test("INCIDENT #2 (engine_upsert_update_proposal answered 'rejected_invalid' to every call; the job discarded it and reported success) is not allowed to read as success", () => {
  // As the job actually recorded it: every rejection was folded into `deduped`,
  // so the counters looked like a calm, fully-deduplicated pass.
  const asShipped = classifyStageOutcome(
    evidence({
      stage: "engine_freshness",
      counters: countersOf({ examined: 6, deduplicated: 6 }),
      itemOutcomes: items(6, { disposition: "rejected", reasonCode: "rejected_invalid" }),
    })
  );

  // The counters and the per-item truth describe different runs, and that
  // disagreement is itself the bug.
  assert.equal(asShipped.outcome, "UNCLASSIFIED");
  assert.equal(asShipped.ambiguity, "counter_disagreement");
  assert.match(asShipped.reason, /rejection as a duplicate/);
  assert.equal(incidentFor(asShipped)?.severity, "critical");
});

test("INCIDENT #2, counted honestly: six 'rejected_invalid' answers are WORK_REJECTED with a uniformity incident, never a quiet success", () => {
  const verdict = classifyStageOutcome(
    evidence({
      stage: "engine_freshness",
      counters: countersOf({ examined: 6, rejected: 6 }),
      itemOutcomes: items(6, { disposition: "rejected", reasonCode: "rejected_invalid" }),
    })
  );

  assert.equal(verdict.outcome, "WORK_REJECTED");
  assert.ok(verdict.uniformity, "six identical rejections must be flagged as uniform");
  assert.equal(verdict.uniformity.strength, "same_reason");
  assert.equal(verdict.uniformity.reasonCode, "rejected_invalid");

  const incident = incidentFor(verdict);
  assert.ok(incident, "a legitimate class with suspicious uniformity still raises an incident");
  assert.equal(incident.severity, "warning");
  assert.match(incident.headline, /suspicious uniformity/);
});

test("INCIDENT #2 at postcondition resolution: the RPC's rejection surfaces as a silent no-op, so the pass is NO_OP_MUTATION", () => {
  const post = summaryOf([
    { operation: "engine_upsert_update_proposal", status: "silent_no_op", ok: false, detail: "returned 'rejected_invalid'." },
  ]);
  const verdict = classifyStageOutcome(
    evidence({ stage: "engine_freshness", counters: countersOf({ examined: 1, failed: 1 }), postconditions: post })
  );
  assert.equal(verdict.outcome, "NO_OP_MUTATION");
  assert.match(verdict.reason, /silent no-op/);
  assert.equal(incidentFor(verdict)?.severity, "critical");
});

// ---------------------------------------------------------------------------
// INCIDENT #3 — the Commons wikitext parser refused four good photographs
// ---------------------------------------------------------------------------

test("INCIDENT #3 (the Commons `|other versions=` mis-parse refused four correctly-licensed photographs and read as an empty search) is named PARSER_FAILURE", () => {
  const verdict = classifyStageOutcome(
    evidence({
      stage: "engine_media_acquisition",
      counters: countersOf({ examined: 4, rejected: 4 }),
      providers: [{ provider: "wikimedia_commons", called: true, status: "ok", responsesParsed: 4, responsesFailed: 0 }],
      itemOutcomes: items(4, {
        disposition: "rejected",
        reasonCode: "rights_conflicting",
        // The reason came out of OUR reading of someone else's wikitext.
        derivedFromParsing: true,
      }),
    })
  );

  assert.equal(verdict.outcome, "PARSER_FAILURE");
  assert.notEqual(verdict.outcome, "WORK_REJECTED");
  assert.notEqual(verdict.outcome, "NOTHING_TO_DO");
  assert.equal(verdict.uniformity?.strength, "same_parser_derived_reason");
  assert.match(verdict.reason, /broken reader/);

  const incident = incidentFor(verdict);
  assert.ok(incident, "PARSER_FAILURE must always produce an incident");
  assert.equal(incident.severity, "critical");
  assert.match(incident.whyItMatters, /defect in our own reader/);
});

test("INCIDENT #3 counterexample: four rejections for the same reason NOT derived from parsing stay WORK_REJECTED", () => {
  // Four candidates that are all simply the wrong product is the normal, correct
  // shape of a broad search. Escalating that to PARSER_FAILURE would make the
  // detector useless within a week.
  const verdict = classifyStageOutcome(
    evidence({
      stage: "engine_media_acquisition",
      counters: countersOf({ examined: 4, rejected: 4 }),
      itemOutcomes: items(4, { disposition: "rejected", reasonCode: "entity_mismatch", derivedFromParsing: false }),
    })
  );
  assert.equal(verdict.outcome, "WORK_REJECTED");
  assert.equal(verdict.uniformity?.strength, "same_reason");
  assert.equal(incidentFor(verdict)?.severity, "warning");
});

test("INCIDENT #3 shape: an empty search that cannot prove its reader was awake is NOT NOTHING_TO_DO", () => {
  const verdict = classifyStageOutcome(
    evidence({
      stage: "engine_media_acquisition",
      counters: countersOf({}),
      inputProbe: {
        source: "commons search",
        available: 0,
        proof: "zero_rows_only",
        deniableUnderRls: true,
      },
    })
  );
  assert.equal(verdict.outcome, "UNCLASSIFIED");
  assert.equal(verdict.ambiguity, "emptiness_unproven");
  assert.match(verdict.reason, /indistinguishable/);
});

// ---------------------------------------------------------------------------
// INCIDENT #4 — examined:23 created:0 deduped:0 failed:0 status:success
// ---------------------------------------------------------------------------

test("INCIDENT #4 (a job examined 23 items, declined all 23, incremented no counter, and recorded examined:23 created:0 deduped:0 failed:0 status:success) is UNCLASSIFIED, never success", () => {
  const verdict = classifyStageOutcome(
    evidence({
      stage: "engine_discover",
      // Exactly the row that was written: 23 examined and every disposition zero.
      counters: countersOf({ examined: 23 }),
    })
  );

  assert.equal(verdict.outcome, "UNCLASSIFIED");
  assert.equal(verdict.ambiguity, "unaccounted_items");
  assert.match(verdict.reason, /23 item\(s\) were examined and only 0 ended in a recorded disposition/);
  assert.match(verdict.reason, /cannot look at work and then have had no relationship to it/);

  const incident = incidentFor(verdict);
  assert.ok(incident, "a stage that lost 23 items must produce an incident");
  assert.equal(incident.severity, "critical");
});

test("INCIDENT #4, counted honestly: 23 declines becomes WORK_REJECTED and the uniformity detector escalates it", () => {
  const outcomes = items(23, { disposition: "rejected", reasonCode: "below_relevance_threshold" });
  const verdict = classifyStageOutcome(
    evidence({
      stage: "engine_discover",
      counters: countersOf({ examined: 23, rejected: 23 }),
      itemOutcomes: outcomes,
    })
  );

  assert.equal(verdict.outcome, "WORK_REJECTED");
  assert.equal(verdict.uniformity?.items, 23);
  assert.equal(verdict.uniformity?.strength, "same_reason");
  const incident = incidentFor(verdict);
  assert.ok(incident);
  assert.match(incident.whyItMatters, /23 identical outcomes is one rule applied 23 times/);
});

test("INCIDENT #4 partial-loss shape: 23 examined with only 20 disposed is still UNCLASSIFIED", () => {
  const verdict = classifyStageOutcome(
    evidence({ stage: "engine_discover", counters: countersOf({ examined: 23, rejected: 18, deduplicated: 2 }) })
  );
  assert.equal(verdict.outcome, "UNCLASSIFIED");
  assert.equal(verdict.ambiguity, "unaccounted_items");
  assert.match(verdict.reason, /3 item\(s\) went somewhere the counters do not describe/);
});

// ---------------------------------------------------------------------------
// NOTHING_TO_DO must be earned
// ---------------------------------------------------------------------------

test("NOTHING_TO_DO is unreachable without an input probe", () => {
  const verdict = classifyStageOutcome(evidence({ stage: "engine_briefs", counters: countersOf({}) }));
  assert.equal(verdict.outcome, "UNCLASSIFIED");
  assert.equal(verdict.ambiguity, "no_evidence");
});

test("a stage that examined nothing but did report SOMETHING gets the emptiness complaint, not the no-instrumentation one", () => {
  const verdict = classifyStageOutcome(
    evidence({
      stage: "engine_briefs",
      providers: [{ provider: "openai", called: true, status: "ok", responsesParsed: 1 }],
    })
  );
  assert.equal(verdict.outcome, "UNCLASSIFIED");
  assert.equal(verdict.ambiguity, "emptiness_unproven");
  assert.match(verdict.reason, /no evidence that its queue was ever read/);
});

test("a mutation that could neither be confirmed nor denied is UNCLASSIFIED — 'I could not tell' is not 'it worked'", () => {
  const post = summaryOf([
    { operation: "engine_upsert_brief", status: "unverifiable", ok: false, detail: "the RPC returned null." },
  ]);
  const verdict = classifyStageOutcome(
    evidence({ stage: "engine_briefs", counters: countersOf({ examined: 1, failed: 1 }), postconditions: post })
  );
  assert.equal(verdict.outcome, "UNCLASSIFIED");
  assert.equal(verdict.ambiguity, "mutation_unverifiable");
  assert.equal(incidentFor(verdict)?.severity, "critical");
});

test("failures with nothing supplied to say WHAT failed are UNCLASSIFIED rather than a class of their own", () => {
  const verdict = classifyStageOutcome(
    evidence({ stage: "engine_trends", counters: countersOf({ examined: 4, failed: 4 }) })
  );
  assert.equal(verdict.outcome, "UNCLASSIFIED");
  assert.equal(verdict.ambiguity, "counter_disagreement");
  assert.match(verdict.reason, /no error, mutation or provider evidence was supplied/);
});

test("NOTHING_TO_DO is unreachable from zero rows alone on an RLS-deniable read — the 2026-08 grants signature", () => {
  const verdict = classifyStageOutcome(
    evidence({
      stage: "engine_briefs",
      inputProbe: { source: "engine_pending_briefs", available: 0, proof: "zero_rows_only", deniableUnderRls: true },
    })
  );
  assert.equal(verdict.outcome, "UNCLASSIFIED");
  assert.equal(verdict.ambiguity, "emptiness_unproven");
  assert.match(verdict.reason, /NOT recorded as NOTHING_TO_DO/);
});

test("NOTHING_TO_DO is unreachable when the input read itself proved nothing", () => {
  const verdict = classifyStageOutcome(
    evidence({
      stage: "engine_briefs",
      inputProbe: { source: "engine_pending_briefs", available: 0, proof: "none", deniableUnderRls: false },
    })
  );
  assert.equal(verdict.outcome, "UNCLASSIFIED");
  assert.equal(verdict.ambiguity, "emptiness_unproven");
});

test("NOTHING_TO_DO IS reachable when the reader proves it was awake", () => {
  const verdict = classifyStageOutcome(
    evidence({
      stage: "engine_briefs",
      inputProbe: {
        source: "engine_pending_briefs",
        available: 0,
        proof: "reader_alive",
        deniableUnderRls: true,
        corroboration: "the same read returned 41 briefs in non-approved states, so the reader is not being denied",
      },
    })
  );
  assert.equal(verdict.outcome, "NOTHING_TO_DO");
  assert.match(verdict.reason, /POSITIVELY established/);
  assert.equal(incidentFor(verdict), null);
});

test("NOTHING_TO_DO IS reachable from zero rows when the read is declared not deniable", () => {
  const verdict = classifyStageOutcome(
    evidence({
      stage: "engine_trends",
      inputProbe: { source: "public.manufacturers", available: 0, proof: "zero_rows_only", deniableUnderRls: false },
    })
  );
  assert.equal(verdict.outcome, "NOTHING_TO_DO");
});

test("work available but nothing examined is never NOTHING_TO_DO", () => {
  const verdict = classifyStageOutcome(
    evidence({
      stage: "engine_relevance",
      inputProbe: { source: "engine_pending_discoveries", available: 12, proof: "reader_alive", deniableUnderRls: true },
    })
  );
  assert.equal(verdict.outcome, "UNCLASSIFIED");
  assert.equal(verdict.ambiguity, "unaccounted_items");
  assert.match(verdict.reason, /offered 12 eligible item\(s\) and the stage examined NONE/);
});

// ---------------------------------------------------------------------------
// The remaining classes
// ---------------------------------------------------------------------------

test("WORK_SUCCEEDED requires the work to have been verified, not merely counted", () => {
  const post = summaryOf([{ operation: "engine_upsert_discovery", status: "verified", ok: true }]);
  const verdict = classifyStageOutcome(
    evidence({ stage: "engine_discover", counters: countersOf({ examined: 3, created: 3 }), postconditions: post })
  );
  assert.equal(verdict.outcome, "WORK_SUCCEEDED");
  assert.equal(incidentFor(verdict), null);
});

test("creations backed only by unobservable writes are UNCLASSIFIED, not WORK_SUCCEEDED", () => {
  const post = summaryOf([
    { operation: "engine_log_event", status: "blind", ok: false },
    { operation: "engine_log_event", status: "blind", ok: false },
  ]);
  const verdict = classifyStageOutcome(
    evidence({ stage: "engine_trends", counters: countersOf({ examined: 2, created: 2 }), postconditions: post })
  );
  assert.equal(verdict.outcome, "UNCLASSIFIED");
  assert.equal(verdict.ambiguity, "creations_unobservable");
  assert.match(verdict.reason, /unfalsifiable/);
});

test("WORK_DEDUPLICATED is a legitimate class when nothing was rejected or failed", () => {
  const verdict = classifyStageOutcome(
    evidence({ stage: "engine_discover", counters: countersOf({ examined: 2, deduplicated: 2 }) })
  );
  assert.equal(verdict.outcome, "WORK_DEDUPLICATED");
  assert.equal(incidentFor(verdict), null); // two is below the uniformity threshold
});

test("STATE_TRANSITION_FAILURE fires when a read-back disagrees with what was requested", () => {
  const verdict = classifyStageOutcome(
    evidence({
      stage: "engine_relevance",
      counters: countersOf({ examined: 1, created: 1 }),
      stateTransitions: [
        { subject: "discovery/abc", field: "state", expected: "assessed", observed: "pending" },
      ],
    })
  );
  assert.equal(verdict.outcome, "STATE_TRANSITION_FAILURE");
  assert.match(verdict.reason, /expected 'assessed', observed 'pending'/);
  assert.equal(incidentFor(verdict)?.severity, "critical");
});

test("a state transition whose read-back itself failed is not counted as a transition failure", () => {
  // `observed: null` means we could not look. That is not evidence the change
  // failed, and inventing a failure from it would be the mirror image of
  // inventing a success from silence.
  const verdict = classifyStageOutcome(
    evidence({
      stage: "engine_relevance",
      counters: countersOf({ examined: 1, created: 1 }),
      stateTransitions: [{ subject: "discovery/abc", field: "state", expected: "assessed", observed: null }],
    })
  );
  assert.equal(verdict.outcome, "WORK_SUCCEEDED");
});

test("PROVIDER_FAILURE covers an unreachable source, a useless answer, and a source never called", () => {
  for (const status of ["unreachable", "rate_limited", "useless"] as const) {
    const v = classifyStageOutcome(
      evidence({ stage: "engine_search_intelligence", providers: [{ provider: "gsc", called: true, status }] })
    );
    assert.equal(v.outcome, "PROVIDER_FAILURE", status);
    assert.match(v.reason, /THE WORK DID NOT HAPPEN/);
  }
  const never = classifyStageOutcome(
    evidence({ stage: "engine_search_intelligence", providers: [{ provider: "gsc", called: false, status: "ok" }] })
  );
  assert.equal(never.outcome, "PROVIDER_FAILURE");
  assert.match(never.reason, /unqueried source is not a source that came back empty/);
});

test("PARSER_FAILURE outranks PROVIDER_FAILURE when both are present — a defect in us must not hide behind an outage", () => {
  const verdict = classifyStageOutcome(
    evidence({
      stage: "engine_media_acquisition",
      providers: [
        { provider: "wikimedia_commons", called: true, status: "malformed", detail: "wikitext ended mid-template" },
        { provider: "openverse", called: true, status: "unreachable" },
      ],
    })
  );
  assert.equal(verdict.outcome, "PARSER_FAILURE");
});

test("PERMISSION_FAILURE outranks everything, including a parser failure in the same pass", () => {
  const verdict = classifyStageOutcome(
    evidence({
      stage: "engine_media_acquisition",
      errors: [{ operation: "engine_upsert_media_candidate", code: "42501", message: "permission denied for table" }],
      providers: [{ provider: "wikimedia_commons", called: true, status: "malformed" }],
      parseAnomalies: [{ where: "informationField", detail: "captured a template delimiter as a value" }],
    })
  );
  assert.equal(verdict.outcome, "PERMISSION_FAILURE");
});

test("CIRCUIT_BREAKER_HALT is its own class so a halt is never mistaken for an idle queue", () => {
  const verdict = classifyStageOutcome(
    evidence({
      stage: "engine_discover",
      breakerHalt: { breaker: "silent_success", reason: "3 critical signals in the last window", suspended: ["creation"] },
    })
  );
  assert.equal(verdict.outcome, "CIRCUIT_BREAKER_HALT");
  assert.notEqual(verdict.outcome, "NOTHING_TO_DO");
  assert.equal(incidentFor(verdict)?.severity, "info");
});

test("a real fault is not masked by a breaker that happened to be open at the same time", () => {
  const verdict = classifyStageOutcome(
    evidence({
      stage: "engine_discover",
      counters: countersOf({ examined: 1 }),
      breakerHalt: { breaker: "silent_success", reason: "open" },
      mutations: [{ operation: "engine_upsert_discovery", postcondition: "failed", rowsAffected: 0, rlsDeniable: true }],
    })
  );
  assert.equal(verdict.outcome, "PERMISSION_FAILURE");
});

// ---------------------------------------------------------------------------
// Suspicious uniformity
// ---------------------------------------------------------------------------

test("the uniformity threshold is a named constant set to the size of the smallest real incident", () => {
  assert.equal(UNIFORM_OUTCOME_MIN_ITEMS, 4);
});

test("uniformity does not fire below the threshold — three identical declines is ordinary coincidence", () => {
  assert.equal(detectUniformity(items(UNIFORM_OUTCOME_MIN_ITEMS - 1, { reasonCode: "entity_mismatch" })), null);
  assert.ok(detectUniformity(items(UNIFORM_OUTCOME_MIN_ITEMS, { reasonCode: "entity_mismatch" })));
});

test("uniformity does not fire when even one item survived — one survivor proves the discriminator discriminates", () => {
  const mixed: ItemOutcome[] = [...items(9, { reasonCode: "entity_mismatch" }), { disposition: "created", reasonCode: "accepted" }];
  assert.equal(detectUniformity(mixed), null);
});

test("uniformity does not fire across mixed dispositions", () => {
  const mixed: ItemOutcome[] = [
    ...items(3, { disposition: "rejected", reasonCode: "a" }),
    ...items(3, { disposition: "deduplicated", reasonCode: "b" }),
  ];
  assert.equal(detectUniformity(mixed), null);
});

test("uniformity strength escalates: same class < same reason < same parser-derived reason", () => {
  const sameClass = detectUniformity([
    { disposition: "rejected", reasonCode: "a" },
    { disposition: "rejected", reasonCode: "b" },
    { disposition: "rejected", reasonCode: "c" },
    { disposition: "rejected", reasonCode: "d" },
  ]);
  assert.equal(sameClass?.strength, "same_class");
  assert.equal(sameClass?.reasonCode, null);

  assert.equal(detectUniformity(items(4, { reasonCode: "a" }))?.strength, "same_reason");
  assert.equal(
    detectUniformity(items(4, { reasonCode: "a", derivedFromParsing: true }))?.strength,
    "same_parser_derived_reason"
  );
});

test("uniformity fires on wholesale deduplication too — a starved join looks exactly like this", () => {
  const verdict = classifyStageOutcome(
    evidence({
      stage: "engine_discover",
      counters: countersOf({ examined: 12, deduplicated: 12 }),
      itemOutcomes: items(12, { disposition: "deduplicated", reasonCode: "url_already_tracked" }),
    })
  );
  assert.equal(verdict.outcome, "WORK_DEDUPLICATED");
  assert.equal(verdict.uniformity?.items, 12);
  assert.equal(incidentFor(verdict)?.severity, "warning");
});

test("a stage that rejects without recording reasons is told so in writing", () => {
  const verdict = classifyStageOutcome(
    evidence({ stage: "engine_relevance", counters: countersOf({ examined: 9, rejected: 9 }) })
  );
  assert.equal(verdict.outcome, "WORK_REJECTED");
  assert.equal(verdict.uniformity, null);
  assert.match(verdict.reason, /cannot distinguish N judgements from one bug repeated N times/);
});

// ---------------------------------------------------------------------------
// Incidents
// ---------------------------------------------------------------------------

test("the four always-incident classes plus UNCLASSIFIED can never return null", () => {
  for (const cls of ALWAYS_INCIDENT) {
    const verdict = {
      stage: "s",
      outcome: cls,
      headline: STAGE_OUTCOME_HEADLINES[cls],
      reason: "r",
      because: ["r"],
      ambiguity: cls === "UNCLASSIFIED" ? ("no_evidence" as const) : null,
      uniformity: null,
      ambiguous: cls === "UNCLASSIFIED",
      observed: {},
    };
    const incident = incidentFor(verdict);
    assert.ok(incident, `${cls} must always produce an incident`);
    assert.equal(incident.severity, "critical", `${cls} must be critical`);
    assert.ok(incident.whyItMatters.length > 40, `${cls} must explain why it matters`);
    assert.ok(incident.whereToLook.length > 0, `${cls} must say what to look at`);
  }
});

test("ALWAYS_INCIDENT contains the four classes the design requires, plus UNCLASSIFIED", () => {
  for (const cls of ["NO_OP_MUTATION", "PARSER_FAILURE", "PERMISSION_FAILURE", "STATE_TRANSITION_FAILURE"] as const) {
    assert.ok(ALWAYS_INCIDENT.includes(cls), `${cls} must always be an incident`);
  }
  assert.ok(ALWAYS_INCIDENT.includes("UNCLASSIFIED"));
});

test("every ambiguity code carries a written explanation", () => {
  for (const [code, text] of Object.entries(AMBIGUITY_MEANINGS)) {
    assert.ok(text.length > 40, `${code} needs a real explanation`);
  }
});

test("a fully clean pass produces no incident at all", () => {
  const verdict = classifyStageOutcome(
    evidence({
      stage: "engine_discover",
      counters: countersOf({ examined: 5, created: 3, deduplicated: 2 }),
      postconditions: summaryOf([{ operation: "engine_upsert_discovery", status: "verified", ok: true }]),
      itemOutcomes: [
        ...items(3, { disposition: "created", reasonCode: "new" }),
        ...items(2, { disposition: "deduplicated", reasonCode: "known_url" }),
      ],
    })
  );
  assert.equal(verdict.outcome, "WORK_SUCCEEDED");
  assert.equal(incidentFor(verdict), null);
  assert.equal(hasBlockingIncident([verdict]), false);
});

test("incidentsFor sorts critical before warning before info, and hasBlockingIncident ignores info", () => {
  const halted = classifyStageOutcome(
    evidence({ stage: "a", breakerHalt: { breaker: "budget", reason: "spend cap reached" } })
  );
  const denied = classifyStageOutcome(
    evidence({ stage: "b", counters: countersOf({ examined: 1 }), errors: [{ operation: "rpc", code: "42501" }] })
  );
  const upstream = classifyStageOutcome(
    evidence({ stage: "c", providers: [{ provider: "gsc", called: true, status: "unreachable" }] })
  );

  const list = incidentsFor([halted, upstream, denied]);
  assert.deepEqual(
    list.map((i) => i.severity),
    ["critical", "warning", "info"]
  );
  assert.equal(hasBlockingIncident([halted]), false);
  assert.equal(hasBlockingIncident([halted, denied]), true);
});

test("every verdict carries a non-empty written reason, whatever the class", () => {
  const cases: StageEvidence[] = [
    evidence({ stage: "a", counters: countersOf({ examined: 23 }) }),
    evidence({ stage: "b", counters: countersOf({ examined: 3, created: 3 }) }),
    evidence({ stage: "c", counters: countersOf({ examined: 4, rejected: 4 }) }),
    evidence({ stage: "d", counters: countersOf({ examined: 4, deduplicated: 4 }) }),
    evidence({ stage: "e", providers: [{ provider: "p", called: true, status: "unreachable" }] }),
    evidence({ stage: "f", providers: [{ provider: "p", called: true, status: "malformed" }] }),
    evidence({ stage: "g", errors: [{ operation: "o", code: "42501" }] }),
    evidence({ stage: "h", breakerHalt: { breaker: "x", reason: "y" } }),
    evidence({
      stage: "i",
      counters: countersOf({ examined: 1, created: 1 }),
      stateTransitions: [{ subject: "s", field: "f", expected: "e", observed: "o" }],
    }),
    evidence({
      stage: "j",
      inputProbe: { source: "q", available: 0, proof: "corroborated", deniableUnderRls: true, corroboration: "z" },
    }),
    evidence({ stage: "k" }),
  ];
  for (const e of cases) {
    const v = classifyStageOutcome(e);
    assert.ok(v.reason.length > 30, `${e.stage} produced an empty reason`);
    assert.ok(v.because.length > 0);
    assert.equal(v.ambiguous, v.outcome === "UNCLASSIFIED");
    assert.equal(v.ambiguous, v.ambiguity !== null);
  }
});

test("incidentAsFinding renders into health.ts's finding shape without losing the class", () => {
  const verdict = classifyStageOutcome(
    evidence({ stage: "engine_discover", counters: countersOf({ examined: 23 }) })
  );
  const finding = incidentAsFinding(incidentFor(verdict)!);
  assert.equal(finding.job, "engine_discover");
  assert.equal(finding.severity, "critical");
  assert.match(finding.why, /\[STAGE_OUTCOME\/UNCLASSIFIED\]/);
  assert.equal(finding.observed.stageOutcomeClass, "UNCLASSIFIED");
});

// ---------------------------------------------------------------------------
// Error families
// ---------------------------------------------------------------------------

test("a revoked grant reads as a permission failure, not as a missing object", () => {
  // Under Supabase a revoked grant makes a function INVISIBLE rather than
  // forbidden, so 'not found in the schema cache' is what permission problems
  // usually look like from the client.
  assert.equal(errorFamily({ code: "PGRST202" }), "permission");
  assert.equal(errorFamily({ code: "42883" }), "permission");
  assert.equal(errorFamily({ code: "42501" }), "permission");
  assert.equal(errorFamily({ message: "new row violates row-level security policy" }), "permission");
});

test("provider and parser errors are separated from permission errors and from each other", () => {
  assert.equal(errorFamily({ code: "ETIMEDOUT" }), "provider");
  assert.equal(errorFamily({ message: "fetch failed" }), "provider");
  assert.equal(errorFamily({ message: "Unexpected token < in JSON at position 0" }), "parser");
  assert.equal(errorFamily({ message: "something else entirely" }), "unknown");
  assert.equal(errorFamily(null), "unknown");
});

// ---------------------------------------------------------------------------
// The bridge to the media-search taxonomy
// ---------------------------------------------------------------------------

test("the media-search taxonomy maps onto this one, and an unknown state is never benign", () => {
  assert.equal(fromSearchOutcomeState("USABLE_CANDIDATE_FOUND"), "WORK_SUCCEEDED");
  assert.equal(fromSearchOutcomeState("NO_RESULTS"), "NOTHING_TO_DO");
  assert.equal(fromSearchOutcomeState("RIGHTS_UNCERTAIN"), "WORK_REJECTED");
  assert.equal(fromSearchOutcomeState("PROVENANCE_INCOMPLETE"), "WORK_REJECTED");
  assert.equal(fromSearchOutcomeState("WRONG_ENTITY_RESULTS"), "WORK_REJECTED");
  assert.equal(fromSearchOutcomeState("PROVIDER_PARSE_FAILURE"), "PARSER_FAILURE");
  assert.equal(fromSearchOutcomeState("PROVIDER_OUTAGE"), "PROVIDER_FAILURE");
  assert.equal(fromSearchOutcomeState("A_STATE_INVENTED_LATER"), "UNCLASSIFIED");
});
