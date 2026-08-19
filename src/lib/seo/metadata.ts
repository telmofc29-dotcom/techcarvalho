import type { Metadata } from "next";
import { SITE_NAME, SITE_TAGLINE, absoluteUrl } from "./site";

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
