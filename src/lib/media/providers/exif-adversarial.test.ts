// ADVERSARIAL MATRIX for embedded (EXIF/IPTC/XMP) rights metadata.
//
// WHY EVERY ROW ASSERTS A VERDICT AND NOT A PARSED STRING
// ------------------------------------------------------
// A test asserting `unwrapMetaValue(theLangShape) === "©2008 Charles Lanteigne"`
// would have passed on the day the original bug shipped, because the bug was
// never in what the parser returned — it was in what the SYSTEM concluded from
// it. The first fix carries exactly the same exposure: it returns `null` for
// every shape it cannot interpret, `null` is also what a file with no Copyright
// field returns, and the system's conclusion from "no Copyright field" is
// *proceed*.
//
// So every row below is driven through the REAL pipeline against the REAL
// captured Commons payloads (chaos-fixtures.json, 2026-08-22), with one
// embedded field's value replaced. What is asserted is where the candidate
// ended up:
//
//   PROCEEDS        every gate cleared, and the engine ceiling still held
//   RIGHTS_CONFLICT the file contradicts its own licence — a finding about the FILE
//   PARSE_FAILURE   a rights-bearing field is present and unreadable — a finding
//                   about the READER, which also blocks
//
// The distinction between the last two is not decoration: one says "read this
// file's permission note", the other says "fix this parser", and the 2026-08
// `|other versions=` regression cost four photographs precisely because only
// the first message ever got printed.

import { test } from "node:test";
import assert from "node:assert/strict";
import { runAcquisitionPipeline, type PipelineReport } from "./pipeline.ts";
import { DEFAULT_RANKING_CONTEXT } from "./ranking.ts";
import {
  CommonsClient,
  createCommonsProvider,
  exifRightsConflict,
  readEmbeddedField,
  unwrapMetaRead,
} from "./wikimedia-commons.ts";
import { ENGINE_MAX_RIGHTS_STATUS } from "./types.ts";
import { FIXTURE_SUBJECT, startCommonsStub, stubFetch } from "./chaos-support.ts";

type Bucket = "commonmetadata" | "metadata";
type Plant = { [K in Bucket]?: unknown } & { remove?: Bucket[] };

type MetaEntry = { name: string | number; value?: unknown };
type ExifPage = { imageinfo?: Partial<Record<Bucket, MetaEntry[]>>[] };

/** Replace (or create, or delete) one embedded field inside the captured payload. */
function plantField(body: string, field: string, plan: Plant): string {
  const parsed = JSON.parse(body) as { query?: { pages?: ExifPage[] } };
  for (const page of parsed.query?.pages ?? []) {
    const ii = page.imageinfo?.[0];
    if (!ii) continue;
    for (const bucket of ["commonmetadata", "metadata"] as Bucket[]) {
      const list = ii[bucket];
      if (!list) continue;
      if (plan.remove?.includes(bucket)) {
        ii[bucket] = list.filter((m) => String(m.name).toLowerCase() !== field.toLowerCase());
        continue;
      }
      if (!(bucket in plan)) continue;
      const value = plan[bucket];
      const hit = list.find((m) => String(m.name).toLowerCase() === field.toLowerCase());
      if (hit) hit.value = value;
      else list.push({ name: field, value });
    }
  }
  return JSON.stringify(parsed);
}

async function runWithField(field: string, plan: Plant): Promise<PipelineReport> {
  const stub = await startCommonsStub((facts) =>
    facts.stage === "resolve" ? { kind: "fixture_edited", edit: (b) => plantField(b, field, plan) } : { kind: "fixture" }
  );
  try {
    const client = new CommonsClient(stubFetch(stub.origin), 0);
    const provider = createCommonsProvider({ identity: FIXTURE_SUBJECT, client, maxCategories: 1, maxPerCategory: 12 });
    return await runAcquisitionPipeline(FIXTURE_SUBJECT, [provider], {
      maxCandidates: 3,
      ranking: { ...DEFAULT_RANKING_CONTEXT, existingContentHashes: new Set<string>(), existingSourceUrls: new Set<string>() },
    });
  } finally {
    await stub.close();
  }
}

type Verdict = "PROCEEDS" | "RIGHTS_CONFLICT" | "PARSE_FAILURE";

function verdictOf(report: PipelineReport): Verdict {
  const accepted = report.evaluations.filter((e) => e.accepted);
  if (accepted.length > 0 && report.outcome.state === "USABLE_CANDIDATE_FOUND") return "PROCEEDS";
  if (report.evaluations.some((e) => e.rejection?.code === "provider_malformed")) return "PARSE_FAILURE";
  if (report.evaluations.some((e) => e.rejection?.code === "rights_conflicting")) return "RIGHTS_CONFLICT";
  throw new Error(
    `neither accepted nor blocked for a reason this matrix models: ${report.outcome.state} / ` +
      report.evaluations.map((e) => e.rejection?.code ?? "accepted").join(",")
  );
}

/** The invariant that holds in EVERY row, whatever the verdict. */
function assertCeilingHeld(report: PipelineReport, label: string): void {
  for (const e of report.evaluations) {
    if (!e.rights) continue;
    assert.equal(e.rights.mayPublish, false, `${label}: mayPublish must be false`);
    assert.ok(
      e.rights.writableRightsStatus === null ||
        e.rights.writableRightsStatus === ENGINE_MAX_RIGHTS_STATUS ||
        e.rights.writableRightsStatus === "restricted",
      `${label}: writable rights status ${String(e.rights.writableRightsStatus)} is above the engine ceiling`
    );
  }
  if (report.proposedRow) {
    assert.equal(report.proposedRow.rights_status, ENGINE_MAX_RIGHTS_STATUS, `${label}: proposed row above the ceiling`);
  }
}

const ARR_TEXT = "©2026 Someone. All rights reserved.";
const BENIGN = "Francois Leblond";
/** Verbatim from live Commons, File:Canon EOS 5D.jpg, commonmetadata.UsageTerms. */
const CANON_USAGE_TERMS = "No Usage Rights Granted Without Written Authorization from Charles Lanteigne";

function deeplyNested(leaf: string, depth: number): unknown {
  let node: unknown = leaf;
  for (let i = 0; i < depth; i++) node = { level: node };
  return node;
}

type Row = { name: string; field?: string; plan: Plant; expect: Verdict; why: string };

const MATRIX: Row[] = [
  // --- plain strings -------------------------------------------------------
  {
    name: "plain string, a bare authorship line",
    plan: { commonmetadata: BENIGN, metadata: BENIGN },
    expect: "PROCEEDS",
    why: "CC does not waive copyright; naming the photographer is what a correctly licensed file looks like",
  },
  {
    name: "plain string asserting all rights reserved",
    plan: { commonmetadata: ARR_TEXT, metadata: ARR_TEXT },
    expect: "RIGHTS_CONFLICT",
    why: "the control — a reservation in the simplest possible shape",
  },
  {
    name: "empty string",
    plan: { commonmetadata: "", metadata: "" },
    expect: "PROCEEDS",
    why: "a field present and empty genuinely asserts nothing",
  },
  {
    name: "whitespace-only string",
    plan: { commonmetadata: "   \n\t  ", metadata: "\n\n" },
    expect: "PROCEEDS",
    why: "whitespace is the same nothing, and live Commons really does send trailing newlines",
  },
  {
    name: "'Some rights reserved', Creative Commons' own tagline",
    plan: { commonmetadata: "Some rights reserved", metadata: "Some rights reserved" },
    expect: "PROCEEDS",
    why: "a check that fired on CC's own slogan would refuse exactly the files this pipeline exists to find",
  },

  // --- numbers, booleans, null, undefined ----------------------------------
  {
    name: "a number",
    plan: { commonmetadata: 2008, metadata: 2008 },
    expect: "PROCEEDS",
    why: "a scalar is unambiguously readable — no parse is in doubt, it simply is not a reservation",
  },
  {
    name: "a boolean",
    plan: { commonmetadata: true, metadata: true },
    expect: "PROCEEDS",
    why: "same: readable, and asserts no restriction",
  },
  {
    name: "null",
    plan: { commonmetadata: null, metadata: null },
    expect: "PROCEEDS",
    why: "an explicit null is an empty field, not an unreadable one",
  },
  {
    name: "an entry with no value key at all (undefined)",
    plan: { commonmetadata: undefined, metadata: undefined },
    expect: "PROCEEDS",
    why: "JSON drops the key entirely; the field is present and carries nothing",
  },

  // --- arrays --------------------------------------------------------------
  {
    name: "array of plain strings, all benign",
    plan: { commonmetadata: [BENIGN, "Second Photographer"], metadata: [BENIGN, "Second Photographer"] },
    expect: "PARSE_FAILURE",
    why: "MediaWiki does not emit bare string arrays; joining them or picking one would be inventing a reading",
  },
  {
    name: "array of plain strings hiding a reservation",
    plan: {
      commonmetadata: ["©2026 Someone", "All rights reserved"],
      metadata: ["©2026 Someone", "All rights reserved"],
    },
    expect: "RIGHTS_CONFLICT",
    why: "unmodelled shape, VISIBLE reservation — a fact about the file beats a fact about the reader",
  },
  {
    name: "array of arrays, benign",
    plan: { commonmetadata: [[BENIGN], ["Someone"]], metadata: [[BENIGN], ["Someone"]] },
    expect: "PARSE_FAILURE",
    why: "nested arrays are not MediaWiki {name, value} entries",
  },
  {
    name: "array of arrays hiding a reservation",
    plan: { commonmetadata: [[["All rights reserved"]]], metadata: [[["All rights reserved"]]] },
    expect: "RIGHTS_CONFLICT",
    why: "the scan walks the raw structure rather than the interpreted value",
  },
  {
    name: "empty array",
    plan: { commonmetadata: [], metadata: [] },
    expect: "PROCEEDS",
    why: "an empty container is unambiguous: there is nothing in it",
  },

  // --- the real lang-structured shape --------------------------------------
  {
    name: "the real lang shape, benign (verbatim live GoPro payload)",
    plan: {
      commonmetadata: [{ name: "x-default", value: BENIGN }, { name: "_type", value: "lang" }],
      metadata: `${BENIGN}\n\n`,
    },
    expect: "PROCEEDS",
    why: "exactly what live Commons returns for the control file; a fail-closed reader still has to be right",
  },
  {
    name: "the real lang shape carrying a reservation",
    plan: {
      commonmetadata: [{ name: "x-default", value: ARR_TEXT }, { name: "_type", value: "lang" }],
      metadata: [{ name: "x-default", value: ARR_TEXT }, { name: "_type", value: "lang" }],
    },
    expect: "RIGHTS_CONFLICT",
    why: "THE ORIGINAL BUG: identical text was refused flat and accepted structured",
  },
  {
    name: "lang shape with only a _type marker and no language entries",
    plan: { commonmetadata: [{ name: "_type", value: "lang" }], metadata: [{ name: "_type", value: "lang" }] },
    expect: "PARSE_FAILURE",
    why: "the field is present and its content is missing, which is NOT the same as the field being absent",
  },
  {
    name: "lang shape whose reservation is in a non-default language",
    plan: {
      commonmetadata: [
        { name: "x-default", value: BENIGN },
        { name: "fr", value: "Tous droits réservés. All rights reserved." },
        { name: "_type", value: "lang" },
      ],
      metadata: [
        { name: "x-default", value: BENIGN },
        { name: "fr", value: "Tous droits réservés. All rights reserved." },
        { name: "_type", value: "lang" },
      ],
    },
    expect: "RIGHTS_CONFLICT",
    why: "picking x-default is a presentation choice; it must never become a rights choice",
  },
  {
    name: "ordered-list shape (_type ol) whose SECOND item reserves rights",
    plan: {
      commonmetadata: [
        { name: 0, value: BENIGN },
        { name: 1, value: "Do not reproduce." },
        { name: "_type", value: "ol" },
      ],
      metadata: [
        { name: 0, value: BENIGN },
        { name: 1, value: "Do not reproduce." },
        { name: "_type", value: "ol" },
      ],
    },
    expect: "RIGHTS_CONFLICT",
    why: "live Commons really uses _type 'ol' (File:Canon EOS 5D.jpg Artist); reading only item 0 is pick-the-first again",
  },

  // --- objects -------------------------------------------------------------
  {
    name: "a nested object, benign",
    plan: { commonmetadata: { nested: { deeper: BENIGN } }, metadata: { nested: { deeper: BENIGN } } },
    expect: "PARSE_FAILURE",
    why: "which key is the value is a guess, and a guess about a rights field is what this module refuses to make",
  },
  {
    name: "a nested object hiding a reservation",
    plan: {
      commonmetadata: { rights: { statement: "All rights reserved" } },
      metadata: { rights: { statement: "All rights reserved" } },
    },
    expect: "RIGHTS_CONFLICT",
    why: "unreadable shape, readable reservation",
  },
  {
    name: "an object with a value key but NO name key",
    plan: { commonmetadata: { value: BENIGN }, metadata: { value: BENIGN } },
    expect: "PARSE_FAILURE",
    why: "half a MediaWiki entry; the previous fix filtered it out and returned null, i.e. silence",
  },
  {
    name: "an object with a value key but no name, hiding a reservation",
    plan: { commonmetadata: { value: "All rights reserved" }, metadata: { value: "All rights reserved" } },
    expect: "RIGHTS_CONFLICT",
    why: "the exact shape the entries filter used to drop on the floor",
  },
  {
    name: "a reservation buried deeper than the scan will walk",
    plan: { commonmetadata: deeplyNested("All rights reserved", 20), metadata: deeplyNested("All rights reserved", 20) },
    expect: "PARSE_FAILURE",
    why: "past the depth budget the scan cannot see it — so the UNREADABLE shape has to block on its own, and does",
  },

  // --- the malformed value that stringifies to something benign ------------
  {
    name: "a value that is literally the old bug's output",
    plan: { commonmetadata: "[object Object],[object Object]", metadata: "[object Object],[object Object]" },
    expect: "PARSE_FAILURE",
    why:
      "a string no reservation pattern matches, which is exactly why the original bug read as a benign field. " +
      "It is a READER defect, so it blocks as one — 'fix this parser', not 'read this file's permission note'",
  },

  // --- duplicate entries across the two buckets that DISAGREE --------------
  {
    name: "buckets disagree: benign first, reservation second",
    plan: { commonmetadata: BENIGN, metadata: ARR_TEXT },
    expect: "RIGHTS_CONFLICT",
    why: "resolve() concatenates commonmetadata FIRST, so first-readable-wins silences the reservation behind it",
  },
  {
    name: "buckets disagree: reservation first, benign second",
    plan: { commonmetadata: ARR_TEXT, metadata: BENIGN },
    expect: "RIGHTS_CONFLICT",
    why: "the same pair in the other order must reach the same verdict — ordering may not decide a rights question",
  },
  {
    name: "buckets disagree, both benign",
    plan: { commonmetadata: BENIGN, metadata: "Someone Else Entirely" },
    expect: "RIGHTS_CONFLICT",
    why: "two different statements about who holds the rights; neither may be preferred and picking one is guessing",
  },
  {
    name: "buckets differ only in whitespace",
    plan: { commonmetadata: BENIGN, metadata: `  ${BENIGN}\n\n` },
    expect: "PROCEEDS",
    why: "THE LIVE SHAPE — a disagreement check firing on trailing newlines would refuse every real Commons file",
  },
  {
    name: "one bucket empty, the other carrying a reservation",
    plan: { commonmetadata: "", metadata: ARR_TEXT },
    expect: "RIGHTS_CONFLICT",
    why: "an empty rendering is not a second opinion that outvotes a populated one",
  },
  {
    name: "the field present in one bucket only",
    plan: { commonmetadata: ARR_TEXT, remove: ["metadata"] },
    expect: "RIGHTS_CONFLICT",
    why: "MediaWiki routinely renders one bucket and not the other; a single reservation is still a reservation",
  },
];

for (const row of MATRIX) {
  const field = row.field ?? "Copyright";
  test(`VERDICT [${field}] ${row.name} -> ${row.expect}`, async () => {
    const report = await runWithField(field, row.plan);
    const verdict = verdictOf(report);
    assert.equal(
      verdict,
      row.expect,
      `${row.name}: expected ${row.expect}, got ${verdict}. ${row.why}\n` +
        report.evaluations
          .map((e) => `  ${e.key}: ${e.rejection?.code ?? "ACCEPTED"} ${e.provenance?.conflicts.join(" | ") ?? ""}`)
          .join("\n")
    );
    assertCeilingHeld(report, row.name);
    if (row.expect !== "PROCEEDS") {
      assert.equal(report.proposedRow, null, `${row.name}: a blocked candidate must propose no row`);
      assert.equal(report.evaluations.filter((e) => e.accepted).length, 0, `${row.name}: nothing may be accepted`);
    }
    // Whatever happened, no stringified object may be recorded as if it were
    // something the file asserts.
    for (const e of report.evaluations) {
      for (const item of e.provenance?.evidence ?? []) {
        assert.ok(
          !item.detail.includes("[object Object]") || /could not be read|UNREADABLE/.test(item.detail),
          `${row.name}: a stringified object reached the provenance record as evidence: ${item.detail}`
        );
      }
    }
  });
}

// ---------------------------------------------------------------------------
// THE FIELD NOBODY WAS READING
// ---------------------------------------------------------------------------
//
// Found on 2026-08-22 by reading the LIVE embedded metadata of File:Canon EOS
// 5D.jpg — the file this project has cited for months as the reason the EXIF
// cross-check exists. Its `Copyright` field says "©2008 Charles Lanteigne",
// which is a bare copyright notice and correctly NOT a conflict. The actual
// reservation is one field along, in a field this module never read:
//
//   commonmetadata.UsageTerms = [{"name":"x-default","value":
//     "No Usage Rights Granted Without Written Authorization from Charles Lanteigne"},
//    {"name":"_type","value":"lang"}]
//
// Unwrapping the lang shape — the whole of the previous fix — made the
// Copyright field readable and changed NOTHING about this file's verdict,
// because the reservation was never in the field being read. Two separate
// defects wearing the same costume.

test("VERDICT: the reservation in File:Canon EOS 5D.jpg's real UsageTerms field blocks", async () => {
  const report = await runWithField("UsageTerms", {
    commonmetadata: [{ name: "x-default", value: CANON_USAGE_TERMS }, { name: "_type", value: "lang" }],
    metadata: `${CANON_USAGE_TERMS}\n\n`,
  });
  assert.equal(verdictOf(report), "RIGHTS_CONFLICT");
  assert.ok(
    report.evaluations.some((e) => e.provenance?.conflicts.some((c) => /no rights are granted/i.test(c))),
    report.evaluations.map((e) => e.provenance?.conflicts.join(" | ")).join(" // ")
  );
  assertCeilingHeld(report, "canon usage terms");
});

test("VERDICT: a free licence in embedded UsageTerms is NOT a reservation", async () => {
  // The same field, on a correctly licensed file, carries the licence itself.
  // Reading a new field must not turn every properly tagged upload into a
  // conflict — that is the ten-false-alarms failure in a different costume.
  const report = await runWithField("UsageTerms", {
    commonmetadata: [
      { name: "x-default", value: "Creative Commons Attribution-ShareAlike 4.0 International" },
      { name: "_type", value: "lang" },
    ],
    metadata: "Creative Commons Attribution-ShareAlike 4.0 International\n\n",
  });
  assert.equal(verdictOf(report), "PROCEEDS");
  assertCeilingHeld(report, "free usage terms");
});

test("VERDICT: an unreadable UsageTerms blocks even though Copyright reads clean", async () => {
  const report = await runWithField("UsageTerms", {
    commonmetadata: { terms: { text: "not a shape we model" } },
    metadata: { terms: { text: "not a shape we model" } },
  });
  assert.equal(verdictOf(report), "PARSE_FAILURE");
  assertCeilingHeld(report, "unreadable usage terms");
});

test("VERDICT: a reservation written into the Artist field blocks", async () => {
  // Artist is read LAXLY for identity — an unreadable one is a missing credit,
  // not a hidden restriction. It is still SCANNED, because a photographer who
  // writes a reservation into it has still written a reservation.
  const report = await runWithField("Artist", {
    commonmetadata: [{ name: "x-default", value: `${BENIGN} — do not copy` }, { name: "_type", value: "lang" }],
    metadata: `${BENIGN} — do not copy`,
  });
  assert.equal(verdictOf(report), "RIGHTS_CONFLICT");
  assertCeilingHeld(report, "artist reservation");
});

test("VERDICT: an unreadable Artist does NOT block — it is not a rights assertion", async () => {
  const report = await runWithField("Artist", {
    commonmetadata: { who: { name: BENIGN } },
    metadata: { who: { name: BENIGN } },
  });
  assert.equal(verdictOf(report), "PROCEEDS", "refusing a photograph over an unreadable camera credit is not fail-closed, it is broken");
  assertCeilingHeld(report, "unreadable artist");
});

// ---------------------------------------------------------------------------
// Unit level: the reader's own vocabulary
// ---------------------------------------------------------------------------

test("unwrapMetaRead distinguishes absent, empty and UNREADABLE", () => {
  assert.deepEqual(unwrapMetaRead(""), { status: "empty" });
  assert.deepEqual(unwrapMetaRead("   "), { status: "empty" });
  assert.deepEqual(unwrapMetaRead(null), { status: "empty" });
  assert.deepEqual(unwrapMetaRead(undefined), { status: "empty" });
  assert.deepEqual(unwrapMetaRead([]), { status: "empty" });
  assert.deepEqual(unwrapMetaRead("  hello  "), { status: "read", value: "hello" });
  assert.deepEqual(unwrapMetaRead(7), { status: "read", value: "7" });
  assert.deepEqual(unwrapMetaRead(false), { status: "read", value: "false" });

  for (const shape of [
    { nested: { deeper: true } },
    { value: "no name key" },
    [{ name: "_type", value: "lang" }],
    [{ name: "_type", value: "something-new" }, { name: "x-default", value: "x" }],
    ["a", "b"],
    [[1], [2]],
    [{ name: "x-default", value: { deeper: "still" } }, { name: "_type", value: "lang" }],
  ]) {
    assert.equal(unwrapMetaRead(shape).status, "unreadable", `expected unreadable for ${JSON.stringify(shape)}`);
  }

  // The list forms MediaWiki really uses keep every item.
  assert.deepEqual(
    unwrapMetaRead([{ name: 0, value: "Charles Lanteigne" }, { name: "_type", value: "ol" }]),
    { status: "read", value: "Charles Lanteigne" }
  );
  assert.deepEqual(
    unwrapMetaRead([{ name: 0, value: "One" }, { name: 1, value: "Two" }, { name: "_type", value: "ul" }]),
    { status: "read", value: "One; Two" }
  );
});

test("readEmbeddedField never resolves a disagreement by picking one", () => {
  const disagreeing = readEmbeddedField(
    [
      { name: "Copyright", value: BENIGN },
      { name: "Copyright", value: ARR_TEXT },
    ],
    "Copyright"
  );
  assert.equal(disagreeing.status, "disagreeing");

  // ...and the reverse order reaches the same status, so nothing about the
  // answer depends on which bucket resolve() concatenated first.
  const reversed = readEmbeddedField(
    [
      { name: "Copyright", value: ARR_TEXT },
      { name: "Copyright", value: BENIGN },
    ],
    "Copyright"
  );
  assert.equal(reversed.status, "disagreeing");

  // The live shape — one lang-structured, one flat with trailing newlines — is
  // ONE value, not two.
  assert.deepEqual(
    readEmbeddedField(
      [
        { name: "Copyright", value: [{ name: "x-default", value: BENIGN }, { name: "_type", value: "lang" }] },
        { name: "Copyright", value: `${BENIGN}\n\n` },
      ],
      "Copyright"
    ),
    { status: "read", value: BENIGN }
  );

  assert.deepEqual(readEmbeddedField([{ name: "Artist", value: "x" }], "Copyright"), { status: "absent" });
  assert.deepEqual(readEmbeddedField(undefined, "Copyright"), { status: "absent" });

  // An unreadable entry poisons the read even when a readable one sits beside
  // it: we cannot rule out that the one we could not read said something else.
  assert.equal(
    readEmbeddedField(
      [
        { name: "Copyright", value: { some: "unmodelled shape" } },
        { name: "Copyright", value: BENIGN },
      ],
      "Copyright"
    ).status,
    "unreadable"
  );

  // An EMPTY entry beside a populated one is not a disagreement — MediaWiki
  // renders one bucket and not the other all the time, and an entry that says
  // nothing is not a second opinion.
  assert.deepEqual(
    readEmbeddedField(
      [
        { name: "Copyright", value: "" },
        { name: "Copyright", value: ARR_TEXT },
      ],
      "Copyright"
    ),
    { status: "read", value: ARR_TEXT }
  );
});

test("the reservation patterns catch the real live sentence, and spare the real live licences", () => {
  assert.ok(exifRightsConflict(CANON_USAGE_TERMS), "the live Canon EOS 5D reservation must be caught");
  assert.ok(exifRightsConflict("Unauthorized use prohibited"));
  assert.ok(exifRightsConflict("This image may not be reproduced without permission"));
  assert.ok(exifRightsConflict("Written permission required"));
  assert.ok(exifRightsConflict("Commercial use is strictly prohibited"));
  assert.ok(exifRightsConflict("[object Object],[object Object]"), "the old bug's own output must never read as benign");

  for (const benign of [
    BENIGN,
    "©2008 Charles Lanteigne",
    "Some rights reserved",
    "Creative Commons Attribution-ShareAlike 4.0 International",
    "CC BY-SA 4.0",
    "https://creativecommons.org/licenses/by-sa/4.0/",
    "Kārlis Dambrāns from Latvia",
    "",
    null,
  ]) {
    assert.equal(exifRightsConflict(benign), null, `must not fire on ${JSON.stringify(benign)}`);
  }
});
