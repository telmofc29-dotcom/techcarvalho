import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assessPriority,
  classifyImportance,
  entitiesIn,
  highestTier,
  watchlist,
  PRIORITY_ENTITIES,
  TIER_LABELS,
  IMPORTANCE_LABELS,
} from "./priority-entities.ts";

// ---------------------------------------------------------------------------
// Tiers are configuration, not measurement
// ---------------------------------------------------------------------------

test("tier 1 is small enough to mean something", () => {
  // A tier containing everything prioritises nothing.
  const t1 = watchlist(1);
  assert.ok(t1.length >= 10, "tier 1 should cover the actual beat");
  assert.ok(t1.length <= 25, `tier 1 has ${t1.length} entities; that is not a priority list`);
});

test("every entity declares aliases and categories", () => {
  for (const e of PRIORITY_ENTITIES) {
    assert.ok(e.aliases.length > 0, `${e.name} has no aliases`);
    assert.ok(e.categories.length > 0, `${e.name} has no categories`);
    assert.ok([1, 2, 3].includes(e.tier));
  }
});

test("no entity is listed twice", () => {
  const names = PRIORITY_ENTITIES.map((e) => e.name);
  assert.equal(new Set(names).size, names.length);
});

test("tiers and importances all have labels", () => {
  for (const t of [1, 2, 3] as const) assert.ok(TIER_LABELS[t]);
  for (const i of ["major", "notable", "routine", "trivial"] as const) assert.ok(IMPORTANCE_LABELS[i]);
});

// ---------------------------------------------------------------------------
// Entity resolution
// ---------------------------------------------------------------------------

test("product lines resolve to their company", () => {
  assert.equal(entitiesIn("Galaxy S26 Ultra hands-on")[0].name, "Samsung");
  assert.equal(entitiesIn("New GeForce RTX driver")[0].name, "NVIDIA");
  assert.equal(entitiesIn("EOS R5 Mark II firmware")[0].name, "Canon");
  assert.equal(entitiesIn("Ender 3 upgrade guide")[0].name, "Creality");
});

test("matching is word-boundary, so substrings do not create entities", () => {
  assert.deepEqual(entitiesIn("A pineapple recipe"), []);
  assert.deepEqual(entitiesIn("alarm systems"), []);
});

test("the highest tier present wins", () => {
  // Samsung (1) and Corsair (2) both appear.
  assert.equal(highestTier("Samsung and Corsair announce a partnership"), 1);
  assert.equal(highestTier("Corsair announces new RAM"), 2);
  assert.equal(highestTier("An unknown startup launches something"), 3);
});

// ---------------------------------------------------------------------------
// Event importance
// ---------------------------------------------------------------------------

test("launches and announcements are major", () => {
  for (const h of [
    "Samsung unveils the Galaxy S26",
    "NVIDIA announces its next-generation GPU",
    "Canon launches the EOS R7 Mark II",
    "Sony discontinues the PlayStation VR",
  ]) {
    assert.equal(classifyImportance(h).importance, "major", h);
  }
});

test("updates and pricing are notable, not major", () => {
  assert.equal(classifyImportance("Windows 11 update improves battery life").importance, "notable");
  assert.equal(classifyImportance("RTX 5080 price drops in the UK").importance, "notable");
});

test("deals and roundups are trivial however big the company", () => {
  // The failure this prevents: "Save $200 on the new flagship" contains a
  // major signal and is still a deal post.
  assert.equal(classifyImportance("Save $200 on the new Galaxy flagship").importance, "trivial");
  assert.equal(classifyImportance("Best of the week in review").importance, "trivial");
  assert.equal(classifyImportance("Apple's four-pack of AirTags is 20% off").importance, "trivial");
});

test("importance describes the event, not the writing", () => {
  assert.equal(classifyImportance("An amazing incredible thing you won't believe").importance, "routine");
});

// ---------------------------------------------------------------------------
// Combined scoring
// ---------------------------------------------------------------------------

test("a major uncovered development from a tier 1 company is urgent", () => {
  const a = assessPriority({
    headline: "Samsung unveils the Galaxy S26 Ultra",
    ageDays: 1,
    independentOrigins: 3,
    alreadyCovered: false,
  });
  assert.equal(a.tier, 1);
  assert.equal(a.importance, "major");
  assert.equal(a.urgent, true);
  assert.match(a.reason, /Watch closely/);
  assert.match(a.reason, /no coverage/i);
});

test("priority buys attention, not indulgence", () => {
  // A deal post about a tier 1 company must rank BELOW a real development
  // from a tier 3 one, or the watchlist becomes a firehose.
  const deal = assessPriority({
    headline: "Save $200 on the Galaxy S26",
    ageDays: 1, independentOrigins: 3, alreadyCovered: false,
  });
  const realStory = assessPriority({
    headline: "Obscure Corp launches a new open-source slicer",
    ageDays: 1, independentOrigins: 3, alreadyCovered: false,
  });
  assert.ok(realStory.score > deal.score, `${realStory.score} vs ${deal.score}`);
  assert.equal(deal.urgent, false);
});

test("already-covered stories are pushed down, not surfaced again", () => {
  const covered = assessPriority({ headline: "Samsung unveils the Galaxy S26", alreadyCovered: true });
  const gap = assessPriority({ headline: "Samsung unveils the Galaxy S26", alreadyCovered: false });
  assert.ok(gap.score > covered.score);
  assert.equal(covered.urgent, false);
});

test("urgency requires all three: watched company, real development, and a gap", () => {
  const notWatched = assessPriority({ headline: "Obscure Corp launches a thing", alreadyCovered: false });
  const notMajor = assessPriority({ headline: "Samsung updates its website", alreadyCovered: false });
  const notAGap = assessPriority({ headline: "Samsung unveils the Galaxy S26", alreadyCovered: true });
  assert.equal(notWatched.urgent, false);
  assert.equal(notMajor.urgent, false);
  assert.equal(notAGap.urgent, false);
});

test("freshness matters but does not outrank importance", () => {
  const freshTrivial = assessPriority({ headline: "Galaxy deal of the day", ageDays: 0, alreadyCovered: false });
  const olderMajor = assessPriority({ headline: "Samsung unveils the Galaxy S26", ageDays: 6, alreadyCovered: false });
  assert.ok(olderMajor.score > freshTrivial.score);
});

test("the reason always names what did the work", () => {
  for (const h of ["Samsung unveils the Galaxy S26", "Obscure Corp does something", "Galaxy deal of the day"]) {
    const a = assessPriority({ headline: h, alreadyCovered: false });
    assert.ok(a.reason.length > 30, h);
  }
});

// ---------------------------------------------------------------------------
// Priority is not popularity
// ---------------------------------------------------------------------------

test("nothing here produces anything resembling demand data", () => {
  const a = assessPriority({ headline: "Samsung unveils the Galaxy S26", alreadyCovered: false });
  // The reason is the product; the score is an ordering key and must never be
  // described to the owner as a measurement.
  assert.ok(!/search|volume|traffic|popular|trend/i.test(a.reason));
});

test("first-person opinion columns are not developments", () => {
  // "It Took Apple 8 Years to Listen to Me" contains a major-sounding verb and
  // is a personal essay. It reached a draft before this rule existed.
  for (const h of [
    "It Took Apple 8 Years to Listen to Me",
    "Why I switched back to Android",
    "I tried the new Galaxy for a week",
    "Opinion: Nvidia has lost the plot",
  ]) {
    assert.equal(classifyImportance(h).importance, "trivial", h);
  }
});

test("a genuine development is not mistaken for an opinion piece", () => {
  assert.equal(classifyImportance("Samsung unveils the Galaxy S26 Ultra").importance, "major");
  assert.equal(classifyImportance("Intel launches Core Ultra X7").importance, "major");
});

test("another outlet's review is not a development", () => {
  // Drafting from a review would put someone else's measured results behind
  // a TechCarvalho byline. The launch is coverable; the review is not.
  for (const h of [
    "Elegoo Centauri 2 Combo review: A budget-friendly printer",
    "Asus ROG Strix soundbar review: It looks better than it sounds",
    "Anycubic Kobra 4 Combo 3D printer review: Evolution, not revolution",
    "We tested the new Galaxy camera for two weeks",
  ]) {
    assert.equal(classifyImportance(h).importance, "trivial", h);
  }
});

test("a launch is still coverable even when reviews exist", () => {
  assert.equal(classifyImportance("Elegoo launches the Centauri 2 Combo").importance, "major");
});
