import Link from "next/link";
import Image from "next/image";
import { Badge } from "@/components/shared/ui";

export const CONTENT_TYPE_LABEL: Record<string, string> = {
  review: "Review",
  guide: "Guide",
  comparison: "Comparison",
  news: "News",
  troubleshooting: "Troubleshooting",
};

/**
 * Focus ring shared by every card-sized link on the public site. Cards are the
 * primary way of moving around the site, so they must be obviously focusable
 * with a keyboard — a hover-only affordance would leave keyboard users with no
 * indication of where they are.
 */
export const CARD_FOCUS =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-white";

export function ArrowGlyph({ className }: { className: string }) {
  return (
    <svg viewBox="0 0 20 20" className={className} fill="none" aria-hidden="true">
      <path
        d="M4 10h11M11 5.5L15.5 10 11 14.5"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PlaceholderGlyph({ kind, className }: { kind: "product" | "content"; className: string }) {
  if (kind === "product") {
    return (
      <svg viewBox="0 0 48 48" className={className} fill="none" aria-hidden="true">
        <rect x="6" y="16" width="36" height="24" rx="3" stroke="currentColor" strokeWidth="2" />
        <path d="M17 16l3-6h8l3 6" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
        <circle cx="24" cy="28" r="7" stroke="currentColor" strokeWidth="2" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 48 48" className={className} fill="none" aria-hidden="true">
      <rect x="10" y="6" width="28" height="36" rx="2" stroke="currentColor" strokeWidth="2" />
      <path d="M16 16h16M16 24h16M16 32h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

// Shared image frame for every card on the public site — a fixed-ratio box so a
// mixed grid of image/no-image cards never jumps in height (CLS), with a
// deliberate on-brand placeholder (never a broken-image icon, never a blank
// gap) when no published media exists.
//
// The placeholder is decoration, not a claim: it reuses the site's own accent
// palette and a type glyph so an image-less card reads as "intentional, not
// broken", and it never stands in for a photograph that does not exist. The
// honest "we have no photograph of this product" statement is a separate,
// explicit panel — see src/components/public/product-lead-media.tsx.
export function MediaFrame({
  src,
  alt,
  kind,
  sizes,
  priority = false,
  // Callers own the frame's size and rounding, including width — MediaFrame
  // must not hardcode `w-full`, because a Tailwind width class passed in here
  // would then collide with it and resolve by stylesheet order rather than by
  // call site.
  className = "aspect-[4/3] w-full rounded-t-xl",
  iconClassName = "h-9 w-9",
}: {
  src?: string | null;
  alt: string;
  kind: "product" | "content";
  sizes: string;
  priority?: boolean;
  className?: string;
  iconClassName?: string;
}) {
  if (src) {
    return (
      <div className={`relative overflow-hidden bg-zinc-100 ${className}`}>
        <Image
          src={src}
          alt={alt}
          fill
          sizes={sizes}
          priority={priority}
          className="object-cover transition-transform duration-300 group-hover:scale-[1.03]"
        />
      </div>
    );
  }
  return (
    <div
      className={`relative flex items-center justify-center overflow-hidden bg-accent-soft/60 ${className}`}
    >
      <PlaceholderGlyph kind={kind} className={`${iconClassName} text-accent/40`} />
    </div>
  );
}

// excerpt: no dedicated excerpt/summary column exists on content_items,
// deliberately — investigated and decided against adding one, since every
// call site instead passes seo_metadata.meta_description here (see
// attachExcerpts in src/lib/public/excerpt.ts). A third summarization
// field alongside body and meta_description would just be another thing
// to keep in sync; reusing the SEO description closes the real gap (list
// views previously showed no preview text at all) without one.
export function ContentCard({
  href,
  type,
  title,
  publishedAt,
  dateLabel,
  excerpt,
  imageUrl,
  imageAlt,
  categoryLabel,
}: {
  href: string;
  type: string;
  title: string;
  publishedAt?: string | null;
  /**
   * Pre-formatted date. Optional: callers that already computed one in the
   * data layer pass it, the rest fall back to formatting `publishedAt` here.
   */
  dateLabel?: string | null;
  excerpt?: string | null;
  imageUrl?: string | null;
  imageAlt?: string | null;
  categoryLabel?: string | null;
}) {
  const shownDate =
    dateLabel ??
    (publishedAt
      ? new Date(publishedAt).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
      : null);

  return (
    <Link
      href={href}
      className={`group flex h-full flex-col overflow-hidden rounded-xl border border-border-subtle bg-white transition-[border-color,box-shadow] hover:border-accent/40 hover:shadow-[0_1px_18px_-8px_rgba(180,83,9,0.45)] ${CARD_FOCUS}`}
    >
      <MediaFrame
        src={imageUrl}
        alt={imageAlt ?? title}
        kind="content"
        sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
      />
      <div className="flex flex-1 flex-col gap-2 p-5 pt-4">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Badge tone="amber">{CONTENT_TYPE_LABEL[type] ?? type}</Badge>
          {categoryLabel && (
            <span className="text-[11px] font-semibold uppercase tracking-wider text-accent">{categoryLabel}</span>
          )}
          {publishedAt && shownDate && (
            <time dateTime={publishedAt} className="text-xs text-zinc-500">
              {shownDate}
            </time>
          )}
        </div>
        <h3 className="font-display text-lg font-semibold leading-snug tracking-tight text-zinc-900 group-hover:text-accent">
          {title}
        </h3>
        {excerpt && <p className="text-sm leading-relaxed text-zinc-600 line-clamp-2">{excerpt}</p>}
      </div>
    </Link>
  );
}

export function ProductCard({
  href,
  name,
  manufacturerName,
  summary,
  status,
  imageUrl,
  imageAlt,
  meta,
}: {
  href: string;
  name: string;
  manufacturerName?: string | null;
  summary?: string | null;
  status?: string;
  imageUrl?: string | null;
  imageAlt?: string | null;
  /** Extra factual line (e.g. a real release date). Never a price or rating. */
  meta?: string | null;
}) {
  return (
    <Link
      href={href}
      className={`group flex h-full flex-col overflow-hidden rounded-xl border border-border-subtle bg-white transition-[border-color,box-shadow] hover:border-accent/40 hover:shadow-[0_1px_18px_-8px_rgba(180,83,9,0.45)] ${CARD_FOCUS}`}
    >
      <MediaFrame
        src={imageUrl}
        alt={imageAlt ?? name}
        kind="product"
        sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
      />
      <div className="flex flex-1 flex-col gap-2 p-5 pt-4">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {manufacturerName && (
            <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">{manufacturerName}</span>
          )}
          {status && status !== "active" && (
            <Badge tone={status === "rumored" ? "amber" : "neutral"}>{status}</Badge>
          )}
        </div>
        <h3 className="font-display text-lg font-semibold leading-snug tracking-tight text-zinc-900 group-hover:text-accent">
          {name}
        </h3>
        {meta && <p className="text-xs text-zinc-500">{meta}</p>}
        {summary && <p className="text-sm leading-relaxed text-zinc-600 line-clamp-2">{summary}</p>}
      </div>
    </Link>
  );
}

/**
 * Section rule used across the public site. The short orange tick is the whole
 * of the accent here — the restrained-orange identity means the colour marks
 * structure, it does not fill blocks.
 */
export function SectionHeading({
  children,
  action,
  note,
  id,
}: {
  children: React.ReactNode;
  action?: React.ReactNode;
  /** One honest line about what the section is or how it is ordered. */
  note?: React.ReactNode;
  id?: string;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-2 border-b border-zinc-900/10 pb-3">
      <div className="flex min-w-0 items-center gap-3">
        <span aria-hidden="true" className="h-5 w-1 shrink-0 rounded-full bg-accent" />
        <div className="min-w-0">
          <h2 id={id} className="font-display text-lg font-bold tracking-tight text-zinc-900 sm:text-xl">
            {children}
          </h2>
          {note && <p className="mt-1 text-xs leading-relaxed text-zinc-500">{note}</p>}
        </div>
      </div>
      {action}
    </div>
  );
}
