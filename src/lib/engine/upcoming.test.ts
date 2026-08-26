import { test } from "node:test";
import assert from "node:assert/strict";
import { detectUpcoming, upcomingBoost } from "./upcoming.ts";

// Every fixture is a real production opportunity headline.

test("a rumoured date is never assertable as a schedule", () => {
  // THE RULE THIS MODULE EXISTS FOR. Both name October; only one is a schedule.
  const rumoured = detectUpcoming("New iPad Mini With Four Upgrades Expected to Launch by Late October");
  assert.equal(rumoured.isUpcoming, true);
  assert.equal(rumoured.kind, "dated");
  assert.equal(rumoured.confirmation, "rumour");
  assert.equal(rumoured.dateAssertable, false, "a leaked date must never read as announced");
  assert.match(rumoured.reason, /unconfirmed report/i);
});

test("speculation about a date is not a schedule either", () => {
  const s = detectUpcoming("Report: New Mac mini could launch before Apple's September event");
  assert.equal(s.dateAssertable, false);
  assert.equal(s.confirmation, "speculation");
});

test("an announced pre-order is assertable", () => {
  const a = detectUpcoming("Apple's New Mac Mini and Mac Studio Are Now Available to Pre-Order");
  assert.equal(a.isUpcoming, true);
  assert.equal(a.kind, "imminent");
  assert.equal(a.dateAssertable, true);
});

test("first-party confirmation is what earns a schedule, not confident wording", () => {
  const headline = "Apple announces the Mac Studio ships September 9";
  const reported = detectUpcoming(headline);
  const firstParty = detectUpcoming(headline, { firstParty: true });
  assert.equal(reported.dateAssertable, true, "an announcement is assertable");
  assert.equal(firstParty.confirmation, "confirmed");
  // And confident phrasing on a rumour still fails.
  const loud = detectUpcoming("Leaker insists the Mac Studio will definitely launch September 9");
  assert.equal(loud.dateAssertable, false, "confident phrasing must not manufacture a schedule");
});

test("a named industry event counts as timing", () => {
  assert.equal(detectUpcoming("Intel to detail Xeon 7 at Hot Chips 2026").kind, "event");
  assert.equal(detectUpcoming("Apple announces WWDC keynote").kind, "event");
});

test("relative windows are recognised but never resolved into a date", () => {
  const r = detectUpcoming("AirPods 5 to Launch as Early as Next Month");
  assert.equal(r.kind, "relative");
  // The phrase is preserved verbatim. Resolving it needs a publication date
  // many feeds do not carry, and a wrong date is worse than a phrase.
  assert.ok(r.timingText && /next month/i.test(r.timingText));
  assert.ok(!/\d{4}-\d{2}-\d{2}/.test(JSON.stringify(r)), "no invented calendar date");
});

test("something that already happened is not upcoming", () => {
  for (const h of [
    "Apple Reveals M6 as First-Ever 2nm Chip",
    "Nvidia DLSS 4.5 Ray Reconstruction, out now, ups shadow quality",
  ]) {
    assert.equal(detectUpcoming(h).isUpcoming, false, h);
  }
});

test("future tense with no timing still counts as upcoming", () => {
  const u = detectUpcoming("Samsung will announce its next foldable");
  assert.equal(u.isUpcoming, true);
  assert.equal(u.kind, "unspecified");
  assert.equal(u.timingText, null);
});

test("a rumour gets NO ranking boost at all", () => {
  // Not a small one: a small boost is how rumours creep up a list.
  const rumour = detectUpcoming("New Mac Mini Reportedly Set to Launch Before iPhone 18 Pro Event");
  assert.equal(upcomingBoost(rumour), 0);

  const announced = detectUpcoming("Apple's New Mac Mini and Mac Studio Are Now Available to Pre-Order");
  assert.ok(upcomingBoost(announced) > 0);
});

test("a confirmed imminent launch outranks a confirmed distant one", () => {
  const imminent = detectUpcoming("Mac Studio pre-orders are open", { firstParty: true });
  const distant = detectUpcoming("Apple announces a new Mac for 2028", { firstParty: true });
  assert.ok(upcomingBoost(imminent) > upcomingBoost(distant));
});

test("every signal explains itself", () => {
  for (const h of [
    "New iPad Mini Expected to Launch by Late October",
    "Apple Reveals M6 as First-Ever 2nm Chip",
    "AirPods 5 to Launch as Early as Next Month",
  ]) {
    assert.ok(detectUpcoming(h).reason.length > 15, h);
  }
});
