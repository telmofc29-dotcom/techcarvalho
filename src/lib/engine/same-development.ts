// ARE THESE TWO HEADLINES ABOUT THE SAME UNDERLYING DEVELOPMENT?
//
// Word-overlap similarity cannot answer this. Four drafts survived every
// duplicate check while describing one event:
//
//   "New Mac mini could launch before Apple's September event"
//   "Apple announces updated Mac mini, here's everything"
//   "Apple Announces New Mac Mini With M6 and M5"
//   "Apple Mac Mini M6 and Mac Studio M5 Ultra: Specs, Price, Release"
//
// They share barely any vocabulary — "Mac mini" and little else — so
// titleSimilarity puts them well below any safe duplicate threshold. Raising
// that threshold to catch them would start merging genuinely different stories,
// which is the worse failure.
//
// The signal that actually separates these cases is not wording. It is:
//
//   1. WHAT PRODUCT is being talked about, and
//   2. WHAT KIND of development it is.
//
// Same product AND same kind means one story reported by several outlets. Same
// product but different kind — a price change versus a launch — means two real
// stories about one product, and those must stay apart.
//
// A COMPARISON IS NEVER A DUPLICATE OF A NON-COMPARISON. "Canon EOS 6D vs 6D
// Mark II" and "Canon EOS 60D vs 6D Mark II" share most of their words and
// compare different cameras; that protection is kept here rather than
// reimplemented per caller.

import { PRIORITY_ENTITIES } from "./priority-entities.ts";

/**
 * Company names, from the watchlist itself.
 *
 * Only e.name is used, never the aliases: "Elegoo" is a company, but "iphone",
 * "ender" and "neptune" are products and identify a specific thing.
 */
const COMPANY_WORDS = new Set(
  PRIORITY_ENTITIES.flatMap((e) => e.name.toLowerCase().split(/\s+/)).filter(Boolean)
);

/** What kind of development a headline describes. */
export type DevelopmentKind =
  | "launch"
  | "price"
  | "software_update"
  | "availability"
  | "discontinuation"
  | "legal"
  | "unclassified";

const KIND_RULES: readonly { kind: DevelopmentKind; pattern: RegExp }[] = [
  // Order matters: a discontinuation and a recall read as announcements too.
  { kind: "discontinuation", pattern: /\b(discontinu\w*|end of (life|support)|recall(s|ed|ing)?|pulled from sale)\b/i },
  { kind: "legal", pattern: /\b(lawsuit|antitrust|settlement|court|regulator|investigation|fine[ds]?)\b/i },
  // Requires a price MOVEMENT, not the word "price". A launch article routinely
  // lists "Specs, Price, Release Date", and matching the bare word classified
  // those as price stories and split them off from the launch they describe.
  { kind: "price", pattern: /\b(price (rise|rises|hike|hikes|cut|cuts|drop|drops|increase|increases)|raises? (the )?price|cheaper|more expensive|tariffs?)\b/i },
  { kind: "software_update", pattern: /\b(firmware|patch|beta \d|software update|os update|version \d|rolls? out|update that)\b/i },
  { kind: "launch", pattern: /\b(launch\w*|announc\w*|unveil\w*|introduc\w*|reveal\w*|debut\w*|specs?|release date)\b/i },
  { kind: "availability", pattern: /\b(now available|goes on sale|ships?|arrives?|hits shelves|pre[- ]order|out now)\b/i },
];

export function developmentKind(headline: string): DevelopmentKind {
  for (const r of KIND_RULES) if (r.pattern.test(headline)) return r.kind;
  return "unclassified";
}

/**
 * Words that look like product names but identify nothing.
 *
 * Without this, "New Apple Product" and "New Apple Service" share the token
 * "apple" and every story from one company collapses into one.
 */
const NOT_A_PRODUCT = new Set([
  "the", "a", "an", "new", "next", "first", "this", "that", "here", "what", "why", "how",
  "apple", "samsung", "google", "microsoft", "nvidia", "amd", "intel", "sony", "canon",
  "nikon", "report", "reportedly", "everything", "more", "best", "top", "update", "news",
  "company", "companies", "series", "edition", "limited",
  "and", "with", "for", "from", "its", "his", "her", "their",
]);
// NOT excluded, deliberately: "mini", "pro", "max", "plus", "ultra", "air".
// They read as generic modifiers and are in fact how Apple, Samsung and others
// distinguish one product from another. Listing them here reduced "Mac mini"
// and "Mac Studio" to the single shared token "mac", and the cluster this
// module exists to collapse stopped collapsing.

/**
 * The distinctive words a headline uses to name its subject.
 *
 * CAPITALISATION IS NOT USABLE HERE. Many publishers title-case every word, so
 * "With" and "And" look exactly as much like product names as "Mac" does. An
 * earlier version keyed on capitalised runs and matched
 * "announces new mac mini with m6 and m5" as a single product.
 *
 * What survives instead is subtraction: drop the words that appear in every
 * headline — articles, prepositions, announcement verbs, company names,
 * generic adjectives — and whatever remains is what the story is ABOUT. For
 * the four Mac mini headlines that leaves {mac, mini} in common and nothing
 * else, which is exactly the signal needed.
 */
export function productTokens(headline: string): Set<string> {
  const cleaned = headline
    .replace(/&#\d+;/g, " ")
    .replace(/[’']s\b/gi, "")
    .toLowerCase();

  const tokens = new Set<string>();
  for (const raw of cleaned.split(/[^a-z0-9+]+/)) {
    const w = raw.trim();
    if (!w) continue;
    if (w.length < 2) continue;
    // A bare number is a year, a count or a price fragment — never an identity.
    if (/^\d+$/.test(w)) continue;
    if (NOT_A_PRODUCT.has(w)) continue;
    if (GENERIC_VERBS.has(w)) continue;
    tokens.add(w);
  }
  return tokens;
}

/**
 * How many distinctive words two headlines must share to be one development.
 *
 * TWO, not one. One is met by "mac" alone, which would merge a Mac mini launch
 * with a Mac Studio launch; and by a shared chip name, which would merge
 * "Mac Studio M5 Ultra" with "MacBook Pro M5". Two is met by the real cluster
 * ({mac, mini}) and by nothing that has been seen to over-collapse.
 */
const MIN_SHARED_TOKENS = 2;

/**
 * Words that qualify a product without identifying one.
 *
 * They must be KEPT as tokens — "Mac mini" and "Mac Studio" are different
 * products and only "mini"/"studio" say so — but they cannot carry a match on
 * their own. "Acemagic Launches F2A Mini PC With Intel Core Ultra" and "Apple
 * Mac Mini M6 and Mac Studio M5 Ultra" share exactly {mini, ultra}: two
 * tokens, two different companies, two unrelated products. Requiring at least
 * one SUBSTANTIVE word in the overlap is what separates those.
 */
const MODIFIERS = new Set([
  "mini", "pro", "max", "plus", "ultra", "air", "lite", "se", "xl",
  "new", "next", "gen", "generation", "standard", "base", "core",

  // CATEGORY WORDS BELONG HERE TOO. In a 3D-printing corpus every headline
  // says "3D" and "printing"; in a camera corpus every headline says "camera".
  // A word that appears in most of the section's stories cannot identify one
  // of them. This caught a real merge: "Elegoo Launches Fiber-Reinforced
  // Filament ... FDM 3D Printing" and "Elegoo Launches Nexprint, a 3D Model
  // Platform" shared exactly {elegoo, 3d} — one company plus one category
  // word — and were collapsed into a single story despite being a filament
  // and a software platform.
  "3d", "printing", "printer", "printers", "filament",
  "ai", "tech", "technology", "digital", "smart", "wireless",
  "camera", "cameras", "phone", "phones", "smartphone", "laptop", "laptops",
  "console", "gaming", "game", "games", "chip", "chips", "app", "apps",
  "software", "platform", "series", "model", "models", "range", "lineup",
]);

/** Words that describe the ACT of announcing rather than the thing announced. */
const GENERIC_VERBS = new Set([
  "announces", "announced", "announce", "announcement", "launch", "launches", "launched",
  "unveils", "unveiled", "introduces", "introduced", "reveals", "revealed", "debuts",
  "could", "will", "may", "might", "expected", "rumoured", "rumored", "leak", "leaked",
  "before", "after", "ahead", "here", "everything", "all", "you", "need", "know",
  "specs", "spec", "price", "release", "date", "event", "updated", "gets", "adds",
  "brings", "makes", "coming", "soon", "now", "today", "week", "month", "year",
  "january", "february", "march", "april", "may", "june", "july", "august",
  "september", "october", "november", "december",
]);

function comparisonSides(subject: string): string[] | null {
  const parts = subject.split(/\s+vs\.?\s+/i);
  if (parts.length < 2) return null;
  return parts.map((p) => p.toLowerCase().replace(/[^a-z0-9]/g, "")).sort();
}

export type SameDevelopmentResult = {
  same: boolean;
  /** Why, for reports. A collapse the owner cannot explain is a collapse they cannot trust. */
  reason: string;
  sharedProducts: string[];
  kind: DevelopmentKind;
};

export function sameDevelopment(a: string, b: string): SameDevelopmentResult {
  const sa = comparisonSides(a);
  const sb = comparisonSides(b);

  // A comparison is its own kind of article and is identified by the SET of
  // things compared, never by word overlap.
  if (sa || sb) {
    if (!sa || !sb) {
      return { same: false, reason: "one is a comparison and the other is not", sharedProducts: [], kind: "unclassified" };
    }
    const identical = sa.length === sb.length && sa.every((v, i) => v === sb[i]);
    return {
      same: identical,
      reason: identical ? "the same two things are being compared" : "different things are being compared",
      sharedProducts: [],
      kind: "unclassified",
    };
  }

  const ka = developmentKind(a);
  const kb = developmentKind(b);
  if (ka !== kb || ka === "unclassified") {
    return {
      same: false,
      reason: ka === kb ? "neither headline states a recognisable kind of development" : `different kinds of development (${ka} vs ${kb})`,
      sharedProducts: [],
      kind: ka,
    };
  }

  const pa = productTokens(a);
  const pb = productTokens(b);
  const shared = [...pa].filter((t) => pb.has(t));

  // The overlap must name a THING, not only qualify one.
  //
  // A company name is excluded here as well as a modifier. Two Elegoo launches
  // both say "Elegoo"; that they come from one company is not evidence that
  // they are one story. Company names are read from the watchlist rather than
  // listed again, so the two cannot drift — and only the NAME is excluded, not
  // the aliases, because aliases like "iphone", "ender" and "neptune" identify
  // products and must stay substantive.
  const substantive = shared.filter((t) => !MODIFIERS.has(t) && !COMPANY_WORDS.has(t));
  if (shared.length >= MIN_SHARED_TOKENS && substantive.length === 0) {
    return {
      same: false,
      reason: `only qualifiers in common (${shared.join(", ")}) — these name different products`,
      sharedProducts: shared,
      kind: ka,
    };
  }

  if (shared.length < MIN_SHARED_TOKENS) {
    return {
      same: false,
      reason: shared.length === 0
        ? "no subject words in common"
        : `only one subject word in common (${shared[0]}) — not enough to be one story`,
      sharedProducts: shared,
      kind: ka,
    };
  }

  return {
    same: true,
    reason: `same ${ka} concerning ${shared.join(", ")}`,
    sharedProducts: shared,
    kind: ka,
  };
}
