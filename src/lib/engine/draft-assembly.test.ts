import { test } from "node:test";
import assert from "node:assert/strict";
import { assembleDraft, proposeSeo, findUnfinishedAssemblyMarkers } from "./draft-assembly.ts";

const base = {
  title: "Something Happened",
  contentType: "news",
  categorySlug: "gaming",
  primaryQuestion: "What is confirmed and who is affected?",
  supportingQuestions: ["Who is affected?", "When does this not matter?"],
  verifiedFacts: [] as string[],
  uncertainties: [] as string[],
  sourceUrls: ["https://vendor.example/post"],
  suggestedStructure: ["What is confirmed", "What is claimed"],
  briefKind: "breaking",
  freshnessSensitivity: "breaking",
  rationale: "Because it matters.",
  relatedContent: [],
  relatedProducts: [],
};

test("draft is always marked as not publishable as-is", () => {
  const d = assembleDraft(base);
  assert.ok(d.body.includes("NOT PUBLISHABLE AS-IS"));
});

test("with no verified facts, the whole piece is flagged attribution-only", () => {
  const d = assembleDraft(base);
  assert.equal(d.requiresAttributionThroughout, true);
  assert.ok(d.body.includes("must be written as an attributed claim"));
});

test("uncertainties render under an explicit do-not-state-as-fact heading", () => {
  const d = assembleDraft({ ...base, uncertainties: ["Rumoured price is $499."] });
  assert.ok(d.body.includes("DO NOT state as fact"));
  assert.ok(d.body.includes("Rumoured price is $499."));
});

test("verified facts are reproduced verbatim, never paraphrased", () => {
  const fact = 'Vendor confirmed the release date is 5 November 2026.';
  const d = assembleDraft({ ...base, verifiedFacts: [fact] });
  assert.ok(d.body.includes(fact));
  assert.equal(d.hasVerifiedFacts, true);
});

test("the engine writes no finished prose — only placeholders", () => {
  const d = assembleDraft(base);
  assert.ok(d.body.includes("[Write this section"));
});

test("unpublished products are NOT linked", () => {
  const d = assembleDraft({
    ...base,
    relatedProducts: [
      { name: "Live Thing", slug: "live-thing", isPublished: true },
      { name: "Draft Thing", slug: "draft-thing", isPublished: false },
    ],
  });
  assert.ok(d.body.includes("[Live Thing](/products/live-thing)"));
  assert.ok(!d.body.includes("(/products/draft-thing)"));
  assert.ok(d.body.includes("do not link until it is"));
});

test("missing sources are called out rather than silently omitted", () => {
  const d = assembleDraft({ ...base, sourceUrls: [] });
  assert.ok(d.body.includes("Do not publish without sources"));
});

test("breaking pieces carry a re-verify instruction", () => {
  const d = assembleDraft(base);
  assert.ok(d.body.includes("verify every claim is still current"));
});

test("proposeSeo never invents a description", () => {
  assert.equal(proposeSeo({ title: "T", primaryQuestion: null }).metaDescription, null);
  const s = proposeSeo({ title: "T", primaryQuestion: "Is it worth it? (Thing)" });
  assert.ok(s.metaDescription && !s.metaDescription.includes("(Thing)"));
});

test("long titles are truncated for meta title", () => {
  const long = "x".repeat(100);
  assert.ok(proposeSeo({ title: long, primaryQuestion: null }).metaTitle.length <= 60);
});

test("an unfinished assembled draft is caught before publication", () => {
  const d = assembleDraft({ ...base, uncertainties: ["Rumoured price is $499."] });
  const found = findUnfinishedAssemblyMarkers(d.body);
  assert.ok(found.length >= 3, `only found: ${found.join(", ")}`);
  assert.ok(found.some((f) => f.includes("editor banner")));
});

test("a genuinely written article passes the publication guard", () => {
  const written = `## The short version\n\nCanon confirmed the EOS R7 ships in November.\n\n## Who should care\n\nAnyone shooting wildlife.`;
  assert.deepEqual(findUnfinishedAssemblyMarkers(written), []);
});

test("the guard tolerates a missing body", () => {
  assert.deepEqual(findUnfinishedAssemblyMarkers(null), []);
  assert.deepEqual(findUnfinishedAssemblyMarkers(""), []);
});
