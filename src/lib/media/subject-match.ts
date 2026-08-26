// Does this image actually show THE THING the page is about?
//
// WHY THIS EXISTS
// ---------------
// The media library audit settled the arithmetic — 112 rows, 112 distinct
// files, none missing — and revealed the problem the count was hiding: 65 of
// the 112 are generated graphics and none are photographs this site took. The
// public consequence is that a Canon EOS R7 page can be "illustrated" by a
// title card, and an article about a specific game can lead with an unrelated
// chart, and every automated check passes because an image is present.
//
// "Has media" is the wrong question. "Has media OF THIS SUBJECT" is the right
// one, and nothing in the schema answers it: product_media records that an
// asset is attached to a product, not that it depicts it.
//
// So this reads the only evidence available — the asset's own alt text and
// caption, which are written to describe what is in the picture — and asks
// whether the SUBJECT'S IDENTITY appears in it.
//
// THE IDENTITY RULE, REUSED
// -------------------------
// A model designation is what makes a product that product. "Canon EOS R7" and
// "Canon EOS R5" share every word except the one that matters. So matching
// requires the DIGIT-BEARING tokens — R7, 60D, X1, A1, 24-70 — not the brand
// name, exactly as quality-inventory.ts learned when a naive title matcher
// proposed merging every Canon article because it kept only the token "canon".
//
// A manufacturer match is explicitly NOT enough. "A Canon camera" on a page
// about the EOS R7 is the failure being measured, not a pass.
//
// WHAT THIS CANNOT DO
// -------------------
// It cannot look at pixels. An asset whose alt text is wrong will be scored on
// the wrong text, and an asset with no alt text at all scores `unknown` rather
// than `missing` — those are different, and conflating them would turn a
// documentation gap into a fabricated finding about imagery.
//
// Pure. No I/O.

export type MediaVerdict =
  /** A photograph or graphic that names this exact subject. */
  | "strong"
  /** Real imagery of the right family or a closely related model. */
  | "acceptable"
  /** A generated title card or category graphic standing in for a picture. */
  | "generic_placeholder"
  /** Real imagery, but of something else. Actively misleading. */
  | "wrong_subject"
  /** No usable imagery attached at all. */
  | "missing"
  /** Imagery exists but carries no description, so nothing can be judged. */
  | "undescribed";

export type SubjectMediaAsset = {
  id: string;
  altText: string | null;
  caption: string | null;
  sourceType: string | null;
  assetRole: string | null;
  brandRole: string | null;
};

export type Subject = {
  /** Full product or article name, e.g. "Canon EOS R7". */
  name: string;
  /** Manufacturer name, e.g. "Canon". Used to detect the not-enough case. */
  manufacturerName: string | null;
};

const GENERATED_SOURCE_TYPES = new Set(["tc_graphic"]);
const DATA_GRAPHIC_ROLES = new Set(["diagram", "chart", "comparison_graphic"]);

/** Words carrying no identity. Matching on these is how everything matches everything. */
const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "of", "for", "with", "vs", "versus", "in", "on", "to",
  "camera", "lens", "printer", "photo", "photograph", "image", "picture", "product",
  "mark", "series", "edition", "kit", "body", "black", "white", "silver",
]);

/**
 * Tokens that identify a subject.
 *
 * DIGIT-BEARING TOKENS ARE KEPT WHATEVER THEIR LENGTH. "R7", "A1", "X1" are two
 * characters and are the entire identity; a minimum-length filter would discard
 * exactly the tokens that distinguish one model from the next. This is the same
 * rule quality-inventory.ts arrived at after a length filter reduced every Canon
 * article to the token "canon" and matched them all to each other.
 */
/**
 * Words that distinguish one variant of a product from another.
 *
 * THESE MUST SURVIVE TOKENISATION EVEN THOUGH THE FILTERS ABOVE WOULD KILL
 * THEM. "mark" was a stopword and "ii" is two characters with no digit, so
 * "Canon EOS R5 Mark II" reduced to {canon, eos, r5} — the variant vanished
 * entirely. match-engine.ts has careful logic to refuse an asset whose variant
 * differs from the target's, and that logic was receiving nothing to work with:
 * a plain EOS R5 photograph matched an R5 Mark II article as an EXACT MODEL
 * and was offered for the hero slot.
 *
 * Roman numerals are the dangerous case because they are short. A suffix like
 * "pro" or "ultra" already survives on length alone.
 */
export const VARIANT_WORDS = new Set([
  "ii", "iii", "iv", "v", "vi", "vii", "viii", "ix", "x",
  "mark", "mk",
]);

export function identityTokens(name: string): Set<string> {
  const out = new Set<string>();
  for (const raw of name.toLowerCase().split(/[^a-z0-9./-]+/)) {
    const t = raw.replace(/^[-.]+|[-.]+$/g, "");
    if (!t) continue;
    const hasDigit = /\d/.test(t);
    if (hasDigit) { out.add(t); continue; }
    // Checked BEFORE the stopword and length filters, which is the whole point:
    // both of them were discarding exactly the tokens that separate a Mark II
    // from a Mark III.
    if (VARIANT_WORDS.has(t)) { out.add(t); continue; }
    if (STOPWORDS.has(t)) continue;
    if (t.length < 3) continue;
    out.add(t);
  }
  return out;
}

/** Identity tokens that carry a digit — the ones that actually distinguish models. */
export function modelTokens(name: string): Set<string> {
  return new Set([...identityTokens(name)].filter((t) => /\d/.test(t)));
}

function describedText(asset: SubjectMediaAsset): string {
  return `${asset.altText ?? ""} ${asset.caption ?? ""}`.trim();
}

export function isGeneratedGraphic(asset: SubjectMediaAsset): boolean {
  return (
    GENERATED_SOURCE_TYPES.has(asset.sourceType ?? "") ||
    DATA_GRAPHIC_ROLES.has(asset.assetRole ?? "")
  );
}

export function isDataGraphic(asset: SubjectMediaAsset): boolean {
  return DATA_GRAPHIC_ROLES.has(asset.assetRole ?? "");
}

/**
 * Judge one asset against one subject.
 *
 * A DATA GRAPHIC is judged on its own terms and never called a placeholder: a
 * chart explaining what a specification means is frequently the correct lead
 * image, and demanding a photograph instead would make the page worse. The same
 * judgement hero-selection already encodes.
 */
export function judgeAsset(asset: SubjectMediaAsset, subject: Subject): MediaVerdict {
  // A CONCEPT RENDER NEVER SHOWS THE PRODUCT, however precisely it names it.
  //
  // Checked before anything else, because an imagined PlayStation 6 whose alt
  // text reads "PlayStation 6 concept render" matches every identity token of
  // the subject and would otherwise score "strong" — which is exactly the
  // claim it must never make. See classification.ts.
  if (asset.assetRole === "concept_render") return "generic_placeholder";

  const text = describedText(asset).toLowerCase();
  if (!text) return "undescribed";

  const model = modelTokens(subject.name);
  const allTokens = identityTokens(subject.name);
  const matchedModel = [...model].filter((t) => text.includes(t));
  const matchedAny = [...allTokens].filter((t) => text.includes(t));

  // A PRODUCT is identified by its model designation. An ARTICLE usually has no
  // model number in its title at all — "Minimum and Recommended System
  // Requirements: What They Actually Promise" — so requiring digit-bearing
  // tokens made `namesExactSubject` permanently false for articles, and every
  // data graphic on one fell through to "wrong subject". That produced 24 false
  // accusations against images that were exactly right, including a comparison
  // graphic whose whole subject was minimum versus recommended specs.
  //
  // So: when model tokens exist they must ALL match, because that is what
  // separates an R7 from an R5. When there are none, fall back to a substantial
  // share of the remaining identity tokens.
  const namesExactSubject =
    model.size > 0
      ? matchedModel.length === model.size
      : allTokens.size > 0 && matchedAny.length >= Math.max(2, Math.ceil(allTokens.size * 0.4));

  // A brand-only match is the failure this module exists to measure.
  const brand = subject.manufacturerName?.toLowerCase() ?? "";
  const brandOnly =
    brand.length > 0 && text.includes(brand) && matchedModel.length === 0;

  if (isDataGraphic(asset)) {
    // The graphic is about this subject if it names it; otherwise it is a
    // graphic borrowed from elsewhere.
    if (namesExactSubject) return "strong";
    if (brandOnly || matchedAny.length > 0) return "acceptable";
    return "wrong_subject";
  }

  if (isGeneratedGraphic(asset)) {
    // A generated title card is a placeholder whether or not it names the
    // subject — naming it does not make it a picture of it.
    return "generic_placeholder";
  }

  if (namesExactSubject) return "strong";

  // Real photography that names SOME of the model tokens: the right family,
  // probably the wrong generation.
  if (matchedModel.length > 0) return "acceptable";

  // Real photography naming only the brand, or nothing recognisable.
  if (brandOnly) return "acceptable";

  return matchedAny.length > 0 ? "acceptable" : "wrong_subject";
}

const VERDICT_RANK: Record<MediaVerdict, number> = {
  strong: 0,
  acceptable: 1,
  generic_placeholder: 2,
  undescribed: 3,
  wrong_subject: 4,
  missing: 5,
};

/**
 * The verdict for a subject, given everything attached to it.
 *
 * The BEST asset decides: a page holding one real photograph and three title
 * cards is illustrated, and reporting it as a placeholder problem would send
 * someone to fix a page that is fine.
 */
export function judgeSubject(assets: readonly SubjectMediaAsset[], subject: Subject): MediaVerdict {
  if (assets.length === 0) return "missing";
  return assets
    .map((a) => judgeAsset(a, subject))
    .reduce((best, v) => (VERDICT_RANK[v] < VERDICT_RANK[best] ? v : best), "missing" as MediaVerdict);
}

/** True when this subject has imagery genuinely depicting it. */
export function hasExactSubjectMedia(assets: readonly SubjectMediaAsset[], subject: Subject): boolean {
  return judgeSubject(assets, subject) === "strong";
}

export const VERDICT_LABEL: Record<MediaVerdict, string> = {
  strong: "Shows this exact subject",
  acceptable: "Related, not exact",
  generic_placeholder: "Generated placeholder",
  wrong_subject: "Shows something else",
  missing: "No image at all",
  undescribed: "Image with no description",
};
