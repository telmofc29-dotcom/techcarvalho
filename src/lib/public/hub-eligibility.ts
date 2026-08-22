// ---------------------------------------------------------------------------
// When does a hub page deserve to be in the index?
//
// The site already learned this lesson once: 15 manufacturer routes existed the
// moment an admin added a brand row, 14 of them rendered "No published products
// yet", and all 15 were submitted to Google (docs/seo-architecture.md §4). The
// fix then was to gate on "has published products". That gate is correct but
// too narrow — it treats a brand with ten published articles and no published
// product as thin, which it plainly is not.
//
// These predicates are the single definition of "this hub has earned its
// place", shared by the page (which sets `noindex`) and by sitemap.ts (which
// decides whether to submit it). Two copies would drift, and the failure mode
// of drift is a sitemap advertising a URL that renders `noindex` — the fastest
// way to teach a crawler to distrust the file.
//
// Pure and dependency-free so the thresholds are unit-testable.
// ---------------------------------------------------------------------------

// A brand page with one or two loosely-tagged articles and no catalogue is
// still a thin page. Three is the point at which it reads as coverage rather
// than as a stub. Judgement, not a schema constraint — change it here, not at
// a call site.
export const MIN_HUB_ARTICLES = 3;

// A family hub carrying a single product and nothing else is a worse version
// of that product's own page. It needs either a second body to compare
// against, or real editorial coverage of the line.
export const MIN_FAMILY_PRODUCTS = 2;
export const MIN_FAMILY_ARTICLES_WITH_ONE_PRODUCT = 2;

export type HubMaterial = {
  /** Published products the hub actually renders links to. Never unpublished ones. */
  productCount: number;
  /** Published articles the hub actually renders links to. */
  articleCount: number;
};

// A brand hub: real as soon as it has any published product (the original
// rule, unchanged), or enough published coverage to stand on its own.
export function isManufacturerHubIndexable({ productCount, articleCount }: HubMaterial): boolean {
  return productCount > 0 || articleCount >= MIN_HUB_ARTICLES;
}

// A product-family hub: real when the line has at least two published bodies to
// compare, or one published body plus genuine published coverage of the line.
//
// Deliberately NOT "has any published article": most families in this catalogue
// are partly unpublished while media rights are cleared, and a page whose only
// content is two article links duplicates the category hub.
export function isFamilyHubIndexable({ productCount, articleCount }: HubMaterial): boolean {
  if (productCount >= MIN_FAMILY_PRODUCTS) return true;
  return productCount >= 1 && articleCount >= MIN_FAMILY_ARTICLES_WITH_ONE_PRODUCT;
}

// Whether a hub has anything at all to show. Distinct from indexability: a hub
// with one product is worth rendering and linking to internally, it just is not
// worth asking Google to index. Used to choose between the real page body and
// the EmptyState.
export function hubHasContent({ productCount, articleCount }: HubMaterial): boolean {
  return productCount > 0 || articleCount > 0;
}
