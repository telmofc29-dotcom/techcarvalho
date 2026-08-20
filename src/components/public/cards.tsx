import Link from "next/link";
import { Badge } from "@/components/shared/ui";

const CONTENT_TYPE_LABEL: Record<string, string> = {
  review: "Review",
  guide: "Guide",
  comparison: "Comparison",
  news: "News",
};

export function ContentCard({
  href,
  type,
  title,
  publishedAt,
  excerpt,
}: {
  href: string;
  type: string;
  title: string;
  publishedAt?: string | null;
  excerpt?: string | null;
}) {
  return (
    <Link
      href={href}
      className="group flex flex-col gap-2 rounded-xl border border-border-subtle bg-white p-5 transition-colors hover:border-accent/40"
    >
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
    </Link>
  );
}

export function ProductCard({
  href,
  name,
  manufacturerName,
  summary,
  status,
}: {
  href: string;
  name: string;
  manufacturerName?: string | null;
  summary?: string | null;
  status?: string;
}) {
  return (
    <Link
      href={href}
      className="group flex flex-col gap-2 rounded-xl border border-border-subtle bg-white p-5 transition-colors hover:border-accent/40"
    >
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
