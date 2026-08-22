// The regression suite for the bug class this taxonomy exists to eliminate.
//
// THE BUG, ONCE MORE, BECAUSE THE TESTS ONLY MAKE SENSE AGAINST IT
// ----------------------------------------------------------------
// `informationField()` looked ahead for the next field as `\n|<name>=` with
// `<name>` matching `[a-zA-Z_]+`. `other versions` contains a space, so the
// lookahead never matched it, and `permission=` captured the literal text
// `|other versions=`. `meaningfulPermission()` saw a populated permission
// field. Every file in `Category:GoPro Hero 13 black` was refused as
// `rights_conflicting` — four correctly-licensed CC BY-SA 4.0 photographs,
// refused by a regex.
//
// It failed CLOSED, so nothing broke loudly. And the run summary said:
//
//     "candidates were found and every one was rejected"
//
// which is what a genuinely unusable shelf says. The failure was invisible
// because the OUTCOME VOCABULARY had no way to distinguish "the material is
// unsuitable" from "our reader is broken".
//
// So there are three layers of defence here and each has its own tests:
//
//   1. the parse is correct now                   (`|other versions=` fixture)
//   2. a parse that goes wrong ANYWAY is caught by looking at what came out
//      and asking whether it is believable        (fieldValueAnomaly)
//   3. even if 1 and 2 both fail, a whole search refused for one
//      parser-derived reason reports PROVIDER_PARSE_FAILURE rather than a
//      clean negative                             (assessRefusalPlausibility)
//
// Pure. No network — the Commons transport is stubbed with realistic bodies.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  classifySearchOutcome,
  assessRefusalPlausibility,
  refusalFamily,
  legacyStatusFor,
  isEngineFault,
  SEARCH_OUTCOME_STATES,
  OUTCOME_MEANINGS,
  UNIFORM_REFUSAL_MIN_CANDIDATES,
  type ProviderEpisode,
} from "./outcome.ts";
import { runAcquisitionPipeline, type CandidateEvaluation, type RejectionCode } from "./pipeline.ts";
import {
  CommonsClient,
  createCommonsProvider,
  COMMONS_APPROVAL,
  parseInformationField,
  informationField,
  fieldValueAnomaly,
  meaningfulPermission,
  licenceFromWikitext,
  type CommonsFetch,
} from "./wikimedia-commons.ts";
import { DEFAULT_RANKING_CONTEXT } from "./ranking.ts";
import { verifyRights } from "./rights-verification.ts";
import type { SubjectIdentity } from "./query-expansion.ts";
import type { ProvenanceRecord } from "./types.ts";

// ---------------------------------------------------------------------------
// Fixtures: a real Commons file page, as it is actually written
// ---------------------------------------------------------------------------

const GOPRO: SubjectIdentity = {
  canonicalName: "GoPro HERO13 Black",
  manufacturer: "GoPro",
  aliases: ["GoPro Hero 13 Black"],
  family: "GoPro HERO",
};

const rankingCtx = {
  ...DEFAULT_RANKING_CONTEXT,
  existingContentHashes: new Set<string>(),
  existingSourceUrls: new Set<string>(),
};

/**
 * The wikitext shape that broke the parser, reproduced faithfully.
 *
 * `|other versions=` is the LAST field of `{{Information}}` on a very large
 * share of Commons uploads, it is nearly always empty, and it sits directly
 * after `|permission=` — which is why one regex gap hit every file in a
 * category at once rather than one file in a hundred.
 */
const REAL_GOPRO_WIKITEXT = `=={{int:filedesc}}==
{{Information
|description={{fr|1=Caméra d'action GoPro Héro 13 Black sur trépied flexible}}
|date=2024-10-05
|source={{own}}
|author=[[User:François de Dijon|François Leblond]]
|permission=
|other versions=
}}

=={{int:license-header}}==
{{self|cc-by-sa-4.0}}

[[Category:GoPro Hero 13 black]]
`;

/**
 * The same page after a hypothetical future parser slip: `permission=` and
 * `other versions=` collapsed onto one line, so the value is genuinely
 * ambiguous rather than merely awkward to read.
 */
const AMBIGUOUS_GOPRO_WIKITEXT = REAL_GOPRO_WIKITEXT.replace(
  "|permission=\n|other versions=\n",
  "|permission=|other versions=\n"
);

const FILE_TITLES = [
  "File:GoPro Héro 13 Black - 01.jpg",
  "File:GoPro Héro 13 Black - 02.jpg",
  "File:GoPro Héro 13 Black - 03.jpg",
  "File:GoPro Héro 13 Black - 04.jpg",
];

/** A stubbed Commons transport that answers from the fixtures above. */
function commonsStub(options: { wikitext: string; dropSearchKey?: boolean }): {
  fetch: CommonsFetch;
  calls: number;
} {
  const state = { calls: 0 };
  const fetchImpl: CommonsFetch = async (url) => {
    state.calls++;
    const params = new URL(url).searchParams;
    const json = (body: unknown) => ({ status: 200, text: JSON.stringify(body) });

    if (params.get("list") === "search") {
      if (options.dropSearchKey) {
        // A 200 with valid JSON and no `query` key at all. MediaWiki returns
        // `query.search: []` for a search with no hits, so this is a response
        // shape we do not understand — NOT a finding that nothing matched.
        return json({ batchcomplete: true });
      }
      if (params.get("srnamespace") === "14") {
        return json({ batchcomplete: true, query: { search: [{ title: "Category:GoPro Hero 13 black" }] } });
      }
      return json({ batchcomplete: true, query: { searchinfo: { totalhits: 0 }, search: [] } });
    }

    if (params.get("list") === "categorymembers") {
      if (params.get("cmtype") === "subcat") {
        return json({ batchcomplete: true, query: { categorymembers: [] } });
      }
      return json({
        batchcomplete: true,
        query: { categorymembers: FILE_TITLES.map((title) => ({ title, ns: 6 })) },
      });
    }

    // prop=categories|imageinfo — the batch enrichment before entity matching.
    if (params.get("prop") === "categories|imageinfo") {
      const titles = (params.get("titles") ?? "").split("|");
      return json({
        batchcomplete: true,
        query: {
          pages: titles.map((title) => ({
            title,
            categories: [{ title: "Category:GoPro Hero 13 black" }],
            imageinfo: [{ mime: "image/jpeg", size: 2_400_000 }],
          })),
        },
      });
    }

    // prop=imageinfo|revisions|categories — the per-file resolve.
    const title = params.get("titles") ?? FILE_TITLES[0];
    const slug = title.replace(/^File:/, "").replace(/ /g, "_");
    const index = Math.max(0, FILE_TITLES.indexOf(title));
    return json({
      batchcomplete: true,
      query: {
        pages: [
          {
            title,
            categories: [{ title: "Category:GoPro Hero 13 black" }],
            imageinfo: [
              {
                url: `https://upload.wikimedia.org/wikipedia/commons/a/ab/${slug}?utm_source=commons.wikimedia.org`,
                descriptionurl: `https://commons.wikimedia.org/wiki/${slug}`,
                width: 4000,
                height: 2667,
                size: 2_400_000,
                mime: "image/jpeg",
                sha1: `${index}`.repeat(40).slice(0, 40),
                extmetadata: {
                  LicenseShortName: { value: "CC BY-SA 4.0" },
                  UsageTerms: { value: "Creative Commons Attribution-Share Alike 4.0" },
                  License: { value: "cc-by-sa-4.0" },
                  Artist: {
                    value:
                      '<a href="//commons.wikimedia.org/wiki/User:Fran%C3%A7ois_de_Dijon" title="User:François de Dijon">François Leblond</a>',
                  },
                  Credit: { value: "own work" },
                },
                commonmetadata: [
                  { name: "Artist", value: "Francois Leblond" },
                  { name: "Copyright", value: "Francois Leblond" },
                ],
              },
            ],
            revisions: [{ slots: { main: { content: options.wikitext } } }],
          },
        ],
      },
    });
  };
  return { fetch: fetchImpl, calls: state.calls };
}

function commonsProvider(options: { wikitext: string; dropSearchKey?: boolean }) {
  const stub = commonsStub(options);
  return createCommonsProvider({
    identity: GOPRO,
    // Spacing 0 and a no-op sleep: the 2500ms live spacing is a politeness
    // rule for Wikimedia, not a property under test.
    client: new CommonsClient(stub.fetch, 0, async () => {}),
  });
}

// ---------------------------------------------------------------------------
// 1. The parser itself
// ---------------------------------------------------------------------------

describe("regression: `|other versions=` must not be read as `permission=`", () => {
  test("the real GoPro upload parses correctly, field by field", () => {
    // The four photographs this fixture is copied from were refused for weeks.
    assert.deepEqual(parseInformationField(REAL_GOPRO_WIKITEXT, "permission"), { status: "empty" });
    assert.equal(informationField(REAL_GOPRO_WIKITEXT, "permission"), null);
    assert.equal(meaningfulPermission(informationField(REAL_GOPRO_WIKITEXT, "permission")), null);

    const author = parseInformationField(REAL_GOPRO_WIKITEXT, "author");
    assert.equal(author.status, "parsed");
    assert.equal(author.status === "parsed" ? author.value : null, "[[User:François de Dijon|François Leblond]]");

    const source = parseInformationField(REAL_GOPRO_WIKITEXT, "source");
    assert.equal(source.status, "parsed");
    assert.equal(source.status === "parsed" ? source.value : null, "{{own}}");

    // `|description={{fr|1=…}}` contains a `|1=` INSIDE a template. That is a
    // template argument, not a swallowed sibling field, and must not be
    // mistaken for one.
    const description = parseInformationField(REAL_GOPRO_WIKITEXT, "description");
    assert.equal(description.status, "parsed");

    assert.equal(licenceFromWikitext(REAL_GOPRO_WIKITEXT).licence, "CC BY-SA 4.0");
  });

  test("the exact string the old parser produced is now recognised as a parse failure", () => {
    // If the bug ever returns, THIS is what `permission=` will contain. The
    // reader no longer has to be right; it has to be checkable.
    const anomaly = fieldValueAnomaly("permission", "|other versions=");
    assert.ok(anomaly, "`|other versions=` as a permission value must not be believed");
    assert.match(anomaly!.detail, /other versions/);
    assert.match(anomaly!.detail, /swallowed|captured its neighbour|another template field/i);
    assert.match(anomaly!.where, /permission/);
  });

  test("an ambiguous field yields `ambiguous`, never a quiet empty or a quiet value", () => {
    const parsed = parseInformationField(AMBIGUOUS_GOPRO_WIKITEXT, "permission");
    assert.equal(parsed.status, "ambiguous");
    assert.match(parsed.status === "ambiguous" ? parsed.anomaly.detail : "", /other versions/);
  });

  test("the same field declared twice with different values is ambiguous, not last-wins", () => {
    const wt = "{{Information\n|permission=\n|author=X\n|permission=VRT ticket #2024010110000123\n}}";
    const parsed = parseInformationField(wt, "permission");
    assert.equal(parsed.status, "ambiguous");
  });

  test("a genuinely populated permission field is still read as a rights condition, not as a parse bug", () => {
    // The distinction the whole exercise turns on: this file DOES carry
    // something a human must read, and it must keep saying so.
    const wt = "{{Information\n|permission=VRT ticket #2024010110000123\n|other versions=\n}}";
    const parsed = parseInformationField(wt, "permission");
    assert.equal(parsed.status, "parsed");
    assert.equal(meaningfulPermission(informationField(wt, "permission")), "VRT ticket #2024010110000123");
    assert.equal(fieldValueAnomaly("permission", "VRT ticket #2024010110000123"), null);
  });

  test("a template fragment is a parse failure — the value was cut in the wrong place", () => {
    assert.ok(fieldValueAnomaly("source", "{{Own based on"));
    assert.ok(fieldValueAnomaly("author", "[[User:Someone"));
    assert.equal(fieldValueAnomaly("author", "[[User:Someone|Someone]]"), null);
    assert.equal(fieldValueAnomaly("source", "{{own}}"), null);
  });
});

// ---------------------------------------------------------------------------
// 2. End to end, through the real provider, over a stubbed transport
// ---------------------------------------------------------------------------

describe("regression, end to end: the four GoPro photographs", () => {
  test("the file that was refused for weeks now clears every gate", async () => {
    const report = await runAcquisitionPipeline(GOPRO, [commonsProvider({ wikitext: REAL_GOPRO_WIKITEXT })], {
      maxCandidates: 20,
      ranking: rankingCtx,
      storagePathFor: () => "image/hero.jpg",
    });

    assert.equal(report.outcome.state, "USABLE_CANDIDATE_FOUND", report.narrative);
    assert.equal(report.status, "resolved");
    assert.equal(report.evaluations.filter((e) => e.accepted).length, FILE_TITLES.length);
    assert.equal(
      report.evaluations.some((e) => e.rejection?.code === "rights_conflicting"),
      false,
      "the `|other versions=` bug refused all of these as rights_conflicting"
    );

    // Finding an image is still not permission to publish it.
    assert.equal(report.proposedRow!.rights_status, "pending_verification");
    assert.equal(report.publicationSafety!.safe, true);
    assert.equal(report.publicationSafety!.publishEligibility.allowed, false);
  });

  test("an unreadable permission field is PROVIDER_PARSE_FAILURE, not a silent refusal", async () => {
    const report = await runAcquisitionPipeline(GOPRO, [commonsProvider({ wikitext: AMBIGUOUS_GOPRO_WIKITEXT })], {
      maxCandidates: 20,
      ranking: rankingCtx,
    });

    // The whole point. Every one of these three would have been the old
    // answer, and every one of them looks like a fact about the world.
    assert.equal(report.outcome.state, "PROVIDER_PARSE_FAILURE", report.narrative);
    assert.notEqual(report.outcome.state, "NO_RESULTS");
    assert.notEqual(report.outcome.state, "WRONG_ENTITY_RESULTS");
    assert.notEqual(report.outcome.state, "RIGHTS_UNCERTAIN");

    assert.ok(isEngineFault(report.outcome.state), "this is a defect in us, not a finding about the catalogue");
    assert.equal(report.status, "provider_unavailable", "must not be filed as a negative search result");
    assert.ok(report.evaluations.every((e) => !e.accepted));
    assert.ok(
      report.evaluations.some((e) => e.rejection?.code === "provider_malformed"),
      "the refusal must name the parser, not the file's rights"
    );
    assert.match(report.narrative, /PARSE/i);
  });

  test("an empty Commons search reports NO_RESULTS only with an attestation behind it", async () => {
    const provider = createCommonsProvider({
      identity: GOPRO,
      client: new CommonsClient(
        async (url) => {
          const params = new URL(url).searchParams;
          if (params.get("list") === "search") {
            return { status: 200, text: JSON.stringify({ batchcomplete: true, query: { search: [] } }) };
          }
          return { status: 200, text: JSON.stringify({ batchcomplete: true, query: { categorymembers: [] } }) };
        },
        0,
        async () => {}
      ),
    });

    const report = await runAcquisitionPipeline(GOPRO, [provider], { maxCandidates: 20, ranking: rankingCtx });

    assert.equal(report.outcome.state, "NO_RESULTS", report.narrative);
    assert.ok(report.outcome.evidence.responsesParsed > 0, "NO_RESULTS must be able to say what it read");
    assert.equal(report.outcome.evidence.responsesFailed, 0);
    assert.equal(report.outcome.evidence.parseAnomalies.length, 0);
    assert.match(report.outcome.because.join(" "), /read and parsed/);
  });

  test("a 200 whose body we do not understand can never become NO_RESULTS", async () => {
    // Valid JSON, HTTP 200, no error field — and no `query` key. Nothing throws.
    // This is the silent-empty failure mode with the parser removed from the
    // picture entirely, and it is the one that hid for weeks in 2026-08.
    const report = await runAcquisitionPipeline(
      GOPRO,
      [commonsProvider({ wikitext: REAL_GOPRO_WIKITEXT, dropSearchKey: true })],
      { maxCandidates: 20, ranking: rankingCtx }
    );

    assert.equal(report.outcome.state, "PROVIDER_PARSE_FAILURE", report.narrative);
    assert.ok(report.outcome.evidence.parseAnomalies.length > 0);
    assert.match(report.outcome.evidence.parseAnomalies[0].detail, /EMPTY array|do not understand|not understand/i);
  });
});

// ---------------------------------------------------------------------------
// 3. Plausibility: the check that would have caught the bug on its own
// ---------------------------------------------------------------------------

function fakeEvaluation(over: {
  key: string;
  code: RejectionCode;
  blockerCodes?: string[];
  accepted?: boolean;
}): CandidateEvaluation {
  return {
    key: over.key,
    descriptor: { title: over.key, fileName: over.key, categories: [], descriptionText: null, mimeType: "image/jpeg" },
    provider: COMMONS_APPROVAL,
    stageReached: "rights",
    accepted: over.accepted ?? false,
    rejection: over.accepted ? null : { code: over.code, message: "test" },
    entityMatch: { verdict: "confirmed", confidence: 0.9, signals: [], reason: "test" },
    provenance: null,
    rights: over.blockerCodes
      ? {
          evidenceClass: "evidence_incomplete",
          rightsClass: "rights_uncertain",
          writableRightsStatus: null,
          mayAcquire: false,
          mayPublish: false,
          findings: over.blockerCodes.map((code) => ({ severity: "blocker" as const, code, message: "test" })),
          narrative: "test",
        }
      : null,
  };
}

const OK_EPISODE: ProviderEpisode = {
  approval: COMMONS_APPROVAL,
  searched: true,
  outcome: { status: "ok" },
  attestation: { responsesParsed: 12, responsesFailed: 0, parseAnomalies: [] },
  candidates: 8,
};

describe("plausibility: one bug repeated does not look like a clean negative", () => {
  test("every candidate refused for the SAME parser-derived reason is PROVIDER_PARSE_FAILURE", () => {
    // The 2026-08 shape exactly: eight files in one enumerated category, all
    // refused `rights_conflicting`, all for the same parsed field.
    const evaluations = Array.from({ length: 8 }, (_, i) =>
      fakeEvaluation({ key: `File:GoPro Héro 13 Black - 0${i}.jpg`, code: "rights_conflicting" })
    );

    const suspicions = assessRefusalPlausibility(evaluations);
    assert.equal(suspicions.length, 1);
    assert.equal(suspicions[0].kind, "uniform_parser_refusal");

    const outcome = classifySearchOutcome({ episodes: [OK_EPISODE], evaluations });
    assert.equal(outcome.state, "PROVIDER_PARSE_FAILURE");
    assert.match(outcome.because.join(" "), /other versions/, "the report should name the incident it generalises");
  });

  test("below the threshold it is an ordinary coincidence, not a suspicion", () => {
    const evaluations = Array.from({ length: UNIFORM_REFUSAL_MIN_CANDIDATES - 1 }, (_, i) =>
      fakeEvaluation({ key: `f${i}`, code: "rights_conflicting" })
    );
    assert.equal(assessRefusalPlausibility(evaluations).length, 0);
    assert.equal(classifySearchOutcome({ episodes: [OK_EPISODE], evaluations }).state, "RIGHTS_UNCERTAIN");
  });

  test("sixty candidates all refused as the wrong product is NOT a parse failure", () => {
    // The PS5 Pro search. Entity refusals are the normal, correct answer and
    // must keep reading as a fact about Commons rather than a bug in us —
    // otherwise the new alarm is as useless as the old silence.
    const evaluations = Array.from({ length: 60 }, (_, i) =>
      fakeEvaluation({ key: `f${i}`, code: "entity_mismatch" })
    );
    assert.equal(assessRefusalPlausibility(evaluations).length, 0);
    assert.equal(classifySearchOutcome({ episodes: [OK_EPISODE], evaluations }).state, "WRONG_ENTITY_RESULTS");
  });

  test("mixed refusal reasons are a genuine finding, not a uniform failure", () => {
    // The AMD Ryzen 9800X3D search: 48 of 56 on the same two rights codes, the
    // rest on other grounds. A real result, correctly reported as one.
    const evaluations = [
      ...Array.from({ length: 48 }, (_, i) =>
        fakeEvaluation({ key: `a${i}`, code: "rights_incomplete", blockerCodes: ["licence_not_in_primary_source"] })
      ),
      ...Array.from({ length: 8 }, (_, i) => fakeEvaluation({ key: `b${i}`, code: "entity_mismatch" })),
    ];
    assert.equal(assessRefusalPlausibility(evaluations).length, 0);
    assert.equal(classifySearchOutcome({ episodes: [OK_EPISODE], evaluations }).state, "RIGHTS_UNCERTAIN");
  });

  test("one accepted candidate ends the suspicion — the reader demonstrably works", () => {
    const evaluations = [
      ...Array.from({ length: 8 }, (_, i) => fakeEvaluation({ key: `f${i}`, code: "rights_conflicting" })),
      fakeEvaluation({ key: "good", code: "rights_conflicting", accepted: true }),
    ];
    assert.equal(assessRefusalPlausibility(evaluations).length, 0);
  });
});

// ---------------------------------------------------------------------------
// 4. Totality of the taxonomy
// ---------------------------------------------------------------------------

const ALL_REJECTION_CODES: RejectionCode[] = [
  "entity_mismatch",
  "entity_ambiguous",
  "provenance_unresolvable",
  "rights_restricted",
  "rights_conflicting",
  "rights_incomplete",
  "synthetic_imagery",
  "unsupported_media_type",
  "quality_below_floor",
  "duplicate_of_better",
  "duplicate_licence_conflict",
  "provider_outage",
  "provider_malformed",
];

describe("the taxonomy is total: every terminal path lands somewhere on purpose", () => {
  test("every rejection code maps to a refusal family (or is explicitly non-deciding)", () => {
    for (const code of ALL_REJECTION_CODES) {
      const family = refusalFamily(fakeEvaluation({ key: code, code, blockerCodes: ["licence_absent"] }));
      if (code === "duplicate_of_better") {
        assert.equal(family, null, "a deduplicated loser never decides an outcome on its own");
        continue;
      }
      assert.ok(family, `${code} has no refusal family`);
    }
  });

  test("`rights_incomplete` splits by WHAT is missing, because the human action differs", () => {
    const licenceDoubt = fakeEvaluation({ key: "a", code: "rights_incomplete", blockerCodes: ["licence_absent"] });
    assert.equal(refusalFamily(licenceDoubt), "rights");

    const fieldMissing = fakeEvaluation({ key: "b", code: "rights_incomplete", blockerCodes: ["creator_absent"] });
    assert.equal(refusalFamily(fieldMissing), "provenance");

    assert.equal(
      classifySearchOutcome({ episodes: [OK_EPISODE], evaluations: [fieldMissing] }).state,
      "PROVENANCE_INCOMPLETE"
    );
  });

  test("every state has a stated meaning and a legacy status", () => {
    for (const state of SEARCH_OUTCOME_STATES) {
      assert.ok(OUTCOME_MEANINGS[state] && OUTCOME_MEANINGS[state].length > 40, `${state} has no meaning written down`);
      assert.ok(legacyStatusFor(state));
    }
    assert.equal(legacyStatusFor("PROVIDER_PARSE_FAILURE"), "provider_unavailable");
    assert.equal(legacyStatusFor("PROVIDER_OUTAGE"), "provider_unavailable");
    assert.equal(legacyStatusFor("NO_RESULTS"), "no_results");
  });

  test("NO_RESULTS cannot be reached by default — it has to be earned", () => {
    // A provider that says "ok", returns nothing, and cannot attest to a single
    // response it parsed. Under the old vocabulary this was `no_results`.
    const unattested: ProviderEpisode = {
      approval: COMMONS_APPROVAL,
      searched: true,
      outcome: { status: "ok" },
      attestation: null,
      candidates: 0,
    };
    const outcome = classifySearchOutcome({ episodes: [unattested], evaluations: [] });
    assert.equal(outcome.state, "PROVIDER_PARSE_FAILURE");
    assert.match(outcome.because.join(" "), /silent reader failure/i);
  });

  test("an attestation recording zero parsed responses is not an empty shelf either", () => {
    const readNothing: ProviderEpisode = {
      approval: COMMONS_APPROVAL,
      searched: true,
      outcome: { status: "no_results" },
      attestation: { responsesParsed: 0, responsesFailed: 0, parseAnomalies: [] },
      candidates: 0,
    };
    assert.equal(classifySearchOutcome({ episodes: [readNothing], evaluations: [] }).state, "PROVIDER_PARSE_FAILURE");
  });

  test("a partial search that found nothing has not established that nothing exists", () => {
    const partial: ProviderEpisode = {
      approval: COMMONS_APPROVAL,
      searched: true,
      outcome: { status: "no_results" },
      attestation: { responsesParsed: 9, responsesFailed: 3, parseAnomalies: [] },
      candidates: 0,
    };
    assert.equal(classifySearchOutcome({ episodes: [partial], evaluations: [] }).state, "PROVIDER_PARSE_FAILURE");
  });

  test("no provider searched at all is an OUTAGE, never an empty result", () => {
    const notApproved: ProviderEpisode = {
      approval: { ...COMMONS_APPROVAL, approvedForSearch: false },
      searched: false,
      outcome: { status: "outage", detail: "not approved for search" },
      attestation: null,
      candidates: 0,
    };
    const outcome = classifySearchOutcome({ episodes: [notApproved], evaluations: [] });
    assert.equal(outcome.state, "PROVIDER_OUTAGE");
    assert.match(outcome.because.join(" "), /not a source that came back empty/i);

    assert.equal(classifySearchOutcome({ episodes: [], evaluations: [] }).state, "PROVIDER_OUTAGE");
  });

  test("a parse failure outranks an outage, so a bug cannot hide behind a bad afternoon", () => {
    const malformed: ProviderEpisode = {
      approval: COMMONS_APPROVAL,
      searched: true,
      outcome: { status: "malformed", detail: "<!DOCTYPE html>" },
      attestation: { responsesParsed: 3, responsesFailed: 1, parseAnomalies: [] },
      candidates: 0,
    };
    const rateLimited: ProviderEpisode = {
      approval: { ...COMMONS_APPROVAL, id: "flickr", label: "Flickr" },
      searched: true,
      outcome: { status: "rate_limited", detail: "HTTP 429" },
      attestation: null,
      candidates: 0,
    };
    assert.equal(classifySearchOutcome({ episodes: [malformed, rateLimited], evaluations: [] }).state, "PROVIDER_PARSE_FAILURE");
  });

  test("rights restriction reads as RIGHTS_UNCERTAIN, and it is still a refusal", () => {
    const restricted = fakeEvaluation({ key: "nc", code: "rights_restricted" });
    assert.equal(classifySearchOutcome({ episodes: [OK_EPISODE], evaluations: [restricted] }).state, "RIGHTS_UNCERTAIN");

    // And the underlying rule is untouched: an NC licence is still positively
    // restricted, not merely unverified.
    const p: ProvenanceRecord = {
      provider: "wikimedia_commons",
      providerRef: "File:X.jpg",
      originalFileUrl: "https://upload.wikimedia.org/x.jpg",
      sourcePageUrl: "https://commons.wikimedia.org/wiki/File:X.jpg",
      originalFileName: "X.jpg",
      creator: "Someone",
      creatorPageUrl: null,
      licenceDeclared: "CC BY-NC 4.0",
      licenceMetadata: "CC BY-NC 4.0",
      licenceUrl: null,
      attributionRequired: true,
      attributionText: "Photo: Someone",
      acquiredAt: "2026-08-22T10:00:00.000Z",
      verifiedAt: null,
      width: 3000,
      height: 2000,
      mimeType: "image/jpeg",
      byteSize: 100,
      contentHash: "sha1:abc",
      evidence: [{ kind: "licence_template", detail: "{{cc-by-nc-4.0}}", origin: "wikitext" }],
      conflicts: [],
    };
    assert.equal(verifyRights(p).evidenceClass, "restricted");
    assert.equal(verifyRights(p).mayPublish, false);
  });
});
