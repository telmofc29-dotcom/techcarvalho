import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classifyTranslation,
  isTranslationStale,
  isTranslated,
  emptyStateTotals,
  TRANSLATION_STATES,
  TRANSLATION_STATE_LABELS,
  TRANSLATION_STATE_DESCRIPTIONS,
  TRANSLATION_STATE_TONES,
  type TranslationSignals,
} from "./translation-status.ts";

function signals(overrides: Partial<TranslationSignals> = {}): TranslationSignals {
  return {
    translationId: "t-1",
    translationState: "ready",
    sourceRevision: 1,
    sourceRevisionSeen: 1,
    reviewedBy: null,
    ...overrides,
  };
}

// --- staleness -------------------------------------------------------------

test("same revision is not stale", () => {
  assert.equal(isTranslationStale(1, 1), false);
});

test("source ahead of the translation is stale", () => {
  assert.equal(isTranslationStale(2, 1), true);
});

test("a null source_revision_seen is stale, not current", () => {
  // The safe reading of "I don't know which revision this came from" is
  // "needs a look". Treating it as current would hide a real gap.
  assert.equal(isTranslationStale(1, null), true);
});

test("a null source_revision_seen against revision 0 is not stale", () => {
  // Guards the `?? 0` coalesce from producing a spurious 0 > 0.
  assert.equal(isTranslationStale(0, null), false);
});

test("a translation ahead of its source is not stale", () => {
  // Should not happen, but must not read as stale if it does.
  assert.equal(isTranslationStale(1, 5), false);
});

// --- the six states --------------------------------------------------------

test("no row at all is untranslated", () => {
  assert.equal(
    classifyTranslation(signals({ translationId: null, translationState: null, sourceRevisionSeen: null })),
    "untranslated"
  );
});

test("untranslated wins even when the revision numbers would look stale", () => {
  // A pair with no translation row must never be reported as "source changed";
  // there is nothing for the source to have changed underneath.
  assert.equal(
    classifyTranslation(signals({ translationId: null, sourceRevision: 9, sourceRevisionSeen: null })),
    "untranslated"
  );
});

test("draft translation state is draft", () => {
  assert.equal(classifyTranslation(signals({ translationState: "draft" })), "draft");
});

test("a null translation_state counts as draft", () => {
  assert.equal(classifyTranslation(signals({ translationState: null })), "draft");
});

test("needs_review is needs_update", () => {
  assert.equal(classifyTranslation(signals({ translationState: "needs_review" })), "needs_update");
});

test("failed is needs_update", () => {
  assert.equal(classifyTranslation(signals({ translationState: "failed" })), "needs_update");
});

test("ready and up to date, unreviewed, is current", () => {
  assert.equal(classifyTranslation(signals({ translationState: "ready" })), "current");
});

test("published and up to date, unreviewed, is current", () => {
  assert.equal(classifyTranslation(signals({ translationState: "published" })), "current");
});

test("ready, up to date and signed off is reviewed", () => {
  assert.equal(
    classifyTranslation(signals({ translationState: "ready", reviewedBy: "admin-uuid" })),
    "reviewed"
  );
});

// --- precedence ------------------------------------------------------------

test("staleness outranks a reviewed, published translation", () => {
  // The whole point of the ladder: a signed-off translation whose English
  // original was rewritten afterwards is the most misleading row on the site.
  assert.equal(
    classifyTranslation(
      signals({
        translationState: "published",
        reviewedBy: "admin-uuid",
        sourceRevision: 4,
        sourceRevisionSeen: 2,
      })
    ),
    "stale"
  );
});

test("staleness outranks a draft", () => {
  assert.equal(
    classifyTranslation(signals({ translationState: "draft", sourceRevision: 3, sourceRevisionSeen: 1 })),
    "stale"
  );
});

test("staleness outranks needs_update", () => {
  assert.equal(
    classifyTranslation(signals({ translationState: "needs_review", sourceRevision: 3, sourceRevisionSeen: 1 })),
    "stale"
  );
});

test("draft outranks a stray reviewed_by", () => {
  assert.equal(
    classifyTranslation(signals({ translationState: "draft", reviewedBy: "admin-uuid" })),
    "draft"
  );
});

// --- exhaustiveness --------------------------------------------------------

test("every state has a label, a description and a tone", () => {
  for (const state of TRANSLATION_STATES) {
    assert.ok(TRANSLATION_STATE_LABELS[state], `missing label for ${state}`);
    assert.ok(TRANSLATION_STATE_DESCRIPTIONS[state], `missing description for ${state}`);
    assert.ok(TRANSLATION_STATE_TONES[state], `missing tone for ${state}`);
  }
});

test("the brief's six states are exactly the states that exist", () => {
  assert.equal(TRANSLATION_STATES.length, 6);
  assert.deepEqual([...TRANSLATION_STATES].sort(), [
    "current",
    "draft",
    "needs_update",
    "reviewed",
    "stale",
    "untranslated",
  ]);
});

test("emptyStateTotals covers every state and starts at zero", () => {
  const totals = emptyStateTotals();
  assert.deepEqual(Object.keys(totals).sort(), [...TRANSLATION_STATES].sort());
  for (const state of TRANSLATION_STATES) assert.equal(totals[state], 0);
});

test("only untranslated counts as not translated", () => {
  assert.equal(isTranslated("untranslated"), false);
  for (const state of TRANSLATION_STATES) {
    if (state === "untranslated") continue;
    assert.equal(isTranslated(state), true, `${state} should count as translated`);
  }
});
