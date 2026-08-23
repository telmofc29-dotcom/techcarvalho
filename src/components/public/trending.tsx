import Link from "next/link";
import { Badge } from "@/components/shared/ui";
import { InternalLinkTracker } from "@/components/analytics/internal-link-tracker";
import { CONTENT_TYPE_LABEL, MediaFrame, CARD_FOCUS, ArrowGlyph } from "@/components/public/cards";
import { mediaFit } from "@/lib/media/presentation";
import { classifiable } from "@/lib/public/hero-image";
import type { TrendingItem } from "@/lib/public/trending";

// The "Trending now" block: one large lead story plus a rail of supporting
// ones. This is the top of the front page, so it is the section that decides
// whether the site reads as a live publication or as a directory listing.
//
// Every item rendered here is already guaranteed published by
// getTrendingContent (status='published' AND published_at <= now), so this
// component never needs to re-check — but equally it must never be handed
// anything else, which is why it takes TrendingItem rather than a loose shape.
//
// HONESTY. The word "trending" is a claim, and this site has no traffic data it
// can legitimately read (see the note at the top of src/lib/public/trending.ts:
// the analytics tables are admin-only and would silently return zero rows to a
// public page). So the ranking is recency plus editorial centrality, and the
// section says so in plain language directly under the heading. When
// isRecencyFallback is true there was nothing but recency to rank on, and the
// copy drops any suggestion of ranking at all.
//
// Clicks flow through the existing InternalLinkTracker (the same mechanism the
// rest of the site uses); no second analytics path is introduced.

// The label itself is computed in the data layer (see TrendingItem.freshnessLabel)
// — reading the clock during render is impure and is flagged by
// react-hooks/purity, so this component only formats what it is given.
function FreshnessLabel({
  publishedAt,
  label,
  className = "text-xs text-zinc-500",
}: {
  publishedAt: string | null;
  label: string | null;
  className?: string;
}) {
  if (!publishedAt || !label) return null;
  return (
    <time dateTime={publishedAt} className={className}>
      {label}
    </time>
  );
}

function LeadStory({
  item,
  preload,
  asPageHeading = false,
}: {
  item: TrendingItem;
  preload: boolean;
  /**
   * Render the headline as the page's h1.
   *
   * True on the homepage, where this story IS the front line. The alternative —
   * an h1 carrying the site tagline above a 2.5rem lead headline — puts the
   * visual and semantic hierarchies in disagreement: the biggest thing on the
   * page would not be the most important thing in the outline. Every news front
   * page resolves this the same way.
   */
  asPageHeading?: boolean;
}) {
  const fit = mediaFit(classifiable(item.heroImage));
  const Headline = asPageHeading ? "h1" : "h3";
  return (
    <Link href={`/articles/${item.slug}`} className={`group block rounded-2xl ${CARD_FOCUS}`}>
      {/* Stays 16:9 at every breakpoint. It used to widen to 16:10 on desktop,
          which is a shape nothing in the library actually is: every editorial
          graphic is a 1600x900 canvas, so 16:10 shaved a strip off the top and
          bottom of the one image on the page most likely to be a chart. */}
      <MediaFrame
        src={item.heroImage?.url}
        alt={item.heroImage?.alt ?? ""}
        kind="content"
        preload={preload}
        fit={fit}
        // The lead sits in 7 of 12 columns of the `max-w-6xl` shell: ~627px
        // once the container padding and the 40px gutters come out, and it
        // stops growing once the container is capped. "58vw" kept growing with
        // the viewport and over-fetched by ~35% on a 1600px screen.
        sizes="(min-width: 1280px) 640px, (min-width: 1024px) 58vw, calc(100vw - 48px)"
        className="aspect-[16/9] w-full rounded-2xl border border-border-subtle"
        iconClassName="h-16 w-16"
      />
      <div className="mt-5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <Badge tone="amber">{CONTENT_TYPE_LABEL[item.type] ?? item.type}</Badge>
          {item.categoryLabel && (
            <span className="text-xs font-semibold uppercase tracking-wider text-accent">{item.categoryLabel}</span>
          )}
          <FreshnessLabel publishedAt={item.published_at} label={item.freshnessLabel} />
        </div>
        <Headline className="font-display mt-3 text-2xl font-bold leading-[1.12] tracking-tight text-zinc-900 group-hover:text-accent sm:text-3xl lg:text-[2.5rem]">
          {item.title}
        </Headline>
        {item.excerpt && (
          <p className="mt-3 max-w-2xl text-base leading-relaxed text-zinc-600 line-clamp-3 sm:text-lg">
            {item.excerpt}
          </p>
        )}
        <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-accent">
          Read the story
          <ArrowGlyph className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
        </span>
      </div>
    </Link>
  );
}

function SupportingStory({ item }: { item: TrendingItem }) {
  return (
    <Link href={`/articles/${item.slug}`} className={`group flex gap-4 rounded-lg py-4 ${CARD_FOCUS}`}>
      <MediaFrame
        src={item.heroImage?.url}
        alt={item.heroImage?.alt ?? ""}
        kind="content"
        fit={mediaFit(classifiable(item.heroImage))}
        sizes="(min-width: 640px) 112px, 96px"
        className="aspect-[16/9] w-24 shrink-0 rounded-lg border border-border-subtle sm:w-28"
        iconClassName="h-6 w-6"
      />
      <div className="flex min-w-0 flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {item.categoryLabel && (
            <span className="text-[11px] font-semibold uppercase tracking-wider text-accent">{item.categoryLabel}</span>
          )}
          <FreshnessLabel publishedAt={item.published_at} label={item.freshnessLabel} className="text-[11px] text-zinc-500" />
        </div>
        <h4 className="font-display text-sm font-semibold leading-snug tracking-tight text-zinc-900 line-clamp-3 group-hover:text-accent sm:text-base">
          {item.title}
        </h4>
      </div>
    </Link>
  );
}

export function TrendingSection({
  lead,
  supporting,
  isRecencyFallback,
  linkPosition,
  categorySlug,
  heading = "Trending now",
  preloadLead = true,
  leadAsPageHeading = false,
  stats = [],
}: {
  lead: TrendingItem | null;
  supporting: TrendingItem[];
  isRecencyFallback: boolean;
  linkPosition: "home" | "category_page";
  categorySlug?: string;
  heading?: string;
  /**
   * The homepage case. The section label becomes a styled eyebrow rather than
   * an h2, so the lead headline below it can be the page's only h1 without the
   * document outline running h2-then-h1.
   */
  leadAsPageHeading?: boolean;
  /**
   * Short factual phrases about the publication itself — article count, live
   * subject areas, when we last published. Shown only on the homepage, where
   * this section is the front line and a first-time visitor has nothing else to
   * judge scale by. Every one is a count of rows the visitor can click through
   * and verify; nothing here is traffic, ratings, or reach.
   */
  stats?: string[];
  /**
   * Preload the lead image. True on the homepage, where this section is the
   * top of the page and its lead is the LCP candidate. Must be FALSE anywhere
   * something else above it already preloads — a page that preloads two images
   * makes them compete for the same bandwidth and delays whichever one the
   * viewport actually settles on.
   */
  preloadLead?: boolean;
}) {
  // Nothing published at all — render nothing rather than an empty shell. The
  // caller's other sections still handle the genuinely-empty-site case.
  if (!lead) return null;

  return (
    <section {...(leadAsPageHeading ? { "aria-label": heading } : { "aria-labelledby": "trending-heading" })}>
      <div className="mb-7 border-b-2 border-accent/60 pb-4">
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
          {leadAsPageHeading ? (
            <p className="font-display text-sm font-bold uppercase tracking-[0.18em] text-zinc-900">
              {heading}
            </p>
          ) : (
            <h2
              id="trending-heading"
              className="font-display text-2xl font-bold tracking-tight text-zinc-900 sm:text-3xl"
            >
              {heading}
            </h2>
          )}
          <span className="inline-flex items-center gap-2 rounded-full bg-accent-soft px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-accent">
            <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-accent" />
            {isRecencyFallback ? "Newest first" : "Editorially ranked"}
          </span>
        </div>
        {/* The honesty line. It is part of the section, not a footnote: the
            heading makes a claim and this is what backs it up. */}
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-zinc-500">
          {isRecencyFallback
            ? "Ordered by publication date. We don't rank stories by traffic, and we don't show view counts."
            : "Ranked by how recent each story is and how central it is to the rest of our coverage — not by traffic, clicks, or view counts."}
        </p>
        {stats.length > 0 && (
          <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-medium text-zinc-500">
            {stats.map((stat, index) => (
              <span key={stat} className="flex items-center gap-2">
                {index > 0 && <span aria-hidden="true" className="h-1 w-1 rounded-full bg-zinc-300" />}
                {stat}
              </span>
            ))}
          </p>
        )}
      </div>

      <InternalLinkTracker linkPosition={linkPosition} categorySlug={categorySlug}>
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-12 lg:gap-10">
          <div className="lg:col-span-7" data-entity-type="content" data-entity-id={lead.id}>
            <LeadStory item={lead} preload={preloadLead} asPageHeading={leadAsPageHeading} />
          </div>
          {supporting.length > 0 && (
            <ul className="divide-y divide-border-subtle border-t border-border-subtle lg:col-span-5">
              {supporting.map((item) => (
                <li key={item.id} data-entity-type="content" data-entity-id={item.id}>
                  <SupportingStory item={item} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </InternalLinkTracker>
    </section>
  );
}
