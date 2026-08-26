import { test } from "node:test";
import assert from "node:assert/strict";
import { assessDeletion, type DeletionReferences } from "./deletion-safety.ts";

const NOTHING: DeletionReferences = {
  contentRoles: [],
  productRoles: [],
  ogReferences: 0,
  logoReferences: 0,
  requirementReferences: 0,
  derivatives: 0,
  engineCandidates: 0,
  publicationStatus: "private",
  exists: true,
  readFailures: [],
};

const refs = (over: Partial<DeletionReferences>): DeletionReferences => ({ ...NOTHING, ...over });

test("an unattached private asset may be deleted", () => {
  const a = assessDeletion("id", "orphan.jpg", NOTHING);
  assert.equal(a.blocked, false);
  assert.equal(a.reason, null);
});

test("an asset holding an article slot is refused, and the slot is named", () => {
  const a = assessDeletion("id", "hero.jpg", refs({ contentRoles: ["hero"] }));
  assert.equal(a.blocked, true);
  assert.match(a.reason!, /article slot/);
  assert.match(a.reason!, /hero/);
  assert.match(a.reason!, /Detach it first/);
});

test("an asset holding a product slot is refused", () => {
  const a = assessDeletion("id", "p.jpg", refs({ productRoles: ["gallery", "gallery"] }));
  assert.equal(a.blocked, true);
  assert.match(a.reason!, /2 product slots/);
});

// The SET NULL references are the dangerous ones: Postgres blanks them without
// error, so nothing downstream ever learns the image was removed.
for (const [field, phrase] of [
  ["ogReferences", /social-card/],
  ["logoReferences", /logo/],
  ["requirementReferences", /resolution of/],
] as [keyof DeletionReferences, RegExp][]) {
  test(`a SET NULL reference (${String(field)}) blocks deletion rather than being silently blanked`, () => {
    const a = assessDeletion("id", "x.jpg", refs({ [field]: 1 } as Partial<DeletionReferences>));
    assert.equal(a.blocked, true);
    assert.match(a.reason!, phrase);
    assert.match(a.reason!, /blanked without warning/);
  });
}

test("derivatives do NOT block — they exist because of this asset", () => {
  const a = assessDeletion("id", "x.jpg", refs({ derivatives: 3 }));
  assert.equal(a.blocked, false);
  assert.ok(a.relationships.some((r) => !r.blocking && /3 derived files/.test(r.label)));
});

test("a published asset is deletable but says so, because the public copy goes too", () => {
  const a = assessDeletion("id", "x.jpg", refs({ publicationStatus: "published" }));
  assert.equal(a.blocked, false);
  assert.ok(a.relationships.some((r) => /currently PUBLISHED/.test(r.label)));
});

// The failure this whole codebase is organised around: an errored query and an
// empty result must never be the same thing. Here they differ by whether a
// deletion is licensed.
test("a FAILED relationship read blocks deletion — an unknown graph is not an empty one", () => {
  const a = assessDeletion("id", "x.jpg", refs({ readFailures: ["content_media: permission denied"] }));
  assert.equal(a.blocked, true);
  assert.match(a.reason!, /could not complete/);
  assert.match(a.reason!, /permission denied/);
});

test("a read failure outranks a clean relationship list", () => {
  // Nothing came back from any table — which is exactly what a total failure
  // looks like if the failure itself is ignored.
  const a = assessDeletion("id", "x.jpg", refs({ readFailures: ["product_media: timeout"] }));
  assert.equal(a.blocked, true, "an empty-looking result from a failed read must not read as safe");
});

test("a missing row is refused rather than reported as deleted", () => {
  const a = assessDeletion("id", "gone.jpg", refs({ exists: false }));
  assert.equal(a.blocked, true);
  assert.match(a.reason!, /No such media asset/);
});

test("every blocking relationship appears in the reason, not just the first", () => {
  const a = assessDeletion("id", "x.jpg", refs({ contentRoles: ["hero"], logoReferences: 2 }));
  assert.match(a.reason!, /article slot/);
  assert.match(a.reason!, /logo/);
});
