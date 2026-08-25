// IS THIS SUBJECT A PRODUCT, OR A TOPIC?
//
// THE BUG THIS FIXES
// ------------------
// `decide()` granted product eligibility on evidence strength alone: enough
// independent origins, not an unreleased product, therefore a catalogue entry
// is justified. Run against real feeds it reported "product eligible: YES" for
// the subject **filament** — a material category, not a product. The same logic
// would have offered a product page for "3D printing", "Wi-Fi 7" or "PLA".
//
// Evidence strength answers "may we write about this?". It cannot answer "is
// this a thing that exists as one purchasable item?", and conflating the two is
// how a catalogue fills up with entries for categories.
//
// WHAT A PRODUCT NEEDS
// --------------------
// A catalogue row asserts that a specific, identifiable object exists. So the
// SUBJECT must name one, which in practice means two things together:
//
//   1. A MAKER. "X1 Carbon" alone is ambiguous; "Bambu Lab X1 Carbon" is not.
//   2. A DESIGNATION. A model token that distinguishes this unit from its
//      siblings — "X1", "9950X", "24-70mm", "RF". A brand plus a category noun
//      ("Canon lenses") is a topic however well sourced.
//
// Both, not either. "Canon" is a maker with no designation; "24-70mm" is a
// designation with no maker and could be any manufacturer's.
//
// WHY A WORD LIST OF CATEGORIES, AND WHY IT IS NOT THE MAIN TEST
// --------------------------------------------------------------
// CATEGORY_NOUNS catches the obvious cases early — "filament", "printers",
// "guide" — but it is a shortcut, not the rule. The rule is maker + designation,
// which is what makes an unlisted category like "sintering powder" fail too.
// A word list alone would need to anticipate every category noun in technology,
// which is not a list anyone can finish.
//
// PURE. No `server-only`, no Supabase, no network.

/** Nouns that describe a class of things rather than one thing. */
const CATEGORY_NOUNS = new Set([
  "filament", "resin", "printer", "printers", "printing", "material", "materials",
  "lens", "lenses", "camera", "cameras", "body", "bodies", "sensor", "sensors",
  "cpu", "cpus", "gpu", "gpus", "ssd", "ssds", "nvme", "ram", "memory", "storage",
  "motherboard", "motherboards", "router", "routers", "mesh", "ethernet", "wifi",
  "console", "consoles", "controller", "controllers", "headset", "headsets",
  "phone", "phones", "smartphone", "smartphones", "tablet", "drone", "drones",
  "robot", "robots", "monitor", "monitors", "keyboard", "mouse", "psu",
  "cooling", "cooler", "slicer", "slicers", "firmware", "software", "update",
  "guide", "guides", "explained", "comparison", "tips", "basics", "settings",
  "troubleshooting", "requirements", "standard", "standards", "generation",
  "technology", "hardware", "gaming", "photography", "astrophotography",
]);

/** Words that never distinguish one unit from another. */
const NON_DESIGNATION = new Set([
  "pro", "max", "plus", "ultra", "mini", "air", "lite", "se", "gen", "mark",
  "series", "edition", "new", "the", "and", "for", "with", "vs",
]);

export type ProductIdentity = {
  /** True when the subject names one identifiable product. */
  isIdentifiableProduct: boolean;
  /** The maker, when one was recognised. */
  maker: string | null;
  /** Tokens that look like a model designation. */
  designation: string[];
  /** Ordered, human-readable. First entry is the primary reason. */
  reasons: string[];
};

/**
 * A designation distinguishes one unit from its siblings.
 *
 * Requires a digit AND something more than a bare digit: "4" is a series
 * position shared by a DJI drone and an Elegoo printer, whereas "x1", "9950x"
 * and "24-70mm" identify. This is the same rule the media matcher uses to
 * refuse false SKU matches, and it is deliberately the same rule — a token too
 * weak to caption an image is too weak to mint a catalogue row.
 */
export function looksLikeDesignation(token: string): boolean {
  const t = token.toLowerCase();
  if (NON_DESIGNATION.has(t)) return false;
  if (!/\d/.test(t)) return false;
  if (/^\d$/.test(t)) return false;
  // A bare year is a date, not a model.
  if (/^(19|20)\d{2}$/.test(t)) return false;
  return t.length >= 2;
}

/**
 * Decide whether a subject names a product.
 *
 * `knownMakers` comes from the manufacturers table, so recognition is grounded
 * in what TechCarvalho actually has rather than in a guess about brand names.
 */
export function assessProductIdentity(
  subject: string,
  knownMakers: readonly string[] = []
): ProductIdentity {
  const reasons: string[] = [];
  const cleaned = subject.replace(/[^\w\s./-]/g, " ").replace(/\s+/g, " ").trim();
  const tokens = cleaned.split(" ").filter(Boolean);
  const lower = tokens.map((t) => t.toLowerCase());

  const maker =
    knownMakers.find((m) => {
      const parts = m.toLowerCase().split(/\s+/);
      return parts.every((p) => lower.includes(p));
    }) ?? null;

  const designation = tokens.filter((t) => looksLikeDesignation(t));

  // ---- the early-out for obvious topics ---------------------------------
  const categoryHits = lower.filter((t) => CATEGORY_NOUNS.has(t));
  if (designation.length === 0 && categoryHits.length > 0) {
    reasons.push(
      `"${subject}" names a category (${categoryHits.join(", ")}) with no model designation, so it describes a class of things rather than one product.`
    );
    return { isIdentifiableProduct: false, maker, designation, reasons };
  }

  // ---- the actual rule ---------------------------------------------------
  if (!maker) {
    reasons.push(
      designation.length > 0
        ? `A designation is present (${designation.join(", ")}) but no known manufacturer, so it cannot be attributed to one maker's product.`
        : `Neither a known manufacturer nor a model designation appears in "${subject}".`
    );
    return { isIdentifiableProduct: false, maker, designation, reasons };
  }

  if (designation.length === 0) {
    reasons.push(
      `"${maker}" is a manufacturer, but nothing in "${subject}" designates a specific model, so this is coverage of the maker rather than of one product.`
    );
    return { isIdentifiableProduct: false, maker, designation, reasons };
  }

  reasons.push(
    `Names one identifiable product: manufacturer "${maker}" plus designation ${designation.join(", ")}.`
  );
  return { isIdentifiableProduct: true, maker, designation, reasons };
}

/**
 * The full product gate: identity AND evidence.
 *
 * Kept separate from `assessProductIdentity` so the two questions stay
 * separate. Identity is about the subject; sufficiency is about the sourcing.
 * A page needs both, and the reason it fails should say which one was missing.
 */
export function isProductEligible(input: {
  subject: string;
  knownMakers?: readonly string[];
  independentOrigins: number;
  framing: "confirmed" | "reported" | "rumoured" | "insufficient";
  aboutUnreleasedProduct: boolean;
}): { eligible: boolean; reasons: string[] } {
  const identity = assessProductIdentity(input.subject, input.knownMakers ?? []);
  const reasons = [...identity.reasons];

  if (!identity.isIdentifiableProduct) {
    reasons.push("No catalogue entry: a product page asserts that one specific object exists.");
    return { eligible: false, reasons };
  }

  if (input.aboutUnreleasedProduct) {
    reasons.push(
      "No catalogue entry: the maker has not confirmed this exists, and a product page asserts that it does."
    );
    return { eligible: false, reasons };
  }

  // Deliberately stricter than the article bar, and stated as such.
  if (input.framing === "confirmed") {
    reasons.push("Confirmed by the maker, which is what a catalogue entry needs.");
    return { eligible: true, reasons };
  }
  if (input.framing === "reported" && input.independentOrigins >= 3) {
    reasons.push(
      `${input.independentOrigins} independent origins on an identifiable, released product.`
    );
    return { eligible: true, reasons };
  }

  reasons.push(
    `No catalogue entry: identity is established but the evidence is not (framing "${input.framing}", ` +
      `${input.independentOrigins} independent origin(s)). Product creation stays stricter than article creation.`
  );
  return { eligible: false, reasons };
}
