import type { Metadata } from "next";
import { SITE_NAME, SITE_TAGLINE, absoluteUrl } from "./site.ts";

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
    title: `Not found | ${SITE_NAME}`,
    description: SITE_TAGLINE,
    robots: { index: false, follow: false },
    ...(canonicalPath ? { alternates: { canonical: absoluteUrl(canonicalPath) } } : {}),
  };
}

export function buildMetadata({
  title,
  description,
  path,
  noindex = false,
}: {
  title: string;
  description?: string;
  path: string;
  noindex?: boolean;
}): Metadata {
  const fullTitle = title === SITE_NAME ? title : `${title} | ${SITE_NAME}`;
  const desc = description ?? SITE_TAGLINE;
  const url = absoluteUrl(path);

  return {
    title: fullTitle,
    description: desc,
    alternates: { canonical: url },
    robots: noindex ? { index: false, follow: false } : { index: true, follow: true },
    openGraph: {
      title: fullTitle,
      description: desc,
      url,
      siteName: SITE_NAME,
      type: "website",
    },
    twitter: {
      card: "summary",
      title: fullTitle,
      description: desc,
    },
  };
}
