import { test } from "node:test";
import assert from "node:assert/strict";
import {
  rankOpportunity,
  classifyConfirmation,
  classifySignificance,
  isSubjectOfHeadline,
  WEIGHTS,
} from "./opportunity-score.ts";

// EVERY FIXTURE BELOW IS A REAL PRODUCTION OPPORTUNITY, and every assertion is
// a tie the previous additive model produced. 39 opportunities collapsed into
// three distinct scores; these are the pairs that made that indefensible.

const APPLE = ["apple", "iphone", "ipad", "macbook", "ios"];
const INTEL = ["intel", "xeon", "core ultra"];

function score(headline: string, extra: Parameters<typeof rankOpportunity>[0] = { headline }) {
  return rankOpportunity({ ...extra, headline }).score;
}

test("a confirmed flagship launch outranks a licence agreement", () => {
  // Both scored exactly 100 before.
  const launch = score("(PR) Apple Introduces New Mac Studio with M5 Max and M5 Ultra", {
    headline: "", entityAliases: APPLE, firstParty: true, ageDays: 1, independentOrigins: 5, alreadyCovered: false,
  });
  const admin = score("Updated Apple Developer Program License Agreement now available", {
    headline: "", entityAliases: APPLE, firstParty: true, ageDays: 1, independentOrigins: 8, alreadyCovered: false,
  });
  assert.ok(launch > admin, `${launch} !> ${admin}`);
  // And not by a rounding error: these are different kinds of thing.
  assert.ok(launch - admin > 15, `only ${(launch - admin).toFixed(2)} apart`);
});

test("a one-source rumour never outranks a confirmed first-party launch", () => {
  // The worst tie in the production data: both were 100.
  const rumour = score("Crazy report reveals Exynos 2700 could outperform Snapdragon 8 Elite Gen 6", {
    headline: "", entityAliases: ["qualcomm", "snapdragon"], ageDays: 1, independentOrigins: 1, alreadyCovered: false,
  });
  const confirmed = score("(PR) Apple Launches New Mac mini, Featuring M6 and M5 Pro", {
    headline: "", entityAliases: APPLE, firstParty: true, ageDays: 1, independentOrigins: 5, alreadyCovered: false,
  });
  assert.ok(confirmed > rumour, `${confirmed} !> ${rumour}`);
  // The gap threshold is the confirmation weight itself (0.22 x 100), less a
  // little: confirmation alone must move these apart by roughly its own
  // weight, and anything smaller would mean the dimension is not doing its
  // job. It is derived from WEIGHTS rather than picked.
  const minGap = WEIGHTS.confirmation * 100 * 0.85;
  assert.ok(confirmed - rumour > minGap, `only ${(confirmed - rumour).toFixed(2)} apart, wanted > ${minGap.toFixed(1)}`);
});

test("new silicon outranks a television commission", () => {
  // Both 94.64 before. A TV comedy series is not a technology development.
  const silicon = score("Apple Reveals M6 as First-Ever 2nm Chip", {
    headline: "", entityAliases: APPLE, ageDays: 1, independentOrigins: 2, alreadyCovered: false,
  });
  const tv = score("Apple TV unveils Matthew McConaughey comedy series from 'The Office' alum", {
    headline: "", entityAliases: APPLE, ageDays: 1, independentOrigins: 2, alreadyCovered: false,
  });
  assert.ok(silicon > tv, `${silicon} !> ${tv}`);
  assert.ok(silicon - tv > 20, `only ${(silicon - tv).toFixed(2)} apart`);
});

test("a product launch outranks a regional rollout of an existing feature", () => {
  // Both 94.64 before.
  const launch = score("New iPad Mini With Four Upgrades Expected to Launch by Late October", {
    headline: "", entityAliases: APPLE, ageDays: 1, independentOrigins: 2, alreadyCovered: false,
  });
  const rollout = score("Apple's Emergency SOS Live Video is now available in Brazil", {
    headline: "", entityAliases: APPLE, ageDays: 1, independentOrigins: 2, alreadyCovered: false,
  });
  assert.ok(launch > rollout, `${launch} !> ${rollout}`);
});

test("a company's own launch outranks a story where it is only a component", () => {
  // Both 91.96 before. Intel is the SUBJECT of one and a part inside the other.
  const own = score("Hot Chips 2026: Intel Xeon 7 'Diamond Rapids' comes with up to 256 P-cores", {
    headline: "", entityAliases: INTEL, ageDays: 1, independentOrigins: 1, alreadyCovered: false,
  });
  const component = score("Minisforum Launches $1,800 M2 Pro Mini PC With Intel Arc B390 iGPU", {
    headline: "", entityAliases: INTEL, ageDays: 1, independentOrigins: 1, alreadyCovered: false,
  });
  assert.ok(own > component, `${own} !> ${component}`);
});

test("entity priority does not overpower story significance", () => {
  // The owner's rule: priority buys attention, not indulgence. A tier 1
  // company's paperwork must lose to a tier 2 company's flagship launch.
  const tier1Admin = score("Updated Apple Developer Program License Agreement now available", {
    headline: "", entityAliases: APPLE, firstParty: true, ageDays: 1, independentOrigins: 8, alreadyCovered: false,
  });
  const tier2Launch = score("Elegoo launches the Centauri Carbon 3D printer", {
    headline: "", entityAliases: ["elegoo", "centauri"], firstParty: true, ageDays: 1, independentOrigins: 1, alreadyCovered: false,
  });
  assert.ok(tier2Launch > tier1Admin, `tier2 launch ${tier2Launch} !> tier1 admin ${tier1Admin}`);
});

test("the model actually discriminates across the real production set", () => {
  // The headline failure: 39 opportunities, 3 distinct scores.
  const real = [
    "(PR) Apple Introduces New Mac Studio with M5 Max and M5 Ultra",
    "Updated Apple Developer Program License Agreement now available",
    "Crazy report reveals Exynos 2700 could outperform Snapdragon 8 Elite Gen 6",
    "Apple Reveals M6 as First-Ever 2nm Chip",
    "Apple TV unveils Matthew McConaughey comedy series",
    "Apple's Emergency SOS Live Video is now available in Brazil",
    "Hot Chips 2026: Intel Xeon 7 'Diamond Rapids' comes with up to 256 P-cores",
    "Minisforum Launches $1,800 M2 Pro Mini PC With Intel Arc B390 iGPU",
    "iPhone Trade-In Values Slide Ahead of New Model Launch",
    "Nintendo Announces First Switch 2 Bundles to Launch Following the Console",
    "Nvidia DLSS 4.5 Ray Reconstruction, out now, ups shadow quality",
    "AMD RDNA 4m GPU Firmware Arrives Ahead of Launch",
  ];
  const scores = real.map((h, i) =>
    rankOpportunity({ headline: h, ageDays: 1 + (i % 3), independentOrigins: 1 + (i % 4), alreadyCovered: false }).score
  );
  const distinct = new Set(scores).size;
  assert.ok(distinct >= 9, `only ${distinct} distinct scores across ${real.length} real headlines`);
});

test("confirmation states are never collapsed", () => {
  assert.equal(classifyConfirmation("Apple announces the Mac Studio", { firstParty: true }).state, "confirmed");
  assert.equal(classifyConfirmation("Apple announces the Mac Studio").state, "announced");
  assert.equal(classifyConfirmation("Apple reportedly plans a Mac Studio").state, "rumour");
  assert.equal(classifyConfirmation("Apple could launch a Mac Studio").state, "speculation");
  assert.equal(classifyConfirmation("The Mac Studio has 256GB of memory").state, "reported");
});

test("a rumour that mentions a launch verb is still a rumour", () => {
  // "expected to launch" contains "launch"; reading the announcement marker
  // first would promote every rumour that happens to mention one.
  assert.equal(classifyConfirmation("New iPad Mini Expected to Launch by Late October").state, "rumour");
  assert.equal(classifyConfirmation("Xbox Series X expected to launch at EUR 499").state, "rumour");
});

test("first-party alone does not manufacture confirmation", () => {
  // A first-party page that is not announcing anything is not a confirmation.
  const v = classifyConfirmation("Apple reportedly working on a foldable", { firstParty: true });
  assert.equal(v.state, "rumour");
});

test("significance classification matches the real examples", () => {
  assert.equal(classifySignificance("Apple TV unveils comedy series from 'The Office' alum").kind, "off_topic_media");
  assert.equal(classifySignificance("Updated Apple Developer Program License Agreement now available").kind, "corporate_admin");
  assert.equal(classifySignificance("iPhone Trade-In Values Slide Ahead of New Model Launch").kind, "commerce");
  assert.equal(classifySignificance("Apple Reveals M6 as First-Ever 2nm Chip").kind, "core_silicon");
  assert.equal(classifySignificance("Nintendo Announces First Switch 2 Bundles").kind, "product_variant");
});

test("centrality reads the subject region, not the whole headline", () => {
  assert.equal(isSubjectOfHeadline("Intel Xeon 7 'Diamond Rapids' comes with 256 P-cores", INTEL), true);
  assert.equal(isSubjectOfHeadline("Minisforum Launches Mini PC With Intel Arc B390", INTEL), false);
  assert.equal(isSubjectOfHeadline("Acemagic F2A Mini PC featuring Intel Core Ultra", INTEL), false);
  // A "(PR)" prefix must not hide the subject.
  assert.equal(isSubjectOfHeadline("(PR) Intel announces Xeon 7", INTEL), true);
});

test("every score is a valid stored value and explains itself", () => {
  const r = rankOpportunity({ headline: "Apple announces the Mac Studio", firstParty: true, ageDays: 1 });
  assert.ok(r.score >= 0 && r.score <= 100);
  assert.equal(Math.round(r.score * 100) / 100, r.score, "must fit numeric(5,2)");
  assert.ok(r.components.length > 0);
  assert.ok(r.summary.length > 10);
  for (const c of r.components) {
    assert.ok(c.value >= 0 && c.value <= 1, `${c.name} = ${c.value}`);
    assert.ok(c.why.length > 5, `${c.name} has no explanation`);
  }
});

test("the weights are a mean, so the score cannot exceed the column bound", () => {
  const total = Object.values(WEIGHTS).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(total - 1) < 1e-9, `weights sum to ${total}, not 1`);
});

test("nothing in an explanation implies demand data we do not have", () => {
  const banned = /search volume|monthly searches|keyword difficulty|traffic estimate|market demand|popularity score/i;
  for (const h of ["Apple announces the Mac Studio", "Crazy report reveals Exynos 2700 could outperform"]) {
    const r = rankOpportunity({ headline: h, ageDays: 1 });
    assert.ok(!banned.test(r.summary), r.summary);
    for (const c of r.components) assert.ok(!banned.test(c.why), c.why);
  }
});
