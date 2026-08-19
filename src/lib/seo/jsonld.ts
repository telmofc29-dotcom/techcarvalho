import { SITE_NAME, SITE_URL, absoluteUrl } from "./site";

// JSON-LD builders. Only Organization and WebSite are wired into pages
// currently. Article/Product builders are provided as ready hooks for when
// individual content/product detail pages are built out — they are not
// referenced anywhere yet, so no schema is emitted for content that doesn't
// exist.

export function organizationJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: SITE_NAME,
    url: SITE_URL,
  };
}

export function websiteJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: SITE_NAME,
    url: SITE_URL,
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

// Future hook: call once product detail pages render real, published data.
export function productJsonLd(product: {
  name: string;
  slug: string;
  summary: string | null;
  manufacturerName?: string;
}) {
  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    description: product.summary ?? undefined,
    brand: product.manufacturerName ? { "@type": "Brand", name: product.manufacturerName } : undefined,
    url: absoluteUrl(`/products/${product.slug}`),
  };
}

// Future hook: call once content detail pages render real, published data.
export function articleJsonLd(article: {
  title: string;
  slug: string;
  publishedAt: string | null;
  updatedAt?: string | null;
}) {
  return {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: article.title,
    datePublished: article.publishedAt ?? undefined,
    dateModified: article.updatedAt ?? article.publishedAt ?? undefined,
    url: absoluteUrl(`/articles/${article.slug}`),
  };
}
