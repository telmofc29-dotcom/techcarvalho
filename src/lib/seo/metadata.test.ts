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
  assert.deepEqual(result.robots, { index: false, follow: false });
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
  assert.deepEqual(result.robots, { index: false, follow: true });
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
