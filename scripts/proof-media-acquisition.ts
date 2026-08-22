// PROOF HARNESS — media_acquisition_test at level `integration_proven`.
//
// WHAT THIS RUNS
// --------------
// The real acquisition path, end to end, against the REAL Wikimedia Commons
// API: category lookup -> category enumeration -> metadata batch -> per-file
// resolve (raw wikitext + extmetadata + EXIF + sha1) -> entity/rights/quality
// gates -> ranking -> proposed `media_assets` row -> download of Commons' own
// 1920px downscale -> real pixel dimensions read out of the BYTES -> SHA-256 of
// those bytes -> `validateEnginePublicationSafety()`.
//
// WHAT IT DELIBERATELY DOES NOT DO
// --------------------------------
// It imports no Supabase client and touches neither the database nor storage.
// The only side effect outside this process is a transcript file written to a
// scratchpad path passed on the command line.
//
// The point of the run is the LAST step: the row the engine would write must be
// REFUSED by the publication gate. `safe: true` means "correctly blocked".
//
// POLITENESS
// ----------
// Default 2500ms spacing, the project's descriptive User-Agent, and the
// provider is capped (1 category, 12 files from it, 3 candidates) so a proof
// run costs single-digit requests rather than the sixty the full sweep makes.
//
// Run: node scripts/proof-media-acquisition.ts [--transcript <path>]

import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { runAcquisitionPipeline } from "../src/lib/media/providers/pipeline.ts";
import { validateEnginePublicationSafety, buildProposedRow } from "../src/lib/media/providers/pipeline.ts";
import { DEFAULT_RANKING_CONTEXT } from "../src/lib/media/providers/ranking.ts";
import {
  CommonsClient,
  createCommonsProvider,
  commonsThumbUrl,
  COMMONS_REQUEST_SPACING_MS,
  type CommonsFetch,
} from "../src/lib/media/providers/wikimedia-commons.ts";
import type { SubjectIdentity } from "../src/lib/media/providers/query-expansion.ts";
import { evaluatePublishEligibility } from "../src/lib/media/rights.ts";
import { ENGINE_MAX_RIGHTS_STATUS } from "../src/lib/media/providers/types.ts";

const USER_AGENT = "TechCarvalhoBot/1.0 (+https://www.techcarvalho.com; media-rights-verification)";
const TARGET_WIDTH = 1920;

// The control subject from docs/media-acquisition-engine.md: a product with
// known-good Commons photography, so a negative result here would mean the
// engine broke rather than that the shelf is empty.
const SUBJECT: SubjectIdentity = {
  canonicalName: "GoPro HERO13 Black",
  manufacturer: "GoPro",
  aliases: ["GoPro Hero 13 Black", "GoPro Héro 13 Black"],
  family: "GoPro HERO",
};

type TranscriptEntry = { n: number; url: string; status: number; bytes: number; body: string };
const transcript: TranscriptEntry[] = [];

const loggingFetch: CommonsFetch = async (url) => {
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT, Accept: "application/json" } });
  const text = await res.text();
  transcript.push({ n: transcript.length + 1, url, status: res.status, bytes: text.length, body: text });
  console.log(`  [req ${transcript.length}] HTTP ${res.status} ${text.length}B ${url.slice(0, 150)}`);
  return { status: res.status, text };
};

function pngDimensions(buf: Buffer): { width: number; height: number } | null {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (buf.length < 24 || !buf.subarray(0, 8).equals(signature)) return null;
  if (buf.subarray(12, 16).toString("ascii") !== "IHDR") return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function jpegDimensions(buf: Buffer): { width: number; height: number } | null {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) {
      i++;
      continue;
    }
    const marker = buf[i + 1];
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    }
    i += 2 + buf.readUInt16BE(i + 2);
  }
  return null;
}

function imageDimensions(buf: Buffer): { width: number; height: number } | null {
  return jpegDimensions(buf) ?? pngDimensions(buf);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const transcriptPath = argv.includes("--transcript") ? argv[argv.indexOf("--transcript") + 1] : null;

  console.log("PROOF: media_acquisition_test (integration_proven)");
  console.log(`Subject: ${SUBJECT.canonicalName}`);
  console.log(`Provider: Wikimedia Commons, REAL API, spacing ${COMMONS_REQUEST_SPACING_MS}ms, UA "${USER_AGENT}"`);
  console.log("No database client is imported by this script. Nothing is uploaded or inserted.\n");

  const client = new CommonsClient(loggingFetch);
  const provider = createCommonsProvider({
    identity: SUBJECT,
    client,
    maxCategories: 1,
    maxPerCategory: 12,
  });

  const startedAt = Date.now();
  const report = await runAcquisitionPipeline(SUBJECT, [provider], {
    maxCandidates: 3,
    ranking: {
      ...DEFAULT_RANKING_CONTEXT,
      existingContentHashes: new Set<string>(),
      existingSourceUrls: new Set<string>(),
    },
  });
  const elapsed = Date.now() - startedAt;

  console.log(`\n--- SEARCH (${transcript.length} API requests, ${(elapsed / 1000).toFixed(1)}s) ---`);
  for (const q of report.queryLog) console.log(`  [${q.query.strategy}] "${q.query.value}" hits=${q.hits} :: ${q.note}`);

  console.log(`\nOUTCOME ${report.outcome.state} (legacy status: ${report.status})`);
  for (const b of report.outcome.because) console.log(`  · ${b}`);
  console.log(`  evidence: ${JSON.stringify(report.outcome.evidence)}`);

  console.log("\n--- CANDIDATES ---");
  for (const e of report.evaluations) {
    console.log(
      `  ${e.accepted ? "ACCEPTED" : "refused "} ${e.key}` +
        `${e.rejection ? ` [${e.rejection.code}] ${e.rejection.message.slice(0, 120)}` : ""}`
    );
    if (e.provenance) {
      console.log(
        `      licenceDeclared=${JSON.stringify(e.provenance.licenceDeclared)} licenceMetadata=${JSON.stringify(
          e.provenance.licenceMetadata
        )} creator=${JSON.stringify(e.provenance.creator)}`
      );
      console.log(
        `      ${e.provenance.width}x${e.provenance.height} ${e.provenance.mimeType} ${e.provenance.byteSize}B ${e.provenance.contentHash}`
      );
      console.log(`      evidence kinds: ${[...new Set(e.provenance.evidence.map((x) => x.kind))].join(", ")}`);
      console.log(`      conflicts: ${e.provenance.conflicts.length === 0 ? "none" : e.provenance.conflicts.join(" | ")}`);
    }
    if (e.rights) {
      console.log(
        `      rights: ${e.rights.evidenceClass} writable=${JSON.stringify(e.rights.writableRightsStatus)} ` +
          `mayAcquire=${e.rights.mayAcquire} mayPublish=${e.rights.mayPublish}`
      );
    }
  }

  if (!report.ranking?.winner || !report.proposedRow || !report.publicationSafety) {
    console.log("\nNo winner — acquisition cannot be exercised. PROOF NOT OBTAINED.");
    if (transcriptPath) writeFileSync(transcriptPath, JSON.stringify(transcript, null, 2));
    process.exitCode = 1;
    return;
  }

  const winner = report.ranking.winner.candidate;
  const prov = winner.provenance;
  console.log(`\n--- WINNER ---\n  ${prov.providerRef}\n  ${report.ranking.whyItWon}`);

  // --- Acquisition: real bytes over the wire -------------------------------
  if (!prov.originalFileUrl) throw new Error("winner has no originalFileUrl");
  const thumbUrl = commonsThumbUrl(prov.originalFileUrl, TARGET_WIDTH);
  console.log(`\n--- DOWNLOAD ---\n  original: ${prov.originalFileUrl}\n  fetching: ${thumbUrl}`);
  const res = await fetch(thumbUrl, { headers: { "User-Agent": USER_AGENT } });
  console.log(`  HTTP ${res.status} ${res.statusText} content-type=${res.headers.get("content-type")}`);
  if (!res.ok) {
    console.log("  download failed — PROOF NOT OBTAINED for the acquisition leg.");
    if (transcriptPath) writeFileSync(transcriptPath, JSON.stringify(transcript, null, 2));
    process.exitCode = 1;
    return;
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  const measured = imageDimensions(buffer);
  const sha256 = createHash("sha256").update(buffer).digest("hex");
  console.log(`  bytes: ${buffer.length}`);
  console.log(`  dimensions read from the BYTES: ${measured ? `${measured.width}x${measured.height}` : "UNREADABLE"}`);
  console.log(`  imageinfo claimed (original): ${prov.width}x${prov.height}, ${prov.byteSize}B, ${prov.contentHash}`);
  console.log(`  sha256: ${sha256}`);

  // --- The row the engine would write, and the gate refusing it ------------
  const storagePath = `image/proof-${sha256.slice(0, 12)}.jpg`;
  const row = {
    ...buildProposedRow({ storagePath, altText: null, provenance: prov }),
    width: measured?.width ?? prov.width,
    height: measured?.height ?? prov.height,
  };
  console.log("\n--- PROPOSED media_assets ROW (never written) ---");
  console.log(JSON.stringify(row, null, 2));

  const safety = validateEnginePublicationSafety(row);
  const eligibility = evaluatePublishEligibility(row);

  console.log("\n--- PUBLICATION GATE ---");
  console.log(`  ENGINE_MAX_RIGHTS_STATUS = '${ENGINE_MAX_RIGHTS_STATUS}'; row.rights_status = '${row.rights_status}'`);
  console.log(
    `  evaluatePublishEligibility(): allowed=${eligibility.allowed}` +
      (eligibility.allowed ? "" : ` reason="${eligibility.reason}"`)
  );
  console.log(`  evaluateProvenance(): rightsClass=${safety.provenanceVerdict.rightsClass} publishable=${safety.provenanceVerdict.publishable}`);
  for (const f of safety.provenanceVerdict.findings) console.log(`    ${f.severity}: ${f.code ?? ""} ${f.message}`);
  console.log(`  validateEnginePublicationSafety().safe = ${safety.safe}  (true means CORRECTLY REFUSED)`);
  console.log(`  ${safety.explanation}`);

  console.log(
    `\nRESULT: ${
      safety.safe && !eligibility.allowed
        ? "PASS — the engine produced an archivable, unpublishable row and the gate refused it."
        : "FAIL — INVARIANT VIOLATED: the engine's own row would publish itself."
    }`
  );
  console.log(`Total Commons API requests: ${transcript.length} (+1 thumbnail download).`);

  if (transcriptPath) {
    writeFileSync(transcriptPath, JSON.stringify(transcript, null, 2));
    console.log(`Transcript written to ${transcriptPath}`);
  }
  if (!safety.safe || eligibility.allowed) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
