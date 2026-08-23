import Link from "next/link";
import { paginationWindow } from "@/lib/public/pagination";

// Server-rendered pagination. No client component, no fetching, no state: the
// page numbers are real <a href> values that a crawler follows and a reader can
// copy, which is the whole reason paginated hub content stays discoverable.
//
// Previous/Next alone made page N cost N-1 hops from page 1. Numbered links
// (windowed, with the first and last page always present — see
// paginationWindow) keep every page within two hops, which is what stops the
// tail of a long hub from being effectively orphaned.
//
// Layout: `flex-wrap` throughout, so a pager with several numbers wraps onto a
// second line at 320px instead of pushing the document wider than the
// viewport. Nothing here loads late or resizes after paint, so it contributes
// no layout shift.
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

  // Touch sizing: these were 36-38px tall and the number links 40px wide.
  // min-h-11/min-w-11 with flex centring makes every pager control a full
  // 44x44 target; the type size and the pill shape are unchanged, the box
  // around them just stops being a near-miss for a thumb. Applied to the
  // disabled <span> variants too, so the row does not change height between
  // page 1 and page 2.
  const stepClass =
    "inline-flex min-h-11 items-center justify-center rounded-full border border-border-subtle px-4 hover:border-accent/40";
  const numberClass =
    "inline-flex min-h-11 min-w-11 items-center justify-center rounded-full border border-border-subtle px-3 hover:border-accent/40";

  return (
    <nav
      aria-label="Pagination"
      className="mt-10 flex flex-wrap items-center justify-between gap-x-4 gap-y-3 text-sm"
    >
      <span className="text-zinc-500">
        Page {page} of {pageCount}
      </span>
      <ul className="flex flex-wrap items-center gap-2">
        <li>
          {page > 1 ? (
            <Link href={hrefFor(page - 1)} rel="prev" className={stepClass}>
              Previous
            </Link>
          ) : (
            // Kept as a non-link rather than removed so the control does not
            // move position between page 1 and page 2.
            <span className={`${stepClass} text-zinc-300`} aria-hidden="true">
              Previous
            </span>
          )}
        </li>
        {paginationWindow(page, pageCount).map((slot, index) =>
          slot === "gap" ? (
            <li key={`gap-${index}`} aria-hidden="true" className="px-1 text-zinc-400">
              …
            </li>
          ) : slot === page ? (
            <li key={slot}>
              <span aria-current="page" className={`${numberClass} border-zinc-900 bg-zinc-900 text-white`}>
                {slot}
              </span>
            </li>
          ) : (
            <li key={slot}>
              <Link href={hrefFor(slot)} aria-label={`Page ${slot}`} className={numberClass}>
                {slot}
              </Link>
            </li>
          )
        )}
        <li>
          {page < pageCount ? (
            <Link href={hrefFor(page + 1)} rel="next" className={stepClass}>
              Next
            </Link>
          ) : (
            <span className={`${stepClass} text-zinc-300`} aria-hidden="true">
              Next
            </span>
          )}
        </li>
      </ul>
    </nav>
  );
}
