import type { Metadata } from "next";
import Link from "next/link";
import { buildMetadata, canonicalPathWithParams } from "@/lib/seo/metadata";
import { itemListJsonLd, safeJsonLdString } from "@/lib/seo/jsonld";
import { getPublishedContentPage } from "@/lib/public/content-list";
import { Breadcrumbs } from "@/components/public/breadcrumbs";
import { ContentCard } from "@/components/public/cards";
import { PublicPagination } from "@/components/public/pagination";
import { EmptyState } from "@/components/shared/ui";
import { PageViewTracker } from "@/components/analytics/page-view-tracker";
import { InternalLinkTracker } from "@/components/analytics/internal-link-tracker";
import { ARTICLE_HUBS, findArticleHub } from "@/lib/public/article-hubs";

const ALL_ARTICLES = {
  title: "Articles",
  description: "Reviews, guides, comparisons, news, and troubleshooting from Tech Carvalho.",
};

// An unrecognised ?type= is dropped rather than passed through, so
// /articles?type=nonsense resolves to the unfiltered hub and canonicalises to
// /articles instead of becoming its own self-canonicalizing URL.
function resolveArticleParams(raw: { page?: string; type?: string }) {
  const page = Math.max(1, Number(raw.page) || 1);
  const hub = findArticleHub(raw.type);
  return { page, hub, type: hub?.type };
}

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; type?: string }>;
}): Promise<Metadata> {
  const { page, type, hub } = resolveArticleParams(await searchParams);
  const base = hub ?? ALL_ARTICLES;

  return buildMetadata({
    // Page number belongs in the title so paginated pages are not five
    // identical <title>s competing with each other.
    title: page > 1 ? `${base.title} — page ${page}` : base.title,
    description: base.description,
    // Self-referencing, and normalized: unknown params (utm_*, fbclid, a
    // mistyped type=) are dropped, param order is fixed, and page=1 collapses
    // to the bare path. Without this every tracked inbound link created a
    // separate self-canonicalizing duplicate of this hub.
    path: canonicalPathWithParams("/articles", { type, page }, ["type", "page"]),
  });
}

export default async function ArticlesIndexPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; type?: string }>;
}) {
  const { page, type, hub } = resolveArticleParams(await searchParams);
  const { content, total, pageCount } = await getPublishedContentPage(page, type);
  const heading = hub?.title ?? ALL_ARTICLES.title;

  return (
    <div className="mx-auto max-w-6xl px-6 py-12">
      <PageViewTracker />
      {/* Only the items actually rendered on this page, in render order. */}
      {content.length > 0 && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: safeJsonLdString(
              itemListJsonLd(
                content.map((item) => ({ name: item.title, path: `/articles/${item.slug}` })),
                { name: heading }
              )
            ),
          }}
        />
      )}
      <Breadcrumbs
        items={[
          { name: "Home", path: "/" },
          { name: "Articles", path: "/articles" },
          ...(type ? [{ name: heading, path: `/articles?type=${type}` }] : []),
        ]}
      />
      {/* The h1 tracks the filter. It previously read "Articles" on every one
          of these six views, so the type hubs had no on-page signal of what
          they were about beyond the cards themselves. */}
      <h1 className="font-display text-3xl font-bold tracking-tight text-zinc-900 mb-2">{heading}</h1>
      <p className="text-zinc-500 mb-6">
        {total > 0
          ? `${total} published piece${total === 1 ? "" : "s"}${pageCount > 1 ? ` · page ${page} of ${pageCount}` : ""}`
          : "Nothing published yet."}
      </p>

      {/* A hub with its own description reads as a page about something
          rather than as a filtered list, and gives the <meta description> a
          visible on-page counterpart. */}
      <p className="max-w-2xl text-zinc-600 mb-8">{hub?.description ?? ALL_ARTICLES.description}</p>

      <div className="flex flex-wrap gap-2 mb-10">
        <Link
          href="/articles"
          className={`rounded-full px-4 py-1.5 text-sm font-medium ${
            type ? "bg-zinc-100 text-zinc-600 hover:bg-zinc-200" : "bg-zinc-900 text-white"
          }`}
        >
          All
        </Link>
        {ARTICLE_HUBS.map((f) => (
          <Link
            key={f.type}
            href={`/articles?type=${f.type}`}
            className={`rounded-full px-4 py-1.5 text-sm font-medium ${
              type === f.type ? "bg-zinc-900 text-white" : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
            }`}
          >
            {f.title}
          </Link>
        ))}
      </div>

      {content.length === 0 ? (
        <EmptyState
          title="Nothing published yet"
          description="Reviews, guides, comparisons, and news will appear here as they're published."
        />
      ) : (
        <>
          <InternalLinkTracker linkPosition="category_page">
            <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {content.map((item) => (
                <li key={item.id} data-entity-type="content" data-entity-id={item.id}>
                  <ContentCard
                    href={`/articles/${item.slug}`}
                    type={item.type}
                    title={item.title}
                    publishedAt={item.published_at}
                    excerpt={item.excerpt}
                    imageUrl={item.heroImage?.url}
                    imageAlt={item.heroImage?.alt}
                  />
                </li>
              ))}
            </ul>
          </InternalLinkTracker>
          <PublicPagination page={page} pageCount={pageCount} basePath="/articles" searchParams={{ type }} />
        </>
      )}
    </div>
  );
}
