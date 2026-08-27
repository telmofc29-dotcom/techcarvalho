// ONE DEFINITION OF WHAT MAKES TWO PRODUCT NAMES THE SAME MODEL.
//
// WHY THIS FILE EXISTS
// --------------------
// Four modules independently decided which words distinguish one product from
// its sibling, and they disagreed:
//
//   subject-match.ts             VARIANT_WORDS          roman numerals + mark/mk
//   match-engine.ts              VARIANT_TOKENS         + pro/max/plus/ultra/mini
//   engine/model-identity.ts     TIER_WORDS             a third, shorter list
//   providers/query-expansion.ts VARIANT_DISCRIMINATORS a fourth, longer one
//
// The cost of that was measured, not theorised. A plain "Canon EOS R5"
// photograph shipped as the hero for an "EOS R5 Mark II" article while the
// suite showed the protection green — because the passing test exercised the
// ACQUISITION matcher and the defect was in the LIBRARY matcher. Two matchers
// doing the same job, one tested. The same divergence then produced a second
// live defect: "Mac Studio review" carries no digit, so the library matcher
// classified it as not-model-specific and offered a Mac mini photograph for
// its lead slot — a variant conflict it had itself detected and then ignored.
//
// So the vocabulary lives here once and every consumer imports it. A word that
// pins a model is a word that pins a model, whether the question being asked is
// "does this photograph show that camera", "can this product be found by this
// search query", or "does the existing article already cover this development".
//
// WHAT A DESIGNATION IS
// ---------------------
// The part of a product name that would make a reader say "that is a different
// product": the model number (R5, 5090, H2D, 9950X) and the words manufacturers
// use to separate tiers and revisions (Mark II, Pro, Ultra, Mini, Ti).
// "Canon" is not one — every Canon shares it. Neither is "camera".
//
// Pure. No I/O, and no dependency on any other module in this codebase, because
// everything else depends on it.

// ---------------------------------------------------------------------------
// The vocabulary
// ---------------------------------------------------------------------------

/**
 * Revision markers. Roman numerals are the dangerous case: they are short
 * enough to be destroyed by a minimum-length filter, and they are the entire
 * difference between a Mark II and a Mark III.
 */
export const REVISION_WORDS: ReadonlySet<string> = new Set([
  "ii", "iii", "iv", "v", "vi", "vii", "viii", "ix", "x",
  "mark", "mk",
]);

// "gen" AND "rev" ARE NOT ON THAT LIST, AND THE REASON IS MEASURED.
//
// They were, briefly. Running the matcher across every category against real
// production data produced this:
//
//   ARTICLE "SK Hynix Next-Gen HBM Memory to Use Intel EMIB-T"
//   IMAGE   hero-next-gen-console-rumor-tracker-ps6-xbox.png
//   specificity: EXACT_MODEL — "Names the exact model: gen"
//
// A console rumour graphic declared an exact-model match for a memory story,
// because both titles contain "next-gen". "Mark" earns its place: it appears in
// product names and almost nowhere else. "Gen" is ordinary English in this
// subject area and appears in half the headlines on the site.
//
// Nothing is lost where it matters. A generation glued to its number — "gen4",
// "rev2" — survives as a whole alphanumeric run and is still a designation. It
// is only the bare word that is noise.

/**
 * Tier and format suffixes — how a manufacturer separates products that share a
 * name. Treating these as noise is what let "iPhone 18 Pro" be answered by
 * "iPhone 18", and "Mac Studio" by "Mac mini".
 *
 * "studio" is here because of that second case specifically: it carries no
 * digit, so every digit-based heuristic read "Mac Studio" as naming no model at
 * all.
 */
export const TIER_WORDS: ReadonlySet<string> = new Set([
  "pro", "max", "plus", "ultra", "mini", "air", "lite", "se", "xl",
  "slim", "elite", "studio", "fold", "flip",
]);

/**
 * Component-industry suffixes. These attach to a model number rather than
 * replacing it ("5070 Ti", "9800X3D", "285K"), and a tokeniser that splits
 * letter/digit runs surfaces them on their own.
 */
export const COMPONENT_SUFFIX_WORDS: ReadonlySet<string> = new Set([
  "ti", "super", "xt", "xtx", "gre", "gt", "x3d", "kf", "ks",
]);

/**
 * Every word that pins a model.
 *
 * DELIBERATELY EXCLUDED: colourways ("black", "silver", "white") and packaging
 * words ("edition", "kit", "body"). A GoPro HERO13 Black and a HERO13 are the
 * same camera in different trim; refusing a photograph of one for an article
 * about the other would be a false refusal, and false refusals are how a
 * protection gets switched off. Also excluded: bare single letters other than
 * the roman numerals, because "k" and "i" appear inside ordinary text often
 * enough that treating them as identity is a liability.
 */
export const DESIGNATION_WORDS: ReadonlySet<string> = new Set([
  ...REVISION_WORDS,
  ...TIER_WORDS,
  ...COMPONENT_SUFFIX_WORDS,
]);

// ---------------------------------------------------------------------------
// Designations in a name
// ---------------------------------------------------------------------------

/**
 * A four-digit token in the calendar range is a YEAR, not a model number.
 *
 * "Best Canon cameras 2026" would otherwise read as naming a specific model,
 * which would make every roundup model-specific and refuse the whole library
 * for it. Found by working through what the conflict rule below would do to a
 * listicle, before shipping it.
 */
function isYear(token: string): boolean {
  return /^(19|20)\d{2}$/.test(token);
}

/**
 * A bare single digit is a series designator, not a designation.
 *
 * "DJI Mini 4 Pro" and "Neptune 4 Pro" both carry "4". Treating that as
 * identity put a drone photograph on a 3D-printer page.
 */
function isDistinctiveNumber(token: string): boolean {
  return !isYear(token) && (token.length >= 2 || /[a-z]/.test(token));
}

/**
 * The designations a name carries.
 *
 * THE GLUED-VERSUS-SPACED PROBLEM IS REAL IN THIS LIBRARY, not hypothetical.
 * The catalogue holds "NVIDIA GeForce RTX 5090" and "GoPro HERO13 Black", and
 * the files illustrating them are named `cmp-rtx5090-vs-5080.png`,
 * `cmp-hero13-vs-action5pro.png`, `cmp-iphone17pro-s26ultra-pixel10pro.png`.
 * The same product is spelled both ways depending on who typed it.
 *
 * So a run mixing letters and digits emits the whole run AND the parts of it
 * that carry identity: distinctive numbers, and letter pieces that are
 * designation words. "iphone17pro" yields {iphone17pro, 17, pro}, which is a
 * superset of what "iPhone 17 Pro" yields {17, pro} — so the spaced form is
 * satisfied by the glued one, in the direction that matters.
 *
 * A letter piece that is NOT a designation word is deliberately dropped:
 * `canon5d0195.jpg` would otherwise contribute "canon" as if it were a model
 * designation, and every Canon shares that.
 */
export function designationTokens(name: string): Set<string> {
  const out = new Set<string>();
  const folded = name
    .normalize("NFD")
    .replace(new RegExp("[\\u0300-\\u036f]", "g"), "")
    .toLowerCase();

  for (const run of folded.split(/[^a-z0-9]+/)) {
    if (!run) continue;
    const hasDigit = /\d/.test(run);
    const hasAlpha = /[a-z]/.test(run);

    if (!hasDigit) {
      if (DESIGNATION_WORDS.has(run)) out.add(run);
      continue;
    }

    if (isDistinctiveNumber(run)) out.add(run);
    if (!hasAlpha) continue;

    const pieces = run.match(/[a-z]+|[0-9]+/g) ?? [];
    for (const piece of pieces) {
      if (/\d/.test(piece)) {
        if (isDistinctiveNumber(piece)) out.add(piece);
      } else if (DESIGNATION_WORDS.has(piece)) {
        out.add(piece);
      }
    }

    // Cumulative prefixes, so a model number glued to a tier word still yields
    // the model number on its own: "s26ultra" yields "s26", which is how the
    // catalogue spells the Galaxy S26. Without this, the one file in the
    // library depicting that phone could not satisfy its own product page.
    //
    // This only ever ADDS spellings to a name that already writes them glued.
    // Every catalogue name whose runs are two pieces long ("5d", "hero13",
    // "9950x") produces exactly what it produced before, so no target acquires
    // a new requirement.
    if (pieces.length > 2) {
      let acc = "";
      for (const piece of pieces.slice(0, -1)) {
        acc += piece;
        if (/\d/.test(acc) && isDistinctiveNumber(acc)) out.add(acc);
      }
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// The comparison
// ---------------------------------------------------------------------------

export type DesignationComparison = {
  /** True when each side names a designation the other demonstrably lacks. */
  conflict: boolean;
  /** True when neither side names any designation at all. */
  neitherNames: boolean;
  /** Designations in the subject and not in the other. */
  onlyInSubject: string[];
  /** Designations in the other and not in the subject. */
  onlyInOther: string[];
  reason: string;
};

/**
 * Do these two names refer to the same model?
 *
 * A VETO, NOT A SCORE. It can say "these are demonstrably different products"
 * and it can say "identity cannot decide this". It never says "these are
 * similar", because that is a different question with a different answer, and
 * conflating the two is what made word overlap decide coverage.
 *
 * ASYMMETRY IS DELIBERATE. `onlyInOther` — the other name claims a designation
 * the subject lacks — is the dangerous direction for media: an article about
 * the "R5 Mark II" illustrated by a picture that only says "R5" presents an
 * older camera as the new one. `onlyInSubject` matters too but is weaker: a
 * photograph of one specific camera leading a Canon roundup is ordinary
 * editorial practice, not a false claim. Callers that care read the two lists;
 * callers that do not read `conflict`.
 */
export function compareDesignations(subject: string, other: string): DesignationComparison {
  const a = designationTokens(subject);
  const b = designationTokens(other);

  if (a.size === 0 && b.size === 0) {
    return {
      conflict: false,
      neitherNames: true,
      onlyInSubject: [],
      onlyInOther: [],
      reason: "Neither name carries a model designation, so identity cannot decide this.",
    };
  }

  const onlyInSubject = [...a].filter((t) => !b.has(t));
  const onlyInOther = [...b].filter((t) => !a.has(t));

  if (onlyInSubject.length === 0 && onlyInOther.length === 0) {
    return {
      conflict: false,
      neitherNames: false,
      onlyInSubject: [],
      onlyInOther: [],
      reason: "Both names carry the same model designation.",
    };
  }

  const differing = [...new Set([...onlyInSubject, ...onlyInOther])];
  return {
    conflict: true,
    neitherNames: false,
    onlyInSubject,
    onlyInOther,
    reason:
      `They differ by ${differing.join(", ")}, so they name different models. ` +
      "One is not the other.",
  };
}

/** Convenience: true when the two names are not demonstrably different models. */
export function sameModel(subject: string, other: string): boolean {
  return !compareDesignations(subject, other).conflict;
}

/**
 * Does this name pin one specific model?
 *
 * Replaces the digit heuristic (`/\d/.test(title)`) that classified "Mac Studio
 * review" as naming no model — and therefore let a Mac mini photograph be
 * offered as its lead image.
 */
export function namesSpecificModel(name: string): boolean {
  return designationTokens(name).size > 0;
}
