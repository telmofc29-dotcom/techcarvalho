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
  | "unverifiable"
  /**
   * The write is STRUCTURALLY unobservable — a `returns void` RPC — and the
   * caller declared it as such, in writing, with a reason.
   *
   * This is not a pass. It is an admission, and it is deliberately a separate
   * member rather than being folded into `verified` so that "we cannot know"
   * can never be counted as "it worked". A blind write does not fail its run
   * (it is documented, expected, and usually an audit-log append), but it is
   * counted, reported, and BLOCKS autonomous graduation — because a system
   * cannot graduate on the strength of writes nobody can confirm happened.
   *
   * The only way to remove a blind write is to change the RPC to return
   * something. That is the point: the count is a to-do list, not a category.
   */
  | "blind";

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
  /**
   * Which entity this mutation was about, when the job knows. Carried so a
   * silent no-op names the row it failed to touch rather than only the RPC —
   * "engine_upsert_freshness did nothing" is far less actionable than
   * "engine_upsert_freshness did nothing for content/why-ssds-fail".
   */
  subject?: string;
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
  subject?: string;
}): PostconditionResult<T> {
  const { operation, expectation, outcome, verify, subject } = args;
  const where = subject ? ` [${subject}]` : "";

  if (outcome.error) {
    return {
      operation,
      status: "errored",
      ok: false,
      expectation,
      detail: `${operation}${where} failed with an error: ${outcome.error.message}`,
      data: null,
      error: outcome.error.message,
      subject,
    };
  }

  const verification = verify(outcome.data);

  if (verification.held === true) {
    return {
      operation,
      status: "verified",
      ok: true,
      expectation,
      detail: `${operation}${where}: ${verification.detail}`,
      data: outcome.data,
      error: null,
      subject,
    };
  }

  if (verification.held === "unknown") {
    return {
      operation,
      status: "unverifiable",
      ok: false,
      expectation,
      detail:
        `${operation}${where} reported no error, but the result could not confirm or deny the expected ` +
        `postcondition (${expectation}). ${verification.detail} Treated as a FAILURE: an ` +
        `unverifiable mutation is not a successful one.`,
      data: outcome.data,
      error: null,
      subject,
    };
  }

  return {
    operation,
    status: "silent_no_op",
    ok: false,
    expectation,
    detail:
      `${operation}${where} reported SUCCESS but its postcondition does not hold (${expectation}). ` +
      `${verification.detail} This is the anon/RLS signature: the statement ran, matched nothing, ` +
      `and returned no error.`,
    data: outcome.data,
    error: null,
    subject,
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
  run: () => PromiseLike<MutationOutcome<T>>;
  verify: Verifier<T>;
  subject?: string;
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
    subject: spec.subject,
  });
}

/**
 * Record a write whose effect cannot be observed from its response.
 *
 * Requires `why` — a caller must state IN WRITING why the effect is
 * unobservable. There is no default and no boolean flag, because the friction
 * is the feature: reaching for this should feel like signing something, not
 * like ticking a box. If the RPC could return a status string, the correct fix
 * is to change the RPC, not to declare the call blind.
 *
 * An ERROR still fails normally — blindness is about the success path only.
 */
export async function mutateBlind(spec: {
  operation: string;
  /** Why the effect is structurally unobservable from the response. */
  why: string;
  run: () => PromiseLike<MutationOutcome<unknown>>;
  subject?: string;
}): Promise<PostconditionResult<unknown>> {
  let outcome: MutationOutcome<unknown>;
  try {
    outcome = await spec.run();
  } catch (e) {
    outcome = { data: null, error: { message: e instanceof Error ? e.message : String(e) } };
  }
  const where = spec.subject ? ` [${spec.subject}]` : "";
  if (outcome.error) {
    return {
      operation: spec.operation,
      status: "errored",
      ok: false,
      expectation: "the write to land (unobservable)",
      detail: `${spec.operation}${where} failed with an error: ${outcome.error.message}`,
      data: null,
      error: outcome.error.message,
      subject: spec.subject,
    };
  }
  return {
    operation: spec.operation,
    status: "blind",
    // NOT ok. A blind write is an admission, not a pass — see PostconditionStatus.
    ok: false,
    expectation: "the write to land (unobservable)",
    detail:
      `${spec.operation}${where} returned no error, and its effect CANNOT be confirmed from the ` +
      `response. ${spec.why} Under RLS a denied write looks exactly like this, so this call is ` +
      `counted as an unproven write rather than a successful one.`,
    data: outcome.data,
    error: null,
    subject: spec.subject,
  };
}

// ---------------------------------------------------------------------------
// The ergonomics — one object per job pass, one line per mutation
// ---------------------------------------------------------------------------

/**
 * Counters in the shape `engine_record_job_run` accepts. Structural on purpose
 * so this module does not depend on the server-only cron module.
 */
export type CountersLike = { examined: number; created: number; deduped: number; failed: number };

/**
 * A per-pass log that a job creates once and calls once per mutation.
 *
 * THE POINT
 * ---------
 * Before this existed, every call site hand-rolled the same eight lines:
 *
 *     if (err) counters.failed++;
 *     else if (result === "created") counters.created++;
 *     else counters.deduped++;          // <- 'rejected_invalid' lands HERE
 *
 * That last `else` is the bug that shipped, in six different files. A rejection
 * was counted as a benign duplicate and the run reported success. The fix is
 * not vigilance, it is making the correct call SHORTER than the wrong one:
 *
 *     await log.rpc({ operation, subject, expectation,
 *                     run: () => supabase.rpc(...),
 *                     accepted: ["created"], benign: ["deduped"] });
 *
 * Anything not named in `accepted` or `benign` is a failure by construction.
 * Forgetting to enumerate a status makes the job LOUDER, not quieter, which is
 * the opposite of the previous default.
 */
export type PostconditionLog = {
  readonly results: readonly PostconditionResult[];
  /**
   * The common case: an RPC returning a documented status string.
   * `accepted` statuses count as created; `benign` count as deduped.
   */
  rpc(spec: {
    operation: string;
    expectation?: string;
    subject?: string;
    run: () => PromiseLike<MutationOutcome<string>>;
    accepted: readonly string[];
    benign?: readonly string[];
  }): Promise<PostconditionResult<string>>;
  /** An RPC returning the id of the row it created. */
  createdId(spec: {
    operation: string;
    expectation?: string;
    subject?: string;
    run: () => PromiseLike<MutationOutcome<string>>;
    /** Documented non-creating statuses, counted as deduped. */
    benign?: readonly string[];
  }): Promise<PostconditionResult<string>>;
  /** Anything else, with a custom verifier. */
  verify<T>(spec: {
    operation: string;
    expectation: string;
    subject?: string;
    run: () => PromiseLike<MutationOutcome<T>>;
    verify: Verifier<T>;
  }): Promise<PostconditionResult<T>>;
  /** A structurally unobservable write. Requires a written reason. */
  blind(spec: {
    operation: string;
    why: string;
    subject?: string;
    run: () => PromiseLike<MutationOutcome<unknown>>;
  }): Promise<PostconditionResult<unknown>>;
  /**
   * An RPC that is `returns void` in deployed production but becomes
   * `returns text` once a named pending migration is applied.
   *
   * WHY THIS EXISTS RATHER THAN JUST SWITCHING TO rpc():
   * migrations here are applied by hand, out of band from a deploy, so there is
   * always a window in which the code and the database disagree. Calling rpc()
   * during that window would score every call `unverifiable` and count it as
   * FAILED — a wave of false alarms caused by our own deploy ordering, which is
   * how a detector gets muted. Calling blind() forever would mean the counters
   * never improve after the migration lands, and somebody would have to
   * remember to come back and change it.
   *
   * So the shape of the ANSWER decides. null is the pre-migration function and
   * is recorded as blind, naming the migration that fixes it. A string is the
   * post-migration function and gets the full status check. Nothing to remember,
   * no false alarms, and the blind count falls to zero by itself the moment the
   * migration is applied.
   */
  pendingRpc(spec: {
    operation: string;
    subject?: string;
    /** The migration filename that gives this RPC a return value. */
    migration: string;
    run: () => PromiseLike<MutationOutcome<string>>;
    accepted: readonly string[];
    benign?: readonly string[];
  }): Promise<PostconditionResult<string>>;
  /**
   * As pendingRpc, for an RPC that will return the ID OF THE ROW IT CREATED
   * rather than a status string. Same null-is-blind rule.
   */
  pendingCreatedId(spec: {
    operation: string;
    subject?: string;
    migration: string;
    run: () => PromiseLike<MutationOutcome<string>>;
    benign?: readonly string[];
  }): Promise<PostconditionResult<string>>;
  summarise(): PostconditionSummary;
};

export function createPostconditionLog(counters: CountersLike): PostconditionLog {
  const results: PostconditionResult[] = [];

  /** Fold one result into the job counters. The ONLY place this mapping lives. */
  function tally(result: PostconditionResult, createdWhen: boolean): void {
    results.push(result);
    switch (result.status) {
      case "verified":
        if (createdWhen) counters.created++;
        else counters.deduped++;
        return;
      case "errored":
      case "silent_no_op":
      case "unverifiable":
        counters.failed++;
        return;
      case "blind":
        // Not counted as created — nothing proved a row appeared. Not counted
        // as failed either: no evidence of failure exists. It is counted only
        // in the postcondition summary, where its unprovenness is the message.
        return;
    }
  }

  return {
    results,

    async rpc(spec) {
      const accepted = spec.accepted;
      const benign = spec.benign ?? [];
      const result = await mutateAndVerify<string>({
        operation: spec.operation,
        subject: spec.subject,
        expectation:
          spec.expectation ??
          `one of the documented statuses: ${[...accepted, ...benign].join(" | ")}`,
        run: spec.run,
        verify: expectRpcStatus(accepted, benign),
      });
      tally(result, typeof result.data === "string" && accepted.includes(result.data));
      return result;
    },

    async createdId(spec) {
      const benign = spec.benign ?? [];
      const result = await mutateAndVerify<string>({
        operation: spec.operation,
        subject: spec.subject,
        expectation: spec.expectation ?? "a row id, or a documented non-creating status",
        run: spec.run,
        verify: expectCreatedId(benign),
      });
      tally(result, typeof result.data === "string" && UUID_RE.test(result.data));
      return result;
    },

    async verify<T>(spec: {
      operation: string;
      expectation: string;
      subject?: string;
      run: () => PromiseLike<MutationOutcome<T>>;
      verify: Verifier<T>;
    }): Promise<PostconditionResult<T>> {
      const result = await mutateAndVerify(spec);
      tally(result as PostconditionResult, result.status === "verified");
      return result;
    },

    async blind(spec) {
      const result = await mutateBlind(spec);
      tally(result, false);
      return result;
    },

    async pendingRpc(spec) {
      const accepted = spec.accepted;
      const benign = spec.benign ?? [];
      const all = [...accepted, ...benign];
      const result = await mutateAndVerify<string>({
        operation: spec.operation,
        subject: spec.subject,
        expectation: `one of the documented statuses: ${all.join(" | ")}`,
        run: spec.run,
        verify: (data) => {
          if (data === null || data === undefined) {
            // The deployed function still returns void. Honest answer: we did
            // not observe anything, and we know exactly why.
            return {
              held: "unknown",
              detail:
                `${spec.operation} returned no value, which is the deployed \`returns void\` ` +
                `signature. Its effect is UNOBSERVABLE until ${spec.migration} is applied; this ` +
                `is not evidence the write landed, and not evidence it failed.`,
            };
          }
          return expectRpcStatus(accepted, benign)(data);
        },
      });

      // A null answer is reclassified from `unverifiable` (which counts as
      // FAILED) to `blind` (which counts as unproven). The distinction is the
      // whole point: an unobservable-by-construction write is not a failure, but
      // it must never be counted as a success either.
      //
      // `status === "unverifiable"` rather than `data === null` is load-bearing.
      // The first version of this checked only for a null `data`, which meant a
      // call that ERRORED — permission denied, function missing, connection
      // dropped — also returns null and was being relabelled as a blind write.
      // That converts a real, visible failure into "we could not look", which is
      // the exact laundering this module exists to prevent. A test caught it.
      if (result.status === "unverifiable") {
        const blindResult: PostconditionResult<string> = { ...result, status: "blind", ok: true };
        tally(blindResult as PostconditionResult, false);
        return blindResult;
      }
      tally(result as PostconditionResult, typeof result.data === "string" && accepted.includes(result.data));
      return result;
    },

    async pendingCreatedId(spec) {
      const benign = spec.benign ?? [];
      const result = await mutateAndVerify<string>({
        operation: spec.operation,
        subject: spec.subject,
        expectation: "a row id, or a documented non-creating status",
        run: spec.run,
        verify: (data) => {
          if (data === null || data === undefined) {
            return {
              held: "unknown",
              detail:
                `${spec.operation} returned no value, which is the deployed \`returns void\` ` +
                `signature. Whether a row was written is UNOBSERVABLE until ${spec.migration} ` +
                `is applied.`,
            };
          }
          return expectCreatedId(benign)(data);
        },
      });

      // See pendingRpc: an errored call also has null data, and must stay
      // `errored` rather than being laundered into `blind`.
      if (result.status === "unverifiable") {
        const blindResult: PostconditionResult<string> = { ...result, status: "blind", ok: true };
        tally(blindResult as PostconditionResult, false);
        return blindResult;
      }
      tally(result as PostconditionResult, isRowId(result.data));
      return result;
    },

    summarise() {
      return summarisePostconditions(results);
    },
  };
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

/**
 * Whether a value is a row id rather than a status string.
 *
 * Exported because call sites kept re-deriving it, and the versions they
 * derived were wrong: `!result.includes("-")` was used in two jobs as "is this
 * a uuid?", which answers `true` for `null`-turned-`"null"` and for any future
 * status containing a hyphen.
 */
export function isRowId(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

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
  /** Writes declared structurally unobservable. Not failures; not successes. */
  blind: number;
  /** True when every checked mutation verified. */
  allVerified: boolean;
  /**
   * The headline list. These are the mutations that reported success and did
   * nothing — the ones that would otherwise vanish into a green job run.
   */
  silentNoOpDetails: string[];
  errorDetails: string[];
  /** Which unobservable writes happened, so the list can be worked down. */
  blindOperations: string[];
  summary: string;
};

export function summarisePostconditions(results: readonly PostconditionResult[]): PostconditionSummary {
  const verified = results.filter((r) => r.status === "verified").length;
  const errored = results.filter((r) => r.status === "errored");
  const silent = results.filter((r) => r.status === "silent_no_op");
  const unverifiable = results.filter((r) => r.status === "unverifiable");
  const blind = results.filter((r) => r.status === "blind");
  const checkable = results.length - blind.length;

  const parts: string[] = [`${verified}/${checkable} verifiable mutations verified`];
  if (silent.length > 0) parts.push(`${silent.length} SILENT NO-OP(S)`);
  if (unverifiable.length > 0) parts.push(`${unverifiable.length} unverifiable`);
  if (errored.length > 0) parts.push(`${errored.length} errored`);
  if (blind.length > 0) parts.push(`${blind.length} unobservable (blind) write(s)`);

  return {
    total: results.length,
    verified,
    errored: errored.length,
    silentNoOps: silent.length,
    unverifiable: unverifiable.length,
    blind: blind.length,
    allVerified: checkable > 0 && verified === checkable,
    silentNoOpDetails: silent.map((r) => r.detail),
    errorDetails: errored.map((r) => r.detail),
    blindOperations: [...new Set(blind.map((r) => r.operation))],
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
  // Blind writes deliberately do NOT degrade the run. They are declared,
  // documented and usually audit-log appends; failing every run on them would
  // make `partial` meaningless within a day, and a status everyone ignores is
  // worse than no status. They are counted instead, and the count is what
  // blocks graduation — see silent-success.ts.
  if (bad === 0) return "success";
  if (summary.verified > 0) return "partial";
  return "failed";
}

/**
 * Merge a job's own status with what its postconditions actually showed.
 *
 * The job's hand-computed status is kept only when it is WORSE. A job may know
 * things the postcondition log does not (a source fetch failed, a stage was
 * skipped), but it may never talk the log UP — that is precisely the move that
 * produced `status: success` on a pass where every write was rejected.
 */
export function worstStatus(
  jobStatus: "success" | "partial" | "failed" | "skipped",
  fromPostconditions: "success" | "partial" | "failed"
): "success" | "partial" | "failed" | "skipped" {
  if (jobStatus === "skipped") return "skipped";
  const rank = { success: 0, partial: 1, failed: 2 } as const;
  return rank[jobStatus] >= rank[fromPostconditions] ? jobStatus : fromPostconditions;
}
