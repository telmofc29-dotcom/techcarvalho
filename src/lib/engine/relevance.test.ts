import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyRelevance } from "./relevance.ts";

// The real corporate-noise titles the engine actually ingested in Phase 3.
test("rejects real investor-relations noise seen in production", () => {
  for (const title of [
    "Intel Announces Proposed $15 Billion Common Stock Offering",
    "Intel Announces Upsize and Pricing of $20 Billion Common Stock Offering",
    "Intel Announces Leadership Appointment to Strengthen Customer Engagement",
  ]) {
    const r = classifyRelevance({ title });
    assert.equal(r.verdict, "rejected", `expected reject for: ${title} (score ${r.score})`);
    assert.ok(r.negativeSignals.length > 0);
  }
});

test("a stock offering is rejected even though it mentions a price", () => {
  // "$15 Billion" trips the pricing pattern; the corporate weighting must win.
  const r = classifyRelevance({ title: "Intel Announces Proposed $15 Billion Common Stock Offering" });
  assert.equal(r.verdict, "rejected");
});

test("accepts genuine consumer product launches", () => {
  const r = classifyRelevance({
    title: "NVIDIA launches the GeForce RTX 5080 graphics card",
    summary: "Available now, priced at $999.",
  });
  assert.equal(r.verdict, "relevant");
  assert.equal(r.suggestedAngle !== null, true);
});

test("accepts recalls and consumer security issues with high weight", () => {
  const recall = classifyRelevance({ title: "Company issues recall over battery fire risk" });
  assert.equal(recall.verdict, "relevant");
  const sec = classifyRelevance({ title: "Security advisory: vulnerability patched in router firmware" });
  assert.equal(sec.verdict, "relevant");
});

test("accepts comparisons and buying questions", () => {
  assert.equal(classifyRelevance({ title: "RTX 5090 vs RTX 5080: which should you buy" }).verdict, "relevant");
  assert.equal(classifyRelevance({ title: "Is the PS5 Pro worth it for 1440p" }).verdict, "relevant");
});

test("accepts discontinuations and firmware updates", () => {
  assert.equal(classifyRelevance({ title: "Sony discontinues the original PS5 model" }).verdict, "relevant");
  assert.equal(classifyRelevance({ title: "Firmware update improves autofocus on the camera" }).verdict, "relevant");
});

test("rejects awards and sponsorship PR", () => {
  const r = classifyRelevance({ title: "Company named a leader and celebrates 25th anniversary" });
  assert.equal(r.verdict, "rejected");
});

test("ambiguous items are uncertain, not silently rejected", () => {
  const r = classifyRelevance({ title: "A note about our community programme" });
  assert.ok(r.verdict === "rejected" || r.verdict === "uncertain");
  // Whatever the verdict, it must be explained.
  assert.ok(r.explanation.length > 10);
});

test("every result carries an explanation naming its signals", () => {
  const r = classifyRelevance({ title: "NVIDIA launches new GPU at $999" });
  assert.ok(r.explanation.includes("Consumer-tech signals"));
  assert.ok(r.explanation.includes("Relevance score"));
});

test("rejected items never carry a suggested angle", () => {
  const r = classifyRelevance({ title: "Quarterly earnings report and dividend declared" });
  assert.equal(r.verdict, "rejected");
  assert.equal(r.suggestedAngle, null);
});

// These four were real misclassifications observed in production during the
// Phase 4 pipeline run, kept as permanent regressions.
test("rejects B2B semiconductor/manufacturing items that mention specs", () => {
  const r = classifyRelevance({
    title: "Intel and Lens Technology Collaborate to Enable Advanced Semiconductor Packaging",
  });
  assert.equal(r.verdict, "rejected", `score ${r.score}`);
});

test("rejects government/industry programme announcements", () => {
  const r = classifyRelevance({ title: "Intel Completes RAMP-C Program, Accelerating Momentum for Secure Enclave" });
  assert.equal(r.verdict, "rejected", `score ${r.score}`);
});

test("accepts consumer gaming promotions and betas", () => {
  for (const title of [
    "Intel Gamer Days 2026 Kicking Off with AAA Gaming Bundle & Partnerships",
    "Pre-order Call of Duty: Modern Warfare 4 and Play the Beta Today",
    "Free Play Days - Train Sim World 6, Icarus: Console Edition",
  ]) {
    assert.equal(classifyRelevance({ title }).verdict, "relevant", `expected accept: ${title}`);
  }
});

test("enterprise/data-centre framing is suppressed", () => {
  const r = classifyRelevance({ title: "New data center processors for enterprise workloads" });
  assert.notEqual(r.verdict, "relevant");
});

test("M&A is treated as corporate, not consumer product news", () => {
  const r = classifyRelevance({ title: "Company acquires startup in strategic partnership" });
  assert.notEqual(r.verdict, "relevant");
});

// --- Regression: real headlines from the non-vendor sources added 2026-08-22 ---
// The classifier had been tuned entirely on vendor product PR. Measured against
// the new sources, it scored genuine category news at zero and rejected it.
// These are verbatim feed titles.
test("real non-vendor headlines that must be RELEVANT", () => {
  const cases: string[] = [
    // Display standards — the whole VESA feed scored 0-4 before.
    "VESA Introduces DisplayHDR True Black 1400 to Certify Next-Generation Displays",
    "VESA Elevates PC and Laptop HDR Display Performance with Updated DisplayHDR Standard",
    "VESA to Update DisplayPort 2.1 with New Active Cable Specification",
    // Astrophotography — 10 published articles, two sources, no vocabulary.
    "A total solar eclipse is coming to Europe",
    "Perseids meteor shower peaks this week",
    "Webb captures a new image of the Pillars of Creation nebula",
    // Independent camera journalism.
    "This pocket-sized camera zooms to 2000mm and tracks wildlife on its own",
    "TTArtisan's $99 AF 85mm F1.8 gives Sony E and Nikon Z shooters a portrait lens",
    // Smart-home ecosystem.
    "FireAvert joins Works with Home Assistant",
  ];
  for (const title of cases) {
    const v = classifyRelevance({ title, summary: null });
    assert.equal(v.verdict, "relevant", `"${title}" scored ${v.score}`);
  }
});

// Deliberately NOT asserted relevant on the title alone: "Fly around
// Schiaparelli Crater with Mars Express" scores 0 without its summary, and a
// Mars orbiter flyover is space news rather than astrophotography a reader can
// act on. Stretching the vocabulary to catch it would start pulling in general
// space-agency PR.
test("organisational and off-topic posts from the same feeds stay rejected", () => {
  // Adding vocabulary must not turn every post from a good source relevant.
  const cases: string[] = [
    "Meet our new IETF NOC Lead",
    "Secretariat restructuring and staffing update",
    "IETF Community Survey 2025",
    "Just released: Raspberry Pi Book of Making 2027",
    "Community Day 2026: Save the date!",
    "Making our web analytics open source with Plausible",
  ];
  for (const title of cases) {
    const v = classifyRelevance({ title, summary: null });
    assert.notEqual(v.verdict, "relevant", `"${title}" wrongly relevant at ${v.score}`);
  }
});

test("the B2B and corporate rejections still hold after the new vocabulary", () => {
  // Guard against the display/astro additions reopening the hole closed earlier.
  const cases: string[] = [
    "Intel Completes RAMP-C Program, Accelerating Momentum for Secure Domestic Chips",
    "Intel Announces Upsize and Pricing of $20 Billion Common Stock Offering",
    "Intel and Lens Technology Collaborate to Enable Advanced Semiconductor Packaging for AI Era",
  ];
  for (const title of cases) {
    const v = classifyRelevance({ title, summary: null });
    assert.notEqual(v.verdict, "relevant", `"${title}" wrongly relevant at ${v.score}`);
  }
});
