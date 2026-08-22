import "server-only";
import type { createClient } from "@/lib/supabase/server";
import { newCounters, recordJobRun, isFlagEnabled } from "@/lib/engine/cron";
import { detectProductAnnouncement, productStatusFor } from "@/lib/engine/product-signals";
import { resolveEntity, proposeSlug } from "@/lib/engine/entity-resolution";
import type { StageResult } from "./discovery";

type Client = Awaited<ReturnType<typeof createClient>>;
const JOB = "engine_product_assembly";

// Product-profile assembly.
//
// Creates an UNPUBLISHED product shell when a discovery announces a genuinely
// new product from a manufacturer we already have a record for. It fills in
// only what the evidence actually establishes — name, manufacturer, category,
// and whether the product is confirmed or merely reported.
//
// It writes NO specifications, prices, release dates or summary. Those are the
// fields a machine would have to invent, and inventing them is the exact thing
// this project forbids. They stay null, with the sources attached, for a human.
//
// Every product created here is blocked on media from birth: a media_requirement
// row is created alongside it, so it appears as Draft / Awaiting Media rather
// than becoming media debt discovered months later.
export async function runProductAssembly(supabase: Client): Promise<StageResult> {
  const counters = newCounters();

  if (!(await isFlagEnabled(supabase, "research"))) {
    await recordJobRun(supabase, JOB, "skipped", counters, { reason: "research_disabled" });
    return { status: "skipped", ...counters };
  }

  const [
    { data: discoveryRows, error: discoveryError },
    { data: entityRows, error: entityError },
    { data: referenceRows, error: referenceError },
  ] = await Promise.all([
    supabase.rpc("engine_briefable_discoveries", { p_limit: 30 }),
    supabase.rpc("engine_existing_entities"),
    supabase.rpc("engine_reference_data"),
  ]);

  const anyError = discoveryError ?? entityError ?? referenceError;
  if (anyError) {
    await recordJobRun(supabase, JOB, "failed", counters, {}, anyError.message);
    return { status: "failed", ...counters, detail: { error: anyError.message } };
  }

  const discoveries = (discoveryRows ?? []) as {
    id: string;
    title: string;
    summary: string | null;
    category_slug: string | null;
    claim_status: string;
  }[];
  const entities = (entityRows ?? []) as {
    kind: "product" | "content";
    id: string;
    name: string;
    slug: string;
    is_published: boolean;
  }[];
  const reference = (referenceRows ?? []) as {
    kind: "manufacturer" | "category";
    id: string;
    name: string;
    slug: string;
  }[];

  const manufacturers = reference.filter((r) => r.kind === "manufacturer");
  const categorySlugs = new Set(reference.filter((r) => r.kind === "category").map((r) => r.slug));
  const existingProducts = entities.filter((e) => e.kind === "product");
  const takenSlugs = new Set(existingProducts.map((p) => p.slug));

  // No manufacturer records means nothing can be created, and that is a real
  // condition worth reporting rather than a silent zero.
  if (manufacturers.length === 0) {
    await recordJobRun(supabase, JOB, "success", counters, { reason: "no_manufacturer_records" });
    return { status: "success", ...counters, detail: { reason: "no_manufacturer_records" } };
  }

  const created: string[] = [];
  const heldForReview: string[] = [];
  let notAProductAnnouncement = 0;

  for (const discovery of discoveries) {
    counters.examined++;

    const signal = detectProductAnnouncement(discovery.title, discovery.summary, manufacturers);
    if (!signal) {
      notAProductAnnouncement++;
      continue;
    }

    // Does the catalogue already have it? Resolution runs against product
    // records only — matching a product name to an ARTICLE title would be
    // meaningless here.
    const resolution = resolveEntity(signal.productName, existingProducts);

    await supabase.rpc("engine_record_entity_resolution", {
      p_discovery_id: discovery.id,
      p_candidate_name: signal.productName,
      p_normalised: resolution.normalised,
      p_product_id: resolution.matchedId,
      p_content_id: null,
      p_score: resolution.score,
      p_decision: resolution.decision,
      p_explanation: resolution.explanation,
    });

    if (resolution.decision === "matched_existing") {
      counters.deduped++;
      continue;
    }
    // Too close to call. Creating the product risks a duplicate; the
    // resolution row above is the record a human resolves it from.
    if (resolution.decision === "ambiguous") {
      heldForReview.push(`${signal.productName} ~ ${resolution.matchedName}`);
      continue;
    }
    if (resolution.decision === "ignored") {
      notAProductAnnouncement++;
      continue;
    }

    // A product needs a real category. Guessing one would misfile the product
    // across the whole public taxonomy, so an unknown category is a skip.
    if (!discovery.category_slug || !categorySlugs.has(discovery.category_slug)) {
      heldForReview.push(`${signal.productName} — no known category on the discovery`);
      continue;
    }

    const slug = proposeSlug(signal.productName, takenSlugs);
    if (!slug) {
      counters.failed++;
      continue;
    }

    const { data: evidenceRows } = await supabase.rpc("engine_evidence_for", {
      p_discovery_id: discovery.id,
    });
    const sourceUrls = ((evidenceRows ?? []) as { url: string }[]).map((e) => e.url);

    const { data: result, error: assembleError } = await supabase.rpc("engine_assemble_product", {
      p_discovery_id: discovery.id,
      p_name: signal.productName,
      p_slug: slug,
      p_manufacturer_slug: signal.manufacturerSlug,
      p_category_slug: discovery.category_slug,
      // 'rumored' unless a primary source confirmed it — the schema already
      // has the honest option, so an unconfirmed product says so.
      p_status: productStatusFor(discovery.claim_status),
      p_source_urls: sourceUrls,
    });

    if (assembleError) {
      counters.failed++;
      continue;
    }
    if (result === "duplicate_slug") {
      counters.deduped++;
      continue;
    }
    // unknown_manufacturer / unknown_category / rejected_invalid all mean the
    // engine declined to invent missing reference data. Not a failure.
    if (typeof result === "string" && !result.includes("-")) {
      heldForReview.push(`${signal.productName} — ${result}`);
      continue;
    }

    takenSlugs.add(slug);
    existingProducts.push({
      kind: "product", id: String(result), name: signal.productName, slug, is_published: false,
    });
    counters.created++;
    created.push(`${signal.productName} (${signal.manufacturerName})`);
  }

  const status =
    counters.failed === 0
      ? "success"
      : counters.created + counters.deduped > 0
        ? "partial"
        : "failed";
  await recordJobRun(supabase, JOB, status, counters, {
    created,
    heldForReview,
    notAProductAnnouncement,
  });
  return { status, ...counters, detail: { created, heldForReview, notAProductAnnouncement } };
}
