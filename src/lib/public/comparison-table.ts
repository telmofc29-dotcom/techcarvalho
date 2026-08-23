import { formatSpecValue } from "./spec-value.ts";
// Structured comparison data, built from real product specifications.
//
// WHY THIS EXISTS
// ---------------
// Every comparison on this site is currently a 1600x900 PNG rendered into a
// 342px slot on a phone. A raster chart cannot reflow, cannot be read by a
// screen reader, cannot be selected or searched, and carries its information
// in pixels that no crawler can parse. The information itself already exists as
// structured rows: 582 product_specs across 44 products, against 67 spec
// definitions.
//
// So the essential comparison information becomes HTML and the graphic, where
// one exists, becomes what it should always have been — a supplementary visual.
//
// NOTHING HERE INVENTS A SPECIFICATION
// ------------------------------------
// A product with no recorded value for a row gets an explicit "not recorded"
// marker, never a plausible-looking guess and never a blank that reads as
// "none". That distinction is the whole point: an empty cell in a spec table is
// read by a person as "this product does not have that", which is a claim. The
// only honest rendering of an absent value is one that says it is absent.
//
// Pure. No I/O.

export type SpecValue = string | number | boolean | null;

export type ComparisonProduct = {
  id: string;
  name: string;
  slug: string;
};

export type ComparisonSpecInput = {
  productId: string;
  definitionId: string;
  value: SpecValue;
};

export type ComparisonDefinition = {
  id: string;
  name: string;
  unit: string | null;
  dataType: string;
};

export type ComparisonCell =
  | { kind: "value"; text: string }
  /** No row exists for this product/definition pair. NOT the same as "none". */
  | { kind: "not_recorded" };

export type ComparisonRow = {
  definitionId: string;
  label: string;
  cells: ComparisonCell[];
  /** True when the compared products do not all share the same value. */
  differs: boolean;
};

export type ComparisonTable = {
  products: ComparisonProduct[];
  rows: ComparisonRow[];
  /** Rows omitted because too few products had a value. Reported, not hidden. */
  omittedForSparseData: number;
};

/**
 * How many of the compared products must carry a value for a row to appear.
 *
 * Two. A row where only one product has a value is not a comparison — it is a
 * fact about one product wearing a comparison's clothes, and it makes the other
 * column look deficient when the truth is that nobody recorded anything.
 */
export const MIN_PRODUCTS_WITH_VALUE = 2;

/** The most rows to render. A comparison is a summary, not a data dump. */
export const MAX_ROWS = 24;

// Delegates to the shared formatter so the comparison table and the product
// page can never disagree about what a spec value says. The local version used
// String(), which rendered the 98 double-encoded rows in this catalogue as raw
// JSON, and appended the unit unconditionally so a value already carrying one
// got it twice.
function formatValue(value: SpecValue, unit: string | null): string | null {
  return formatSpecValue(value, unit);
}

/**
 * Build the comparison matrix.
 *
 * Rows where every product holds the SAME value are kept but marked
 * `differs: false`, so a caller can choose to collapse them. They are not
 * dropped: "both of these cameras use the same mount" is frequently the single
 * most useful line in a comparison, and a table that silently hides agreement
 * would answer the reader's question by omission.
 */
export function buildComparisonTable(input: {
  products: ComparisonProduct[];
  definitions: ComparisonDefinition[];
  specs: ComparisonSpecInput[];
}): ComparisonTable {
  const { products } = input;
  if (products.length < 2) {
    return { products, rows: [], omittedForSparseData: 0 };
  }

  const defById = new Map(input.definitions.map((d) => [d.id, d]));
  // definitionId -> productId -> formatted value
  const byDef = new Map<string, Map<string, string>>();
  for (const spec of input.specs) {
    const def = defById.get(spec.definitionId);
    if (!def) continue;
    const text = formatValue(spec.value, def.unit);
    if (text === null) continue;
    const row = byDef.get(spec.definitionId) ?? new Map<string, string>();
    row.set(spec.productId, text);
    byDef.set(spec.definitionId, row);
  }

  const rows: ComparisonRow[] = [];
  let omitted = 0;

  // Definition order is the caller's order, so the table reads the way the
  // spec definitions were authored rather than in database order.
  for (const def of input.definitions) {
    const values = byDef.get(def.id);
    if (!values) continue;

    const present = products.filter((p) => values.has(p.id)).length;
    if (present < MIN_PRODUCTS_WITH_VALUE) {
      omitted++;
      continue;
    }

    const cells: ComparisonCell[] = products.map((p) => {
      const text = values.get(p.id);
      return text === undefined ? { kind: "not_recorded" } : { kind: "value", text };
    });

    const distinct = new Set(
      cells.filter((c): c is { kind: "value"; text: string } => c.kind === "value").map((c) => c.text)
    );

    rows.push({ definitionId: def.id, label: def.name, cells, differs: distinct.size > 1 });
  }

  // Differences first — they are what a reader came for — then shared values,
  // each group keeping its authored order.
  const ordered = [...rows.filter((r) => r.differs), ...rows.filter((r) => !r.differs)];

  return {
    products,
    rows: ordered.slice(0, MAX_ROWS),
    omittedForSparseData: omitted + Math.max(0, ordered.length - MAX_ROWS),
  };
}

/**
 * Whether a table is worth rendering at all.
 *
 * A table with no differing rows is not a comparison; a table with one row is
 * a sentence. Both are better said in prose than dressed as data.
 */
export function isComparisonWorthRendering(table: ComparisonTable): boolean {
  if (table.products.length < 2) return false;
  if (table.rows.length < 2) return false;
  return table.rows.some((r) => r.differs);
}
