import type { Metadata } from "next";
import Link from "next/link";
import { buildMetadata } from "@/lib/seo/metadata";
import { getPublishedContentPage } from "@/lib/public/content-list";
import { Breadcrumbs } from "@/components/public/breadcrumbs";
import { ContentCard } from "@/components/public/cards";
import { PublicPagination } from "@/components/public/pagination";
import { EmptyState } from "@/components/shared/ui";
import type { ContentType } from "@/lib/types/database";

const TYPE_FILTERS: { label: string; value: ContentType | "" }[] = [
  { label: "All", value: "" },
  { label: "Reviews", value: "review" },
  { label: "Guides", value: "guide" },
  { label: "Comparisons", value: "comparison" },
  { label: "News", value: "news" },
];

export const metadata: Metadata = buildMetadata({
  title: "Articles",
  description: "Reviews, guides, comparisons, and news from Tech Carvalho.",
  path: "/articles",
});

export default async function ArticlesIndexPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; type?: string }>;
}) {
  const { page: rawPage, type: rawType } = await searchParams;
  const page = Math.max(1, Number(rawPage) || 1);
  const type = TYPE_FILTERS.some((f) => f.value === rawType) && rawType ? (rawType as ContentType) : undefined;
  const { content, total, pageCount } = await getPublishedContentPage(page, type);

  return (
    <div className="mx-auto max-w-6xl px-6 py-12">
      <Breadcrumbs items={[{ name: "Home", path: "/" }, { name: "Articles", path: "/articles" }]} />
      <h1 className="font-display text-3xl font-bold tracking-tight text-zinc-900 mb-2">Articles</h1>
      <p className="text-zinc-500 mb-6">{total > 0 ? `${total} published piece${total === 1 ? "" : "s"}` : "Nothing published yet."}</p>

      <div className="flex flex-wrap gap-2 mb-10">
        {TYPE_FILTERS.map((f) => (
          <Link
            key={f.value}
            href={f.value ? `/articles?type=${f.value}` : "/articles"}
            className={`rounded-full px-4 py-1.5 text-sm font-medium ${
              (type ?? "") === f.value ? "bg-zinc-900 text-white" : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
            }`}
          >
            {f.label}
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
          <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {content.map((item) => (
              <li key={item.id}>
                <ContentCard
                  href={`/articles/${item.slug}`}
                  type={item.type}
                  title={item.title}
                  publishedAt={item.published_at}
                  excerpt={item.excerpt}
                />
              </li>
            ))}
          </ul>
          <PublicPagination page={page} pageCount={pageCount} basePath="/articles" searchParams={{ type }} />
        </>
      )}
    </div>
  );
}
