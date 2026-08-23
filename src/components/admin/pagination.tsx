import Link from "next/link";

export function Pagination({
  page,
  pageCount,
  basePath,
  searchParams = {},
  total,
  itemNoun = "item",
}: {
  page: number;
  pageCount: number;
  basePath: string;
  searchParams?: Record<string, string | undefined>;
  /**
   * Total matching rows. Shown beside the page position.
   *
   * Without it a paginated list gives no sense of scale: /admin/media showed 25
   * cards and "Page 1 of 5" and nothing else, so a 112-asset library read as a
   * small one. The page count alone answers "where am I", never "how much is
   * there".
   */
  total?: number;
  /** Singular noun for the total, e.g. "asset" -> "112 assets". */
  itemNoun?: string;
}) {
  if (pageCount <= 1 && total === undefined) return null;

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
        {total !== undefined && (
          <> · <span className="tabular-nums font-medium text-neutral-700">{total}</span>{" "}
            {itemNoun}{total === 1 ? "" : "s"}</>
        )}
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
