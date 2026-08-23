import "server-only";
import type { createClient } from "@/lib/supabase/server";
import { newCounters, recordJobRun, readFlag } from "@/lib/engine/cron";
import {
  createPostconditionLog,
  isRowId,
  statusFromPostconditions,
  worstStatus,
} from "@/lib/engine/postconditions";
import { postconditionDetail, writeCountsFrom } from "@/lib/engine/silent-success";
import { detectProductAnnouncement, productStatusFor } from "@/lib/engine/product-signals";
import { resolveEntity, proposeSlug } from "@/lib/engine/entity-resolution";
import { controlRead } from "@/lib/engine/queue-read";
import { concludeEmptyQueue } from "./reader-liveness";
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

  // No manufacturer records means nothing can be created — but "there are no
  // manufacturers" and "we were not allowed to read the manufacturers" are the
  // same zero rows and the same absent error, and this used to record `success`
  // for both. The corroboration is free here: `reference` is the whole answer
  // from engine_reference_data (manufacturers UNION categories), filtered to
  // manufacturers in application code. Categories coming back means the read was
  // permitted; nothing at all coming back means there is no evidence either way.
  if (manufacturers.length === 0) {
    const outcome = await concludeEmptyQueue(supabase, {
      stage: JOB,
      source: "engine_reference_data",
      kind: "security_definer_rpc",
      rowsReturned: reference.length,
      eligible: 0,
      reason: "no_manufacturer_records",
      liveness: { form: "same_read_filtered", rowsReturned: reference.length },
    });
    await recordJobRun(supabase, JOB, outcome.status, counters, outcome.detail,
      outcome.error ?? undefined,
      undefined,
      // The stage classifies ITSELF. Without this the two columns added by
      // 20260823b are written NULL on every run, and a NULL there means
      // UNMEASURED — so the engine would have gained an observability surface
      // that observes nothing.
      { stageOutcome: outcome.verdict.outcome, ambiguity: outcome.verdict.ambiguity }
    );
    return { status: outcome.status, ...counters, detail: outcome.detail };
  }

  // The discovery queue itself. Empty is legitimate and common, so it gets the
  // same treatment rather than an early `success`: engine_reference_data has
  // already answered in this pass, so its row count is the control read and
  // there is no extra round trip.
  if (discoveries.length === 0) {
    const outcome = await concludeEmptyQueue(supabase, {
      stage: JOB,
      source: "engine_briefable_discoveries",
      kind: "security_definer_rpc",
      rowsReturned: 0,
      eligible: 0,
      reason: "no_briefable_discoveries",
      liveness: controlRead("engine_reference_data", reference.length),
    });
    await recordJobRun(supabase, JOB, outcome.status, counters, outcome.detail,
      outcome.error ?? undefined,
      undefined,
      // The stage classifies ITSELF. Without this the two columns added by
      // 20260823b are written NULL on every run, and a NULL there means
      // UNMEASURED — so the engine would have gained an observability surface
      // that observes nothing.
      { stageOutcome: outcome.verdict.outcome, ambiguity: outcome.verdict.ambiguity }
    );
    return { status: outcome.status, ...counters, detail: outcome.detail };
  }

  const created: string[] = [];
  const heldForReview: string[] = [];
  let notAProductAnnouncement = 0;
  let evidenceUnavailable = 0;
  const log = createPostconditionLog(counters);

  for (const discovery of discoveries) {
    counters.examined++;

    const signal = detectProductAnnouncement(discovery.title, discovery.summary, manufacturers);
    if (!signal) {
      notAProductAnnouncement++;
      counters.deduped++;
      continue;
    }

    // Does the catalogue already have it? Resolution runs against product
    // records only — matching a product name to an ARTICLE title would be
    // meaningless here.
    const resolution = resolveEntity(signal.productName, existingProducts);

    await log.pendingCreatedId({
      operation: "engine_record_entity_resolution",
      subject: signal.productName,
      migration: "supabase/migrations/20260822_silent_success_telemetry.sql",
      // It is the audit trail for "why didn't this create a product?", so a
      // silent no-op would leave every skip unexplained while the run still
      // reported success.
      run: () =>
        supabase.rpc("engine_record_entity_resolution", {
          p_discovery_id: discovery.id,
          p_candidate_name: signal.productName,
          p_normalised: resolution.normalised,
          p_product_id: resolution.matchedId,
          p_content_id: null,
          p_score: resolution.score,
          p_decision: resolution.decision,
          p_explanation: resolution.explanation,
        }),
    });

    if (resolution.decision === "matched_existing") {
      counters.deduped++;
      continue;
    }
    // Too close to call. Creating the product risks a duplicate; the
    // resolution row above is the record a human resolves it from.
    if (resolution.decision === "ambiguous") {
      heldForReview.push(`${signal.productName} ~ ${resolution.matchedName}`);
      counters.deduped++;
      continue;
    }
    if (resolution.decision === "ignored") {
      notAProductAnnouncement++;
      counters.deduped++;
      continue;
    }

    // A product needs a real category. Guessing one would misfile the product
    // across the whole public taxonomy, so an unknown category is a skip.
    if (!discovery.category_slug || !categorySlugs.has(discovery.category_slug)) {
      heldForReview.push(`${signal.productName} — no known category on the discovery`);
      counters.deduped++;
      continue;
    }

    const slug = proposeSlug(signal.productName, takenSlugs);
    if (!slug) {
      counters.failed++;
      continue;
    }

    // The error was previously discarded and `?? []` used. A failed evidence
    // read then created a product with NO source_urls attached — a record
    // asserting a product exists with nothing behind it, which is exactly the
    // shape this project forbids. A product without its evidence is not
    // created at all.
    const { data: evidenceRows, error: evidenceError } = await supabase.rpc("engine_evidence_for", {
      p_discovery_id: discovery.id,
    });
    if (evidenceError || evidenceRows === null) {
      counters.failed++;
      evidenceUnavailable++;
      continue;
    }
    const sourceUrls = (evidenceRows as { url: string }[]).map((e) => e.url);

    // WAS: `if (typeof result === "string" && !result.includes("-"))` — a
    // hand-rolled "is this a uuid?" test that answered NO for every status
    // string and then fell through to `String(result)`. When `result` was
    // `null` — a revoked grant, a changed signature — the literal string
    // "null" was pushed as a product id, `created` was incremented, and the
    // pass reported having assembled a product that does not exist.
    // Captured before the closure: the `if (!discovery.category_slug) continue`
    // guard above narrows the property, but that narrowing does not survive
    // into a callback.
    const categorySlug = discovery.category_slug;

    const result = await log.createdId({
      operation: "engine_assemble_product",
      subject: `${signal.productName} (${signal.manufacturerName})`,
      benign: [
        "duplicate_slug",
        "unknown_manufacturer",
        "unknown_category",
        "rejected_unknown_discovery",
        "rejected_discovery_not_relevant",
      ],
      run: () =>
        supabase.rpc("engine_assemble_product", {
          p_discovery_id: discovery.id,
          p_name: signal.productName,
          p_slug: slug,
          p_manufacturer_slug: signal.manufacturerSlug,
          p_category_slug: categorySlug,
          // 'rumored' unless a primary source confirmed it — the schema already
          // has the honest option, so an unconfirmed product says so.
          p_status: productStatusFor(discovery.claim_status),
          p_source_urls: sourceUrls,
        }),
    });

    const productId = result.data;
    if (!isRowId(productId)) {
      // Every benign status here means the engine declined to invent missing
      // reference data or a missing antecedent. Not a failure — a decision,
      // and one a human needs to see rather than one to bury in a counter.
      if (typeof productId === "string") {
        heldForReview.push(`${signal.productName} — ${productId}`);
      }
      continue;
    }

    takenSlugs.add(slug);
    existingProducts.push({
      kind: "product", id: productId, name: signal.productName, slug, is_published: false,
    });
    created.push(`${signal.productName} (${signal.manufacturerName})`);
  }

  const jobView =
    counters.failed === 0
      ? "success"
      : counters.created + counters.deduped > 0
        ? "partial"
        : "failed";
  const postconditions = log.summarise();
  const status = worstStatus(jobView, statusFromPostconditions(postconditions));

  const detail = {
    created,
    heldForReview,
    notAProductAnnouncement,
    evidenceUnavailable,
    postconditions: postconditionDetail(postconditions),
  };
  await recordJobRun(supabase, JOB, status, counters, detail, undefined, writeCountsFrom(postconditions));
  return { status, ...counters, detail };
}
