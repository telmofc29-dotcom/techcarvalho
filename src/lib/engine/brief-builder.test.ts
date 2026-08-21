import { test } from "node:test";
import assert from "node:assert/strict";
import { buildBrief } from "./brief-builder.ts";

const base = {
  title: "Company launches the XYZ 900 graphics card",
  summary: "Available now.",
  discoveryType: "product_launch",
  categorySlug: "computing",
  claimStatus: "confirmed_primary" as const,
  suggestedAngle: "product_launch" as const,
  sightingCount: 2,
};

test("a primary-confirmed claim becomes a verified fact", () => {
  const b = buildBrief({
    ...base,
    evidence: [{ url: "https://vendor.example/a", publisher: "Vendor", claim_status: "confirmed_primary", trust_level: "primary", originates_from_url: null }],
  });
  assert.equal(b.verifiedFacts.length > 0, true);
  assert.ok(b.verifiedFacts[0].includes("confirmed by a primary source"));
});

test("an unconfirmed rumour NEVER becomes a verified fact", () => {
  const b = buildBrief({
    ...base,
    claimStatus: "rumour",
    evidence: [{ url: "https://blog.example/x", publisher: "Blog", claim_status: "rumour", trust_level: "community", originates_from_url: null }],
  });
  assert.equal(b.verifiedFacts.length, 0);
  assert.ok(b.uncertainties.some((u) => u.includes("NOT primary-confirmed")));
  assert.ok(b.uncertainties.some((u) => u.toLowerCase().includes("never as established fact")));
});

test("circular reporting is surfaced as an explicit uncertainty", () => {
  const b = buildBrief({
    ...base,
    claimStatus: "leak",
    evidence: [
      { url: "https://a.example", publisher: "A", claim_status: "leak", trust_level: "secondary", originates_from_url: null },
      { url: "https://b.example", publisher: "B", claim_status: "leak", trust_level: "secondary", originates_from_url: "https://a.example" },
      { url: "https://c.example", publisher: "C", claim_status: "leak", trust_level: "secondary", originates_from_url: "https://a.example" },
    ],
  });
  assert.ok(b.uncertainties.some((u) => u.includes("repeat another source's claim")));
});

test("a single source is flagged as needing corroboration", () => {
  const b = buildBrief({
    ...base,
    claimStatus: "reported_secondary",
    evidence: [{ url: "https://a.example", publisher: "A", claim_status: "reported_secondary", trust_level: "secondary", originates_from_url: null }],
  });
  assert.ok(b.uncertainties.some((u) => u.includes("Only one independent source")));
});

test("recalls and security issues are breaking and high priority", () => {
  const recall = buildBrief({ ...base, suggestedAngle: "recall", evidence: [] });
  const spec = buildBrief({ ...base, suggestedAngle: "specifications", evidence: [] });
  assert.equal(recall.freshnessSensitivity, "breaking");
  assert.ok(recall.priority > spec.priority);
});

test("comparisons and buying questions are evergreen", () => {
  assert.equal(buildBrief({ ...base, suggestedAngle: "comparison", evidence: [] }).freshnessSensitivity, "evergreen");
  assert.equal(buildBrief({ ...base, suggestedAngle: "buying_question", evidence: [] }).freshnessSensitivity, "evergreen");
});

test("every brief carries the media-first requirement, never assuming rights", () => {
  const b = buildBrief({ ...base, evidence: [] });
  assert.ok(b.mediaRequirementNote.includes("NOT cleared for republication"));
  assert.ok(b.mediaRequirementNote.includes("Awaiting Media"));
});

test("a brief contains questions and structure, never prose", () => {
  const b = buildBrief({ ...base, evidence: [] });
  assert.ok(b.primaryQuestion.length > 10);
  assert.ok(b.supportingQuestions.length >= 2);
  assert.ok(b.suggestedStructure.length >= 3);
});

test("priority is bounded to 100", () => {
  const b = buildBrief({ ...base, suggestedAngle: "recall", sightingCount: 999, evidence: [
    { url: "https://v.example", publisher: "V", claim_status: "confirmed_primary", trust_level: "primary", originates_from_url: null },
  ] });
  assert.ok(b.priority <= 100);
});

test("angle maps to a sensible content type", () => {
  assert.equal(buildBrief({ ...base, suggestedAngle: "comparison", evidence: [] }).contentType, "comparison");
  assert.equal(buildBrief({ ...base, suggestedAngle: "bug_or_problem", evidence: [] }).contentType, "troubleshooting");
  assert.equal(buildBrief({ ...base, suggestedAngle: "buying_question", evidence: [] }).contentType, "guide");
});
