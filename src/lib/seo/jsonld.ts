import { SITE_NAME, SITE_TAGLINE, SITE_URL, absoluteUrl } from "./site.ts";
import {
  PUBLISHER_NAME,
  PUBLISHER_ROLE,
  PUBLISHER_PERSON_ID,
  PUBLISHER_PAGE,
} from "./publisher.ts";

// JSON.stringify doesn't escape "<" — if any field ever contains
// "</script>" (e.g. an admin-authored title), that would close the script
// tag early and let the rest of the string execute as HTML/script. Every
// dangerouslySetInnerHTML call that embeds JSON-LD must go through this,
// not JSON.stringify directly.
export function safeJsonLdString(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

// ---------------------------------------------------------------------------
// THE RULE FOR THIS FILE
//
// Only ever emit a field the database can actually back. No aggregateRating,
// no reviewCount, no price, no availability, no author we cannot name, no
// wordCount we did not count. Structured data is a claim made to a search
// engine in a machine-readable form; a claim we can't support is a lie that
// happens to also be a manual-action risk. If a field would need inventing,
// omit the field — and if that leaves a type without its required fields,
// omit the type. (That last rule is why a `review` content item is emitted as
// an Article and not as a schema.org Review: Review REQUIRES reviewRating,
// and this site does not score products.)
//
// Organization/WebSite are wired into the public layout, BreadcrumbList into
// <Breadcrumbs>, Product/Article into their detail pages, ItemList into the
// hub pages.
// ---------------------------------------------------------------------------

// Stable node identities so the graph cross-references one Organization
// rather than restating it (as publisher, as author, as brand owner) in
// every document.
export const ORGANIZATION_ID = `${SITE_URL}/#organization`;
export const WEBSITE_ID = `${SITE_URL}/#website`;

export function organizationJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": ORGANIZATION_ID,
    name: SITE_NAME,
    url: SITE_URL,
    description: SITE_TAGLINE,
    // Real dimensions of the real file in public/brand — verified, not
    // guessed. Google's logo guidance wants the intrinsic size to match.
    logo: {
      "@type": "ImageObject",
      url: absoluteUrl("/brand/logo-full-trimmed.png"),
      width: 1400,
      height: 367,
    },
    // The named human behind the publication. Until this existed, the graph
    // said a company published these articles and never said who that was —
    // and articleJsonLd's own comment explains why it could not: admin_users
    // is not readable by `anon`, so there was no name to emit. The name now
    // comes from one place (lib/seo/publisher.ts), the same place /about, the
    // footer and the byline read from, so the graph and the page cannot drift
    // apart.
    //
    // `founder` is the only relationship claimed. NOT `employee` (he is not
    // employed by it) and NOT any credential, qualification or expertise
    // claim — none is known to this codebase and none is emitted.
    founder: {
      "@type": "Person",
      "@id": PUBLISHER_PERSON_ID,
      name: PUBLISHER_NAME,
      jobTitle: PUBLISHER_ROLE,
      url: absoluteUrl(PUBLISHER_PAGE),
    },
    // A real, substantive page describing how the site works, including what
    // it does not do. Not a boilerplate URL: /editorial-policy states in
    // writing that the site publishes no hands-on testing.
    publishingPrinciples: absoluteUrl("/editorial-policy"),
    // No `sameAs`: this publication has no verified social profiles yet, and
    // linking to accounts we don't control (or don't have) is exactly the
    // kind of unbacked claim this file exists to refuse.
  };
}

// The publisher as a standalone Person node, for the page whose subject IS
// the publisher (/about). `worksFor` points back at the one Organization node
// rather than restating the publication.
//
// No `sameAs`, no `alumniOf`, no `award`, no `knowsAbout`: every one of those
// would be a claim about a person that this codebase cannot support.
export function publisherPersonJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "Person",
    "@id": PUBLISHER_PERSON_ID,
    name: PUBLISHER_NAME,
    jobTitle: PUBLISHER_ROLE,
    url: absoluteUrl(PUBLISHER_PAGE),
    worksFor: { "@id": ORGANIZATION_ID },
  };
}

export function websiteJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": WEBSITE_ID,
    name: SITE_NAME,
    url: SITE_URL,
    description: SITE_TAGLINE,
    publisher: { "@id": ORGANIZATION_ID },
    // Backed by a real route: src/app/(public)/search/page.tsx reads ?q= and
    // searches products, content, manufacturers and categories. This is only
    // honest because that endpoint genuinely exists and works.
    potentialAction: {
      "@type": "SearchAction",
      target: {
        "@type": "EntryPoint",
        urlTemplate: absoluteUrl("/search?q={search_term_string}"),
      },
      "query-input": "required name=search_term_string",
    },
  };
}

export function breadcrumbJsonLd(items: { name: string; path: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: absoluteUrl(item.path),
    })),
  };
}

// A hub page's list of what it actually links to, in the order a visitor
// sees it. `numberOfItems` is the length of the list on THIS page — not a
// catalogue-wide total, which would be a different (and unverifiable from
// the markup) claim.
export function itemListJsonLd(
  items: { name: string; path: string }[],
  options?: { name?: string; description?: string }
) {
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    ...(options?.name ? { name: options.name } : {}),
    ...(options?.description ? { description: options.description } : {}),
    itemListOrder: "https://schema.org/ItemListOrderAscending",
    numberOfItems: items.length,
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      url: absoluteUrl(item.path),
    })),
  };
}

// A hub page whose whole purpose is to collect other pages: a product-family
// hub, a brand hub. `ItemList` on its own says "here is a list"; `CollectionPage`
// says "this page IS the collection", which is what makes the hub, rather than
// one of its members, the entity a crawler associates with the topic.
//
// The ItemList goes in `mainEntity` rather than being emitted as a second,
// free-floating top-level node, so the graph states which page the list belongs
// to instead of leaving two unrelated blobs on the same document.
//
// Only emitted by callers that have a non-empty list. A CollectionPage
// declaring a collection of nothing is a worse claim than no markup at all —
// same rule that keeps ItemList off the "Coming soon" category hubs.
export function collectionPageJsonLd({
  name,
  description,
  path,
  items,
  listName,
}: {
  name: string;
  description?: string | null;
  path: string;
  items: { name: string; path: string }[];
  listName?: string;
}) {
  const { "@context": _context, ...itemList } = itemListJsonLd(items, { name: listName });
  void _context;
  return {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name,
    ...(description ? { description } : {}),
    url: absoluteUrl(path),
    isPartOf: { "@id": WEBSITE_ID },
    mainEntity: itemList,
  };
}

export function productJsonLd(product: {
  name: string;
  slug: string;
  summary: string | null;
  manufacturerName?: string;
  // Real published hero image for this product, if it has one.
  image?: { url: string } | null;
  // products.model_number. Emitted as `mpn` (manufacturer part number) and
  // deliberately NOT as `sku` — a SKU is a *seller's* stock identifier and
  // this site does not sell anything, so claiming one would be false.
  modelNumber?: string | null;
  // products.release_date (a date column, so already YYYY-MM-DD).
  releaseDate?: string | null;
  // taxonomy_categories.name for the product's category.
  categoryName?: string | null;
}) {
  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    description: product.summary ?? undefined,
    brand: product.manufacturerName ? { "@type": "Brand", name: product.manufacturerName } : undefined,
    image: product.image?.url ? [product.image.url] : undefined,
    mpn: product.modelNumber ?? undefined,
    releaseDate: product.releaseDate ?? undefined,
    category: product.categoryName ?? undefined,
    url: absoluteUrl(`/products/${product.slug}`),
    // NO `offers`. product_offers rows carry a retailer, a URL and a free-text
    // `price_note` — never a machine-readable price/currency/availability. A
    // schema.org Offer without a price is both useless to Google and an open
    // invitation to invent one later; the honest move is to omit the property
    // entirely rather than emit a hollow Offer. Same for aggregateRating and
    // review: this site publishes no ratings.
  };
}

// `review` content is deliberately NOT schema.org/Review — see the file
// header. NewsArticle is used only for genuinely time-sensitive news items,
// which is what content_items.type = 'news' means.
function articleTypeFor(contentType: string | undefined): "NewsArticle" | "Article" {
  return contentType === "news" ? "NewsArticle" : "Article";
}

export function articleJsonLd(article: {
  title: string;
  slug: string;
  publishedAt: string | null;
  updatedAt?: string | null;
  // content_items.type
  contentType?: string;
  // seo_metadata.meta_description, when the editor wrote one.
  description?: string | null;
  image?: { url: string } | null;
  // The article's taxonomy category name, when it has one.
  section?: string | null;
  // Products this article is genuinely linked to via content_products.
  about?: { name: string; slug: string }[];
  /**
   * The named author, ONLY when a real, publicly-published author record backs
   * it: content_items.author_id set, and a matching author_profiles row with
   * is_public = true. Absent (undefined/null) means no such record exists, and
   * the Organization stays the author — see the note below. There is no code
   * path anywhere that manufactures this value.
   */
  author?: { name: string; role?: string | null } | null;
}) {
  const url = absoluteUrl(`/articles/${article.slug}`);
  // Same person, same node: when the byline is the site's publisher, reuse the
  // Person @id that organizationJsonLd already emits so the graph links one
  // human to the publication instead of describing two similarly-named ones.
  const authorNode = article.author
    ? {
        "@type": "Person" as const,
        ...(article.author.name === PUBLISHER_NAME ? { "@id": PUBLISHER_PERSON_ID } : {}),
        name: article.author.name,
        ...(article.author.role ? { jobTitle: article.author.role } : {}),
      }
    : { "@id": ORGANIZATION_ID };
  return {
    "@context": "https://schema.org",
    "@type": articleTypeFor(article.contentType),
    headline: article.title,
    description: article.description ?? undefined,
    image: article.image?.url ? [article.image.url] : undefined,
    datePublished: article.publishedAt ?? undefined,
    dateModified: article.updatedAt ?? article.publishedAt ?? undefined,
    // A Person when — and only when — a real author record exists; otherwise
    // the Organization, exactly as before.
    //
    // The original reason for organization-as-author still stands and is worth
    // keeping: content_items.author_id points at admin_users, whose RLS policy
    // is "admins can read own row", so `anon` cannot read a display name and
    // naming an individual from that table would mean inventing one. The fix
    // was not to relax that policy — it was public.author_profiles
    // (supabase/migrations_pending/20260825_author_profiles.sql), a separate,
    // opt-in, publicly-readable editorial identity. No record, no Person.
    author: authorNode,
    publisher: { "@id": ORGANIZATION_ID },
    isPartOf: { "@id": WEBSITE_ID },
    mainEntityOfPage: { "@type": "WebPage", "@id": url },
    articleSection: article.section ?? undefined,
    about:
      article.about && article.about.length > 0
        ? article.about.map((p) => ({
            "@type": "Product",
            name: p.name,
            url: absoluteUrl(`/products/${p.slug}`),
          }))
        : undefined,
    url,
    // NO wordCount (never counted), NO articleBody (the page already carries
    // it), NO aggregateRating/reviewRating even on type = 'review'.
  };
}
