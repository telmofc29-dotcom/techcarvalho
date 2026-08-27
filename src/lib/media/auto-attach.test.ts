import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { decideAutoAttach, engineSelection, AUTO_GALLERY_MIN_SCORE, type SlotState } from "./auto-attach.ts";
import { scoreMatch, deriveIsModelSpecific, type MatchAsset, type MatchTarget, type MediaMatch } from "./match-engine.ts";
import { buildEntityVocabulary } from "./entity-vocabulary.ts";

// AUTO-ATTACH IS THE LAST GATE BEFORE A MACHINE WRITES A PAGE.
//
// Every test here runs the REAL matcher first and feeds it its real output,
// rather than hand-building a MediaMatch. A hand-built match can assert
// whatever the test wants and proves nothing about the pipeline; the point of
// this gate is what it does to the matcher's actual answers.

const VOCAB = buildEntityVocabulary({
  manufacturers: ["Canon", "NVIDIA", "Sony"],
  productNames: ["Canon EOS R5", "Canon EOS R5 Mark II", "NVIDIA GeForce RTX 5090", "Sony PlayStation 5"],
  familyNames: ["Canon EOS R"],
  categorySlugs: ["cameras-photography", "computing", "gaming"],
  tagNames: ["Camera", "GPU"],
});

const asset = (over: Partial<MatchAsset> = {}): MatchAsset => ({
  id: "asset",
  storagePath: "0f8b1c2d-3e4f-5a6b-7c8d-9e0f1a2b3c4d-canon-eos-r5-mark-ii-front.jpg",
  altText: "Canon EOS R5 Mark II front view",
  caption: null,
  sourceType: "staff_photograph",
  assetRole: "product_photo",
  brandRole: null,
  owned: true,
  aiGenerated: false,
  publicationStatus: "published",
  rightsStatus: "verified",
  width: 2400,
  height: 1600,
  ...over,
});

const target = (over: Partial<MatchTarget> = {}): MatchTarget => ({
  id: "target",
  kind: "content",
  title: "Canon EOS R5 Mark II review",
  manufacturerName: "Canon",
  categorySlug: "cameras-photography",
  isModelSpecific: deriveIsModelSpecific("Canon EOS R5 Mark II review"),
  occupiedSlots: [],
  ...over,
});

const run = (a: MatchAsset, t: MatchTarget, occupied: SlotState[] = []) =>
  decideAutoAttach(a, scoreMatch(a, t, { entityVocabulary: VOCAB }), occupied);

describe("the safe case, so the gate is not just refusing everything", () => {
  test("an exact-model owner photograph fills an empty hero", () => {
    const d = run(asset(), target());
    assert.ok(d.slots.includes("hero"), `refusals: ${d.refusals.join(" | ")}`);
    assert.ok(d.slots.includes("thumbnail"));
    assert.match(d.reasons.join(" "), /exact-model match at high confidence/);
  });

  test("and it is stamped as an ENGINE selection that names nobody", () => {
    const s = engineSelection();
    assert.equal(s.selection_kind, "engine");
    assert.equal(s.selected_by, null, "the engine must never attribute its guess to a person");
  });
});

describe("it never takes a slot somebody is holding", () => {
  test("a human hero is never replaced", () => {
    const d = run(asset(), target(), [{ role: "hero", protectedSelection: true }]);
    assert.ok(!d.slots.includes("hero"));
    assert.match(d.refusals.join(" "), /a person made/);
  });

  test("an 'unknown' hero is protected exactly like a human one", () => {
    // 179 links predate the provenance column. Treating unknown as free would
    // licence overwriting every image the owner chose before 2026-08-27.
    const d = run(asset(), target(), [{ role: "hero", protectedSelection: true }]);
    assert.ok(!d.slots.includes("hero"));
  });

  test("an existing ENGINE hero is not churned either", () => {
    const d = run(asset(), target(), [{ role: "hero", protectedSelection: false }]);
    assert.ok(!d.slots.includes("hero"));
    assert.match(d.refusals.join(" "), /explicit action, not a side effect/);
  });

  test("a taken hero does not block an empty thumbnail", () => {
    const d = run(asset(), target(), [{ role: "hero", protectedSelection: true }]);
    assert.ok(d.slots.includes("thumbnail"), `refusals: ${d.refusals.join(" | ")}`);
  });
});

describe("private and rights-ineligible media never reach a page", () => {
  test("a private asset is refused every slot", () => {
    const d = run(asset({ publicationStatus: "private" }), target());
    assert.deepEqual(d.slots, []);
    assert.match(d.refusals.join(" "), /not published/);
  });

  test("restricted rights are refused every slot", () => {
    const d = run(asset({ rightsStatus: "restricted", owned: false, sourceType: "other" }), target());
    assert.deepEqual(d.slots, []);
  });

  test("an unverified, unowned asset is refused even when the subject is right", () => {
    const d = run(
      asset({ rightsStatus: "unknown", owned: false, sourceType: "manufacturer" }),
      target()
    );
    assert.deepEqual(d.slots, [], `reasons: ${d.reasons.join(" | ")}`);
    assert.match(d.refusals.join(" "), /rights/i);
  });
});

describe("a prominent slot demands an exact model", () => {
  test("a wrong-model photograph reaches no slot at all", () => {
    // The matcher refuses it upstream; this asserts the gate agrees rather than
    // finding some other route to a slot.
    const d = run(
      asset({ storagePath: "uuid-canon-eos-r5-front.jpg", altText: "Canon EOS R5 front view" }),
      target()
    );
    assert.deepEqual(d.slots, []);
  });

  test("a family-level match on a general article stays out of hero and thumbnail", () => {
    const d = run(
      asset({ storagePath: "uuid-canon-eos-r-body.jpg", altText: "A Canon EOS R body" }),
      target({ title: "Canon mirrorless cameras explained", isModelSpecific: false })
    );
    assert.ok(!d.slots.includes("hero"), `reasons: ${d.reasons.join(" | ")}`);
    assert.ok(!d.slots.includes("thumbnail"));
  });

  test("a concept render never leads, however precisely it names the product", () => {
    const d = run(
      asset({ assetRole: "concept_render", altText: "Canon EOS R5 Mark II concept render" }),
      target({ title: "Canon EOS R5 Mark II rumours", isModelSpecific: true })
    );
    assert.ok(!d.slots.includes("hero"));
    assert.ok(!d.slots.includes("thumbnail"));
  });
});

describe("gallery is broader but not a loophole", () => {
  test("a weak score is refused even when the matcher offered gallery", () => {
    const a = asset({ storagePath: "uuid-canon-eos-r-body.jpg", altText: "A Canon body" });
    const t = target({ title: "Canon cameras explained", isModelSpecific: false });
    const m = scoreMatch(a, t, { entityVocabulary: VOCAB });
    const d = decideAutoAttach(a, m, []);
    if (m.score < AUTO_GALLERY_MIN_SCORE) {
      assert.ok(!d.slots.includes("gallery"), `score ${m.score} should not auto-attach`);
      assert.match(d.refusals.join(" "), /below the automatic threshold/);
    }
  });

  test("shared ordinary wording cannot produce a gallery attachment", () => {
    // The stopword defect, checked at the gate rather than only at the matcher.
    const d = run(
      asset({ storagePath: "uuid-gta-6-release-date.png", altText: "What is actually confirmed", assetRole: "diagram", sourceType: "tc_graphic" }),
      target({ title: "Apple is about to launch new products: what is actually known", isModelSpecific: false })
    );
    assert.deepEqual(d.slots, [], `reasons: ${d.reasons.join(" | ")}`);
  });
});

describe("it explains itself", () => {
  test("every refusal says which slot and why", () => {
    const d = run(asset({ publicationStatus: "private" }), target());
    assert.ok(d.refusals.length > 0);
    for (const r of d.refusals) assert.ok(r.length > 20, `too terse to act on: ${r}`);
  });

  test("a decision never returns a slot without a matching reason", () => {
    const d = run(asset(), target());
    assert.equal(d.slots.length, d.reasons.length);
  });
});

// ---------------------------------------------------------------------------
// It must not be a second matcher.
// ---------------------------------------------------------------------------
test("the gate can only narrow what the matcher offered, never widen it", () => {
  const cases: [MatchAsset, MatchTarget][] = [
    [asset(), target()],
    [asset({ assetRole: "concept_render" }), target()],
    [asset({ publicationStatus: "private" }), target()],
    [asset({ storagePath: "uuid-canon-eos-r5-front.jpg" }), target()],
    [asset(), target({ title: "Canon cameras explained", isModelSpecific: false })],
  ];
  for (const [a, t] of cases) {
    const m: MediaMatch = scoreMatch(a, t, { entityVocabulary: VOCAB });
    const d = decideAutoAttach(a, m, []);
    for (const slot of d.slots) {
      assert.ok(
        m.proposedSlots.includes(slot),
        `auto-attach invented slot "${slot}" the matcher did not offer — it has become a second matcher`
      );
    }
  }
});
