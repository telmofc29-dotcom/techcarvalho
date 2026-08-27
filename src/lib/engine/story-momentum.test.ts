import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  assessMomentum, compareForQueue, ACCELERATION_WINDOW_DAYS, STALE_AFTER_DAYS,
  type OriginSighting,
} from "./story-momentum.ts";

const NOW = new Date("2026-08-27T12:00:00Z");
const daysAgo = (n: number): Date => new Date(NOW.getTime() - n * 86_400_000);
const s = (origin: string, n: number, firstParty = false): OriginSighting => ({ origin, firstSeen: daysAgo(n), firstParty });

const assess = (sightings: OriginSighting[], over: Partial<Parameters<typeof assessMomentum>[0]> = {}) =>
  assessMomentum({ sightings, significant: false, coverageGap: true, now: NOW, ...over });

describe("the signal a snapshot cannot produce", () => {
  // Both have three origins. The existing opportunity score cannot tell them
  // apart; that difference is the whole of breaking-news judgement.
  test("three origins arriving today is ACCELERATING", () => {
    const a = assess([s("a.com", 0), s("b.com", 0), s("c.com", 1)]);
    assert.equal(a.state, "ACCELERATING");
    assert.match(a.reasons[0], /new independent origin/);
  });

  test("the same three origins, two weeks old, is STABLE", () => {
    const a = assess([s("a.com", 14), s("b.com", 14), s("c.com", 13)]);
    assert.equal(a.state, "STABLE");
    assert.match(a.reasons[0], /established rather than breaking/);
  });

  test("distinct origins only — five stories from one outlet is one origin", () => {
    const a = assess([s("a.com", 0), s("a.com", 0), s("a.com", 1), s("a.com", 1), s("a.com", 2)]);
    assert.equal(a.origins, 1, "syndication is not corroboration");
    assert.equal(a.state, "EMERGING");
  });
});

describe("MAJOR needs weight as well as speed", () => {
  test("significant, corroborated and still gathering is MAJOR", () => {
    const a = assess([s("a.com", 0), s("b.com", 0), s("c.com", 1)], { significant: true });
    assert.equal(a.state, "MAJOR");
    assert.match(a.reasons[0], /Significant development, corroborated/);
  });

  test("first-party confirmation reaches MAJOR on two origins", () => {
    const a = assess([s("canon.co.uk", 0, true), s("b.com", 0)], { significant: true });
    assert.equal(a.state, "MAJOR");
    assert.match(a.reasons[0], /by the subject itself/);
  });

  test("fast but trivial is ACCELERATING, never MAJOR", () => {
    const a = assess([s("a.com", 0), s("b.com", 0), s("c.com", 0)], { significant: false });
    assert.equal(a.state, "ACCELERATING");
  });

  test("significant but single-sourced is not MAJOR", () => {
    const a = assess([s("a.com", 0)], { significant: true });
    assert.equal(a.state, "EMERGING");
  });
});

describe("a story that stopped is stale, whatever else is true", () => {
  test(`no new origin for over ${STALE_AFTER_DAYS} days is STALE`, () => {
    const a = assess([s("a.com", 40), s("b.com", 39), s("c.com", 38)], { significant: true });
    assert.equal(a.state, "STALE", "a significant dead story must not sit at the top of the queue");
  });

  test("no origins at all is STALE, not an error", () => {
    const a = assess([]);
    assert.equal(a.state, "STALE");
    assert.equal(a.origins, 0);
  });
});

describe("a famous name cannot manufacture momentum", () => {
  // THE BRIEF'S OWN EXAMPLE. A trivial Apple item must not outrank a major
  // Canon launch just because Apple is Tier 1.
  test("entity tier is absent from the state machine entirely", () => {
    const appleDiscount = assess([s("macrumors.com", 12)], { significant: false });
    const canonLaunch = assess([s("dpreview.com", 0), s("canon.co.uk", 0, true)], { significant: true });
    assert.equal(appleDiscount.state, "STABLE");
    assert.equal(canonLaunch.state, "MAJOR");
  });

  test("and tier cannot lift a still story above a moving one in the queue", () => {
    const order = [
      { momentum: "STABLE" as const, score: 95, entityTier: 1 },   // Apple, high score, not moving
      { momentum: "MAJOR" as const, score: 60, entityTier: 2 },    // Canon, lower score, moving
    ].sort(compareForQueue);
    assert.equal(order[0].momentum, "MAJOR", "a Tier 1 name must not outrank real movement");
  });

  test("tier only separates stories that are otherwise identical", () => {
    const order = [
      { momentum: "MAJOR" as const, score: 70, entityTier: 3 },
      { momentum: "MAJOR" as const, score: 70, entityTier: 1 },
    ].sort(compareForQueue);
    assert.equal(order[0].entityTier, 1);
  });
});

describe("nothing invented", () => {
  test("the assessment exposes only signals this site genuinely has", () => {
    const a = assess([s("a.com", 0), s("b.com", 1)], { significant: true });
    const keys = Object.keys(a).sort();
    assert.deepEqual(keys, [
      "ageDays", "daysSinceLastOrigin", "firstParty", "newOrigins", "origins", "reasons", "state",
    ]);
    // No trend, no volume, no traffic, no share count.
    for (const forbidden of ["trend", "volume", "traffic", "shares", "popularity"]) {
      assert.ok(!keys.includes(forbidden), `${forbidden} is not a signal TechCarvalho has`);
    }
  });

  test("every state explains itself", () => {
    for (const sightings of [[], [s("a.com", 0)], [s("a.com", 0), s("b.com", 0)], [s("a.com", 30)]]) {
      const a = assess(sightings);
      assert.ok(a.reasons.length > 0 && a.reasons[0].length > 20, `${a.state} gave no usable reason`);
    }
  });

  test(`the acceleration window is ${ACCELERATION_WINDOW_DAYS} days and is applied to FIRST sightings`, () => {
    const inside = assess([s("a.com", 10), s("b.com", ACCELERATION_WINDOW_DAYS - 1)]);
    const outside = assess([s("a.com", 10), s("b.com", ACCELERATION_WINDOW_DAYS + 2)]);
    assert.equal(inside.state, "ACCELERATING");
    assert.equal(outside.state, "STABLE");
  });
});
