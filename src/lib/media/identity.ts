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
// ---------------------------------------------------------------------------
// Contextual numbers
// ---------------------------------------------------------------------------

/**
 * A bare number that identifies something ONLY because of the word in front of
 * it.
 *
 * THE PROBLEM THIS SOLVES
 * -----------------------
 * A lone digit is deliberately not a designation. That rule is load-bearing:
 * "DJI Mini 4 Pro" and "Neptune 4 Pro" both carry "4", and treating that as
 * identity once put a drone photograph on a 3D-printer page.
 *
 * But it also meant the site could not tell these apart:
 *
 *     Wi-Fi 6   Wi-Fi 6E   Wi-Fi 7   Wi-Fi 8
 *     USB 3     USB 4
 *     PCIe 4    PCIe 5     PCIe 6
 *     PlayStation 4        PlayStation 5
 *
 * In every one of those the number IS the identity — because it belongs to a
 * named thing. "7" means nothing; "Wi-Fi 7" means one specific standard.
 *
 * THE RULE
 * --------
 * A number identifies when it is attached to a naming word, and the word
 * travels with it as a single token:
 *
 *     "Wi-Fi 7"        -> wifi#7
 *     "Wi-Fi 8"        -> wifi#8          same context, different number
 *                                          -> different standards
 *     "DJI Mini 4 Pro" -> mini#4
 *     "Neptune 4 Pro"  -> neptune#4       DIFFERENT context -> the shared "4"
 *                                          creates no identity at all
 *
 * A shared number alone can therefore never link two products, which is the
 * property that must not be lost while fixing the standards.
 *
 * Hyphens are stripped from the context so "wi-fi" and "wifi" are one word: a
 * filename and a headline almost never spell it the same way.
 */
function contextOf(token: string): string {
  return token.replace(/-/g, "");
}

/**
 * Emit `context#number` for every bare number that follows a naming word.
 *
 * Only NON-distinctive numbers get this treatment. A number that already
 * identifies on its own ("5090", "60d") is a designation already and does not
 * need a chaperone.
 *
 * A designation word is never a context: "Mark 2" is a revision, and revisions
 * are handled by REVISION_WORDS. Treating "mark" as a naming context would make
 * "Mark 2" and "Mark 3" differ twice over, which changes nothing, and would let
 * "Pro 4" and "Pro 5" of two unrelated products appear comparable, which is the
 * exact failure this design avoids.
 */
function addContextualNumbers(pieces: readonly string[], out: Set<string>): void {
  // The caller guarantees the name carries no real model number.
  for (let i = 1; i < pieces.length; i++) {
    const num = pieces[i];
    if (!/^\d+$/.test(num)) continue;
    if (isYear(num)) continue;
    if (isDistinctiveNumber(num)) continue;
    const prev = contextOf(pieces[i - 1]);
    if (!/^[a-z]+$/.test(prev)) continue;
    if (prev.length < 2) continue;
    if (DESIGNATION_WORDS.has(prev)) continue;
    out.add(`${prev}#${num}`);
  }
}

export function designationTokens(name: string): Set<string> {
  const out = new Set<string>();
  const folded = name
    .normalize("NFD")
    .replace(new RegExp("[\\u0300-\\u036f]", "g"), "")
    .toLowerCase();

  // The flat sequence of alphabetic and numeric pieces, IN ORDER, so a number
  // can see the word in front of it. Hyphenated words stay whole here ("wi-fi"),
  // because that word is the context and contextOf() flattens it.
  const sequence: string[] = [];
  for (const run of folded.split(/[^a-z0-9-]+/)) {
    const trimmed = run.replace(/^-+|-+$/g, "");
    if (!trimmed) continue;
    // A run of letters and hyphens is ONE word: "wi-fi". Keeping it whole is the
    // entire reason hyphens survive the split.
    if (/^[a-z-]+$/.test(trimmed)) { sequence.push(trimmed); continue; }
    // Anything with a digit in it is a filename or a model number, and its
    // hyphens ARE separators. The first version flattened them instead, so
    // "canon-eos-r5-front" became one word "canoneosr" followed by "5" and
    // produced the context `canoneosr#5` — which nothing else on earth
    // produces, so a correct Canon photograph stopped matching its own product.
    for (const segment of trimmed.split("-")) {
      for (const piece of segment.match(/[a-z]+|[0-9]+/g) ?? []) sequence.push(piece);
    }
  }
  const contextualFromGlue = new Set<string>();

  for (const run of folded.split(/[^a-z0-9]+/)) {
    if (!run) continue;
    const hasDigit = /\d/.test(run);
    const hasAlpha = /[a-z]/.test(run);

    if (!hasDigit) {
      if (DESIGNATION_WORDS.has(run)) out.add(run);
      continue;
    }

    // A GLUED SPELLING MUST NOT OUT-DECLARE A SPACED ONE.
    //
    // "WIFI7" is one alphanumeric run, so it would emit the whole token
    // "wifi7" — which "Wi-Fi 7" never produces — and the two spellings of one
    // standard looked like two different things.
    //
    // A run of {two or more letters}{one digit} IS the glued spelling of a
    // contextual number, so it is written as one: usb4 -> usb#4, pcie5 ->
    // pcie#5, wifi7 -> wifi#7. Runs whose number identifies on its own ("s26",
    // "hero13") and runs whose prefix is a single letter ("r5", "z8") are
    // untouched, because neither is a context-plus-version.
    const gluedContext = /^([a-z]{2,})(\d)$/.exec(run);
    if (gluedContext && !DESIGNATION_WORDS.has(gluedContext[1])) {
      contextualFromGlue.add(`${gluedContext[1]}#${gluedContext[2]}`);
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

  // CONTEXTUAL NUMBERS ARE THE LAST RESORT, AND ONLY WHERE NOTHING ELSE
  // IDENTIFIES NUMERICALLY.
  //
  // Run after the main pass, so it can see what that pass found. If the name
  // already carries a real model number — "R5", "9950X", "6E" — then any other
  // bare digit in it is a version, a series tier or a count, not the identity:
  //
  //   "Canon EOS R5 firmware 2.0"  -> r5        (NOT firmware#2)
  //   "AMD Ryzen 9 9950X"          -> 9950x     (NOT ryzen#9)
  //   "Wi-Fi 6E"                   -> 6e        (NOT wifi#6)
  //
  // Both of those first two shipped as bugs — the firmware one made a correct
  // update read as a different product, the Ryzen one made a correct photograph
  // stop matching its own page — and both were caught by tests that already
  // existed, going red.
  //
  // A designation WORD does not suppress this. "PlayStation 5 Pro" carries
  // "pro" and still needs playstation#5, because "pro" says which variant and
  // nothing at all about which generation.
  for (const t of contextualFromGlue) out.add(t);

  const carriesRealNumber = [...out].some((t) => /\d/.test(t) && !t.includes("#"));
  if (!carriesRealNumber) {
    const sequence: string[] = [];
    for (const run of folded.split(/[^a-z0-9-]+/)) {
      const trimmed = run.replace(/^-+|-+$/g, "");
      if (!trimmed) continue;
      // A run of letters and hyphens is ONE word: "wi-fi". Keeping it whole is
      // the entire reason hyphens survive this split.
      if (/^[a-z-]+$/.test(trimmed)) { sequence.push(trimmed); continue; }
      // Anything with a digit is a filename or a model number, and ITS hyphens
      // are separators. Flattening them instead turned "canon-eos-r5-front"
      // into the context "canoneosr" — a word nothing else on earth produces.
      for (const segment of trimmed.split("-")) {
        for (const piece of segment.match(/[a-z]+|[0-9]+/g) ?? []) sequence.push(piece);
      }
    }
    addContextualNumbers(sequence, out);
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

  let onlyInSubject = [...a].filter((t) => !b.has(t));
  let onlyInOther = [...b].filter((t) => !a.has(t));

  // A RANGE COVERS THE POINTS INSIDE IT.
  //
  // "Wi-Fi 4 to Wi-Fi 7: What Each Generation Changed" carries {wifi#4, wifi#7}
  // and an article about "Wi-Fi 7" carries {wifi#7}. Read as a plain set
  // difference that is a disagreement, and the coverage veto would announce that
  // the generations piece is about a different standard — while it is sitting
  // there covering exactly that standard.
  //
  // So within one context, a SUBSET is not a disagreement. {7} against {4,7} is
  // one piece being broader than the other. {7} against {8} is two different
  // standards, and {4,7} against {8} still is. Only a difference in BOTH
  // directions means the two names disagree about which thing they are naming.
  //
  // This applies to contextual numbers only. A subset rule over ordinary
  // designations would say a plain "EOS R5" covers an "EOS R5 Mark II", which is
  // the false-SKU claim this whole file exists to refuse.
  const byContext = (tokens: readonly string[]): Map<string, Set<string>> => {
    const m = new Map<string, Set<string>>();
    for (const t of tokens) {
      const hash = t.indexOf("#");
      if (hash < 0) continue;
      const ctx = t.slice(0, hash);
      if (!m.has(ctx)) m.set(ctx, new Set());
      m.get(ctx)!.add(t.slice(hash + 1));
    }
    return m;
  };
  const ctxA = byContext([...a]);
  const ctxB = byContext([...b]);
  const subsetContexts = new Set<string>();
  for (const [ctx, na] of ctxA) {
    const nb = ctxB.get(ctx);
    if (!nb) continue; // context on one side only — ordinary designation rules apply
    const aSubset = [...na].every((n) => nb.has(n));
    const bSubset = [...nb].every((n) => na.has(n));
    if (aSubset || bSubset) subsetContexts.add(ctx);
  }
  if (subsetContexts.size > 0) {
    const covered = (t: string) => {
      const hash = t.indexOf("#");
      return hash >= 0 && subsetContexts.has(t.slice(0, hash));
    };
    onlyInSubject = onlyInSubject.filter((t) => !covered(t));
    onlyInOther = onlyInOther.filter((t) => !covered(t));
  }

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
