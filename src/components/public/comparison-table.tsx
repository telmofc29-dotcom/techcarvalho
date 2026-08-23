import Link from "next/link";
import type { ComparisonTable } from "@/lib/public/comparison-table";

// Responsive comparison table.
//
// ONE SEMANTIC TABLE, TWO PRESENTATIONS
// -------------------------------------
// The markup is a real <table> with a proper header row and row headers, so it
// is one table to a screen reader, to a crawler and to anyone who selects and
// copies it. What changes at narrow widths is the CSS, not the semantics —
// rendering two different DOM trees and hiding one would duplicate the content
// for assistive technology and for anything parsing the page.
//
// At >=640px it reads as a conventional grid: specification down the left, one
// column per product.
//
// Below that a grid of three columns cannot survive — the audit measured spec
// rows colliding at 320px with a 230px content box — so each row becomes its
// own block: the specification name, then the product values stacked under it,
// each labelled. That is why every value cell carries a `data-product`
// attribute rendered as its label on small screens: the label has to come from
// the cell itself, because the header row is not adjacent to it any more.
//
// AN ABSENT VALUE SAYS SO
// -----------------------
// "Not recorded" rather than an empty cell. A blank in a specification table is
// read as "this product does not have that", which is a claim nobody made. See
// the note in src/lib/public/comparison-table.ts.

export function ComparisonTableView({
  table,
  caption,
}: {
  table: ComparisonTable;
  caption: string;
}) {
  return (
    <figure className="my-8">
      {/* overflow-x on the wrapper, never on the page. The site currently has
          zero horizontal overflow at every tested width and this must not be
          the thing that introduces it. */}
      <div className="overflow-x-auto rounded-xl border border-border-subtle">
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">{caption}</caption>
          <thead className="hidden sm:table-header-group">
            <tr className="border-b border-border-subtle bg-zinc-50">
              <th scope="col" className="px-3 py-2.5 text-left font-semibold text-zinc-500">
                Specification
              </th>
              {table.products.map((p) => (
                <th key={p.id} scope="col" className="px-3 py-2.5 text-left font-semibold text-zinc-900">
                  <Link href={`/products/${p.slug}`} className="hover:text-accent">
                    {p.name}
                  </Link>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border-subtle">
            {table.rows.map((row) => (
              <tr
                key={row.definitionId}
                className="block border-b border-border-subtle last:border-0 sm:table-row sm:border-0"
              >
                <th
                  scope="row"
                  className="block px-3 pt-3 pb-1 text-left align-top text-xs font-semibold uppercase tracking-wide text-zinc-500 sm:table-cell sm:py-2.5 sm:text-sm sm:normal-case sm:tracking-normal sm:font-medium sm:text-zinc-600"
                >
                  {row.label}
                </th>
                {row.cells.map((cell, i) => (
                  <td
                    key={table.products[i]?.id ?? i}
                    // The product name is carried on the cell because at narrow
                    // widths the header row is no longer adjacent to it.
                    data-product={table.products[i]?.name}
                    className="block px-3 pb-2 align-top text-zinc-900 before:mr-2 before:text-xs before:font-medium before:text-zinc-400 before:content-[attr(data-product)] sm:table-cell sm:py-2.5 sm:before:content-none"
                  >
                    {cell.kind === "value" ? (
                      cell.text
                    ) : (
                      <span className="text-zinc-400">Not recorded</span>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <figcaption className="mt-2 text-xs leading-relaxed text-zinc-500">
        {caption}
        {table.omittedForSparseData > 0 && (
          <>
            {" "}
            {table.omittedForSparseData} further specification
            {table.omittedForSparseData === 1 ? " is" : "s are"} recorded for only one of these
            products and {table.omittedForSparseData === 1 ? "is" : "are"} left out rather than shown
            as a gap.
          </>
        )}
      </figcaption>
    </figure>
  );
}
