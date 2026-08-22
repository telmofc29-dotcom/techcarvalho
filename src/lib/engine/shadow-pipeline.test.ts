import { test } from "node:test";
import assert from "node:assert/strict";
import {
  runShadowPipeline,
  isCitableUrl,
  verifyStructurallyRenderable,
  findEmptySections,
  type ShadowCandidate,
  type ShadowContext,
  type ShadowEvidence,
} from "./shadow-pipeline.ts";
import { SHADOW_STAGES } from "./shadow-decision.ts";
import { detectSourceConflicts, buildSourceIndex, buildShadowCandidate, hostOf, type RawSourceRow } from "./shadow-io.ts";

const NOW = "2026-08-22T12:00:00.000Z";
const RECENT = "2026-08-21T12:00:00.000Z";

const evidence = (over: Partial<ShadowEvidence> = {}): ShadowEvidence => ({
  id: "ev-1",
  url: "https://www.anandtech.com/show/1234",
  publisher: "AnandTech",
  organisation: "AnandTech",
  excerpt: "The specification adds support for longer active cables.",
  claimStatus: "confirmed_primary",
  trustLevel: "primary",
  originatesFromUrl: null,
  retrievedAt: RECENT,
  sourceType: "trusted_editorial",
  registry: {
    discoveryPermitted: true,
    mediaRepublicationPermitted: false,
    mediaRightsStatus: "unverified",
    attributionRequired: false,
    editorialUseOnly: false,
    registrationRequired: false,
    organisation: "AnandTech",
  },
  ...over,
});

const candidate = (over: Partial<ShadowCandidate> = {}): ShadowCandidate => ({
  kind: "discovery",
  id: "disc-1",
  dedupeKey: "vesa-displayport-active-cable",
  title: "VESA to update DisplayPort 2.1 with a new active cable specification",
  summary: "The standard adds support for cables up to three times longer at full bandwidth.",
  discoveryType: "spec_change",
  categorySlug: "computing",
  claimStatus: "confirmed_primary",
  state: "discovered",
  sightingCount: 2,
  firstSeenAt: RECENT,
  relevanceOverriddenByAdmin: false,
  evidence: [evidence()],
  mediaCandidates: [],
  conflicts: [],
  ...over,
});

const context = (over: Partial<ShadowContext> = {}): ShadowContext => ({
  now: NOW,
  existingContent: [
    { id: "content-1", title: "Understanding DisplayPort bandwidth", primary_query: "displayport bandwidth", intent_fingerprint: "guide:computing" },
  ],
  existingEntities: [
    { kind: "content", id: "content-1", name: "Understanding DisplayPort bandwidth", slug: "understanding-displayport-bandwidth", isPublished: true },
    { kind: "product", id: "product-1", name: "Canon EOS R5", slug: "canon-eos-r5", isPublished: true },
  ],
  linkCandidates: [{ id: "content-1", title: "Understanding DisplayPort bandwidth", categoryId: "computing", type: "guide" }],
  takenSlugs: new Set(["understanding-displayport-bandwidth", "canon-eos-r5"]),
  manufacturers: [{ slug: "canon", name: "Canon" }],
  opportunityInputs: null,
  requiresHeroMedia: true,
  ...over,
});

// ---------------------------------------------------------------------------
// The pipeline actually reaches the end
// ---------------------------------------------------------------------------

test("a well-formed candidate runs all fifteen stages and reaches the publication gate", () => {
  const record = runShadowPipeline(candidate(), context());
  assert.equal(record.decision.kind, "decision", record.decision.explanation);
  assert.equal(record.decision.reachedGate, true, "the expensive stages must actually run");
  assert.equal(record.decision.terminalStage, "final_decision");

  const notReached = record.decision.stages.filter((s) => s.status === "not_reached");
  assert.deepEqual(notReached, [], "no stage may be skipped on a candidate that reaches the gate");
  assert.equal(record.decision.stages.length, SHADOW_STAGES.length);
  assert.ok(record.gate, "the gate verdict is recorded, per dimension");
  assert.ok(record.gate!.dimensions.length >= 7);
});

test("the record carries a decision, its reasons and its blockers", () => {
  const record = runShadowPipeline(candidate(), context());
  assert.ok(record.decision.reasons.length > 0, "a decision with no stated reasons is not evidence");
  for (const reason of record.decision.reasons) {
    assert.ok(reason.code.length > 0);
    assert.ok(reason.message.length > 0);
    assert.ok(SHADOW_STAGES.includes(reason.stage), `reason attributed to unknown stage ${reason.stage}`);
  }
});

// ---------------------------------------------------------------------------
// Fail-closed behaviour
// ---------------------------------------------------------------------------

test("a candidate whose sources are not permitted for discovery is rejected at stage one", () => {
  const record = runShadowPipeline(
    candidate({
      evidence: [evidence({ registry: { ...evidence().registry!, discoveryPermitted: false } })],
    }),
    context()
  );
  assert.equal(record.decision.outcome, "WOULD_REJECT");
  assert.equal(record.decision.terminalStage, "discovery");
  assert.equal(record.decision.reachedGate, false);
  assert.ok(record.decision.reasons.some((r) => r.code === "source_not_permitted"));
});

test("a candidate with no evidence at all is rejected — nothing is traceable", () => {
  const record = runShadowPipeline(candidate({ evidence: [] }), context());
  assert.equal(record.decision.outcome, "WOULD_REJECT");
  assert.ok(record.decision.reasons.some((r) => r.code === "no_origin"));
});

test("an off-topic candidate is rejected at relevance, and that is a cheap decision", () => {
  const record = runShadowPipeline(
    candidate({
      title: "Wrexham AFC and Firefox announce a multi-year front-of-kit partnership",
      summary: "A football sponsorship deal.",
      dedupeKey: "wrexham-sponsorship",
    }),
    context()
  );
  assert.equal(record.decision.kind, "decision");
  assert.equal(record.decision.outcome, "WOULD_REJECT");
  assert.equal(record.decision.reachedGate, false, "composition must be able to see this was cheap");
});

test("shadow never claims a media credit renders, because it renders nothing", () => {
  const record = runShadowPipeline(
    candidate({
      mediaCandidates: [
        {
          id: "media-1",
          label: "hero.jpg",
          rightsStatus: "verified",
          owned: false,
          sourceType: "public_domain_or_cc",
          licence: "CC BY 4.0",
          attributionText: "Photo by Someone",
          sourceUrl: "https://commons.example.org/file",
          generatedUnlabelled: false,
          registry: null,
        },
      ],
    }),
    context()
  );
  assert.ok(
    record.decision.reasons.some((r) => r.code === "credit_render_unproven"),
    "a licence requiring a rendered credit must never be recorded as satisfied by shadow"
  );
  assert.notEqual(record.decision.outcome, "WOULD_PUBLISH");
});

test("an engine-assembled body is never publishable — it is scaffolding by design", () => {
  const record = runShadowPipeline(candidate(), context());
  const codes = record.decision.reasons.map((r) => r.code);
  assert.ok(
    codes.includes("placeholder_text") || codes.includes("unfinished_assembly"),
    "the assembly markers must be caught rather than shipped"
  );
  assert.equal(record.decision.outcome, "WOULD_REJECT");
});

// ---------------------------------------------------------------------------
// The pipeline never throws
// ---------------------------------------------------------------------------

test("malformed input produces a record rather than an exception", () => {
  const broken = candidate({
    title: "",
    dedupeKey: "",
    summary: null,
    firstSeenAt: "not-a-date",
    evidence: [evidence({ url: "not a url", retrievedAt: "nonsense" })],
  });
  const record = runShadowPipeline(broken, context());
  assert.ok(record.decision.kind === "decision" || record.decision.kind === "failure");
  assert.ok(record.identity.length > 0);
});

test("a decision is reproducible — same inputs, same outcome", () => {
  const c = candidate();
  const ctx = context();
  const a = runShadowPipeline(c, ctx);
  const b = runShadowPipeline(c, ctx);
  assert.equal(a.decision.outcome, b.decision.outcome);
  assert.deepEqual(a.dimensions, b.dimensions);
  assert.deepEqual(
    a.decision.reasons.map((r) => r.code).sort(),
    b.decision.reasons.map((r) => r.code).sort()
  );
});

test("identity comes from the candidate, not from when it ran", () => {
  const c = candidate();
  const a = runShadowPipeline(c, context({ now: "2026-08-22T00:00:00.000Z" }));
  const b = runShadowPipeline(c, context({ now: "2026-12-25T00:00:00.000Z" }));
  assert.equal(a.identity, b.identity, "running again next year must not mint a new identity");
});

// ---------------------------------------------------------------------------
// Composition signals come from stages that ran
// ---------------------------------------------------------------------------

test("a single-source candidate is classified sparse_source", () => {
  const record = runShadowPipeline(candidate(), context());
  assert.ok(record.dimensions.includes("sparse_source"));
});

test("a candidate needing a hero with nothing cleared is media_impossible", () => {
  const record = runShadowPipeline(candidate({ mediaCandidates: [] }), context({ requiresHeroMedia: true }));
  assert.ok(record.dimensions.includes("media_impossible"));
  assert.ok(!record.dimensions.includes("media_rich"));
});

// ---------------------------------------------------------------------------
// Small deterministic checks
// ---------------------------------------------------------------------------

test("only resolvable http(s) URLs are citable", () => {
  assert.equal(isCitableUrl("https://example.com/a"), true);
  assert.equal(isCitableUrl("http://example.co.uk"), true);
  assert.equal(isCitableUrl("javascript:alert(1)"), false);
  assert.equal(isCitableUrl("not a url"), false);
  assert.equal(isCitableUrl("https://localhost"), false, "no dot means nothing a reader can reach");
});

test("structural render verification catches an unclosed comment", () => {
  const bad = verifyStructurallyRenderable({
    body: "<!-- editor note\n## Heading\nSome text",
    metaTitle: "Title",
    slug: "a-slug",
  });
  assert.equal(bad.ok, false);
  assert.ok(bad.problems.some((p) => p.includes("comment")));
});

test("structural render verification catches a heading level jump and a bad slug", () => {
  const jump = verifyStructurallyRenderable({ body: "## Two\n\ntext\n\n#### Four\n\ntext", metaTitle: "T", slug: "ok-slug" });
  assert.equal(jump.ok, false);
  const slug = verifyStructurallyRenderable({ body: "## Two\n\ntext", metaTitle: "T", slug: "Not A Slug" });
  assert.equal(slug.ok, false);
});

test("a heading with only an editor placeholder under it counts as empty", () => {
  const body = "## Written\n\nReal prose here.\n\n## Not written\n\n_[Write this section. Use only the evidence above.]_\n";
  assert.deepEqual(findEmptySections(body), ["Not written"]);
});

// ---------------------------------------------------------------------------
// Source conflict detection
// ---------------------------------------------------------------------------

test("two sources asserting different prices is a detected conflict", () => {
  const conflicts = detectSourceConflicts([
    evidence({ id: "a", excerpt: "The camera will cost £4,299 at launch." }),
    evidence({ id: "b", excerpt: "Pricing is set at £3,899 in the UK." }),
  ]);
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].domain, "vendor_own_price");
  assert.equal(conflicts[0].assertions.length, 2);
});

test("agreement is not a conflict", () => {
  const conflicts = detectSourceConflicts([
    evidence({ id: "a", excerpt: "The camera will cost £4,299 at launch." }),
    evidence({ id: "b", excerpt: "It is priced at £4,299." }),
  ]);
  assert.deepEqual(conflicts, []);
});

test("with no excerpts, no conflict is reported — and none is invented either way", () => {
  const conflicts = detectSourceConflicts([evidence({ id: "a", excerpt: null }), evidence({ id: "b", excerpt: null })]);
  assert.deepEqual(conflicts, [], "silence about disagreement is not a claim that sources agree");
});

// ---------------------------------------------------------------------------
// Provenance recovery — compensating for engine_discovery_evidence.source_id
// being NULL on every row in production (see buildSourceIndex).
// ---------------------------------------------------------------------------

const source = (over: Partial<RawSourceRow> = {}): RawSourceRow => ({
  id: "src-1",
  url: "https://blog.mozilla.org/en/feed/",
  organisation: "Mozilla",
  source_type: "manufacturer_newsroom",
  discovery_permitted: true,
  media_republication_permitted: false,
  media_rights_status: "unverified",
  attribution_required: false,
  editorial_use_only: false,
  registration_required: false,
  ...over,
});

const orphanEvidence = (url: string): Parameters<typeof buildShadowCandidate>[1][number] => ({
  id: "ev-1",
  url,
  publisher: "Mozilla",
  organisation: null,
  excerpt: null,
  claim_status: "confirmed_primary",
  trust_level: "primary",
  originates_from_url: null,
  retrieved_at: RECENT,
  source_type: null,
  discovery_permitted: null,
  media_republication_permitted: null,
  media_rights_status: null,
  attribution_required: null,
  editorial_use_only: null,
  registration_required: null,
});

const rawCandidate = {
  id: "disc-1",
  dedupe_key: "mozilla-thing",
  title: "Firefox adds a new privacy control for tracking protection",
  summary: "A change to how tracking protection works.",
  discovery_type: "product_update",
  category_slug: "computing",
  claim_status: "confirmed_primary",
  state: "discovered",
  sighting_count: 1,
  first_seen_at: RECENT,
  relevance_overridden_by_admin: false,
  product_id: null,
  content_id: null,
};

test("an evidence row with no source_id is resolved by host against the registry", () => {
  const index = buildSourceIndex([source()]);
  const built = buildShadowCandidate(rawCandidate, [orphanEvidence("https://blog.mozilla.org/en/products/firefox/x/")], [], index);
  assert.equal(built.evidence[0].registry?.discoveryPermitted, true);
  assert.equal(built.evidence[0].registry?.organisation, "Mozilla");
});

test("an unmatched host stays unknown, and unknown is not permitted", () => {
  const index = buildSourceIndex([source()]);
  const built = buildShadowCandidate(rawCandidate, [orphanEvidence("https://random-blog.example.com/post")], [], index);
  assert.equal(built.evidence[0].registry?.discoveryPermitted, false, "the fallback must fail closed");
  const record = runShadowPipeline(built, context());
  assert.equal(record.decision.outcome, "WOULD_REJECT");
  assert.equal(record.decision.terminalStage, "discovery");
});

test("where two registry rows share a host, the more restrictive one wins", () => {
  const index = buildSourceIndex([
    source({ id: "a", discovery_permitted: true }),
    source({ id: "b", discovery_permitted: false }),
  ]);
  assert.equal(index.get("blog.mozilla.org")?.discovery_permitted, false, "a duplicate row must not become a way to grant access");
});

test("host extraction strips www and lower-cases", () => {
  assert.equal(hostOf("https://WWW.Example.COM/a"), "example.com");
  assert.equal(hostOf("not a url"), null);
  assert.equal(hostOf(null), null);
});

test("a joined registry is preferred over the host fallback", () => {
  const index = buildSourceIndex([source({ discovery_permitted: true })]);
  const joined = { ...orphanEvidence("https://blog.mozilla.org/x"), discovery_permitted: false };
  const built = buildShadowCandidate(rawCandidate, [joined], [], index);
  assert.equal(built.evidence[0].registry?.discoveryPermitted, false, "the real FK wins when it is present");
});
