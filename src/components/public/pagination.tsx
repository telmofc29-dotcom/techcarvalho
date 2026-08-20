import Link from "next/link";

export function PublicPagination({
  page,
  pageCount,
  basePath,
  searchParams = {},
}: {
  page: number;
  pageCount: number;
  basePath: string;
  searchParams?: Record<string, string | undefined>;
}) {
  if (pageCount <= 1) return null;

  const hrefFor = (targetPage: number) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(searchParams)) {
      if (value) params.set(key, value);
    }
    if (targetPage > 1) params.set("page", String(targetPage));
    const qs = params.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  };

  return (
    <nav aria-label="Pagination" className="flex items-center justify-between mt-10 text-sm">
      <span className="text-zinc-500">
        Page {page} of {pageCount}
      </span>
      <div className="flex items-center gap-2">
        {page > 1 ? (
          <Link href={hrefFor(page - 1)} className="rounded-full border border-border-subtle px-4 py-2 hover:border-accent/40">
            Previous
          </Link>
        ) : (
          <span className="rounded-full border border-border-subtle px-4 py-2 text-zinc-300">Previous</span>
        )}
        {page < pageCount ? (
          <Link href={hrefFor(page + 1)} className="rounded-full border border-border-subtle px-4 py-2 hover:border-accent/40">
            Next
          </Link>
        ) : (
          <span className="rounded-full border border-border-subtle px-4 py-2 text-zinc-300">Next</span>
        )}
      </div>
    </nav>
  );
}
