import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { buildMetadata } from "@/lib/seo/metadata";
import { articleJsonLd, itemListJsonLd, safeJsonLdString } from "@/lib/seo/jsonld";
import { getArticleDetail } from "@/lib/public/article-detail";
import { getPublishedGallery } from "@/lib/public/hero-image";
import { Breadcrumbs } from "@/components/public/breadcrumbs";
import { ContentCard, CONTENT_TYPE_LABEL } from "@/components/public/cards";
import { RelatedContentTracker } from "@/components/public/related-content-tracker";
import { Badge } from "@/components/shared/ui";
import { parseBodyBlocks, excerptFromBody } from "@/lib/content/body-format";
import { PageViewTracker } from "@/components/analytics/page-view-tracker";
import { ScrollDepthTracker } from "@/components/analytics/scroll-depth-tracker";
import { InternalLinkTracker } from "@/components/analytics/internal-link-tracker";
import { MediaCredit } from "@/components/public/media-credit";

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
    // Falls back to the same generated excerpt the cards use, so a piece with
    // no hand-written meta description gets a real one derived from its own
    // body rather than inheriting the site tagline — which is what every
    // description-less article shared with every other article before this.
    description: detail.seo?.meta_description ?? excerptFromBody(detail.content.body) ?? undefined,
    path: `/articles/${slug}`,
    image: detail.heroImage,
    canonicalUrl: detail.seo?.canonical_url,
    noindex: detail.seo?.noindex ?? false,
    openGraphType: "article",
    publishedTime: detail.content.published_at,
    modifiedTime: detail.content.updated_at,
    section: detail.category?.name,
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

  const { content, category, products, tags, freshness, related, heroImage, seo } = detail;
  const { clusterMembers, clusterPillars, comparisonSiblings, hubs } = detail;
  const lastVerified = freshness[0]?.reviewed_at ?? null;
  const gallery = await getPublishedGallery("content", content.id);

  const jsonLd = articleJsonLd({
    title: content.title,
    slug: content.slug,
    publishedAt: content.published_at,
    updatedAt: content.updated_at,
    contentType: content.type,
    description: seo?.meta_description ?? excerptFromBody(content.body),
    image: heroImage,
    section: category?.name,
    // Only products actually linked through content_products, and only the
    // published ones — getArticleDetail already filters on is_published.
    about: products.map((p) => ({ name: p.name, slug: p.slug })),
  });

  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <PageViewTracker entityType="content" entityId={content.id} />
      <ScrollDepthTracker contentId={content.id} contentSlug={content.slug} />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLdString(jsonLd) }}
      />
      {/* When this piece is the pillar of a cluster it is also a hub, and the
          list of pieces it gathers is real, curated data (content_relationships
          rows written by an editor) — not a guess. Emitted only for a genuine
          multi-piece cluster; getArticleDetail returns an empty clusterMembers
          below MIN_CLUSTER_MEMBERS, so a "series" of one produces no markup. */}
      {clusterMembers.length > 0 && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: safeJsonLdString(
              itemListJsonLd(
                clusterMembers.map((m) => ({ name: m.title, path: `/articles/${m.slug}` })),
                { name: `${content.title} — related coverage` }
              )
            ),
          }}
        />
      )}
      <Breadcrumbs
        items={[
          { name: "Home", path: "/" },
          // The subject-area hub, when the piece has one. This is the level
          // that was missing: the trail ran Home > Articles > Reviews > piece,
          // which never touched the category hub the piece actually belongs
          // to and so passed no breadcrumb signal to it.
          ...(category ? [{ name: category.name, path: `/${category.slug}` }] : []),
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

      {/* The consolidation half of the cannibalisation fix.
          `content_relationships` already recorded which piece is the pillar of
          a cluster, and the public site rendered every cluster as one flat,
          unlabelled rail of three at the very bottom of the page. A supporting
          piece that competes with its own pillar for the same intent stops
          competing once it visibly defers to it — high on the page, with the
          pillar's real title as the anchor text rather than "read more".
          Descriptive anchor text is the whole mechanism here; a generic one
          passes no signal about what the target is about. */}
      {clusterPillars.length > 0 && (
        <nav
          aria-label="Part of"
          className="mb-8 rounded-xl border border-border-subtle bg-accent-soft/40 p-4"
        >
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-zinc-500">
            Part of {clusterPillars.length === 1 ? "our guide to" : "our guides to"}
          </p>
          <ul className="flex flex-col gap-1">
            {clusterPillars.map((p) => (
              <li key={p.id}>
                <Link href={`/articles/${p.slug}`} className="text-sm font-medium text-zinc-900 hover:text-accent">
                  {p.title}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}

      {heroImage && (
        <div className="relative w-full aspect-video rounded-xl overflow-hidden bg-zinc-100 mb-8">
          <Image src={heroImage.url} alt={heroImage.alt ?? content.title} fill className="object-cover" />
        </div>
      )}

      {products.length > 0 && (
        <div className="rounded-xl border border-border-subtle bg-accent-soft/40 p-4 mb-8">
          <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-2">Products covered</p>
          <InternalLinkTracker linkPosition="article_top">
            <div className="flex flex-wrap gap-2">
              {products.map((p) => (
                <Link
                  key={p.id}
                  href={`/products/${p.slug}`}
                  data-entity-type="product"
                  data-entity-id={p.id}
                  className="rounded-full border border-border-subtle bg-white px-3 py-1 text-sm hover:border-accent/40"
                >
                  {p.name}
                </Link>
              ))}
            </div>
          </InternalLinkTracker>
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

      {gallery.length > 0 && (
        <div className="mt-8 flex flex-col gap-6">
          {gallery.map((img, i) => (
            <figure key={i} className="flex flex-col gap-2">
              <div className="relative w-full aspect-video rounded-xl overflow-hidden bg-zinc-100">
                <Image src={img.url} alt={img.alt ?? content.title} fill className="object-cover" loading="lazy" />
              </div>
              {img.caption && (
                <figcaption className="text-xs text-zinc-500">{img.caption}</figcaption>
              )}
              {/* The credit links BOTH the material and the licence deed.
                  Linking only the source satisfied two of CC BY's three
                  conditions; the licence itself was named but never linked. */}
              {img.attributionRequired && (
                <MediaCredit
                  attribution={img.attribution}
                  creator={img.creator}
                  license={img.license}
                  sourceUrl={img.sourceUrl}
                  className="text-xs text-zinc-500"
                />
              )}
            </figure>
          ))}
        </div>
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

      {/* The pillar half. A piece with a real cluster under it IS a hub, and
          the whole cluster belongs on it — not three of nine, mixed with
          same-type recency filler, which is what the single `related` rail
          did to it before. Against production this is the difference between
          showing 3 and showing all 9 supporting pieces on the
          astrophotography beginners guide. */}
      {clusterMembers.length > 0 && (
        <section className="mt-12">
          <h2 className="font-display text-sm font-semibold uppercase tracking-wider text-zinc-500 mb-1">
            More in this guide series
          </h2>
          <p className="mb-4 text-xs text-zinc-500">
            {clusterMembers.length} {clusterMembers.length === 1 ? "piece" : "pieces"} that build on this one.
          </p>
          <RelatedContentTracker contentId={content.id}>
            <ul className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {clusterMembers.map((item) => (
                <li key={item.id}>
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
          </RelatedContentTracker>
        </section>
      )}

      {/* Comparison clusters. The site publishes 20 "X vs Y" pieces and until
          now each one was an island: nothing connected the four Canon
          mirrorless comparisons to each other, or the three console ones.
          Siblings are ranked by shared SUBJECT tags (format tags like
          "comparison" excluded, or every comparison on the site would be a
          sibling of every other) — see src/lib/public/content-cluster.ts. */}
      {comparisonSiblings.length > 0 && (
        <section className="mt-12">
          <h2 className="font-display text-sm font-semibold uppercase tracking-wider text-zinc-500 mb-1">
            Related comparisons
          </h2>
          <p className="mb-4 text-xs text-zinc-500">
            {comparisonSiblings.some((s) => s.sharedTags.length > 0)
              ? "Other head-to-heads covering the same subject."
              : `Other comparisons${category ? ` in ${category.name}` : ""}.`}
          </p>
          <RelatedContentTracker contentId={content.id}>
            <ul className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {comparisonSiblings.map(({ article }) => (
                <li key={article.id}>
                  <ContentCard
                    href={`/articles/${article.slug}`}
                    type={article.type}
                    title={article.title}
                    publishedAt={article.published_at}
                    excerpt={article.excerpt}
                    imageUrl={article.heroImage?.url}
                    imageAlt={article.heroImage?.alt}
                  />
                </li>
              ))}
            </ul>
          </RelatedContentTracker>
        </section>
      )}

      {/* Every hub this piece rolls up to, and every one of them links back
          here — the family hub through its published products, the brand hub
          through the same tag slug that put this link on the page, the
          category hub through its article list. Two-way by construction, not
          by an editor remembering to add a link on both ends. */}
      {hubs.length > 0 && (
        <nav aria-label="Explore" className="mt-12 border-t border-border-subtle pt-6">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">Explore</p>
          <InternalLinkTracker linkPosition="article_end" categorySlug={category?.slug}>
            <ul className="flex flex-wrap gap-2">
              {hubs.map((hub) => (
                <li key={`${hub.kind}-${hub.path}`}>
                  <Link
                    href={hub.path}
                    className="inline-flex items-center gap-1.5 rounded-full border border-border-subtle bg-white px-3.5 py-1.5 text-sm font-medium text-zinc-700 hover:border-accent/40 hover:text-accent"
                  >
                    <span className="text-[11px] uppercase tracking-wider text-zinc-400">
                      {hub.kind === "family" ? "Line" : hub.kind === "manufacturer" ? "Brand" : "Topic"}
                    </span>
                    {hub.label}
                  </Link>
                </li>
              ))}
            </ul>
          </InternalLinkTracker>
        </nav>
      )}

      {related.length > 0 && (
        <section className="mt-12">
          <h2 className="font-display text-sm font-semibold uppercase tracking-wider text-zinc-500 mb-4">
            More {CONTENT_TYPE_LABEL[content.type]?.toLowerCase() ?? content.type}
          </h2>
          <RelatedContentTracker contentId={content.id}>
            <ul className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {related.map((item) => (
                <li key={item.id}>
                  <ContentCard
                    href={`/articles/${item.slug}`}
                    type={item.type}
                    title={item.title}
                    publishedAt={item.published_at}
                    imageUrl={item.heroImage?.url}
                    imageAlt={item.heroImage?.alt}
                  />
                </li>
              ))}
            </ul>
          </RelatedContentTracker>
        </section>
      )}
    </div>
  );
}
