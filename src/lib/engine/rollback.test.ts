import { test } from "node:test";
import assert from "node:assert/strict";
import {
  planRollback,
  mayExecute,
  deleteRank,
  DELETE_ORDER,
  type RecordedChange,
  type CurrentRowState,
} from "./rollback.ts";

const RUN = "11111111-1111-1111-1111-111111111111";

function change(p: Partial<RecordedChange> & { table: string; rowId: string; sequence: number }): RecordedChange {
  return {
    runId: RUN,
    operation: "insert",
    before: null,
    after: null,
    ...p,
  };
}

function state(p: Partial<CurrentRowState> & { table: string; rowId: string }): CurrentRowState {
  return { present: true, published: false, columns: {}, ...p };
}

// ---------------------------------------------------------------------------
// The happy path, and the ordering that makes it possible
// ---------------------------------------------------------------------------

test("a clean run reverses completely, children before parents", () => {
  const changes = [
    change({ table: "content_items", rowId: "c1", sequence: 1 }),
    change({ table: "source_records", rowId: "s1", sequence: 2 }),
    change({ table: "seo_metadata", rowId: "m1", sequence: 3 }),
    change({ table: "media_requirements", rowId: "r1", sequence: 4 }),
  ];
  const current = changes.map((c) => state({ table: c.table, rowId: c.rowId }));

  const plan = planRollback(changes, current, { runId: RUN });
  assert.equal(plan.complete, true, plan.summary);
  assert.equal(plan.refusals.length, 0);
  assert.equal(mayExecute(plan).allowed, true);

  // content_items must be LAST: everything else references it.
  const tables = plan.actions.map((a) => a.table);
  assert.equal(tables[tables.length - 1], "content_items", tables.join(" -> "));
  for (const child of ["seo_metadata", "source_records", "media_requirements"]) {
    assert.ok(tables.indexOf(child) < tables.indexOf("content_items"), `${child} must precede its parent`);
  }
});

test("an unknown table sorts LAST, the safe end for a dependent row", () => {
  // A table nobody added to DELETE_ORDER is most likely a new child table. If
  // it sorted first it would be deleted before its parent, which is harmless;
  // if it sorted last it might be refused by a foreign key, which is visible.
  // Visible beats silent, so last is correct — pinned so a future edit is a
  // decision rather than an accident.
  assert.equal(deleteRank("a_table_nobody_registered"), DELETE_ORDER.length);
  assert.ok(deleteRank("content_items") < deleteRank("a_table_nobody_registered"));
});

test("an update is restored to the exact values that were overwritten", () => {
  const changes = [
    change({
      table: "engine_briefs",
      rowId: "b1",
      sequence: 1,
      operation: "update",
      before: { state: "planned", review_state: "approved" },
      after: { state: "drafting", review_state: "approved" },
    }),
  ];
  const current = [
    state({ table: "engine_briefs", rowId: "b1", columns: { state: "drafting", review_state: "approved" } }),
  ];

  const plan = planRollback(changes, current, { runId: RUN });
  assert.equal(plan.complete, true, plan.summary);
  const restore = plan.actions.find((a) => a.kind === "restore");
  assert.ok(restore && restore.kind === "restore");
  assert.deepEqual(restore.columns, { state: "planned", review_state: "approved" });
});

test("restores run before deletes, so an update to a row deleted later still lands", () => {
  const changes = [
    change({ table: "content_items", rowId: "c1", sequence: 1 }),
    change({
      table: "engine_briefs", rowId: "b1", sequence: 2, operation: "update",
      before: { state: "planned" }, after: { state: "drafting" },
    }),
  ];
  const current = [
    state({ table: "content_items", rowId: "c1" }),
    state({ table: "engine_briefs", rowId: "b1", columns: { state: "drafting" } }),
  ];
  const plan = planRollback(changes, current, { runId: RUN });
  assert.equal(plan.actions[0].kind, "restore");
  assert.equal(plan.actions[plan.actions.length - 1].kind, "delete");
});

// ---------------------------------------------------------------------------
// The refusals. These are the whole safety argument.
// ---------------------------------------------------------------------------

test("a PUBLISHED row is never reversed, and the whole plan is refused with it", () => {
  const changes = [
    change({ table: "content_items", rowId: "c1", sequence: 1 }),
    change({ table: "source_records", rowId: "s1", sequence: 2 }),
  ];
  const current = [
    state({ table: "content_items", rowId: "c1", published: true }),
    state({ table: "source_records", rowId: "s1" }),
  ];

  const plan = planRollback(changes, current, { runId: RUN });
  assert.equal(plan.complete, false);
  assert.equal(plan.refusals[0].code, "row_published");
  // And critically: the SOURCE RECORD is not deleted either. Half-reversing
  // would leave a published article with its sources removed.
  assert.equal(mayExecute(plan).allowed, false);
  assert.match(mayExecute(plan).why, /all-or-nothing/);
});

test("a row a human has edited since is never deleted", () => {
  const changes = [
    change({ table: "content_items", rowId: "c1", sequence: 1, after: { title: "Engine wrote this", body: "draft" } }),
  ];
  const current = [
    state({ table: "content_items", rowId: "c1", columns: { title: "An editor rewrote this", body: "draft" } }),
  ];
  const plan = planRollback(changes, current, { runId: RUN });
  assert.equal(plan.complete, false);
  assert.equal(plan.refusals[0].code, "row_modified_since");
});

test("an update whose row has changed since is not restored over the newer value", () => {
  const changes = [
    change({
      table: "engine_briefs", rowId: "b1", sequence: 1, operation: "update",
      before: { state: "planned" }, after: { state: "drafting" },
    }),
  ];
  // Somebody moved it on to 'review_eligible' after the engine's write.
  const current = [state({ table: "engine_briefs", rowId: "b1", columns: { state: "review_eligible" } })];
  const plan = planRollback(changes, current, { runId: RUN });
  assert.equal(plan.refusals[0].code, "row_modified_since");
  assert.equal(plan.complete, false);
});

test("a row whose current state was NOT supplied is refused, not assumed unchanged", () => {
  // The rule the whole engine is built on: "I could not look" is not "it is fine".
  const changes = [change({ table: "content_items", rowId: "c1", sequence: 1 })];
  const plan = planRollback(changes, [], { runId: RUN });
  assert.equal(plan.refusals[0].code, "no_current_state");
  assert.equal(plan.complete, false);
});

test("an update with no before-image is refused rather than guessed at", () => {
  const changes = [
    change({ table: "engine_briefs", rowId: "b1", sequence: 1, operation: "update", before: null, after: { state: "drafting" } }),
  ];
  const current = [state({ table: "engine_briefs", rowId: "b1", columns: { state: "drafting" } })];
  const plan = planRollback(changes, current, { runId: RUN });
  assert.equal(plan.refusals[0].code, "before_image_missing");
});

test("a row already gone is refused, not treated as successfully reversed", () => {
  const changes = [change({ table: "content_items", rowId: "c1", sequence: 1 })];
  const current = [state({ table: "content_items", rowId: "c1", present: false })];
  const plan = planRollback(changes, current, { runId: RUN });
  assert.equal(plan.refusals[0].code, "row_already_gone");
  assert.equal(plan.complete, false);
});

// ---------------------------------------------------------------------------
// Scope, and the empty case
// ---------------------------------------------------------------------------

test("only the named run is touched", () => {
  const changes = [
    change({ table: "content_items", rowId: "mine", sequence: 1 }),
    { ...change({ table: "content_items", rowId: "theirs", sequence: 1 }), runId: "22222222-2222-2222-2222-222222222222" },
  ];
  const current = [
    state({ table: "content_items", rowId: "mine" }),
    state({ table: "content_items", rowId: "theirs" }),
  ];
  const plan = planRollback(changes, current, { runId: RUN });
  assert.deepEqual(plan.actions.map((a) => a.rowId), ["mine"]);
});

test("no recorded changes is NOT a successful rollback", () => {
  // Otherwise "we have no record of that run" would report the same as "we
  // reversed it", which is the silent-success shape applied to rollback itself.
  const plan = planRollback([], [], { runId: RUN });
  assert.equal(plan.complete, false);
  assert.equal(mayExecute(plan).allowed, false);
  assert.match(plan.summary, /nothing is assumed/);
});

test("mayExecute is the only gate, and it says no whenever the plan is incomplete", () => {
  // Guards against a caller reading `actions` and ignoring `complete`.
  const changes = [
    change({ table: "content_items", rowId: "c1", sequence: 1 }),
    change({ table: "source_records", rowId: "s1", sequence: 2 }),
  ];
  const current = [
    state({ table: "content_items", rowId: "c1", published: true }),
    state({ table: "source_records", rowId: "s1" }),
  ];
  const plan = planRollback(changes, current, { runId: RUN });
  assert.ok(plan.actions.length > 0, "there ARE actions available");
  assert.equal(mayExecute(plan).allowed, false, "but the plan must still be refused as a whole");
});

test("formatting differences are not mistaken for a human edit", () => {
  // A numeric(4,3) written as 0.9 reads back as "0.900". Treating that as an
  // edit would refuse every legitimate rollback of a row carrying a score.
  const changes = [
    change({ table: "content_items", rowId: "c1", sequence: 1, after: { score: 0.9, count: 3 } }),
  ];
  const current = [state({ table: "content_items", rowId: "c1", columns: { score: "0.900", count: "3" } })];
  const plan = planRollback(changes, current, { runId: RUN });
  assert.equal(plan.complete, true, plan.summary);
});
