import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  assessDiscoverReadiness,
  DISCOVER_MIN_WIDTH,
  DISCOVER_MIN_PIXELS,
  type ArticleForReadiness,
} from "./discover-readiness.ts";

// The numbers asserted here are GOOGLE'S, read from
// developers.google.com/search/docs/appearance/google-discover on 2026-08-27:
// at least 1200px wide, more than 300,000 total pixels, 16x9.
//
// If Google changes them, these tests should fail — that is the point of
// pinning them rather than leaving them as magic numbers in a report.

const base = (over: Partial<ArticleForReadiness> = {}): ArticleForReadiness => ({
  id: "a",
  slug: "s",
  title: "Canon EOS R5 Mark II: What Actually Changed",
  status: "published",
  publishedAt: "2026-08-01T00:00:00Z",
  updatedAt: "2026-08-01T00:00:00Z",
  authorName: "Telmo Carvalho",
  description: "A description long enough to be usable in a preview card on any surface.",
  hero: { width: 1600, height: 900, altText: "Canon EOS R5 Mark II body", publicationStatus: "published", isGraphic: false },
  ...over,
});

describe("Google's stated image minimums", () => {
  test("a 1600x900 photograph is READY", () => {
    const f = assessDiscoverReadiness(base());
    assert.equal(f.state, "READY", f.problems.join(" | "));
  });

  test(`below ${DISCOVER_MIN_WIDTH}px wide is IMAGE TOO SMALL`, () => {
    const f = assessDiscoverReadiness(base({ hero: { width: 1199, height: 675, altText: "x y z alt text", publicationStatus: "published", isGraphic: false } }));
    assert.equal(f.state, "IMAGE TOO SMALL");
    assert.match(f.problems.join(" "), /1200px/);
  });

  test(`below ${DISCOVER_MIN_PIXELS} total pixels is IMAGE TOO SMALL`, () => {
    // Wide enough, but far too short to reach the pixel count.
    const f = assessDiscoverReadiness(base({ hero: { width: 1300, height: 200, altText: "x y z alt text", publicationStatus: "published", isGraphic: false } }));
    assert.equal(f.state, "IMAGE TOO SMALL");
    assert.match(f.problems.join(" "), /300,000/);
  });

  test("a wrong aspect ratio is reported but is not 'too small'", () => {
    const f = assessDiscoverReadiness(base({ hero: { width: 1600, height: 1600, altText: "x y z alt text", publicationStatus: "published", isGraphic: false } }));
    assert.equal(f.state, "NEEDS BETTER HERO IMAGE");
    assert.match(f.problems.join(" "), /aspect ratio/);
  });
});

describe("what it refuses to guess", () => {
  // An unmeasured image is not a small image, and reporting it as one would be
  // inventing a fact about a file nobody has looked at.
  test("an unmeasured image is UNMEASURED, never TOO SMALL", () => {
    const f = assessDiscoverReadiness(base({ hero: { width: null, height: null, altText: "x y z alt text", publicationStatus: "published", isGraphic: false } }));
    assert.equal(f.state, "IMAGE UNMEASURED");
    assert.match(f.problems.join(" "), /missing measurement, not a small image/);
  });

  test("a draft is NOT INDEXABLE and nothing else is reported", () => {
    const f = assessDiscoverReadiness(base({ status: "draft" }));
    assert.equal(f.state, "NOT INDEXABLE");
    assert.equal(f.problems.length, 1, "an unindexable page has one problem worth fixing first");
  });
});

describe("headline honesty", () => {
  for (const title of [
    "You Won't Believe What Canon Just Did",
    "This One Trick Fixes Your Wi-Fi",
    "Everything You Need to Know About the RTX 5090",
    "SHOCKING: Samsung Delays the S26",
  ]) {
    test(`"${title.slice(0, 34)}..." is flagged for review`, () => {
      const f = assessDiscoverReadiness(base({ title }));
      assert.match(f.problems.join(" "), /Headline:/);
    });
  }

  test("an ordinary descriptive headline is not flagged", () => {
    const f = assessDiscoverReadiness(base({ title: "Canon EOS R5 Mark II: What Actually Changed" }));
    assert.ok(!f.problems.some((p) => p.startsWith("Headline:")), f.problems.join(" | "));
  });
});

describe("transparency and dates", () => {
  test("an unattributed article is flagged", () => {
    const f = assessDiscoverReadiness(base({ authorName: null }));
    assert.match(f.problems.join(" "), /Nobody is named/);
  });

  test("an undated article is flagged", () => {
    const f = assessDiscoverReadiness(base({ publishedAt: null }));
    assert.match(f.problems.join(" "), /No publication date/);
  });

  test("a generated graphic hero is a weak card, and says so", () => {
    const f = assessDiscoverReadiness(base({ hero: { width: 1600, height: 900, altText: "a diagram of something", publicationStatus: "published", isGraphic: true } }));
    assert.equal(f.state, "NEEDS BETTER HERO IMAGE");
    assert.match(f.problems.join(" "), /diagram or title card/);
  });
});

test("every finding lists ALL problems, not just the one that named the state", () => {
  const f = assessDiscoverReadiness(
    base({ authorName: null, publishedAt: null, hero: { width: 400, height: 400, altText: null, publicationStatus: "published", isGraphic: true } })
  );
  assert.ok(f.problems.length >= 4, `only ${f.problems.length}: ${f.problems.join(" | ")}`);
});
