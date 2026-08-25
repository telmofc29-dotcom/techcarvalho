import { test } from "node:test";
import assert from "node:assert/strict";
import { buildMetadata, buildNotFoundMetadata, canonicalPathWithParams, normalizeCanonical } from "./metadata.ts";
import { SITE_NAME, SITE_URL } from "./site.ts";

test("buildMetadata: sets a page-specific canonical", () => {
  const result = buildMetadata({ title: "Widget", path: "/products/widget" });
  assert.ok(String(result.alternates?.canonical).endsWith("/products/widget"));
});

test("buildMetadata: noindex still keeps a canonical (used for e.g. /search)", () => {
  const result = buildMetadata({ title: "Search", path: "/search", noindex: true, follow: false });
  const robots = result.robots as { index?: boolean; follow?: boolean; googleBot?: { index?: boolean } };
  assert.equal(robots.index, false);
  assert.equal(robots.follow, false);
  assert.equal(robots.googleBot?.index, false);
  assert.ok(result.alternates?.canonical);
});

// Regression test for the site-wide duplicated-suffix bug: the root layout
// declares `title.template: "%s | Tech Carvalho"`, and Next applies a parent
// template to any child segment returning a plain string title. buildMetadata
// already appends the suffix itself, so a string title rendered
// "<title>Products | Tech Carvalho | Tech Carvalho</title>" on every page.
test("buildMetadata: title is `absolute` so the root layout's template can't append a second site-name suffix", () => {
  const result = buildMetadata({ title: "Products", path: "/products" });
  assert.deepEqual(result.title, { absolute: `Products | ${SITE_NAME}` });
});

test("buildMetadata: the site name alone is not suffixed with itself", () => {
  const result = buildMetadata({ title: SITE_NAME, path: "/" });
  assert.deepEqual(result.title, { absolute: SITE_NAME });
});

test("buildMetadata: noindex with follow keeps links crawlable", () => {
  const result = buildMetadata({ title: "Filtered", path: "/products?category=x", noindex: true, follow: true });
  // Asserts the DECISION, not the object shape. Deep-equalling the whole
  // robots object made this test fail when max-image-preview was added, which
  // is a change it has no opinion about — the point here is that a noindex
  // page stays crawlable so the links it carries are not stranded.
  const robots = result.robots as { index?: boolean; follow?: boolean; googleBot?: { index?: boolean; follow?: boolean } };
  assert.equal(robots.index, false);
  assert.equal(robots.follow, true);
  assert.equal(robots.googleBot?.index, false);
  assert.equal(robots.googleBot?.follow, true);
});

test("buildMetadata: an editor canonical_url overrides the self-referencing canonical", () => {
  const result = buildMetadata({
    title: "Widget",
    path: "/products/widget",
    canonicalUrl: `${SITE_URL}/products/widget-mk2`,
  });
  assert.equal(result.alternates?.canonical, `${SITE_URL}/products/widget-mk2`);
});

test("buildMetadata: og:url follows the canonical, not the raw path", () => {
  const result = buildMetadata({
    title: "Widget",
    path: "/products/widget",
    canonicalUrl: "/products/widget-mk2",
  });
  assert.equal(result.openGraph?.url, `${SITE_URL}/products/widget-mk2`);
});

test("buildMetadata: article type carries real publish/modify timestamps", () => {
  const result = buildMetadata({
    title: "A piece",
    path: "/articles/a-piece",
    openGraphType: "article",
    publishedTime: "2026-01-01T00:00:00Z",
    modifiedTime: "2026-02-01T00:00:00Z",
  });
  const og = result.openGraph as { type?: string; publishedTime?: string; modifiedTime?: string };
  assert.equal(og.type, "article");
  assert.equal(og.publishedTime, "2026-01-01T00:00:00Z");
  assert.equal(og.modifiedTime, "2026-02-01T00:00:00Z");
});

test("buildMetadata: a page with a real hero image gets a large social card", () => {
  const withImage = buildMetadata({
    title: "Widget",
    path: "/products/widget",
    image: { url: "https://cdn.example/widget.jpg", alt: "A widget" },
  });
  assert.equal((withImage.twitter as { card?: string }).card, "summary_large_image");

  const withoutImage = buildMetadata({ title: "Widget", path: "/products/widget" });
  assert.equal((withoutImage.twitter as { card?: string }).card, "summary");
  assert.equal((withoutImage.openGraph as { images?: unknown }).images, undefined);
});

test("buildNotFoundMetadata: noindex", () => {
  const result = buildNotFoundMetadata();
  assert.deepEqual(result.robots, { index: false, follow: false });
});

test("buildNotFoundMetadata: never emits a canonical — a 404 has nothing valid to canonicalize to", () => {
  const result = buildNotFoundMetadata();
  assert.equal(result.alternates, undefined);
});

// --- normalizeCanonical ----------------------------------------------------
// seo_metadata.canonical_url is free text from an admin form. The danger is
// not a typo, it's a canonical pointing at a domain we do not control, which
// tells Google to drop our page in favour of someone else's.

test("normalizeCanonical: rejects an off-site canonical rather than de-indexing our own page for someone else", () => {
  assert.equal(normalizeCanonical("https://evil.example/steal-this"), null);
});

test("normalizeCanonical: rejects unparseable text", () => {
  assert.equal(normalizeCanonical("not a url at all"), null);
  assert.equal(normalizeCanonical("   "), null);
  assert.equal(normalizeCanonical(null), null);
  assert.equal(normalizeCanonical(undefined), null);
});

test("normalizeCanonical: accepts a root-relative path and a same-origin absolute URL", () => {
  assert.equal(normalizeCanonical("/products/widget"), `${SITE_URL}/products/widget`);
  assert.equal(normalizeCanonical(`${SITE_URL}/products/widget`), `${SITE_URL}/products/widget`);
});

// --- canonicalPathWithParams ----------------------------------------------

test("canonicalPathWithParams: drops unknown params so tracking links can't spawn duplicates", () => {
  const path = canonicalPathWithParams(
    "/articles",
    { type: "guide", utm_source: "newsletter", fbclid: "abc" },
    ["type", "page"]
  );
  assert.equal(path, "/articles?type=guide");
});

test("canonicalPathWithParams: normalizes param order regardless of how the URL was written", () => {
  const a = canonicalPathWithParams("/products", { page: "3", manufacturer: "canon" }, ["manufacturer", "page"]);
  const b = canonicalPathWithParams("/products", { manufacturer: "canon", page: "3" }, ["manufacturer", "page"]);
  assert.equal(a, b);
  assert.equal(a, "/products?manufacturer=canon&page=3");
});

test("canonicalPathWithParams: page=1 collapses to the bare path", () => {
  assert.equal(canonicalPathWithParams("/articles", { page: 1 }, ["type", "page"]), "/articles");
  assert.equal(canonicalPathWithParams("/articles", { page: "1", type: "news" }, ["type", "page"]), "/articles?type=news");
});

test("canonicalPathWithParams: empty and nullish values are dropped, not emitted as bare keys", () => {
  assert.equal(
    canonicalPathWithParams("/products", { manufacturer: "", category: undefined, page: null }, [
      "manufacturer",
      "category",
      "page",
    ]),
    "/products"
  );
});

// ---------------------------------------------------------------------------
// Large image previews
// ---------------------------------------------------------------------------

test("pages declare large image preview eligibility", () => {
  // Without max-image-preview:large Google may only use a thumbnail, and a
  // thumbnail is not eligible for the image-led surfaces at all. This does not
  // promise traffic; it removes a restriction the site was imposing on itself.
  const m = buildMetadata({ title: "A", path: "/a" });
  const bot = (m.robots as { googleBot?: Record<string, unknown> }).googleBot;
  assert.equal(bot?.["max-image-preview"], "large");
  assert.equal(bot?.["max-snippet"], -1);
  assert.equal(bot?.["max-video-preview"], -1);
});

test("image directives do not override the indexing decision", () => {
  // The directives are independent of indexing. A noindex page must still be
  // noindex to googleBot, or this would quietly reindex excluded pages.
  const m = buildMetadata({ title: "A", path: "/a", noindex: true, follow: false });
  const robots = m.robots as { index?: boolean; follow?: boolean; googleBot?: Record<string, unknown> };
  assert.equal(robots.index, false);
  assert.equal(robots.follow, false);
  assert.equal(robots.googleBot?.index, false);
  assert.equal(robots.googleBot?.follow, false);
  // ...while still declaring the preview directives.
  assert.equal(robots.googleBot?.["max-image-preview"], "large");
});

test("a noindex 404 keeps its noindex", () => {
  // notFoundMetadata is a separate path and must not have picked up index:true.
  const m = buildNotFoundMetadata();
  const robots = m.robots as { index?: boolean; follow?: boolean };
  assert.equal(robots.index, false);
  assert.equal(robots.follow, false);
});

test("every page advertises the site feed", () => {
  // Declared once in the root layout, this rendered on NO page: Next replaces
  // a parent's `alternates` wholesale when a child sets its own, and every
  // page here self-canonicalizes. Building it into the shared builder is what
  // makes the tag actually appear.
  const m = buildMetadata({ title: "A", path: "/a" });
  const types = m.alternates?.types as Record<string, { url: string }[]> | undefined;
  const rss = types?.["application/rss+xml"];
  assert.ok(rss && rss.length > 0, "no RSS alternate emitted");
  assert.ok(String(rss[0].url).endsWith("/feed.xml"), rss[0].url);
});

test("the feed link does not displace the canonical", () => {
  const m = buildMetadata({ title: "A", path: "/a" });
  assert.ok(m.alternates?.canonical);
});
