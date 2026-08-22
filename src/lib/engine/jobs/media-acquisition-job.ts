import "server-only";
import type { createClient } from "@/lib/supabase/server";
import { newCounters, recordJobRun, readFlag } from "@/lib/engine/cron";
import {
  createPostconditionLog,
  statusFromPostconditions,
  worstStatus,
} from "@/lib/engine/postconditions";
import { postconditionDetail, writeCountsFrom } from "@/lib/engine/silent-success";
import { runAcquisitionPipeline } from "@/lib/media/providers/pipeline";
import { buildEnabledProviders } from "@/lib/media/providers/registry";
import { DEFAULT_RANKING_CONTEXT } from "@/lib/media/providers/ranking";
import type { SubjectIdentity } from "@/lib/media/providers/query-expansion";
import type { StageResult } from "./discovery";

type Client = Awaited<ReturnType<typeof createClient>>;
const JOB = "engine_media_acquisition";

/**
 * How many requirements get a LIVE provider search per pass.
 *
 * Deliberately tiny. Wikimedia Commons is paced at 2500ms between requests (a
 * real 429 was hit on the third request of an earlier import), and one subject
 * costs a dozen or more requests once its categories are enumerated in full.
 * Two subjects is roughly a minute of wall clock, which fits a cron
 * invocation; twenty would not, and a pass that times out half-way leaves
 * candidates recorded for some requirements and not others with no record of
 * which. The backlog drains over successive passes instead.
 */
const PROVIDER_SEARCH_BUDGET_PER_PASS = 2;

// Media acquisition pass.
//
// Phase 3/4 only RECORDED that media was missing. This pass actively proposes
// candidate routes to resolve each open requirement — while holding the line
// that finding an image is not permission to use it.
//
// Two candidate classes are produced, and the difference between them is the
// entire safety model:
//
//  1. ORIGINAL TECHCARVALHO GRAPHIC (asset_type 'generated'). We own the
//     output outright, so there is no third-party rights question at all.
//     These are the only candidates that skip human rights review, and even
//     then they still require a human to actually create and ingest the asset.
//     This is the route that can genuinely unblock inventory at scale.
//
//  2. MANUFACTURER PRESS LIBRARY (asset_type 'image'). Recorded ONLY as a
//     pointer to the source, carrying that source's real, human-verified
//     rights status. Always requires_human_review = true, always enters
//     rights_review, never approved by this code. It cannot ingest anything.
//
//  3. APPROVED OPEN-LICENCE PROVIDER (asset_type 'image'). Added 2026-08-22.
//     A real search of an approved provider — currently Wikimedia Commons —
//     through the central pipeline in src/lib/media/providers/. Unlike class 2
//     this identifies a SPECIFIC file and carries the primary evidence read
//     from that file's own source page, so a human reviewing it has something
//     to check rather than a link to a terms document.
//
//     It is still class-2 safe. "Approved provider" means THE ENGINE MAY
//     SEARCH IT, never that its assets are approved: candidates are recorded
//     with rights_status 'unclear_manual_review' and requires_human_review
//     true, unconditionally, no matter how complete the evidence came back.
//     The pipeline's own strongest verdict is 'evidence_complete', which is a
//     statement about evidence and not a permission — see
//     src/lib/media/providers/rights-verification.ts.
//
// The pass never downloads an image, never hotlinks, and never writes to
// media_assets. It proposes; a human disposes.

/** Which requirements can honestly be satisfied by an original graphic. */
function graphicOpportunity(input: {
  kind: string;
  label: string;
  categorySlug: string | null;
}): { suitable: boolean; note: string } {
  // Content records are almost always satisfiable with an original diagram,
  // table or explanatory graphic — that is how every published article on the
  // site is currently illustrated.
  if (input.kind === "content") {
    return {
      suitable: true,
      note:
        "Content records can be illustrated with an original TechCarvalho editorial graphic " +
        "(comparison table, spec diagram, timeline or explainer). TechCarvalho owns the output " +
        "outright, so no third-party rights question arises. Requires a human to create and ingest it.",
    };
  }

  // Products are the hard case. An original graphic can legitimately present
  // VERIFIED SPECIFICATIONS (a spec table, a generation timeline, a comparison
  // chart) — but it must never be a fabricated depiction of the physical
  // product. That distinction is the difference between an editorial graphic
  // and a fake product photo.
  return {
    suitable: true,
    note:
      "A product record can carry an original TechCarvalho SPEC/COMPARISON GRAPHIC built from " +
      "verified specifications (spec table, generation timeline, comparison chart). This must NOT " +
      "be a depiction of the physical product — no fabricated or AI-generated product photography. " +
      "A real photograph still requires manufacturer permission or staff photography.",
  };
}

/**
 * Compact account of a provider search, for `engine_media_candidates.reason`.
 *
 * The RPC truncates this at 1000 characters, so it is written worst-first:
 * the verdict, then WHY the winner beat the alternatives, then what was
 * rejected and on what grounds. Losing the tail of a rejection breakdown is
 * survivable; losing the verdict is not. The full report — every query issued,
 * every candidate, every criterion score — is produced by
 * `scripts/engine-media-search.ts` and belongs in the requirement's notes, not
 * in a candidate row.
 */
function providerCandidateReason(report: {
  status: string;
  // The PRECISE outcome, not the coarse legacy status. See the note at the
  // tally below for why this had to be threaded through.
  outcome?: { state: string; headline: string };
  narrative: string;
  evaluations: { accepted: boolean; rejection: { code: string } | null }[];
  ranking: { whyItWon: string } | null;
}): string {
  const rejections = new Map<string, number>();
  for (const e of report.evaluations) {
    if (e.rejection) rejections.set(e.rejection.code, (rejections.get(e.rejection.code) ?? 0) + 1);
  }
  const breakdown = [...rejections.entries()].map(([c, n]) => `${c}×${n}`).join(", ") || "none";

  const head =
    `[${report.outcome?.state ?? report.status}] REQUIRES HUMAN VERIFICATION AT SOURCE — the engine ` +
    `established that the evidence is complete, which is not the same as permission to publish. `;
  const why = report.ranking ? `WHY THIS ONE: ${report.ranking.whyItWon} ` : "";
  const rest = `REJECTED: ${breakdown}. ${report.narrative}`;

  return (head + why + rest).slice(0, 1000);
}

export async function runMediaAcquisition(supabase: Client): Promise<StageResult> {
  const counters = newCounters();

  const researchFlag = await readFlag(supabase, "research");
  if (!researchFlag.enabled) {
    // An UNREADABLE flag is a failure, not a deliberate skip. Recording it as
    // 'skipped' used to hide it twice over: the reason said the flag was off
    // when it had never been read, and silent-success.ts filters skipped runs
    // out entirely, so one denied RPC switched the engine off and still
    // produced a clean detector report.
    const status = researchFlag.readable ? "skipped" : "failed";
    await recordJobRun(
      supabase,
      JOB,
      status,
      counters,
      { reason: researchFlag.reason },
      researchFlag.error
    );
    return { status, ...counters, detail: { reason: researchFlag.reason } };
  }

  const { data, error } = await supabase.rpc("engine_open_media_requirements", { p_limit: 100 });
  if (error) {
    await recordJobRun(supabase, JOB, "failed", counters, {}, error.message);
    return { status: "failed", ...counters, detail: { error: error.message } };
  }

  const requirements = (data ?? []) as {
    requirement_id: string;
    kind: string;
    entity_id: string;
    slug: string;
    label: string;
    manufacturer: string | null;
    category_slug: string | null;
    existing_candidates: number;
  }[];

  // Source registry, keyed by organisation, so a manufacturer candidate can
  // carry that source's REAL verified rights status rather than a guess.
  //
  // The error here was previously DISCARDED, and that mattered more than it
  // looks: a failed read produced an empty map, every manufacturer candidate
  // silently fell back to rights_status 'unverified', and the pass reported
  // success. Downgrading real rights data to "unknown" without saying so is a
  // media-rights failure wearing a successful run as a disguise. The pass now
  // refuses to record manufacturer candidates at all when it cannot read the
  // registry, rather than recording them with fabricated ignorance.
  const { data: sources, error: sourcesError } = await supabase
    .from("engine_sources")
    .select("id, organisation, media_rights_status, media_republication_permitted, terms_url, registration_required");
  const sourceRegistryAvailable = !sourcesError;
  const sourceByOrg = new Map(
    (sources ?? []).map((s) => [s.organisation.toLowerCase(), s])
  );

  const tally = {
    graphic: 0,
    manufacturer: 0,
    skipped: 0,
    manufacturerSuppressed: 0,
    sourceRegistryError: sourcesError?.message ?? null,
    openLicence: 0,
    openLicenceNegative: 0,
    providerStatus: {} as Record<string, number>,
    providerErrors: [] as string[],
  };
  const log = createPostconditionLog(counters);
  let providerSearches = 0;

  // Source URLs already in the library, so the ranking's duplication criterion
  // is a real check rather than a nominal one. Running as `anon` this sees
  // published assets only — which is the set that matters: the failure being
  // avoided is the same photograph appearing as the hero of two pages.
  const { data: existingAssets } = await supabase.from("media_assets").select("source_url");
  const existingSourceUrls = new Set(
    (existingAssets ?? []).map((a) => a.source_url).filter((u): u is string => Boolean(u))
  );

  for (const req of requirements) {
    counters.examined++;

    // Idempotency: a requirement that already has candidates is left alone, so
    // repeated passes do not accumulate duplicate proposals.
    if (req.existing_candidates > 0) {
      counters.deduped++;
      tally.skipped++;
      continue;
    }

    // --- Candidate 1: original TechCarvalho graphic ---
    const graphic = graphicOpportunity({
      kind: req.kind,
      label: req.label,
      categorySlug: req.category_slug,
    });
    if (graphic.suitable) {
      // Return value previously discarded. engine_record_media_candidate
      // answers 'rejected_invalid' for a rights_status outside its enum — so a
      // typo or an enum change would have produced a pass that recorded zero
      // candidates while counting every one of them as created.
      const g = await log.rpc({
        operation: "engine_record_media_candidate(graphic)",
        subject: `${req.kind}/${req.slug}`,
        run: () =>
          supabase.rpc("engine_record_media_candidate", {
            p_requirement_id: req.requirement_id,
            p_product_id: req.kind === "product" ? req.entity_id : null,
            p_content_id: req.kind === "content" ? req.entity_id : null,
            p_source_organisation: "TechCarvalho (original graphic)",
            p_source_url: null,
            p_asset_url: null,
            p_asset_type: "generated",
            p_width: null,
            p_height: null,
            p_potential_licence: "TechCarvalho-owned original work",
            p_rights_status: "confirmed_usable",
            p_confidence: 0.95,
            // The one case that legitimately skips rights review: we own it.
            // A human still has to create and ingest the asset.
            p_requires_human_review: false,
            p_reason: graphic.note,
          }),
        accepted: ["created"],
        benign: ["deduped"],
      });
      if (g.data === "created") tally.graphic++;
    }

    // --- Candidate 2: manufacturer press library (products only) ---
    // Suppressed entirely when the source registry could not be read. A
    // candidate carrying 'unverified' because we genuinely assessed the source
    // and found nothing is honest; one carrying 'unverified' because the query
    // failed is a fabricated rights assessment.
    if (req.kind === "product" && req.manufacturer && !sourceRegistryAvailable) {
      tally.manufacturerSuppressed++;
    } else if (req.kind === "product" && req.manufacturer) {
      const src = sourceByOrg.get(req.manufacturer.toLowerCase());
      // Never invent a rights status. If we have no assessed source for this
      // manufacturer, the candidate records 'unverified' and says so.
      const rightsStatus = src?.media_rights_status ?? "unverified";
      const reason = src
        ? `Manufacturer press library for ${req.manufacturer}. Rights status on file: ${rightsStatus}. ` +
          (src.media_republication_permitted
            ? "Republication IS permitted per the reviewed terms — still requires a human to select and ingest a specific asset."
            : "Republication is NOT established. This candidate is a pointer for a human to pursue permission; it does not authorise use of any image.") +
          (src.registration_required ? " Registration/accreditation required first." : "")
        : `No assessed source on file for ${req.manufacturer}. Rights are unknown — a human must evaluate before any image is used.`;

      const m = await log.rpc({
        operation: "engine_record_media_candidate(manufacturer)",
        subject: `product/${req.slug} <- ${req.manufacturer}`,
        run: () =>
          supabase.rpc("engine_record_media_candidate", {
            p_requirement_id: req.requirement_id,
            p_product_id: req.entity_id,
            p_content_id: null,
            p_source_organisation: req.manufacturer,
            p_source_url: src?.terms_url ?? null,
            p_asset_url: null,
            p_asset_type: "image",
            p_width: null,
            p_height: null,
            p_potential_licence: src?.terms_url ?? null,
            p_rights_status: rightsStatus,
            p_confidence: src ? 0.4 : 0.1,
            // ALWAYS true for third-party imagery, regardless of how
            // favourable the recorded terms look. No code path approves
            // manufacturer media.
            p_requires_human_review: true,
            p_reason: reason,
          }),
        accepted: ["created"],
        benign: ["deduped"],
      });
      if (m.data === "created") tally.manufacturer++;
    }

    // --- Candidate 3: approved open-licence provider (products only) ---
    // A live search of every provider approved for search, through the ONE
    // central pipeline: entity validation -> provenance -> rights verification
    // -> ranking -> publication validation. Nothing here is Commons-specific;
    // the provider list comes from the registry.
    if (req.kind === "product" && providerSearches < PROVIDER_SEARCH_BUDGET_PER_PASS) {
      providerSearches++;
      const identity: SubjectIdentity = {
        canonicalName: req.label,
        manufacturer: req.manufacturer,
        aliases: [],
        family: null,
      };

      let report: Awaited<ReturnType<typeof runAcquisitionPipeline>> | null = null;
      try {
        report = await runAcquisitionPipeline(identity, buildEnabledProviders(identity), {
          maxCandidates: 40,
          ranking: {
            ...DEFAULT_RANKING_CONTEXT,
            // media_assets has no content-hash column yet — see
            // supabase/migrations_pending/20260822_media_provenance_evidence.sql.
            // Until it does, duplication is detected by source URL only, and
            // the same photograph re-uploaded under a second Commons filename
            // would not be caught. Recorded here rather than left implied.
            existingContentHashes: new Set<string>(),
            existingSourceUrls,
          },
        });
      } catch (e) {
        // A provider throwing is an OUTAGE, not a finding of "no photograph
        // exists". Counted as a failure so the pass cannot report success
        // while having silently searched nothing.
        counters.failed++;
        tally.providerErrors.push(`${req.slug}: ${(e as Error).message}`);
      }

      if (report) {
        // COUNTED BY THE SEVEN-STATE OUTCOME, not the coarse legacy status.
        //
        // src/lib/media/providers/outcome.ts distinguishes NO_RESULTS (the
        // provider was reached, understood, and genuinely has nothing) from
        // PROVIDER_PARSE_FAILURE (we could not read what it sent) and
        // PROVIDER_OUTAGE (we never got an answer). The legacy `status`
        // collapses the last two into 'provider_unavailable' and, worse, a
        // parse failure that refuses every candidate is indistinguishable from
        // an exhausted search — which is exactly the bug that hid the Commons
        // `|other versions=` regression for a whole run.
        //
        // The taxonomy existed and the pipeline computed it, but this job — the
        // only thing that actually runs in production and writes rows — still
        // read `report.status`, so the distinction reached neither the database
        // nor the telemetry. Implemented is not wired.
        const outcomeState = report.outcome?.state ?? report.status;
        tally.providerStatus[outcomeState] = (tally.providerStatus[outcomeState] ?? 0) + 1;

        // A fault in OUR code or in the provider is not a finding about the
        // world, and it must not be filed under "we looked and found nothing".
        if (outcomeState === "PROVIDER_PARSE_FAILURE" || outcomeState === "PROVIDER_OUTAGE") {
          counters.failed++;
          tally.providerErrors.push(
            `${req.slug}: ${outcomeState} — ${report.outcome?.headline ?? "no detail"}`
          );
        }

        if (report.status === "resolved" && report.ranking?.winner && report.proposedRow) {
          const winner = report.ranking.winner.candidate;
          const prov = winner.provenance;

          // Invariant: what the pipeline would write must NOT be publishable
          // on its own. If that ever stops being true, record nothing.
          if (report.publicationSafety && !report.publicationSafety.safe) {
            counters.failed++;
            tally.providerErrors.push(`${req.slug}: publication-safety invariant violated, candidate discarded`);
          } else {
            const c = await log.rpc({
              operation: "engine_record_media_candidate(open_licence_provider)",
              subject: `product/${req.slug} <- ${winner.approval.label}`,
              run: () =>
                supabase.rpc("engine_record_media_candidate", {
                  p_requirement_id: req.requirement_id,
                  p_product_id: req.entity_id,
                  p_content_id: null,
                  p_source_organisation: winner.approval.label,
                  p_source_url: prov.sourcePageUrl,
                  p_asset_url: prov.originalFileUrl,
                  p_asset_type: "image",
                  p_width: prov.width,
                  p_height: prov.height,
                  p_potential_licence: prov.licenceDeclared ?? prov.licenceMetadata,
                  // NEVER 'confirmed_usable'. The pipeline established that the
                  // EVIDENCE is complete; a human establishes the permission.
                  p_rights_status: "unclear_manual_review",
                  p_confidence: Math.min(0.9, winner.entityMatch.confidence),
                  p_requires_human_review: true,
                  p_reason: providerCandidateReason(report),
                }),
              accepted: ["created"],
              benign: ["deduped"],
            });
            if (c.data === "created") tally.openLicence++;
          }
        } else if (
          // Only a genuine finding is recorded as one. Previously this fired on
          // the legacy status, so a run that failed to PARSE the provider's
          // answer could still write a 'no_source_found' row — a permanent
          // record asserting somebody looked and there was nothing there.
          outcomeState === "NO_RESULTS" ||
          outcomeState === "WRONG_ENTITY_RESULTS" ||
          outcomeState === "RIGHTS_UNCERTAIN" ||
          outcomeState === "PROVENANCE_INCOMPLETE"
        ) {
          // A negative result is a finding worth keeping. Recorded as a
          // candidate row with rights_status 'no_source_found' so it shows up
          // in the admin Media Requirements surface rather than only existing
          // as an absence somebody has to notice.
          const n = await log.rpc({
            operation: "engine_record_media_candidate(open_licence_negative)",
            subject: `product/${req.slug} <- searched, nothing usable`,
            run: () =>
              supabase.rpc("engine_record_media_candidate", {
                p_requirement_id: req.requirement_id,
                p_product_id: req.entity_id,
                p_content_id: null,
                p_source_organisation: "Approved open-licence providers (searched)",
                p_source_url: null,
                p_asset_url: null,
                p_asset_type: "image",
                p_width: null,
                p_height: null,
                p_potential_licence: null,
                p_rights_status: "no_source_found",
                p_confidence: 0,
                p_requires_human_review: true,
                p_reason: providerCandidateReason(report),
              }),
            accepted: ["created"],
            benign: ["deduped"],
          });
          if (n.data === "created") tally.openLicenceNegative++;
        } else {
          // provider_unavailable. Recorded NOWHERE as a candidate, because
          // "the search did not happen" must never be stored next to "the
          // search found nothing" — the 2026-08 empty-vs-failed lesson.
          counters.failed++;
          tally.providerErrors.push(`${req.slug}: ${report.narrative}`);
        }
      }
    }
  }

  const jobView =
    counters.failed === 0 ? "success" : counters.created + counters.deduped > 0 ? "partial" : "failed";
  const postconditions = log.summarise();
  const status = worstStatus(jobView, statusFromPostconditions(postconditions));

  const detail = { ...tally, postconditions: postconditionDetail(postconditions) };
  await recordJobRun(supabase, JOB, status, counters, detail, undefined, writeCountsFrom(postconditions));
  return { status, ...counters, detail };
}
