// What a translation is NOT allowed to change.
//
// WHY THIS EXISTS
// ---------------
// Translating editorial prose is a judgement call and should read naturally in
// the target language. Translating a FACT is not a judgement call — it is a
// mistake. "Canon EOS 60D" is the same string in every language; so is
// 802.11be, 5925 MHz, 1024-QAM, WPA3, 8 January 2024 and 1,200 MHz.
//
// The failure is easy to make and hard to see. A translator — human, machine or
// otherwise — working through 2,600 words of technical prose will eventually
// render "802.11be" as "802,11be" because the target language uses a decimal
// comma, or turn "Wi-Fi 6E" into "Wi-Fi 6 E", or quietly drop a figure from a
// list of frequencies. Nothing errors. The page renders. The number is wrong in
// one language only, which is the hardest kind of wrong to notice.
//
// So this extracts the tokens that MUST survive translation and reports the
// ones that did not. It is a lint for prose.
//
// WHAT IT DELIBERATELY DOES NOT DO
// --------------------------------
// It does not check translation QUALITY. It cannot tell whether the Portuguese
// reads well, whether the register is right, or whether a sentence means what
// the English meant. Those need a person who speaks the language. This checks
// the mechanical half — the half a person is worst at proofreading and a
// machine is best at.
//
// A clean report is therefore NOT a statement that a translation is publishable.
// It is a statement that no fact was mangled. Both matter; only one is
// automatable, and pretending otherwise is how a "verified" translation ships
// with confident-sounding errors.
//
// Pure. No I/O.

/**
 * Tokens that carry identity or measurement and must appear, unchanged, in
 * every language.
 *
 * Ordered most specific first, because the matcher takes the first pattern that
 * claims a piece of text — "802.11be" must be caught as a standard designation
 * before the generic number rule sees "802" and "11".
 */
const PROTECTED_PATTERNS: { name: string; re: RegExp }[] = [
  // IEEE amendment designations: 802.11n, 802.11ax, 802.11be.
  { name: "ieee_standard", re: /\b802\.11[a-z]{1,2}\b/gi },
  // Wi-Fi generation names, including the 6E form.
  { name: "wifi_generation", re: /\bWi-Fi\s?\d+E?\b/gi },
  // Security and modulation designations: WPA3, WPA2, 1024-QAM, 4K QAM.
  { name: "designation", re: /\b(?:WPA\d|WEP|\d+K?[\s-]?QAM)\b/gi },
  // Frequencies and rates with a unit attached: 160 MHz, 9.6 Gbps, 100 Mb/s.
  { name: "measurement", re: /\b\d[\d.,]*\s?(?:GHz|MHz|kHz|Gbps|Mbps|Gbit\/s|Mb\/s|GB|MB|TB|mm|MP|fps|Hz)\b/gi },
  // Bare figures that appear without a unit — the lower bound in a range like
  // "5925 to 7125 MHz", or a spelled-out unit as in "1,200 megahertz".
  //
  // The grouped-thousands alternative comes FIRST and is not optional. Without
  // it, "1,200" matched only its last three digits and the checker reported the
  // English source as containing the figure "200", which then failed to match
  // the Portuguese "1200" — a false positive produced entirely by the regex,
  // caught by running this against a real translation.
  {
    name: "figure",
    re: /\b\d{1,3}(?:[,.  ]\d{3})+(?:[.,]\d+)?\b|\b\d{3,}(?:[.,]\d+)?\b/g,
  },
  // Model numbers: any token mixing letters and digits, e.g. R5, 60D, RTX5090.
  { name: "model_token", re: /\b(?=[A-Za-z]*\d)(?=\d*[A-Za-z])[A-Za-z0-9]{2,}\b/g },
];

/**
 * Organisations, standards bodies and regulators. Their names are proper nouns
 * and are not translated, but they are matched separately from model tokens so
 * a report can say WHY something is protected.
 */
const PROTECTED_NAMES = [
  "Wi-Fi Alliance", "IEEE", "FCC", "Ofcom", "OFDMA", "MU-MIMO", "MIMO",
  "MLO", "TWT", "EPCS", "Target Wake Time", "Wi-Fi CERTIFIED",
];

export type ProtectedToken = { token: string; kind: string };

/**
 * Every token in a piece of text that must survive translation unchanged.
 *
 * Case is preserved in the returned token but comparison is case-insensitive:
 * "Wi-Fi" and "wi-fi" are the same fact, and languages capitalise differently.
 */
export function extractProtectedTokens(text: string): ProtectedToken[] {
  const found = new Map<string, ProtectedToken>();
  let remaining = text;

  for (const { name, re } of PROTECTED_PATTERNS) {
    for (const m of remaining.matchAll(re)) {
      const token = m[0].trim();
      const key = normaliseToken(token, name);
      if (!found.has(key)) found.set(key, { token, kind: name });
    }
    // Blank out what this pattern claimed so a later, looser pattern cannot
    // re-match part of it — otherwise "802.11be" also yields the figure "802".
    remaining = remaining.replace(re, (s) => " ".repeat(s.length));
  }

  for (const name of PROTECTED_NAMES) {
    if (new RegExp(`\\b${escapeRegExp(name)}\\b`, "i").test(text)) {
      const key = normaliseToken(name, "organisation");
      if (!found.has(key)) found.set(key, { token: name, kind: "organisation" });
    }
  }

  return [...found.values()];
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Kinds whose separators are FORMATTING, not identity.
 *
 * This distinction was found by using the tool rather than by designing it. A
 * first version compared every token byte-for-byte after case folding, and
 * immediately flagged a correct Portuguese translation for writing 1200 where
 * the English wrote "1,200" — which is not corruption, it is how Portuguese
 * writes the number. Likewise "9.6 Gbps" is legitimately "9,6 Gbps".
 *
 * But "802.11be" becoming "802,11be" IS corruption, because that is a
 * designation and not a quantity: nobody may reformat it for a local audience.
 *
 * So quantities compare on their digit sequence, and designations compare
 * exactly. Getting this backwards in either direction is a bug — a checker that
 * cries wolf on correct localisation gets switched off, and one that accepts a
 * reformatted standard name misses the error it was written for.
 */
const SEPARATOR_INSENSITIVE_KINDS = new Set(["figure", "measurement"]);

/**
 * The comparison key. Whitespace collapsed and case folded, because "Wi-Fi 6E"
 * and "wi-fi 6e" are the same fact and languages capitalise differently.
 */
function normaliseToken(token: string, kind?: string): string {
  const base = token.replace(/\s+/g, " ").trim().toLowerCase();
  if (kind && SEPARATOR_INSENSITIVE_KINDS.has(kind)) {
    // Strip separators between digits only, so "1,200" === "1200" and
    // "9.6" === "9,6", while a unit like "Mb/s" keeps its slash.
    return base.replace(/(?<=\d)[.,   ](?=\d)/g, "");
  }
  // For everything else, a HYPHEN and a SPACE are the same word separator.
  //
  // Found on the first real translation: the English source writes both
  // "1024-QAM" and "1024 QAM" — it is inconsistent with itself — and the
  // Portuguese used one form throughout. That is not a translation error, and
  // reporting it as one is how a checker earns a reputation for crying wolf and
  // then stops being run.
  //
  // A period or comma is deliberately NOT folded here: in "802.11be" it is part
  // of the identifier, and swapping it for a comma changes how the token reads.
  // Word separators are formatting; decimal marks are identity.
  return base.replace(/[-\s]+/g, " ");
}

export type IntegrityReport = {
  /** Protected tokens present in the source but absent from the translation. */
  missing: ProtectedToken[];
  /** How many protected tokens the source contained. */
  sourceTokens: number;
  /** True when every protected token survived. */
  clean: boolean;
};

/**
 * Compare a translation against its source.
 *
 * Reports only what is MISSING, never what is extra: a translation may
 * legitimately mention a figure the source implied, and flagging additions
 * would make the report noisy enough to ignore — which is the failure mode of
 * every lint nobody runs.
 */
export function checkTranslationIntegrity(source: string, translation: string): IntegrityReport {
  const sourceTokens = extractProtectedTokens(source);
  // Keyed by the token's OWN kind on both sides, so a quantity in the source is
  // compared separator-insensitively against a quantity in the translation.
  const present = new Set(
    extractProtectedTokens(translation).map((t) => normaliseToken(t.token, t.kind))
  );

  const missing = sourceTokens.filter((t) => !present.has(normaliseToken(t.token, t.kind)));
  return { missing, sourceTokens: sourceTokens.length, clean: missing.length === 0 };
}
