// Idempotency and concurrency control for the Growth Engine.
//
// Two separate problems, deliberately kept separate:
//
//   IDEMPOTENCY  — "if this job runs twice, does it create the thing twice?"
//   CONCURRENCY  — "if two workers run at the same instant, do both act?"
//
// A job can be idempotent when run twice in sequence and still be unsafe when
// run twice in parallel: `select ... if not found then insert` is idempotent
// serially and races concurrently. Both columns of ENGINE_JOBS below are
// therefore assessed independently, and several jobs pass one and fail the
// other. That distinction is the whole reason this file exists.
//
// Pure and testable — the lease decision takes plain values; the RPC call that
// actually claims the lease lives in src/lib/engine/guard.ts.

import type { EngineCapability } from "./circuit-breaker.ts";

// ---------------------------------------------------------------------------
// Idempotency audit — kept in code, not in a document, so it can be tested
// ---------------------------------------------------------------------------

export type IdempotencyMechanism =
  /** A unique index or unique constraint makes a second write impossible. */
  | "unique_constraint"
  /** The RPC reads, decides, then writes. Safe serially, RACES in parallel. */
  | "read_then_write"
  /** The job only ever updates existing rows to a computed value. */
  | "idempotent_upsert"
  /** The job writes nothing durable beyond its own audit row. */
  | "read_only"
  /** Append-only log. Duplicates are rows in a log, not duplicate entities. */
  | "append_only_log";

export type JobIdempotency = {
  job: string;
  capability: EngineCapability;
  /** Safe to run twice in sequence without duplicating an entity. */
  idempotent: boolean;
  /** Safe for two workers to run simultaneously without duplicating an entity. */
  concurrencySafe: boolean;
  mechanism: IdempotencyMechanism;
  /** Precisely what protects it, or precisely what does not. */
  note: string;
};

/**
 * Every scheduled stage in src/app/api/engine/tick/route.ts, audited.
 *
 * `concurrencySafe: false` entries are covered by the tick-level lease
 * (`decideLease` below) rather than by their own protection — the lease is what
 * makes two overlapping cron invocations impossible in the first place, and the
 * per-job protection is the second layer underneath it.
 */
export const ENGINE_JOBS: readonly JobIdempotency[] = [
  {
    job: "engine_discover",
    capability: "discovery",
    idempotent: true,
    concurrencySafe: false,
    mechanism: "read_then_write",
    note:
      "engine_upsert_discovery does `select id where dedupe_key = ...` and inserts when absent. " +
      "engine_discoveries_dedupe_unique prevents an actual duplicate row, so the entity cannot be " +
      "duplicated — but two concurrent workers make the loser raise unique_violation, which the RPC " +
      "does not catch, so it surfaces as a job error rather than a clean 'deduped'. The pending " +
      "engine-safety migration converts it to `on conflict ... do update`.",
  },
  {
    job: "engine_relevance",
    capability: "classification",
    idempotent: true,
    concurrencySafe: true,
    mechanism: "idempotent_upsert",
    note:
      "engine_set_relevance UPDATEs a row to a deterministic verdict and refuses to overwrite a " +
      "human override. Running it twice writes the same values; running it concurrently writes the " +
      "same values twice. No new rows either way.",
  },
  {
    job: "engine_update_proposals",
    capability: "maintenance",
    idempotent: true,
    concurrencySafe: true,
    mechanism: "unique_constraint",
    note:
      "engine_update_proposals_one_open_content / _one_open_product are partial unique indexes on " +
      "(target, reason) where state='open', and the RPC catches unique_violation and refreshes. " +
      "Concurrent duplicates are impossible at the database level.",
  },
  {
    job: "engine_product_assembly",
    capability: "creation",
    idempotent: true,
    concurrencySafe: false,
    mechanism: "read_then_write",
    note:
      "engine_assemble_product checks `exists (select 1 from products where slug = ...)` then " +
      "inserts. products.slug is unique so a duplicate PRODUCT cannot be created, but the losing " +
      "worker raises unique_violation instead of returning 'duplicate_slug'. Also creates a " +
      "media_requirements row, which is protected by media_requirements_one_open_per_product.",
  },
  {
    job: "engine_briefs",
    capability: "creation",
    idempotent: true,
    concurrencySafe: true,
    mechanism: "unique_constraint",
    note:
      "engine_briefs_one_live_per_discovery is a partial unique index and engine_create_brief " +
      "catches unique_violation, returning 'deduped'. This is the pattern the other creation jobs " +
      "should follow.",
  },
  {
    job: "engine_draft_assembly",
    capability: "creation",
    idempotent: true,
    concurrencySafe: false,
    mechanism: "read_then_write",
    note:
      "engine_assemble_draft checks the slug then inserts; content_items.slug is unique so no " +
      "duplicate ARTICLE can exist, but the loser raises unique_violation. A second, subtler gap: " +
      "engine_assemblable_briefs filters on assembled_content_id is null and the brief is only " +
      "stamped at the END of the function, so two workers can both select the same brief. The slug " +
      "collision is what actually saves it, and only because proposeSlug is deterministic.",
  },
  {
    job: "engine_search_intelligence",
    capability: "classification",
    idempotent: true,
    concurrencySafe: true,
    mechanism: "idempotent_upsert",
    note:
      "engine_aggregate_searches recomputes absolute counts from analytics_events and upserts on " +
      "search_intelligence_query_unique. Counts are assigned, not incremented, so repetition is a " +
      "no-op rather than a doubling.",
  },
  {
    job: "engine_opportunities",
    capability: "classification",
    idempotent: true,
    concurrencySafe: true,
    mechanism: "idempotent_upsert",
    note:
      "engine_upsert_opportunity has `on conflict (subject_type, subject_key) do update`. The score " +
      "is recomputed from the same window, so a second run writes the same number.",
  },
  {
    job: "engine_trends",
    capability: "classification",
    idempotent: true,
    concurrencySafe: true,
    mechanism: "idempotent_upsert",
    note:
      "engine_upsert_trend has `on conflict (topic_key) do update`. observation_count increments on " +
      "every pass by design — that is a counter of observations, not a duplicated entity.",
  },
  {
    job: "engine_media_acquisition",
    capability: "media_acquisition",
    idempotent: false,
    concurrencySafe: false,
    mechanism: "read_then_write",
    note:
      "THE ONE GENUINELY NON-IDEMPOTENT JOB. engine_record_media_candidate has no uniqueness " +
      "constraint of any kind and always inserts. The job guards on the requirement's " +
      "existing_candidates count read at the start of the pass, so it is safe in practice for " +
      "sequential runs — but a requirement whose candidates were all rejected drops back to a zero " +
      "count and gets fresh duplicates, and two concurrent workers both read zero and both insert. " +
      "The pending engine-safety migration adds a partial unique index on " +
      "(media_requirement_id, source_organisation, asset_type) for live states.",
  },
  {
    job: "engine_freshness",
    capability: "maintenance",
    idempotent: true,
    concurrencySafe: false,
    mechanism: "read_then_write",
    note:
      "engine_upsert_freshness selects an open review for (entity, reason) and inserts when absent. " +
      "engine_freshness_reviews has NO unique index, so this is idempotent serially and produces " +
      "genuine duplicate open reviews under concurrency. The pending migration adds the partial " +
      "unique indexes the RPC's comment already assumes exist.",
  },
  {
    job: "engine_internal_links",
    capability: "maintenance",
    idempotent: true,
    concurrencySafe: false,
    mechanism: "read_then_write",
    note: "Writes only through engine_upsert_freshness — inherits exactly its properties.",
  },
  {
    job: "engine_hero_media",
    capability: "maintenance",
    idempotent: true,
    concurrencySafe: true,
    mechanism: "unique_constraint",
    note:
      "engine_flag_weak_hero selects then inserts, but media_requirements_one_open_per_product and " +
      "_per_content are unique partial indexes, so a concurrent duplicate is refused by the " +
      "database. The pending migration adds `on conflict do nothing` so the loser returns " +
      "'already_tracked' instead of raising.",
  },
  {
    job: "engine_entity_resolution_log",
    capability: "classification",
    idempotent: false,
    concurrencySafe: true,
    mechanism: "append_only_log",
    note:
      "engine_record_entity_resolution appends one row per decision on every pass, by design — it " +
      "is the audit trail for 'why didn't this create a product?'. Repeated runs therefore grow it " +
      "without bound. Accepted deliberately: they are log entries, not duplicated entities, and " +
      "losing the history of a decision would be worse. Not a scheduled stage of its own; listed " +
      "because two stages write to it.",
  },
  {
    // WAS ABSENT, AND THAT WAS A HOLE.
    //
    // shadow-job.ts records under "engine_shadow"; tick/route.ts gated it as
    // "engine_shadow_evaluation". Neither string appeared in this list, so
    // capabilityOf() returned null, guard.ts's entire `if (capability)` block —
    // both the circuit-breaker check AND the concurrency-lease check — was
    // skipped, and budgetGateForJob waved the unknown job through. The shadow
    // stage therefore ran even when a breaker had halted ALL_CAPABILITIES.
    //
    // The two names are reconciled to this one; the tick's stage->job map now
    // points here too. An unregistered job silently bypassing the safety layer
    // is the failure mode, so gateFor() now refuses any job it cannot map
    // rather than defaulting to allow.
    job: "engine_shadow",
    // Classification, not creation: a shadow decision is an assessment of a
    // candidate that already exists, and it mints no durable artefact anyone
    // reads as content. Deliberately NOT "creation" — putting it there would
    // make shadow evaluation consume the daily creation budget, which would
    // starve the real creation stages to pay for measurement.
    capability: "classification",
    idempotent: true,
    concurrencySafe: true,
    mechanism: "unique_constraint",
    note:
      "engine_shadow_record_decision has a unique constraint on the candidate, and answers " +
      "'deduped' to a repeat. Re-running the evaluation therefore banks no additional readiness " +
      "credit, which is what stops the 500-decision requirement being reachable by repetition. " +
      "Publishes nothing and cannot: the RPC takes no parameter naming a content item or product.",
  },
];

/** Jobs whose output counts toward the daily creation budget. */
export const CREATION_JOBS: readonly string[] = ENGINE_JOBS.filter(
  (j) => j.capability === "creation"
).map((j) => j.job);

export function jobsFailingConcurrency(): readonly JobIdempotency[] {
  return ENGINE_JOBS.filter((j) => !j.concurrencySafe);
}

export function jobsFailingIdempotency(): readonly JobIdempotency[] {
  return ENGINE_JOBS.filter((j) => !j.idempotent);
}

export function capabilityOf(job: string): EngineCapability | null {
  return ENGINE_JOBS.find((j) => j.job === job)?.capability ?? null;
}

// ---------------------------------------------------------------------------
// Tick lease — stops two workers acting on the same opportunity
// ---------------------------------------------------------------------------

/**
 * How long a tick may hold its lease before another worker is entitled to
 * conclude it died and take over. Vercel's function ceiling is well under this,
 * so a lease older than this genuinely cannot still be running.
 */
export const TICK_LEASE_SECONDS = 900;

/**
 * The window a single idempotency key covers. Two cron invocations inside the
 * same window collapse to one logical run; a key that changed every second
 * would provide no protection at all.
 */
export const TICK_WINDOW_MINUTES = 5;

/**
 * Deterministic idempotency key for a run.
 *
 * Bucketed by wall-clock window rather than derived from the payload, because a
 * tick has no payload — its input is "whatever the database looks like now".
 * Two invocations in the same window are the duplicate we care about.
 */
export function idempotencyKeyFor(job: string, now: Date, windowMinutes = TICK_WINDOW_MINUTES): string {
  const minutes = Math.max(1, Math.floor(windowMinutes));
  const bucketMs = minutes * 60_000;
  const bucketStart = Math.floor(now.getTime() / bucketMs) * bucketMs;
  return `${job}:${new Date(bucketStart).toISOString()}`;
}

/** What the database told us when we asked for the lease. */
export type LeaseOutcome =
  /** We hold it. Proceed. */
  | "acquired"
  /** Another worker holds a live lease for this window. */
  | "already_running"
  /** A previous holder's lease expired and we took it over. */
  | "took_over_expired"
  /** The lease RPC does not exist or could not be called. */
  | "unavailable";

export type LeaseDecision = {
  proceed: boolean;
  /** Capabilities that must stay halted even when `proceed` is true. */
  halts: readonly EngineCapability[];
  why: string;
};

/**
 * What to do given a lease outcome.
 *
 * The `unavailable` case is the interesting one, and it fails CLOSED in the
 * narrow sense that matters: the pass may still MEASURE (classification and
 * maintenance stages only recompute or recommend, and running them twice
 * changes nothing), but it may not CREATE. Without a lease we cannot rule out a
 * second worker doing the same creation, and duplicate articles and products
 * are the expensive, hard-to-unpick kind of damage.
 *
 * This is deliberately not "halt everything": bricking the whole engine on a
 * missing migration would replace one silent failure with another, whereas a
 * pass that keeps measuring and refuses to create is both safe and visibly
 * reported in engine_job_runs.
 */
export function decideLease(outcome: LeaseOutcome): LeaseDecision {
  switch (outcome) {
    case "acquired":
      return { proceed: true, halts: [], why: "Lease acquired; this worker is the only one running this window." };
    case "took_over_expired":
      return {
        proceed: true,
        halts: [],
        why:
          "The previous holder's lease had expired, so it cannot still be running and this worker " +
          "took it over. The stale run stays in engine_job_runs marked as abandoned rather than " +
          "being deleted.",
      };
    case "already_running":
      return {
        proceed: false,
        halts: [],
        why:
          "Another worker holds a live lease for this window. Stopping is the correct outcome, not " +
          "an error: two workers acting on the same opportunity is exactly what the lease prevents.",
      };
    case "unavailable":
      return {
        proceed: true,
        halts: ["creation", "media_acquisition", "publication"],
        why:
          "The run-lease RPC could not be called, so concurrent execution cannot be ruled out. " +
          "Measurement and maintenance continue (they are idempotent and change nothing on a " +
          "second run), but creation, media acquisition and publication are halted — without a " +
          "lease, two workers could each create the same article or product. Apply " +
          "supabase/migrations_pending/20260822_engine_safety.sql to restore them.",
      };
  }
}

/**
 * Whether a lease held since `startedAt` should be considered expired.
 * Pure so the takeover rule can be tested without a clock.
 */
export function leaseExpired(startedAt: Date, now: Date, leaseSeconds = TICK_LEASE_SECONDS): boolean {
  return now.getTime() - startedAt.getTime() > leaseSeconds * 1000;
}
