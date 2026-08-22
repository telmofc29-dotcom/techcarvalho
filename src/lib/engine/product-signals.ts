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

// Things a manufacturer announces that are NOT catalogue products.
//
// The relevance engine already rejects most corporate noise, but it is a
// different question answered for a different purpose: "would a consumer-tech
// reader care?" is not "is this a physical product we can put a spec sheet and
// a photograph on?". An AI model, a research platform or a cloud service can
// legitimately pass relevance and still be nonsense as a product row.
//
// Found by running against real production discoveries: "NVIDIA Alpamayo 2
// Super, the Frontier Open Model for Robotaxis" scored 6 (relevant) and would
// have created a product called "NVIDIA Alpamayo 2 Super". It is an AI model.
const NOT_A_PRODUCT: RegExp[] = [
  // Software, models and platforms
  /\b(open |frontier |foundation |language |diffusion )?model\b/i,
  /\bframework\b/i,
  /\b(sdk|api|toolkit|runtime|driver)s?\b/i,
  /\bplatform\b/i,
  /\bapp(lication)?s?\b/i,
  /\bservice\b/i,
  /\bcloud\b/i,
  /\bsubscription\b/i,
  // Corporate and financial
  /\bstock\b|\boffering\b|\bshares?\b|\bearnings\b|\brevenue\b/i,
  /\bacquisition\b|\bacquires?\b|\bmerger\b/i,
  /\b(partners(hip)?|collaborat(e|es|ion))\b/i,
  /\binvest(able|ment|ors?)\b|\basset class\b/i,
  // Programmes, research and industry
  /\bprogram(me)?\b/i,
  /\binitiative\b/i,
  /\bresearch\b/i,
  /\bcareers?\b|\bhiring\b/i,
  /\bsemiconductor (packaging|manufacturing|fabrication)\b/i,
  /\bfoundry\b|\bfab\b/i,
  /\bdata\s?cent(re|er)\b/i,
  /\benterprise\b/i,
  // Vehicles and non-consumer-electronics categories
  /\brobotaxis?\b|\bautonomous vehicle\b/i,
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
  // Checked against the TITLE only. A summary that merely mentions the cloud
  // or a partnership should not veto a genuine hardware launch, but a title
  // that leads with one is not announcing a catalogue product.
  if (NOT_A_PRODUCT.some((p) => p.test(title))) return null;

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
