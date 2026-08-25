import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resolveStageMode,
  resolveAllStageModes,
  tickShouldRun,
  mayDecideUnattended,
  automaticIsAvailable,
  describeStageMode,
  isStageMode,
  DEFAULT_STAGE_MODE,
  DEFAULT_STAGE_MODES,
  AUTOMATIC_CAPABILITY,
  AUTOMATIC_REFUSAL,
  STAGE_MODES,
  STAGE_MODE_LABELS,
  STAGE_MODE_DESCRIPTIONS,
} from "./stage-modes.ts";
import { ENGINE_STAGE_NAMES } from "./stages.ts";

// ---------------------------------------------------------------------------
// Defaults and totality
// ---------------------------------------------------------------------------

test("every engine stage has a default, and it is ASSISTED", () => {
  assert.equal(DEFAULT_STAGE_MODE, "ASSISTED");
  for (const s of ENGINE_STAGE_NAMES) {
    assert.equal(DEFAULT_STAGE_MODES[s], "ASSISTED", `${s} must default to ASSISTED`);
  }
});

test("every stage answers the AUTOMATIC question explicitly", () => {
  for (const s of ENGINE_STAGE_NAMES) {
    assert.ok(s in AUTOMATIC_CAPABILITY, `${s} must declare an automatic capability or null`);
    const capability = AUTOMATIC_CAPABILITY[s];
    assert.ok(
      capability === null || (typeof capability === "string" && capability.length > 20),
      `${s} must either refuse automatic or describe what it does`
    );
  }
});

test("every stage that refuses AUTOMATIC explains why", () => {
  for (const s of ENGINE_STAGE_NAMES) {
    if (AUTOMATIC_CAPABILITY[s] !== null) continue;
    const reason = AUTOMATIC_REFUSAL[s];
    assert.ok(reason && reason.length > 20, `${s} refuses automatic but gives no reason`);
  }
});

test("every mode has a label and a description", () => {
  for (const m of STAGE_MODES) {
    assert.ok(STAGE_MODE_LABELS[m]?.length > 0);
    assert.ok(STAGE_MODE_DESCRIPTIONS[m]?.length > 10);
  }
});

// ---------------------------------------------------------------------------
// Failing closed
// ---------------------------------------------------------------------------

test("garbage stored values resolve to ASSISTED, never to AUTOMATIC", () => {
  for (const junk of [null, undefined, "", "automatic", "AUTO", 42, {}, [], true]) {
    const r = resolveStageMode("briefs", junk);
    assert.equal(r.mode, "ASSISTED", `${JSON.stringify(junk)} must fall back to ASSISTED`);
  }
});

test("nothing stored resolves to ASSISTED without claiming a request was refused", () => {
  const r = resolveStageMode("briefs", undefined);
  assert.equal(r.mode, "ASSISTED");
  assert.equal(r.requested, null);
  assert.equal(r.refusedBecause, null);
});

test("unavailable AUTOMATIC is refused with a reason, not silently downgraded", () => {
  const r = resolveStageMode("draft_assembly", "AUTOMATIC");
  assert.equal(r.mode, "ASSISTED");
  assert.equal(r.requested, "AUTOMATIC");
  assert.ok(r.refusedBecause && r.refusedBecause.length > 20);
  assert.match(r.refusedBecause, /approval is the editorial decision/i);
});

test("available AUTOMATIC is granted", () => {
  const r = resolveStageMode("media_acquisition", "AUTOMATIC");
  assert.equal(r.mode, "AUTOMATIC");
  assert.equal(r.refusedBecause, null);
});

test("MANUAL is honoured on every stage", () => {
  for (const s of ENGINE_STAGE_NAMES) {
    assert.equal(resolveStageMode(s, "MANUAL").mode, "MANUAL", `${s} must accept MANUAL`);
  }
});

test("nothing ever fails closed to MANUAL", () => {
  // Failing closed to MANUAL would look like the engine breaking.
  for (const junk of [null, undefined, "nonsense", 0]) {
    for (const s of ENGINE_STAGE_NAMES) {
      assert.notEqual(resolveStageMode(s, junk).mode, "MANUAL");
    }
  }
});

// ---------------------------------------------------------------------------
// Enforcement
// ---------------------------------------------------------------------------

test("MANUAL is the only mode that stops a stage running", () => {
  assert.equal(tickShouldRun("MANUAL"), false);
  assert.equal(tickShouldRun("ASSISTED"), true);
  assert.equal(tickShouldRun("AUTOMATIC"), true);
});

test("unattended decisions require BOTH automatic mode and the capability", () => {
  assert.equal(mayDecideUnattended("media_acquisition", "AUTOMATIC"), true);
  assert.equal(mayDecideUnattended("media_acquisition", "ASSISTED"), false);
  // Capability missing: mode alone is never enough.
  assert.equal(mayDecideUnattended("draft_assembly", "AUTOMATIC"), false);
  assert.equal(mayDecideUnattended("product_assembly", "AUTOMATIC"), false);
  assert.equal(mayDecideUnattended("freshness", "AUTOMATIC"), false);
});

test("the editorial and legal judgements can never be automated", () => {
  // These four are the ones that would matter most if they regressed.
  for (const s of ["draft_assembly", "product_assembly", "update_proposals", "freshness"] as const) {
    assert.equal(automaticIsAvailable(s), false, `${s} must not be automatable`);
    assert.equal(mayDecideUnattended(s, "AUTOMATIC"), false);
  }
});

test("media acquisition automates only already-established rights", () => {
  const capability = AUTOMATIC_CAPABILITY.media_acquisition;
  assert.ok(capability);
  assert.match(capability, /ALREADY established/i);
  assert.match(capability, /never guessed|still stops and asks/i);
});

// ---------------------------------------------------------------------------
// Bulk resolution
// ---------------------------------------------------------------------------

test("resolving a whole map returns every stage, whatever the input", () => {
  for (const input of [null, undefined, "nonsense", [], 7, { briefs: "MANUAL" }]) {
    const all = resolveAllStageModes(input);
    assert.equal(Object.keys(all).length, ENGINE_STAGE_NAMES.length);
    for (const s of ENGINE_STAGE_NAMES) {
      assert.ok(all[s], `${s} missing`);
      assert.ok(STAGE_MODES.includes(all[s].mode));
    }
  }
});

test("a partial stored map leaves unmentioned stages at the default", () => {
  const all = resolveAllStageModes({ briefs: "MANUAL", media_acquisition: "AUTOMATIC" });
  assert.equal(all.briefs.mode, "MANUAL");
  assert.equal(all.media_acquisition.mode, "AUTOMATIC");
  assert.equal(all.discovery.mode, "ASSISTED");
  assert.equal(all.draft_assembly.mode, "ASSISTED");
});

test("a stored map asking for impossible automation reports each refusal", () => {
  const all = resolveAllStageModes(
    Object.fromEntries(ENGINE_STAGE_NAMES.map((s) => [s, "AUTOMATIC"]))
  );
  const refused = ENGINE_STAGE_NAMES.filter((s) => all[s].refusedBecause !== null);
  const granted = ENGINE_STAGE_NAMES.filter((s) => all[s].mode === "AUTOMATIC");
  assert.ok(refused.length > 0, "some stages must refuse");
  assert.ok(granted.length > 0, "some stages must grant");
  assert.equal(refused.length + granted.length, ENGINE_STAGE_NAMES.length);
  // Every refusal carries its reason.
  for (const s of refused) assert.ok(all[s].refusedBecause!.length > 20);
});

// ---------------------------------------------------------------------------
// Descriptions
// ---------------------------------------------------------------------------

test("descriptions name the consequence rather than restating the mode", () => {
  for (const s of ENGINE_STAGE_NAMES) {
    for (const m of STAGE_MODES) {
      const d = describeStageMode(s, m);
      assert.ok(d.length > 20, `${s}/${m} description too short`);
    }
  }
  assert.match(describeStageMode("briefs", "MANUAL"), /will not run/i);
  assert.match(describeStageMode("briefs", "ASSISTED"), /waits for you/i);
  assert.match(describeStageMode("media_acquisition", "AUTOMATIC"), /rights are ALREADY established/i);
  assert.match(describeStageMode("draft_assembly", "AUTOMATIC"), /not available/i);
});

test("isStageMode accepts exactly the three modes", () => {
  for (const m of STAGE_MODES) assert.equal(isStageMode(m), true);
  for (const junk of ["manual", "Assisted", "", null, 1, {}]) {
    assert.equal(isStageMode(junk), false);
  }
});

// ---------------------------------------------------------------------------
// The migration's stage list must not drift from the code's
// ---------------------------------------------------------------------------

test("the SQL constraint's stage list matches ENGINE_STAGE_NAMES exactly", async () => {
  // Validating keys in the database means adding a stage now needs a one-line
  // CREATE OR REPLACE FUNCTION. This test is the price of that: the two lists
  // cannot drift without failing here.
  //
  // Reads the pending migration rather than the applied one on purpose — that
  // is where the function currently lives. When it is applied and moved, this
  // path moves with it.
  const { readFileSync, existsSync } = await import("node:fs");
  // Newest definition first. `entity_coverage` was added to the stage list on
  // 2026-08-25 and that migration was APPLIED in production the same day, so
  // the applied copy is authoritative. The pending path is kept ahead of it
  // only so a future edit-then-apply cycle reads the draft while it is still
  // a draft.
  const candidates = [
    "supabase/migrations_pending/20260825_entity_coverage_stage.sql",
    "supabase/migrations/20260825_entity_coverage_stage.sql",
    "supabase/migrations_pending/20260824_stage_modes.sql",
    "supabase/migrations/20260824_stage_modes.sql",
  ];
  const path = candidates.find((p) => existsSync(p));
  assert.ok(path, `stage-modes migration not found at any of: ${candidates.join(", ")}`);

  const sql = readFileSync(path, "utf8");
  const block = sql.match(/e\.key = any \(array\[([\s\S]*?)\]\)/);
  assert.ok(block, "could not locate the stage-name array in the migration");

  const sqlStages = [...block[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
  assert.deepEqual(
    [...sqlStages].sort(),
    [...ENGINE_STAGE_NAMES].sort(),
    "the migration's stage list and ENGINE_STAGE_NAMES have drifted"
  );
});

test("the corrected migration contains no subquery in a CHECK expression", async () => {
  // The exact construction PostgreSQL rejected with 0A000. The constraint must
  // be a bare function call; any `select` belongs inside the function body.
  const { readFileSync, existsSync } = await import("node:fs");
  const path = existsSync("supabase/migrations_pending/20260824_stage_modes.sql")
    ? "supabase/migrations_pending/20260824_stage_modes.sql"
    : "supabase/migrations/20260824_stage_modes.sql";
  const sql = readFileSync(path, "utf8");

  const checkExpr = sql.match(/add constraint engine_settings_stage_modes_valid\s*\n?\s*check \(([\s\S]*?)\);/);
  assert.ok(checkExpr, "could not locate the CHECK constraint");
  assert.ok(
    !/\bselect\b/i.test(checkExpr[1]),
    `CHECK expression must contain no subquery, found: ${checkExpr[1].trim()}`
  );
  assert.ok(
    !/\bexists\b/i.test(checkExpr[1]),
    "CHECK expression must not use EXISTS — that is what failed with 0A000"
  );
});
