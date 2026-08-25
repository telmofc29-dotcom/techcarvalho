import { test } from "node:test";
import assert from "node:assert/strict";
import { sameDevelopment, productTokens, developmentKind } from "./same-development.ts";

test("the Mac mini cluster collapses", () => {
  // Four live drafts describing one announcement. They share almost no
  // vocabulary, so word-overlap similarity could never catch them.
  const cluster = [
    "New Mac mini could launch before Apple’s September event",
    "Apple announces updated Mac mini, here's everything",
    "Apple Announces New Mac Mini With M6 and M5",
    "Apple Mac Mini M6 and Mac Studio M5 Ultra: Specs, Price, Release",
  ];
  for (let i = 1; i < cluster.length; i++) {
    const r = sameDevelopment(cluster[0], cluster[i]);
    assert.equal(r.same, true, `${cluster[i]} -> ${r.reason}`);
  }
});

test("same product, different kind of development, stays separate", () => {
  // This is what stops the fix from over-collapsing.
  const r = sameDevelopment(
    "Apple Announces New Mac Mini With M6",
    "Mac mini price rises across the range"
  );
  assert.equal(r.same, false);
  assert.match(r.reason, /different kinds/);
});

test("different products are never the same development", () => {
  assert.equal(sameDevelopment("Apple announces Mac Studio", "Apple announces iPhone 18 Pro").same, false);
  assert.equal(sameDevelopment("Elegoo launches Nexprint", "Bambu Lab launches PLA Pure filament").same, false);
});

test("the X vs Y comparison protection is preserved", () => {
  // Deleting one of these would destroy real work.
  const r = sameDevelopment(
    "Canon EOS 6D vs Canon EOS 6D Mark II",
    "Canon EOS 60D vs Canon EOS 6D Mark II"
  );
  assert.equal(r.same, false, r.reason);

  const identical = sameDevelopment(
    "Canon EOS 6D vs Canon EOS 6D Mark II",
    "canon eos 6d vs canon eos 6d mark ii"
  );
  assert.equal(identical.same, true);
});

test("a comparison never merges with a plain announcement", () => {
  assert.equal(
    sameDevelopment("Canon EOS R5 vs Canon EOS R6", "Canon announces the EOS R5").same,
    false
  );
});

test("product tokens identify the product, not the company", () => {
  const t = productTokens("Apple Announces New Mac Mini With M6 and M5");
  assert.ok(t.has("mac") && t.has("mini"), [...t].join("|"));
  assert.ok(t.has("m6"), [...t].join("|"));
  assert.ok(!t.has("apple"));
});

test("two stories about one company do not collapse on the company name", () => {
  // Without the company-name exclusion, everything from one maker merges.
  const r = sameDevelopment("Apple announces a new service", "Apple announces a new programme");
  assert.equal(r.same, false, r.reason);
});

test("a collapse always explains itself", () => {
  const r = sameDevelopment("Apple Announces New Mac Mini With M6", "Apple announces updated Mac mini");
  assert.equal(r.same, true);
  assert.ok(r.reason.includes("mac") && r.reason.includes("mini"), r.reason);
  assert.equal(developmentKind("Apple Announces New Mac Mini"), "launch");
});

test("two products that share only qualifiers are not one story", () => {
  // Real false positive: these share exactly {mini, ultra} and are unrelated
  // products from unrelated companies.
  const r = sameDevelopment(
    "Acemagic Launches F2A Mini PC With Intel Core Ultra",
    "Apple Mac Mini M6 and Mac Studio M5 Ultra: Specs, Price, Release"
  );
  assert.equal(r.same, false, r.reason);
  assert.match(r.reason, /only qualifiers/);
});

test("qualifiers still distinguish products when kept as tokens", () => {
  // "mini" must remain a token — it is the only thing separating these two —
  // even though it cannot carry a match alone.
  const r = sameDevelopment("Apple announces Mac mini", "Apple announces Mac Studio");
  assert.equal(r.same, false, r.reason);
});

test("a company name plus a category word is not an identification", () => {
  // Real merge: a filament launch and a software platform launch, collapsed on
  // {elegoo, 3d}. In a 3D-printing section every story says "3D".
  const r = sameDevelopment(
    "Elegoo Launches Fiber-Reinforced Filament Series for Stronger, Smarter, More Versatile FDM 3D Printing",
    "Elegoo Launches Nexprint, a 3D Model Platform for Global Creators"
  );
  assert.equal(r.same, false, r.reason);
});

test("two reports of one product launch still collapse", () => {
  // The guard above must not stop the real duplicates from merging.
  const r = sameDevelopment(
    "Elegoo Launches Nexprint Million-Dollar Creator Fund to Reward Original Content",
    "Elegoo Launches Nexprint, a 3D Model Platform for Global Creators"
  );
  assert.equal(r.same, true, r.reason);
  assert.ok(r.sharedProducts.includes("nexprint"));
});
