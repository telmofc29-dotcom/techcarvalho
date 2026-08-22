import { test } from "node:test";
import assert from "node:assert/strict";
import { normaliseEntityName, entitySimilarity, resolveEntity, proposeSlug, MATCH_THRESHOLD, AMBIGUOUS_THRESHOLD } from "./entity-resolution.ts";

test("brand synonyms collapse to one canonical form", () => {
  const a = normaliseEntityName("Sony PlayStation 5 Pro");
  const b = normaliseEntityName("PS5 Pro");
  assert.ok(entitySimilarity("Sony PlayStation 5 Pro", "PS5 Pro") >= 0.8, `${a} vs ${b}`);
});

test("marketing noise does not affect matching", () => {
  assert.ok(entitySimilarity("The new Canon EOS R5 is officially announced", "Canon EOS R5") >= 0.8);
});

test("genuinely different products do not match", () => {
  assert.ok(entitySimilarity("Canon EOS R5", "Canon EOS R6") < 0.8);
  assert.ok(entitySimilarity("PlayStation 5 Pro", "Xbox Series X") < 0.5);
});

test("mark/mk variants resolve together", () => {
  assert.ok(entitySimilarity("Canon EOS 6D Mark II", "Canon EOS 6D mk II") >= 0.8);
});

const existing = [
  { kind: "product" as const, id: "p1", name: "Canon EOS R5" },
  { kind: "product" as const, id: "p2", name: "Sony PlayStation 5 Pro" },
  { kind: "content" as const, id: "c1", name: "Mesh Wi-Fi vs a Single Router" },
];

test("an existing product is matched, not duplicated", () => {
  const r = resolveEntity("PS5 Pro", existing);
  assert.equal(r.decision, "matched_existing");
  assert.equal(r.matchedId, "p2");
  assert.ok(r.explanation.includes("rather than creating a duplicate"));
});

test("a genuinely new product is treated as new", () => {
  const r = resolveEntity("Framework Laptop 16", existing);
  assert.equal(r.decision, "new_entity");
});

test("a successor is never merged into its predecessor", () => {
  // Regression: containment-biased scoring alone rated this 1.00 against
  // "Canon EOS R5", which would have silently destroyed the successor.
  assert.ok(entitySimilarity("Canon EOS R5 Mark II", "Canon EOS R5") < 0.55);
  assert.equal(resolveEntity("Canon EOS R5 Mark II", existing).decision, "new_entity");
});

test("model numbers must match — R5 is not R6, 5080 is not 5090", () => {
  assert.ok(entitySimilarity("Canon EOS R5", "Canon EOS R6") < 0.55);
  assert.ok(entitySimilarity("GeForce RTX 5080", "GeForce RTX 5090") < 0.55);
});

test("variant tokens must match — a Pro is not a base model", () => {
  assert.ok(entitySimilarity("PlayStation 5 Pro", "PlayStation 5") < 0.55);
  assert.ok(entitySimilarity("Galaxy S26 Ultra", "Galaxy S26") < 0.55);
});

test("empty/noise-only names are ignored rather than creating junk", () => {
  const r = resolveEntity("The new官", existing);
  assert.ok(r.decision === "ignored" || r.decision === "new_entity");
});

test("every resolution carries an explanation", () => {
  for (const name of ["PS5 Pro", "Framework Laptop 16", "Canon EOS R5"]) {
    assert.ok(resolveEntity(name, existing).explanation.length > 20);
  }
});

test("proposeSlug avoids collisions", () => {
  const taken = new Set(["ps5-pro-review"]);
  assert.equal(proposeSlug("PS5 Pro Review", taken), "ps5-pro-review-2");
  assert.equal(proposeSlug("Brand New Topic", taken), "brand-new-topic");
});

// --- REGRESSION: bare-numeric successors (found 2026-08-22 by an adversarial
// --- review of the resolver, after the Mark II fix was believed complete) ---
//
// The Mark II guard only ever handled WORD-shaped discriminators. A successor
// whose predecessor carries no digit at all scored 1.00 and resolved to
// matched_existing — silently overwriting the predecessor's product row.
test("a bare generation number is not the same product as its predecessor", () => {
  const cases: [string, string][] = [
    ["Nintendo Switch 2", "Nintendo Switch"],
    ["Apple Vision Pro 2", "Apple Vision Pro"],
    ["Steam Deck 2", "Steam Deck"],
    ["Framework Laptop 16", "Framework Laptop"],
  ];
  for (const [successor, predecessor] of cases) {
    const s = entitySimilarity(successor, predecessor);
    assert.ok(s < 0.55, `"${successor}" vs "${predecessor}" scored ${s.toFixed(2)} — would merge`);
    const r = resolveEntity(successor, [{ kind: "product", id: "p1", name: predecessor }]);
    assert.notEqual(r.decision, "matched_existing", `${successor} must not merge into ${predecessor}`);
  }
});

test("an incidental spec number in a headline still matches the product", () => {
  // The other side of the same rule: "8K" is a specification mentioned in
  // passing, not a generation marker, and must not block resolution.
  for (const headline of [
    "Canon EOS R5 gets 8K firmware update",
    "Canon EOS R5 hits 45MP burst milestone",
  ]) {
    const s = entitySimilarity(headline, "Canon EOS R5");
    assert.ok(s >= 0.8, `"${headline}" scored ${s.toFixed(2)} — should still match the R5`);
  }
});

// ---------------------------------------------------------------------------
// ADVERSARIAL SUITE (Autonomous Engine Hardening, 2026-08-22)
//
// Entity resolution is the single point where a mistake silently DESTROYS
// data: a successor merged into its predecessor overwrites a real product row
// and nothing raises an error. Two such bugs have already shipped here — the
// Canon EOS R5 Mark II containment bug, and the bare-numeric Nintendo Switch 2
// bug that the first fix did not cover.
//
// Both directions are tested on purpose. A resolver tuned only against
// false positives becomes uselessly strict, and a resolver that never matches
// anything creates duplicates instead of overwrites — a different failure with
// the same root cause.
// ---------------------------------------------------------------------------

test("ADVERSARIAL: near-identical names that must NOT resolve to each other", () => {
  const pairs: [string, string][] = [
    // Generation markers
    ["Nintendo Switch", "Nintendo Switch 2"],
    ["Canon EOS R5", "Canon EOS R5 Mark II"],
    ["Canon EOS 6D", "Canon EOS 6D Mark II"],
    // Variant suffixes
    ["PS5", "PS5 Pro"],
    ["Sony PlayStation 5", "Sony PlayStation 5 Pro"],
    ["iPhone 17", "iPhone 17 Pro"],
    ["Galaxy S26", "Galaxy S26 Ultra"],
    // Adjacent model numbers in one family
    ["RTX 5080", "RTX 5090"],
    ["NVIDIA GeForce RTX 5080", "NVIDIA GeForce RTX 5090"],
    ["AMD Ryzen 9 9950X", "AMD Ryzen 7 9800X3D"],
    // A digit-vs-alphanumeric trap: "4 Pro" and "4K" are different products,
    // and "4K" would otherwise read as an incidental specification.
    ["DJI Mini 4 Pro", "DJI Mini 4K"],
    // Single-letter suffix carrying the whole distinction
    ["Xbox Series X", "Xbox Series S"],
    // Standards generations, where the suffix is the entire difference
    ["Wi-Fi 6", "Wi-Fi 6E"],
    ["Wi-Fi 6E", "Wi-Fi 7"],
    ["Wi-Fi 6", "Wi-Fi 7"],
  ];
  for (const [a, b] of pairs) {
    const s = entitySimilarity(a, b);
    assert.ok(s < AMBIGUOUS_THRESHOLD, `"${a}" vs "${b}" scored ${s.toFixed(2)} — would merge or be held as ambiguous`);
  }
});

test("ADVERSARIAL: the same product written differently MUST still resolve", () => {
  // False-negative pressure. Over-strictness creates duplicate catalogue rows
  // rather than overwrites, which is a quieter failure but still a failure.
  const pairs: [string, string][] = [
    ["PS5 Pro", "Sony PlayStation 5 Pro"],
    ["Nintendo Switch 2", "Switch 2"],
    ["NVIDIA GeForce RTX 5090", "RTX 5090"],
    ["Canon EOS 6D Mark II", "Canon EOS 6D mk II"],
    // A headline wrapping the product name
    ["Canon EOS R5", "The Canon EOS R5 review: still the one to beat"],
    // An incidental spec in the headline is not a generation marker
    ["Canon EOS R5", "Canon EOS R5 gets 8K firmware update"],
  ];
  for (const [a, b] of pairs) {
    const s = entitySimilarity(a, b);
    assert.ok(s >= MATCH_THRESHOLD, `"${a}" vs "${b}" scored ${s.toFixed(2)} — would create a duplicate`);
  }
});

test("ADVERSARIAL: similarity is symmetric", () => {
  // An asymmetric resolver would decide differently depending on which row the
  // scan happened to reach first — a race disguised as a judgement.
  const pairs: [string, string][] = [
    ["Nintendo Switch", "Nintendo Switch 2"],
    ["PS5 Pro", "Sony PlayStation 5 Pro"],
    ["Wi-Fi 6", "Wi-Fi 6E"],
    ["Canon EOS R5", "Canon EOS R5 gets 8K firmware update"],
  ];
  for (const [a, b] of pairs) {
    assert.equal(entitySimilarity(a, b), entitySimilarity(b, a), `${a} <-> ${b}`);
  }
});

// ===========================================================================
// STRICTNESS SWEEP (2026-08-22)
//
// Everything below was written to BREAK the resolver rather than to describe
// it, and three of the four sections below did break it. The bugs each found
// are named in the test that now pins them.
//
// The organising principle, stated once: a large number of shared tokens is
// not evidence that the exact product was found. Four matching family words
// out of five say "same family", never "same product". Wrong-product identity
// must fail CLOSED.
// ===========================================================================

/** Both directions, every time. Order must never change a verdict. */
function bothWays(a: string, b: string): { ab: number; ba: number } {
  const ab = entitySimilarity(a, b);
  const ba = entitySimilarity(b, a);
  assert.equal(ab, ba, `ASYMMETRIC: "${a}" vs "${b}" scored ${ab.toFixed(2)} one way and ${ba.toFixed(2)} the other. ` +
    "The verdict would then depend on the order rows came back from the database.");
  return { ab, ba };
}

/** Neither name may resolve to the other, whichever is the catalogue row. */
function assertNotSameProduct(a: string, b: string, note = "") {
  const { ab } = bothWays(a, b);
  assert.ok(
    ab < MATCH_THRESHOLD,
    `MERGE RISK: "${a}" vs "${b}" scored ${ab.toFixed(2)} >= ${MATCH_THRESHOLD}${note ? ` (${note})` : ""} — ` +
      "one of these products would silently overwrite the other."
  );
  for (const [candidate, catalogue] of [[a, b], [b, a]] as [string, string][]) {
    const r = resolveEntity(candidate, [{ kind: "product", id: "p1", name: catalogue }]);
    assert.notEqual(
      r.decision,
      "matched_existing",
      `"${candidate}" resolved onto existing "${catalogue}" at ${r.score.toFixed(2)}. ${r.explanation}`
    );
  }
}

/** These are one product and must not fragment into duplicate rows. */
function assertSameProduct(a: string, b: string) {
  const { ab } = bothWays(a, b);
  assert.ok(
    ab >= MATCH_THRESHOLD,
    `FALSE NEGATIVE: "${a}" vs "${b}" scored ${ab.toFixed(2)} < ${MATCH_THRESHOLD} — a duplicate row would be created.`
  );
  assert.equal(
    resolveEntity(a, [{ kind: "product", id: "p1", name: b }]).decision,
    "matched_existing",
    `"${a}" should resolve onto "${b}"`
  );
}

test("STRICTNESS: the named sibling pairs must never merge, in either direction", () => {
  const pairs: [string, string][] = [
    ["Canon EOS R5", "Canon EOS R5 Mark II"],
    ["Nintendo Switch", "Nintendo Switch 2"],
    ["PlayStation 5", "PlayStation 5 Pro"],
    ["PS5", "PS5 Pro"],
    ["NVIDIA RTX 5080", "NVIDIA RTX 5090"],
    ["RTX 5080", "RTX 5090"],
    ["RTX 5080", "RTX 5080 Ti"],
    ["RTX 5080", "RTX 5080 Super"],
    ["RTX 5080 Ti", "RTX 5080 Super"],
    ["RTX 5090", "RTX 5090 D"],
    ["DJI Mini 4 Pro", "DJI Mini 4K"],
    ["Xbox Series X", "Xbox Series S"],
    ["TP-Link Deco XE75", "TP-Link Deco BE85"],
    ["AMD Ryzen 7 9800X3D", "AMD Ryzen 7 9700X"],
    ["Intel Core Ultra 9 285K", "Intel Core Ultra 7 265K"],
  ];
  for (const [a, b] of pairs) assertNotSameProduct(a, b);
});

test("STRICTNESS: siblings still differ once the brand or family prefix is identical", () => {
  // The pairs above are easy in that the differing token is often the only
  // number present. These share strictly more, which is where the resolver's
  // containment bias does its damage.
  const pairs: [string, string][] = [
    ["Sony PlayStation 5", "Sony PlayStation 5 Pro"],
    ["NVIDIA GeForce RTX 5080", "NVIDIA GeForce RTX 5090"],
    ["TP-Link Deco XE75", "TP-Link Deco XE75 Pro"],
    ["Xbox Series X", "Xbox Series X Digital Edition"],
    ["Canon EOS R5 Mark II", "Canon EOS R6 Mark II"],
    ["Nintendo Switch 2", "Nintendo Switch Lite"],
    ["AMD Ryzen 7 9800X3D", "AMD Ryzen 9 9950X3D"],
  ];
  for (const [a, b] of pairs) assertNotSameProduct(a, b);
});

// -----------------------------------------------------------------------
// NEW BUG 1 (found and fixed 2026-08-22): an incidental SHARED number let a
// pair of genuinely different model numbers through.
//
// Guard "model numbers" only required that the two names share ONE
// digit-bearing token. "Intel Core Ultra 9 285K" and "Intel Core Ultra 9 265K"
// share the tier number 9, so the guard passed, and 285K/265K are alphanumeric
// so the bare-digit rule ignored them too. Four shared tokens out of five
// scored 0.80 — exactly MATCH_THRESHOLD — and the 265K resolved onto the 285K's
// row. Same shape merged the Deco X55 into the X50 and the EOS R6 into the R5.
// -----------------------------------------------------------------------
test("NEW BUG 1: a shared tier number is not evidence the model numbers agree", () => {
  const pairs: [string, string][] = [
    ["Intel Core Ultra 9 285K", "Intel Core Ultra 9 265K"],
    ["Intel Core Ultra 7 265K", "Intel Core Ultra 7 265KF"],
    ["Intel Core i9 14900K", "Intel Core i9 14700K"],
    ["AMD Ryzen 9 9950X3D", "AMD Ryzen 9 9900X3D"],
    ["TP-Link Deco X50 5G", "TP-Link Deco X55 5G"],
    // Both names carry the same lens; only the body differs.
    ["Canon EOS R5 with 24-70mm", "Canon EOS R6 with 24-70mm"],
    // Same generation number, different chassis.
    ["Samsung Galaxy Z Fold 7", "Samsung Galaxy Z Flip 7"],
    ["Sony Alpha 7 IV", "Sony Alpha 7 V"],
  ];
  for (const [a, b] of pairs) assertNotSameProduct(a, b, "shared family/tier token");
});

// -----------------------------------------------------------------------
// NEW BUG 2 (found and fixed 2026-08-22): the variant-word allow-list was the
// only thing standing between a base model and its own variant, and it is a
// closed list. Any variant word nobody had listed yet scored 1.00 through the
// containment bias — the exact mechanism of the original Mark II incident,
// with a different word in the slot.
// -----------------------------------------------------------------------
test("NEW BUG 2: an UNLISTED variant suffix must not merge into the base model", () => {
  const pairs: [string, string][] = [
    ["Google Pixel 10 Pro", "Google Pixel 10 Pro XL"],
    ["NVIDIA RTX 5080", "NVIDIA RTX 5080 FE"],
    ["Steam Deck", "Steam Deck OLED"],
    ["LG C5", "LG C5 OLED"],
    ["Apple Watch Series 11", "Apple Watch Series 11 Cellular"],
    ["iPad Pro 13", "iPad Pro 13 Nano"],
    ["Sonos Era 300", "Sonos Era 300 Gaming"],
    ["Framework Laptop 13", "Framework Laptop 13 Titanium"],
    ["Meta Quest 4", "Meta Quest 4 Lite"],
  ];
  for (const [a, b] of pairs) assertNotSameProduct(a, b, "unlisted variant suffix");
});

test("NEW BUG 2: a name nobody has listed a variant word for still fails CLOSED", () => {
  // The point of the structural guard: it must work for a variant word that
  // does not exist yet. If this ever starts passing at >= MATCH_THRESHOLD the
  // allow-list has become load-bearing again.
  for (const invented of ["Zeta", "Hyperline", "Quantum", "Vantage"]) {
    assertNotSameProduct("Acme Widget 7", `Acme Widget 7 ${invented}`, "invented variant word");
  }
});

// -----------------------------------------------------------------------
// NEW BUG 3 (found and fixed 2026-08-22): entitySimilarity was ASYMMETRIC.
// The model-number guard picked its "extra tokens" from whichever set was
// larger and broke the tie by argument order, so "Core Ultra 9 285K" vs
// "Core Ultra 9 285" scored 0.75 one way and 0.30 the other. Which one the
// engine got depended on the order existing rows were scanned.
// -----------------------------------------------------------------------
test("NEW BUG 3: scoring never depends on argument order", () => {
  const pairs: [string, string][] = [
    ["Core Ultra 9 285K", "Core Ultra 9 285"],
    ["Ryzen 5 7600", "Ryzen 5 7600X"],
    ["iPhone 16", "iPhone 16e"],
    ["RTX 5080", "RTX 5080 Ti"],
    ["Canon EOS R5", "Canon EOS R5 gets 8K firmware update"],
    ["PS5 Pro", "Sony PlayStation 5 Pro"],
    ["Nintendo Switch", "Nintendo Switch 2"],
    ["Pixel 10 Pro", "Pixel 10 Pro XL"],
    ["Xbox Series X", "Xbox Series S"],
  ];
  for (const [a, b] of pairs) bothWays(a, b);
});

test("STRICTNESS: a whole sibling catalogue never collapses onto one row", () => {
  // The end-to-end shape of the failure: feed the resolver a family one product
  // at a time and check the catalogue still has as many rows as it had members.
  const family = [
    "NVIDIA GeForce RTX 5070",
    "NVIDIA GeForce RTX 5070 Ti",
    "NVIDIA GeForce RTX 5080",
    "NVIDIA GeForce RTX 5080 Super",
    "NVIDIA GeForce RTX 5090",
  ];
  const catalogue: { kind: "product"; id: string; name: string }[] = [];
  for (const name of family) {
    const r = resolveEntity(name, catalogue);
    assert.notEqual(
      r.decision,
      "matched_existing",
      `"${name}" collapsed onto "${r.matchedName}" at ${r.score.toFixed(2)} — the family would lose a card.`
    );
    catalogue.push({ kind: "product", id: `p${catalogue.length}`, name });
  }
  assert.equal(catalogue.length, family.length);
});

test("FALSE NEGATIVES: the same product written differently still resolves", () => {
  const pairs: [string, string][] = [
    // Headlines wrapping the catalogue name.
    ["Canon EOS R5", "Canon EOS R5 gets 8K firmware update"],
    ["Canon EOS R5", "The new Canon EOS R5 is officially announced"],
    ["Canon EOS R5", "Canon EOS R5 hits 45MP burst milestone"],
    ["DJI Mini 4 Pro", "DJI Mini 4 Pro review: the best small drone"],
    ["Nintendo Switch 2", "Nintendo Switch 2 launches with 4K docked output"],
    ["TP-Link Deco XE75", "TP-Link Deco XE75 review"],
    ["AMD Ryzen 7 9800X3D", "The new AMD Ryzen 7 9800X3D is officially announced"],
    // Short name vs full name — a manufacturer prefix is not a variant.
    ["Nintendo Switch 2", "Switch 2"],
    ["PS5 Pro", "Sony PlayStation 5 Pro"],
    ["RTX 5090", "NVIDIA GeForce RTX 5090"],
    ["RTX 5080 Ti", "NVIDIA GeForce RTX 5080 Ti"],
    // Case, punctuation, whitespace, hyphenation.
    ["Canon EOS R5", "canon eos r5"],
    ["Canon EOS R5", "CANON EOS R5"],
    ["Canon EOS R5", "  Canon   EOS   R5  "],
    ["Canon EOS R5", "Canon EOS-R5"],
    ["Canon EOS R5", "Canon EOS R5!"],
    ["Xbox Series X", "xbox series x"],
    ["Intel Core Ultra 9 285K", "intel core ultra 9 285k"],
    ["TP-Link Deco XE75", "TP Link Deco XE75"],
    // Known spelling synonyms.
    ["Canon EOS 6D Mark II", "Canon EOS 6D mk II"],
    ["PlayStation 5 Pro", "PS5 Pro"],
  ];
  for (const [a, b] of pairs) assertSameProduct(a, b);
});

test("FALSE NEGATIVES: over-strictness would show up as an unusable ambiguous queue", () => {
  // A resolver that answers "ask a human" to everything has failed too, just
  // more quietly. A clean product name against its own catalogue row must be a
  // confident match, never a question.
  const catalogue = [
    { kind: "product" as const, id: "p1", name: "Canon EOS R5" },
    { kind: "product" as const, id: "p2", name: "Sony PlayStation 5 Pro" },
    { kind: "product" as const, id: "p3", name: "NVIDIA GeForce RTX 5090" },
    { kind: "product" as const, id: "p4", name: "Nintendo Switch 2" },
  ];
  for (const { name, id } of catalogue) {
    const r = resolveEntity(name, catalogue);
    assert.equal(r.decision, "matched_existing", `"${name}" no longer matches its own catalogue row`);
    assert.equal(r.matchedId, id);
  }
});

test("BORDERLINE (documented, not a bug): a bundle SKU resolves onto the product", () => {
  // Recorded deliberately rather than left as a surprise.
  //
  // "DJI Mini 4 Pro Fly More Combo" matches "DJI Mini 4 Pro" at 1.00, because
  // the three trailing words put it on the headline side of the guard that
  // catches "Pixel 10 Pro XL". That boundary is load-bearing in the other
  // direction too — "Canon EOS R5 gets 8K firmware update" also has exactly
  // three trailing words and MUST keep matching.
  //
  // The judgement: a Fly More Combo is the same drone in a larger box, and an
  // article about it is an article about the Mini 4 Pro, so resolving onto the
  // product is the wanted behaviour here. It is recorded as a decision, not an
  // accident. If bundle SKUs ever need their own catalogue rows, the fix is a
  // bundle-word list, NOT widening the trailing-token window.
  const s = entitySimilarity("DJI Mini 4 Pro", "DJI Mini 4 Pro Fly More Combo");
  assert.equal(s, entitySimilarity("DJI Mini 4 Pro Fly More Combo", "DJI Mini 4 Pro"));
  assert.ok(s >= MATCH_THRESHOLD, "if this changes, revisit the note above rather than deleting the test");
});

test("STRICTNESS: an undecidable name is held for a human, not guessed either way", () => {
  // "Acme Widget 7 Zeta" could be a variant or a terse headline. The resolver
  // genuinely cannot tell, and the honest answer is the ambiguous band — never
  // matched_existing, because an overwrite cannot be undone.
  const r = resolveEntity("Sonos Era 300 Gaming", [{ kind: "product", id: "p1", name: "Sonos Era 300" }]);
  assert.notEqual(r.decision, "matched_existing");
  assert.ok(r.score < MATCH_THRESHOLD);
  assert.ok(
    r.decision === "ambiguous" || r.decision === "new_entity",
    `expected a question or a new row, got ${r.decision}`
  );
  assert.ok(AMBIGUOUS_THRESHOLD < MATCH_THRESHOLD, "the ambiguous band must exist for this to be expressible");
});
