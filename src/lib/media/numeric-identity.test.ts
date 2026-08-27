import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { compareDesignations, designationTokens, namesSpecificModel } from "./identity.ts";
import { scoreMatch, deriveIsModelSpecific, type MatchAsset, type MatchTarget } from "./match-engine.ts";
import { buildEntityVocabulary } from "./entity-vocabulary.ts";

// CONTEXTUAL NUMERIC IDENTITY.
//
// Two rules pull in opposite directions and both have to hold:
//
//   A bare digit must NOT create identity.   DJI Mini 4 Pro / Neptune 4 Pro
//   A bare digit MUST carry identity.        Wi-Fi 7 / Wi-Fi 8
//
// They are reconciled by the WORD IN FRONT of the number. "7" identifies
// nothing; "Wi-Fi 7" identifies one standard. So the number travels with its
// context as one token, and a number can only ever be compared against another
// number sharing its context.
//
// Every pair below is adversarial: each is chosen because a plausible
// implementation gets it wrong in one direction or the other.

const same = (a: string, b: string) => !compareDesignations(a, b).conflict;

describe("a standard's version number identifies it", () => {
  const DIFFERENT: [string, string][] = [
    ["Wi-Fi 6", "Wi-Fi 7"],
    ["Wi-Fi 7", "Wi-Fi 8"],
    ["Wi-Fi 6", "Wi-Fi 6E"],
    ["USB 3", "USB 4"],
    ["PCIe 4", "PCIe 5"],
    ["PCIe 5", "PCIe 6"],
    ["PlayStation 4", "PlayStation 5"],
    ["Bluetooth 5", "Bluetooth 6"],
    ["HDMI 2", "HDMI 3"],
  ];
  for (const [a, b] of DIFFERENT) {
    test(`"${a}" is not "${b}"`, () => {
      assert.equal(same(a, b), false, `${JSON.stringify([...designationTokens(a)])} vs ${JSON.stringify([...designationTokens(b)])}`);
    });
  }

  test("and each one is recognised as naming something specific at all", () => {
    for (const n of ["Wi-Fi 7", "USB 4", "PCIe 5", "PlayStation 5"]) {
      assert.equal(namesSpecificModel(n), true, `${n} derived no designation`);
    }
  });
});

describe("a shared number alone still creates nothing", () => {
  // THE RULE THAT MUST SURVIVE THE FIX. Both carry "4"; a naive numeric identity
  // once put a drone photograph on a 3D-printer page.
  test("DJI Mini 4 Pro is not Neptune 4 Pro", () => {
    assert.equal(same("DJI Mini 4 Pro", "Neptune 4 Pro"), false);
  });

  test("the shared 4 is not what separates them — the CONTEXT is", () => {
    const a = designationTokens("DJI Mini 4 Pro");
    const b = designationTokens("Neptune 4 Pro");
    assert.ok(![...a].includes("4"), "a bare digit must never be a designation");
    assert.ok(![...b].includes("4"));
    // Neptune is an ordinary word to this system, so it becomes the context.
    assert.ok([...b].includes("neptune#4"));
  });

  // Different named things that happen to share a version number.
  for (const [a, b] of [
    ["Wi-Fi 6", "USB 6"],
    ["PCIe 5", "PlayStation 5"],
    ["USB 4", "PCIe 4"],
  ] as [string, string][]) {
    test(`"${a}" and "${b}" share a number and nothing else`, () => {
      assert.equal(same(a, b), false);
    });
  }
});

describe("a range covers the points inside it", () => {
  test("a Wi-Fi 4-to-7 explainer does cover Wi-Fi 7", () => {
    assert.equal(same("Wi-Fi 7 Explained", "Wi-Fi 4 to Wi-Fi 7: What Each Generation Actually Changed"), true);
  });

  test("but it does not cover Wi-Fi 8", () => {
    assert.equal(same("Wi-Fi 8 draft published", "Wi-Fi 4 to Wi-Fi 7: What Each Generation Actually Changed"), false);
  });

  test("the subset rule applies to contextual numbers ONLY", () => {
    // If it leaked into ordinary designations, a plain R5 would 'cover' an
    // R5 Mark II, which is the false-SKU claim the whole file exists to refuse.
    assert.equal(same("Canon EOS R5 Mark II", "Canon EOS R5"), false);
    assert.equal(same("Samsung Galaxy S26 Ultra", "Samsung Galaxy S26"), false);
  });
});

describe("spelling differences are not identity differences", () => {
  for (const [a, b] of [
    ["Wi-Fi 7", "wifi 7 router"],
    ["Wi-Fi 7", "WIFI7"],
    ["PlayStation 5", "playstation-5-and-dualsense"],
  ] as [string, string][]) {
    test(`"${a}" and "${b}" name the same thing`, () => {
      assert.equal(same(a, b), true, `${JSON.stringify([...designationTokens(a)])} vs ${JSON.stringify([...designationTokens(b)])}`);
    });
  }
});

// ---------------------------------------------------------------------------
// And the same rules through the MATCHER, because identity that never reaches a
// slot decision is not protection.
// ---------------------------------------------------------------------------
describe("the matcher refuses a wrong-generation image", () => {
  const VOCAB = buildEntityVocabulary({
    manufacturers: ["TP-Link", "Sony"],
    productNames: ["TP-Link Deco XE75", "Sony PlayStation 5"],
    categorySlugs: ["networking", "gaming"],
    tagNames: ["Wi-Fi", "Wi-Fi 7", "Router"],
  });

  const asset = (filename: string): MatchAsset => ({
    id: "asset",
    storagePath: `0f8b1c2d-3e4f-5a6b-7c8d-9e0f1a2b3c4d-${filename}.jpg`,
    altText: null,
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
  });
  const target = (title: string): MatchTarget => ({
    id: "target",
    kind: "content",
    title,
    manufacturerName: null,
    categorySlug: "networking",
    isModelSpecific: deriveIsModelSpecific(title),
    occupiedSlots: [],
  });
  const score = (f: string, t: string) => scoreMatch(asset(f), target(t), { entityVocabulary: VOCAB });

  test("a Wi-Fi 6 router photo is not offered for a Wi-Fi 7 article", () => {
    const m = score("wifi-6-router", "Wi-Fi 7 explained");
    assert.deepEqual(m.proposedSlots, [], `reasons: ${m.reasons.join(" | ")}`);
  });

  test("a Wi-Fi 7 router photo IS offered for a Wi-Fi 7 article", () => {
    const m = score("wifi-7-router", "Wi-Fi 7 explained");
    assert.ok(m.proposedSlots.includes("hero"), `withheld: ${m.withheld.join(" | ")}`);
  });

  test("a PlayStation 4 photo is not offered for a PlayStation 5 article", () => {
    const m = score("playstation-4-console", "PlayStation 5 review");
    assert.deepEqual(m.proposedSlots, [], `reasons: ${m.reasons.join(" | ")}`);
  });
});
