import type { Metadata } from "next";
import { SITE_NAME, SITE_TAGLINE, SITE_URL, absoluteUrl } from "./site.ts";

// For a genuine 404 on a dynamic entity (/products/[slug] etc. with no
// matching row). Two things this exists to control:
//
// 1. `robots`: Next.js itself always injects its own bare `noindex` on any
//    notFound()-triggered render, on top of whatever metadata the segment
//    provides — that's a framework behavior, not something we can suppress.
//    Without our own override here, the *inherited* root-layout robots
//    (index:true, follow:true) would also apply, producing a genuinely
//    conflicting pair of tags (one says index, one says noindex). Setting
//    our own noindex/nofollow here removes that conflict — both tags then
//    say noindex, which is redundant but not contradictory.
//
// 2. `alternates.canonical`: Next inherits the parent segment's canonical
//    (the root layout's, i.e. "/") when a segment doesn't set its own —
//    omitting it here is NOT the same as having no canonical, it silently
//    points at the homepage, which is misleading for e.g. a dead product
//    URL. Pass `canonicalPath` (a real, existing page — typically that
//    entity type's index page) so the 404 self-canonicalizes to the
//    closest legitimate content instead of falsely claiming the homepage
//    is the authoritative version of a nonexistent product/article/
//    manufacturer. Omit it only for the true site-wide 404 (unmatched
//    routes), where "/" genuinely is the right fallback.
export function buildNotFoundMetadata(canonicalPath?: string): Metadata {
  return {
    // `absolute` for the same reason as buildMetadata below — without it the
    // root layout's `%s | Tech Carvalho` template appends a second suffix.
    title: { absolute: `Not found | ${SITE_NAME}` },
    description: SITE_TAGLINE,
    robots: { index: false, follow: false },
    ...(canonicalPath ? { alternates: { canonical: absoluteUrl(canonicalPath) } } : {}),
  };
}

export type PageImage = { url: string; alt?: string | null } | null;

export function buildMetadata({
  title,
  description,
  path,
  noindex = false,
  follow = true,
  image,
  canonicalUrl,
  openGraphType = "website",
  publishedTime,
  modifiedTime,
  section,
}: {
  title: string;
  description?: string;
  path: string;
  noindex?: boolean;
  // Only meaningful alongside `noindex`. A page can be worth keeping out of
  // the index while still being worth crawling for the links it carries —
  // a filter facet on /products, say, whose product links are the point.
  // `noindex, nofollow` on such a page strands everything it links to.
  follow?: boolean;
  // Absolute or root-relative URL of a real hero image for this specific
  // page (product/article). Omit when none exists — the root
  // opengraph-image.tsx file convention already supplies a site-wide
  // fallback for any page that doesn't set its own, so leaving this unset
  // is not "no image", just "use the default".
  image?: PageImage;
  // An editor-set cross-canonical from seo_metadata.canonical_url. When a
  // row carries one, the page must NOT self-canonicalize — the whole point
  // of the column is to point somewhere else. Anything falsy falls back to
  // the self-referencing canonical, which is the right default.
  canonicalUrl?: string | null;
  // "article" unlocks the og:article:* time fields below. Only pass it for
  // pages that are genuinely an article — a hub listing articles is not one.
  openGraphType?: "website" | "article";
  publishedTime?: string | null;
  modifiedTime?: string | null;
  section?: string | null;
}): Metadata {
  const fullTitle = title === SITE_NAME ? title : `${title} | ${SITE_NAME}`;
  const desc = description ?? SITE_TAGLINE;
  const url = absoluteUrl(path);
  const canonical = normalizeCanonical(canonicalUrl) ?? url;
  const ogImages = image ? [{ url: image.url, alt: image.alt ?? fullTitle }] : undefined;

  return {
    // `absolute`, not a bare string. The root layout declares
    // `title.template: "%s | Tech Carvalho"`, and Next applies a parent
    // template to any child segment that returns a plain string title —
    // so returning "Products | Tech Carvalho" here rendered
    // "<title>Products | Tech Carvalho | Tech Carvalho</title>" on every
    // single page of the site. `absolute` opts out of the parent template,
    // which is exactly what a title that already carries the suffix wants.
    title: { absolute: fullTitle },
    description: desc,
    alternates: { canonical },
    robots: { index: !noindex, follow },
    openGraph: {
      title: fullTitle,
      description: desc,
      url: canonical,
      siteName: SITE_NAME,
      ...(openGraphType === "article"
        ? {
            type: "article" as const,
            ...(publishedTime ? { publishedTime } : {}),
            ...(modifiedTime ? { modifiedTime } : {}),
            ...(section ? { section } : {}),
          }
        : { type: "website" as const }),
      ...(ogImages ? { images: ogImages } : {}),
    },
    twitter: {
      card: image ? "summary_large_image" : "summary",
      title: fullTitle,
      description: desc,
      ...(ogImages ? { images: ogImages } : {}),
    },
  };
}

// seo_metadata.canonical_url is free text typed by an editor. A malformed or
// off-site value must not silently become this page's canonical: pointing a
// canonical at a domain we don't control de-indexes the page in favour of
// someone else's. Accept only a well-formed URL on our own origin, or a
// root-relative path; anything else is ignored and the caller falls back to
// the self-referencing canonical.
export function normalizeCanonical(value: string | null | undefined): string | null {
  const raw = value?.trim();
  if (!raw) return null;
  if (raw.startsWith("/")) return absoluteUrl(raw);
  try {
    const parsed = new URL(raw);
    if (parsed.origin !== new URL(SITE_URL).origin) return null;
    return parsed.toString().replace(/\/$/, "") || SITE_URL;
  } catch {
    return null;
  }
}

// Builds the canonical query string for a hub page from an allow-list of
// params the route actually understands, in a fixed order.
//
// This is the duplicate-content control for the list pages. Every one of
// /articles?utm_source=x, /articles?fbclid=y, /articles?type=guide&page=1 and
// /articles?page=1&type=guide is the same page as one of a much smaller set
// of real URLs; without normalization each junk variant that ever gets linked
// becomes its own crawlable, self-canonicalizing duplicate. Unknown params
// are dropped, empty values are dropped, and page=1 is dropped (it is the
// unfiltered first page, which lives at the bare path).
export function canonicalPathWithParams(
  basePath: string,
  params: Record<string, string | number | undefined | null>,
  order: string[]
): string {
  const search = new URLSearchParams();
  for (const key of order) {
    const value = params[key];
    if (value === undefined || value === null) continue;
    const asString = String(value).trim();
    if (!asString) continue;
    if (key === "page" && asString === "1") continue;
    search.set(key, asString);
  }
  const qs = search.toString();
  return qs ? `${basePath}?${qs}` : basePath;
}
