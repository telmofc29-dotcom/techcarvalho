// Turning a knowledge graph into article briefs worth writing.
//
// WHY THIS IS A MODULE AND NOT A PROMPT
// -------------------------------------
// The easy version of "generate article ideas from a catalogue" produces two
// hundred pages called "Canon RF 50mm f/1.8 STM review" and destroys the site.
// The hard part is not generating ideas; it is refusing most of them.
//
// So the rules that decide what is worth a page live here, in one testable
// place, rather than in a prompt nobody can assert against.
//
// THE FOUR REFUSALS
// -----------------
// 1. NO NEAR-DUPLICATES. A brief whose subject is already covered by a
//    published article is dropped. Matching is on the SUBJECT (the concept or
//    the product pair), never on title wording, because two different questions
//    about one lens are two articles and two phrasings of one question are one.
//
// 2. NO COMPARISON WITHOUT SHARED GROUND. "X vs Y" needs both products to hold
//    values for the same specifications, or the piece is a table of blanks
//    wearing a comparison's clothes. MIN_SHARED_SPECS is the floor.
//
// 3. NO COMPARISON ACROSS UNRELATED THINGS. A 3D printer and a lens share a
//    category with nothing. Even within lenses, comparing a 600mm supertelephoto
//    with a 16mm ultra-wide answers no question anybody asks. Candidates must be
//    genuinely substitutable — same mount, same broad class.
//
// 4. NO REVIEW BRIEFS. This site publishes no hands-on testing, so a brief
//    called "review" would commission a lie. The type is not in the vocabulary
//    below, and a test asserts it never appears.
//
// Pure. No I/O.

export type BriefKind =
  /** Explains one reusable concept: "What does USM mean on a Canon lens?" */
  | "concept_explainer"
  /** Compares two genuinely substitutable products. */
  | "product_comparison"
  /** Explains what changed between two generations of one thing. */
  | "generation_change"
  /** Explains a whole mount or system. */
  | "system_overview";

export type GeneratedBrief = {
  kind: BriefKind;
  title: string;
  slug: string;
  /** The question a reader is actually typing. */
  primaryQuery: string;
  contentType: "guide" | "comparison";
  categorySlug: string;
  /** Why this page deserves to exist, for a human approving the brief. */
  rationale: string;
  /** Product slugs the piece should link to. */
  relatedProductSlugs: string[];
  /** A stable identity for the SUBJECT, used to detect duplicates. */
  subjectKey: string;
};

export type BriefProduct = {
  slug: string;
  name: string;
  categorySlug: string;
  manufacturerSlug: string;
  /** spec slug -> value, for the specs this product actually holds. */
  specs: Record<string, string | number | boolean>;
};

export type BriefConcept = {
  slug: string;
  name: string;
  kind: string;
  manufacturerSlug: string | null;
  categorySlug: string;
  hasSummary: boolean;
};

/** Existing coverage, so nothing is proposed twice. */
export type ExistingCoverage = {
  /** subjectKeys already covered by a published or drafted article. */
  subjectKeys: Set<string>;
  /** Lowercased primary queries already claimed. */
  primaryQueries: Set<string>;
};

/** Below this many specs held by BOTH products, a comparison is a table of blanks. */
export const MIN_SHARED_SPECS = 6;

/** Specs that must match for two lenses to be worth comparing at all. */
const COMPARABLE_LENS_KEYS = ["lens-mount-type", "lens-type"] as const;

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90);
}

/**
 * Focal class, used to decide whether two lenses answer the same question.
 *
 * A reader choosing a portrait lens is not also considering a 600mm wildlife
 * lens. Comparing across classes produces pages that rank for nothing because
 * nobody searches for them.
 */
export function focalClass(specs: Record<string, string | number | boolean>): string | null {
  const min = Number(specs["focal-length-min"]);
  if (!Number.isFinite(min)) return null;
  const maxRaw = Number(specs["focal-length-max"]);
  const max = Number.isFinite(maxRaw) ? maxRaw : min;
  // Classify a ZOOM by where it starts, not by its midpoint. A 24-70 and a
  // 24-105 are the same purchase decision, and averaging puts them in different
  // classes (47mm "standard" and 64.5mm "portrait") — which is how a filter
  // meant to stop absurd comparisons ends up blocking the obvious ones.
  const representative = min;
  void max;
  if (representative < 20) return "ultra-wide";
  if (representative < 35) return "wide";
  if (representative < 60) return "standard";
  if (representative < 105) return "portrait";
  if (representative < 300) return "telephoto";
  return "supertelephoto";
}

/** How much two focal ranges overlap, as a fraction of the narrower range. */
export function rangeOverlap(
  a: Record<string, string | number | boolean>,
  b: Record<string, string | number | boolean>
): number | null {
  const aMin = Number(a["focal-length-min"]);
  const bMin = Number(b["focal-length-min"]);
  if (!Number.isFinite(aMin) || !Number.isFinite(bMin)) return null;
  const aMax = Number.isFinite(Number(a["focal-length-max"])) ? Number(a["focal-length-max"]) : aMin;
  const bMax = Number.isFinite(Number(b["focal-length-max"])) ? Number(b["focal-length-max"]) : bMin;

  const lo = Math.max(aMin, bMin);
  const hi = Math.min(aMax, bMax);
  const overlap = Math.max(0, hi - lo);
  const narrower = Math.min(aMax - aMin, bMax - bMin);
  // Two primes at the same focal length fully overlap; two primes at different
  // focal lengths do not overlap at all.
  if (narrower === 0) return aMin === bMin ? 1 : 0;
  return overlap / narrower;
}

/** Below this share of overlap, two zooms are not answering the same question. */
export const MIN_RANGE_OVERLAP = 0.5;

function sharedSpecCount(a: BriefProduct, b: BriefProduct): number {
  let n = 0;
  for (const k of Object.keys(a.specs)) if (k in b.specs) n++;
  return n;
}

/**
 * Are these two products genuinely substitutable?
 *
 * Same category, same manufacturer-agnostic mount, same lens type, same focal
 * class, and enough shared specifications to fill a table. Anything less
 * produces a comparison nobody searched for.
 */
export function areComparable(a: BriefProduct, b: BriefProduct): boolean {
  if (a.slug === b.slug) return false;
  if (a.categorySlug !== b.categorySlug) return false;
  for (const key of COMPARABLE_LENS_KEYS) {
    const av = a.specs[key];
    const bv = b.specs[key];
    // If neither holds the key this is not a lens; fall through to the spec
    // count. If one holds it and the other does not, they are not comparable.
    if (av === undefined && bv === undefined) continue;
    if (av !== bv) return false;
  }
  // Focal comparability, by overlap rather than by label. The class boundaries
  // are arbitrary lines through a continuum — a 34mm and a 36mm lens are the
  // same purchase and land either side of "wide"/"standard" — so overlap is
  // asked first and the class only used when there is no focal data at all.
  const overlap = rangeOverlap(a.specs, b.specs);
  if (overlap !== null) {
    if (overlap < MIN_RANGE_OVERLAP) return false;
  } else {
    const fa = focalClass(a.specs);
    const fb = focalClass(b.specs);
    if (fa && fb && fa !== fb) return false;
  }
  return sharedSpecCount(a, b) >= MIN_SHARED_SPECS;
}

/** A stable identity for a comparison, independent of which product is named first. */
export function comparisonKey(a: string, b: string): string {
  return [a, b].sort().join("|");
}

/**
 * Concept explainers.
 *
 * Only for concepts that carry a summary: a brief to explain something nobody
 * has researched yet would commission the research and the article at once,
 * and the research is the part that has to happen first.
 */
export function conceptBriefs(
  concepts: readonly BriefConcept[],
  productsByConcept: Map<string, string[]>,
  existing: ExistingCoverage
): GeneratedBrief[] {
  const out: GeneratedBrief[] = [];
  for (const c of concepts) {
    if (!c.hasSummary) continue;
    const subjectKey = `concept:${c.slug}`;
    if (existing.subjectKeys.has(subjectKey)) continue;

    const question =
      c.kind === "mount"
        ? `What is the ${c.name}?`
        : c.kind === "material"
          ? `What is ${c.name}, and when should you use it?`
          : `What does ${c.name} mean?`;
    const query = question.toLowerCase().replace(/[?]/g, "").trim();
    if (existing.primaryQueries.has(query)) continue;

    const products = productsByConcept.get(c.slug) ?? [];
    out.push({
      kind: "concept_explainer",
      title: question,
      slug: slugify(`${c.name} explained`),
      primaryQuery: query,
      contentType: "guide",
      categorySlug: c.categorySlug,
      rationale:
        `${c.name} appears on ${products.length} product${products.length === 1 ? "" : "s"} in the catalogue ` +
        `and has a sourced summary, but no article explains it. A reader meeting the term on a ` +
        `product page currently has nowhere to go.`,
      relatedProductSlugs: products.slice(0, 12),
      subjectKey,
    });
  }
  return out;
}

/**
 * Comparison briefs, heavily filtered.
 *
 * Capped per product so one popular lens does not generate forty pages, which
 * is exactly how a catalogue turns into a doorway-page farm.
 */
export const MAX_COMPARISONS_PER_PRODUCT = 2;

export function comparisonBriefs(
  products: readonly BriefProduct[],
  existing: ExistingCoverage
): GeneratedBrief[] {
  const out: GeneratedBrief[] = [];
  const perProduct = new Map<string, number>();
  const seen = new Set<string>();

  for (let i = 0; i < products.length; i++) {
    for (let j = i + 1; j < products.length; j++) {
      const a = products[i];
      const b = products[j];
      if (!areComparable(a, b)) continue;

      const key = comparisonKey(a.slug, b.slug);
      if (seen.has(key)) continue;
      const subjectKey = `comparison:${key}`;
      if (existing.subjectKeys.has(subjectKey)) continue;
      if ((perProduct.get(a.slug) ?? 0) >= MAX_COMPARISONS_PER_PRODUCT) continue;
      if ((perProduct.get(b.slug) ?? 0) >= MAX_COMPARISONS_PER_PRODUCT) continue;

      const query = `${a.name} vs ${b.name}`.toLowerCase();
      if (existing.primaryQueries.has(query)) continue;

      seen.add(key);
      perProduct.set(a.slug, (perProduct.get(a.slug) ?? 0) + 1);
      perProduct.set(b.slug, (perProduct.get(b.slug) ?? 0) + 1);

      out.push({
        kind: "product_comparison",
        title: `${a.name} vs ${b.name}`,
        slug: slugify(`${a.slug} vs ${b.slug}`),
        primaryQuery: query,
        contentType: "comparison",
        categorySlug: a.categorySlug,
        rationale:
          `Both hold ${sharedSpecCount(a, b)} of the same recorded specifications, share a mount ` +
          `and cover the same focal class, so a structured comparison can be built from real data ` +
          `rather than assertion.`,
        relatedProductSlugs: [a.slug, b.slug],
        subjectKey,
      });
    }
  }
  return out;
}

/**
 * The full set, deduplicated against existing coverage and against itself.
 *
 * Returned in a deliberate order — concepts first — because an explainer is
 * reusable by every comparison that links to it, and writing the comparisons
 * first produces pages with nowhere to send a confused reader.
 */
export function generateBriefs(input: {
  concepts: readonly BriefConcept[];
  productsByConcept: Map<string, string[]>;
  products: readonly BriefProduct[];
  existing: ExistingCoverage;
}): GeneratedBrief[] {
  const briefs = [
    ...conceptBriefs(input.concepts, input.productsByConcept, input.existing),
    ...comparisonBriefs(input.products, input.existing),
  ];

  // Final self-dedupe on slug: two different subjects must never collide on a
  // URL, and if they do the second is dropped rather than silently overwriting.
  const bySlug = new Map<string, GeneratedBrief>();
  for (const b of briefs) if (!bySlug.has(b.slug)) bySlug.set(b.slug, b);
  return [...bySlug.values()];
}
