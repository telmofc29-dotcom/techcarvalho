import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { buildMetadata } from "@/lib/seo/metadata";
import { articleJsonLd, safeJsonLdString } from "@/lib/seo/jsonld";
import { getArticleDetail } from "@/lib/public/article-detail";
import { Breadcrumbs } from "@/components/public/breadcrumbs";
import { ContentCard } from "@/components/public/cards";
import { RelatedContentTracker } from "@/components/public/related-content-tracker";
import { Badge } from "@/components/shared/ui";
import { parseBodyBlocks } from "@/lib/content/body-format";

const CONTENT_TYPE_LABEL: Record<string, string> = {
  review: "Review",
  guide: "Guide",
  comparison: "Comparison",
  news: "News",
  troubleshooting: "Troubleshooting",
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const detail = await getArticleDetail(slug);
  if (!detail) notFound();

  return buildMetadata({
    title: detail.seo?.meta_title ?? detail.content.title,
    description: detail.seo?.meta_description ?? undefined,
    path: `/articles/${slug}`,
  });
}

export default async function ArticlePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const detail = await getArticleDetail(slug);
  if (!detail) notFound();

  const { content, products, tags, freshness, related, heroImage } = detail;
  const lastVerified = freshness[0]?.reviewed_at ?? null;

  const jsonLd = articleJsonLd({
    title: content.title,
    slug: content.slug,
    publishedAt: content.published_at,
    updatedAt: content.updated_at,
  });

  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLdString(jsonLd) }}
      />
      <Breadcrumbs
        items={[
          { name: "Home", path: "/" },
          { name: "Articles", path: "/articles" },
          { name: CONTENT_TYPE_LABEL[content.type] ?? content.type, path: `/articles?type=${content.type}` },
          { name: content.title, path: `/articles/${content.slug}` },
        ]}
      />

      <div className="flex items-center gap-3 mb-4">
        <Badge tone="amber">{CONTENT_TYPE_LABEL[content.type] ?? content.type}</Badge>
        {content.published_at && (
          <time dateTime={content.published_at} className="text-sm text-zinc-500">
            Published{" "}
            {new Date(content.published_at).toLocaleDateString(undefined, {
              year: "numeric",
              month: "long",
              day: "numeric",
            })}
          </time>
        )}
      </div>

      <h1 className="font-display text-3xl sm:text-4xl font-bold tracking-tight text-zinc-900 mb-4">
        {content.title}
      </h1>

      {lastVerified && (
        <p className="text-xs text-zinc-400 mb-6">
          Last verified {new Date(lastVerified).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })}
        </p>
      )}

      {heroImage && (
        <div className="relative w-full aspect-video rounded-xl overflow-hidden bg-zinc-100 mb-8">
          <Image src={heroImage.url} alt={heroImage.alt ?? content.title} fill className="object-cover" />
        </div>
      )}

      {products.length > 0 && (
        <div className="rounded-xl border border-border-subtle bg-accent-soft/40 p-4 mb-8">
          <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-2">Products covered</p>
          <div className="flex flex-wrap gap-2">
            {products.map((p) => (
              <Link
                key={p.id}
                href={`/products/${p.slug}`}
                className="rounded-full border border-border-subtle bg-white px-3 py-1 text-sm hover:border-accent/40"
              >
                {p.name}
              </Link>
            ))}
          </div>
        </div>
      )}

      {content.body ? (
        <div className="prose max-w-none text-zinc-800 leading-relaxed flex flex-col gap-4">
          {parseBodyBlocks(content.body).map((block, i) => {
            if (block.kind === "heading") {
              const HeadingTag = block.level === 2 ? "h2" : "h3";
              return (
                <HeadingTag key={i} className="font-display font-semibold text-zinc-900 mt-2">
                  {block.text}
                </HeadingTag>
              );
            }
            if (block.kind === "list") {
              return (
                <ul key={i} className="list-disc list-inside flex flex-col gap-1">
                  {block.items.map((item, j) => (
                    <li key={j}>{item}</li>
                  ))}
                </ul>
              );
            }
            return <p key={i}>{block.text}</p>;
          })}
        </div>
      ) : (
        <p className="text-zinc-500 italic">This piece doesn&apos;t have body content yet.</p>
      )}

      {tags.length > 0 && (
        <div className="flex flex-wrap gap-2 mt-8">
          {tags.map((t) => (
            <Badge key={t.slug}>{t.name}</Badge>
          ))}
        </div>
      )}

      <div className="mt-8 rounded-xl border border-border-subtle bg-zinc-50 p-4 text-xs text-zinc-500">
        Evidence, sourcing, and testing records behind this piece are tracked internally as part of Tech
        Carvalho&apos;s editorial process. See our{" "}
        <Link href="/editorial-policy" className="underline hover:text-accent">
          editorial policy
        </Link>{" "}
        for how we work.
      </div>

      {related.length > 0 && (
        <section className="mt-12">
          <h2 className="font-display text-sm font-semibold uppercase tracking-wider text-zinc-500 mb-4">
            More {CONTENT_TYPE_LABEL[content.type]?.toLowerCase() ?? content.type}
          </h2>
          <RelatedContentTracker contentId={content.id}>
            <ul className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {related.map((item) => (
                <li key={item.id}>
                  <ContentCard href={`/articles/${item.slug}`} type={item.type} title={item.title} publishedAt={item.published_at} />
                </li>
              ))}
            </ul>
          </RelatedContentTracker>
        </section>
      )}
    </div>
  );
}
