import type { ContentType } from "@/lib/types/database";

// The /articles?type=… hubs.
//
// These are the one place on the site where a query parameter produces a page
// that genuinely deserves its own place in the index: "camera buying guides"
// and "camera reviews" are different search intents, and each hub carries its
// own title, description, h1, breadcrumb and self-referencing canonical.
//
// Lives in lib/ rather than beside the route because sitemap.ts needs the same
// list. Two copies of it would drift, and the failure mode of drift here is a
// sitemap advertising a hub the route does not recognise — which renders the
// unfiltered /articles list under a URL that canonicalises away, i.e. a
// crawl-budget hole that looks fine to a human clicking it.
export type ArticleHub = {
  type: ContentType;
  // Used for the tab label, the h1, the breadcrumb and the <title>.
  title: string;
  description: string;
};

export const ARTICLE_HUBS: ArticleHub[] = [
  {
    type: "review",
    title: "Reviews",
    description: "Hands-on product reviews from Tech Carvalho, each with its own sourcing and freshness record.",
  },
  {
    type: "guide",
    title: "Buying guides",
    description: "Buying guides and how-to explainers covering cameras, drones, computing, networking, and gaming.",
  },
  {
    type: "comparison",
    title: "Comparisons",
    description:
      "Head-to-head product comparisons — what actually differs between two pieces of kit, and which suits which use.",
  },
  {
    type: "news",
    title: "News",
    description: "Product launches, announcements, and firmware news across the categories Tech Carvalho covers.",
  },
  {
    type: "troubleshooting",
    title: "Troubleshooting",
    description: "Fixes and diagnostics for specific hardware problems, written from real reproduction rather than guesswork.",
  },
];

const HUB_BY_TYPE = new Map(ARTICLE_HUBS.map((hub) => [hub.type as string, hub]));

export function findArticleHub(type: string | undefined | null): ArticleHub | undefined {
  return type ? HUB_BY_TYPE.get(type) : undefined;
}
