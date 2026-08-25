import { test } from "node:test";
import assert from "node:assert/strict";
import { buildFeed, escapeXml, stripInvalidXmlChars, toRfc822 } from "./feed.ts";

const OPTS = {
  title: "Tech Carvalho",
  siteUrl: "https://techcarvalho.com",
  feedUrl: "https://techcarvalho.com/feed.xml",
  description: "Technology explained.",
};

// Control characters below are written as \u escapes, never as literal bytes.
// A literal one is invisible in every editor and in git diff, which is how a
// backspace got into this codebase's source once already.
const BACKSPACE = String.fromCharCode(8);
const VERTICAL_TAB = String.fromCharCode(11);

test("every XML metacharacter is escaped", () => {
  assert.equal(escapeXml(`a & b < c > d "e" 'f'`), "a &amp; b &lt; c &gt; d &quot;e&quot; &apos;f&apos;");
});

test("a real title with quotes and an ampersand survives", () => {
  // A genuine published title on this site. One unescaped character here makes
  // the whole document unparseable, which shows up as an empty feed rather
  // than as an error anyone notices.
  const xml = buildFeed(
    [{
      title: `"Display Driver Stopped Responding" & What It Means`,
      url: "https://techcarvalho.com/articles/x",
      description: "Fix it & move on <fast>",
      publishedAt: "2026-08-22T05:34:00.000Z",
    }],
    OPTS
  );
  assert.ok(!/&(?!amp;|lt;|gt;|quot;|apos;)/.test(xml), "an unescaped ampersand slipped through");
  assert.ok(xml.includes("&quot;Display Driver"));
  assert.ok(xml.includes("&amp; What It Means"));
  assert.ok(!xml.includes("<fast>"));
});

test("control characters are removed, not escaped", () => {
  // There is no XML representation for these; they can only be stripped.
  const dirty = `Xeon 7${BACKSPACE} Diamond${VERTICAL_TAB} Rapids`;
  assert.equal(stripInvalidXmlChars(dirty), "Xeon 7 Diamond Rapids");

  const xml = buildFeed(
    [{ title: dirty, url: "https://x.test/a", description: "d", publishedAt: "2026-08-22T00:00:00.000Z" }],
    OPTS
  );
  assert.ok(!xml.includes(BACKSPACE), "a backspace reached the document");
  assert.ok(!xml.includes(VERTICAL_TAB), "a vertical tab reached the document");
});

test("tabs and newlines are legal and preserved", () => {
  assert.equal(stripInvalidXmlChars("a\tb\nc\r"), "a\tb\nc\r");
});

test("an item with no publication date is dropped, never back-dated", () => {
  // Substituting today's date would tell every aggregator an old article is
  // new. Dropping it is the honest failure.
  const xml = buildFeed(
    [
      { title: "Dated", url: "https://x.test/a", description: "d", publishedAt: "2026-08-22T00:00:00.000Z" },
      { title: "Undated", url: "https://x.test/b", description: "d", publishedAt: null },
    ],
    OPTS
  );
  assert.ok(xml.includes("<title>Dated</title>"));
  assert.ok(!xml.includes("Undated"));
});

test("pubDate is RFC 822, which is what RSS 2.0 requires", () => {
  assert.equal(toRfc822("2026-08-22T05:34:00.000Z"), "Sat, 22 Aug 2026 05:34:00 GMT");
});

test("lastBuildDate reflects the newest item, not the build time", () => {
  const xml = buildFeed(
    [
      { title: "Older", url: "https://x.test/a", description: "d", publishedAt: "2026-08-01T00:00:00.000Z" },
      { title: "Newer", url: "https://x.test/b", description: "d", publishedAt: "2026-08-22T00:00:00.000Z" },
    ],
    OPTS
  );
  assert.ok(xml.includes(`<lastBuildDate>${toRfc822("2026-08-22T00:00:00.000Z")}</lastBuildDate>`));
});

test("an empty feed is still a valid document", () => {
  // An empty section must produce a parseable feed, not a broken one.
  const xml = buildFeed([], OPTS);
  assert.ok(xml.startsWith(`<?xml version="1.0" encoding="UTF-8"?>`));
  assert.ok(xml.includes("</rss>"));
  assert.ok(!xml.includes("<lastBuildDate>"));
});

test("the feed declares itself via atom:link", () => {
  const xml = buildFeed([], OPTS);
  assert.ok(xml.includes(`href="https://techcarvalho.com/feed.xml" rel="self"`));
});

test("an image is attached only when one exists", () => {
  const base = { title: "A", url: "https://x.test/a", description: "d", publishedAt: "2026-08-22T00:00:00.000Z" };
  assert.ok(buildFeed([{ ...base, imageUrl: "https://x.test/i.jpg" }], OPTS).includes("<enclosure"));
  assert.ok(!buildFeed([base], OPTS).includes("<enclosure"));
});
