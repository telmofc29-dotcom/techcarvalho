import { test } from "node:test";
import assert from "node:assert/strict";
import { articleDisplayDate, articleDeck, MIN_DECK_LENGTH } from "./article-header.ts";

const PUBLISHED = "2026-08-21T10:00:00.000Z";

test("a piece never revised says Published, not Updated", () => {
  // "Updated" on a piece that has never been revised overstates the
  // maintenance, and a publication that overstates its maintenance is what this
  // project is trying not to be.
  const d = articleDisplayDate(PUBLISHED, PUBLISHED);
  assert.ok(d);
  assert.equal(d.revised, false);
  assert.match(d.label, /21 August 2026/);
});

test("a row touched the same day is NOT a revision", () => {
  // updated_at moves for reasons a reader does not care about — a status flip,
  // a tag change, a backfill. The header shows a DATE, so a same-day bump would
  // print "Updated 21 August" beside a piece published on 21 August.
  const d = articleDisplayDate(PUBLISHED, "2026-08-21T18:30:00.000Z");
  assert.equal(d?.revised, false);
  assert.match(d!.label, /21 August/);
});

test("a genuine later revision says Updated and shows the NEWER date", () => {
  // This is the case the page got backwards: updated_at reached the JSON-LD, so
  // a crawler saw the revision while the reader was shown the original date.
  // It now also needs evidence the PROSE changed — translatable_revision > 1.
  const d = articleDisplayDate(PUBLISHED, "2026-09-15T09:00:00.000Z", { proseRevisions: 2 });
  assert.equal(d?.revised, true);
  assert.match(d!.label, /15 September 2026/);
});

test("A BULK ROW TOUCH IS NOT A REVISION, however large the gap", () => {
  // The real incident: on 2026-08-23 one write touched all 81 rows within the
  // same minute, and every article on the site began announcing "Updated 23
  // August 2026" and emitting it as dateModified. Nothing had been revised.
  // The 24-hour threshold passed; what was missing was any evidence at all.
  const d = articleDisplayDate(PUBLISHED, "2026-08-23T08:18:00.000Z", { proseRevisions: 1 });
  assert.equal(d?.revised, false, "no prose change and no review means no revision claim");
  assert.match(d!.label, /21 August 2026/, "falls back to the publication date");
});

test("evidence alone is not enough either — the gap must also be plausible", () => {
  // A prose edit minutes after publishing is finishing the piece, not revising
  // it, and the header renders a date so it would print the same day twice.
  const d = articleDisplayDate(PUBLISHED, "2026-08-21T10:30:00.000Z", { proseRevisions: 5 });
  assert.equal(d?.revised, false);
});

test("a recorded freshness review counts as evidence of revision", () => {
  const d = articleDisplayDate(PUBLISHED, "2026-09-15T09:00:00.000Z", {
    proseRevisions: 1,
    lastReviewedAt: "2026-09-15T09:00:00.000Z",
  });
  assert.equal(d?.revised, true);
});

test("absent evidence defaults to NOT revised", () => {
  // Unmeasured must never read as a finding. Called with no evidence argument
  // at all, the answer is the publication date.
  const d = articleDisplayDate(PUBLISHED, "2026-09-15T09:00:00.000Z");
  assert.equal(d?.revised, false);
  assert.match(d!.label, /21 August 2026/);
});

test("no dates at all yields null rather than a fabricated one", () => {
  assert.equal(articleDisplayDate(null, null), null);
  assert.equal(articleDisplayDate(undefined, undefined), null);
  assert.equal(articleDisplayDate("not-a-date", "also-not"), null);
});

test("a hand-written meta description wins — somebody chose those words", () => {
  const deck = articleDeck({
    metaDescription: "What actually changes when you move from Wi-Fi 6E to Wi-Fi 7, in practice.",
    body: "A completely different opening paragraph that should not be used here at all.",
    title: "Wi-Fi 7 Explained",
  });
  assert.match(deck ?? "", /^What actually changes/);
});

test("with no meta description it falls back to the article's OWN first paragraph", () => {
  // The important property: a deck can never be generic filler bolted on
  // afterwards, because it is literally the piece's opening sentence.
  const deck = articleDeck({
    metaDescription: null,
    body: "Mesh systems solve a coverage problem, not a speed problem, and buying the fastest one rarely helps.\n\nSecond paragraph.",
    title: "Mesh Router Buying Guide",
  });
  assert.match(deck ?? "", /coverage problem/);
});

test("a deck that merely restates the headline is suppressed", () => {
  // It would cost a reader a line of phone screen and tell them nothing.
  const deck = articleDeck({
    metaDescription: "Wi-Fi 7 explained: what Wi-Fi 7 actually changes for Wi-Fi users.",
    body: null,
    title: "Wi-Fi 7 Explained — What Wi-Fi 7 Actually Changes",
  });
  assert.equal(deck, null);
});

test("a near-restatement that still adds information is KEPT", () => {
  // The suppression must not be so eager that it strips useful decks. This one
  // shares the subject but adds the actual answer.
  const deck = articleDeck({
    metaDescription:
      "Wi-Fi 7 adds 320MHz channels and Multi-Link Operation; whether either reaches your laptop depends entirely on the client.",
    body: null,
    title: "Wi-Fi 7 Explained — What Actually Changes",
  });
  assert.ok(deck, "a deck carrying real detail must survive");
});

test("a fragment too short to be a sentence is not a deck", () => {
  assert.equal(articleDeck({ metaDescription: "Short.", body: null, title: "A title" }), null);
  assert.equal(
    articleDeck({ metaDescription: "x".repeat(MIN_DECK_LENGTH - 1), body: null, title: "A title" }),
    null
  );
});

test("no meta description and no body yields null, not an empty line", () => {
  assert.equal(articleDeck({ metaDescription: null, body: null, title: "A title" }), null);
  assert.equal(articleDeck({ metaDescription: "   ", body: "   ", title: "A title" }), null);
});
