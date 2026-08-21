import Link from "next/link";

// Shared body for segment-specific not-found.tsx files (products/articles/
// manufacturers [slug] routes). Paired with each segment's own noindex
// metadata (buildNotFoundMetadata) so a bad slug never inherits the root
// layout's indexable metadata — see docs/analytics-adsense.md /
// CLAUDE.md for the full explanation of why this exists as its own file
// rather than falling back to the root not-found.tsx.
export function EntityNotFound({
  entityLabel,
  indexHref,
  browseLabel,
}: {
  entityLabel: string;
  indexHref: string;
  browseLabel: string;
}) {
  return (
    <div className="mx-auto max-w-2xl px-6 py-24 text-center flex flex-col items-center gap-4">
      <p className="text-sm font-semibold uppercase tracking-widest text-accent">Not found</p>
      <h1 className="font-display text-3xl font-bold tracking-tight text-zinc-900">
        {entityLabel} not found
      </h1>
      <p className="text-zinc-500 max-w-sm">
        This {entityLabel.toLowerCase()} doesn&apos;t exist, or hasn&apos;t been published yet.
      </p>
      <Link
        href={indexHref}
        className="mt-2 rounded-full bg-zinc-900 text-white px-5 py-2.5 text-sm font-medium hover:bg-zinc-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900"
      >
        {browseLabel}
      </Link>
    </div>
  );
}
