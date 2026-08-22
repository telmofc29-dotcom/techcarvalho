import "server-only";
import type { createClient } from "@/lib/supabase/server";
import {
  concludeQueueRead,
  controlRead,
  type LivenessEvidence,
  type QueueReadKind,
  type QueueReadOutcome,
} from "@/lib/engine/queue-read";
import type { StageCounters } from "@/lib/engine/stage-outcome";

// The I/O half of queue-read.ts. Every RULE lives in that file, which is pure
// and unit-tested; this one only performs the control read and hands the numbers
// over. Nothing here decides anything, deliberately — a rule that lives in a
// `server-only` module is a rule that cannot be tested, and this whole area of
// the codebase exists because untestable rules drift.

type Client = Awaited<ReturnType<typeof createClient>>;

/**
 * The control read, and why it is this one.
 *
 * `engine_reference_data()` unions `manufacturers` and `taxonomy_categories`.
 * Four properties make it the right corroborator and they are all checkable in
 * supabase/migrations/20260822_phase6_draft_assembly.sql:
 *
 *   1. SECURITY DEFINER, granted to anon — the same execution path every engine
 *      queue read uses, so if the engine's grants are gone this one is gone too.
 *   2. NO filter. It selects every row of both tables unconditionally.
 *   3. NO kill-switch check. Unlike `engine_assemblable_briefs`, whose body opens
 *      with `if not engine_flag_enabled('research') then return; end if;`, this
 *      one cannot return early for a configuration reason.
 *   4. It MUST return rows on any install that has ever had a product. A product
 *      cannot exist without a manufacturer — `products.manufacturer_id` is NOT
 *      NULL and the engine is forbidden from inventing one — so an empty answer
 *      here is itself news.
 *
 * WHAT IT PROVES: the anon reader is awake, and engine SECURITY DEFINER RPCs are
 * executing and returning data. That excludes the BLANKET loss of grants, which
 * is the shape of the 2026-08 incident.
 *
 * WHAT IT DOES NOT PROVE: that some OTHER function's body is behaving. See the
 * header of queue-read.ts, and the `engine_queue_probe` draft in
 * supabase/migrations_pending/, which is what would close that.
 *
 * NOT seeded by any migration. The non-emptiness of this read is an operational
 * fact about a live catalogue, not a schema guarantee — so when it comes back
 * empty this returns NO evidence rather than pretending. On a genuinely empty
 * install every stage therefore lands on UNCLASSIFIED, which is the correct
 * fail-closed answer: an engine that cannot tell whether it is able to see
 * anything must not go on creating records.
 */
export const CONTROL_READ_SOURCE = "engine_reference_data";

export async function probeReaderLiveness(supabase: Client): Promise<LivenessEvidence> {
  const { data, error } = await supabase.rpc(CONTROL_READ_SOURCE);

  if (error) {
    return {
      form: "none",
      why:
        `The control read ${CONTROL_READ_SOURCE} itself errored (${error.message}), so nothing about ` +
        `the reader could be established. A corroborator that cannot answer corroborates nothing.`,
    };
  }
  if (!Array.isArray(data)) {
    return {
      form: "none",
      why:
        `${CONTROL_READ_SOURCE} is declared \`returns table\` and answered ` +
        `${data === null ? "null" : typeof data} instead of a row set. That is the function not doing ` +
        `what it says, not a fact about the catalogue, so it establishes nothing.`,
    };
  }
  // rows === 0 is handled inside queue-read.ts, which treats an empty
  // corroborator as no evidence. Reported honestly here rather than filtered.
  return controlRead(CONTROL_READ_SOURCE, data.length);
}

/**
 * Classify a pass whose input queue produced no eligible work, and say what it
 * must record.
 *
 * `liveness` may be supplied by a job that already performed a qualifying read
 * in the same pass — several jobs read `engine_reference_data` or
 * `engine_existing_entities` anyway, and a second round trip for evidence
 * already in hand would be waste. When it is omitted, the control read is made
 * here, and ONLY on the empty path: a pass that found work pays nothing.
 */
export async function concludeEmptyQueue(
  supabase: Client,
  args: {
    stage: string;
    source: string;
    kind: QueueReadKind;
    /** Rows the read returned before application-side filtering. */
    rowsReturned: number | null;
    /** Rows the stage considered eligible. Normally 0 on this path. */
    eligible: number;
    /** Whether the read itself errored. Usually false — errors exit earlier. */
    errored?: boolean;
    /** The job's existing human-readable reason, preserved in the detail payload. */
    reason?: string;
    counters?: Partial<StageCounters>;
    liveness?: LivenessEvidence;
  }
): Promise<QueueReadOutcome> {
  const liveness = args.liveness ?? (await probeReaderLiveness(supabase));
  return concludeQueueRead({
    stage: args.stage,
    reason: args.reason,
    counters: args.counters,
    facts: {
      source: args.source,
      kind: args.kind,
      errored: args.errored ?? false,
      rowsReturned: args.rowsReturned,
      eligible: args.eligible,
      liveness,
    },
  });
}
