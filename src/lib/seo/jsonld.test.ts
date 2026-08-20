import { test } from "node:test";
import assert from "node:assert/strict";
import { organizationJsonLd, websiteJsonLd, breadcrumbJsonLd, productJsonLd, articleJsonLd } from "./jsonld.ts";
import { SITE_URL } from "./site.ts";

test("organizationJsonLd has required schema.org fields", () => {
  const result = organizationJsonLd();
  assert.equal(result["@type"], "Organization");
  assert.equal(result.url, SITE_URL);
});

test("websiteJsonLd has required schema.org fields", () => {
  assert.equal(websiteJsonLd()["@type"], "WebSite");
});

test("breadcrumbJsonLd builds a positioned ListItem per entry", () => {
  const result = breadcrumbJsonLd([
    { name: "Home", path: "/" },
    { name: "Products", path: "/products" },
  ]);
  assert.equal(result.itemListElement.length, 2);
  assert.equal(result.itemListElement[0].position, 1);
  assert.equal(result.itemListElement[1].position, 2);
  assert.equal(result.itemListElement[1].item, `${SITE_URL}/products`);
});

test("productJsonLd omits brand when no manufacturer given", () => {
  const result = productJsonLd({ name: "Widget", slug: "widget", summary: null });
  assert.equal(result.brand, undefined);
});

test("productJsonLd includes brand when manufacturer given", () => {
  const result = productJsonLd({ name: "Widget", slug: "widget", summary: null, manufacturerName: "Acme" });
  assert.deepEqual(result.brand, { "@type": "Brand", name: "Acme" });
});

test("productJsonLd never fabricates rating/price/availability fields", () => {
  const result = productJsonLd({ name: "Widget", slug: "widget", summary: "A widget." });
  assert.equal("aggregateRating" in result, false);
  assert.equal("offers" in result, false);
  assert.equal("review" in result, false);
});

test("articleJsonLd falls back to publishedAt when no updatedAt given", () => {
  const result = articleJsonLd({ title: "T", slug: "t", publishedAt: "2026-01-01T00:00:00Z" });
  assert.equal(result.dateModified, "2026-01-01T00:00:00Z");
});
