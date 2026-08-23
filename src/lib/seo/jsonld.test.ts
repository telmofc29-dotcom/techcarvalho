import { test } from "node:test";
import assert from "node:assert/strict";
import {
  organizationJsonLd,
  websiteJsonLd,
  breadcrumbJsonLd,
  itemListJsonLd,
  productJsonLd,
  articleJsonLd,
  collectionPageJsonLd,
  publisherPersonJsonLd,
  safeJsonLdString,
  ORGANIZATION_ID,
  WEBSITE_ID,
} from "./jsonld.ts";
import { SITE_URL } from "./site.ts";
import { PUBLISHER_NAME, PUBLISHER_PERSON_ID } from "./publisher.ts";

test("organizationJsonLd has required schema.org fields", () => {
  const result = organizationJsonLd();
  assert.equal(result["@type"], "Organization");
  assert.equal(result.url, SITE_URL);
  assert.equal(result.logo.width, 1400);
  assert.equal(result.logo.height, 367);
});

test("organizationJsonLd omits sameAs — the site has no verified profiles to claim", () => {
  assert.equal("sameAs" in organizationJsonLd(), false);
});

test("websiteJsonLd has required schema.org fields", () => {
  assert.equal(websiteJsonLd()["@type"], "WebSite");
});

test("websiteJsonLd advertises the search route that actually exists", () => {
  const result = websiteJsonLd();
  assert.equal(result.potentialAction["@type"], "SearchAction");
  assert.equal(result.potentialAction.target.urlTemplate, `${SITE_URL}/search?q={search_term_string}`);
  assert.equal(result.potentialAction["query-input"], "required name=search_term_string");
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

test("itemListJsonLd counts only what the page actually lists", () => {
  const result = itemListJsonLd([
    { name: "One", path: "/articles/one" },
    { name: "Two", path: "/articles/two" },
  ]);
  assert.equal(result.numberOfItems, 2);
  assert.equal(result.itemListElement[1].position, 2);
  assert.equal(result.itemListElement[1].url, `${SITE_URL}/articles/two`);
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
  const result = productJsonLd({
    name: "Widget",
    slug: "widget",
    summary: "A widget.",
    manufacturerName: "Acme",
    modelNumber: "WGT-1",
    releaseDate: "2026-01-01",
    categoryName: "Computing",
    image: { url: "https://cdn.example/widget.jpg" },
  });
  assert.equal("aggregateRating" in result, false);
  assert.equal("offers" in result, false);
  assert.equal("review" in result, false);
  assert.equal("price" in result, false);
});

// product_offers has no price column at all — only a free-text price_note —
// so a fully-populated product must still emit no offer.
test("productJsonLd emits mpn (a real manufacturer part number) and never sku (this site sells nothing)", () => {
  const result = productJsonLd({ name: "Widget", slug: "widget", summary: null, modelNumber: "WGT-1" });
  assert.equal(result.mpn, "WGT-1");
  assert.equal("sku" in result, false);
});

test("productJsonLd carries real catalogue fields when present and omits them when not", () => {
  const full = productJsonLd({
    name: "Widget",
    slug: "widget",
    summary: null,
    releaseDate: "2026-01-01",
    categoryName: "Computing",
    image: { url: "https://cdn.example/widget.jpg" },
  });
  assert.equal(full.releaseDate, "2026-01-01");
  assert.equal(full.category, "Computing");
  assert.deepEqual(full.image, ["https://cdn.example/widget.jpg"]);

  const bare = productJsonLd({ name: "Widget", slug: "widget", summary: null });
  assert.equal(bare.releaseDate, undefined);
  assert.equal(bare.category, undefined);
  assert.equal(bare.image, undefined);
});

test("articleJsonLd falls back to publishedAt when no updatedAt given", () => {
  const result = articleJsonLd({ title: "T", slug: "t", publishedAt: "2026-01-01T00:00:00Z" });
  assert.equal(result.dateModified, "2026-01-01T00:00:00Z");
});

test("articleJsonLd uses NewsArticle only for genuine news items", () => {
  assert.equal(articleJsonLd({ title: "T", slug: "t", publishedAt: null, contentType: "news" })["@type"], "NewsArticle");
  assert.equal(articleJsonLd({ title: "T", slug: "t", publishedAt: null, contentType: "guide" })["@type"], "Article");
});

// schema.org/Review REQUIRES a reviewRating. This site publishes no scores,
// so a 'review' content item must stay an Article rather than become a Review
// with an invented rating attached.
test("articleJsonLd never emits Review or any rating for type = 'review'", () => {
  const result = articleJsonLd({ title: "T", slug: "t", publishedAt: null, contentType: "review" });
  assert.equal(result["@type"], "Article");
  assert.equal("reviewRating" in result, false);
  assert.equal("aggregateRating" in result, false);
});

test("articleJsonLd attributes authorship to the Organization, never an invented person", () => {
  const result = articleJsonLd({ title: "T", slug: "t", publishedAt: null });
  assert.deepEqual(result.author, { "@id": ORGANIZATION_ID });
  assert.deepEqual(result.publisher, { "@id": ORGANIZATION_ID });
});

// The byline rule, in the one place it can be tested without a database: a
// Person appears if and only if the caller was handed a real author record.
// getArticleDetail only produces one when content_items.author_id is set AND
// the matching author_profiles row is is_public.
test("articleJsonLd names a Person as AUTHOR only when a person actually wrote it", () => {
  // This test previously asserted the opposite, and the assertion was the bug:
  // it locked in `author: Person` for a corpus drafted with machine assistance
  // and merely reviewed by a person. Both the page and the structured data made
  // the same untrue claim, so the test passing meant nothing.
  const anonymous = articleJsonLd({ title: "T", slug: "t", publishedAt: null, author: null });
  assert.deepEqual(anonymous.author, { "@id": ORGANIZATION_ID });

  // A named person WITHOUT an attribution defaults to reviewed_published, so
  // the publication is the author and the person is the editor.
  const reviewed = articleJsonLd({
    title: "T",
    slug: "t",
    publishedAt: null,
    author: { name: "A Contributor", role: "Contributor" },
  });
  assert.deepEqual(reviewed.author, { "@id": ORGANIZATION_ID }, "a reviewer is not the author");
  assert.equal((reviewed.editor as { "@type": string })["@type"], "Person");
  assert.equal((reviewed.editor as { name: string }).name, "A Contributor");
  assert.equal((reviewed.editor as { jobTitle?: string }).jobTitle, "Contributor");

  // Only an explicit `authored` makes the person the author.
  const written = articleJsonLd({
    title: "T",
    slug: "t",
    publishedAt: null,
    author: { name: "A Contributor", role: "Contributor" },
    attribution: "authored",
  });
  assert.equal((written.author as { "@type": string })["@type"], "Person");
  assert.equal((written.author as { name: string }).name, "A Contributor");
  // Not the publisher, so it must NOT claim the publisher's node identity.
  assert.equal("@id" in (written.author as object), false);
  assert.equal(written.editor, undefined, "the author is not separately the editor");
});

test("an unattributed piece names no person at all", () => {
  const r = articleJsonLd({
    title: "T",
    slug: "t",
    publishedAt: null,
    author: { name: "A Contributor" },
    attribution: "unattributed",
  });
  assert.deepEqual(r.author, { "@id": ORGANIZATION_ID });
  assert.equal(r.editor, undefined);
});

test("articleJsonLd reuses the publisher's Person node wherever that person appears", () => {
  // Same human, same node — whether they appear as editor (the default) or as
  // author. Two similarly-named nodes would describe two people.
  const reviewed = articleJsonLd({
    title: "T", slug: "t", publishedAt: null, author: { name: PUBLISHER_NAME },
  });
  assert.equal((reviewed.editor as { "@id": string })["@id"], PUBLISHER_PERSON_ID);

  const written = articleJsonLd({
    title: "T", slug: "t", publishedAt: null,
    author: { name: PUBLISHER_NAME }, attribution: "authored",
  });
  assert.equal((written.author as { "@id": string })["@id"], PUBLISHER_PERSON_ID);
});

// --- publisher identity ----------------------------------------------------

test("organizationJsonLd names the publisher and points at the editorial policy", () => {
  const result = organizationJsonLd();
  assert.equal(result.founder["@type"], "Person");
  assert.equal(result.founder.name, PUBLISHER_NAME);
  assert.equal(result.founder["@id"], PUBLISHER_PERSON_ID);
  assert.equal(result.publishingPrinciples, `${SITE_URL}/editorial-policy`);
});

test("publisherPersonJsonLd claims a name, a role and nothing else about the person", () => {
  const result = publisherPersonJsonLd();
  assert.equal(result["@type"], "Person");
  assert.equal(result.name, PUBLISHER_NAME);
  assert.deepEqual(result.worksFor, { "@id": ORGANIZATION_ID });
  // Every one of these would be a claim about a human being that nothing in
  // this codebase can support.
  for (const forbidden of ["sameAs", "alumniOf", "award", "knowsAbout", "hasCredential", "description"]) {
    assert.equal(forbidden in result, false, `publisherPersonJsonLd must not emit ${forbidden}`);
  }
});

test("articleJsonLd omits `about` entirely when no products are linked", () => {
  assert.equal(articleJsonLd({ title: "T", slug: "t", publishedAt: null, about: [] }).about, undefined);
  const withProducts = articleJsonLd({
    title: "T",
    slug: "t",
    publishedAt: null,
    about: [{ name: "Widget", slug: "widget" }],
  });
  assert.deepEqual(withProducts.about, [
    { "@type": "Product", name: "Widget", url: `${SITE_URL}/products/widget` },
  ]);
});

test("articleJsonLd omits wordCount and articleBody — neither is counted or needed", () => {
  const result = articleJsonLd({ title: "T", slug: "t", publishedAt: null });
  assert.equal("wordCount" in result, false);
  assert.equal("articleBody" in result, false);
});

test("safeJsonLdString: escapes '<' so a malicious field can't break out of the <script> tag", () => {
  const malicious = articleJsonLd({ title: "</script><script>alert(1)</script>", slug: "t", publishedAt: null });
  const output = safeJsonLdString(malicious);
  assert.equal(output.includes("</script>"), false);
  assert.equal(output.includes("\\u003c"), true);
  assert.equal(JSON.parse(output.replace(/\\u003c/g, "<")).headline, malicious.headline);
});

// --- collectionPageJsonLd (hub pages: product families, brands) ------------

test("collectionPageJsonLd nests its ItemList under mainEntity rather than floating free", () => {
  const result = collectionPageJsonLd({
    name: "Canon EOS 5D series",
    description: "Canon's flagship enthusiast full-frame DSLR line.",
    path: "/families/canon-eos-5d",
    items: [
      { name: "Canon EOS 5D", path: "/products/canon-eos-5d" },
      { name: "Canon EOS 5D Mark II", path: "/products/canon-eos-5d-mark-ii" },
    ],
    listName: "Canon EOS 5D coverage",
  });

  assert.equal(result["@type"], "CollectionPage");
  assert.equal(result.url, `${SITE_URL}/families/canon-eos-5d`);
  assert.deepEqual(result.isPartOf, { "@id": WEBSITE_ID });
  assert.equal(result.mainEntity["@type"], "ItemList");
  assert.equal(result.mainEntity.numberOfItems, 2);
  // The nested list must not restate @context — a nested node inherits the
  // document's context, and repeating it makes the graph ambiguous.
  assert.equal("@context" in result.mainEntity, false);
  assert.equal(result["@context"], "https://schema.org");
});

test("collectionPageJsonLd positions its items in render order", () => {
  const result = collectionPageJsonLd({
    name: "Hub",
    path: "/families/x",
    items: [
      { name: "First", path: "/products/first" },
      { name: "Second", path: "/products/second" },
    ],
  });
  assert.deepEqual(
    result.mainEntity.itemListElement.map((i) => [i.position, i.name, i.url]),
    [
      [1, "First", `${SITE_URL}/products/first`],
      [2, "Second", `${SITE_URL}/products/second`],
    ]
  );
});

test("collectionPageJsonLd omits description rather than inventing one", () => {
  const result = collectionPageJsonLd({ name: "Hub", description: null, path: "/families/x", items: [] });
  assert.equal("description" in result, false);
});

test("collectionPageJsonLd never fabricates ratings, prices or counts beyond the list it was given", () => {
  const result = collectionPageJsonLd({
    name: "Hub",
    path: "/families/x",
    items: [{ name: "Only", path: "/products/only" }],
  });
  for (const field of ["aggregateRating", "offers", "price", "review", "reviewCount"]) {
    assert.equal(field in result, false, `${field} must never appear on a hub page`);
  }
  // numberOfItems is the length of the list ON THIS PAGE, never a catalogue total.
  assert.equal(result.mainEntity.numberOfItems, 1);
});
