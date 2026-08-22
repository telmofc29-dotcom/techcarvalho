// Query expansion that widens the SEARCH without widening the SUBJECT.
//
// TWO FAILURES, PULLING IN OPPOSITE DIRECTIONS
// --------------------------------------------
// Under-expansion is what actually happened here. docs/product-media-strategy.md
// records a Commons probe reporting **zero** freely-licensed files for the DJI
// Mini 4 Pro, GoPro HERO13 and Osmo Action 5 Pro. All three had perfectly good
// CC BY-SA 4.0 photography. One literal search per product missed it because:
//
//   * the files are titled in another language — "GoPro Héro 13 Black", French,
//     accented — and sit under "Category:GoPro Hero 13 black", lowercase;
//   * the DJI descriptions are Polish;
//   * a free-text search for a CAMERA returns photographs TAKEN WITH it rather
//     than OF it. "GoPro HERO13" surfaced 20 Mapillary street photos.
//
// Over-expansion is the failure that costs more. Canon EOS 60D is not "a Canon
// DSLR". RTX 5090 is not "an NVIDIA GPU". PS5 Pro is not PS5, and Nintendo
// Switch 2 is not Nintendo Switch. An expansion that reaches those is not a
// wider net, it is a wrong answer.
//
// THE RESOLUTION
// --------------
// Expansion is allowed to vary SPELLING, LANGUAGE, CASE, PUNCTUATION and
// SEARCH MECHANISM freely. It is never allowed to drop a DISCRIMINATOR — the
// model number or variant word that separates this product from its siblings.
// `expandQueries()` refuses to emit a strict query that has lost one, and
// `assertIdentityPreserved()` is exported so a caller can prove it on any
// query, including one a future provider builds itself.
//
// Broad queries (enumerate a manufacturer's category tree) ARE emitted, marked
// as such. They are how the GoPro category is found at all. They carry no
// identity guarantee, so every candidate they produce must clear entity
// matching on its own — which every candidate must do regardless.
//
// Pure. No network, no provider specifics beyond the query vocabulary.

import type { ProviderQuery, QueryStrategy } from "./types.ts";

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

/**
 * Unicode combining diacritical marks, U+0300-U+036F.
 *
 * Written as escapes rather than literal characters because the literal form
 * is invisible in most editors and one stray normalisation of this source file
 * would silently change what the regex matches — and the whole point of it is
 * that "Héro" and "Hero" reach the same tokens.
 */
const COMBINING_MARKS = new RegExp("[\\u0300-\\u036f]", "g");

/**
 * Fold a string to the form comparisons happen in: lowercase, no diacritics,
 * letters and digits separated into their own tokens.
 *
 * The letter/digit split is what makes "HERO13", "Hero 13" and "Héro 13" the
 * same token stream. Without it the GoPro category is unreachable by any
 * spelling the engine would think to try.
 */
export function identityTokens(input: string): string[] {
  const folded = input
    .normalize("NFD")
    .replace(COMBINING_MARKS, "")
    .toLowerCase();
  const out: string[] = [];
  for (const raw of folded.split(/[^a-z0-9]+/)) {
    if (!raw) continue;
    // Split letter/digit runs: "hero13" -> ["hero", "13"], "rtx5090" -> ["rtx","5090"].
    const parts = raw.match(/[a-z]+|[0-9]+/g) ?? [];
    for (const p of parts) out.push(p);
  }
  return out;
}

/** Words that separate one model from its siblings within a family. */
const VARIANT_DISCRIMINATORS = new Set([
  "pro", "max", "ultra", "plus", "lite", "mini", "air", "se", "slim",
  "ti", "super", "xt", "xtx", "gre", "gt", "x3d", "k", "kf", "ks",
  "mk", "i", "ii", "iii", "iv", "v",
  "black", "silver", "white",
  "edition", "elite", "digital", "disc",
]);

/** Generic words that carry no identity at all and must never count as one. */
const NON_DISCRIMINATING = new Set([
  "the", "a", "an", "and", "with", "for", "new", "camera", "cameras", "drone",
  "drones", "gpu", "graphics", "card", "cpu", "processor", "console", "phone",
  "smartphone", "laptop", "router", "vacuum", "robot", "display", "monitor",
  "series", "generation", "gen", "product", "products", "photo", "photos",
  "photograph", "photographs", "image", "images", "file", "files",
]);

/**
 * The tokens that MUST survive every strict expansion.
 *
 * A model number is always a discriminator. A variant word is a discriminator
 * when the product name carries one. A bare brand token is not — "canon" alone
 * does not identify the EOS 60D — so a query holding only the brand fails.
 */
export function discriminators(canonicalName: string): string[] {
  const toks = identityTokens(canonicalName);
  const out: string[] = [];
  for (const t of toks) {
    if (NON_DISCRIMINATING.has(t)) continue;
    if (/\d/.test(t)) out.push(t);
    else if (VARIANT_DISCRIMINATORS.has(t)) out.push(t);
  }

  // Letters glued to digits in the ORIGINAL string are part of the model
  // number, not stray words: the "XE" in "Deco XE75", the "X3D" in "9800X3D",
  // the "K" in "285K". identityTokens() has already split them apart, so
  // without this pass "Deco XE75" would require only "75" and a hypothetical
  // "Deco BE75" would satisfy it. Re-scan the raw name for mixed
  // letter-and-digit runs and treat every piece of them as discriminating.
  const folded = canonicalName.normalize("NFD").replace(COMBINING_MARKS, "").toLowerCase();
  for (const run of folded.split(/[^a-z0-9]+/)) {
    if (!run || !/[a-z]/.test(run) || !/\d/.test(run)) continue;
    for (const piece of run.match(/[a-z]+|[0-9]+/g) ?? []) {
      if (!NON_DISCRIMINATING.has(piece)) out.push(piece);
    }
  }

  return [...new Set(out)];
}

export type SubjectIdentity = {
  /** The catalogue's own name, e.g. "Canon EOS 60D". */
  canonicalName: string;
  manufacturer: string | null;
  /**
   * Other names the SAME product is genuinely known by, e.g.
   * "GoPro HERO13 Black" / "GoPro Hero 13 Black". Never a sibling model.
   */
  aliases: string[];
  /** Product family, used only for BROAD queries. e.g. "GoPro HERO". */
  family: string | null;
};

// ---------------------------------------------------------------------------
// Identity preservation
// ---------------------------------------------------------------------------

export type IdentityCheck = { preserved: true } | { preserved: false; missing: string[]; reason: string };

/**
 * Does this query string still name THIS product?
 *
 * Fails closed: a query with no discriminators to check is rejected rather
 * than waved through, because "no discriminators" describes a product name we
 * failed to parse, not a product with no identity.
 */
export function assertIdentityPreserved(queryValue: string, identity: SubjectIdentity): IdentityCheck {
  const required = discriminators(identity.canonicalName);
  if (required.length === 0) {
    return {
      preserved: false,
      missing: [],
      reason:
        `No discriminating token could be derived from "${identity.canonicalName}". ` +
        `A name that reduces to brand and category words cannot be searched for strictly — ` +
        `every result would be "some product by this manufacturer".`,
    };
  }
  const present = new Set(identityTokens(queryValue));
  const missing = required.filter((t) => !present.has(t));
  if (missing.length > 0) {
    return {
      preserved: false,
      missing,
      reason:
        `Query "${queryValue}" drops discriminator(s) ${missing.join(", ")} from ` +
        `"${identity.canonicalName}". Searching without them returns a different product.`,
    };
  }
  return { preserved: true };
}

// ---------------------------------------------------------------------------
// Spelling variants
// ---------------------------------------------------------------------------

/**
 * Surface forms of one name that mean the same product.
 *
 * Only orthography changes here — spacing between a letter run and a digit
 * run, hyphenation, case. Nothing is added or removed, so every variant
 * necessarily preserves identity; the caller checks anyway.
 */
export function spellingVariants(name: string): string[] {
  const base = name.trim().replace(/\s+/g, " ");
  const variants = new Set<string>([base]);

  // "HERO13" <-> "HERO 13"; "RTX5090" <-> "RTX 5090".
  variants.add(base.replace(/([A-Za-z])(\d)/g, "$1 $2"));
  variants.add(base.replace(/([A-Za-z]) (\d)/g, "$1$2"));
  // "Hero-13" form.
  variants.add(base.replace(/([A-Za-z]) (\d)/g, "$1-$2"));
  // Diacritic-folded form, so an accented catalogue name still reaches ASCII files.
  variants.add(base.normalize("NFD").replace(COMBINING_MARKS, ""));
  // Title case, for sources whose titles are sentence-cased.
  variants.add(
    base
      .toLowerCase()
      .replace(/\b([a-z])/g, (m) => m.toUpperCase())
  );

  return [...variants].filter((v) => v.length > 0);
}

// ---------------------------------------------------------------------------
// Expansion
// ---------------------------------------------------------------------------

export type ExpansionPlan = {
  /** Queries that name this exact product. Candidates still need entity matching. */
  strict: ProviderQuery[];
  /**
   * Queries that deliberately reach wider than the product — a manufacturer's
   * category tree — because that is how a differently-spelled or
   * differently-languaged category is discovered at all. They carry NO
   * identity guarantee and are marked accordingly.
   */
  broad: ProviderQuery[];
  /** Expansions that were generated and then refused, with the reason. */
  rejected: { value: string; strategy: QueryStrategy; reason: string }[];
};

/**
 * Build the query plan for one subject.
 *
 * Ordered by the method that actually works. Category enumeration first —
 * every one of the fourteen Commons successes in docs/product-media-strategy.md
 * came from a category listing and not one would have been found by name
 * search alone. Free text is last and is the least trusted.
 */
export function expandQueries(identity: SubjectIdentity): ExpansionPlan {
  const strict: ProviderQuery[] = [];
  const broad: ProviderQuery[] = [];
  const rejected: ExpansionPlan["rejected"] = [];
  const seen = new Set<string>();

  const required = discriminators(identity.canonicalName);

  const pushStrict = (strategy: QueryStrategy, value: string, rationale: string) => {
    const key = `${strategy}::${value.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    const check = assertIdentityPreserved(value, identity);
    if (!check.preserved) {
      rejected.push({ value, strategy, reason: check.reason });
      return;
    }
    strict.push({ strategy, value, rationale, identityTokens: required });
  };

  const pushBroad = (strategy: QueryStrategy, value: string, rationale: string) => {
    const key = `${strategy}::${value.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    broad.push({ strategy, value, rationale, identityTokens: [] });
  };

  const names = [identity.canonicalName, ...identity.aliases];

  // --- 1. Category lookup for the product itself, in every spelling ---------
  for (const name of names) {
    for (const variant of spellingVariants(name)) {
      pushStrict(
        "category_lookup",
        variant,
        "Locate a dedicated category for this exact product. Category membership is human-curated and language-independent, unlike a title.",
      );
    }
  }

  // --- 2. Manufacturer / family category tree (BROAD, deliberately) --------
  // This is the step that reaches "Category:GoPro Hero 13 black" — a lowercase,
  // differently-spelled category no product-name query would guess.
  if (identity.manufacturer) {
    pushBroad(
      "category_lookup",
      identity.manufacturer,
      `Enumerate ${identity.manufacturer}'s category tree and match SUBCATEGORY TITLES against this product's tokens. ` +
        "Finds categories whose spelling, case or language the engine could not have guessed. " +
        "Carries no identity guarantee — every file found this way is entity-matched individually.",
    );
  }
  if (identity.family) {
    pushBroad(
      "category_lookup",
      identity.family,
      `Enumerate the ${identity.family} family tree for the same reason. Broad by design.`,
    );
  }

  // --- 3. Title-restricted search ------------------------------------------
  for (const name of names) {
    for (const variant of spellingVariants(name)) {
      pushStrict(
        "intitle_search",
        variant,
        "Title-restricted search. Much less prone than free text to returning images captured BY the device rather than OF it, because a filename naming the product usually depicts it.",
      );
    }
  }

  // --- 4. Body/description search ------------------------------------------
  // Catches files whose TITLE is in another language but whose description
  // names the model — the Polish DJI descriptions.
  for (const name of names) {
    pushStrict(
      "insource_search",
      name,
      "Search file descriptions rather than titles, for files described in another language or titled opaquely.",
    );
  }

  // --- 5. Free text, last and least trusted --------------------------------
  for (const name of names) {
    pushStrict(
      "text_search",
      name,
      "Unrestricted search. Ranked last: on Commons this reliably surfaces photographs TAKEN WITH a camera instead of photographs OF it.",
    );
  }

  // --- Refusals worth recording explicitly ---------------------------------
  // Generated, then rejected, so the log shows the engine considered and
  // declined the shortcut rather than never thinking of it.
  if (identity.manufacturer) {
    const bare = identity.manufacturer;
    const check = assertIdentityPreserved(bare, identity);
    if (!check.preserved) {
      rejected.push({
        value: bare,
        strategy: "text_search",
        reason:
          check.reason +
          " Manufacturer-only text search is only ever used as a BROAD category lookup, never as a source of accepted candidates.",
      });
    }
  }
  if (identity.family) {
    const check = assertIdentityPreserved(identity.family, identity);
    if (!check.preserved) {
      rejected.push({
        value: identity.family,
        strategy: "text_search",
        reason: check.reason + " A family name matches every sibling generation.",
      });
    }
  }

  return { strict, broad, rejected };
}

// ---------------------------------------------------------------------------
// Category title matching — the trap-avoidance layer
// ---------------------------------------------------------------------------

/**
 * Category name patterns that describe the CAPTURING DEVICE, not the subject.
 *
 * Commons maintains a whole parallel tree for this, and DJI's is worse: the
 * categories are named by opaque EXIF model codes ("Category:DJI FC8482")
 * which look exactly like product categories and are not. A file in one of
 * these depicts whatever the photographer pointed the camera at.
 */
const TAKEN_WITH_PATTERNS = [
  /\btaken\s+with\b/i,
  /\bphotographs?\s+(taken|made)\s+(with|by)\b/i,
  /\bshot\s+(on|with)\b/i,
  /\bimages?\s+by\b/i,
  /\bscanned\s+with\b/i,
];

/** Opaque internal model codes that are camera-identity, not product-identity. */
const EXIF_MODEL_CODE = /^[A-Z]{2,4}\d{3,6}$/;

/**
 * Does this free text say the image was CAPTURED WITH something?
 *
 * Commons file titles say it outright — "…taken with GoPro HERO13 Black.jpg",
 * of which a single street-mapping run contributed 32 in one search here. The
 * title contains every discriminator of the product, so token matching alone
 * scores them well; only reading the phrase gets them right.
 */
export function describesCaptureByDevice(text: string | null | undefined): boolean {
  if (!text) return false;
  return TAKEN_WITH_PATTERNS.some((p) => p.test(text));
}

export function isCapturingDeviceCategory(title: string): boolean {
  const bare = title.replace(/^Category:/i, "").trim();
  if (TAKEN_WITH_PATTERNS.some((p) => p.test(bare))) return true;
  // "DJI FC8482" — brand plus an opaque code, and nothing else.
  const parts = bare.split(/\s+/);
  if (parts.length === 2 && EXIF_MODEL_CODE.test(parts[1])) return true;
  return false;
}

export type CategoryMatch = {
  accepted: boolean;
  /** 0-1. How well the category title names this product. */
  score: number;
  reason: string;
};

/**
 * Whether a category title denotes THIS product.
 *
 * Requires every discriminator to be present in the title, then rewards
 * additional overlap. A category that has all the model tokens plus extra
 * words ("GoPro Hero 13 black") is a match; one missing a model token
 * ("GoPro Hero") is not, however similar it looks.
 */
export function matchCategoryTitle(title: string, identity: SubjectIdentity): CategoryMatch {
  const bare = title.replace(/^Category:/i, "").trim();

  if (isCapturingDeviceCategory(bare)) {
    return {
      accepted: false,
      score: 0,
      reason:
        `"${bare}" is a capturing-device category: it collects images TAKEN WITH the device, not images OF it. ` +
        "Enumerating it would return whatever the photographers pointed at.",
    };
  }

  const required = discriminators(identity.canonicalName);
  if (required.length === 0) {
    return { accepted: false, score: 0, reason: `No discriminator derivable from "${identity.canonicalName}"; cannot match a category safely.` };
  }

  const titleToks = new Set(identityTokens(bare));
  const missing = required.filter((t) => !titleToks.has(t));
  if (missing.length > 0) {
    return {
      accepted: false,
      score: 0,
      reason:
        `"${bare}" is missing discriminator(s) ${missing.join(", ")}. ` +
        "A category one generation off is a wrong-product category, not a near miss.",
    };
  }

  // Every discriminator present. Score by how much of the product name the
  // title accounts for, so a tightly-named category outranks a sprawling one.
  const nameToks = identityTokens(identity.canonicalName).filter((t) => !NON_DISCRIMINATING.has(t));
  let shared = 0;
  for (const t of new Set(nameToks)) if (titleToks.has(t)) shared++;
  const coverage = nameToks.length > 0 ? shared / new Set(nameToks).size : 0;

  // Penalise a title carrying discriminating tokens the product does NOT have:
  // "Category:GoPro Hero 13 Mini" would be a different product.
  const productToks = new Set(identityTokens(identity.canonicalName));
  const brandToks = new Set(identityTokens(identity.manufacturer ?? ""));
  const foreignDiscriminators = [...titleToks].filter(
    (t) =>
      !productToks.has(t) &&
      !brandToks.has(t) &&
      !NON_DISCRIMINATING.has(t) &&
      (/\d/.test(t) || VARIANT_DISCRIMINATORS.has(t))
  );
  if (foreignDiscriminators.length > 0) {
    return {
      accepted: false,
      score: 0,
      reason:
        `"${bare}" carries discriminating token(s) ${foreignDiscriminators.join(", ")} that this product does not have. ` +
        "Ambiguous between models, so it fails closed.",
    };
  }

  return {
    accepted: true,
    score: Math.min(1, 0.6 + coverage * 0.4),
    reason: `"${bare}" contains every discriminator (${required.join(", ")}) and no foreign model token.`,
  };
}
