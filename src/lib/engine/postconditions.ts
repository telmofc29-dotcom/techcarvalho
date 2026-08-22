// Postcondition verification for engine mutations.
//
// THE FAILURE THIS EXISTS TO KILL
// ------------------------------
// Engine jobs run as `anon` (a Vercel Cron request carries no cookies) and most
// engine tables are admin-only under RLS. RLS denies by returning ZERO ROWS,
// not an error. A DELETE against analytics_events once reported "0 rows
// deleted" with no error whatsoever. A migration reported "Success" without
// applying. `engine_trends.is_active` was write-once for weeks.
//
// In every one of those cases the calling code checked `error` — and `error`
// was null. The mutation "succeeded" and changed nothing. A job reporting
// `status: success` after affecting zero rows is today indistinguishable from a
// job that genuinely had nothing to do.
//
// So: checking `error` is not verification. Verification is asserting that the
// expected postcondition actually HOLDS afterwards. That is what this module
// makes cheap enough that job authors will do it.
//
// PURE ON PURPOSE. `classifyOutcome` does all the deciding and takes plain
// values, so every rule below is unit-testable without a database. The async
// wrapper is a thin shell over it, and takes the mutation as a callback so it
// can be tested with a fake.

/** The shape every supabase-js call returns. Deliberately structural. */
export type MutationOutcome<T> = {
  data: T | null;
  error: { message: string } | null;
};

export type PostconditionStatus =
  /** The mutation ran and its postcondition demonstrably holds. */
  | "verified"
  /** The call itself errored. Visible failure — the easy case. */
  | "errored"
  /** No error, but the postcondition does NOT hold. THE SILENT NO-OP. */
  | "silent_no_op"
  /** No error, but nothing came back that could confirm or deny. */
  | "unverifiable";

export type PostconditionResult<T = unknown> = {
  operation: string;
  status: PostconditionStatus;
  ok: boolean;
  /** What was expected to be true afterwards, in words. */
  expectation: string;
  /** What actually happened, in words an admin can act on. */
  detail: string;
  data: T | null;
  error: string | null;
};

/**
 * A verifier answers "does the postcondition hold, given what came back?".
 *
 * Returning `unknown` is a first-class answer and is NOT treated as success —
 * "I could not tell" and "it worked" must never collapse into the same value.
 */
export type Verification = { held: true; detail: string } | { held: false; detail: string } | { held: "unknown"; detail: string };

export type Verifier<T> = (data: T | null) => Verification;

// ---------------------------------------------------------------------------
// The pure core
// ---------------------------------------------------------------------------

/**
 * Decide the outcome of a mutation from its raw result plus a verifier.
 *
 * The ordering matters: an explicit error wins over everything (it is the
 * honest signal), and only then do we interrogate the payload. A null payload
 * with no error is exactly the anon/RLS signature and is never `verified`.
 */
export function classifyOutcome<T>(args: {
  operation: string;
  expectation: string;
  outcome: MutationOutcome<T>;
  verify: Verifier<T>;
}): PostconditionResult<T> {
  const { operation, expectation, outcome, verify } = args;

  if (outcome.error) {
    return {
      operation,
      status: "errored",
      ok: false,
      expectation,
      detail: `${operation} failed with an error: ${outcome.error.message}`,
      data: null,
      error: outcome.error.message,
    };
  }

  const verification = verify(outcome.data);

  if (verification.held === true) {
    return {
      operation,
      status: "verified",
      ok: true,
      expectation,
      detail: `${operation}: ${verification.detail}`,
      data: outcome.data,
      error: null,
    };
  }

  if (verification.held === "unknown") {
    return {
      operation,
      status: "unverifiable",
      ok: false,
      expectation,
      detail:
        `${operation} reported no error, but the result could not confirm or deny the expected ` +
        `postcondition (${expectation}). ${verification.detail} Treated as a FAILURE: an ` +
        `unverifiable mutation is not a successful one.`,
      data: outcome.data,
      error: null,
    };
  }

  return {
    operation,
    status: "silent_no_op",
    ok: false,
    expectation,
    detail:
      `${operation} reported SUCCESS but its postcondition does not hold (${expectation}). ` +
      `${verification.detail} This is the anon/RLS signature: the statement ran, matched nothing, ` +
      `and returned no error.`,
    data: outcome.data,
    error: null,
  };
}

/**
 * Run a mutation and verify its postcondition. Never throws — a thrown callback
 * becomes an `errored` result, because a job must record what happened rather
 * than abort the whole pass.
 */
export async function mutateAndVerify<T>(spec: {
  operation: string;
  expectation: string;
  run: () => Promise<MutationOutcome<T>>;
  verify: Verifier<T>;
}): Promise<PostconditionResult<T>> {
  let outcome: MutationOutcome<T>;
  try {
    outcome = await spec.run();
  } catch (e) {
    outcome = { data: null, error: { message: e instanceof Error ? e.message : String(e) } };
  }
  return classifyOutcome({
    operation: spec.operation,
    expectation: spec.expectation,
    outcome,
    verify: spec.verify,
  });
}

// ---------------------------------------------------------------------------
// Ready-made verifiers — the ergonomics that make this get used
// ---------------------------------------------------------------------------

/**
 * The engine's RPC convention: a status string such as 'created' / 'deduped' /
 * 'rejected_invalid'. Anything outside `accepted` is a failure, INCLUDING the
 * validation-rejection statuses — a job that quietly counts 'rejected_invalid'
 * as "nothing to do" is exactly how a whole stage became a no-op.
 *
 * `benign` lets a caller name statuses that are legitimate non-work (typically
 * 'deduped' / 'already_tracked') so they verify without inflating created counts.
 */
export function expectRpcStatus(accepted: readonly string[], benign: readonly string[] = []): Verifier<string> {
  const all = [...accepted, ...benign];
  return (data) => {
    if (data === null || data === undefined) {
      return {
        held: "unknown",
        detail:
          `The RPC returned null instead of one of its documented status strings ` +
          `(${all.join(" | ")}). A SECURITY DEFINER function that returns nothing usually means ` +
          `it does not exist at this signature, or a pending migration has not been applied.`,
      };
    }
    if (typeof data !== "string") {
      return { held: "unknown", detail: `Expected a status string, got ${typeof data}.` };
    }
    if (accepted.includes(data)) return { held: true, detail: `returned '${data}'.` };
    if (benign.includes(data)) return { held: true, detail: `returned '${data}' — legitimate non-work.` };
    return {
      held: false,
      detail: `Returned '${data}', which is not one of the expected statuses (${all.join(" | ")}).`,
    };
  };
}

/**
 * For RPCs that return the id of the row they created. A uuid proves a row now
 * exists; anything else is the function declining, and declining is not success.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function expectCreatedId(benign: readonly string[] = []): Verifier<string> {
  return (data) => {
    if (data === null || data === undefined) {
      return {
        held: "unknown",
        detail: "The RPC returned null instead of a row id or a documented status string.",
      };
    }
    if (typeof data === "string" && UUID_RE.test(data)) {
      return { held: true, detail: `created row ${data}.` };
    }
    if (typeof data === "string" && benign.includes(data)) {
      return { held: true, detail: `returned '${data}' — legitimate non-work, no row created.` };
    }
    return {
      held: false,
      detail: `Expected a row id, got '${String(data)}'. No row was created and no benign status was returned.`,
    };
  };
}

/**
 * For statements whose result is a set of affected rows. Zero rows when rows
 * were expected is the whole point of this module.
 */
export function expectRowsAffected(minimum = 1): Verifier<unknown[]> {
  return (data) => {
    if (data === null || data === undefined) {
      return {
        held: "unknown",
        detail:
          "No row set came back at all. supabase-js returns null here when the statement was not " +
          "run with a returning clause, so this cannot be read as 'zero rows'.",
      };
    }
    if (!Array.isArray(data)) {
      return { held: "unknown", detail: `Expected an array of affected rows, got ${typeof data}.` };
    }
    if (data.length >= minimum) {
      return { held: true, detail: `${data.length} row(s) affected (minimum ${minimum}).` };
    }
    return {
      held: false,
      detail:
        `${data.length} row(s) affected but at least ${minimum} were expected. Under RLS this is ` +
        `what "denied" looks like — a matched-nothing statement with no error.`,
    };
  };
}

/**
 * For reads where an empty result is genuinely suspicious (e.g. reference data
 * that is known to exist). Use sparingly: on most reads, zero rows is honest.
 */
export function expectNonEmpty(what: string): Verifier<unknown[]> {
  return (data) => {
    if (data === null || data === undefined) {
      return { held: "unknown", detail: `No result set came back for ${what}.` };
    }
    if (!Array.isArray(data)) {
      return { held: "unknown", detail: `Expected rows for ${what}, got ${typeof data}.` };
    }
    if (data.length > 0) return { held: true, detail: `${data.length} ${what} row(s) returned.` };
    return {
      held: false,
      detail:
        `Zero ${what} rows returned where at least one was expected. Under RLS an unauthorised ` +
        `read is indistinguishable from an empty table, so this is reported rather than assumed empty.`,
    };
  };
}

/** For RPCs returning void: there is nothing to inspect, so say so honestly. */
export function expectNoError(): Verifier<unknown> {
  return () => ({
    held: "unknown",
    detail:
      "This RPC returns void, so its effect cannot be confirmed from the response. Prefer an RPC " +
      "that returns a status string or a row id where the write matters.",
  });
}

// ---------------------------------------------------------------------------
// Aggregation — what a job reports at the end of a pass
// ---------------------------------------------------------------------------

export type PostconditionSummary = {
  total: number;
  verified: number;
  errored: number;
  silentNoOps: number;
  unverifiable: number;
  /** True when every checked mutation verified. */
  allVerified: boolean;
  /**
   * The headline list. These are the mutations that reported success and did
   * nothing — the ones that would otherwise vanish into a green job run.
   */
  silentNoOpDetails: string[];
  errorDetails: string[];
  summary: string;
};

export function summarisePostconditions(results: readonly PostconditionResult[]): PostconditionSummary {
  const verified = results.filter((r) => r.status === "verified").length;
  const errored = results.filter((r) => r.status === "errored");
  const silent = results.filter((r) => r.status === "silent_no_op");
  const unverifiable = results.filter((r) => r.status === "unverifiable");

  const parts: string[] = [`${verified}/${results.length} mutations verified`];
  if (silent.length > 0) parts.push(`${silent.length} SILENT NO-OP(S)`);
  if (unverifiable.length > 0) parts.push(`${unverifiable.length} unverifiable`);
  if (errored.length > 0) parts.push(`${errored.length} errored`);

  return {
    total: results.length,
    verified,
    errored: errored.length,
    silentNoOps: silent.length,
    unverifiable: unverifiable.length,
    allVerified: results.length > 0 && verified === results.length,
    silentNoOpDetails: silent.map((r) => r.detail),
    errorDetails: errored.map((r) => r.detail),
    summary: parts.join("; ") + ".",
  };
}

/**
 * Translate a batch of postcondition results into the job status the audit log
 * should record.
 *
 * A silent no-op is NEVER 'success'. That single mapping is the difference
 * between the 2026-08 incident being caught in a day and being caught in weeks.
 */
export function statusFromPostconditions(
  summary: PostconditionSummary
): "success" | "partial" | "failed" {
  if (summary.total === 0) return "success";
  const bad = summary.errored + summary.silentNoOps + summary.unverifiable;
  if (bad === 0) return "success";
  if (summary.verified > 0) return "partial";
  return "failed";
}
