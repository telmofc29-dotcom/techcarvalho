// CHAOS: provider_outage_test.
//
// THE PROPERTY UNDER TEST
// ----------------------
// **An outage must never be indistinguishable from an exhausted search.**
//
// That is the 2026-08 lesson in CLAUDE.md restated for this subsystem: `anon`
// had no table grants for weeks and every public page rendered an honest-looking
// empty state, because nothing separated "there is no data" from "the query
// failed". Here the same shape would be a Commons outage reported as
// `NO_RESULTS` — a permanent-looking finding that no photograph of a product
// exists, filed on the strength of a search that never happened.
//
// WHAT IS ACTUALLY INDUCED
// ------------------------
// Real failures against a real loopback HTTP server, reached by the real
// `fetch()` the provider uses (see chaos-support.ts):
//
//   1. connection refused          — nothing listening on the port
//   2. client timeout              — server accepts and never answers
//   3. HTTP 500                    — real status line
//   4. HTTP 429                    — real status line, real HTML body
//   5. HTTP 503                    — real status line
//   6. HTTP 200 carrying HTML      — the page Wikimedia's edge serves instead of JSON
//   7. HTTP 200 carrying HTML that says "Too Many Requests"
//   8. HTTP 200 carrying a MediaWiki `error` object
//   9. HTTP 200 carrying valid JSON of an UNRECOGNISED SHAPE — the case with no
//      exception to catch, where `query.search` is simply absent
//  10. a MID-SEARCH failure: everything healthy until the metadata batch, which
//      then fails, so the search half-completes
//
// Two controls make the negative results mean something:
//   * HEALTHY  — the same fixtures with no fault reach USABLE_CANDIDATE_FOUND
//   * EMPTY    — well-formed responses that genuinely contain nothing reach
//                NO_RESULTS, so NO_RESULTS is demonstrably still reachable and
//                its absence in the fault scenarios is not an artefact.

import { test } from "node:test";
import assert from "node:assert/strict";
import { runAcquisitionPipeline, type PipelineReport } from "./pipeline.ts";
import { DEFAULT_RANKING_CONTEXT } from "./ranking.ts";
import { CommonsClient, createCommonsProvider } from "./wikimedia-commons.ts";
import type { SubjectIdentity } from "./query-expansion.ts";
import {
  FIXTURE_SUBJECT,
  HONEST_EMPTY,
  HTML_ERROR_PAGE,
  HTML_RATE_LIMIT_PAGE,
  reservedDeadOrigin,
  startCommonsStub,
  stubFetch,
  type FaultPlan,
} from "./chaos-support.ts";

const SUBJECT: SubjectIdentity = FIXTURE_SUBJECT;

async function runAgainst(origin: string, timeoutMs?: number): Promise<PipelineReport> {
  const client = new CommonsClient(stubFetch(origin, { timeoutMs }), 0);
  const provider = createCommonsProvider({ identity: SUBJECT, client, maxCategories: 1, maxPerCategory: 12 });
  return runAcquisitionPipeline(SUBJECT, [provider], {
    maxCandidates: 3,
    ranking: { ...DEFAULT_RANKING_CONTEXT, existingContentHashes: new Set(), existingSourceUrls: new Set() },
  });
}

async function withStub(plan: FaultPlan, timeoutMs?: number): Promise<PipelineReport> {
  const stub = await startCommonsStub(plan);
  try {
    return await runAgainst(stub.origin, timeoutMs);
  } finally {
    await stub.close();
  }
}

/** Every fault scenario must satisfy all of this, whatever else it does. */
function assertOutageIsNotAnEmptyShelf(report: PipelineReport, label: string): void {
  assert.notEqual(report.outcome.state, "NO_RESULTS", `${label}: a failed search reported NO_RESULTS`);
  assert.notEqual(report.outcome.state, "USABLE_CANDIDATE_FOUND", `${label}: a failed search accepted a candidate`);
  assert.equal(report.status, "provider_unavailable", `${label}: legacy status must be provider_unavailable`);
  assert.equal(report.proposedRow, null, `${label}: a failed search proposed a row`);
  assert.equal(report.publicationSafety, null, `${label}: a failed search reached publication validation`);
  assert.equal(report.ranking, null, `${label}: a failed search ranked something`);
  assert.equal(
    report.evaluations.filter((e) => e.accepted).length,
    0,
    `${label}: a failed search accepted candidates`
  );
  // The narrative a human reads must say the search did not happen.
  assert.match(
    report.narrative,
    /DID NOT COMPLETE|THE SEARCH DID NOT HAPPEN|could not read|misread/i,
    `${label}: the narrative does not say the search failed`
  );
}

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------

test("CONTROL healthy: replaying the real Commons responses reaches USABLE_CANDIDATE_FOUND", async () => {
  const report = await withStub(() => ({ kind: "fixture" }));

  assert.equal(report.outcome.state, "USABLE_CANDIDATE_FOUND");
  assert.equal(report.status, "resolved");
  assert.ok(report.proposedRow, "the healthy run must produce a proposed row");
  assert.equal(report.proposedRow?.rights_status, "pending_verification");
  // Even the healthy path is not permission.
  assert.equal(report.publicationSafety?.safe, true);
  assert.equal(report.publicationSafety?.publishEligibility.allowed, false);
});

test("CONTROL genuinely empty: well-formed empty answers DO reach NO_RESULTS", async () => {
  const report = await withStub((f) => ({ kind: "respond", status: 200, body: HONEST_EMPTY[f.stage] }));

  assert.equal(report.outcome.state, "NO_RESULTS");
  assert.equal(report.status, "no_results");
  assert.equal(report.outcome.evidence.responsesFailed, 0);
  assert.ok(report.outcome.evidence.responsesParsed > 0, "NO_RESULTS has to be able to count what it read");
  assert.equal(report.outcome.evidence.parseAnomalies.length, 0);
});

// ---------------------------------------------------------------------------
// Transport-level faults
// ---------------------------------------------------------------------------

test("CHAOS connection refused: a dead port is an outage, never an empty shelf", async () => {
  const dead = await reservedDeadOrigin();
  const report = await runAgainst(dead);

  assertOutageIsNotAnEmptyShelf(report, "connection refused");
  assert.equal(report.outcome.state, "PROVIDER_OUTAGE");
  assert.ok(
    report.outcome.because.some((b) => /non-answer \(outage/.test(b)),
    `expected an outage non-answer, got: ${report.outcome.because.join(" / ")}`
  );
  assert.ok(report.outcome.evidence.responsesFailed > 0, "the attestation must record the failed responses");
});

test("CHAOS timeout: a server that never answers is an outage, never an empty shelf", async () => {
  const report = await withStub(() => ({ kind: "hang" }), 80);

  assertOutageIsNotAnEmptyShelf(report, "timeout");
  assert.equal(report.outcome.state, "PROVIDER_OUTAGE");
  assert.ok(report.outcome.evidence.responsesFailed > 0);
});

test("CHAOS socket destroyed mid-request: an outage, never an empty shelf", async () => {
  const report = await withStub(() => ({ kind: "destroy" }));

  assertOutageIsNotAnEmptyShelf(report, "socket destroyed");
  assert.equal(report.outcome.state, "PROVIDER_OUTAGE");
});

// ---------------------------------------------------------------------------
// Status-code faults
// ---------------------------------------------------------------------------

for (const status of [500, 502, 503, 429]) {
  test(`CHAOS HTTP ${status}: reported as an outage, never as NO_RESULTS`, async () => {
    const report = await withStub(() => ({
      kind: "respond",
      status,
      body: status === 429 ? HTML_RATE_LIMIT_PAGE : HTML_ERROR_PAGE,
      contentType: "text/html; charset=utf-8",
    }));

    assertOutageIsNotAnEmptyShelf(report, `HTTP ${status}`);
    assert.equal(report.outcome.state, "PROVIDER_OUTAGE");
    assert.ok(
      report.outcome.because.some((b) => new RegExp(`HTTP ${status}`).test(b)),
      `the real status line must survive into the explanation; got: ${report.outcome.because.join(" / ")}`
    );
  });
}

// ---------------------------------------------------------------------------
// 200-carrying-something-else faults
// ---------------------------------------------------------------------------

test("CHAOS HTTP 200 carrying HTML: a defect in us, reported as PROVIDER_PARSE_FAILURE", async () => {
  const report = await withStub(() => ({
    kind: "respond",
    status: 200,
    body: HTML_ERROR_PAGE,
    contentType: "text/html; charset=utf-8",
  }));

  assertOutageIsNotAnEmptyShelf(report, "200 + HTML");
  assert.equal(report.outcome.state, "PROVIDER_PARSE_FAILURE");
  assert.ok(
    report.outcome.because.some((b) => /could not be parsed/.test(b)),
    report.outcome.because.join(" / ")
  );
});

test("CHAOS HTTP 200 carrying an HTML throttle page: read as a rate limit, not as JSON", async () => {
  const report = await withStub(() => ({
    kind: "respond",
    status: 200,
    body: HTML_RATE_LIMIT_PAGE,
    contentType: "text/html; charset=utf-8",
  }));

  assertOutageIsNotAnEmptyShelf(report, "200 + throttle HTML");
  assert.equal(report.outcome.state, "PROVIDER_OUTAGE");
  assert.ok(
    report.outcome.because.some((b) => /rate_limited/.test(b)),
    report.outcome.because.join(" / ")
  );
});

test("CHAOS HTTP 200 carrying a MediaWiki error object: PROVIDER_PARSE_FAILURE", async () => {
  const report = await withStub(() => ({
    kind: "respond",
    status: 200,
    body: JSON.stringify({ error: { code: "readapidenied", info: "You need read permission to use this module." } }),
  }));

  assertOutageIsNotAnEmptyShelf(report, "200 + API error");
  assert.equal(report.outcome.state, "PROVIDER_PARSE_FAILURE");
  assert.ok(
    report.outcome.because.some((b) => /readapidenied/.test(b)),
    report.outcome.because.join(" / ")
  );
});

test("CHAOS HTTP 200 carrying valid JSON of an unrecognised shape: PROVIDER_PARSE_FAILURE, not NO_RESULTS", async () => {
  // The nastiest of the set: nothing throws, nothing is non-200, the body is
  // valid JSON. `query.search` is simply absent — which MediaWiki never does for
  // a search with no hits, because a hitless search returns an EMPTY ARRAY.
  const report = await withStub(() => ({ kind: "respond", status: 200, body: JSON.stringify({ batchcomplete: true }) }));

  assert.notEqual(report.outcome.state, "NO_RESULTS", "an unreadable body must never report as an empty shelf");
  assert.equal(report.outcome.state, "PROVIDER_PARSE_FAILURE");
  assert.equal(report.status, "provider_unavailable");
  assert.equal(report.proposedRow, null);
  assert.ok(report.outcome.evidence.parseAnomalies.length > 0, "the anomaly must be recorded, not swallowed");
  assert.ok(
    report.outcome.evidence.parseAnomalies.some((a) => /EMPTY array/.test(a.detail)),
    JSON.stringify(report.outcome.evidence.parseAnomalies)
  );
  // And it must NOT have counted those bodies as successfully parsed answers.
  assert.equal(report.outcome.evidence.responsesFailed, 0, "these were 200s that parsed as JSON");
  assert.ok(report.outcome.evidence.responsesParsed > 0);
});

// ---------------------------------------------------------------------------
// Partial failure
// ---------------------------------------------------------------------------

test("CHAOS outage on the FIRST request only: the later queries cannot rescue it into NO_RESULTS", async () => {
  let first = true;
  const report = await withStub((f) => {
    if (first && f.stage === "search") {
      first = false;
      return { kind: "respond", status: 500, body: HTML_ERROR_PAGE, contentType: "text/html" };
    }
    return { kind: "respond", status: 200, body: HONEST_EMPTY[f.stage] };
  });

  // Everything after the first request answered honestly and found nothing. The
  // run still may not claim the shelf is empty, because one query never ran.
  assert.notEqual(report.outcome.state, "NO_RESULTS");
  assert.equal(report.outcome.state, "PROVIDER_OUTAGE");
  assert.equal(report.status, "provider_unavailable");
});

// ---------------------------------------------------------------------------
// KNOWN DEFECT — recorded, not asserted as correct
// ---------------------------------------------------------------------------

/**
 * A partial outage IS currently indistinguishable from a finding about the world.
 *
 * `search()` builds `hardFailure` as it goes, and then throws it away:
 *
 *     if (fileTitles.size === 0) {
 *       return { outcome: hardFailure ?? { status: "no_results" }, ... };
 *     }
 *     ...
 *     return { outcome: { status: "ok" }, candidates, queryLog, attestation: attestation() };
 *
 * If ANY file title survived, the outcome is `ok` however many requests failed.
 * `classifySearchOutcome` only consults `evidence.responsesFailed` on the
 * zero-candidate branch (rule 6), so on every other branch a failed response is
 * invisible to the state machine.
 *
 * The two tests below are the demonstration: identical fixtures, identical
 * subject, one HTTP 500 on the Phase D metadata batch — and a run that otherwise
 * reports USABLE_CANDIDATE_FOUND with three accepted CC BY-SA 4.0 photographs
 * instead reports WRONG_ENTITY_RESULTS, whose documented meaning is
 * "candidates were found and not one of them is the exact subject … the search
 * worked; the material is not a photograph of this product."
 *
 * That is a positive, permanent-sounding claim about the world, produced by a
 * lost request. It is the `anon`-grants incident of CLAUDE.md in a new costume:
 * a failure wearing the face of a finding. These tests pin the CURRENT behaviour
 * so the day it is fixed, they fail and say so.
 */
test("KNOWN DEFECT: an outage on the metadata batch is reported as a finding about the world", async () => {
  // Phase A/B answer with the real Commons payloads, so three real candidates
  // exist. The Phase D metadata batch — the request that supplies categories and
  // MIME type to the entity gate — then fails outright.
  const report = await withStub((f) =>
    f.stage === "enrich"
      ? { kind: "respond", status: 500, body: HTML_ERROR_PAGE, contentType: "text/html" }
      : { kind: "fixture" }
  );

  // What IS still true, and is the only reason this is a defect rather than an
  // incident: nothing was accepted and nothing publishable was produced.
  assert.equal(report.evaluations.filter((e) => e.accepted).length, 0);
  assert.equal(report.proposedRow, null);
  assert.notEqual(report.outcome.state, "NO_RESULTS");

  // The failure IS recorded — in the attestation, which no rule reads here.
  assert.equal(report.outcome.evidence.responsesFailed, 1, "the attestation records the lost response");

  // …and yet the state machine reports a clean negative about the material.
  assert.equal(
    report.outcome.state,
    "WRONG_ENTITY_RESULTS",
    "if this now reports an engine fault, the defect has been fixed — delete this test and its note"
  );
  assert.equal(report.status, "no_acceptable_candidate");
  assert.match(
    report.narrative,
    /the search worked and the material is unsuitable/i,
    "the narrative asserts the search worked, which is false"
  );
});

test("KNOWN DEFECT, the contrast: the identical run without that one fault accepts three candidates", async () => {
  const report = await withStub(() => ({ kind: "fixture" }));
  assert.equal(report.outcome.state, "USABLE_CANDIDATE_FOUND");
  assert.equal(report.evaluations.filter((e) => e.accepted).length, 3);
});
