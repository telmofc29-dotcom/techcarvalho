// Rollback: reversing what an engine run actually wrote.
//
// WHY THIS EXISTS
// ---------------
// The readiness scorecard requires a `rollback_test` proof at chaos level, and
// an audit found the word "rollback" appeared nowhere in src/ except in two
// comments. The capability was not merely unproven, it was absent — proofs.ts
// reported NOT_IMPLEMENTED, and both CANARY and AUTONOMOUS require it, so
// neither could ever unlock. This module is the missing thing.
//
// WHAT ROLLBACK MEANS HERE, PRECISELY
// -----------------------------------
// Not "undo everything the engine has ever done". A run assembled some rows;
// rollback removes exactly those rows and restores exactly the values it
// overwrote, or it refuses. There is no partial, best-effort mode: a plan that
// cannot be fully reversed is not executed, because a half-reversed draft is
// worse than an unreversed one — it leaves an article with its sources deleted
// and no record of why.
//
// THREE DESIGN DECISIONS, EACH DELIBERATELY CONSERVATIVE
// -----------------------------------------------------
// 1. ROLLBACK IS ADMIN-ONLY AND IS NEVER INVOKED BY THE ENGINE.
//    Engine jobs run as `anon` — a Vercel Cron request carries no cookies — and
//    the anon key ships in client-side JavaScript. A delete-capable rollback
//    path reachable by anon would hand anyone with curl a way to destroy
//    editorial work, which is a far larger hazard than the one rollback exists
//    to contain. A human triggers it, through the admin session, under RLS.
//
// 2. IT REFUSES ANYTHING A HUMAN HAS TOUCHED.
//    The engine's output is a proposal. Once an editor has edited, approved or
//    published it, it is no longer the engine's row to withdraw. Published rows
//    are refused outright; rows modified since creation are refused; rows whose
//    recorded before-image no longer matches what is actually there are refused,
//    because reversing to a stale image would silently discard the newer edit.
//
// 3. THE PLAN IS PURE, THE EXECUTION IS NOT.
//    Everything that decides is in this file, takes plain values, and is unit
//    testable without a database. The caller performs the writes. That split is
//    what lets the refusal rules be tested exhaustively rather than by
//    inspection — and the refusal rules are the whole safety argument.

/** A single write the engine made, recorded so it can be reversed. */
export type RecordedChange = {
  /** The run that made it. Rollback operates on one run at a time. */
  runId: string;
  /** Order within the run, ascending. Reversal walks this backwards. */
  sequence: number;
  table: string;
  rowId: string;
  operation: "insert" | "update";
  /**
   * For an update: the values as they were BEFORE, column by column. For an
   * insert: null, because there was nothing before.
   *
   * Only the columns the engine actually wrote are recorded. Restoring a column
   * the engine never touched would overwrite an editor's change with a value
   * that was never the engine's to restore.
   */
  before: Record<string, unknown> | null;
  /** For an update: the values the engine wrote, used to detect later edits. */
  after: Record<string, unknown> | null;
};

/** What is actually in the database right now, for one recorded row. */
export type CurrentRowState = {
  table: string;
  rowId: string;
  /** Absent means the row is gone — already deleted by someone else. */
  present: boolean;
  /** Whether the row is publicly visible. A published row is never reversed. */
  published: boolean;
  /**
   * The current values of the columns the engine wrote. Compared against
   * `after` to detect a human edit landing on top of the engine's write.
   */
  columns: Record<string, unknown>;
};

export type RollbackAction =
  | { kind: "delete"; table: string; rowId: string; why: string }
  | { kind: "restore"; table: string; rowId: string; columns: Record<string, unknown>; why: string };

export type RollbackRefusal = {
  table: string;
  rowId: string;
  /** A stable code so a refusal can be counted and tested, not just read. */
  code:
    | "row_published"
    | "row_modified_since"
    | "row_already_gone"
    | "no_current_state"
    | "before_image_missing"
    | "unknown_operation";
  why: string;
};

export type RollbackPlan = {
  runId: string;
  /** In the order they must be applied. Children before parents. */
  actions: RollbackAction[];
  refusals: RollbackRefusal[];
  /**
   * True only when every recorded change is reversible. A plan that is not
   * complete MUST NOT be executed — see the note at the top about half-reversal.
   */
  complete: boolean;
  summary: string;
};

/**
 * Dependency order for deletion: a child must go before the parent it
 * references, or the delete is refused by a foreign key.
 *
 * Written down rather than derived, because deriving it would mean trusting a
 * schema introspection to be right about the one thing that must not be wrong.
 * A table absent from this list sorts last, which is the safe end for a
 * dependent row and is asserted by a test.
 */
export const DELETE_ORDER: readonly string[] = [
  "seo_metadata",
  "source_records",
  "media_requirements",
  "content_products",
  "content_relationships",
  "product_specs",
  "product_relationships",
  "content_items",
  "products",
];

export function deleteRank(table: string): number {
  const i = DELETE_ORDER.indexOf(table);
  return i === -1 ? DELETE_ORDER.length : i;
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  // Timestamps and numerics come back in different shapes than they went in
  // (a numeric(4,3) writes as 0.9 and reads as "0.900"), so compare the
  // normalised string form rather than the raw value. Deliberately narrow: this
  // is only used to decide "has a human changed this since", and treating a
  // formatting difference as an edit would refuse every legitimate rollback.
  if (a === null || a === undefined || b === null || b === undefined) return false;
  if (typeof a === "object" || typeof b === "object") {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  const na = Number(a);
  const nb = Number(b);
  if (!Number.isNaN(na) && !Number.isNaN(nb)) return na === nb;
  return String(a) === String(b);
}

/**
 * Decide what reversing a run would do, and what it refuses to do.
 *
 * Fails closed at every branch. A row whose current state was not supplied is
 * refused rather than assumed unchanged — "I could not look" is not "it is
 * fine", which is the rule the rest of this engine is built on.
 */
export function planRollback(
  changes: RecordedChange[],
  current: CurrentRowState[],
  opts: { runId: string }
): RollbackPlan {
  const mine = changes.filter((c) => c.runId === opts.runId);
  const byKey = new Map(current.map((c) => [`${c.table}:${c.rowId}`, c]));

  const actions: RollbackAction[] = [];
  const refusals: RollbackRefusal[] = [];

  // Reverse chronological: the last write is undone first, so an update that
  // landed on a row inserted earlier in the same run is restored before the
  // insert is removed.
  const ordered = [...mine].sort((a, b) => b.sequence - a.sequence);

  for (const change of ordered) {
    const key = `${change.table}:${change.rowId}`;
    const now = byKey.get(key);

    if (!now) {
      refusals.push({
        table: change.table,
        rowId: change.rowId,
        code: "no_current_state",
        why:
          "The current state of this row was not supplied, so whether it is safe to reverse is " +
          "unknown. An unchecked row is refused rather than assumed unchanged.",
      });
      continue;
    }

    if (!now.present) {
      refusals.push({
        table: change.table,
        rowId: change.rowId,
        code: "row_already_gone",
        why: "The row is no longer there. Somebody else has already removed it; there is nothing to reverse.",
      });
      continue;
    }

    if (now.published) {
      refusals.push({
        table: change.table,
        rowId: change.rowId,
        code: "row_published",
        why:
          "The row is PUBLISHED. Publication is a human decision, and withdrawing a live page is " +
          "not something a rollback may do on its own. Unpublish it first if that is really the intent.",
      });
      continue;
    }

    if (change.operation === "insert") {
      // A human edit on top of an engine insert. The `after` image is what the
      // engine wrote; if the row no longer matches it, somebody has worked on it.
      const edited =
        change.after !== null &&
        Object.entries(change.after).some(([col, wrote]) => !sameValue(now.columns[col], wrote));
      if (edited) {
        refusals.push({
          table: change.table,
          rowId: change.rowId,
          code: "row_modified_since",
          why:
            "The row no longer matches what the engine wrote, so a human has edited it since. " +
            "Deleting it would discard their work, which rollback never does.",
        });
        continue;
      }
      actions.push({
        kind: "delete",
        table: change.table,
        rowId: change.rowId,
        why: `Created by run ${opts.runId} and unchanged since.`,
      });
      continue;
    }

    if (change.operation === "update") {
      if (change.before === null) {
        refusals.push({
          table: change.table,
          rowId: change.rowId,
          code: "before_image_missing",
          why:
            "An update was recorded with no before-image, so what to restore is unknown. Guessing " +
            "would write a value that may never have been there.",
        });
        continue;
      }
      const edited =
        change.after !== null &&
        Object.entries(change.after).some(([col, wrote]) => !sameValue(now.columns[col], wrote));
      if (edited) {
        refusals.push({
          table: change.table,
          rowId: change.rowId,
          code: "row_modified_since",
          why:
            "The row no longer holds the values the engine wrote, so a later change has landed on " +
            "top. Restoring the engine's before-image would silently discard it.",
        });
        continue;
      }
      actions.push({
        kind: "restore",
        table: change.table,
        rowId: change.rowId,
        columns: change.before,
        why: `Restoring the values run ${opts.runId} overwrote.`,
      });
      continue;
    }

    refusals.push({
      table: change.table,
      rowId: change.rowId,
      code: "unknown_operation",
      why: `Operation '${String(change.operation)}' has no defined reversal.`,
    });
  }

  // Within the reverse-chronological order, deletes still have to respect
  // foreign keys. Restores are unaffected by ordering, so they stay put.
  const deletes = actions
    .filter((a): a is Extract<RollbackAction, { kind: "delete" }> => a.kind === "delete")
    .sort((a, b) => deleteRank(a.table) - deleteRank(b.table));
  const restores = actions.filter((a) => a.kind === "restore");
  const ordered_actions = [...restores, ...deletes];

  const complete = refusals.length === 0 && mine.length > 0;

  return {
    runId: opts.runId,
    actions: ordered_actions,
    refusals,
    complete,
    summary:
      mine.length === 0
        ? `No changes recorded for run ${opts.runId}. Nothing to reverse, and nothing is assumed.`
        : complete
          ? `${ordered_actions.length} reversal(s) for run ${opts.runId}: ` +
            `${restores.length} restore(s) then ${deletes.length} delete(s), children before parents.`
          : `REFUSED: ${refusals.length} of ${mine.length} recorded change(s) cannot be reversed ` +
            `(${[...new Set(refusals.map((r) => r.code))].join(", ")}). The plan is not executed at all — ` +
            `a half-reversed run leaves an article with its sources deleted and no record of why.`,
  };
}

/**
 * Whether a plan may be executed.
 *
 * Separate from planRollback so the caller cannot accidentally execute a plan
 * by reading `actions` and ignoring `complete`. There is exactly one place that
 * says yes.
 */
export function mayExecute(plan: RollbackPlan): { allowed: boolean; why: string } {
  if (plan.actions.length === 0) {
    return { allowed: false, why: "The plan has no actions, so there is nothing to execute." };
  }
  if (!plan.complete) {
    return {
      allowed: false,
      why:
        `The plan is incomplete: ${plan.refusals.length} change(s) were refused. Rollback is ` +
        "all-or-nothing, because a partially reversed run is a worse state than an unreversed one.",
    };
  }
  return { allowed: true, why: plan.summary };
}
