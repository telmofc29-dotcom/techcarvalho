import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_ATTRIBUTION,
  attributionKind,
  bylineFor,
  structuredAttribution,
  isAttributionKind,
} from "./attribution.ts";

test("THE DEFAULT IS THE MODEST CLAIM, NOT THE STRONG ONE", () => {
  // All 81 published articles were live with "By Telmo Carvalho" and
  // author: Person. They were drafted with machine assistance and then reviewed.
  // Anything that falls through must land on the true statement.
  assert.equal(DEFAULT_ATTRIBUTION, "reviewed_published");
  assert.equal(attributionKind(undefined), "reviewed_published");
  assert.equal(attributionKind(null), "reviewed_published");
  assert.equal(attributionKind("some_future_value"), "reviewed_published");
  assert.equal(attributionKind(""), "reviewed_published");
});

test("the review byline says what actually happened", () => {
  assert.deepEqual(bylineFor("reviewed_published", "Telmo Carvalho"), {
    prefix: "Reviewed and published by",
    name: "Telmo Carvalho",
  });
});

test("'By' is reserved for a piece a person actually wrote", () => {
  assert.deepEqual(bylineFor("authored", "Telmo Carvalho"), {
    prefix: "By",
    name: "Telmo Carvalho",
  });
  assert.notEqual(bylineFor("reviewed_published", "Telmo Carvalho")?.prefix, "By");
});

test("no name means no byline, whatever the kind", () => {
  for (const kind of ["authored", "reviewed_published", "unattributed"] as const) {
    assert.equal(bylineFor(kind, null), null);
    assert.equal(bylineFor(kind, undefined), null);
    assert.equal(bylineFor(kind, ""), null);
  }
});

test("unattributed renders nothing even when a name is available", () => {
  assert.equal(bylineFor("unattributed", "Telmo Carvalho"), null);
});

test("THE CRAWLER IS TOLD THE SAME THING AS THE READER", () => {
  // The original bug was structural as much as textual: the page said "By" and
  // the JSON-LD said author: Person. Both were the same untrue claim, so fixing
  // only one would have left the other asserting it.
  const reviewed = structuredAttribution("reviewed_published");
  assert.equal(reviewed.personIsAuthor, false, "a reviewer is not the author");
  assert.equal(reviewed.personIsEditor, true);

  const authored = structuredAttribution("authored");
  assert.equal(authored.personIsAuthor, true);
  assert.equal(authored.personIsEditor, false);

  const none = structuredAttribution("unattributed");
  assert.equal(none.personIsAuthor, false);
  assert.equal(none.personIsEditor, false);
});

test("a person is never both author and editor of the same piece", () => {
  for (const kind of ["authored", "reviewed_published", "unattributed"] as const) {
    const s = structuredAttribution(kind);
    assert.ok(!(s.personIsAuthor && s.personIsEditor), `${kind} claims both roles`);
  }
});

test("there is no collective byline and no testing claim in the union", () => {
  // This is a one-person publication. A "staff" or "editorial team" kind would
  // be an invention, and a "tested" kind would let an enum value stand in for
  // evidence.
  for (const invented of ["staff", "editorial_team", "our_team", "tested", "hands_on", "reviewed_by_experts"]) {
    assert.equal(isAttributionKind(invented), false, `${invented} must not be a valid kind`);
  }
});

test("the union has exactly three members", () => {
  // A guard against someone adding a fourth without reading the header. Adding
  // one is fine; adding one silently is not.
  const known = ["authored", "reviewed_published", "unattributed"];
  for (const k of known) assert.equal(isAttributionKind(k), true);
  assert.equal(known.length, 3);
});
