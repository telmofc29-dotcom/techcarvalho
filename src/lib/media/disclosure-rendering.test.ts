import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { requiredDisclosure, type ClassifiableMedia } from "./classification.ts";

// NOT importing classifiable() from src/lib/public/hero-image.ts on purpose:
// that module opens with `import "server-only"`, which throws outside a Server
// Component and takes the whole test file down with it. The shapes below are
// what classifiable() produces, written out directly.
const asset = (over: Partial<ClassifiableMedia>): ClassifiableMedia => ({
  source_type: null,
  asset_role: null,
  brand_role: null,
  owned: null,
  ai_generated: null,
  rights_status: null,
  ...over,
});

// A DISCLOSURE THAT IS COMPUTED BUT NEVER RENDERED IS NOT A DISCLOSURE.
//
// requiredDisclosure() was written, unit-tested and correct from the start —
// and for the whole time it existed, no public page called it. Two published
// articles ended up leading with AI-generated artwork whose only on-page label
// was a chip reading "Graphic", which a reader reasonably takes to mean "a
// chart". The honest sentence existed in the codebase and never reached a
// single visitor.
//
// Unit-testing the function again would not have caught that, because the
// function was never the broken part. So these tests assert the WIRING: that
// the lead components actually call it. A source-level check is crude, but it
// fails loudly if someone removes the call, which is the failure that happened.

const ARTICLE_LEAD = "src/components/public/article-lead-media.tsx";
const PRODUCT_LEAD = "src/components/public/product-lead-media.tsx";
// The article BODY gallery, too. Fixing the lead and leaving this loop alone is
// exactly what happened first: an AI concept render of unreleased hardware sat
// published and visible in this gallery, disclosing nothing, while the lead
// component two files away had already been corrected.
const ARTICLE_BODY = "src/app/(public)/articles/[slug]/page.tsx";
// And the product gallery strip. Every surface that puts an image in front of
// a reader is on this list, because the failure each time was not a wrong
// disclosure — it was a surface nobody had wired up yet.
const PRODUCT_BODY = "src/app/(public)/products/[slug]/page.tsx";

for (const file of [ARTICLE_LEAD, PRODUCT_LEAD, ARTICLE_BODY, PRODUCT_BODY]) {
  test(`${file} renders the derived disclosure`, () => {
    const src = readFileSync(file, "utf8");
    assert.ok(
      src.includes("requiredDisclosure"),
      `${file} must call requiredDisclosure() — a disclosure that is computed but not rendered protects nobody`
    );
    // USED, not merely imported. Matching a particular JSX shape turned out to
    // be the wrong test: these four surfaces legitimately render it three
    // different ways — a named variable with `&&`, an inline call with `&&`,
    // and a `.map()` over the distinct disclosures in a gallery. A regex tuned
    // to one of those shapes fails the others and pressures the code to be
    // written for the test rather than for the page.
    //
    // So strip the import statements and require the symbol to still appear.
    // That is precisely the property worth holding — an import with no use is
    // exactly how a disclosure ends up computed and never shown — and it stays
    // true however the value is rendered.
    const withoutImports = src
      .split("\n")
      .filter((line) => !/^\s*import\b/.test(line))
      .join("\n");
    assert.ok(
      withoutImports.includes("requiredDisclosure"),
      `${file} imports requiredDisclosure() but never uses it — a disclosure that is computed and not rendered protects nobody`
    );
  });
}

// --- the values those components will be rendering ---------------------------

test("an AI editorial illustration discloses that it is not a photograph", () => {
  // Exactly the shape of router.png / gta-6-sunset.png as they went live:
  // owned TechCarvalho graphics, machine-made, with no editorial role set.
  const d = requiredDisclosure(
    asset({ source_type: "tc_graphic", asset_role: null, owned: true, ai_generated: true })
  );
  assert.equal(d, "Illustration — AI-generated editorial artwork, not a photograph.");
});

test("a concept render discloses that the hardware has not been revealed", () => {
  const d = requiredDisclosure(
    asset({ source_type: "tc_graphic", asset_role: "concept_render", owned: true, ai_generated: true })
  );
  assert.ok(d);
  assert.match(d, /not official product imagery/i);
  assert.match(d, /has not been revealed/i);
});

test("a real photograph is not labelled with anything", () => {
  // The guard must stay silent on ordinary imagery, or it becomes noise that
  // someone eventually deletes — taking the concept-render case with it.
  assert.equal(
    requiredDisclosure(asset({ source_type: "staff_photograph", owned: true, ai_generated: false })),
    null
  );
  assert.equal(
    requiredDisclosure(asset({ source_type: "public_domain_or_cc", owned: false, ai_generated: false })),
    null
  );
});

test("a hand-made editorial graphic gets no AI disclosure", () => {
  // ai_generated is the discriminator, not the source type: a chart someone
  // drew is a graphic, but claiming a machine made it would be its own lie.
  assert.equal(
    requiredDisclosure(asset({ source_type: "tc_graphic", asset_role: "chart", owned: true, ai_generated: false })),
    null
  );
});

test("a null/absent asset does not throw and discloses nothing", () => {
  assert.equal(requiredDisclosure(null), null);
  assert.equal(requiredDisclosure(undefined), null);
});

// --- the hole that let two AI renders go live saying nothing ----------------

test("an AI image with NO source_type still discloses", () => {
  // The exact state playstation-ps6-concept.png and nintendo-switch-2-render.png
  // were in while published and attached to live articles: machine-made, owned,
  // rights verified — and source_type never set, which made classifyMedia()
  // return 'unclassified' and requiredDisclosure() return null.
  const d = requiredDisclosure(
    asset({ source_type: null, asset_role: null, owned: true, ai_generated: true, rights_status: "verified" })
  );
  assert.ok(d, "an AI-generated image must disclose even when source_type is blank");
  assert.match(d, /AI-generated/i);
});

test("whether an AI image discloses does NOT depend on source_type being filled in", () => {
  // Two sibling uploads differed only by that one field and only one of them
  // disclosed. Both must now.
  const withSource = requiredDisclosure(asset({ source_type: "tc_graphic", ai_generated: true }));
  const withoutSource = requiredDisclosure(asset({ source_type: null, ai_generated: true }));
  assert.ok(withSource);
  assert.ok(withoutSource);
});

test("an unclassified asset that is NOT AI-generated still discloses nothing", () => {
  assert.equal(requiredDisclosure(asset({ source_type: null, ai_generated: false })), null);
  assert.equal(requiredDisclosure(asset({ source_type: null, ai_generated: null })), null);
});

test("an AI-UPSCALED photograph is never told it is not a photograph", () => {
  // ai_generated = true does not mean "not a photograph". An upscaled shot of
  // real hardware classifies as a photograph, and the blanket AI line would be
  // false there — which is why the new case is scoped to 'unclassified'.
  const upscaled = asset({
    source_type: "staff_photograph",
    owned: true,
    rights_status: "verified",
    ai_generated: true,
  });
  assert.equal(requiredDisclosure(upscaled), null);
});
