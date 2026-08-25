import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

// THE PRUNE'S SAFETY PROPERTIES, ASSERTED AGAINST THE MIGRATION ITSELF.
//
// The behaviour is verified against production by
// scripts/verify-opportunity-prune.ts (6/6). This is the part that can run in
// CI: the SQL must keep the guards that make it safe, because the failure mode
// of losing one is silent and total — a null cutoff treated as "delete
// everything" empties the opportunity table with no error.
//
// Why the prune exists at all: nothing expired these rows, so after ranking
// improved, 16 stale rows still carrying old-model scores of 100 and 94.64 sat
// ABOVE every correctly-ranked opportunity. A better model made the list worse.

const CANDIDATES = [
  "supabase/migrations/20260825_prune_stale_opportunities.sql",
  "supabase/migrations_pending/20260825_prune_stale_opportunities.sql",
];

function migrationSql(): string {
  const path = CANDIDATES.find((p) => existsSync(p));
  assert.ok(path, `prune migration not found at any of: ${CANDIDATES.join(", ")}`);
  return readFileSync(path, "utf8");
}

test("the prune refuses a null or future cutoff instead of deleting everything", () => {
  const sql = migrationSql();
  // A null cutoff must not become an unbounded delete.
  assert.match(sql, /p_before is null/i, "no null-cutoff guard");
  assert.match(sql, /p_before > now\(\)/i, "no future-cutoff guard");
  assert.match(sql, /return -1/i, "refusal must be reported, not silent");
});

test("the prune is scoped to watchlist rows only", () => {
  // Category opportunities are computed by a different stage on its own
  // schedule. A broad "delete anything stale" would silently empty them.
  const sql = migrationSql();
  assert.match(sql, /subject_key like 'watchlist:%'/i, "not scoped to watchlist keys");
  assert.match(sql, /subject_type = 'topic'/i, "not scoped to topic subjects");
});

test("the prune deletes by time, never unconditionally", () => {
  const sql = migrationSql();
  const deleteStmt = sql.slice(sql.indexOf("delete from"), sql.indexOf(";", sql.indexOf("delete from")));
  assert.match(deleteStmt, /computed_at < p_before/i, "the delete is not bounded by time");
  assert.ok(deleteStmt.includes("where"), "an unconditional delete");
});

test("the prune reports how many rows it removed", () => {
  // A prune that returns nothing cannot be distinguished from one that did
  // nothing, which is the whole class of bug this codebase keeps finding.
  const sql = migrationSql();
  assert.match(sql, /returns integer/i);
  assert.match(sql, /get diagnostics/i);
});

test("the prune runs as SECURITY DEFINER with a pinned search_path", () => {
  // engine_opportunities is RLS-locked to is_admin() and the tick runs
  // unauthenticated, so this must be a definer function — and a definer
  // function without a pinned search_path is a privilege-escalation vector.
  const sql = migrationSql();
  assert.match(sql, /security definer/i);
  assert.match(sql, /set search_path = public/i);
});
