// Product-announcement detection.
//
// Decides whether a discovery describes a REAL, NAMED product that the
// catalogue does not yet have — and, crucially, refuses to decide when the
// evidence is thin.
//
// The products table requires a manufacturer_id and a category_id, both NOT
// NULL. That constraint is load-bearing here rather than inconvenient: a
// product can only be created when its manufacturer is one we already have a
// record for. Anything else would mean inventing a manufacturer, so the answer
// is simply "no product".
//
// What this module never does: infer specifications, prices, release dates, or
// availability. Those are fabrication risks and they are left empty for a human
// to fill from sources. Deterministic; no AI provider.

/** Wording that indicates a product being introduced, rather than discussed. */
const ANNOUNCEMENT_PATTERNS: RegExp[] = [
  /\b(announce[sd]?|unveil(s|ed)?|introduce[sd]?|reveal(s|ed)?)\b/i,
  /\blaunch(es|ed)?\b/i,
  /\bnow available\b/i,
  /\bgoes on sale\b/i,
  /\b(debuts?|arrives?)\b/i,
];

// Wording that means the piece is ABOUT a product rather than announcing a new
// one. A review of a camera we already sell is not a reason to create a second
// product row.
const NOT_AN_ANNOUNCEMENT: RegExp[] = [
  /\breview(ed|s)?\b/i,
  /\bhands[- ]on\b/i,
  /\bvs\.?\b|\bversus\b/i,
  /\bbest\b/i,
  /\bhow to\b/i,
  /\bdeal(s)?\b/i,
  /\bfirmware\b/i,
  /\brumou?r(ed|s)?\b/i,
];

export type ProductSignal = {
  manufacturerSlug: string;
  manufacturerName: string;
  /** The product name with the manufacturer prefix left intact. */
  productName: string;
  matchedOn: string;
  explanation: string;
};

/**
 * Detect a new-product announcement.
 *
 * @param knownManufacturers the manufacturers table — a product is only
 *   detected when its maker is already a record here. Never invented.
 * @returns null whenever anything is uncertain. Null is the safe and common
 *   answer; a wrong positive puts a fabricated product in the catalogue.
 */
export function detectProductAnnouncement(
  title: string,
  summary: string | null,
  knownManufacturers: { slug: string; name: string }[]
): ProductSignal | null {
  const haystack = `${title} ${summary ?? ""}`;

  if (NOT_AN_ANNOUNCEMENT.some((p) => p.test(haystack))) return null;

  const announcement = ANNOUNCEMENT_PATTERNS.map((p) => haystack.match(p)).find(Boolean);
  if (!announcement) return null;

  // The manufacturer must appear in the TITLE. A maker mentioned only in
  // passing in the summary is not evidence that this is their product.
  const lowerTitle = title.toLowerCase();
  const manufacturer = knownManufacturers
    .filter((m) => m.name.length >= 2)
    .filter((m) => new RegExp(`\\b${escapeRegExp(m.name.toLowerCase())}\\b`).test(lowerTitle))
    // Longest name wins, so "ASUS ROG" beats "ASUS" when both are records.
    .sort((a, b) => b.name.length - a.name.length)[0];

  if (!manufacturer) return null;

  const productName = extractProductName(title, manufacturer.name);
  if (!productName) return null;

  return {
    manufacturerSlug: manufacturer.slug,
    manufacturerName: manufacturer.name,
    productName,
    matchedOn: announcement[0],
    explanation: `Title announces ("${announcement[0]}") a product from ${manufacturer.name}, an existing manufacturer record. Created as an UNPUBLISHED draft with no specifications — specs, pricing and availability must be filled in by a human from sources.`,
  };
}

/**
 * Pull the product name out of a headline.
 *
 * Conservative: the name must contain a model-ish token (a digit or an
 * all-caps model code). "Sony announces a new camera" yields nothing, because
 * "a new camera" is not a product name.
 */
function extractProductName(title: string, manufacturerName: string): string | null {
  // Everything up to the announcement verb is the subject; the name follows it.
  const afterVerb = title.replace(
    /^.*?\b(announce[sd]?|unveil(?:s|ed)?|introduce[sd]?|reveal(?:s|ed)?|launch(?:es|ed)?|debuts?|arrives?)\b\s*/i,
    ""
  );
  const candidate = (afterVerb === title ? title : `${manufacturerName} ${afterVerb}`)
    .replace(/[,:;–—].*$/, "")
    .replace(/\b(the|a|an|its|new|latest|first)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (candidate.length < 3 || candidate.length > 120) return null;

  const hasModelToken = /\d/.test(candidate) || /\b[A-Z]{2,}\b/.test(candidate);
  if (!hasModelToken) return null;

  // Must be more than the manufacturer name alone.
  if (candidate.toLowerCase() === manufacturerName.toLowerCase()) return null;

  return candidate;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Map evidence strength to the products.status enum.
 *
 * A product we only have secondhand reports about is 'rumored', not 'active'.
 * The schema already has the honest option, so use it.
 */
export function productStatusFor(claimStatus: string): "active" | "rumored" {
  return claimStatus === "confirmed_primary" ? "active" : "rumored";
}
