// Regression tests for hero slot ownership.
//
// REPRODUCES THE PRODUCTION DEFECT
// --------------------------------
// The owner assigned a new image as hero on ps5-vs-ps5-pro-worth-it and the old
// hero stayed active. The audit found two hero rows on that article — the older
// tc_graphic and the newer upload — because nothing in the write path removed
// the incumbent and nothing in the schema forbade a second one.
//
// These lock in the two rules that make that impossible to repeat: assigning a
// hero over an existing one must ask rather than guess, and an automated
// process must never take a slot a person chose.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  chooseActiveHero,
  isManual,
  mayAutomaticallyReplaceHero,
  planHeroAssignment,
  selectionRank,
  type SlotSelectionKind,
} from "./hero-slot.ts";

const OLD = "bad3ba49-0000-0000-0000-000000000000";
const NEW = "48325b93-0000-0000-0000-000000000000";

// --- The exact production situation ------------------------------------------

test("PS5 PRO CASE: assigning a hero over an existing one asks instead of guessing", () => {
  const plan = planHeroAssignment({ candidateMediaId: NEW, currentHeroMediaId: OLD });
  assert.equal(plan.kind, "needs_decision");
  if (plan.kind !== "needs_decision") return;
  assert.equal(plan.currentHeroMediaId, OLD);
});

test("PS5 PRO CASE: it never silently produces two heroes", () => {
  const plan = planHeroAssignment({ candidateMediaId: NEW, currentHeroMediaId: OLD });
  // The old behaviour was to insert and move on, leaving both rows in place.
  assert.notEqual(plan.kind, "vacant");
  assert.notEqual(plan.kind, "decided");
});

test("Replace demotes the incumbent to gallery and installs the newcomer", () => {
  const plan = planHeroAssignment({ candidateMediaId: NEW, currentHeroMediaId: OLD, decision: "replace" });
  assert.equal(plan.kind, "decided");
  if (plan.kind !== "decided") return;
  assert.deepEqual(plan.operations, [
    { op: "demote_hero_to_gallery", mediaId: OLD },
    { op: "set_role", mediaId: NEW, role: "hero" },
  ]);
});

test("Replace does NOT delete the outgoing asset", () => {
  const plan = planHeroAssignment({ candidateMediaId: NEW, currentHeroMediaId: OLD, decision: "replace" });
  assert.equal(plan.kind, "decided");
  if (plan.kind !== "decided") return;
  const touchingOld = plan.operations.filter((o) => "mediaId" in o && o.mediaId === OLD);
  assert.equal(touchingOld.length, 1);
  assert.equal(touchingOld[0].op, "demote_hero_to_gallery", "a displaced hero is kept, not discarded");
  assert.ok(!plan.operations.some((o) => o.op === "remove_hero"), "nothing is deleted by a replace");
});

test("Add to gallery keeps the incumbent as hero", () => {
  const plan = planHeroAssignment({ candidateMediaId: NEW, currentHeroMediaId: OLD, decision: "add_to_gallery" });
  assert.equal(plan.kind, "decided");
  if (plan.kind !== "decided") return;
  assert.deepEqual(plan.operations, [{ op: "set_role", mediaId: NEW, role: "gallery" }]);
  assert.ok(!plan.operations.some((o) => "mediaId" in o && o.mediaId === OLD), "the incumbent is untouched");
});

test("Cancel changes nothing at all", () => {
  const plan = planHeroAssignment({ candidateMediaId: NEW, currentHeroMediaId: OLD, decision: "cancel" });
  assert.equal(plan.kind, "decided");
  if (plan.kind !== "decided") return;
  assert.deepEqual(plan.operations, []);
});

test("an empty slot is filled without asking", () => {
  const plan = planHeroAssignment({ candidateMediaId: NEW, currentHeroMediaId: null });
  assert.equal(plan.kind, "vacant");
  if (plan.kind !== "vacant") return;
  assert.deepEqual(plan.operations, [{ op: "set_role", mediaId: NEW, role: "hero" }]);
});

test("re-assigning the SAME asset as hero is a no-op, not a collision", () => {
  const plan = planHeroAssignment({ candidateMediaId: NEW, currentHeroMediaId: NEW });
  assert.equal(plan.kind, "already_hero");
});

// --- Manual outranks automatic ----------------------------------------------

test("selection kinds rank human choices above machine ones", () => {
  assert.ok(selectionRank("manual_owner") > selectionRank("automatic"));
  assert.ok(selectionRank("manual_editor") > selectionRank("automatic"));
  assert.ok(selectionRank("automatic") > selectionRank("imported"));
  assert.ok(selectionRank("imported") > selectionRank("inherited"));
  assert.equal(isManual("manual_owner"), true);
  assert.equal(isManual("manual_editor"), true);
  assert.equal(isManual("automatic"), false);
});

test("an engine may NEVER replace a manually chosen hero, however good the candidate", () => {
  for (const kind of ["manual_owner", "manual_editor"] as SlotSelectionKind[]) {
    const verdict = mayAutomaticallyReplaceHero({ mediaId: OLD, selectedBy: kind }, 999, 1);
    assert.equal(verdict.allowed, false, `${kind} must be protected`);
    assert.match(verdict.reason, /selected by a person/i);
  }
});

test("an engine MAY replace an automatic hero when the candidate ranks strictly higher", () => {
  const verdict = mayAutomaticallyReplaceHero({ mediaId: OLD, selectedBy: "automatic" }, 80, 50);
  assert.equal(verdict.allowed, true);
});

test("an equal or lower-ranked candidate never displaces an automatic hero", () => {
  assert.equal(mayAutomaticallyReplaceHero({ mediaId: OLD, selectedBy: "automatic" }, 50, 50).allowed, false);
  assert.equal(mayAutomaticallyReplaceHero({ mediaId: OLD, selectedBy: "automatic" }, 10, 50).allowed, false);
});

test("UNRECORDED provenance is treated as manual, protecting every pre-existing hero", () => {
  // Every association that exists today predates this field. Defaulting to
  // "automatic" would licence the engine to overwrite the owner's own past
  // choices on its first run.
  assert.equal(mayAutomaticallyReplaceHero({ mediaId: OLD }, 999, 1).allowed, false);
  assert.equal(mayAutomaticallyReplaceHero({ mediaId: OLD, selectedBy: null }, 999, 1).allowed, false);
});

// --- Read-path tie-break ------------------------------------------------------

test("a renderable hero beats an unrenderable one — the PS5 Pro page showed nothing", () => {
  // Production had exactly this: the newer hero was still private, so the page
  // rendered no hero at all rather than falling back to the one it could show.
  const chosen = chooseActiveHero([
    { mediaId: NEW, rowId: "r2", sortOrder: 0, renderable: false },
    { mediaId: OLD, rowId: "r1", sortOrder: 0, renderable: true },
  ]);
  assert.equal(chosen?.mediaId, OLD);
});

test("among renderable heroes, sort_order then row id decides — deterministically", () => {
  const rows = [
    { mediaId: "c", rowId: "r3", sortOrder: 5, renderable: true },
    { mediaId: "a", rowId: "r1", sortOrder: 1, renderable: true },
    { mediaId: "b", rowId: "r2", sortOrder: 1, renderable: true },
  ];
  assert.equal(chooseActiveHero(rows)?.mediaId, "a");
  // Stable regardless of the order rows arrive in.
  assert.equal(chooseActiveHero([...rows].reverse())?.mediaId, "a");
});

test("no hero rows yields null rather than throwing", () => {
  assert.equal(chooseActiveHero([]), null);
});


// ---------------------------------------------------------------------------
// Card / thumbnail inheritance
// ---------------------------------------------------------------------------
//
// The thumbnail role existed in the schema and the admin dropdown from the
// start, and no public code ever read it. These lock in the inheritance the
// owner asked for — explicit thumbnail beats hero, hero is reused when no
// thumbnail is set — without a second image having to be associated twice.

import { hasUnusableThumbnail, resolveCardImage, type SlotRow } from "./hero-slot.ts";

const slot = (over: Partial<SlotRow> & { mediaId: string; role: SlotRow["role"] }): SlotRow => ({
  rowId: "row-" + over.mediaId,
  sortOrder: 0,
  renderable: true,
  ...over,
});

test("with no thumbnail, the card INHERITS the hero", () => {
  const result = resolveCardImage([slot({ mediaId: "hero", role: "hero" })]);
  assert.deepEqual(result, { mediaId: "hero", via: "hero", inherited: true });
});

test("an explicit thumbnail OVERRIDES the hero for cards", () => {
  const result = resolveCardImage([
    slot({ mediaId: "hero", role: "hero" }),
    slot({ mediaId: "thumb", role: "thumbnail" }),
  ]);
  assert.deepEqual(result, { mediaId: "thumb", via: "thumbnail", inherited: false });
});

test("resolving a card image does NOT disturb the hero association", () => {
  const rows = [slot({ mediaId: "hero", role: "hero" }), slot({ mediaId: "thumb", role: "thumbnail" })];
  const snapshot = JSON.stringify(rows);
  resolveCardImage(rows);
  assert.equal(JSON.stringify(rows), snapshot, "resolution must be read-only");
  assert.equal(rows.filter((r) => r.role === "hero").length, 1);
  assert.equal(rows.find((r) => r.role === "hero")?.mediaId, "hero");
});

test("gallery images are never used as the card image", () => {
  const result = resolveCardImage([
    slot({ mediaId: "g1", role: "gallery" }),
    slot({ mediaId: "g2", role: "gallery" }),
  ]);
  assert.equal(result, null);
});

test("an UNRENDERABLE thumbnail falls back to the hero rather than showing nothing", () => {
  const result = resolveCardImage([
    slot({ mediaId: "hero", role: "hero" }),
    slot({ mediaId: "thumb", role: "thumbnail", renderable: false }),
  ]);
  assert.deepEqual(result, { mediaId: "hero", via: "hero", inherited: true });
});

test("...and that bypass is reported, not hidden", () => {
  assert.equal(
    hasUnusableThumbnail([
      slot({ mediaId: "hero", role: "hero" }),
      slot({ mediaId: "thumb", role: "thumbnail", renderable: false }),
    ]),
    true
  );
  assert.equal(hasUnusableThumbnail([slot({ mediaId: "hero", role: "hero" })]), false);
  assert.equal(hasUnusableThumbnail([slot({ mediaId: "t", role: "thumbnail" })]), false);
});

test("an unrenderable hero yields nothing, so the caller keeps its own fallback", () => {
  const result = resolveCardImage([slot({ mediaId: "hero", role: "hero", renderable: false })]);
  assert.equal(result, null);
});

test("no associations at all yields null", () => {
  assert.equal(resolveCardImage([]), null);
});
