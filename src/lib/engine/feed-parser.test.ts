import { test } from "node:test";
import assert from "node:assert/strict";
import { parseFeed, classifyDiscoveryType, classifyClaimStatus } from "./feed-parser.ts";

const RSS = `<?xml version="1.0"?><rss version="2.0"><channel>
<item><title>Sony announces PlayStation 5 Pro</title><link>https://example.com/ps5pro</link>
<pubDate>Tue, 05 Nov 2024 10:00:00 GMT</pubDate><description>A new console.</description></item>
<item><title><![CDATA[NVIDIA &amp; partners launch RTX 5090]]></title><guid>https://example.com/rtx</guid>
<description><![CDATA[<p>Fast card.</p>]]></description></item>
</channel></rss>`;

const ATOM = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">
<entry><title>Nintendo confirms Switch 2 price</title><link href="https://example.com/switch2"/>
<updated>2026-08-01T12:00:00Z</updated><summary>Price change.</summary></entry></feed>`;

test("parses RSS items with title, link, date and summary", () => {
  const items = parseFeed(RSS);
  assert.equal(items.length, 2);
  assert.equal(items[0].title, "Sony announces PlayStation 5 Pro");
  assert.equal(items[0].link, "https://example.com/ps5pro");
  assert.ok(items[0].publishedAt?.startsWith("2024-11-05"));
});

test("decodes CDATA and entities, strips inner HTML", () => {
  const items = parseFeed(RSS);
  assert.equal(items[1].title, "NVIDIA & partners launch RTX 5090");
  assert.equal(items[1].summary, "Fast card.");
});

test("falls back to guid when link has no usable text", () => {
  const items = parseFeed(RSS);
  assert.equal(items[1].link, "https://example.com/rtx");
});

test("parses Atom entries including href-style links", () => {
  const items = parseFeed(ATOM);
  assert.equal(items.length, 1);
  assert.equal(items[0].link, "https://example.com/switch2");
});

test("returns empty array for HTML served instead of a feed", () => {
  assert.deepEqual(parseFeed("<html><body><h1>Not a feed</h1></body></html>"), []);
});

test("returns empty array for garbage rather than throwing", () => {
  assert.deepEqual(parseFeed(""), []);
  assert.deepEqual(parseFeed("%%%not xml%%%"), []);
});

test("drops items with no title rather than creating junk candidates", () => {
  const feed = `<rss><channel><item><link>https://x.example/a</link></item></channel></rss>`;
  assert.deepEqual(parseFeed(feed), []);
});

test("classifyDiscoveryType recognises security notices over generic news", () => {
  assert.equal(classifyDiscoveryType("Urgent recall for battery pack", null), "recall_or_security");
  assert.equal(classifyDiscoveryType("Company announces new GPU", null), "product_launch");
  assert.equal(classifyDiscoveryType("Firmware update improves autofocus", null), "firmware_release");
});

test("classifyClaimStatus never promotes a rumour, even from a primary source", () => {
  assert.equal(classifyClaimStatus("Rumour: new console next year", null, "primary"), "rumour");
  assert.equal(classifyClaimStatus("Leaked specs surface", null, "primary"), "leak");
});

test("classifyClaimStatus only allows primary confirmation from a primary source", () => {
  assert.equal(classifyClaimStatus("Company announces X", null, "primary"), "confirmed_primary");
  assert.equal(classifyClaimStatus("Company announces X", null, "secondary"), "reported_secondary");
});
