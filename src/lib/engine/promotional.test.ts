import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classifyPromotional, isVerbatimVendorHeadline, PROMOTIONAL_THRESHOLD,
} from "./promotional.ts";

// Verbatim titles from the 16 briefs the engine actually produced. Every one
// was queued for publication as written. They stay here permanently.
const REAL_PROMOTIONAL = [
  "Pre-order Call of Duty: Modern Warfare 4 and Play the Beta Today",
  "Free Play Days – Train Sim World 6, Icarus: Console Edition, and Lynked: Banner of the Spark",
  "Intel Gamer Days 2026 Kicking Off with AAA Gaming Bundle &#038; Partnerships",
  "Next Week on XBOX: New Games for August 24 to 28",
  "Class Is in Session: GeForce NOW Levels Up Linux, Chromebooks and More",
  "Get closer to the game with Gemini and Pixel",
  "Tap into the power of Gemini in Chrome on Android.",
  "Universitas Gadjah Mada, Indosat and NVIDIA Open Indonesia’s First University AI Center to Develop Local AI Talent",
  // Second wave: vendor material the first ruleset missed, all from the same
  // real review queue.
  "Keep your SAT prep on track with practice tests in Gemini.",
  "Best in Class: Stream PC Games and Study on the Same Laptop With GeForce NOW",
  "Firebird Launches CIS Region’s Largest AI Factory in Armenia",
  "Bring the Fire: Play Games on GeForce NOW With New Firefox Browser",
];

// Deliberately NOT auto-rejected. These register promotional signal but stay
// below the threshold, because the underlying topic is legitimately
// newsworthy for a gaming publication and only the vendor's FRAMING is the
// problem. Chasing them would overfit to this one sample of 16 and start
// rejecting real news. A human decides these.
const REAL_BORDERLINE = [
  "Modern Warfare 4 Open Beta: Everything You Need to Know",
  "Call of Duty: Modern Warfare 4 – Inside the Maps and Movement of Multiplayer",
];

test("every real promotional brief title is caught", () => {
  for (const t of REAL_PROMOTIONAL) {
    const v = classifyPromotional(t);
    assert.equal(v.isPromotional, true, `MISSED: "${t}" scored ${v.score}`);
  }
});

test("borderline vendor framing registers signal but is left for a human", () => {
  for (const t of REAL_BORDERLINE) {
    const v = classifyPromotional(t);
    assert.ok(v.score > 0, `"${t}" should register some signal`);
    assert.equal(v.isPromotional, false, `"${t}" should NOT be auto-rejected (scored ${v.score})`);
  }
});

test("genuine news headlines are NOT flagged", () => {
  const genuine = [
    "Canon Announces the EOS R6 Mark III",
    "Nintendo Switch 2 Launches in June",
    "AMD Confirms Ryzen 9 9950X3D Specifications",
    "Sony Discontinues the PlayStation 5 Digital Edition",
    "GTA 6 Delayed to November 2026",
    "Wi-Fi 8 Draft Specification Published",
  ];
  for (const t of genuine) {
    const v = classifyPromotional(t);
    assert.equal(v.isPromotional, false, `FALSE POSITIVE: "${t}" scored ${v.score} (${v.matched.join(",")})`);
  }
});

test("a single soft marketing verb is not enough to condemn a headline", () => {
  const v = classifyPromotional("New GPU Levels Up Ray Tracing Performance");
  assert.ok(v.score > 0, "should register something");
  assert.ok(v.score < PROMOTIONAL_THRESHOLD, `scored ${v.score}`);
});

test("one strong marker alone is enough", () => {
  for (const t of ["Pre-order the new handheld", "Free Play Days this weekend", "Enter to win a console"]) {
    assert.equal(classifyPromotional(t).isPromotional, true, t);
  }
});

test("the verdict explains itself and does not condemn the underlying topic", () => {
  const v = classifyPromotional("Pre-order Call of Duty: Modern Warfare 4 and Play the Beta Today");
  assert.ok(v.explanation.includes("may still be worth covering"));
  assert.ok(v.matched.length > 0);
});

test("a summary alone cannot condemn a legitimate headline", () => {
  const v = classifyPromotional(
    "Canon Announces the EOS R6 Mark III",
    "Pre-order now and save 10% during our Gamer Days sale event."
  );
  assert.equal(v.isPromotional, false, `summary should not dominate; scored ${v.score}`);
});

test("verbatim vendor headlines are detected regardless of entities and casing", () => {
  assert.equal(
    isVerbatimVendorHeadline(
      "Intel Gamer Days 2026 Kicking Off with AAA Gaming Bundle &#038; Partnerships",
      "Intel Gamer Days 2026 Kicking Off with AAA Gaming Bundle & Partnerships"
    ),
    true
  );
  assert.equal(
    isVerbatimVendorHeadline("What Modern Warfare 4's Beta Actually Tells Us", "Pre-order Call of Duty"),
    false
  );
  assert.equal(isVerbatimVendorHeadline("Anything", null), false);
});
