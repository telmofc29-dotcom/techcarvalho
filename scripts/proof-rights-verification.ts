// PROOF HARNESS — rights_verification_test at level `integration_proven`.
//
// WHAT THIS RUNS
// --------------
// The real `resolve()` + `verifyRights()` path against REAL Wikimedia Commons
// files chosen because each one exercises a different arm of the rights check:
//
//   * a known-good CC BY-SA 4.0 own-work photograph — the licence read from the
//     file's RAW WIKITEXT template cross-checked against `extmetadata`;
//   * a NonCommercial file;
//   * a NoDerivatives file;
//   * a file whose page text asserts all rights reserved;
//   * `File:Canon EOS 5D.jpg`, the file docs/product-media-strategy.md records a
//     human reviewer rejecting on its EXIF, so the EXIF cross-check itself is
//     exercised against the real embedded metadata;
//   * `File:Canon AE-1 with 50mm f1.8 S.C. II.jpg`, found live by
//     insource:"Charles Lanteigne" on 2026-08-22: a CC BY-SA 3.0 file whose
//     embedded `UsageTerms` reads "No Usage Rights Granted Without Written
//     Authorization from Charles Lanteigne" — a genuine rights reservation
//     carried in the file itself rather than on the page;
//   * a file whose licence exists only in generated metadata / whose source is a
//     third-party video platform, if the search finds one.
//
// It prints, per file, exactly what was read from where: the raw licence
// template matched in the wikitext, the `extmetadata` licence, whether the two
// agree, the EXIF Artist/Copyright as this code actually receives them, the
// conflicts recorded, and the `RightsAssessment` that came out.
//
// Nothing is written anywhere. No Supabase client is imported.
//
// Run: node scripts/proof-rights-verification.ts

import { verifyRights, licencesAgree, prohibitiveLicenceReason } from "../src/lib/media/providers/rights-verification.ts";
import {
  CommonsClient,
  createCommonsProvider,
  licenceFromWikitext,
  COMMONS_REQUEST_SPACING_MS,
  type CommonsFetch,
} from "../src/lib/media/providers/wikimedia-commons.ts";
import type { SubjectIdentity } from "../src/lib/media/providers/query-expansion.ts";
import type { DiscoveredCandidate } from "../src/lib/media/providers/types.ts";
import { ENGINE_MAX_RIGHTS_STATUS } from "../src/lib/media/providers/types.ts";

const USER_AGENT = "TechCarvalhoBot/1.0 (+https://www.techcarvalho.com; media-rights-verification)";

/** Only used to instantiate the provider; resolve() does not consult it. */
const NEUTRAL_IDENTITY: SubjectIdentity = {
  canonicalName: "rights verification probe",
  manufacturer: null,
  aliases: [],
  family: null,
};

type Target = { ref: string; why: string; expect: string };

const TARGETS: Target[] = [
  {
    ref: "File:GoPro Héro 13 Black - 01.jpg",
    why: "positive control — own-work CC BY-SA 4.0, licence template present in the raw wikitext",
    expect: "evidence_complete, writable rights status = pending_verification and NOTHING stronger",
  },
  {
    ref: "File:Plumedbasiliskcele4.jpg",
    why: 'real NonCommercial TEMPLATE in the page wikitext (found live by insource:/[{][{][Cc]c-by-nc/)',
    expect: "REFUSED — NonCommercial cannot be relied on by a site carrying affiliate links",
  },
  {
    ref: "File:Raduno Vicenza 2006 0078.JPG",
    why: 'real NoDerivatives TEMPLATE in the page wikitext (found live by insource:/[{][{][Cc]c-by-nd/)',
    expect: "REFUSED — NoDerivatives, and the media pipeline resizes",
  },
  {
    ref: "File:Copper Alloy crotal bell (FindID 287885).jpg",
    why: "real file whose AUTHOR field literally reads 'All rights reserved, …' under a CC BY-SA 4.0 tag",
    expect: "REFUSED — an all-rights-reserved assertion cannot coexist with a free grant",
  },
  {
    ref: "File:Silver crystal.jpg",
    why: "licence declared through a TRANSCLUDED user template, so the raw wikitext and extmetadata disagree",
    expect: "REFUSED — two licence reads that disagree; uncertainty is not permission",
  },
  {
    ref: "File:Canon EOS 5D.jpg",
    why: "the file docs/product-media-strategy.md records a reviewer rejecting on its EXIF; exercises the EXIF cross-check",
    expect: "whatever the real EXIF supports — reported verbatim, including how this code receives it",
  },
  {
    ref: "File:Canon AE-1 with 50mm f1.8 S.C. II.jpg",
    why:
      'found live on 2026-08-22 by insource:"Charles Lanteigne" — a CC BY-SA 3.0 file whose EMBEDDED metadata carries ' +
      '`UsageTerms = "No Usage Rights Granted Without Written Authorization from Charles Lanteigne"`, in both buckets, ' +
      "in FLAT form (unlike File:Canon EOS 5D.jpg, whose identical sentence arrives lang-structured)",
    expect: "REFUSED — a rights reservation written into the file itself cannot coexist with a free grant",
  },
];

const transcriptCounts = { requests: 0 };
const politeFetch: CommonsFetch = async (url) => {
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT, Accept: "application/json" } });
  const text = await res.text();
  transcriptCounts.requests++;
  return { status: res.status, text };
};

function candidateFor(ref: string): DiscoveredCandidate {
  return {
    provider: "wikimedia_commons",
    providerRef: ref,
    title: ref,
    foundBy: { strategy: "text_search", value: ref, rationale: "explicit proof target", identityTokens: [] },
    descriptors: [],
  };
}

async function main(): Promise<void> {
  console.log("PROOF: rights_verification_test (integration_proven)");
  console.log(`Provider: Wikimedia Commons, REAL API, spacing ${COMMONS_REQUEST_SPACING_MS}ms, UA "${USER_AGENT}"`);
  console.log("Nothing is written. No database or storage client is imported.\n");

  const client = new CommonsClient(politeFetch);
  const provider = createCommonsProvider({ identity: NEUTRAL_IDENTITY, client });

  // A real search for the "licence only in a badge" class the docs record.
  const extra: Target[] = [];
  const found = await provider.search(
    [
      {
        strategy: "intitle_search",
        value: "9800X3D",
        rationale:
          "the class docs/media-acquisition-engine.md records: review-video frame grabs whose CC claim exists only " +
          "in generated metadata, re-asserted from a YouTube channel's licence toggle",
        identityTokens: [],
      },
    ],
    { maxCandidates: 3 }
  );
  for (const c of found.candidates.slice(0, 1)) {
    extra.push({
      ref: c.providerRef,
      why: 'found live by intitle:"9800X3D" — the video-frame class named in docs/media-acquisition-engine.md',
      expect: "REFUSED if the licence is badge-only or the source is a video platform without a confirmed review",
    });
  }
  console.log(`Live search intitle:"9800X3D" -> ${found.candidates.length} candidate(s); using ${extra.length}.\n`);

  const results: { ref: string; klass: string; writable: unknown; blockers: string[] }[] = [];

  for (const t of [...TARGETS, ...extra]) {
    console.log("=".repeat(100));
    console.log(`FILE  ${t.ref}`);
    console.log(`WHY   ${t.why}`);
    console.log(`EXPECT ${t.expect}`);

    const resolved = await provider.resolve(candidateFor(t.ref));
    if (!resolved.provenance) {
      console.log(`RESOLVE FAILED: ${resolved.outcome.status} — ${"detail" in resolved.outcome ? resolved.outcome.detail : ""}`);
      console.log("An unresolvable candidate is a STOP, never a skip — no rights conclusion is drawn.\n");
      continue;
    }
    const p = resolved.provenance;

    console.log("\n  READ FROM RAW WIKITEXT (the declaration the badge is generated from):");
    const tmpl = p.evidence.find((e) => e.kind === "licence_template");
    console.log(`    licence_template: ${tmpl ? tmpl.detail : "(none captured)"}`);
    console.log(`    origin:           ${tmpl ? tmpl.origin : "-"}`);
    console.log(`    licenceDeclared = ${JSON.stringify(p.licenceDeclared)}`);

    console.log("\n  READ FROM STRUCTURED METADATA (imageinfo extmetadata):");
    const metaEv = p.evidence.find((e) => e.kind === "licence_metadata");
    console.log(`    ${metaEv ? metaEv.detail : "(none captured)"}`);
    console.log(`    licenceMetadata = ${JSON.stringify(p.licenceMetadata)}`);

    console.log("\n  CROSS-CHECK:");
    console.log(
      `    licencesAgree(declared, metadata) = ${licencesAgree(p.licenceDeclared, p.licenceMetadata)}` +
        `${p.licenceDeclared && !p.licenceMetadata ? " (metadata absent)" : ""}` +
        `${!p.licenceDeclared && p.licenceMetadata ? " (NO PRIMARY DECLARATION — badge only)" : ""}`
    );
    console.log(`    prohibitiveLicenceReason(declared) = ${JSON.stringify(prohibitiveLicenceReason(p.licenceDeclared))}`);
    console.log(`    prohibitiveLicenceReason(metadata) = ${JSON.stringify(prohibitiveLicenceReason(p.licenceMetadata))}`);

    console.log("\n  EMBEDDED (EXIF/IPTC/XMP) AS THIS CODE RECEIVES IT:");
    for (const e of p.evidence.filter(
      (x) => x.kind === "exif_artist" || x.kind === "exif_copyright" || x.kind === "restriction_field"
    )) {
      console.log(`    ${e.detail}   [${e.origin}]`);
    }

    console.log("\n  PROVENANCE FIELDS:");
    console.log(`    creator       = ${JSON.stringify(p.creator)}`);
    console.log(`    sourcePageUrl = ${p.sourcePageUrl}`);
    console.log(`    originalFile  = ${p.originalFileUrl ? p.originalFileUrl.split("?")[0] : null}`);
    console.log(`    ${p.width}x${p.height} ${p.mimeType} ${p.byteSize}B ${p.contentHash}`);
    console.log(`    attributionRequired = ${p.attributionRequired}`);
    console.log(`    attributionText     = ${JSON.stringify(p.attributionText)}   <- this is what would be rendered as the credit`);
    console.log(`    conflicts (${p.conflicts.length}): ${p.conflicts.join(" | ") || "none"}`);

    const rights = verifyRights(p);
    console.log("\n  VERDICT:");
    console.log(`    evidenceClass        = ${rights.evidenceClass}`);
    console.log(`    rightsClass          = ${rights.rightsClass}`);
    console.log(`    writableRightsStatus = ${JSON.stringify(rights.writableRightsStatus)}  (engine ceiling: '${ENGINE_MAX_RIGHTS_STATUS}')`);
    console.log(`    mayAcquire=${rights.mayAcquire}  mayPublish=${rights.mayPublish}`);
    for (const f of rights.findings) console.log(`    ${f.severity.toUpperCase()} ${f.code}: ${f.message.slice(0, 180)}`);
    console.log(`    narrative: ${rights.narrative.slice(0, 300)}`);
    console.log();

    results.push({
      ref: t.ref,
      klass: rights.evidenceClass,
      writable: rights.writableRightsStatus,
      blockers: rights.findings.filter((f) => f.severity === "blocker").map((f) => f.code),
    });
  }

  console.log("=".repeat(100));
  console.log("SUMMARY");
  for (const r of results) {
    console.log(`  ${r.klass.padEnd(21)} writable=${String(r.writable).padEnd(22)} ${r.blockers.join(",") || "-"}   ${r.ref}`);
  }

  const overCeiling = results.filter((r) => r.writable !== null && r.writable !== ENGINE_MAX_RIGHTS_STATUS && r.writable !== "restricted");
  console.log(
    `\nINVARIANT: no file produced a writable rights status above '${ENGINE_MAX_RIGHTS_STATUS}' — ${
      overCeiling.length === 0 ? "HELD" : `VIOLATED by ${overCeiling.map((r) => r.ref).join(", ")}`
    }`
  );
  console.log(`Total Commons API requests: ${transcriptCounts.requests}.`);
  if (overCeiling.length > 0) process.exitCode = 1;

  // The pure cross-check, shown on strings taken verbatim from the files above.
  console.log("\nPURE CROSS-CHECK SPOT CHECKS (inputs are the strings printed above):");
  for (const [a, b] of [
    ["CC BY-SA 4.0", "CC BY-SA 4.0"],
    ["CC BY-SA 4.0", "CC BY-SA 3.0"],
    ["CC BY-SA 4.0", "CC BY-NC-ND 3.0"],
  ] as [string, string][]) {
    console.log(`  licencesAgree(${JSON.stringify(a)}, ${JSON.stringify(b)}) = ${licencesAgree(a, b)}`);
  }
  console.log(`  licenceFromWikitext("{{Cc-by-nc-nd-3.0}}{{Cc-by-sa-4.0}}") = ${JSON.stringify(licenceFromWikitext("{{Cc-by-nc-nd-3.0}}{{Cc-by-sa-4.0}}"))}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
