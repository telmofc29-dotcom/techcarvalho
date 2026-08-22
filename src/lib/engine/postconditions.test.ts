import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classifyOutcome,
  createPostconditionLog,
  expectCreatedId,
  expectNonEmpty,
  expectRowsAffected,
  expectRpcStatus,
  isRowId,
  mutateAndVerify,
  mutateBlind,
  statusFromPostconditions,
  summarisePostconditions,
  worstStatus,
  type MutationOutcome,
} from "./postconditions.ts";

const UUID = "e2225aab-f480-4965-86ed-387e355e1563";

function outcome<T>(data: T | null, error: string | null = null): MutationOutcome<T> {
  return { data, error: error === null ? null : { message: error } };
}

// ---------------------------------------------------------------------------
// The incident shapes, asserted directly
// ---------------------------------------------------------------------------

test("INCIDENT 1: no error and no data is never success", () => {
  const r = classifyOutcome({
    operation: "engine_upsert_freshness",
    expectation: "a status string",
    outcome: outcome<string>(null),
    verify: expectRpcStatus(["created"]),
  });
  assert.equal(r.ok, false);
  assert.equal(r.status, "unverifiable");
});

test("INCIDENT 1: zero rows affected with no error is a silent no-op, not an empty result", () => {
  const r = classifyOutcome({
    operation: "delete analytics_events",
    expectation: "at least one row deleted",
    outcome: outcome<unknown[]>([]),
    verify: expectRowsAffected(1),
  });
  assert.equal(r.status, "silent_no_op");
  assert.equal(r.ok, false);
  assert.match(r.detail, /matched-nothing|does not hold/i);
});

test("INCIDENT 2: a rejected RPC status is a failure, not benign non-work", () => {
  const r = classifyOutcome({
    operation: "engine_upsert_update_proposal",
    expectation: "created | refreshed",
    outcome: outcome("rejected_invalid"),
    verify: expectRpcStatus(["created"], ["refreshed"]),
  });
  assert.equal(r.status, "silent_no_op");
  assert.equal(r.ok, false);
  assert.match(r.detail, /rejected_invalid/);
});

test("INCIDENT 2: an UNANTICIPATED status is also a failure — enumerating acceptance, not rejection", () => {
  // The whole point: a status invented after this call site was written must
  // not slip through. Only what is named passes.
  const r = classifyOutcome({
    operation: "engine_upsert_update_proposal",
    expectation: "created | refreshed",
    outcome: outcome("some_status_added_next_year"),
    verify: expectRpcStatus(["created"], ["refreshed"]),
  });
  assert.equal(r.ok, false);
});

// ---------------------------------------------------------------------------
// Verifiers
// ---------------------------------------------------------------------------

test("expectRpcStatus accepts documented statuses and benign non-work", () => {
  const v = expectRpcStatus(["created"], ["deduped"]);
  assert.equal(v("created").held, true);
  assert.equal(v("deduped").held, true);
  assert.equal(v("rejected_invalid").held, false);
  assert.equal(v(null).held, "unknown");
});

test("expectCreatedId treats a uuid as proof and a bare status as not", () => {
  const v = expectCreatedId(["duplicate_slug"]);
  assert.equal(v(UUID).held, true);
  assert.equal(v("duplicate_slug").held, true);
  assert.equal(v("rejected_invalid").held, false);
  assert.equal(v(null).held, "unknown");
});

test("isRowId rejects the values the old hand-rolled uuid test accepted", () => {
  assert.equal(isRowId(UUID), true);
  // The old test was `!result.includes("-")`, which called all of these ids.
  assert.equal(isRowId("null"), false);
  assert.equal(isRowId(null), false);
  assert.equal(isRowId(undefined), false);
  assert.equal(isRowId("rejected_invalid"), false);
  assert.equal(isRowId("not-a-uuid-but-hyphenated"), false);
});

test("expectNonEmpty separates 'no rows' from 'no result set'", () => {
  const v = expectNonEmpty("trend input");
  assert.equal(v([{}]).held, true);
  assert.equal(v([]).held, false);
  assert.equal(v(null).held, "unknown");
});

test("expectRowsAffected never reads null as zero rows", () => {
  const v = expectRowsAffected(1);
  assert.equal(v(null).held, "unknown", "null is 'no returning clause', not 'zero rows'");
  assert.equal(v([]).held, false);
  assert.equal(v([{}]).held, true);
});

// ---------------------------------------------------------------------------
// mutateAndVerify / mutateBlind
// ---------------------------------------------------------------------------

test("a throwing mutation becomes an errored result rather than aborting the pass", async () => {
  const r = await mutateAndVerify<string>({
    operation: "boom",
    expectation: "created",
    run: async () => {
      throw new Error("connection reset");
    },
    verify: expectRpcStatus(["created"]),
  });
  assert.equal(r.status, "errored");
  assert.equal(r.error, "connection reset");
});

test("a blind write is neither a success nor a failure — it is unproven", async () => {
  const r = await mutateBlind({
    operation: "engine_upsert_opportunity",
    why: "returns void",
    run: async () => outcome(null),
  });
  assert.equal(r.status, "blind");
  assert.equal(r.ok, false, "blind is never ok — 'we cannot know' must not read as 'it worked'");
});

test("a blind write that ERRORS still fails normally", async () => {
  const r = await mutateBlind({
    operation: "engine_upsert_opportunity",
    why: "returns void",
    run: async () => outcome(null, "permission denied"),
  });
  assert.equal(r.status, "errored");
});

test("the subject travels into the message so a no-op names the row it missed", () => {
  const r = classifyOutcome({
    operation: "engine_upsert_freshness",
    expectation: "created",
    outcome: outcome("rejected_invalid"),
    verify: expectRpcStatus(["created"]),
    subject: "content/why-ssds-fail",
  });
  assert.match(r.detail, /content\/why-ssds-fail/);
  assert.equal(r.subject, "content/why-ssds-fail");
});

// ---------------------------------------------------------------------------
// The log — the ergonomics that decide whether any of this gets used
// ---------------------------------------------------------------------------

function counters() {
  return { examined: 0, created: 0, deduped: 0, failed: 0 };
}

test("the log folds outcomes into counters so a job author cannot get the mapping wrong", async () => {
  const c = counters();
  const log = createPostconditionLog(c);

  await log.rpc({ operation: "op", run: async () => outcome("created"), accepted: ["created"], benign: ["deduped"] });
  await log.rpc({ operation: "op", run: async () => outcome("deduped"), accepted: ["created"], benign: ["deduped"] });
  await log.rpc({ operation: "op", run: async () => outcome("rejected_invalid"), accepted: ["created"], benign: ["deduped"] });
  await log.rpc({ operation: "op", run: async () => outcome<string>(null), accepted: ["created"] });

  assert.equal(c.created, 1);
  assert.equal(c.deduped, 1);
  assert.equal(
    c.failed, 2,
    "the rejection AND the null both count as failures — neither is a duplicate"
  );
});

test("a rejected status does NOT inflate the deduped counter", async () => {
  // This is the exact miscount that hid incident #2 in six different files.
  const c = counters();
  const log = createPostconditionLog(c);
  await log.rpc({
    operation: "engine_upsert_freshness",
    run: async () => outcome("rejected_invalid"),
    accepted: ["created"],
    benign: ["deduped"],
  });
  assert.equal(c.deduped, 0);
  assert.equal(c.failed, 1);
});

test("createdId counts a uuid as a creation and a benign status as a dedupe", async () => {
  const c = counters();
  const log = createPostconditionLog(c);
  await log.createdId({ operation: "assemble", run: async () => outcome(UUID) });
  await log.createdId({ operation: "assemble", run: async () => outcome("duplicate_slug"), benign: ["duplicate_slug"] });
  await log.createdId({ operation: "assemble", run: async () => outcome<string>(null) });
  assert.equal(c.created, 1);
  assert.equal(c.deduped, 1);
  assert.equal(c.failed, 1, "a null id is unverifiable, never a created row");
});

test("a blind write increments no counter at all", async () => {
  const c = counters();
  const log = createPostconditionLog(c);
  await log.blind({ operation: "void_rpc", why: "returns void", run: async () => outcome(null) });
  assert.deepEqual(c, { examined: 0, created: 0, deduped: 0, failed: 0 });
  assert.equal(log.summarise().blind, 1, "but it IS counted where it matters");
});

// ---------------------------------------------------------------------------
// Aggregation and status
// ---------------------------------------------------------------------------

test("a silent no-op is never 'success', however many other writes verified", () => {
  const s = summarisePostconditions([
    { operation: "a", status: "verified", ok: true, expectation: "", detail: "", data: null, error: null },
    { operation: "b", status: "silent_no_op", ok: false, expectation: "", detail: "x", data: null, error: null },
  ]);
  assert.equal(s.silentNoOps, 1);
  assert.equal(statusFromPostconditions(s), "partial");
});

test("every write silently no-opping is 'failed', not 'partial'", () => {
  const s = summarisePostconditions([
    { operation: "a", status: "silent_no_op", ok: false, expectation: "", detail: "x", data: null, error: null },
    { operation: "b", status: "silent_no_op", ok: false, expectation: "", detail: "y", data: null, error: null },
  ]);
  assert.equal(statusFromPostconditions(s), "failed");
});

test("blind writes alone do not degrade a run, but they are reported", () => {
  const s = summarisePostconditions([
    { operation: "void_rpc", status: "blind", ok: false, expectation: "", detail: "", data: null, error: null },
  ]);
  assert.equal(statusFromPostconditions(s), "success");
  assert.equal(s.blind, 1);
  assert.deepEqual(s.blindOperations, ["void_rpc"]);
});

test("summary carries the no-op DETAIL, not just a count", () => {
  const s = summarisePostconditions([
    { operation: "a", status: "silent_no_op", ok: false, expectation: "", detail: "the actionable bit", data: null, error: null },
  ]);
  assert.deepEqual(s.silentNoOpDetails, ["the actionable bit"]);
});

test("worstStatus lets a job make its verdict worse but never better", () => {
  assert.equal(worstStatus("success", "failed"), "failed", "the log wins on the downside");
  assert.equal(worstStatus("failed", "success"), "failed", "the job wins on the downside too");
  assert.equal(worstStatus("success", "partial"), "partial");
  assert.equal(worstStatus("partial", "success"), "partial");
  assert.equal(worstStatus("success", "success"), "success");
});

test("worstStatus preserves 'skipped' — a disabled stage is not a failing one", () => {
  assert.equal(worstStatus("skipped", "failed"), "skipped");
});

test("no mutations attempted is honestly a success", () => {
  assert.equal(statusFromPostconditions(summarisePostconditions([])), "success");
});

// ---------------------------------------------------------------------------
// The transitional verifiers: an RPC mid-way through gaining a return value
// ---------------------------------------------------------------------------
// These exist because migrations here are applied by hand, out of band from a
// deploy, so there is always a window in which the code and the database
// disagree about whether an RPC returns anything. Both sides of that window
// have to be honest, and neither may report success it cannot support.

const MIGRATION = "supabase/migrations/20260822_silent_success_telemetry.sql";

test("pendingRpc: a void RPC (null) is BLIND — not verified, not failed", async () => {
  const counters = { examined: 0, created: 0, deduped: 0, failed: 0 };
  const log = createPostconditionLog(counters);

  const r = await log.pendingRpc({
    operation: "engine_record_source_check",
    migration: MIGRATION,
    run: async () => outcome<string>(null),
    accepted: ["ok"],
  });

  assert.equal(r.status, "blind", "a `returns void` answer is unobservable, not successful");
  assert.equal(counters.created, 0, "an unobservable write must not be counted as work done");
  assert.equal(counters.deduped, 0);
  assert.equal(counters.failed, 0, "and must not be counted as a failure either");
  assert.match(r.detail, /UNOBSERVABLE/);
  assert.match(r.detail, /silent_success_telemetry/, "names the migration that fixes it");
});

test("pendingRpc: once the RPC speaks, its status is actually CHECKED", async () => {
  const counters = { examined: 0, created: 0, deduped: 0, failed: 0 };
  const log = createPostconditionLog(counters);

  const good = await log.pendingRpc({
    operation: "engine_record_source_check",
    migration: MIGRATION,
    run: async () => outcome("ok"),
    accepted: ["ok"],
  });
  assert.equal(good.status, "verified");
  assert.equal(counters.created, 1);

  // THE POINT OF THE WHOLE FILE: the post-migration function can now tell us
  // the row was not there, and that must NOT read as a health update.
  const noop = await log.pendingRpc({
    operation: "engine_record_source_check",
    migration: MIGRATION,
    run: async () => outcome("no_matching_source"),
    accepted: ["ok"],
  });
  assert.equal(noop.status, "silent_no_op", "'no_matching_source' is a no-op, not success");
  assert.equal(counters.failed, 1);
  assert.equal(counters.created, 1, "and it did not inflate the created counter");
});

test("pendingRpc: an error is still an error, in either world", async () => {
  const counters = { examined: 0, created: 0, deduped: 0, failed: 0 };
  const log = createPostconditionLog(counters);
  const r = await log.pendingRpc({
    operation: "engine_upsert_opportunity",
    migration: MIGRATION,
    run: async () => outcome<string>(null, "permission denied for function"),
    accepted: ["ok"],
  });
  assert.equal(r.status, "errored", "a null WITH an error is a failure, not a blind write");
  assert.equal(counters.failed, 1);
});

test("pendingCreatedId: null is blind, a uuid is a creation, a status is not", async () => {
  const counters = { examined: 0, created: 0, deduped: 0, failed: 0 };
  const log = createPostconditionLog(counters);

  const blind = await log.pendingCreatedId({
    operation: "engine_record_entity_resolution",
    migration: MIGRATION,
    run: async () => outcome<string>(null),
  });
  assert.equal(blind.status, "blind");
  assert.equal(counters.created, 0);

  const made = await log.pendingCreatedId({
    operation: "engine_record_entity_resolution",
    migration: MIGRATION,
    run: async () => outcome(UUID),
  });
  assert.equal(made.status, "verified");
  assert.equal(counters.created, 1);

  // 'rejected_invalid' means the decision enum drifted apart from the table's
  // CHECK — the exact shape of incident #2. It must fail loudly.
  const rejected = await log.pendingCreatedId({
    operation: "engine_record_entity_resolution",
    migration: MIGRATION,
    run: async () => outcome("rejected_invalid"),
  });
  assert.equal(rejected.status, "silent_no_op");
  assert.equal(counters.failed, 1);
});

test("pendingCreatedId never accepts the string 'null' as a row id", async () => {
  const counters = { examined: 0, created: 0, deduped: 0, failed: 0 };
  const log = createPostconditionLog(counters);
  // A real bug shipped in this project: String(null) was pushed as a product id
  // and counted as created, because `!result.includes("-")` was used as a uuid
  // test. "null" contains no hyphen, so it was treated as an id.
  const r = await log.pendingCreatedId({
    operation: "engine_record_entity_resolution",
    migration: MIGRATION,
    run: async () => outcome("null"),
  });
  assert.notEqual(r.status, "verified");
  assert.equal(counters.created, 0);
});

test("blind writes keep a run from being all-verified, so they block graduation", async () => {
  const counters = { examined: 0, created: 0, deduped: 0, failed: 0 };
  const log = createPostconditionLog(counters);
  await log.pendingRpc({
    operation: "engine_upsert_opportunity",
    migration: MIGRATION,
    run: async () => outcome<string>(null),
    accepted: ["ok"],
  });
  const s = log.summarise();
  assert.equal(s.blind, 1);
  assert.equal(s.allVerified, false, "'we could not look' is not 'everything verified'");
  // But it does not fail the run: there is no evidence of failure either.
  assert.equal(statusFromPostconditions(s), "success");
});

test("pendingCreatedId: an errored call is errored, never laundered into blind", async () => {
  const counters = { examined: 0, created: 0, deduped: 0, failed: 0 };
  const log = createPostconditionLog(counters);
  const r = await log.pendingCreatedId({
    operation: "engine_record_entity_resolution",
    migration: MIGRATION,
    run: async () => outcome<string>(null, "PGRST202: function not found"),
  });
  assert.equal(r.status, "errored");
  assert.equal(counters.failed, 1);
});
