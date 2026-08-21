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

// Shared card image area — a fixed 4:3 box so a mixed grid of image/no-image
// cards never jumps in height (CLS), with a deliberate on-brand placeholder
// (never a broken-image icon, never a blank gap) when no image exists yet.
// The placeholder reuses the site's own accent palette so an image-less
// card still reads as "intentional, not broken" per the card's own type
// icon (a simple camera-body glyph for products, a document glyph for
// content) rather than a generic empty square.
function CardImage({
  src,
  alt,
  kind,
  sizes,
}: {
  src?: string | null;
  alt: string;
  kind: "product" | "content";
  sizes: string;
}) {
  if (src) {
    return (
      <div className="relative w-full aspect-[4/3] overflow-hidden rounded-t-xl bg-zinc-100">
        <Image
          src={src}
          alt={alt}
          fill
          sizes={sizes}
          className="object-cover transition-transform duration-300 group-hover:scale-[1.03]"
        />
      </div>
    );
  }
  return (
    <div className="relative w-full aspect-[4/3] overflow-hidden rounded-t-xl bg-accent-soft/60 flex items-center justify-center">
      {kind === "product" ? (
        <svg viewBox="0 0 48 48" className="h-9 w-9 text-accent/40" fill="none" aria-hidden="true">
          <rect x="6" y="16" width="36" height="24" rx="3" stroke="currentColor" strokeWidth="2" />
          <path d="M17 16l3-6h8l3 6" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
          <circle cx="24" cy="28" r="7" stroke="currentColor" strokeWidth="2" />
        </svg>
      ) : (
        <svg viewBox="0 0 48 48" className="h-9 w-9 text-accent/40" fill="none" aria-hidden="true">
          <rect x="10" y="6" width="28" height="36" rx="2" stroke="currentColor" strokeWidth="2" />
          <path d="M16 16h16M16 24h16M16 32h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      )}
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
  excerpt,
  imageUrl,
  imageAlt,
}: {
  href: string;
  type: string;
  title: string;
  publishedAt?: string | null;
  excerpt?: string | null;
  imageUrl?: string | null;
  imageAlt?: string | null;
}) {
  return (
    <Link
      href={href}
      className="group flex flex-col gap-2 rounded-xl border border-border-subtle bg-white overflow-hidden transition-colors hover:border-accent/40"
    >
      <CardImage src={imageUrl} alt={imageAlt ?? title} kind="content" sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw" />
      <div className="flex flex-col gap-2 p-5 pt-3">
        <div className="flex items-center gap-2">
          <Badge tone="amber">{CONTENT_TYPE_LABEL[type] ?? type}</Badge>
          {publishedAt && (
            <time dateTime={publishedAt} className="text-xs text-zinc-500">
              {new Date(publishedAt).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}
            </time>
          )}
        </div>
        <h3 className="font-display text-lg font-semibold text-zinc-900 leading-snug group-hover:text-accent">
          {title}
        </h3>
        {excerpt && <p className="text-sm text-zinc-600 line-clamp-2">{excerpt}</p>}
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
}: {
  href: string;
  name: string;
  manufacturerName?: string | null;
  summary?: string | null;
  status?: string;
  imageUrl?: string | null;
  imageAlt?: string | null;
}) {
  return (
    <Link
      href={href}
      className="group flex flex-col gap-2 rounded-xl border border-border-subtle bg-white overflow-hidden transition-colors hover:border-accent/40"
    >
      <CardImage src={imageUrl} alt={imageAlt ?? name} kind="product" sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw" />
      <div className="flex flex-col gap-2 p-5 pt-3">
        <div className="flex items-center gap-2">
          {manufacturerName && <span className="text-xs font-medium text-zinc-500">{manufacturerName}</span>}
          {status && status !== "active" && (
            <Badge tone={status === "rumored" ? "amber" : "neutral"}>{status}</Badge>
          )}
        </div>
        <h3 className="font-display text-lg font-semibold text-zinc-900 leading-snug group-hover:text-accent">
          {name}
        </h3>
        {summary && <p className="text-sm text-zinc-600 line-clamp-2">{summary}</p>}
      </div>
    </Link>
  );
}

export function SectionHeading({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex items-end justify-between gap-4 mb-6">
      <h2 className="font-display text-sm font-semibold uppercase tracking-wider text-zinc-500">{children}</h2>
      {action}
    </div>
  );
}
