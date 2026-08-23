import { test } from "node:test";
import assert from "node:assert/strict";
import { classifySource, looksLikeVendorNewsroom, qualifiesAsNews } from "./source-quality.ts";

// The registry problem this covers: all 12 active discovery feeds are
// registered `source_type = 'rss_atom'`, which maps to `unclassified` and an
// EMPTY authority list — so every claim from every live feed carried no
// factual authority whatsoever, including a manufacturer stating its own price.

test("a manufacturer newsroom registered as rss_atom is still recognised as a vendor source", () => {
  for (const url of [
    "https://blogs.nvidia.com/blog/rtx-launch/",
    "https://newsroom.intel.com/news/thing/",
    "https://blog.google/products/pixel/thing/",
    "https://www.canon-europe.com/press-centre/press-release/eos-r5/",
  ]) {
    const c = classifySource({ url, sourceType: "rss_atom", trustLevel: "primary" });
    assert.equal(c.sourceClass, "vendor_press_release", `${url} -> ${c.sourceClass}`);
    assert.ok(c.authorityFor.includes("vendor_own_price"), url);
    assert.equal(c.signalOnly, false, url);
  }
});

test("recognising a vendor newsroom never grants independent authority", () => {
  const c = classifySource({
    url: "https://newsroom.intel.com/news/faster-than-anything/",
    sourceType: "rss_atom",
    trustLevel: "primary",
  });
  assert.equal(c.authorityFor.includes("independent_performance"), false);
  assert.equal(c.authorityFor.includes("independent_significance"), false);
  const news = qualifiesAsNews([c]);
  assert.equal(news.qualifies, false);
  assert.match(news.reason, /vendor's own announcement/);
});

test("an aggregator is not treated as a newsroom just because of its hostname", () => {
  assert.equal(looksLikeVendorNewsroom("https://news.google.com/rss/articles/abc"), false);
  assert.equal(looksLikeVendorNewsroom("https://news.ycombinator.com/rss"), false);
});

test("an independent outlet's blog is not demoted to a vendor press release", () => {
  const c = classifySource({
    url: "https://blog.dpreview.com/posts/thing",
    sourceType: "rss_atom",
    trustLevel: "secondary",
  });
  assert.equal(c.sourceClass, "independent_high_quality");
});

test("a social host still wins over the newsroom rule", () => {
  const c = classifySource({
    url: "https://blog.reddit.com/thread",
    sourceType: "rss_atom",
    trustLevel: "primary",
  });
  assert.equal(c.sourceClass, "social_forum");
  assert.equal(c.signalOnly, true);
});

test("an ordinary unclassified feed on a plain host stays unclassified", () => {
  const c = classifySource({ url: "https://example.com/feed.xml", sourceType: "rss_atom" });
  assert.equal(c.sourceClass, "unclassified");
  assert.equal(c.signalOnly, true);
});
