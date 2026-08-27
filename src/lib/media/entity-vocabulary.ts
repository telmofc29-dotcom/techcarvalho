// WHICH WORDS IN A HEADLINE ACTUALLY NAME SOMETHING?
//
// THE DEFECT THIS FIXES
// ---------------------
// The matcher scored every non-stopword token in a target's title at 12 points
// each. Editorial headlines on this site share a great deal of ordinary
// English, so real production data produced matches like:
//
//   ARTICLE "Apple is about to launch five new products"
//   IMAGE   hero-gta-6-release-date-status.png     matched on: about, what
//
//   ARTICLE "Minimum and Recommended System Requirements"
//   IMAGE   hero-humanoid-home-robots-2026-reality-check.png
//                                                  matched on: what, they, actually
//
// Nothing false reached a lead slot — the SKU rule and the diagram rule both
// held — but a suggestion queue offering a GTA 6 graphic for an Apple story is
// noise an editor has to read past, and noise is how a queue stops being read.
//
// WHY NOT A BIGGER STOPWORD LIST
// ------------------------------
// Because the list would never end, and because it answers the wrong question.
// "Actually" is noise here; "Air" is noise in most sentences and is a product
// name in others. A blacklist has to guess in advance which words matter; this
// does not have to guess, because the catalogue already knows.
//
// WHAT THIS DOES INSTEAD
// ----------------------
// The site's own reference data — manufacturers, product names, product
// families, taxonomy categories and tags — IS the vocabulary of things this
// publication writes about. A token drawn from that vocabulary is evidence
// about a subject. A token that appears nowhere in it is ordinary English,
// however long it is and whatever a stopword list thinks of it.
//
// The set is built once per load from rows the matcher's caller already reads,
// so this costs no extra query. It grows by itself as the catalogue grows,
// which is the property a blacklist can never have.
//
// Pure. No I/O — the caller supplies the rows.

import { identityTokens } from "./subject-match.ts";

/**
 * Words that name something this publication covers.
 *
 * Built from reference data, not authored. Nothing is added by hand.
 */
export type EntityVocabulary = ReadonlySet<string>;

/**
 * Tokens that are structural rather than naming, even though they appear inside
 * catalogue names.
 *
 * "Series" is in "Xbox Series X" and "Canon EOS R Series"; "Pro" is in dozens of
 * product names. Both would enter the vocabulary from real rows and would then
 * license a match between any two products sharing them. Designations are
 * already handled by identity.ts and scored separately, so removing them here
 * costs nothing and stops the vocabulary being a back door for exactly the
 * generic matching it exists to prevent.
 *
 * This is a SHORT list of words that occur INSIDE catalogue names, not a
 * blacklist of English.
 */
const STRUCTURAL_IN_NAMES = new Set([
  "series", "edition", "generation", "gen", "model", "kit", "body", "bundle",
  "pro", "max", "plus", "ultra", "mini", "air", "lite", "black", "white", "silver",
]);

/**
 * Build the vocabulary from whatever reference rows the caller has.
 *
 * Every argument is optional so a caller holding only some of them still gets a
 * useful set rather than an empty one.
 */
export function buildEntityVocabulary(input: {
  manufacturers?: readonly string[];
  productNames?: readonly string[];
  familyNames?: readonly string[];
  categorySlugs?: readonly string[];
  tagNames?: readonly string[];
}): EntityVocabulary {
  const out = new Set<string>();
  // HYPHENS ARE NOT SEPARATORS HERE, AND THAT MATTERS.
  //
  // The first version of this did `name.replace(/-/g, " ")`, which turned
  // "Wi-Fi 7" into "Wi Fi 7" — three tokens, two of them two letters long, all
  // discarded. The vocabulary silently lost the single most common subject on
  // this site. Caught by four existing tests going red, not by reading it back.
  //
  // So each name contributes: the token as written, its de-hyphenated form
  // ("wi-fi" AND "wifi", because a filename and a headline rarely agree), and
  // each hyphen-separated piece long enough to name something on its own —
  // which is what turns the category slug "cameras-photography" into two useful
  // words rather than one useless compound.
  const record = (token: string) => {
    if (STRUCTURAL_IN_NAMES.has(token)) return;
    // A digit-bearing token is a designation, scored by identity.ts. It does
    // not need to be in the naming vocabulary as well.
    if (/\d/.test(token)) return;
    if (token.length < 3) return;
    out.add(token);
  };
  const add = (source: readonly string[] | undefined) => {
    for (const name of source ?? []) {
      for (const token of identityTokens(name)) {
        record(token);
        if (token.includes("-")) {
          record(token.replace(/-/g, ""));
          for (const piece of token.split("-")) record(piece);
        }
      }
    }
  };
  add(input.manufacturers);
  add(input.productNames);
  add(input.familyNames);
  add(input.categorySlugs);
  add(input.tagNames);
  return out;
}

/**
 * Split a target's non-designation tokens into the ones that name something and
 * the ones that are ordinary English.
 *
 * WHEN THE VOCABULARY IS EMPTY, EVERYTHING IS ORDINARY. That is the honest
 * answer and the safe one: a caller that supplied no reference data has given
 * the matcher no basis for claiming a token names anything, and the scoring
 * below treats ordinary tokens as unable to establish relevance on their own.
 * It fails toward "no match", never toward a confident wrong one.
 */
export function partitionTokens(
  tokens: Iterable<string>,
  vocabulary: EntityVocabulary
): { naming: string[]; ordinary: string[] } {
  const naming: string[] = [];
  const ordinary: string[] = [];
  for (const t of tokens) {
    if (vocabulary.has(t)) naming.push(t);
    else ordinary.push(t);
  }
  return { naming, ordinary };
}
