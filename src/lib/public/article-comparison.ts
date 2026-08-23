import { createClient } from "@/lib/supabase/server";
import { logQueryError } from "@/lib/log/query-error";
import {
  buildComparisonTable,
  isComparisonWorthRendering,
  type ComparisonProduct,
  type ComparisonTable,
} from "./comparison-table";

// Loads the specification data behind an article's comparison table.
//
// SEPARATE FROM article-detail.ts DELIBERATELY. That module is already a large
// batched query serving the hottest page on the site, and a comparison table is
// needed by a minority of articles. Loading specs for every article to serve
// the few would be three extra reads on eighty-one pages to benefit thirty-two.
//
// Returns null rather than an empty table whenever a comparison would be
// misleading — see isComparisonWorthRendering. A table with nothing differing
// in it is a sentence dressed as data.

export async function getArticleComparison(
  products: { id: string; name: string; slug: string }[]
): Promise<ComparisonTable | null> {
  if (products.length < 2) return null;

  const supabase = await createClient();
  const productIds = products.map((p) => p.id);

  const [specsResult, defsResult] = await Promise.all([
    supabase.from("product_specs").select("product_id, spec_definition_id, value").in("product_id", productIds),
    supabase.from("spec_definitions").select("id, name, unit, data_type"),
  ]);

  // A failed read is not an empty comparison. The public page degrades to no
  // table — a visitor never sees an error — but the failure is visible in the
  // server log instead of looking identical to a product with no specs, which
  // is the 2026-08 lesson this codebase is built around.
  logQueryError("getArticleComparison: product_specs", specsResult.error);
  logQueryError("getArticleComparison: spec_definitions", defsResult.error);
  if (specsResult.error || defsResult.error) return null;

  const definitions = (defsResult.data ?? []).map((d) => ({
    id: d.id as string,
    name: d.name as string,
    unit: (d.unit as string | null) ?? null,
    dataType: (d.data_type as string) ?? "text",
  }));

  const specs = (specsResult.data ?? []).map((s) => ({
    productId: s.product_id as string,
    definitionId: s.spec_definition_id as string,
    // product_specs.value is jsonb, so a text spec arrives as a string, a
    // numeric one as a number, and a boolean as a boolean. buildComparisonTable
    // formats each; anything structured is rejected there rather than
    // stringified into "[object Object]" — a mistake this project has already
    // shipped once, in the Commons EXIF reader.
    value: s.value as string | number | boolean | null,
  }));

  const ordered: ComparisonProduct[] = products.map((p) => ({ id: p.id, name: p.name, slug: p.slug }));
  const table = buildComparisonTable({ products: ordered, definitions, specs });
  return isComparisonWorthRendering(table) ? table : null;
}
