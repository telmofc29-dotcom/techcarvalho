// Adversarial tests for the media acquisition pipeline.
//
// Every case here is a way the pipeline could produce a wrong answer that
// LOOKS right — a clean licence on the wrong product, a complete-looking
// record with nothing to attribute, a source that changed after we relied on
// it, a provider failure indistinguishable from an empty result.
//
// The assertion that matters in all of them is the same: THE FAILURE MODE IS
// REFUSAL. Not a warning, not a lower score, not a flag someone might read.
//
// Pure. No network, no database, no fixtures on disk.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  evaluateCandidate,
  reconcileDuplicates,
  detectSyntheticImagery,
  validateEnginePublicationSafety,
  buildProposedRow,
  runAcquisitionPipeline,
  MIN_ACQUIRE_LONG_EDGE,
  type CandidateEvaluation,
} from "./pipeline.ts";
import { detectRightsDrift, verifyRights, thirdPartyPlatform, compareCredits } from "./rights-verification.ts";
import { DEFAULT_RANKING_CONTEXT, rankCandidates } from "./ranking.ts";
import { assessEntityMatch } from "./entity-match.ts";
import { evaluatePublishEligibility } from "../rights.ts";
import { evaluateProvenance } from "../provenance.ts";
import { classifyMediaTier, evaluateHero } from "../hierarchy.ts";
import { COMMONS_APPROVAL, commonsThumbUrl } from "./wikimedia-commons.ts";
import { ENGINE_MAX_RIGHTS_STATUS } from "./types.ts";
import type {
  DiscoveredCandidate,
  MediaProvider,
  ProvenanceRecord,
  ProviderApproval,
  ProviderQuery,
} from "./types.ts";
import type { CandidateDescriptor } from "./entity-match.ts";
import type { SubjectIdentity } from "./query-expansion.ts";

// ---------------------------------------------------------------------------
// Fixtures
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

function provenance(over: Partial<ProvenanceRecord> = {}): ProvenanceRecord {
  return {
    provider: "wikimedia_commons",
    providerRef: "File:GoPro Héro 13 Black - 01.jpg",
    originalFileUrl: "https://upload.wikimedia.org/wikipedia/commons/a/ab/GoPro_H%C3%A9ro_13_Black_-_01.jpg",
    sourcePageUrl: "https://commons.wikimedia.org/wiki/File:GoPro_H%C3%A9ro_13_Black_-_01.jpg",
    originalFileName: "GoPro Héro 13 Black - 01.jpg",
    creator: "François Leblond",
    creatorPageUrl: "https://commons.wikimedia.org/wiki/User:Fran%C3%A7ois_de_Dijon",
    licenceDeclared: "CC BY-SA 4.0",
    licenceMetadata: "CC BY-SA 4.0",
    licenceUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
    attributionRequired: true,
    attributionText: "Photo: François Leblond, CC BY-SA 4.0, via Wikimedia Commons",
    acquiredAt: "2026-08-22T10:00:00.000Z",
    verifiedAt: "2026-08-22T10:00:00.000Z",
    width: 3000,
    height: 2000,
    mimeType: "image/jpeg",
    byteSize: 2_400_000,
    contentHash: "sha1:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    evidence: [
      { kind: "licence_template", detail: "{{self|cc-by-sa-4.0}} => CC BY-SA 4.0", origin: "raw wikitext" },
      { kind: "licence_metadata", detail: 'LicenseShortName="CC BY-SA 4.0"', origin: "extmetadata" },
      { kind: "author_field", detail: 'Artist="François Leblond"', origin: "extmetadata Artist" },
      { kind: "source_field", detail: 'source="own work"', origin: "wikitext source=" },
      { kind: "permission_field", detail: "permission= is empty", origin: "wikitext" },
      { kind: "exif_artist", detail: 'EXIF Artist="Francois Leblond"', origin: "commonmetadata" },
      { kind: "exif_copyright", detail: 'EXIF Copyright="Francois Leblond"', origin: "commonmetadata" },
      { kind: "content_hash", detail: "sha1:aaaa…", origin: "imageinfo sha1" },
    ],
    conflicts: [],
    ...over,
  };
}

function descriptor(over: Partial<CandidateDescriptor> = {}): CandidateDescriptor {
  return {
    title: "File:GoPro Héro 13 Black - 01.jpg",
    fileName: "GoPro Héro 13 Black - 01.jpg",
    categories: ["Category:GoPro Hero 13 black"],
    descriptionText: "GoPro Héro 13 Black action camera on a flexible tripod, front view, white background studio shot",
    mimeType: "image/jpeg",
    ...over,
  };
}

function evaluate(d: CandidateDescriptor, p: ProvenanceRecord | null, identity = GOPRO, approval = COMMONS_APPROVAL) {
  return evaluateCandidate({
    identity,
    descriptor: d,
    provenance: p,
    resolveOutcome: p ? { status: "ok" } : { status: "not_found", detail: "gone" },
    provider: approval,
    key: `${approval.id}::${d.title}`,
  });
}

/** A provider whose behaviour the test dictates entirely. */
function fakeProvider(
  approval: ProviderApproval,
  behaviour: {
    search: () => Promise<Awaited<ReturnType<MediaProvider["search"]>>>;
    resolve?: (c: DiscoveredCandidate) => Promise<Awaited<ReturnType<MediaProvider["resolve"]>>>;
  }
): MediaProvider {
  return {
    approval,
    search: behaviour.search,
    resolve: behaviour.resolve ?? (async () => ({ outcome: { status: "ok" }, provenance: provenance() })),
  };
}

const QUERY: ProviderQuery = {
  strategy: "category_enumeration",
  value: "Category:GoPro Hero 13 black",
  rationale: "test",
  identityTokens: ["13"],
};

// ---------------------------------------------------------------------------

describe("adversarial: media acquisition", () => {
  // -- 1 --------------------------------------------------------------------
  test("valid CC asset with complete attribution is accepted for ARCHIVAL but not for publication", () => {
    const result = evaluate(descriptor(), provenance());

    assert.equal(result.accepted, true, "a complete, self-consistent CC BY-SA record should clear the gates");
    assert.equal(result.rights?.evidenceClass, "evidence_complete");
    assert.equal(result.rights?.mayAcquire, true);
    assert.equal(result.rights?.mayPublish, false);
    assert.equal(result.rights?.writableRightsStatus, ENGINE_MAX_RIGHTS_STATUS);
    assert.notEqual(result.rights?.writableRightsStatus, "verified");

    // The hard boundary, checked rather than asserted in prose.
    const row = buildProposedRow({ storagePath: "image/x.jpg", altText: "alt", provenance: provenance() });
    const safety = validateEnginePublicationSafety(row);
    assert.equal(safety.safe, true, "engine output must be REFUSED by the publication gate");
    assert.equal(safety.publishEligibility.allowed, false);
    assert.equal(safety.provenanceVerdict.publishable, false);
    assert.equal(row.rights_status, "pending_verification");
  });

  // -- 2 --------------------------------------------------------------------
  test("Commons licence but missing required creator FAILS CLOSED", () => {
    const p = provenance({ creator: null, attributionText: null });
    const result = evaluate(descriptor(), p);

    assert.equal(result.accepted, false);
    assert.equal(result.rejection?.code, "rights_incomplete");
    const codes = result.rights!.findings.map((f) => f.code);
    assert.ok(codes.includes("creator_absent"), `expected creator_absent, got ${codes.join(",")}`);
    assert.equal(result.rights?.mayAcquire, false);
    assert.equal(result.rights?.writableRightsStatus, null, "no row should be written at all");
  });

  // -- 3 --------------------------------------------------------------------
  test("wrong but visually similar product is rejected on identity, before rights are consulted", () => {
    const wrong = descriptor({
      title: "File:GoPro Hero 12 Black - 02.jpg",
      fileName: "GoPro Hero 12 Black - 02.jpg",
      categories: ["Category:GoPro Hero 12 black"],
      descriptionText: "GoPro Hero 12 Black action camera, front view",
    });
    const result = evaluate(wrong, provenance());

    assert.equal(result.accepted, false);
    assert.equal(result.rejection?.code, "entity_mismatch");
    assert.equal(result.stageReached, "entity", "identity must be settled before rights work is done");
    assert.equal(result.rights, null, "a wrong-product file should never reach rights verification");
  });

  test("a sibling generation is not a near miss: Switch 2 must not match Switch", () => {
    const switch2: SubjectIdentity = {
      canonicalName: "Nintendo Switch 2", manufacturer: "Nintendo", aliases: [], family: "Nintendo Switch",
    };
    const originalSwitch = descriptor({
      title: "File:Nintendo Switch Console.jpg",
      fileName: "Nintendo Switch Console.jpg",
      categories: ["Category:Nintendo Switch"],
      descriptionText: "Nintendo Switch console with Joy-Con attached",
    });
    const result = evaluate(originalSwitch, provenance(), switch2);
    assert.equal(result.accepted, false);
    assert.ok(
      result.rejection?.code === "entity_mismatch" || result.rejection?.code === "entity_ambiguous",
      `expected an identity rejection, got ${result.rejection?.code}`
    );
  });

  test("ambiguous candidates FAIL CLOSED rather than being rounded up", () => {
    // Enough signal to be plausible, not enough to be evidenced: the model
    // number appears nowhere, only the brand and a vague description.
    const vague = descriptor({
      title: "File:Action camera on tripod.jpg",
      fileName: "Action camera on tripod.jpg",
      categories: ["Category:GoPro"],
      descriptionText: "A GoPro action camera mounted on a tripod, white background studio",
    });
    const result = evaluate(vague, provenance());
    assert.equal(result.accepted, false);
    assert.ok(["entity_ambiguous", "entity_mismatch"].includes(result.rejection!.code));
    assert.match(result.rejection!.message, /clos|nothing credible/i);
  });

  // -- 4 --------------------------------------------------------------------
  test("zero results is reported as no_results, distinct from a failure", async () => {
    const provider = fakeProvider(COMMONS_APPROVAL, {
      search: async () => ({ outcome: { status: "no_results" }, candidates: [], queryLog: [] }),
    });
    const report = await runAcquisitionPipeline(GOPRO, [provider], { maxCandidates: 20, ranking: rankingCtx });

    assert.equal(report.status, "no_results");
    assert.equal(report.proposedRow, null);
    assert.match(report.narrative, /returned nothing/i);
    assert.match(report.narrative, /recheck/i, "an honest empty result should say what to do next");
  });

  // -- 5 --------------------------------------------------------------------
  test("source page disappearing after acquisition invalidates verification without destroying evidence", () => {
    const drift = detectRightsDrift(
      {
        license: "CC BY-SA 4.0",
        creator: "François Leblond",
        source_url: "https://commons.wikimedia.org/wiki/File:GoPro_H%C3%A9ro_13_Black_-_01.jpg",
        contentHash: "sha1:aaaa",
      },
      null
    );
    assert.equal(drift.changed, true);
    assert.equal(drift.invalidatesVerification, true);
    assert.equal(drift.findings[0].field, "source_page");
    assert.match(drift.findings[0].message, /do NOT delete the private archive/i);

    // And a live resolve failure is a rejection, never a pass.
    const result = evaluate(descriptor(), null);
    assert.equal(result.accepted, false);
    assert.equal(result.rejection?.code, "provenance_unresolvable");
  });

  test("a tidied credit is not a changed creator — the ten real false alarms", () => {
    // Every pair below came from a live re-verification of the published
    // library. Not one is a different photographer, and the first
    // implementation reported all ten as INVALIDATED.
    const sameName: [string, string][] = [
      ["CEphoto / Uwe Aranas", "CEphoto, Uwe Aranas"],
      ["See-ming Lee", "See-ming Lee from Hong Kong SAR, China"],
      ["Ashley Pomeroy", "Ashley Pomeroy ( talk ) at en.wikipedia"],
      ["Mlogic (Yan Li)", "Mlogic"],
      ["Kārlis Dambrāns", "Kārlis Dambrāns from Latvia"],
      ["Tycho (shansov.net)", "[Tycho] talk , http://shansov.net"],
      ["Gode Nehler", "GodeNehler"],
      ["Henry Söderlund", "Henry Söderlund from Helsinki, Finland"],
      ["François Leblond (User:François de Dijon)", "François de Dijon"],
    ];
    for (const [recorded, current] of sameName) {
      assert.notEqual(
        compareCredits(recorded, current),
        "different",
        `"${recorded}" vs "${current}" should not read as a different person`
      );
      const drift = detectRightsDrift(
        { license: "CC BY-SA 4.0", creator: recorded, source_url: "https://commons.wikimedia.org/x", contentHash: null },
        provenance({ creator: current })
      );
      assert.equal(drift.invalidatesVerification, false, `${recorded} should not invalidate`);
    }

    // And a genuinely different photographer still blocks.
    assert.equal(compareCredits("Jacek Halicki", "Habib M'henni"), "different");
    const realDrift = detectRightsDrift(
      { license: "CC BY-SA 4.0", creator: "Jacek Halicki", source_url: "https://commons.wikimedia.org/x", contentHash: null },
      provenance({ creator: "Habib M'henni" })
    );
    assert.equal(realDrift.invalidatesVerification, true);
  });

  // -- 6 --------------------------------------------------------------------
  test("licence metadata changing at source is a BLOCKER, not a refresh", () => {
    const drift = detectRightsDrift(
      { license: "CC BY-SA 4.0", creator: "François Leblond", source_url: "https://commons.wikimedia.org/x", contentHash: null },
      provenance({ licenceDeclared: "CC BY-NC 4.0", licenceMetadata: "CC BY-NC 4.0" })
    );
    assert.equal(drift.invalidatesVerification, true);
    const licenceFinding = drift.findings.find((f) => f.field === "licence");
    assert.equal(licenceFinding?.severity, "blocker");
    assert.match(licenceFinding!.message, /Unpublish/i);
  });

  test("the two independent licence reads disagreeing is worse than one missing", () => {
    const p = provenance({ licenceDeclared: "CC BY-SA 4.0", licenceMetadata: "CC BY 2.0" });
    const rights = verifyRights(p);
    assert.equal(rights.evidenceClass, "evidence_conflicting");
    assert.ok(rights.findings.some((f) => f.code === "licence_metadata_mismatch"));
    assert.equal(rights.mayAcquire, false);
  });

  // -- 7 --------------------------------------------------------------------
  test("the same image from two providers is deduplicated in favour of the better-evidenced copy", () => {
    const weakProvider: ProviderApproval = {
      ...COMMONS_APPROVAL, id: "openverse", label: "Openverse", exposesPrimaryEvidence: false,
    };
    const strong = evaluate(descriptor(), provenance());
    const weak = evaluate(
      descriptor({ title: "openverse:gopro-hero13" }),
      provenance({ evidence: provenance().evidence.slice(0, 2) }),
      GOPRO,
      weakProvider
    );
    assert.equal(strong.accepted, true);
    assert.equal(weak.accepted, true);

    const out = reconcileDuplicates([weak, strong]);
    const survivors = out.filter((e) => e.accepted);
    assert.equal(survivors.length, 1, "one file, one surviving candidate");
    assert.equal(survivors[0].provider.id, "wikimedia_commons");
    const dropped = out.find((e) => !e.accepted)!;
    assert.equal(dropped.rejection?.code, "duplicate_of_better");
  });

  // -- 8 --------------------------------------------------------------------
  test("the same image with CONFLICTING licence metadata blocks BOTH copies", () => {
    const other: ProviderApproval = { ...COMMONS_APPROVAL, id: "openverse", label: "Openverse" };
    const a = evaluate(descriptor(), provenance());
    const b = evaluate(
      descriptor({ title: "openverse:gopro-hero13" }),
      provenance({ licenceDeclared: "CC BY 4.0", licenceMetadata: "CC BY 4.0" }),
      GOPRO,
      other
    );
    const out = reconcileDuplicates([a, b]);

    assert.equal(out.filter((e) => e.accepted).length, 0, "a licence contradiction must not resolve to the friendlier reading");
    for (const e of out) {
      assert.equal(e.rejection?.code, "duplicate_licence_conflict");
      assert.match(e.rejection!.message, /CONFLICTING/);
    }
  });

  // -- 9 --------------------------------------------------------------------
  test("provider outage is never recorded as 'nothing found'", async () => {
    const provider = fakeProvider(COMMONS_APPROVAL, {
      search: async () => ({ outcome: { status: "outage", detail: "HTTP 503" }, candidates: [], queryLog: [] }),
    });
    const report = await runAcquisitionPipeline(GOPRO, [provider], { maxCandidates: 20, ranking: rankingCtx });

    assert.equal(report.status, "provider_unavailable");
    assert.notEqual(report.status, "no_results");
    assert.match(report.narrative, /DID NOT COMPLETE/);
    assert.equal(report.evaluations[0].rejection?.code, "provider_outage");
  });

  test("rate limiting during resolution is an outage, not a rejection of the file", () => {
    const result = evaluateCandidate({
      identity: GOPRO,
      descriptor: descriptor(),
      provenance: null,
      resolveOutcome: { status: "rate_limited", detail: "HTTP 429" },
      provider: COMMONS_APPROVAL,
      key: "k",
    });
    assert.equal(result.accepted, false);
    assert.equal(result.rejection?.code, "provider_outage");
    assert.match(result.rejection!.message, /stop, never a skip/i);
  });

  // -- 10 -------------------------------------------------------------------
  test("a malformed provider response is distinguishable from an empty one", async () => {
    const provider = fakeProvider(COMMONS_APPROVAL, {
      search: async () => ({
        outcome: { status: "malformed", detail: 'Non-JSON response (HTTP 200): <!DOCTYPE html>' },
        candidates: [], queryLog: [],
      }),
    });
    const report = await runAcquisitionPipeline(GOPRO, [provider], { maxCandidates: 20, ranking: rankingCtx });
    assert.equal(report.status, "provider_unavailable");
    assert.equal(report.evaluations[0].rejection?.code, "provider_malformed");
    assert.match(report.evaluations[0].rejection!.message, /NOT a finding/);
  });

  // -- 11 -------------------------------------------------------------------
  test("a low-resolution candidate is refused even with perfect rights", () => {
    const p = provenance({ width: 480, height: 320 });
    const result = evaluate(descriptor(), p);
    assert.equal(result.accepted, false);
    assert.equal(result.rejection?.code, "quality_below_floor");
    assert.match(result.rejection!.message, new RegExp(String(MIN_ACQUIRE_LONG_EDGE)));
    // The rights themselves were fine — the refusal is honest about which gate failed.
    assert.equal(result.rights?.evidenceClass, "evidence_complete");
  });

  test("a correctly-licensed 3D model of the right product is not a photograph of it", () => {
    // Verbatim from the first live run: searching for the Intel Core Ultra 9
    // 285K accepted three candidates and all three were .stl meshes.
    const stl = descriptor({
      title: "File:Intel Core Ultra 9 285K 20241107.stl",
      fileName: "Intel Core Ultra 9 285K 20241107.stl",
      categories: ["Category:Intel Core Ultra 9 285K"],
      descriptionText: "Intel Core Ultra 9 285K",
      mimeType: "application/sla",
    });
    const intel: SubjectIdentity = {
      canonicalName: "Intel Core Ultra 9 285K", manufacturer: "Intel", aliases: [], family: null,
    };
    const result = evaluate(stl, provenance({ mimeType: "application/sla" }), intel);
    assert.equal(result.accepted, false);
    assert.equal(result.rejection?.code, "unsupported_media_type");
  });

  test("a vector file is refused as a media type, not merely ranked down", () => {
    const svg = descriptor({ title: "File:Samsung logo.svg", mimeType: "image/svg+xml" });
    const result = evaluate(svg, provenance({ mimeType: "image/svg+xml" }));
    assert.equal(result.accepted, false);
    assert.ok(["unsupported_media_type", "entity_mismatch", "entity_ambiguous"].includes(result.rejection!.code));
  });

  // -- 12 -------------------------------------------------------------------
  test("a misleading generated image of the exact product is refused despite a perfect licence", () => {
    const generated = descriptor({
      title: "File:GoPro HERO13 Black (AI-generated).png",
      fileName: "GoPro HERO13 Black (AI-generated).png",
      categories: ["Category:GoPro Hero 13 black", "Category:AI-generated images"],
      descriptionText: "GoPro HERO13 Black, AI-generated illustration created with Stable Diffusion",
      mimeType: "image/png",
    });
    const p = provenance({ licenceDeclared: "CC0", licenceMetadata: "CC0", attributionRequired: false, creator: "Uploader" });

    const verdict = detectSyntheticImagery(generated, p);
    assert.equal(verdict.synthetic, true);

    const result = evaluate(generated, p);
    assert.equal(result.accepted, false);
    assert.equal(result.rejection?.code, "synthetic_imagery");
    // The licence really was flawless. That is the point.
    assert.equal(result.rights?.evidenceClass, "evidence_complete");
    assert.match(result.rejection!.message, /fabricated depiction/i);
  });

  // -- 13 -------------------------------------------------------------------
  test("a valid owned original needs no provider pipeline and publishes on ownership alone", () => {
    const staffPhoto = {
      source_type: "staff_photograph" as const,
      rights_status: "unknown" as const,
      license: null,
      creator: "Tech Carvalho",
      attribution: null,
      attribution_required: false,
      source_url: null,
      owned: true,
      ai_generated: false,
    };
    const verdict = evaluateProvenance(staffPhoto);
    assert.equal(verdict.rightsClass, "owned_original");
    assert.equal(verdict.publishable, true);
    assert.equal(verdict.requiresCredit, false);
    assert.equal(evaluatePublishEligibility(staffPhoto).allowed, true);

    // And the engine's own output is still refused, so the two paths are not confusable.
    const engineRow = buildProposedRow({ storagePath: "image/y.jpg", altText: null, provenance: provenance() });
    assert.equal(evaluatePublishEligibility(engineRow).allowed, false);
  });

  // -- 14 -------------------------------------------------------------------
  test("a weak graphic with no better candidate is left alone, not removed", async () => {
    const existingGraphic = {
      source_type: "tc_graphic", asset_role: "article_hero", owned: true, ai_generated: false,
      storage_path: "image/uuid-gaming-hero-card.png", source_url: null, license: null,
    };
    const tier = classifyMediaTier(existingGraphic);
    assert.equal(tier, "generic_graphic");
    const heroVerdict = evaluateHero(tier, "product");
    assert.equal(heroVerdict.shouldReplace, true, "a title card on a product page wants replacing");

    const provider = fakeProvider(COMMONS_APPROVAL, {
      search: async () => ({ outcome: { status: "no_results" }, candidates: [], queryLog: [] }),
    });
    const report = await runAcquisitionPipeline(GOPRO, [provider], { maxCandidates: 20, ranking: rankingCtx });

    assert.equal(report.status, "no_results");
    assert.equal(report.proposedRow, null, "no replacement is proposed, so the existing graphic stays");
    // Nothing in the pipeline can unpublish or downgrade the incumbent: it has
    // no concept of removal, only of proposing an addition.
    assert.equal(report.ranking, null);
  });

  // -- 15 -------------------------------------------------------------------
  test("when verified photography later appears it supersedes the weak graphic — but only after a human verifies", async () => {
    const hit: DiscoveredCandidate = {
      provider: "wikimedia_commons",
      providerRef: "File:GoPro Héro 13 Black - 01.jpg",
      title: "File:GoPro Héro 13 Black - 01.jpg",
      foundBy: QUERY,
      descriptors: ["Category:GoPro Hero 13 black", "GoPro Héro 13 Black on a tripod, white background studio"],
    };
    const provider = fakeProvider(COMMONS_APPROVAL, {
      search: async () => ({ outcome: { status: "ok" }, candidates: [hit], queryLog: [] }),
      resolve: async () => ({ outcome: { status: "ok" }, provenance: provenance() }),
    });

    const report = await runAcquisitionPipeline(GOPRO, [provider], {
      maxCandidates: 20,
      ranking: rankingCtx,
      storagePathFor: () => "image/new-hero.jpg",
      altTextFor: () => "GoPro HERO13 Black action camera on a tripod",
    });

    assert.equal(report.status, "resolved");
    assert.ok(report.proposedRow, "a real photograph should be proposed as a replacement");
    assert.equal(report.proposedRow!.rights_status, "pending_verification");
    assert.equal(report.publicationSafety!.safe, true, "the proposal must NOT be publishable by itself");
    assert.equal(report.publicationSafety!.publishEligibility.allowed, false);
    // The upgrade is real but gated: the graphic is only superseded once a
    // human moves rights_status to 'verified' and links the new hero.
    assert.match(report.publicationSafety!.explanation, /A human moves it further/);
  });

  // -- 16 -------------------------------------------------------------------
  test("an NC or ND licence is positively restricted, never merely unverified", () => {
    for (const licence of ["CC BY-NC 4.0", "CC BY-ND 4.0", "CC BY-NC-SA 3.0"]) {
      const rights = verifyRights(provenance({ licenceDeclared: licence, licenceMetadata: licence }));
      assert.equal(rights.evidenceClass, "restricted", `${licence} should be restricted`);
      assert.equal(rights.rightsClass, "rights_restricted");
      assert.equal(rights.writableRightsStatus, "restricted");
      assert.equal(rights.mayAcquire, false);
    }
  });

  test("an EXIF all-rights-reserved assertion under a CC badge blocks; a bare authorship line does not", () => {
    // The File:Canon_EOS_5D.jpg failure.
    const conflicted = verifyRights(
      provenance({ conflicts: ['EXIF Copyright asserts "All rights reserved" — all rights reserved contradicts a free licence.'] })
    );
    assert.equal(conflicted.evidenceClass, "evidence_conflicting");
    assert.equal(conflicted.mayAcquire, false);

    // The GoPro near-miss: EXIF Copyright naming the photographer is exactly
    // what a correctly-licensed CC file looks like, because CC does not waive
    // copyright. It must NOT block.
    const fine = verifyRights(provenance());
    assert.equal(fine.evidenceClass, "evidence_complete");
  });

  test("a licence readable only from generated metadata is refused, not merely flagged", () => {
    // The real first-run failure: video frame-grabs tagged "CC BY 3.0" with the
    // licence present only in extmetadata. The engine accepted them; a human
    // reviewer had already rejected the same files.
    const badgeOnly = provenance({
      licenceDeclared: null,
      licenceMetadata: "CC BY 3.0",
      creator: "ZMASLO",
      evidence: [
        { kind: "licence_metadata", detail: 'LicenseShortName="CC BY 3.0"', origin: "extmetadata" },
        { kind: "author_field", detail: 'Artist="ZMASLO"', origin: "extmetadata Artist" },
        { kind: "exif_copyright", detail: "no EXIF Copyright field", origin: "commonmetadata" },
      ],
    });
    const rights = verifyRights(badgeOnly);
    assert.equal(rights.evidenceClass, "evidence_incomplete");
    assert.ok(rights.findings.some((f) => f.code === "licence_not_in_primary_source"));
    assert.equal(rights.mayAcquire, false);
  });

  test("a re-asserted third-party licence from a video platform is refused", () => {
    const fromYouTube = provenance({
      evidence: [
        ...provenance().evidence,
        { kind: "source_field", detail: 'source="https://www.youtube.com/watch?v=abc123"', origin: "wikitext source=" },
      ],
    });
    const rights = verifyRights(fromYouTube);
    assert.equal(rights.evidenceClass, "evidence_incomplete");
    const finding = rights.findings.find((f) => f.code === "third_party_relicence_unreviewed");
    assert.ok(finding, "a YouTube-sourced upload is not own work");
    assert.match(finding!.message, /not reusable-image libraries/);
  });

  test("platform detection covers the sources named as non-libraries", () => {
    for (const [url, label] of [
      ["https://youtu.be/abc", "YouTube"],
      ["https://www.reddit.com/r/hardware/comments/x", "Reddit"],
      ["https://www.pinterest.com/pin/1", "Pinterest"],
      ["https://x.com/someone/status/1", "X/Twitter"],
      ["https://www.amazon.co.uk/dp/B0", "a retailer listing"],
      ["https://www.bing.com/images/search?q=x", "an image search engine"],
    ] as const) {
      assert.equal(thirdPartyPlatform(url), label, url);
    }
    // A Commons file page is not a third-party platform.
    assert.equal(thirdPartyPlatform("https://commons.wikimedia.org/wiki/File:X.jpg"), null);
  });

  test("a candidate carrying no primary licence evidence cannot pass on a badge alone", () => {
    const badgeOnly = provenance({
      licenceDeclared: null,
      evidence: [{ kind: "author_field", detail: 'Artist="Someone"', origin: "aggregator summary" }],
    });
    const rights = verifyRights(badgeOnly);
    assert.equal(rights.evidenceClass, "evidence_incomplete");
    assert.ok(rights.findings.some((f) => f.code === "no_primary_licence_evidence"));
  });

  test("a disabled provider is never called and says so in the log", async () => {
    let called = false;
    const disabled = fakeProvider(
      { ...COMMONS_APPROVAL, id: "pexels", label: "Pexels", approvedForSearch: false, rationale: "not enabled" },
      {
        search: async () => {
          called = true;
          return { outcome: { status: "ok" }, candidates: [], queryLog: [] };
        },
      }
    );
    const report = await runAcquisitionPipeline(GOPRO, [disabled], { maxCandidates: 5, ranking: rankingCtx });
    assert.equal(called, false, "a provider not approved for search must never receive a request");
    assert.equal(report.status, "provider_unavailable");
    assert.match(report.queryLog[0].note, /NOT approved for search/);
  });

  test("the engine can never write rights_status='verified'", () => {
    const row = buildProposedRow({ storagePath: "image/z.jpg", altText: null, provenance: provenance() });
    assert.notEqual(row.rights_status as string, "verified");
    assert.equal(row.owned, false, "the engine must not claim ownership of someone else's photograph");
    assert.equal(row.publication_status, "private");
    assert.equal(row.ai_generated, false);
  });
});

describe("ranking never falls back to arrival order", () => {
  test("a dead heat is reported as one, and broken on a stated property", () => {
    // The real case: eight sibling frames from one photo session scored
    // identically on all eleven criteria. Without a stated tiebreak the winner
    // would be whichever the provider listed first.
    const make = (n: number, width: number) => {
      const p = provenance({
        providerRef: `File:GoPro Héro 13 Black - 0${n}.jpg`,
        width,
        height: Math.round(width / 1.5),
        contentHash: `sha1:${n}`.padEnd(45, "0"),
      });
      const d = descriptor({ title: `File:GoPro Héro 13 Black - 0${n}.jpg` });
      return {
        key: `wikimedia_commons::File:GoPro Héro 13 Black - 0${n}.jpg`,
        descriptor: d,
        provenance: p,
        entityMatch: assessEntityMatch(GOPRO, d),
        rights: verifyRights(p),
        approval: COMMONS_APPROVAL,
      };
    };
    // Deliberately supplied worst-first, so arrival order would pick the small one.
    // Both exactly 3:2 and both far above the resolution ceiling, so every
    // criterion scores identically and only the tiebreak can separate them.
    const result = rankCandidates([make(1, 3000), make(2, 4500)], rankingCtx);
    assert.equal(result.winner!.candidate.provenance.width, 4500, "the larger frame must win, not the first-listed");
    assert.match(result.whyItWon, /EXACT TIE/);
    assert.match(result.whyItWon, /NOT because it was returned first/);
    assert.match(result.whyItWon, /higher pixel count/);
  });
});

describe("duplicate reconciliation edge cases", () => {
  test("candidates without a content hash are passed through untouched", () => {
    const a = evaluate(descriptor(), provenance({ contentHash: null }));
    const out = reconcileDuplicates([a]);
    assert.equal(out.length, 1);
    assert.equal(out[0].accepted, true);
  });

  test("already-rejected candidates are never resurrected by reconciliation", () => {
    const rejected: CandidateEvaluation = evaluate(descriptor(), provenance({ creator: null, attributionText: null }));
    const out = reconcileDuplicates([rejected]);
    assert.equal(out[0].accepted, false);
  });
});

describe("Commons thumbnail URL construction", () => {
  test("analytics query parameters are stripped before the path is rebuilt", () => {
    const withQuery =
      "https://upload.wikimedia.org/wikipedia/commons/5/5e/GoPro_H%C3%A9ro_13_Black_-_02.jpg" +
      "?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=original";
    assert.equal(
      commonsThumbUrl(withQuery, 1920),
      "https://upload.wikimedia.org/wikipedia/commons/thumb/5/5e/GoPro_H%C3%A9ro_13_Black_-_02.jpg/1920px-GoPro_H%C3%A9ro_13_Black_-_02.jpg"
    );
  });

  test("an unfamiliar path shape falls back to the original rather than guessing", () => {
    assert.equal(
      commonsThumbUrl("https://example.org/some/other/layout.jpg?x=1", 1920),
      "https://example.org/some/other/layout.jpg"
    );
    assert.equal(commonsThumbUrl("not a url", 1920), "not a url");
  });
});
