// THE ONE LIST OF PAIRS THAT MUST NEVER BE TREATED AS THE SAME PRODUCT.
//
// WHY A SHARED CORPUS AND NOT THREE TEST FILES
// --------------------------------------------
// A plain "Canon EOS R5" photograph shipped as the hero image for a "Canon EOS
// R5 Mark II" article while the test suite was green. The suite asserted that
// exact pair — against `assessEntityMatch`, the matcher used to ACQUIRE media
// from external providers. The defect was in `scoreMatch`, the matcher used to
// choose media from the LIBRARY. Two matchers doing the same job; one tested.
//
// A green suite proves the tested path is right and says nothing about a
// parallel path doing the same job. So the pairs live here, once, and every
// consumer of product identity is asserted against all of them:
//
//   scoreMatch            media/match-engine.ts        library -> content
//   assessEntityMatch     media/providers/entity-match.ts  provider -> catalogue
//   compareModelIdentity  engine/model-identity.ts     coverage veto
//
// Adding a pair here adds it to every matcher at once. That is the point: the
// failure mode being defended against is not "this pair is wrong", it is "this
// pair is right in one place and wrong in another, and nobody notices".
//
// Data only. No assertions, no I/O — so a script can print it as evidence
// against the real library without importing a test runner.

/**
 * Two products that a careless matcher reads as one.
 *
 * `subject` is the thing being written about or illustrated; `sibling` is the
 * adjacent product whose picture, article or search result must not be
 * substituted for it. Both directions are checked by the consumers, because
 * "an older camera passed off as the new one" and "the new one passed off as
 * the old" are both false claims about a product.
 */
export type FalseMatchPair = {
  subject: string;
  sibling: string;
  manufacturer: string;
  /** What makes them different, in the words a reader would use. */
  distinction: string;
  /** A filename spelled the way this library actually spells them. */
  siblingFilename: string;
};

/**
 * Every pair the coverage-and-media brief named, plus the two that real data
 * added.
 *
 * "Mac mini / Mac Studio" is the one that was live: neither name carries a
 * digit, so every `/\d/.test(title)` test of "does this name a specific model"
 * answered no, and a Mac mini photograph was offered as the lead image for
 * "Mac Studio review" at score 54 — with the matcher's own reasons already
 * saying it identified a different variant.
 */
export const FALSE_MATCH_PAIRS: readonly FalseMatchPair[] = [
  {
    subject: "Canon EOS R5 Mark II",
    sibling: "Canon EOS R5",
    manufacturer: "Canon",
    distinction: "a later revision of the same body — Mark II",
    siblingFilename: "canon-eos-r5-front",
  },
  {
    subject: "Canon EOS 60D",
    sibling: "Canon EOS 6D",
    manufacturer: "Canon",
    distinction: "an APS-C body and a full-frame body, one digit apart",
    siblingFilename: "canon-eos-6d",
  },
  {
    subject: "NVIDIA GeForce RTX 5090",
    sibling: "NVIDIA GeForce RTX 5080",
    manufacturer: "NVIDIA",
    distinction: "two tiers of the same generation",
    siblingFilename: "nvidia-geforce-rtx-5080",
  },
  {
    subject: "DJI Mini 4 Pro",
    sibling: "DJI Mini 4K",
    manufacturer: "DJI",
    distinction: "different drones sharing a series number",
    siblingFilename: "dji-mini-4k",
  },
  {
    subject: "Samsung Galaxy S26 Ultra",
    sibling: "Samsung Galaxy S26",
    manufacturer: "Samsung",
    distinction: "the tier suffix Ultra",
    siblingFilename: "samsung-galaxy-s26",
  },
  {
    subject: "Apple iPhone 18 Pro",
    sibling: "Apple iPhone 18",
    manufacturer: "Apple",
    distinction: "the tier suffix Pro",
    siblingFilename: "apple-iphone-18",
  },
  {
    subject: "Apple Mac Studio",
    sibling: "Apple Mac mini",
    manufacturer: "Apple",
    distinction: "two different desktops, neither name carrying a digit",
    siblingFilename: "apple-mac-mini",
  },
  {
    subject: "Sony PlayStation 5 Pro",
    sibling: "Sony PlayStation 5",
    manufacturer: "Sony",
    distinction: "a mid-generation revision",
    siblingFilename: "sony-playstation-5",
  },
  {
    subject: "Bambu Lab H2D",
    sibling: "Bambu Lab X1C",
    manufacturer: "Bambu Lab",
    distinction: "two entirely different printers from one maker",
    siblingFilename: "bambu-lab-x1c",
  },
  {
    subject: "Nikon Z8",
    sibling: "Nikon Z9",
    manufacturer: "Nikon",
    distinction: "one digit, two bodies",
    siblingFilename: "nikon-z9",
  },
  // Added from the catalogue rather than the brief: this library really holds
  // `canon-eos-5d-mark-iii.jpg` and `canon-eos-5d-mark-iv-03.jpg`, and they are
  // the narrowest case that has to work — the numeral alone separates them.
  {
    subject: "Canon EOS 5D Mark II",
    sibling: "Canon EOS 5D Mark III",
    manufacturer: "Canon",
    distinction: "consecutive roman numerals and nothing else",
    siblingFilename: "canon-eos-5d-mark-iii",
  },
];
