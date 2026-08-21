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
