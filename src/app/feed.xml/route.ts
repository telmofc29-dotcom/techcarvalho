import { createClient } from "@/lib/supabase/server";
import { logQueryError } from "@/lib/log/query-error";
import { absoluteUrl, SITE_URL, SITE_NAME, SITE_TAGLINE } from "@/lib/seo/site";
import { buildFeed, type FeedItem } from "@/lib/seo/feed";
import { ROOT_LOCALE } from "@/lib/i18n/locales";
import { attachExcerpts } from "@/lib/public/excerpt";

// THE SITE FEED.
//
// One feed, at /feed.xml, carrying the most recent published articles. Per
// category feeds are deliberately NOT added yet: most categories have single
// figures of published articles, and a feed per section would mostly serve
// near-empty documents that suggest more coverage than exists. When a section
// has enough material to be worth subscribing to on its own, this same builder
// serves it.
//
// PUBLICATION RULES ARE THE SAME AS EVERY OTHER PUBLIC SURFACE.
// status='published' AND published_at <= now(). A feed is a public surface, so
// a scheduled article must not leak through it ahead of its date — that would
// make the feed the one place the embargo does not hold.
//
// EMPTY IS NOT THE SAME AS FAILED. A query error returns 503 rather than an
// empty feed: an empty document tells every aggregator this publication has
// nothing, and they cache that. This is the same rule the public pages follow.

/** Enough to be useful to a reader, small enough to stay a cheap response. */
const FEED_LIMIT = 40;

/** Cached at the edge for an hour; a feed does not need to be to-the-second. */
export const revalidate = 3600;

export async function GET(): Promise<Response> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("content_items")
    .select("id, title, slug, published_at, updated_at")
    .eq("locale", ROOT_LOCALE)
    .eq("status", "published")
    .lte("published_at", new Date().toISOString())
    .order("published_at", { ascending: false })
    .limit(FEED_LIMIT);

  if (error) {
    logQueryError("feed.xml", error);
    // A failure must not be served as "we have published nothing".
    return new Response("Feed temporarily unavailable.", {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    });
  }

  const rows = (data ?? []) as {
    id: string; title: string; slug: string; published_at: string | null;
  }[];

  // There is no summary column on content_items. The editorial excerpt is the
  // meta description in seo_metadata, and attachExcerpts is the existing way
  // to read it — reused rather than re-queried so the feed and the cards
  // cannot disagree about what an article's excerpt is.
  const withExcerpts = await attachExcerpts(supabase, rows);

  const items: FeedItem[] = withExcerpts.map((r) => ({
    title: r.title,
    url: absoluteUrl(`/articles/${r.slug}`),
    // The excerpt when there is one, the title when there is not. No invented
    // teaser: a description restating the title is honest, one promising
    // detail the article may not contain is not.
    description: r.excerpt?.trim() || r.title,
    publishedAt: r.published_at,
  }));

  const xml = buildFeed(items, {
    title: SITE_NAME,
    siteUrl: SITE_URL,
    feedUrl: absoluteUrl("/feed.xml"),
    description: SITE_TAGLINE,
  });

  return new Response(xml, {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      "Cache-Control": "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400",
    },
  });
}
