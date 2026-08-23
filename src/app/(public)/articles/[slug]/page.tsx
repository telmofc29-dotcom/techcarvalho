import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { buildMetadata } from "@/lib/seo/metadata";
import { articleJsonLd, itemListJsonLd, safeJsonLdString } from "@/lib/seo/jsonld";
import { getArticleDetail } from "@/lib/public/article-detail";
import { getPublishedGallery, classifiable } from "@/lib/public/hero-image";
import { mediaFit, frameAspectRatio, dimensionsUnknown } from "@/lib/media/presentation";
import { Breadcrumbs } from "@/components/public/breadcrumbs";
import { ArticleLeadMedia } from "@/components/public/article-lead-media";
import {
  ContentCard,
  CONTENT_TYPE_LABEL,
  CARD_SIZES_ARTICLE_2,
  CARD_SIZES_ARTICLE_3,
} from "@/components/public/cards";
import { RelatedContentTracker } from "@/components/public/related-content-tracker";
import { Badge } from "@/components/shared/ui";
import { parseBodyBlocks, excerptFromBody } from "@/lib/content/body-format";
import { assessSourceConfidence, shouldShowConfidence } from "@/lib/public/source-confidence";
import { SourceConfidenceNote } from "@/components/public/source-confidence";
import type { ReliabilityTier } from "@/lib/types/database";
import { estimateReadingTime } from "@/lib/content/reading-time";
import { articleDisplayDate, articleDeck } from "@/lib/content/article-header";
import { getArticleComparison } from "@/lib/public/article-comparison";
import { ComparisonTableView } from "@/components/public/comparison-table";
import { PageViewTracker } from "@/components/analytics/page-view-tracker";
import { ScrollDepthTracker } from "@/components/analytics/scroll-depth-tracker";
import { InternalLinkTracker } from "@/components/analytics/internal-link-tracker";
import { MediaCredit } from "@/components/public/media-credit";

// The article column is `max-w-3xl px-6` — 720px of content once the padding
// comes out, and never wider. Omitting `sizes` on a `fill` image makes Next
// fall back to 100vw, so a 1600px-wide desktop was fetching a 1600px (or 3200px
// at 2x DPR) rendition for a 720px slot.
const ARTICLE_BODY_SIZES = "(min-width: 768px) 720px, calc(100vw - 48px)";

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

/**
 * A readable label for a source with no publisher recorded.
 *
 * Falls back to the host rather than printing a raw URL: "nvidia.com" tells a
 * reader who said it, which is the entire point of showing sources at all.
 */
function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export default async function ArticlePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const detail = await getArticleDetail(slug);
  if (!detail) notFound();

  const { content, category, products, tags, freshness, related, heroImage, seo, sources } = detail;
  const { clusterMembers, clusterPillars, comparisonSiblings, hubs } = detail;
  const lastVerified = freshness[0]?.reviewed_at ?? null;

  // Derived, never stored. See src/lib/content/article-header.ts for why each
  // of these is computed rather than authored, and src/lib/content/reading-time.ts
  // for what the estimate counts.
  const readingTime = estimateReadingTime(content.body);
  const displayDate = articleDisplayDate(content.published_at, content.updated_at);
  const deck = articleDeck({
    metaDescription: seo?.meta_description ?? null,
    body: content.body,
    title: content.title,
  });

  // Source confidence, on news stories only. A review or guide is our own
  // editorial work rather than a report of someone else's claim, so a chip
  // there would appear on every piece identically and therefore say nothing —
  // see BANDED_TYPES in lib/public/source-confidence.ts.
  //
  // The three editorial flags (`developing`, `conflicting`, `unconfirmed`) are
  // not passed here yet: none can be inferred from a source list, and the
  // columns carrying a human's judgement are still in
  // supabase/migrations_pending/20260825_editorial_claim_state.sql.
  //
  // Until that is applied the band comes from source independence alone. That
  // is honest but incomplete, and there is a known live consequence:
  // "next-gen-console-rumor-tracker-ps6-xbox" reads as "Strongly supported"
  // because three reputable outlets covered it, even though its subject is
  // explicitly rumour. reliability_tier grades the publisher, not the claim.
  // Applying the migration and flagging that article is what fixes it.
  const confidence = shouldShowConfidence(content.type)
    ? assessSourceConfidence(
        sources.map((s) => ({
          url: s.url,
          publisher: s.publisher,
          reliabilityTier: s.reliability_tier as ReliabilityTier,
        }))
      )
    : null;

  const gallery = await getPublishedGallery("content", content.id);

  // Structured comparison data, where real specifications exist for two or more
  // of the products this piece covers. Every comparison on this site is
  // currently a 1600x900 PNG rendered into a ~342px slot on a phone — a raster
  // chart cannot reflow, cannot be read aloud, cannot be selected, and carries
  // its information in pixels no crawler can parse. Returns null whenever a
  // table would be misleading rather than rendering an empty one.
  const comparison = await getArticleComparison(products);

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

      {/* HERO FIRST.
          The hero used to render at y=525 on a 390px screen, BELOW the
          headline, the metadata and the cluster nav — so the first body
          sentence sat at y=941, which is 161px below the fold. A reader on a
          phone met three blocks of furniture before anything told them what the
          story looked like.
          Order is now: hero, headline, updated + reading time, deck, article.
          "Products covered" moved below the body for the same reason: it is
          useful after reading, not before. */}
      {heroImage && <ArticleLeadMedia heroImage={heroImage} />}

      <h1 className="font-display text-3xl sm:text-4xl font-bold tracking-tight text-zinc-900 mt-6 mb-3">
        {content.title}
      </h1>

      {/* One metadata line, not three stacked blocks.
          It says UPDATED rather than "Published": updated_at reached the JSON-LD
          but never the reader, so a piece revised after publication looked
          stale to a person and current to a crawler. When the two dates are the
          same day it says "Published", because "Updated" on a piece that has
          never been revised overstates the maintenance. */}
      <div className="mb-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-zinc-500">
        <Badge tone="amber">{CONTENT_TYPE_LABEL[content.type] ?? content.type}</Badge>
        {displayDate && (
          <time dateTime={displayDate.iso}>
            {displayDate.revised ? "Updated" : "Published"} {displayDate.label}
          </time>
        )}
        {readingTime && (
          <>
            <span aria-hidden="true" className="text-zinc-300">
              •
            </span>
            <span>{readingTime.label}</span>
          </>
        )}
      </div>

      {/* The deck. Derived from the article's own first paragraph when no
          hand-written meta description exists, so it can never be generic SEO
          filler bolted on afterwards — it is the piece's own opening sentence.
          Suppressed when it would merely restate the headline. */}
      {deck && (
        <p className="mb-6 text-lg leading-relaxed text-zinc-600">{deck}</p>
      )}

      {/* How much weight this story's sourcing carries, on news only.
          ---------------------------------------------------------------
          It goes HERE, above the body, because its job is to change how the
          next 800 words are read; under the sources at the foot it would
          arrive after the reader had already formed a view.

          Nothing is shown when the piece has no recorded sources —
          assessSourceConfidence returns null — because an unsourced story has
          not been judged weak, it has not been judged, and a "Rumour" chip
          would be a finding we never made. The absent Sources section below
          already makes that gap visible. */}
      {confidence && (
        <SourceConfidenceNote assessment={confidence} hasSourceList={sources.length > 0} />
      )}

      {lastVerified && (
        <p className="text-xs text-zinc-400 mb-6">
          Last verified{" "}
          {new Date(lastVerified).toLocaleDateString(undefined, {
            year: "numeric",
            month: "long",
            day: "numeric",
          })}
        </p>
      )}

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
                <Link href={`/articles/${p.slug}`} className="inline-flex min-h-11 items-center text-sm font-medium text-zinc-900 hover:text-accent">
                  {p.title}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
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
          {gallery.map((img, i) => {
            // Same reasoning as the lead image: the in-body gallery is where
            // the diagrams that did NOT win the hero slot end up, so a fixed
            // 16:9 centre crop is exactly the wrong default here. Frame and fit
            // both come from the asset.
            const fit =
              mediaFit(classifiable(img)) === "contain" || dimensionsUnknown(img.width, img.height)
                ? "contain"
                : "cover";
            return (
            <figure key={i} className="flex flex-col gap-2">
              <div
                className={`relative w-full rounded-xl overflow-hidden ${
                  fit === "contain" ? "bg-zinc-50" : "bg-zinc-100"
                }`}
                style={{ aspectRatio: frameAspectRatio(img.width, img.height) }}
              >
                <Image
                  src={img.url}
                  alt={img.alt ?? ""}
                  fill
                  sizes={ARTICLE_BODY_SIZES}
                  className={fit === "contain" ? "object-contain" : "object-cover"}
                  loading="lazy"
                />
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
            );
          })}
        </div>
      )}

      {products.length > 0 && (
        <div className="rounded-xl border border-border-subtle bg-accent-soft/40 p-4 mt-10">
          <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-2">Products covered</p>
          <InternalLinkTracker linkPosition="article_top">
            <div className="flex flex-wrap gap-2">
              {products.map((p) => (
                <Link
                  key={p.id}
                  href={`/products/${p.slug}`}
                  data-entity-type="product"
                  data-entity-id={p.id}
                  className="inline-flex min-h-11 items-center rounded-full border border-border-subtle bg-white px-3 text-sm hover:border-accent/40"
                >
                  {p.name}
                </Link>
              ))}
            </div>
          </InternalLinkTracker>
        </div>
      )}

      {tags.length > 0 && (
        <div className="flex flex-wrap gap-2 mt-8">
          {tags.map((t) => (
            <Badge key={t.slug}>{t.name}</Badge>
          ))}
        </div>
      )}

      {comparison && (
        <ComparisonTableView
          table={comparison}
          caption={`Recorded specifications for ${comparison.products
            .map((p) => p.name)
            .join(" and ")}.`}
        />
      )}

      {/* THE SOURCES THEMSELVES, or nothing.
          This was a fixed prose box reading "Evidence, sourcing, and testing
          records behind this piece are tracked internally", rendered on every
          article with no check. It was untrue on 23 of the 81 published pieces,
          which carry no source records at all — and "testing records" implied
          hands-on testing that has never happened anywhere on this site.
          A claim about evidence, made without consulting the evidence, is
          exactly the failure class this project spent a phase removing from the
          engine. It was sitting in the reader-facing chrome the whole time.
          Now the page can only say what is actually there. An article with no
          sources shows nothing, which makes the gap visible instead of
          papering over it with a reassurance. */}
      {sources.length > 0 && (
        <section className="mt-10" aria-labelledby="sources-heading">
          <h2
            id="sources-heading"
            className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-500"
          >
            Sources
          </h2>
          <ol className="flex flex-col gap-2">
            {sources.map((source, i) => (
              <li key={`${source.url}-${i}`} className="text-xs leading-relaxed text-zinc-600">
                <a
                  href={source.url}
                  rel="nofollow noopener"
                  target="_blank"
                  className="break-words underline decoration-zinc-300 underline-offset-2 hover:text-accent"
                >
                  {source.publisher ?? hostOf(source.url)}
                </a>
                {source.reliability_tier === "primary" && (
                  <span className="ml-2 text-zinc-400">primary source</span>
                )}
              </li>
            ))}
          </ol>
          <p className="mt-3 text-xs leading-relaxed text-zinc-400">
            Tech Carvalho does not publish hands-on test results. This piece is written from the
            sources above and from public documentation. See our{" "}
            <Link href="/editorial-policy" className="underline hover:text-accent">
              editorial policy
            </Link>
            .
          </p>
        </section>
      )}

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
                    imageFit={mediaFit(classifiable(item.heroImage))}
                    sizes={CARD_SIZES_ARTICLE_3}
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
                    imageFit={mediaFit(classifiable(article.heroImage))}
                    sizes={CARD_SIZES_ARTICLE_2}
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
                    className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-border-subtle bg-white px-3.5 text-sm font-medium text-zinc-700 hover:border-accent/40 hover:text-accent"
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
                    imageFit={mediaFit(classifiable(item.heroImage))}
                    sizes={CARD_SIZES_ARTICLE_3}
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
