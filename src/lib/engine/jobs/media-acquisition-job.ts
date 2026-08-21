import "server-only";
import type { createClient } from "@/lib/supabase/server";
import { newCounters, recordJobRun, isFlagEnabled } from "@/lib/engine/cron";
import type { StageResult } from "./discovery";

type Client = Awaited<ReturnType<typeof createClient>>;
const JOB = "engine_media_acquisition";

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

export async function runMediaAcquisition(supabase: Client): Promise<StageResult> {
  const counters = newCounters();

  if (!(await isFlagEnabled(supabase, "research"))) {
    await recordJobRun(supabase, JOB, "skipped", counters, { reason: "research_disabled" });
    return { status: "skipped", ...counters };
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
  const { data: sources } = await supabase
    .from("engine_sources")
    .select("id, organisation, media_rights_status, media_republication_permitted, terms_url, registration_required");
  const sourceByOrg = new Map(
    (sources ?? []).map((s) => [s.organisation.toLowerCase(), s])
  );

  const tally = { graphic: 0, manufacturer: 0, skipped: 0 };

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
      const { error: gErr } = await supabase.rpc("engine_record_media_candidate", {
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
      });
      if (gErr) counters.failed++;
      else {
        counters.created++;
        tally.graphic++;
      }
    }

    // --- Candidate 2: manufacturer press library (products only) ---
    if (req.kind === "product" && req.manufacturer) {
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

      const { error: mErr } = await supabase.rpc("engine_record_media_candidate", {
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
        // ALWAYS true for third-party imagery, regardless of how favourable
        // the recorded terms look. No code path approves manufacturer media.
        p_requires_human_review: true,
        p_reason: reason,
      });
      if (mErr) counters.failed++;
      else {
        counters.created++;
        tally.manufacturer++;
      }
    }
  }

  const status =
    counters.failed === 0 ? "success" : counters.created + counters.deduped > 0 ? "partial" : "failed";
  await recordJobRun(supabase, JOB, status, counters, tally);
  return { status, ...counters, detail: tally };
}
