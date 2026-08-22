// CHAOS: media_validation_outage_test.
//
// THE PROPERTY UNDER TEST
// ----------------------
// When the RIGHTS/VALIDATION stage itself breaks — not discovery, the stage that
// decides whether we may rely on a licence — the pipeline must FAIL CLOSED:
//
//   * no candidate is accepted;
//   * nothing is written at or above `ENGINE_MAX_RIGHTS_STATUS`
//     ('pending_verification'), and no proposed row is produced at all;
//   * the outcome NAMES THE FAULT rather than reporting a clean negative.
//
// The third clause is the one with teeth. A validation stage that dies and
// reports "candidates were found and every one was rejected" is exactly the
// `|other versions=` regression recorded in outcome.ts: four correctly-licensed
// CC BY-SA 4.0 photographs refused by a broken regex, invisible for as long as
// nobody read the per-candidate reasons, because the summary line was the same
// one a genuinely unusable shelf produces.
//
// WHAT IS ACTUALLY INDUCED
// ------------------------
// Discovery is served the VERBATIM responses Wikimedia Commons returned on
// 2026-08-22 (chaos-fixtures.json), so three real, well-licensed candidates
// exist every time and the healthy control accepts all three. The fault is then
// injected into the resolve request — the single call that carries the raw
// wikitext, the extmetadata licence, the EXIF and the sha1, i.e. the entire
// evidence base rights verification runs on:
//
//   1. the licence lookup is UNAVAILABLE          — HTTP 500 on resolve
//   2. the licence lookup dies mid-flight         — socket destroyed on resolve
//   3. the WIKITEXT FETCH FAILS, badge survives   — `revisions` stripped
//   4. BOTH licence reads die                     — `revisions` and `extmetadata` stripped
//   5. the two licence reads DISAGREE             — extmetadata licence altered
//   6. the surviving licence read says NC         — extmetadata licence made prohibitive
//   7. the licence lookup answers with HTML       — parse failure inside validation
//   8. the licence lookup answers a shape we do not know
//   9. the FIELD READER produces an unbelievable value — a second `permission=`
//  10. the validation stage THROWS                — a real exception mid-stage

import { test } from "node:test";
import assert from "node:assert/strict";
import { runAcquisitionPipeline, type PipelineReport } from "./pipeline.ts";
import { DEFAULT_RANKING_CONTEXT } from "./ranking.ts";
import { CommonsClient, createCommonsProvider } from "./wikimedia-commons.ts";
import type { SubjectIdentity } from "./query-expansion.ts";
import { ENGINE_MAX_RIGHTS_STATUS, type MediaProvider } from "./types.ts";
import { isEngineFault } from "./outcome.ts";
import {
  FIXTURE_SUBJECT,
  HTML_ERROR_PAGE,
  startCommonsStub,
  stubFetch,
  type FaultPlan,
} from "./chaos-support.ts";

const SUBJECT: SubjectIdentity = FIXTURE_SUBJECT;

function providerFor(origin: string): MediaProvider {
  const client = new CommonsClient(stubFetch(origin), 0);
  return createCommonsProvider({ identity: SUBJECT, client, maxCategories: 1, maxPerCategory: 12 });
}

async function withStub(plan: FaultPlan, wrap?: (p: MediaProvider) => MediaProvider): Promise<PipelineReport> {
  const stub = await startCommonsStub(plan);
  try {
    const provider = providerFor(stub.origin);
    return await runAcquisitionPipeline(SUBJECT, [wrap ? wrap(provider) : provider], {
      maxCandidates: 3,
      ranking: { ...DEFAULT_RANKING_CONTEXT, existingContentHashes: new Set(), existingSourceUrls: new Set() },
    });
  } finally {
    await stub.close();
  }
}

// --- Fixture surgery, applied to the REAL captured resolve body -------------

type Page = {
  revisions?: { slots?: { main?: { content?: string } } }[];
  imageinfo?: { extmetadata?: Record<string, { value?: unknown }> }[];
};

function editResolve(body: string, mutate: (page: Page) => void): string {
  const parsed = JSON.parse(body) as { query?: { pages?: Page[] } };
  for (const page of parsed.query?.pages ?? []) mutate(page);
  return JSON.stringify(parsed);
}

// --- The invariant every scenario must satisfy ------------------------------

function assertFailsClosed(report: PipelineReport, label: string): void {
  assert.equal(
    report.evaluations.filter((e) => e.accepted).length,
    0,
    `${label}: a broken validation stage accepted a candidate`
  );
  assert.equal(report.proposedRow, null, `${label}: a row was proposed`);
  assert.equal(report.publicationSafety, null, `${label}: publication validation was reached`);
  assert.equal(report.ranking, null, `${label}: something was ranked`);
  assert.notEqual(report.outcome.state, "USABLE_CANDIDATE_FOUND", `${label}`);
  assert.notEqual(report.outcome.state, "NO_RESULTS", `${label}: a broken validator reported an empty shelf`);

  // Nothing may be marked writable at or above the engine ceiling.
  for (const e of report.evaluations) {
    const writable = e.rights?.writableRightsStatus;
    assert.notEqual(
      writable,
      ENGINE_MAX_RIGHTS_STATUS,
      `${label}: ${e.key} was cleared to write rights_status='${ENGINE_MAX_RIGHTS_STATUS}'`
    );
    assert.ok(
      writable === undefined || writable === null || writable === "restricted",
      `${label}: ${e.key} produced an unexpected writable rights status ${JSON.stringify(writable)}`
    );
    assert.equal(e.rights?.mayPublish ?? false, false, `${label}: ${e.key} claimed mayPublish`);
    if (e.rights) assert.equal(e.rights.mayAcquire, false, `${label}: ${e.key} was cleared to acquire bytes`);
  }
}

/** The fault must be NAMED — either as an engine fault, or by a blocker code. */
function assertNamesTheFault(report: PipelineReport, expectedCodes: string[], label: string): void {
  const blockerCodes = new Set(
    report.evaluations.flatMap((e) => (e.rights?.findings ?? []).filter((f) => f.severity === "blocker").map((f) => f.code))
  );
  const rejectionCodes = new Set(report.evaluations.map((e) => e.rejection?.code).filter(Boolean));
  const named =
    isEngineFault(report.outcome.state) ||
    expectedCodes.some((c) => blockerCodes.has(c) || rejectionCodes.has(c as never));
  assert.ok(
    named,
    `${label}: the outcome (${report.outcome.state}) names neither an engine fault nor any of ` +
      `${expectedCodes.join("/")}. blockers=${[...blockerCodes].join(",")} rejections=${[...rejectionCodes].join(",")}`
  );
}

// ---------------------------------------------------------------------------
// Control
// ---------------------------------------------------------------------------

test("CONTROL: with validation healthy, all three real candidates clear every gate", async () => {
  const report = await withStub(() => ({ kind: "fixture" }));

  assert.equal(report.outcome.state, "USABLE_CANDIDATE_FOUND");
  assert.equal(report.evaluations.filter((e) => e.accepted).length, 3);
  for (const e of report.evaluations) {
    assert.equal(e.rights?.evidenceClass, "evidence_complete");
    assert.equal(e.rights?.writableRightsStatus, ENGINE_MAX_RIGHTS_STATUS);
  }
  // The ceiling holds even when everything works.
  assert.equal(report.proposedRow?.rights_status, ENGINE_MAX_RIGHTS_STATUS);
  assert.equal(report.publicationSafety?.safe, true);
});

// ---------------------------------------------------------------------------
// The licence lookup is unavailable
// ---------------------------------------------------------------------------

test("CHAOS licence lookup unavailable (HTTP 500 on resolve): fails closed and says the search did not happen", async () => {
  const report = await withStub((f) =>
    f.stage === "resolve"
      ? { kind: "respond", status: 500, body: HTML_ERROR_PAGE, contentType: "text/html" }
      : { kind: "fixture" }
  );

  assertFailsClosed(report, "resolve 500");
  assert.equal(report.outcome.state, "PROVIDER_OUTAGE");
  assert.equal(report.status, "provider_unavailable");
  assert.ok(
    report.evaluations.every((e) => e.rejection?.code === "provider_outage"),
    report.evaluations.map((e) => e.rejection?.code).join(",")
  );
  assert.ok(
    report.evaluations.every((e) => /unavailable check is a stop, never a skip/.test(e.rejection?.message ?? "")),
    "the refusal must say the check was unavailable, not that the file is bad"
  );
});

test("CHAOS licence lookup dies mid-flight (socket destroyed on resolve): fails closed as an outage", async () => {
  const report = await withStub((f) => (f.stage === "resolve" ? { kind: "destroy" } : { kind: "fixture" }));

  assertFailsClosed(report, "resolve destroyed");
  assert.equal(report.outcome.state, "PROVIDER_OUTAGE");
});

// ---------------------------------------------------------------------------
// The evidence base is degraded rather than absent
// ---------------------------------------------------------------------------

test("CHAOS wikitext fetch fails, the badge survives: a badge-only licence is a BLOCKER", async () => {
  // The single most dangerous degradation: the primary declaration is gone and
  // the rendered `extmetadata` licence — "CC BY-SA 4.0", perfectly reassuring —
  // is all that is left. This module's whole claim is that it reads the
  // declaration and not the badge, so the badge alone must not carry a candidate.
  const report = await withStub((f) =>
    f.stage === "resolve"
      ? { kind: "fixture_edited", edit: (b) => editResolve(b, (p) => delete p.revisions) }
      : { kind: "fixture" }
  );

  assertFailsClosed(report, "wikitext gone");
  assertNamesTheFault(report, ["licence_not_in_primary_source", "no_primary_licence_evidence"], "wikitext gone");
  assert.equal(report.outcome.state, "RIGHTS_UNCERTAIN");
  assert.ok(
    report.evaluations.every((e) =>
      (e.rights?.findings ?? []).some((x) => x.severity === "blocker" && x.code === "licence_not_in_primary_source")
    ),
    "every candidate must be blocked specifically on the licence being badge-only"
  );
  // The licence the badge asserted is still visible in the record — recorded,
  // and not relied on.
  assert.ok(report.evaluations.every((e) => e.provenance?.licenceMetadata === "CC BY-SA 4.0"));
  assert.ok(report.evaluations.every((e) => e.provenance?.licenceDeclared === null));
});

test("CHAOS both licence reads die: licence_absent, and no candidate survives", async () => {
  const report = await withStub((f) =>
    f.stage === "resolve"
      ? {
          kind: "fixture_edited",
          edit: (b) =>
            editResolve(b, (p) => {
              delete p.revisions;
              if (p.imageinfo?.[0]) delete p.imageinfo[0].extmetadata;
            }),
        }
      : { kind: "fixture" }
  );

  assertFailsClosed(report, "both licence reads dead");
  assertNamesTheFault(report, ["licence_absent", "no_primary_licence_evidence"], "both licence reads dead");
  assert.ok(
    report.evaluations.every((e) =>
      (e.rights?.findings ?? []).some((x) => x.severity === "blocker" && x.code === "licence_absent")
    )
  );
});

test("CHAOS the two licence reads DISAGREE: conflict blocks, and does not pick the friendlier one", async () => {
  const report = await withStub((f) =>
    f.stage === "resolve"
      ? {
          kind: "fixture_edited",
          edit: (b) =>
            editResolve(b, (p) => {
              const ext = p.imageinfo?.[0]?.extmetadata;
              if (ext) {
                ext.LicenseShortName = { value: "CC BY-SA 3.0" };
                ext.UsageTerms = { value: "Creative Commons Attribution-Share Alike 3.0" };
              }
            }),
        }
      : { kind: "fixture" }
  );

  assertFailsClosed(report, "licence disagreement");
  assertNamesTheFault(report, ["licence_metadata_mismatch"], "licence disagreement");
  assert.ok(
    report.evaluations.every((e) => e.rights?.evidenceClass === "evidence_conflicting"),
    report.evaluations.map((e) => e.rights?.evidenceClass).join(",")
  );
  assert.ok(report.evaluations.every((e) => e.rejection?.code === "rights_conflicting"));
});

test("CHAOS the surviving licence read says NonCommercial: positively restricted, never acquired", async () => {
  const report = await withStub((f) =>
    f.stage === "resolve"
      ? {
          kind: "fixture_edited",
          edit: (b) =>
            editResolve(b, (p) => {
              delete p.revisions;
              const ext = p.imageinfo?.[0]?.extmetadata;
              if (ext) {
                ext.LicenseShortName = { value: "CC BY-NC 4.0" };
                ext.UsageTerms = { value: "Creative Commons Attribution-NonCommercial 4.0" };
              }
            }),
        }
      : { kind: "fixture" }
  );

  assertFailsClosed(report, "NC only");
  assertNamesTheFault(report, ["licence_prohibitive"], "NC only");
  assert.ok(report.evaluations.every((e) => e.rights?.evidenceClass === "restricted"));
  assert.ok(report.evaluations.every((e) => e.rights?.writableRightsStatus === "restricted"));
  assert.ok(report.evaluations.every((e) => e.rights?.mayAcquire === false));
});

// ---------------------------------------------------------------------------
// The validation stage cannot read what it was given
// ---------------------------------------------------------------------------

test("CHAOS the licence lookup answers with HTML: PROVIDER_PARSE_FAILURE, not a rights finding", async () => {
  const report = await withStub((f) =>
    f.stage === "resolve"
      ? { kind: "respond", status: 200, body: HTML_ERROR_PAGE, contentType: "text/html" }
      : { kind: "fixture" }
  );

  assertFailsClosed(report, "resolve HTML");
  assert.equal(report.outcome.state, "PROVIDER_PARSE_FAILURE");
  assert.ok(report.evaluations.every((e) => e.rejection?.code === "provider_malformed"));
});

test("CHAOS the licence lookup answers a shape we do not know: PROVIDER_PARSE_FAILURE", async () => {
  // MediaWiki reports a MISSING file as a page object with missing:true. A body
  // with no `query.pages` at all is therefore not "the file is gone" — it is a
  // response this code does not understand, and the two must not collapse.
  const report = await withStub((f) =>
    f.stage === "resolve"
      ? { kind: "respond", status: 200, body: JSON.stringify({ batchcomplete: true, query: {} }) }
      : { kind: "fixture" }
  );

  assertFailsClosed(report, "resolve shape");
  assert.equal(report.outcome.state, "PROVIDER_PARSE_FAILURE");
  assert.ok(
    report.evaluations.every((e) => /unrecognised response shape/.test(e.rejection?.message ?? "")),
    report.evaluations.map((e) => e.rejection?.message).join(" | ")
  );
});

test("CHAOS the field reader produces an unbelievable value: reported as OUR defect, not the file's", async () => {
  // The `|other versions=` family, induced rather than imagined: a second
  // `permission=` declaration with different content makes the field
  // unreadable. The healthy version of this exact wikitext has an EMPTY
  // permission field, which is the normal state for an own-work CC upload — so
  // the ONLY difference between this run and the control is that our reader can
  // no longer say what the field holds.
  const report = await withStub((f) =>
    f.stage === "resolve"
      ? {
          kind: "fixture_edited",
          edit: (b) =>
            editResolve(b, (p) => {
              const main = p.revisions?.[0]?.slots?.main;
              if (main?.content !== undefined) {
                main.content = `${main.content}\n|permission=Ticket#2026082210004242\n`;
              }
            }),
        }
      : { kind: "fixture" }
  );

  assertFailsClosed(report, "ambiguous permission field");
  assert.equal(report.outcome.state, "PROVIDER_PARSE_FAILURE");
  assert.ok(report.evaluations.every((e) => e.rejection?.code === "provider_malformed"));
  assert.ok(
    report.evaluations.every((e) => /says the reader is wrong, not the file/.test(e.rejection?.message ?? "")),
    "the refusal must blame the parser, not the file's rights"
  );
  // And specifically NOT the "populated permission field" rights conflict, which
  // is what the original regression produced and what made it invisible.
  assert.ok(report.evaluations.every((e) => e.rejection?.code !== "rights_conflicting"));
});

// ---------------------------------------------------------------------------
// The validation stage throws
// ---------------------------------------------------------------------------

test("CHAOS the validation stage THROWS: the run aborts with nothing written, and no report is fabricated", async () => {
  const stub = await startCommonsStub(() => ({ kind: "fixture" }));
  try {
    const inner = providerFor(stub.origin);
    let resolveCalls = 0;
    const throwing: MediaProvider = {
      approval: inner.approval,
      search: inner.search.bind(inner),
      resolve: async () => {
        resolveCalls++;
        // The shape a dependency failure inside the rights stage really takes:
        // a TypeError from something that was assumed to be there.
        throw new TypeError("Cannot read properties of undefined (reading 'value')");
      },
    };

    await assert.rejects(
      () =>
        runAcquisitionPipeline(SUBJECT, [throwing], {
          maxCandidates: 3,
          ranking: { ...DEFAULT_RANKING_CONTEXT, existingContentHashes: new Set(), existingSourceUrls: new Set() },
        }),
      (e: unknown) => e instanceof TypeError && /reading 'value'/.test((e as Error).message),
      "the exception must propagate rather than being absorbed into a result"
    );
    assert.equal(resolveCalls, 1, "the run must stop at the first throw, not carry on to the next candidate");
  } finally {
    await stub.close();
  }
});

// ---------------------------------------------------------------------------
// KNOWN DEFECT — the EXIF cross-check is blind to multilingual values
// ---------------------------------------------------------------------------

/**
 * `metaValue()` in wikimedia-commons.ts does `String(hit.value).trim()`.
 *
 * MediaWiki returns some embedded metadata as a STRUCTURED value rather than a
 * string. Both files below are real, and both do it for `Copyright`:
 *
 *   File:GoPro Héro 13 Black - 01.jpg  commonmetadata Copyright =
 *       [{"name":"x-default","value":"Francois Leblond"},{"name":"_type","value":"lang"}]
 *   File:Canon EOS 5D.jpg              commonmetadata Copyright =
 *       [{"name":"x-default","value":"©2008 Charles Lanteigne"},{"name":"_type","value":"lang"}]
 *
 * `String()` of that is the literal text "[object Object],[object Object]", and
 * that is what the provenance record stores as primary evidence and what
 * `exifRightsConflict()` is handed. So:
 *
 *   * the evidence record states something FALSE about the file;
 *   * `exifRightsConflict()` cannot fire on any lang-typed EXIF Copyright,
 *     whatever it says — and that check is the one the project cites
 *     File:Canon_EOS_5D.jpg as the reason for.
 *
 * The correct flat value is present in the SAME response, under `metadata`
 * rather than `commonmetadata`; `resolve()` concatenates the two with
 * `commonmetadata` first and `.find()` therefore picks the broken one.
 *
 * The two tests below induce it on the real payload: the ONLY edit is the text
 * carried inside the real structured value. Identical text in the flat form is
 * refused; in the structured form the candidate is accepted and a row proposed.
 */
type ExifPage = { imageinfo?: { commonmetadata?: { name: string; value: unknown }[]; metadata?: { name: string; value: unknown }[] }[] };

function setExifCopyright(body: string, value: unknown): string {
  const parsed = JSON.parse(body) as { query?: { pages?: ExifPage[] } };
  for (const page of parsed.query?.pages ?? []) {
    for (const list of [page.imageinfo?.[0]?.commonmetadata, page.imageinfo?.[0]?.metadata]) {
      const hit = list?.find((m) => m.name === "Copyright");
      if (hit) hit.value = value;
    }
  }
  return JSON.stringify(parsed);
}

const ARR = "©2026 Someone. All rights reserved.";

test("CONTROL: an all-rights-reserved EXIF Copyright in FLAT form is caught and blocks", async () => {
  const report = await withStub((f) =>
    f.stage === "resolve" ? { kind: "fixture_edited", edit: (b) => setExifCopyright(b, ARR) } : { kind: "fixture" }
  );

  assertFailsClosed(report, "flat ARR exif");
  assert.ok(
    report.evaluations.every((e) => e.provenance?.conflicts.some((c) => /all rights reserved contradicts a free licence/i.test(c))),
    report.evaluations.map((e) => e.provenance?.conflicts.join("|")).join(" // ")
  );
  assert.ok(report.evaluations.every((e) => e.rejection?.code === "rights_conflicting"));
});

test("REGRESSION: a rights reservation is caught in lang-structured EXIF, exactly as in flat", async () => {
  // Exactly the shape Commons really returns, with exactly the text the control
  // above refuses.
  const report = await withStub((f) =>
    f.stage === "resolve"
      ? {
          kind: "fixture_edited",
          edit: (b) =>
            setExifCopyright(b, [
              { name: "x-default", value: ARR },
              { name: "_type", value: "lang" },
            ]),
        }
      : { kind: "fixture" }
  );

  // FIXED 2026-08-22. metaValue() now unwraps MediaWiki's lang-structured
  // values (x-default, then en, then the first non-_type entry) and searches
  // EVERY matching entry rather than only the first — commonmetadata is
  // concatenated ahead of metadata, and the same field appears in both, once
  // structured and once flat.
  //
  // Before the fix the identical text was refused in flat form and ACCEPTED in
  // this one, because String() of the structured value produced the literal
  // "[object Object],[object Object]" — a string no pattern matches, stored as
  // primary provenance evidence. It failed OPEN.
  assert.notEqual(
    report.outcome.state,
    "USABLE_CANDIDATE_FOUND",
    "a rights reservation must be seen whatever shape the API returns it in"
  );
  assert.equal(report.evaluations.filter((e) => e.accepted).length, 0);
  assert.ok(
    report.evaluations.some((e) => (e.provenance?.conflicts.length ?? 0) > 0),
    "the reservation must be recorded as a conflict"
  );
  // And the evidence now records what the field actually says.
  assert.ok(
    report.evaluations.every(
      (e) =>
        !e.provenance?.evidence.some(
          (x) => typeof x.detail === "string" && x.detail.includes("[object Object]")
        )
    ),
    "no stringified object may reach the provenance record"
  );
  assert.equal(report.proposedRow, null, "nothing is proposed from a refused candidate");
});

test("REGRESSION: the real Commons payload records the actual EXIF text, not a stringified object", async () => {
  const report = await withStub(() => ({ kind: "fixture" }));
  const evidence = report.evaluations[0]?.provenance?.evidence.find((e) => e.kind === "exif_copyright");
  // The truth was in the same response all along, one list along — the fix
  // reads whichever entry is actually readable rather than the first one.
  assert.ok(
    evidence === undefined || !String(evidence.detail).includes("[object Object]"),
    `provenance still records a stringified object: ${String(evidence?.detail)}`
  );
});

test("CHAOS the search stage THROWS: same — no report, no row, nothing swallowed", async () => {
  const stub = await startCommonsStub(() => ({ kind: "fixture" }));
  try {
    const inner = providerFor(stub.origin);
    const throwing: MediaProvider = {
      approval: inner.approval,
      search: async () => {
        throw new Error("licence lookup dependency unavailable");
      },
      resolve: inner.resolve.bind(inner),
    };

    await assert.rejects(
      () =>
        runAcquisitionPipeline(SUBJECT, [throwing], {
          maxCandidates: 3,
          ranking: { ...DEFAULT_RANKING_CONTEXT, existingContentHashes: new Set(), existingSourceUrls: new Set() },
        }),
      /licence lookup dependency unavailable/
    );
  } finally {
    await stub.close();
  }
});
