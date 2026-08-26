// DO TWO SUBJECTS NAME THE SAME PRODUCT?
//
// WHAT THIS FIXES
// ---------------
// Coverage was decided by word overlap. Adjacent models share almost every
// word, so every one of these scored above the 0.42 "already covered"
// threshold and the newer product's development was silently marked as
// covered by the older product's article:
//
//   0.71  "Canon EOS R5 Mark II firmware update" / "Canon EOS R5 firmware update"
//   0.80  "iPhone 18 Pro event date"             / "iPhone 18 event date"
//   0.67  "Galaxy S26 Ultra announced"           / "Galaxy S26 announced"
//   0.60  "NVIDIA RTX 5090 review"               / "NVIDIA RTX 5080 review"
//   0.50  "Nikon Z8 firmware 3.0"                / "Nikon Z9 firmware 3.0"
//
// Eight of eight. A publication that already covers the R5 would never learn
// that the R5 Mark II shipped — the gap engine would report it as handled.
// This is the exact failure the coverage brief names, and it is worse than a
// missed story: it is a missed story the system reports as covered.
//
// WHY THE MEDIA TOKENISER
// -----------------------
// identityTokens/modelTokens already answer "which model is this?" for image
// matching, and were just taught to preserve roman-numeral variants. Reusing
// them means an article and a photograph agree about what "EOS R5 Mark II"
// means, rather than two subsystems inventing separate notions of identity.
//
// WHAT IT IS NOT
// --------------
// Not a similarity score and not a replacement for one. It answers a narrower
// question — do these name the same MODEL — and coverage-decision.ts uses it
// as a veto over similarity, not instead of it. Two pieces about the same
// product are still compared on wording as before.

import { identityTokens, modelTokens } from "../media/subject-match.ts";
import { DESIGNATION_WORDS } from "../media/identity.ts";

export type ModelIdentityVerdict = {
  /** False when the two subjects demonstrably name different models. */
  sameModel: boolean;
  /** Designations present in one and absent from the other. */
  differing: string[];
  reason: string;
};

/**
 * Tokens that pin a specific model: anything with a digit, plus the variant
 * words that separate one revision from the next.
 *
 * "pro", "ultra", "max" and "mini" count. They are how Apple and Samsung
 * distinguish products, and treating them as noise is what let "iPhone 18 Pro"
 * be answered by "iPhone 18".
 */
function designationTokens(subject: string): Set<string> {
  const out = new Set<string>(modelTokens(subject));
  for (const t of identityTokens(subject)) {
    if (DESIGNATION_WORDS.has(t)) out.add(t);
  }
  return out;
}

// The tier list that used to live here (pro/max/plus/ultra/mini/air/lite/se/xl)
// was a THIRD private copy of the same idea, and it was missing "studio" — so
// "Mac Studio" registered as naming no model at all. It now reads
// DESIGNATION_WORDS, the one list every matcher shares. See media/identity.ts.

export function compareModelIdentity(a: string, b: string): ModelIdentityVerdict {
  const da = designationTokens(a);
  const db = designationTokens(b);

  // Neither names a model: this is a topical comparison and identity cannot
  // decide it either way. Similarity remains the right tool.
  if (da.size === 0 && db.size === 0) {
    return { sameModel: true, differing: [], reason: "Neither subject names a specific model." };
  }

  const onlyInA = [...da].filter((t) => !db.has(t));
  const onlyInB = [...db].filter((t) => !da.has(t));
  const differing = [...new Set([...onlyInA, ...onlyInB])];

  if (differing.length === 0) {
    return { sameModel: true, differing: [], reason: "Both subjects name the same model designation." };
  }

  return {
    sameModel: false,
    differing,
    reason:
      `The subjects differ by ${differing.join(", ")}, so they name different models. ` +
      "Coverage of one is not coverage of the other.",
  };
}

/**
 * Whether existing coverage of `existingTitle` genuinely covers `subject`.
 *
 * A veto, not a score: it can only ever say "these are different products",
 * and says nothing when neither names a model.
 */
export function coversSameModel(subject: string, existingTitle: string): boolean {
  return compareModelIdentity(subject, existingTitle).sameModel;
}
