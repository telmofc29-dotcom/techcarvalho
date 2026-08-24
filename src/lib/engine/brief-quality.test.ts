import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classifyBriefQuality,
  countIndependentDomains,
  isCombinatorial,
  summariseQuality,
  BRIEF_QUALITY_STATES,
  QUALITY_ENTERS_OWNER_QUEUE,
  QUALITY_INVITES_MORE_RESEARCH,
  BRIEF_QUALITY_LABELS,
  QUALITY_RANK,
  MIN_FACTS_FOR_REVIEW,
  MIN_INDEPENDENT_DOMAINS,
  STALE_WITHOUT_EVIDENCE_DAYS,
  type BriefQualityInput,
} from "./brief-quality.ts";

const NOW = new Date("2026-08-24T12:00:00Z");

function brief(over: Partial<BriefQualityInput> = {}): BriefQualityInput {
  return {
    title: "Something happened",
    briefKind: "news",
    contentType: "news",
    verifiedFacts: [],
    uncertainties: [],
    sourceUrls: [],
    freshnessSensitivity: null,
    hasDiscovery: true,
    hasOpportunity: false,
    createdAt: "2026-08-23T12:00:00Z",
    ...over,
  };
}

// ---------------------------------------------------------------------------
// The exact production case that motivated the module
// ---------------------------------------------------------------------------

test("the real NIKKOR combinatorial brief is not worth pursuing", () => {
  const v = classifyBriefQuality(
    brief({
      title: "NIKKOR Z 50mm f/1.2 S vs NIKKOR Z 50mm f/1.4",
      briefKind: "comparison",
      contentType: "comparison",
      hasDiscovery: false,
      hasOpportunity: false,
    }),
    NOW
  );
  assert.equal(v.state, "not_worth_pursuing");
  assert.equal(v.entersOwnerQueue, false);
  assert.match(v.reasons[0], /pairing two catalogue entries/i);
});

test("a comparison brief WITH real evidence is not treated as combinatorial", () => {
  const input = brief({
    title: "Nikon Z6 III vs Sony A7 IV",
    briefKind: "comparison",
    contentType: "comparison",
    verifiedFacts: ["Z6 III uses a partially stacked sensor", "A7 IV uses a conventional BSI sensor"],
    sourceUrls: ["https://www.dpreview.com/a", "https://www.nikon.com/b"],
    hasDiscovery: true,
  });
  assert.equal(isCombinatorial(input), false);
  assert.equal(classifyBriefQuality(input, NOW).state, "ready_for_review");
});

test("a ' vs ' title alone does not condemn a brief that has sources", () => {
  const v = classifyBriefQuality(
    brief({
      title: "USB-C vs Lightning after the EU deadline",
      briefKind: null,
      contentType: null,
      verifiedFacts: ["The EU common charger directive applied from 28 December 2024", "Apple shipped USB-C on iPhone 15"],
      sourceUrls: ["https://eur-lex.europa.eu/x", "https://www.apple.com/y"],
      hasDiscovery: true,
    }),
    NOW
  );
  assert.equal(v.state, "ready_for_review");
});

// ---------------------------------------------------------------------------
// Independence — repetition is not corroboration
// ---------------------------------------------------------------------------

test("five pages from one publisher count as one independent voice", () => {
  assert.equal(
    countIndependentDomains([
      "https://www.macrumors.com/a",
      "https://www.macrumors.com/b",
      "https://www.macrumors.com/c",
      "https://macrumors.com/d",
      "https://www.macrumors.com/e?utm_source=x",
    ]),
    1
  );
});

test("subdomains of one site are one voice, distinct sites are many", () => {
  assert.equal(countIndependentDomains(["https://news.bbc.co.uk/a", "https://www.bbc.co.uk/b"]), 1);
  assert.equal(countIndependentDomains(["https://www.theverge.com/a", "https://www.reuters.com/b"]), 2);
});

test("well-sourced but single-publisher briefs are low confidence, not ready", () => {
  const v = classifyBriefQuality(
    brief({
      verifiedFacts: ["Fact one", "Fact two", "Fact three"],
      sourceUrls: ["https://www.macrumors.com/a", "https://www.macrumors.com/b"],
    }),
    NOW
  );
  assert.equal(v.state, "low_confidence");
  assert.equal(v.independentDomains, 1);
  assert.match(v.reasons[0], /Repetition from one publisher is not corroboration/);
});

test("an unparseable URL is counted as an unknown voice, never silently dropped", () => {
  // Three broken links must not look identical to no links at all.
  assert.equal(countIndependentDomains(["not a url", "also not a url"]), 1);
  assert.equal(countIndependentDomains([]), 0);
  assert.equal(countIndependentDomains(["https://www.reuters.com/a", "garbage"]), 2);
});

// ---------------------------------------------------------------------------
// The evidence thresholds
// ---------------------------------------------------------------------------

test("independent sources but a single fact needs more research", () => {
  const v = classifyBriefQuality(
    brief({
      verifiedFacts: ["Only one established fact"],
      sourceUrls: ["https://www.reuters.com/a", "https://www.theverge.com/b"],
    }),
    NOW
  );
  assert.equal(v.state, "needs_more_research");
  assert.equal(v.invitesMoreResearch, true);
  assert.equal(v.entersOwnerQueue, false);
});

test("meeting both thresholds reaches ready_for_review", () => {
  const v = classifyBriefQuality(
    brief({
      verifiedFacts: Array.from({ length: MIN_FACTS_FOR_REVIEW }, (_, i) => `Fact ${i}`),
      sourceUrls: ["https://www.reuters.com/a", "https://www.theverge.com/b"],
    }),
    NOW
  );
  assert.equal(v.state, "ready_for_review");
  assert.equal(v.entersOwnerQueue, true);
  assert.equal(v.invitesMoreResearch, false);
});

test("one fact short of the threshold does not reach the owner queue", () => {
  const v = classifyBriefQuality(
    brief({
      verifiedFacts: Array.from({ length: MIN_FACTS_FOR_REVIEW - 1 }, (_, i) => `Fact ${i}`),
      sourceUrls: ["https://www.reuters.com/a", "https://www.theverge.com/b"],
    }),
    NOW
  );
  assert.notEqual(v.state, "ready_for_review");
});

test("one domain short of the threshold does not reach the owner queue", () => {
  const urls = Array.from({ length: MIN_INDEPENDENT_DOMAINS - 1 }, (_, i) => `https://site${i}.com/a`);
  const v = classifyBriefQuality(
    brief({ verifiedFacts: ["a", "b", "c", "d"], sourceUrls: urls }),
    NOW
  );
  assert.notEqual(v.state, "ready_for_review");
});

test("no evidence with a live discovery behind it stays researchable", () => {
  const v = classifyBriefQuality(brief({ hasDiscovery: true, hasOpportunity: true }), NOW);
  assert.equal(v.state, "insufficient_evidence");
  assert.equal(v.invitesMoreResearch, true);
  assert.match(v.reasons.join(" "), /something upstream to research from/i);
});

// ---------------------------------------------------------------------------
// Staleness
// ---------------------------------------------------------------------------

test("an evidence-free brief goes stale only after the stated window", () => {
  const justInside = new Date(NOW.getTime() - (STALE_WITHOUT_EVIDENCE_DAYS - 1) * 86_400_000).toISOString();
  const wellPast = new Date(NOW.getTime() - (STALE_WITHOUT_EVIDENCE_DAYS + 5) * 86_400_000).toISOString();

  assert.equal(classifyBriefQuality(brief({ createdAt: justInside }), NOW).state, "insufficient_evidence");
  assert.equal(classifyBriefQuality(brief({ createdAt: wellPast }), NOW).state, "not_worth_pursuing");
});

test("staleness does not condemn a brief that DID find evidence", () => {
  const wellPast = new Date(NOW.getTime() - (STALE_WITHOUT_EVIDENCE_DAYS + 40) * 86_400_000).toISOString();
  const v = classifyBriefQuality(
    brief({
      createdAt: wellPast,
      verifiedFacts: ["a", "b"],
      sourceUrls: ["https://www.reuters.com/a", "https://www.theverge.com/b"],
    }),
    NOW
  );
  assert.equal(v.state, "ready_for_review");
});

test("a malformed created_at never crashes and never fabricates an age", () => {
  const v = classifyBriefQuality(brief({ createdAt: "not-a-date" }), NOW);
  assert.equal(v.state, "insufficient_evidence");
});

// ---------------------------------------------------------------------------
// Cannibalisation outranks good evidence
// ---------------------------------------------------------------------------

test("a well-sourced brief duplicating a published page is a duplicate risk, not ready", () => {
  const v = classifyBriefQuality(
    brief({
      title: "iPhone 18: everything confirmed so far",
      verifiedFacts: ["a", "b", "c"],
      sourceUrls: ["https://www.reuters.com/a", "https://www.theverge.com/b"],
      existingTitles: ["iPhone 18: everything confirmed so far"],
    }),
    NOW
  );
  assert.equal(v.state, "duplicate_risk");
  assert.equal(v.entersOwnerQueue, false);
  assert.equal(v.duplicateOf?.similarity, 1);
  assert.match(v.reasons.join(" "), /Updating the existing page/i);
});

test("unrelated existing content does not trigger a duplicate verdict", () => {
  const v = classifyBriefQuality(
    brief({
      title: "iPhone 18: everything confirmed so far",
      verifiedFacts: ["a", "b"],
      sourceUrls: ["https://www.reuters.com/a", "https://www.theverge.com/b"],
      existingTitles: ["Best mechanical keyboards for programmers", "How to clean a camera sensor"],
    }),
    NOW
  );
  assert.equal(v.state, "ready_for_review");
  assert.equal(v.duplicateOf, null);
});

test("the closest duplicate is reported when several match", () => {
  const v = classifyBriefQuality(
    brief({
      title: "iPhone 18 Pro camera upgrade",
      verifiedFacts: ["a", "b"],
      sourceUrls: ["https://www.reuters.com/a", "https://www.theverge.com/b"],
      existingTitles: ["iPhone 18 Pro camera upgrade", "iPhone 18 Pro camera"],
    }),
    NOW
  );
  assert.equal(v.state, "duplicate_risk");
  assert.equal(v.duplicateOf?.title, "iPhone 18 Pro camera upgrade");
});

// ---------------------------------------------------------------------------
// Vendor marketing is a framing problem, not an evidence problem
// ---------------------------------------------------------------------------

test("a well-sourced vendor press release does not reach the owner queue unreframed", () => {
  const v = classifyBriefQuality(
    brief({
      title: "Introducing the all-new Acme Widget Pro — available now, order today!",
      verifiedFacts: ["Ships 1 October", "Costs 499 USD"],
      sourceUrls: ["https://www.reuters.com/a", "https://www.theverge.com/b"],
    }),
    NOW
  );
  assert.equal(v.readsAsPromotional, true);
  assert.equal(v.state, "needs_more_research");
  assert.equal(v.entersOwnerQueue, false);
  // The reason must not misdescribe this as thin sourcing — the sourcing is fine.
  assert.match(v.reasons.join(" "), /Evidence is sufficient/);
  assert.match(v.reasons.join(" "), /reframe/i);
});

test("a single-vendor-source announcement says so, rather than giving a generic reason", () => {
  const v = classifyBriefQuality(
    brief({
      title: "Introducing the all-new Acme Cloud — available now, order today!",
      verifiedFacts: ["a", "b"],
      sourceUrls: ["https://www.acme.com/blog/post"],
    }),
    NOW
  );
  assert.equal(v.state, "low_confidence");
  assert.match(v.reasons.join(" "), /weakest shape/i);
});

test("plain editorial headlines are never flagged as promotional", () => {
  const v = classifyBriefQuality(
    brief({
      title: "VESA updates the Adaptive-Sync display standard",
      verifiedFacts: ["a", "b"],
      sourceUrls: ["https://www.reuters.com/a", "https://www.theverge.com/b"],
    }),
    NOW
  );
  assert.equal(v.readsAsPromotional, false);
  assert.equal(v.state, "ready_for_review");
});

// ---------------------------------------------------------------------------
// Structural invariants — the maps that keep the queue narrow
// ---------------------------------------------------------------------------

test("exactly one state may enter the owner's main queue", () => {
  const allowed = BRIEF_QUALITY_STATES.filter((s) => QUALITY_ENTERS_OWNER_QUEUE[s]);
  assert.deepEqual(allowed, ["ready_for_review"]);
});

test("every state has a label, a rank and both policy decisions", () => {
  for (const s of BRIEF_QUALITY_STATES) {
    assert.equal(typeof BRIEF_QUALITY_LABELS[s], "string", `${s} label`);
    assert.equal(typeof QUALITY_RANK[s], "number", `${s} rank`);
    assert.equal(typeof QUALITY_ENTERS_OWNER_QUEUE[s], "boolean", `${s} queue policy`);
    assert.equal(typeof QUALITY_INVITES_MORE_RESEARCH[s], "boolean", `${s} research policy`);
  }
});

test("ready_for_review outranks every other state", () => {
  for (const s of BRIEF_QUALITY_STATES) {
    if (s === "ready_for_review") continue;
    assert.ok(QUALITY_RANK.ready_for_review > QUALITY_RANK[s], `ready should outrank ${s}`);
  }
});

test("anything the engine may keep researching is kept out of the owner queue", () => {
  // The two policies must never both be true: an item cannot simultaneously be
  // the owner's problem and still be the engine's work.
  for (const s of BRIEF_QUALITY_STATES) {
    assert.ok(
      !(QUALITY_ENTERS_OWNER_QUEUE[s] && QUALITY_INVITES_MORE_RESEARCH[s]),
      `${s} cannot be both owner-facing and still-researching`
    );
  }
});

test("every verdict carries a reason", () => {
  const cases: BriefQualityInput[] = [
    brief({ title: "A vs B", briefKind: "comparison", hasDiscovery: false }),
    brief({}),
    brief({ verifiedFacts: ["a", "b"], sourceUrls: ["https://a.com/1", "https://a.com/2"] }),
    brief({ verifiedFacts: ["a"], sourceUrls: ["https://a.com/1", "https://b.com/2"] }),
    brief({ verifiedFacts: ["a", "b"], sourceUrls: ["https://a.com/1", "https://b.com/2"] }),
  ];
  for (const c of cases) {
    const v = classifyBriefQuality(c, NOW);
    assert.ok(v.reasons.length > 0, `${v.state} produced no reason`);
    assert.ok(v.reasons.every((r) => r.trim().length > 10), `${v.state} produced an empty reason`);
  }
});

// ---------------------------------------------------------------------------
// Aggregate reporting
// ---------------------------------------------------------------------------

test("the summary reports zero buckets explicitly rather than omitting them", () => {
  const s = summariseQuality([classifyBriefQuality(brief({}), NOW)]);
  assert.equal(s.total, 1);
  for (const state of BRIEF_QUALITY_STATES) {
    assert.equal(typeof s.counts[state], "number", `${state} must be present even at zero`);
  }
  assert.equal(s.counts.duplicate_risk, 0);
  assert.equal(s.counts.insufficient_evidence, 1);
});

test("summary counts add up to the total", () => {
  const verdicts = [
    brief({ title: "A vs B", briefKind: "comparison", hasDiscovery: false }),
    brief({}),
    brief({ verifiedFacts: ["a", "b"], sourceUrls: ["https://a.com/1", "https://b.com/2"] }),
    brief({ verifiedFacts: ["a"], sourceUrls: ["https://a.com/1", "https://b.com/2"] }),
  ].map((b) => classifyBriefQuality(b, NOW));

  const s = summariseQuality(verdicts);
  const summed = BRIEF_QUALITY_STATES.reduce((acc, st) => acc + s.counts[st], 0);
  assert.equal(summed, s.total);
  assert.equal(s.ownerQueueCount, 1);
});
