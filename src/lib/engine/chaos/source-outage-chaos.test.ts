// CHAOS PROOF: source_outage_test
//
// REQUIRED LEVEL: chaos_proven (proofs.ts REQUIRED_LEVEL).
//
// WHAT IS INDUCED — WITH REAL SOCKETS
// -----------------------------------
// Throwaway HTTP servers are stood up on loopback and then genuinely broken.
// Nothing about the outage is simulated: `gone` binds a port and closes the
// listener so the request really is refused by the operating system; `hangs`
// accepts the connection and never answers so the client's own AbortController
// really does fire; `server_error` really returns 503. The error strings the
// assertions run against are whatever Node and this machine actually produced.
//
// THE PROPERTY BEING PROVED
// -------------------------
// "An upstream source outage is recorded as a FAILURE, never as 'this source had
// no news'." The dangerous direction is not the crash — it is the outage that
// reads as quiet, because a negative result recorded as a finding about the
// world is later read as evidence that somebody looked.
//
// So the control matters as much as the fault: a source that is genuinely quiet
// (a well-formed feed with zero entries) must NOT be reported as failing, or the
// detector is just a stuck alarm. Both directions are asserted.
//
// LAYER COVERED / NOT COVERED
// ---------------------------
// `safeFetchText` and `runDiscovery` are both server-only and cannot be
// imported. `safeFetchTextReplica` in outage.ts reproduces the former's body
// verbatim, and the discovery job's own rule ("body === null -> counters.failed++"
// and "items.length === 0 -> counters.failed++") is applied explicitly and
// quoted where it is used. `parseFeed`, `errorFamily`, `classifyStageOutcome`,
// `evaluateBreakers`, `capabilityOf` and `haltReason` are the real modules.
// The proof therefore covers the RULE, not the identity of the job function.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createSourceRegistry,
  episodeFrom,
  familyOf,
  looksLikeFeedDocument,
  observeSource,
  safeFetchTextReplica,
  startFakeSource,
} from "./outage.ts";
import { breakerGateFor, capabilitiesStillRunnable, describeHalt } from "./propagation.ts";
import { observe } from "./evidence.ts";
import { parseFeed } from "../feed-parser.ts";
import { classifyStageOutcome, countersOf, incidentFor } from "../stage-outcome.ts";
import { evaluateBreakers, type BreakerInputs } from "../circuit-breaker.ts";

const PROOF = "source_outage_test";

/** A baseline with nothing else wrong, so a halt is attributable to the sources. */
const OTHERWISE_HEALTHY: BreakerInputs = {
  validators: [
    { validator: "media_rights", available: true },
    { validator: "postconditions", available: true },
    { validator: "fail_closed_rule", available: true },
  ],
  publication: { createdLast24h: 2, dailyMedian: 1 },
  silentSuccess: {
    runsObserved: 40,
    signals: 0,
    criticalSignals: 0,
    jobsAffected: 0,
    postconditionTelemetry: "present",
  },
};

/**
 * The classification a discovery-style stage performs for one source, from the
 * evidence a real poll produced.
 */
function classifyPoll(stage: string, episode: ReturnType<typeof episodeFrom>, examined: number, failed: number) {
  return classifyStageOutcome({
    stage,
    counters: countersOf({ examined, failed }),
    providers: [episode],
    inputProbe:
      episode.status === "empty"
        ? {
            source: "the source's own feed document",
            available: 0,
            proof: "reader_alive",
            // An HTTP response is not an RLS-deniable read; zero entries in a
            // document we parsed is a fact about the source.
            deniableUnderRls: false,
            corroboration: "the feed document parsed and declares zero entries",
          }
        : { source: "the source's own feed document", available: 0, proof: "none", deniableUnderRls: false },
  });
}

// ---------------------------------------------------------------------------
// 1. THE OUTAGES — induced against real sockets
// ---------------------------------------------------------------------------

test("[INDUCED] connection refused: a source whose port has nothing on it", async () => {
  const src = await startFakeSource("gone");
  const o = await observeSource(src.url);

  assert.equal(o.transport, "refused");
  assert.equal(o.safeFetchResult, "null");
  assert.notEqual(o.errorMessage, null);
  // The real error, not a written-down one.
  assert.match(o.errorMessage as string, /fetch failed/i);
  assert.equal(familyOf(o), "provider");

  const episode = episodeFrom("Acme Corp", o);
  assert.equal(episode.status, "unreachable");

  const verdict = classifyPoll("discovery", episode, 1, 1);
  assert.equal(verdict.outcome, "PROVIDER_FAILURE");
  assert.notEqual(verdict.outcome, "NOTHING_TO_DO");
  assert.match(verdict.reason, /THE WORK DID NOT HAPPEN/);
  assert.equal(incidentFor(verdict)?.severity, "warning");

  // And the production fetch path also refuses to hand back a body.
  assert.equal(await safeFetchTextReplica(src.url, 2_000), null);

  observe(
    PROOF,
    "[INDUCED] connection refused (real closed port)",
    `url=${src.url} transport=${o.transport} error="${o.errorMessage}" errorFamily=${familyOf(o)} ` +
      `episode=${episode.status} verdict=${verdict.outcome} severity=warning — NOT NOTHING_TO_DO`
  );
});

test("[INDUCED] HTTP 503: a source that answers with a non-answer", async () => {
  const src = await startFakeSource("server_error");
  try {
    const o = await observeSource(src.url);
    assert.equal(o.transport, "http_error");
    assert.equal(o.httpStatus, 503);
    assert.equal(o.safeFetchResult, "null", "safeFetchText discards a non-OK response entirely");

    const episode = episodeFrom("Acme Corp", o);
    assert.equal(episode.status, "rate_limited");

    const verdict = classifyPoll("discovery", episode, 1, 1);
    assert.equal(verdict.outcome, "PROVIDER_FAILURE");
    assert.notEqual(verdict.outcome, "NOTHING_TO_DO");

    observe(
      PROOF,
      "[INDUCED] HTTP 503",
      `status=${o.httpStatus} safeFetchText would return ${o.safeFetchResult}; episode=${episode.status}; ` +
        `verdict=${verdict.outcome}`
    );
  } finally {
    await src.close();
  }
});

test("[INDUCED] a source that accepts the connection and never answers", async () => {
  const src = await startFakeSource("hangs");
  try {
    const o = await observeSource(src.url, 400);
    assert.equal(o.transport, "timeout");
    assert.equal(o.safeFetchResult, "null");

    const episode = episodeFrom("Acme Corp", o);
    assert.equal(episode.status, "unreachable");

    const verdict = classifyPoll("discovery", episode, 1, 1);
    assert.equal(verdict.outcome, "PROVIDER_FAILURE");

    // ⚠️ OBSERVED GAP, recorded rather than smoothed over: errorFamily() in
    // stage-outcome.ts does not recognise an abort/timeout. Its PROVIDER_MESSAGE_RE
    // matches "timed out" and "timeout" but Node's real abort message is
    // "This operation was aborted", so a timeout classifies as `unknown`.
    // It still fails CLOSED — a stage reporting only this error reaches
    // UNCLASSIFIED, which is an incident — but it is filed as "we cannot say"
    // rather than as "upstream did not answer".
    const family = familyOf(o);
    assert.equal(family, "unknown");

    observe(
      PROOF,
      "[INDUCED] read timeout (server accepts, never replies)",
      `transport=${o.transport} error="${o.errorMessage}" verdict=${verdict.outcome}. ` +
        `GAP: errorFamily() returned '${family}' for this real message — its regex expects ` +
        `"timed out"/"timeout", Node produced "${o.errorMessage}".`
    );
  } finally {
    await src.close();
  }
});

// ---------------------------------------------------------------------------
// 2. THE DANGEROUS ONE — a 200 OK that means the feed is gone
// ---------------------------------------------------------------------------

test("[INDUCED] the feed moved and now serves an HTML notice — 200 OK, zero items", async () => {
  const src = await startFakeSource("moved");
  try {
    const o = await observeSource(src.url);

    // Everything below the parser succeeded completely.
    assert.equal(o.transport, "ok");
    assert.equal(o.httpStatus, 200);
    assert.equal(o.safeFetchResult, "body");
    // And the real parser found nothing.
    assert.equal(o.itemsParsed, 0);
    assert.equal(o.looksLikeFeed, false);

    const episode = episodeFrom("Acme Corp", o);
    assert.equal(episode.status, "malformed");

    const verdict = classifyPoll("discovery", episode, 1, 1);
    // A response we could not read is a defect in US, never an empty shelf.
    assert.equal(verdict.outcome, "PARSER_FAILURE");
    assert.equal(incidentFor(verdict)?.severity, "critical");
    assert.notEqual(verdict.outcome, "NOTHING_TO_DO");

    observe(
      PROOF,
      "[INDUCED] moved feed serving HTML (HTTP 200)",
      `transport=ok status=200 bytes=${o.bodyBytes} parseFeed items=${o.itemsParsed} looksLikeFeed=${o.looksLikeFeed}; ` +
        `episode=${episode.status}; verdict=${verdict.outcome} (critical) — the source may be publishing daily`
    );
  } finally {
    await src.close();
  }
});

test("CONTROL: a genuinely quiet source is NOT reported as failing", async () => {
  const src = await startFakeSource("empty_feed");
  try {
    const o = await observeSource(src.url);
    assert.equal(o.transport, "ok");
    assert.equal(o.itemsParsed, 0);
    assert.equal(o.looksLikeFeed, true, "it IS a feed — it just has no entries");

    const episode = episodeFrom("Acme Corp", o);
    assert.equal(episode.status, "empty");

    const verdict = classifyPoll("discovery", episode, 0, 0);
    assert.equal(verdict.outcome, "NOTHING_TO_DO");
    assert.equal(incidentFor(verdict), null);

    observe(
      PROOF,
      "control: a well-formed feed with zero entries",
      `transport=ok items=0 looksLikeFeed=true episode=${episode.status} verdict=${verdict.outcome} incident=none — ` +
        `the detector distinguishes quiet from broken`
    );
  } finally {
    await src.close();
  }
});

test("⚠️ FINDING: parseFeed() alone cannot tell a moved feed from a quiet one", async () => {
  const moved = await startFakeSource("moved");
  const quiet = await startFakeSource("empty_feed");
  try {
    const movedBody = (await safeFetchTextReplica(moved.url, 2_000)) as string;
    const quietBody = (await safeFetchTextReplica(quiet.url, 2_000)) as string;

    // Both are HTTP 200 with a real body.
    assert.ok(movedBody.length > 0);
    assert.ok(quietBody.length > 0);

    // And the production parser gives them the IDENTICAL answer.
    assert.equal(parseFeed(movedBody).length, 0);
    assert.equal(parseFeed(quietBody).length, 0);

    // The distinction exists, but only via a structural check parseFeed does not
    // perform and no production code performs anywhere.
    assert.equal(looksLikeFeedDocument(movedBody), false);
    assert.equal(looksLikeFeedDocument(quietBody), true);

    observe(
      PROOF,
      "⚠️ FINDING: parseFeed() collapses 'not a feed' into 'no items'",
      `parseFeed(html)=[] and parseFeed(empty rss)=[] — identical. runDiscovery counts BOTH as ` +
        `counters.failed++ with reason "no_parseable_items", so a quiet source is recorded as a failing ` +
        `source. A structural <rss|feed|rdf:RDF> check separates them and nothing in src/ performs one.`
    );
  } finally {
    await moved.close();
    await quiet.close();
  }
});

// ---------------------------------------------------------------------------
// 3. PROPAGATION — does a real outage remove the discovery capability?
// ---------------------------------------------------------------------------

test("[INDUCED] five consecutive real outages trip source_failures and halt discovery", async () => {
  const src = await startFakeSource("gone");
  const registry = createSourceRegistry(["Acme Corp"]);

  // Control: before anything is polled, nothing is halted.
  const before = evaluateBreakers({ ...OTHERWISE_HEALTHY, sources: registry.snapshot() });
  assert.equal(before.healthy, true);
  assert.equal(capabilitiesStillRunnable(before).includes("discovery"), true);

  const errors: string[] = [];
  for (let pass = 0; pass < 5; pass++) {
    const o = await observeSource(src.url, 1_000);
    assert.equal(o.safeFetchResult, "null", "the poll really failed on pass " + pass);
    errors.push(o.errorMessage as string);
    // runDiscovery's own rule: `if (body === null) { counters.failed++; ... }`,
    // followed by engine_record_source_check(p_success: false). `landed: true`
    // models that write actually taking effect.
    registry.record("Acme Corp", false, true);
  }

  const snapshot = registry.snapshot();
  assert.equal(snapshot.maxConsecutiveFailures, 5);

  const after = evaluateBreakers({ ...OTHERWISE_HEALTHY, sources: snapshot });
  const breaker = after.verdicts.find((v) => v.name === "source_failures");
  assert.equal(breaker?.state, "open");
  assert.equal(breaker?.basis, "measured");
  assert.equal(breaker?.observed.maxConsecutiveFailures, 5);

  // The capability the engine may act on no longer includes discovery, and the
  // stage that carries it is refused by name with a reason.
  assert.equal(capabilitiesStillRunnable(after).includes("discovery"), false);
  const gate = breakerGateFor(after, "engine_discover");
  assert.equal(gate.allow, false);
  assert.match(gate.why, /source_failures/);
  // Scoped: everything else keeps running, which is what makes this a halt
  // rather than a shutdown.
  assert.equal(breakerGateFor(after, "engine_relevance").allow, true);

  observe(
    PROOF,
    "[INDUCED] five real outages -> discovery halted",
    `5 real polls, every one "${errors[0]}"; registry maxConsecutiveFailures=${snapshot.maxConsecutiveFailures}; ` +
      `BEFORE: ${describeHalt(before)}; AFTER: ${describeHalt(after)}; ` +
      `engine_discover refused: "${gate.why.slice(0, 140)}..."`
  );
});

test("⚠️ FINDING: the source_failures breaker is BLIND while engine_record_source_check returns void", async () => {
  const src = await startFakeSource("gone");
  const registry = createSourceRegistry(["Acme Corp"]);

  for (let pass = 0; pass < 5; pass++) {
    const o = await observeSource(src.url, 1_000);
    assert.equal(o.safeFetchResult, "null");
    // `landed: false` models the SILENT form: engine_record_source_check is
    // `returns void` in deployed production, so discovery.ts declares the write
    // blind (log.pendingRpc) and cannot tell whether the health row moved. If
    // RLS denies it, nothing anywhere raises.
    registry.record("Acme Corp", false, false);
  }

  const snapshot = registry.snapshot();
  // Five genuine outages, and the counter the breaker reads never moved.
  assert.equal(snapshot.maxConsecutiveFailures, 0);

  const report = evaluateBreakers({ ...OTHERWISE_HEALTHY, sources: snapshot });
  const breaker = report.verdicts.find((v) => v.name === "source_failures");
  // ⚠️ It reports `failed: 5 of 5` from the in-memory last-outcome map, but the
  // ratio rule needs checked >= minSampleForRatio (10) and the consecutive rule
  // needs the persisted counter — which was never written.
  assert.equal(breaker?.state, "closed");
  assert.equal(capabilitiesStillRunnable(report).includes("discovery"), true);
  assert.equal(breakerGateFor(report, "engine_discover").allow, true);

  observe(
    PROOF,
    "⚠️ FINDING: source health is written through a blind RPC",
    `five real, confirmed outages; engine_record_source_check silently no-ops; registry snapshot=` +
      `${JSON.stringify(snapshot)}; source_failures=${breaker?.state}; discovery still runnable. ` +
      `The breaker's input is written through the one call discovery.ts itself declares unobservable.`
  );
});

test("⚠️ FINDING: five genuinely QUIET passes also trip source_failures and halt discovery", async () => {
  const src = await startFakeSource("empty_feed");
  const registry = createSourceRegistry(["Acme Corp"]);
  try {
    for (let pass = 0; pass < 5; pass++) {
      const body = (await safeFetchTextReplica(src.url, 2_000)) as string;
      assert.notEqual(body, null, "the source is up and answering correctly");
      // runDiscovery, verbatim in effect:
      //   const items = parseFeed(body);
      //   if (items.length === 0) { counters.failed++; ... p_success: false ... }
      const items = parseFeed(body);
      assert.equal(items.length, 0);
      registry.record("Acme Corp", false, true);
    }

    const snapshot = registry.snapshot();
    const report = evaluateBreakers({ ...OTHERWISE_HEALTHY, sources: snapshot });
    const breaker = report.verdicts.find((v) => v.name === "source_failures");

    // ⚠️ A source that is up, correct, and simply had a quiet week has now
    // halted the discovery capability entirely.
    assert.equal(snapshot.maxConsecutiveFailures, 5);
    assert.equal(breaker?.state, "open");
    assert.equal(capabilitiesStillRunnable(report).includes("discovery"), false);
    assert.equal(breakerGateFor(report, "engine_discover").allow, false);

    observe(
      PROOF,
      "⚠️ FINDING: a quiet source halts discovery",
      `5 successful HTTP 200 polls of a well-formed feed with zero entries -> ` +
        `runDiscovery's "no_parseable_items" rule -> maxConsecutiveFailures=${snapshot.maxConsecutiveFailures} -> ` +
        `source_failures OPEN -> discovery halted. health.ts's own warning applies: "A breaker that opens ` +
        `permanently on a false signal is not fail-closed. It is broken."`
    );
  } finally {
    await src.close();
  }
});
