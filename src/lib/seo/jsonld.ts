import { SITE_NAME, SITE_URL, absoluteUrl } from "./site.ts";

// JSON.stringify doesn't escape "<" — if any field ever contains
// "</script>" (e.g. an admin-authored title), that would close the script
// tag early and let the rest of the string execute as HTML/script. Every
// dangerouslySetInnerHTML call that embeds JSON-LD must go through this,
// not JSON.stringify directly.
export function safeJsonLdString(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

// JSON-LD builders. Organization/WebSite are wired into the public layout,
// BreadcrumbList into <Breadcrumbs>, Product/Article into their respective
// detail pages — see products/[slug]/page.tsx and articles/[slug]/page.tsx.

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
