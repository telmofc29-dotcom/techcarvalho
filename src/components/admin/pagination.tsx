import Link from "next/link";

export function Pagination({
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
    <nav aria-label="Pagination" className="flex items-center justify-between mt-4 text-sm">
      <span className="text-neutral-500">
        Page {page} of {pageCount}
      </span>
      <div className="flex items-center gap-2">
        {page > 1 ? (
          <Link href={hrefFor(page - 1)} className="rounded px-3 py-1.5 border border-neutral-300 hover:bg-neutral-50">
            Previous
          </Link>
        ) : (
          <span className="rounded px-3 py-1.5 border border-neutral-200 text-neutral-300">Previous</span>
        )}
        {page < pageCount ? (
          <Link href={hrefFor(page + 1)} className="rounded px-3 py-1.5 border border-neutral-300 hover:bg-neutral-50">
            Next
          </Link>
        ) : (
          <span className="rounded px-3 py-1.5 border border-neutral-200 text-neutral-300">Next</span>
        )}
      </div>
    </nav>
  );
}
