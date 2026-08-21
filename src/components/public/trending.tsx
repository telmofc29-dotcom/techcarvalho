import Link from "next/link";
import Image from "next/image";
import { Badge } from "@/components/shared/ui";
import { InternalLinkTracker } from "@/components/analytics/internal-link-tracker";
import { CONTENT_TYPE_LABEL } from "@/components/public/cards";
import type { TrendingItem } from "@/lib/public/trending";

// Visual "Trending Now" block: one large lead + 3-5 supporting cards.
//
// Every item rendered here is already guaranteed published by
// getTrendingContent (status='published' AND published_at <= now), so this
// component never needs to re-check — but equally it must never be handed
// anything else, which is why it takes TrendingItem rather than a loose shape.
//
// Clicks flow through the existing InternalLinkTracker (the same mechanism the
// rest of the site uses); no second analytics path is introduced.

// The label itself is computed in the data layer (see TrendingItem.freshnessLabel)
// — reading the clock during render is impure and is flagged by
// react-hooks/purity, so this component only formats what it is given.
function FreshnessLabel({ publishedAt, label }: { publishedAt: string | null; label: string | null }) {
  if (!publishedAt || !label) return null;
  return (
    <time dateTime={publishedAt} className="text-xs text-zinc-500">
      {label}
    </time>
  );
}

function LeadCard({ item }: { item: TrendingItem }) {
  return (
    <Link
      href={`/articles/${item.slug}`}
      className="group relative flex flex-col overflow-hidden rounded-2xl border border-border-subtle bg-white transition-colors hover:border-accent/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
    >
      {/* 16:9 on mobile, taller on desktop so the lead reads as a hero rather
          than an oversized card. aspect-* keeps it from overflowing narrow
          viewports, which a fixed height would. */}
      <div className="relative w-full aspect-[16/9] lg:aspect-[3/2] overflow-hidden bg-accent-soft/60">
        {item.heroImage ? (
          <Image
            src={item.heroImage.url}
            alt={item.heroImage.alt ?? item.title}
            fill
            priority
            sizes="(min-width: 1024px) 62vw, 100vw"
            className="object-cover transition-transform duration-500 group-hover:scale-[1.02]"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <svg viewBox="0 0 48 48" className="h-14 w-14 text-accent/30" fill="none" aria-hidden="true">
              <rect x="10" y="6" width="28" height="36" rx="2" stroke="currentColor" strokeWidth="2" />
              <path d="M16 16h16M16 24h16M16 32h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </div>
        )}
      </div>
      <div className="flex flex-col gap-3 p-6 sm:p-7">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="amber">{CONTENT_TYPE_LABEL[item.type] ?? item.type}</Badge>
          {item.categoryLabel && (
            <span className="text-xs font-semibold uppercase tracking-wider text-accent">
              {item.categoryLabel}
            </span>
          )}
          <FreshnessLabel publishedAt={item.published_at} label={item.freshnessLabel} />
        </div>
        <h3 className="font-display text-2xl sm:text-3xl font-bold leading-tight tracking-tight text-zinc-900 group-hover:text-accent">
          {item.title}
        </h3>
        {item.excerpt && <p className="text-base text-zinc-600 line-clamp-3">{item.excerpt}</p>}
      </div>
    </Link>
  );
}

function SupportingCard({ item }: { item: TrendingItem }) {
  return (
    <Link
      href={`/articles/${item.slug}`}
      className="group flex gap-4 rounded-xl border border-border-subtle bg-white p-3 transition-colors hover:border-accent/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
    >
      <div className="relative h-20 w-28 shrink-0 overflow-hidden rounded-lg bg-accent-soft/60">
        {item.heroImage ? (
          <Image
            src={item.heroImage.url}
            alt={item.heroImage.alt ?? item.title}
            fill
            sizes="112px"
            className="object-cover transition-transform duration-300 group-hover:scale-[1.04]"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <svg viewBox="0 0 48 48" className="h-7 w-7 text-accent/30" fill="none" aria-hidden="true">
              <rect x="10" y="6" width="28" height="36" rx="2" stroke="currentColor" strokeWidth="2" />
              <path d="M16 16h16M16 24h16M16 32h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </div>
        )}
      </div>
      <div className="flex min-w-0 flex-col gap-1.5 py-0.5">
        <div className="flex flex-wrap items-center gap-2">
          {item.categoryLabel && (
            <span className="text-[11px] font-semibold uppercase tracking-wider text-accent">
              {item.categoryLabel}
            </span>
          )}
          <FreshnessLabel publishedAt={item.published_at} label={item.freshnessLabel} />
        </div>
        <h4 className="font-display text-sm sm:text-base font-semibold leading-snug text-zinc-900 line-clamp-3 group-hover:text-accent">
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
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div className="flex items-baseline gap-3">
          <h2
            id="trending-heading"
            className="font-display text-xl sm:text-2xl font-bold tracking-tight text-zinc-900"
          >
            {heading}
          </h2>
          {/* Honest labelling: when ranking had nothing but recency, say
              "latest" rather than implying measured popularity. */}
          <span className="text-xs font-medium uppercase tracking-wider text-zinc-400">
            {isRecencyFallback ? "Latest published" : "Most relevant right now"}
          </span>
        </div>
      </div>

      <InternalLinkTracker linkPosition={linkPosition} categorySlug={categorySlug}>
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-5">
          <div className="lg:col-span-3" data-entity-type="content" data-entity-id={lead.id}>
            <LeadCard item={lead} />
          </div>
          {supporting.length > 0 && (
            <ul className="flex flex-col gap-3 lg:col-span-2">
              {supporting.map((item) => (
                <li key={item.id} data-entity-type="content" data-entity-id={item.id}>
                  <SupportingCard item={item} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </InternalLinkTracker>
    </section>
  );
}
