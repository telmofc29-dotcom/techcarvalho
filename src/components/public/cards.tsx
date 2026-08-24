import Link from "next/link";
import Image from "next/image";
import { Badge } from "@/components/shared/ui";
import type { MediaFit } from "@/lib/media/presentation";

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

// `sizes` for the standard index/listing grid: a 3-column grid inside the
// site's `max-w-6xl px-6` shell (1104px of content, so ~352px per column once
// the gaps come out), collapsing to 2 columns at 640px and 1 below that.
//
// The fixed 360px top stop matters. Without it the declaration read
// "(min-width: 1024px) 33vw", which is only true while the container is still
// growing — past 1200px the container is pinned at its max width and the real
// column stays ~352px, but the browser keeps believing 33vw and on a 1600px
// screen fetches a 528px-wide file (1056px at 2x DPR) for a 352px slot.
export const CARD_SIZES =
  "(min-width: 1200px) 360px, (min-width: 1024px) 33vw, (min-width: 640px) 50vw, calc(100vw - 48px)";

/** Same grid but inside the `max-w-3xl` article column: 3 up, ~230px each. */
export const CARD_SIZES_ARTICLE_3 = "(min-width: 640px) 240px, calc(100vw - 48px)";

/** `max-w-3xl` article column, 2 up: ~350px each. */
export const CARD_SIZES_ARTICLE_2 = "(min-width: 640px) 352px, calc(100vw - 48px)";

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
//
// `fit` is the mixed-media half. A card frame has to be a fixed shape for the
// grid to line up, but the images going into it do not all tolerate being
// cropped to that shape: a photograph does, and a comparison chart, timeline
// or title card does not — those are designed 1600x900 rectangles whose
// content runs to the edges. `fit="contain"` puts such an asset on a neutral
// ground at its own proportions instead of trimming its sides off, and drops
// the hover zoom, because magnifying a chart past the frame crops it again.
// The decision itself comes from classifyMediaTier() via mediaFit() — never
// from the filename at the call site.
export function MediaFrame({
  src,
  alt,
  kind,
  sizes,
  preload = false,
  fit = "cover",
  // Callers own the frame's size and rounding, including width — MediaFrame
  // must not hardcode `w-full`, because a Tailwind width class passed in here
  // would then collide with it and resolve by stylesheet order rather than by
  // call site.
  className = "aspect-[4/3] w-full rounded-t-xl",
  iconClassName = "h-9 w-9",
  credit,
  disclosure,
}: {
  src?: string | null;
  alt: string;
  kind: "product" | "content";
  /**
   * Must describe the width the frame is ACTUALLY rendered at, per breakpoint.
   * `sizes` is what the browser picks a srcset entry with, before any CSS has
   * been applied — an over-declared value silently downloads a file several
   * times larger than the slot needs.
   */
  sizes: string;
  /**
   * Preload this image via a `<link rel=preload>` in the head. At most ONE
   * image per page should set it — the LCP candidate. `priority` did this
   * before and is deprecated in Next 16 in favour of this prop.
   */
  preload?: boolean;
  fit?: MediaFit;
  className?: string;
  iconClassName?: string;
  /**
   * Credit text for a licensed image, e.g. "Photo: A.Savin, CC BY-SA 4.0".
   *
   * Rendered as TEXT rather than links, deliberately: a card is itself wrapped
   * in a <Link>, and nesting an anchor inside one is invalid HTML. CC BY asks
   * for attribution "in any reasonable manner based on the medium", and the
   * fully-linked credit — creator, licence deed and source — is one click away
   * on the detail page.
   *
   * Omitting this entirely was a live breach: the detail-page query selected
   * the credit fields and the batched card query did not, so every CC BY
   * photograph on the homepage, category pages and index pages rendered with
   * no credit at all.
   */
  credit?: string | null;
  /**
   * A required disclosure for this image, from requiredDisclosure().
   *
   * Rendered as a compact corner marker rather than the full sentence, for the
   * same reason `credit` is truncated here: a card is a thumbnail with a
   * headline, and a paragraph under every one would be noise that someone
   * eventually deletes. The full sentence appears on the detail page, one click
   * away, exactly as the linked credit does.
   *
   * It exists at all because a resolution rule was accidentally hiding these
   * images from cards. When that was fixed, six published AI-generated assets —
   * including renders of a real Xbox Series X and PS5 Pro attached to product
   * pages — began rendering on the homepage with nothing marking them as
   * machine-made. The lead and gallery surfaces already disclosed; cards never
   * had.
   */
  disclosure?: string | null;
}) {
  if (src) {
    const contained = fit === "contain";
    return (
      <div
        className={`relative overflow-hidden ${contained ? "bg-zinc-50" : "bg-zinc-100"} ${className}`}
      >
        <Image
          src={src}
          alt={alt}
          fill
          sizes={sizes}
          preload={preload}
          className={
            contained
              ? "object-contain p-1.5"
              : "object-cover transition-transform duration-300 group-hover:scale-[1.03]"
          }
        />
        {disclosure && (
          <span
            className="pointer-events-none absolute right-1.5 top-1.5 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium leading-tight text-white/90"
            title={disclosure}
          >
            AI
          </span>
        )}
        {credit && (
          <span
            className="pointer-events-none absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/55 to-transparent px-2 pb-1 pt-3 text-[10px] leading-tight text-white/85"
            // Not aria-hidden: a licence credit is content, not decoration.
          >
            {credit}
          </span>
        )}
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
  imageDisclosure,
  imageFit = "cover",
  sizes = CARD_SIZES,
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
  /** From requiredDisclosure(classifiable(asset)) at the callsite. */
  imageDisclosure?: string | null;
  /** From mediaFit(classifiable(heroImage)) — chart vs photograph. */
  imageFit?: MediaFit;
  /** Override when this card sits in a narrower column than the default grid. */
  sizes?: string;
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
        alt={imageAlt ?? ""}
        disclosure={imageDisclosure}
        kind="content"
        fit={imageFit}
        sizes={sizes}
        // 16:9, not 4:3. Every editorial graphic this site produces is a
        // 1600x900 canvas, and article heroes are overwhelmingly those — a 4:3
        // frame cropped 25% off both sides of a two-column comparison chart,
        // which is precisely the half of each column a reader needs. Matching
        // the frame to the library means the common case is not cropped at all.
        className="aspect-[16/9] w-full rounded-t-xl"
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
  imageDisclosure,
  imageFit = "cover",
  sizes = CARD_SIZES,
  meta,
}: {
  href: string;
  name: string;
  manufacturerName?: string | null;
  summary?: string | null;
  status?: string;
  imageUrl?: string | null;
  imageAlt?: string | null;
  /** From requiredDisclosure(classifiable(asset)) at the callsite. */
  imageDisclosure?: string | null;
  /** From mediaFit(classifiable(heroImage)) — chart vs photograph. */
  imageFit?: MediaFit;
  /** Override when this card sits in a narrower column than the default grid. */
  sizes?: string;
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
        alt={imageAlt ?? ""}
        disclosure={imageDisclosure}
        kind="product"
        fit={imageFit}
        sizes={sizes}
        // Stays 4:3 while ContentCard moved to 16:9: product heroes are all
        // photographs, and 4:3 or 3:2 is what the great majority of them
        // actually are, so this is the frame that crops them least.
        className="aspect-[4/3] w-full rounded-t-xl"
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
