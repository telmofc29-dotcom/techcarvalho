import Link from "next/link";
import { Badge } from "@/components/shared/ui";
import { InternalLinkTracker } from "@/components/analytics/internal-link-tracker";
import { CONTENT_TYPE_LABEL, MediaFrame, CARD_FOCUS, ArrowGlyph } from "@/components/public/cards";
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

function LeadStory({ item }: { item: TrendingItem }) {
  return (
    <Link href={`/articles/${item.slug}`} className={`group block rounded-2xl ${CARD_FOCUS}`}>
      {/* 16:9 on mobile, slightly taller on desktop so the lead reads as a
          hero rather than an oversized card. aspect-* keeps it from
          overflowing narrow viewports, which a fixed height would. */}
      <MediaFrame
        src={item.heroImage?.url}
        alt={item.heroImage?.alt ?? item.title}
        kind="content"
        priority
        sizes="(min-width: 1024px) 58vw, 100vw"
        className="aspect-[16/9] w-full rounded-2xl border border-border-subtle lg:aspect-[16/10]"
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
        <h3 className="font-display mt-3 text-2xl font-bold leading-[1.12] tracking-tight text-zinc-900 group-hover:text-accent sm:text-3xl lg:text-[2.5rem]">
          {item.title}
        </h3>
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
        alt={item.heroImage?.alt ?? item.title}
        kind="content"
        sizes="112px"
        className="aspect-[4/3] w-24 shrink-0 rounded-lg border border-border-subtle sm:w-28"
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
}: {
  lead: TrendingItem | null;
  supporting: TrendingItem[];
  isRecencyFallback: boolean;
  linkPosition: "home" | "category_page";
  categorySlug?: string;
  heading?: string;
}) {
  // Nothing published at all — render nothing rather than an empty shell. The
  // caller's other sections still handle the genuinely-empty-site case.
  if (!lead) return null;

  return (
    <section aria-labelledby="trending-heading">
      <div className="mb-7 border-b-2 border-accent/60 pb-4">
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
          <h2
            id="trending-heading"
            className="font-display text-2xl font-bold tracking-tight text-zinc-900 sm:text-3xl"
          >
            {heading}
          </h2>
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
      </div>

      <InternalLinkTracker linkPosition={linkPosition} categorySlug={categorySlug}>
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-12 lg:gap-10">
          <div className="lg:col-span-7" data-entity-type="content" data-entity-id={lead.id}>
            <LeadStory item={lead} />
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
