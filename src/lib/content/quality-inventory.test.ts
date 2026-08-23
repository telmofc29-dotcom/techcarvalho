import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assessContent,
  floorFor,
  titleOverlap,
  findOverlaps,
  INTENT_FLOOR,
  OVERLAP_THRESHOLD,
  type ContentSignals,
} from "./quality-inventory.ts";

const words = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join(" ");

function signals(over: Partial<ContentSignals> = {}): ContentSignals {
  return {
    id: "a", slug: "a", title: "A title about something",
    contentType: "guide", body: words(900),
    sourceCount: 3, primarySourceCount: 1, linkedProductCount: 0,
    heroIsGeneric: false, internalLinkCount: 2, overlaps: [],
    ...over,
  };
}

test("length is judged against the INTENT, not a constant", () => {
  // The whole point. A 200-word news item is a news item; a 200-word
  // comparison has not compared anything.
  assert.ok(floorFor("news") < floorFor("comparison"));
  assert.equal(floorFor("news"), INTENT_FLOOR.news);
  const news = assessContent(signals({ contentType: "news", body: words(200) }));
  assert.equal(news.verdict, "KEEP", news.reasons.join(" | "));
  const cmp = assessContent(signals({ contentType: "comparison", body: words(200) }));
  assert.equal(cmp.verdict, "IMPROVE");
  assert.match(cmp.reasons.join(" "), /600-word floor/);
});

test("a thin piece that duplicates a sibling is MERGE, not IMPROVE", () => {
  // Lengthening it would make two pages compete harder with each other.
  const a = assessContent(
    signals({ contentType: "comparison", body: words(210), overlaps: ["A stronger sibling piece"] })
  );
  assert.equal(a.verdict, "MERGE");
  assert.match(a.reasons[0], /Substantially overlaps/);
});

test("a SUBSTANTIAL piece that overlaps is REVIEW — a human decides", () => {
  const a = assessContent(signals({ body: words(1500), overlaps: ["Another good piece"] }));
  assert.equal(a.verdict, "REVIEW");
});

test("no sources means nothing can be checked, and that is named", () => {
  const a = assessContent(signals({ sourceCount: 0, primarySourceCount: 0 }));
  assert.equal(a.verdict, "IMPROVE");
  assert.match(a.reasons.join(" "), /nothing here can be checked/);
});

test("a troubleshooting piece written from first principles may carry no source", () => {
  // It can legitimately be reasoned out; a spec-bearing format cannot.
  const a = assessContent(
    signals({ contentType: "troubleshooting", body: words(1200), sourceCount: 0, primarySourceCount: 0 })
  );
  assert.equal(a.verdict, "KEEP");
});

test("a generic hero on a product-linked piece is reported", () => {
  const a = assessContent(signals({ heroIsGeneric: true, linkedProductCount: 2 }));
  assert.match(a.reasons.join(" "), /generated graphic while covering 2 catalogue product/);
});

test("an orphan is named as an orphan", () => {
  const a = assessContent(signals({ internalLinkCount: 0 }));
  assert.match(a.reasons.join(" "), /links to it and it links to nothing/);
});

test("there is no aggregate score anywhere — only named signals", () => {
  const a = assessContent(signals());
  assert.equal(a.verdict, "KEEP");
  assert.ok(a.reasons.length > 0, "a verdict must always carry its reasons");
  assert.equal("score" in a, false, "a single score invites padding, which is the wrong answer");
});

test("shared topic words are not an overlap", () => {
  // Two camera articles inevitably share 'canon' and 'camera'. That is a
  // topic, not a duplicate.
  const o = titleOverlap(
    "Canon EOS R5 vs R6: Which Full-Frame Body",
    "Canon DSLR Buying Guide: Which EOS Body"
  );
  assert.ok(o < OVERLAP_THRESHOLD, `overlap was ${o}`);
});

test("a near-restatement IS an overlap", () => {
  const o = titleOverlap(
    "Mesh Router Buying Guide 2026 Wi-Fi 6E vs Wi-Fi 7",
    "Mesh Router Buying 2026: Wi-Fi 6E versus Wi-Fi 7"
  );
  assert.ok(o >= OVERLAP_THRESHOLD, `overlap was ${o}`);
});

test("findOverlaps is symmetric and never matches a piece with itself", () => {
  const map = findOverlaps([
    { id: "1", title: "Mesh Router Buying Guide Wi-Fi 7" },
    { id: "2", title: "Mesh Router Buying Wi-Fi 7 Guide" },
    { id: "3", title: "Astrophotography Stacking Software" },
  ]);
  assert.deepEqual(map.get("1"), ["Mesh Router Buying Wi-Fi 7 Guide"]);
  assert.deepEqual(map.get("2"), ["Mesh Router Buying Guide Wi-Fi 7"]);
  assert.equal(map.get("3"), undefined);
});
