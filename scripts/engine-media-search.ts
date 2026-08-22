// Exercise the media acquisition engine against real, unresolved requirements.
//
// WHAT THIS IS AND IS NOT
// -----------------------
// It is NOT a second media system. Every decision here is made by the same
// modules the engine job uses — src/lib/media/providers/{query-expansion,
// entity-match, rights-verification, ranking, pipeline}.ts — and this file
// contributes no rule of its own. It exists because a cron job cannot show its
// working, and the working is the deliverable: which queries were issued, what
// came back, which candidates were refused and on exactly what grounds, and
// why the winner beat the alternatives.
//
// Unlike scripts/import-commons-media-drones-actioncams.ts, which carried a
// hand-verified list of four specific files, this script is handed a PRODUCT
// and finds the file itself. The hand-verified script remains the record of
// how those four were done; this is the machine doing the same job with its
// reasoning written down.
//
// MODES
//   (default)    Search and report. Reads only. Writes nothing anywhere.
//   --acquire    Additionally download the winning file into media-private and
//                create an UNPUBLISHED media_assets row with
//                rights_status='pending_verification'. It does NOT publish, does
//                NOT copy to media-public, does NOT link a hero, and does NOT
//                set the requirement to 'approved'. A human does all four.
//   --notes      Write the full search record into media_requirements.notes so
//                a negative result is visible in the admin surface instead of
//                only existing in a terminal somewhere.
//   --dry-acquire Run the whole acquisition path — resolve, download, measure,
//                hash, build the row, check the publication gate — and stop
//                before the upload and the insert. Proves the path works
//                without leaving anything behind to clean up.
//   --reverify   Ignore the requirements entirely and instead re-check every
//                asset ALREADY in the library against its source: has the
//                licence changed, has the creator changed, has the file page
//                been deleted? Read-only; reports, changes nothing.
//
// Usage:
//   npx tsx scripts/engine-media-search.ts --slugs=ps5-pro,nvidia-rtx-5080
//   npx tsx scripts/engine-media-search.ts --blocked           (all open requirements)
//   TC_ADMIN_EMAIL=... TC_ADMIN_PASSWORD=... npx tsx scripts/engine-media-search.ts --slugs=x --acquire

import { createHash } from "node:crypto";
import { loadEnvLocal, createAdminClient, type IngestClient } from "./_shared";
import { MEDIA_PRIVATE_BUCKET } from "../src/lib/media/constants";
import { runAcquisitionPipeline, type PipelineReport } from "../src/lib/media/providers/pipeline.ts";
import { buildEnabledProviders, ALL_PROVIDER_APPROVALS } from "../src/lib/media/providers/registry.ts";
import { DEFAULT_RANKING_CONTEXT } from "../src/lib/media/providers/ranking.ts";
import { detectRightsDrift } from "../src/lib/media/providers/rights-verification.ts";
import { CommonsClient, createCommonsProvider } from "../src/lib/media/providers/wikimedia-commons.ts";
import type { SubjectIdentity } from "../src/lib/media/providers/query-expansion.ts";
import { evaluatePublishEligibility } from "../src/lib/media/rights.ts";

loadEnvLocal();

const USER_AGENT = "TechCarvalhoBot/1.0 (+https://www.techcarvalho.com; media-rights-verification)";
/** Pure downscale of the untouched original. Not a crop — aspect preserved. */
const TARGET_WIDTH = 1600;

type Options = {
  slugs: string[];
  blocked: boolean;
  acquire: boolean;
  notes: boolean;
  reverify: boolean;
  dryAcquire: boolean;
  limit: number;
};

function parseOptions(argv: string[]): Options {
  const slugArg = argv.find((a) => a.startsWith("--slugs="));
  const limitArg = argv.find((a) => a.startsWith("--limit="));
  return {
    slugs: slugArg ? slugArg.slice("--slugs=".length).split(",").map((s) => s.trim()).filter(Boolean) : [],
    blocked: argv.includes("--blocked"),
    acquire: argv.includes("--acquire"),
    notes: argv.includes("--notes"),
    reverify: argv.includes("--reverify"),
    dryAcquire: argv.includes("--dry-acquire"),
    limit: limitArg ? Number(limitArg.slice("--limit=".length)) : 50,
  };
}

/**
 * Re-check assets already in the library against their sources.
 *
 * Two adversarial cases stop being hypothetical once anything is published:
 * the source page disappears, and the licence changes at source. Both leave a
 * live page rendering a credit that cites terms nobody granted, and neither is
 * detectable without going back and looking.
 *
 * Read-only. It reports drift; it does not unpublish anything, because
 * unpublishing a live page is an editorial act with consequences a script
 * should not take on its own initiative.
 */
async function reverify(client: IngestClient): Promise<void> {
  const { data: assets, error } = await client
    .from("media_assets")
    .select("id, source_url, license, creator, rights_status, publication_status, storage_path")
    .not("source_url", "is", null);
  if (error) throw new Error(`media_assets lookup failed: ${error.message}`);

  const commons = (assets ?? []).filter((a) => (a.source_url ?? "").includes("commons.wikimedia.org"));
  console.log(`\n${assets!.length} asset(s) carry a source URL; ${commons.length} are Wikimedia Commons files.\n`);

  const client_ = new CommonsClient();
  const provider = createCommonsProvider({
    // Identity is irrelevant to resolve(); re-verification is about rights, not
    // about whether the picture still depicts the right thing.
    identity: { canonicalName: "re-verification", manufacturer: null, aliases: [], family: null },
    client: client_,
  });

  let unchanged = 0;
  const drifted: string[] = [];

  for (const asset of commons) {
    const title = decodeURIComponent((asset.source_url ?? "").split("/wiki/")[1] ?? "").replace(/_/g, " ");
    if (!title) {
      console.log(`  SKIP ${asset.id}: could not derive a file title from ${asset.source_url}`);
      continue;
    }

    const resolved = await provider.resolve({
      provider: "wikimedia_commons",
      providerRef: title,
      title,
      foundBy: { strategy: "text_search", value: title, rationale: "re-verification", identityTokens: [] },
      descriptors: [],
    });

    // A resolve failure is NOT "the page is gone". Distinguishing them matters:
    // treating an outage as a deletion would mass-invalidate the whole library
    // the first time Commons has a bad afternoon.
    if (resolved.outcome.status !== "ok" && resolved.outcome.status !== "not_found") {
      console.log(`  UNKNOWN ${title}: ${resolved.outcome.status} — could not check, NOT treated as drift.`);
      continue;
    }

    const report = detectRightsDrift(
      { license: asset.license, creator: asset.creator, source_url: asset.source_url, contentHash: null },
      resolved.outcome.status === "not_found" ? null : resolved.provenance
    );

    if (!report.changed) {
      unchanged++;
      continue;
    }
    const severity = report.invalidatesVerification ? "INVALIDATED" : "CHANGED";
    drifted.push(`${severity} ${title} (${asset.publication_status})`);
    console.log(`  ${severity} ${title} [${asset.publication_status}] — ${report.narrative}`);
    for (const f of report.findings) console.log(`      ${f.severity} ${f.field}: ${f.was} -> ${f.now}`);
  }

  console.log(`\nRe-verification complete: ${unchanged} unchanged, ${drifted.length} drifted.`);
  if (drifted.length === 0) {
    console.log("Every recorded licence and creator still matches its source. Nothing to act on.");
  } else {
    console.log("Each INVALIDATED asset needs a human decision. Do NOT delete the private archive copy — it is the");
    console.log("only remaining evidence of what the source said when the site relied on it.");
  }
}

type Subject = {
  productId: string | null;
  slug: string;
  identity: SubjectIdentity;
  requirementId: string | null;
  requirementStatus: string | null;
};

/**
 * Aliases a product is genuinely also called.
 *
 * Every entry must be the SAME product under another name. A sibling model is
 * never an alias, and this table is deliberately short and hand-written rather
 * than generated, because a wrong entry here is a wrong photograph on a page.
 */
const ALIAS_TABLE: Record<string, { aliases: string[]; family: string | null }> = {
  "playstation-5-pro": { aliases: ["PlayStation 5 Pro", "PS5 Pro"], family: "PlayStation 5" },
  "rtx-5080": { aliases: ["GeForce RTX 5080", "RTX 5080"], family: "GeForce RTX 50" },
  "amd-ryzen-7-9800x3d": { aliases: ["Ryzen 7 9800X3D", "AMD Ryzen 7 9800X3D"], family: "Ryzen 9000" },
  "intel-core-ultra-9-285k": { aliases: ["Core Ultra 9 285K", "Intel Core Ultra 9 285K"], family: "Intel Core Ultra 200S" },
  "tp-link-deco-xe75": { aliases: ["Deco XE75", "TP-Link Deco XE75"], family: "TP-Link Deco" },
  "tp-link-deco-be85": { aliases: ["Deco BE85", "TP-Link Deco BE85"], family: "TP-Link Deco" },
  "roborock-saros-10r": { aliases: ["Saros 10R", "Roborock Saros 10R"], family: "Roborock Saros" },
  "amazon-echo-show-8-4th-gen": { aliases: ["Echo Show 8", "Echo Show 8 (4th Gen)"], family: "Amazon Echo Show" },
};

async function loadSubjects(client: IngestClient, options: Options): Promise<Subject[]> {
  const query = client
    .from("products")
    .select("id, slug, name, is_published, manufacturers(name)")
    .order("slug");
  const { data: products, error } = options.slugs.length > 0 ? await query.in("slug", options.slugs) : await query;
  if (error) throw new Error(`products lookup failed: ${error.message}`);

  const { data: requirements, error: reqError } = await client
    .from("media_requirements")
    .select("id, product_id, sourcing_status");
  if (reqError) throw new Error(`media_requirements lookup failed: ${reqError.message}`);
  const reqByProduct = new Map((requirements ?? []).filter((r) => r.product_id).map((r) => [r.product_id!, r]));

  const subjects: Subject[] = [];
  for (const p of products ?? []) {
    const req = reqByProduct.get(p.id) ?? null;
    if (options.blocked && options.slugs.length === 0) {
      const open = !req || ["needed", "sourcing", "blocked"].includes(req.sourcing_status);
      if (!open || p.is_published) continue;
    }
    const manufacturer =
      (p as unknown as { manufacturers?: { name: string } | null }).manufacturers?.name ?? null;
    const extra = ALIAS_TABLE[p.slug] ?? { aliases: [], family: null };
    subjects.push({
      productId: p.id,
      slug: p.slug,
      identity: { canonicalName: p.name, manufacturer, aliases: extra.aliases, family: extra.family },
      requirementId: req?.id ?? null,
      requirementStatus: req?.sourcing_status ?? null,
    });
  }
  return subjects.slice(0, options.limit);
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

function printReport(subject: Subject, report: PipelineReport): void {
  const line = "=".repeat(78);
  console.log(`\n${line}\n${subject.identity.canonicalName}  [${subject.slug}]  status=${report.status}\n${line}`);

  console.log(`\n-- QUERIES ISSUED (${report.queryLog.length}) --`);
  for (const q of report.queryLog) {
    console.log(`  [${q.query.strategy}] "${q.query.value}" -> ${q.hits} hit(s)`);
    console.log(`      ${q.note}`);
  }

  if (report.refusedQueries.length > 0) {
    console.log(`\n-- EXPANSIONS GENERATED AND REFUSED (${report.refusedQueries.length}) --`);
    for (const r of report.refusedQueries) console.log(`  [${r.strategy}] "${r.value}": ${r.reason}`);
  }

  console.log(`\n-- CANDIDATES EXAMINED (${report.evaluations.length}) --`);
  for (const e of report.evaluations) {
    const verdict = e.accepted ? "ACCEPTED" : `REJECTED (${e.rejection?.code})`;
    console.log(`  ${verdict}: ${e.descriptor.title}`);
    console.log(`      stage=${e.stageReached} entityConfidence=${e.entityMatch?.confidence.toFixed(2) ?? "n/a"}`);
    if (e.rejection) console.log(`      why: ${e.rejection.message}`);
    if (e.rights) console.log(`      rights: ${e.rights.evidenceClass} — ${e.rights.narrative}`);
    if (e.provenance) {
      console.log(
        `      provenance: licence(page)=${e.provenance.licenceDeclared} licence(meta)=${e.provenance.licenceMetadata} ` +
          `creator=${e.provenance.creator} ${e.provenance.width}x${e.provenance.height} ${e.provenance.contentHash ?? "no hash"}`
      );
    }
  }

  if (report.ranking) {
    console.log(`\n-- RANKING (${report.ranking.ranked.length} candidate(s)) --`);
    for (const r of report.ranking.ranked) {
      console.log(`  ${r.total.toFixed(3)}  ${r.candidate.descriptor.title}`);
      for (const s of r.scores) {
        console.log(`      ${s.criterion.padEnd(24)} ${s.score.toFixed(2)} (w${s.weight})  ${s.rationale}`);
      }
    }
    console.log(`\n-- WHY THE WINNER WON --\n  ${report.ranking.whyItWon}`);
  }

  if (report.publicationSafety) {
    console.log(`\n-- PUBLICATION SAFETY --`);
    console.log(`  safe(correctly blocked)=${report.publicationSafety.safe}`);
    console.log(`  ${report.publicationSafety.explanation}`);
  }

  console.log(`\n-- VERDICT --\n  ${report.narrative}`);
}

/** The record written into media_requirements.notes. */
function notesFor(report: PipelineReport): string {
  const queries = report.queryLog.map((q) => `  [${q.query.strategy}] "${q.query.value}" -> ${q.hits}: ${q.note}`).join("\n");
  const rejects = report.evaluations
    .filter((e) => !e.accepted)
    .map((e) => `  REJECTED ${e.rejection?.code}: ${e.descriptor.title} — ${e.rejection?.message}`)
    .join("\n");
  return [
    `AUTOMATED PROVIDER SEARCH ${new Date().toISOString()} — status=${report.status}`,
    "Providers approved for search: " +
      ALL_PROVIDER_APPROVALS.filter((a) => a.approvedForSearch).map((a) => a.label).join(", "),
    "",
    "QUERIES:",
    queries || "  (none)",
    "",
    "REJECTIONS:",
    rejects || "  (none)",
    "",
    report.ranking ? `WINNER: ${report.ranking.whyItWon}` : "WINNER: none",
    "",
    report.narrative,
    "",
    "NOTE: a candidate reaching 'evidence_complete' means the primary evidence at source is complete and " +
      "self-consistent. It is NOT permission to publish. A human must open the source page and set " +
      "rights_status='verified' before anything goes live.",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Acquisition (only with --acquire)
// ---------------------------------------------------------------------------

function sanitizeFileName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9.]+/g, "-").replace(/^-+|-+$/g, "");
}

/**
 * Real pixel dimensions from the downloaded JPEG's SOF marker.
 *
 * Not belt-and-braces: MediaWiki's imageinfo hands back a `thumburl` for a
 * LARGER pre-rendered bucket than `iiurlwidth` asked for while still reporting
 * the REQUESTED size in thumbwidth/thumbheight. An earlier import recorded
 * width/height 20% too small on every row because of it. The bytes are the
 * only authority on their own size.
 */
function imageDimensions(buf: Buffer): { width: number; height: number } | null {
  return jpegDimensions(buf) ?? pngDimensions(buf);
}

/** PNG IHDR is at a fixed offset, so this is exact rather than a scan. */
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

async function acquire(
  client: IngestClient,
  subject: Subject,
  report: PipelineReport,
  dryRun: boolean
): Promise<void> {
  const winner = report.ranking?.winner?.candidate;
  if (!winner || !report.proposedRow || !report.publicationSafety) return;

  if (!report.publicationSafety.safe) {
    console.error("  ABORT: publication-safety invariant violated. Nothing written.");
    return;
  }
  if (!winner.rights.mayAcquire) {
    console.error(`  ABORT: rights assessment says mayAcquire=false (${winner.rights.evidenceClass}).`);
    return;
  }

  const prov = winner.provenance;
  if (!prov.originalFileUrl) {
    console.error("  ABORT: no original file URL.");
    return;
  }

  // Commons' own downscale of the untouched original: a pure resize, aspect
  // preserved to the pixel. Not a crop, so no "changes were made" disclosure
  // is owed beyond the scale — see docs/product-media-strategy.md §2.1.
  const thumbUrl = prov.originalFileUrl.replace(
    /\/commons\/([0-9a-f])\/([0-9a-f]{2})\//,
    `/commons/thumb/$1/$2/`
  );
  const url = thumbUrl !== prov.originalFileUrl
    ? `${thumbUrl}/${TARGET_WIDTH}px-${prov.originalFileUrl.split("/").pop()}`
    : prov.originalFileUrl;

  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) {
    console.error(`  ABORT: download failed ${res.status} ${res.statusText} for ${url}`);
    return;
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  const measured = imageDimensions(buffer);
  if (!measured) {
    console.error("  ABORT: could not read dimensions from the downloaded bytes — refusing to record a guess.");
    return;
  }
  const sha256 = createHash("sha256").update(buffer).digest("hex");
  console.log(`  Downloaded ${buffer.length} bytes, ${measured.width}x${measured.height}, sha256:${sha256.slice(0, 16)}…`);

  const storagePath = `image/${crypto.randomUUID()}-${sanitizeFileName(`${subject.slug}-${prov.originalFileName ?? "file"}`)}`;

  // --dry-acquire stops exactly here, having proven every step that can be
  // proven without writing: the file resolves, downloads, is the format and
  // size claimed, hashes, and produces a row the publication gate refuses.
  // Worth having as a separate mode because the alternative way to test the
  // acquisition path is to run it against production and then clean up, and a
  // cleanup that goes wrong deletes somebody's evidence.
  if (dryRun) {
    const dryRow = {
      ...report.proposedRow,
      storage_path: storagePath,
      width: measured.width,
      height: measured.height,
    };
    const eligibility = evaluatePublishEligibility(dryRow);
    console.log(`  DRY ACQUIRE — nothing written.`);
    console.log(`    would upload to ${MEDIA_PRIVATE_BUCKET}/${storagePath}`);
    console.log(`    would insert rights_status='${dryRow.rights_status}' publication_status='${dryRow.publication_status}' owned=${dryRow.owned}`);
    console.log(`    licence='${dryRow.license}' creator='${dryRow.creator}' attribution='${dryRow.attribution}'`);
    console.log(`    publication gate: ${eligibility.allowed ? "ALLOWED — INVARIANT VIOLATED" : `refused (${eligibility.reason})`}`);
    return;
  }

  const { error: uploadError } = await client.storage
    .from(MEDIA_PRIVATE_BUCKET)
    .upload(storagePath, buffer, { contentType: prov.mimeType ?? "image/jpeg", upsert: false });
  if (uploadError) {
    console.error(`  ABORT: upload failed: ${uploadError.message}`);
    return;
  }

  const row = {
    ...report.proposedRow,
    storage_path: storagePath,
    width: measured.width,
    height: measured.height,
    alt_text: null as string | null,
    caption: null as string | null,
  };

  // The rights gate runs here too, and this time we WANT it to refuse: an
  // engine-acquired asset that cleared it would mean the engine had granted
  // itself publication rights.
  const eligibility = evaluatePublishEligibility(row);
  if (eligibility.allowed) {
    console.error("  ABORT: the row would be publishable, which the engine must never produce. Rolling back.");
    await client.storage.from(MEDIA_PRIVATE_BUCKET).remove([storagePath]);
    return;
  }

  const { data: inserted, error: insertError } = await client
    .from("media_assets")
    .insert(row)
    .select("id")
    .single();
  if (insertError || !inserted) {
    console.error(`  ABORT: media_assets insert failed: ${insertError?.message}`);
    await client.storage.from(MEDIA_PRIVATE_BUCKET).remove([storagePath]);
    return;
  }

  console.log(`  ARCHIVED (unpublished) media_assets.id=${inserted.id} rights_status=${row.rights_status}`);
  console.log("  NOT published, NOT linked as hero, requirement NOT approved. A human verifies at source first.");

  if (subject.requirementId) {
    // 'available', never 'approved'. evaluateMediaReadiness() requires
    // 'approved', so the product stays unpublished — which is correct: we have
    // a file, not a permission.
    const { error } = await client
      .from("media_requirements")
      .update({
        sourcing_status: "available",
        target_source_type: "public_domain_or_cc",
        notes: `${notesFor(report)}\n\nARCHIVED media_assets.id=${inserted.id} (sha256:${sha256}) — awaiting human rights verification.`,
        updated_at: new Date().toISOString(),
      })
      .eq("id", subject.requirementId);
    if (error) console.error(`  WARNING: could not update media_requirements: ${error.message}`);
    else console.log("  media_requirements -> 'available' (NOT 'approved')");
  }
}

// ---------------------------------------------------------------------------

async function main() {
  const options = parseOptions(process.argv.slice(2));

  console.log(
    `Mode: ${
      options.acquire ? "ACQUIRE (writes)" : options.notes ? "NOTES (writes)" : options.dryAcquire ? "DRY ACQUIRE (no writes)" : "REPORT ONLY (no writes)"
    }`
  );
  console.log("Providers:");
  for (const a of ALL_PROVIDER_APPROVALS) {
    console.log(`  ${a.approvedForSearch ? "SEARCHABLE" : "disabled  "} ${a.label}: ${a.rationale.slice(0, 160)}…`);
  }

  const client = await createAdminClient();

  if (options.reverify) {
    await reverify(client);
    return;
  }

  const subjects = await loadSubjects(client, options);

  // Real duplication context: every source URL already in the library, so the
  // ranking's site_duplication criterion checks something rather than always
  // scoring 1. As admin this sees unpublished assets too, which is what we
  // want — a photograph already archived but not yet published is still a
  // duplicate, and re-acquiring it would create a second copy of the same file.
  const { data: existingAssets, error: assetError } = await client.from("media_assets").select("source_url");
  if (assetError) throw new Error(`media_assets lookup failed: ${assetError.message}`);
  const existingSourceUrls = new Set(
    (existingAssets ?? []).map((a) => a.source_url).filter((u): u is string => Boolean(u))
  );
  console.log(`\n${subjects.length} subject(s) to search. ${existingSourceUrls.size} source URL(s) already in the library.\n`);

  const summary: { slug: string; status: string; accepted: number; rejected: number }[] = [];

  for (const subject of subjects) {
    const report = await runAcquisitionPipeline(subject.identity, buildEnabledProviders(subject.identity), {
      maxCandidates: 60,
      ranking: {
        ...DEFAULT_RANKING_CONTEXT,
        // No content-hash column on media_assets yet; see
        // supabase/migrations_pending/20260822_media_provenance_evidence.sql.
        existingContentHashes: new Set<string>(),
        existingSourceUrls,
      },
    });

    printReport(subject, report);
    summary.push({
      slug: subject.slug,
      status: report.status,
      accepted: report.evaluations.filter((e) => e.accepted).length,
      rejected: report.evaluations.filter((e) => !e.accepted).length,
    });

    if ((options.acquire || options.dryAcquire) && report.status === "resolved") {
      await acquire(client, subject, report, options.dryAcquire && !options.acquire);
    }
    else if (options.notes && subject.requirementId) {
      const { error } = await client
        .from("media_requirements")
        .update({ notes: notesFor(report), updated_at: new Date().toISOString() })
        .eq("id", subject.requirementId);
      if (error) console.error(`  WARNING: could not write notes: ${error.message}`);
      else console.log("  Search record written to media_requirements.notes");
    }
  }

  console.log(`\n${"=".repeat(78)}\nSUMMARY\n${"=".repeat(78)}`);
  console.log("slug".padEnd(36) + "status".padEnd(26) + "acc".padStart(5) + "rej".padStart(5));
  for (const s of summary) {
    console.log(s.slug.padEnd(36) + s.status.padEnd(26) + String(s.accepted).padStart(5) + String(s.rejected).padStart(5));
  }
  console.log(
    "\nFinding nothing is a legitimate result. A 'no_results' row means every query ran and the photograph " +
      "does not exist at an approved provider yet — blocked on photography, not on permission."
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
