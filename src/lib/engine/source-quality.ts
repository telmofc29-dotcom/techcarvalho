// Source quality hierarchy.
//
// WHY THIS EXISTS
// ---------------
// The registry already carries `trust_level` (primary/secondary/community) and
// that column does real work in confidence.ts. But trust_level answers "how
// reliable is this organisation?", which is not the question that keeps going
// wrong. The question that keeps going wrong is "reliable *about what*?".
//
// A manufacturer newsroom is `trust_level = 'primary'` and it deserves to be:
// nobody knows a vendor's own MSRP better than the vendor. It is also, on the
// same page, the least trustworthy source in the world for "is this
// significant?" and "is it faster than the competitor?". Phase 3 produced 16
// briefs and every single one was a vendor press release, precisely because a
// primary trust_level was read as a general licence to treat the item as news.
//
// So this module splits authority by CLAIM DOMAIN. A vendor press release is
// authoritative for the vendor's own specification, price and date, and for
// nothing else — in particular being recent never makes it news.
//
// DPReview is deliberately `secondary` in the registry. That is not a demotion
// to be corrected: independent outlets are `independent_high_quality` here,
// which carries authority a manufacturer newsroom does not have (performance,
// significance, real-world compatibility). The two classes are different, not
// ranked on one axis.
//
// CONFLICTS
// ---------
// When two sources disagree, the answer is never "whichever we processed
// first". reconcileConflict() either resolves the disagreement by a stated
// authority rule and records what it rejected, or it refers the whole thing to
// a human. It is order-independent by construction — reversing the input array
// produces an identical result — because "first one wins" is exactly the silent
// failure this is here to prevent.
//
// Deterministic. No AI provider, no network, no cost.

import type { EngineSourceType, TrustLevel } from "./types.ts";

// ---------------------------------------------------------------------------
// Classes
// ---------------------------------------------------------------------------

export type SourceClass =
  /** Manufacturer documentation, standards bodies, regulators, official developer material. */
  | "primary"
  /** Independent outlets doing their own reporting: corroboration and context. */
  | "independent_high_quality"
  /** Vendor marketing/newsroom output. Authoritative about itself, and nothing else. */
  | "vendor_press_release"
  /** Forums, social, comments. Can raise a question; never settles one. */
  | "social_forum"
  /** Not enough information recorded to classify. Treated as carrying no authority. */
  | "unclassified";

/**
 * The kinds of assertion a source can be authoritative for. Deliberately
 * phrased as "vendor_own_*" rather than "specification" so the distinction
 * between "Canon says the sensor is 45MP" and "the sensor is 45MP in practice"
 * cannot be blurred.
 */
export type ClaimDomain =
  | "vendor_own_specification"
  | "vendor_own_price"
  | "vendor_own_release_date"
  | "independent_performance"
  | "independent_significance"
  | "third_party_compatibility"
  | "legal_regulatory"
  | "user_experience";

/**
 * What each class may be cited for. Absence is meaningful: an empty list means
 * the class is never a factual authority, only a signal that a question exists.
 */
export const CLASS_AUTHORITY: Record<SourceClass, readonly ClaimDomain[]> = {
  primary: [
    "vendor_own_specification",
    "vendor_own_price",
    "vendor_own_release_date",
    "third_party_compatibility",
    "legal_regulatory",
  ],
  // Note what is NOT here: independent_significance and
  // independent_performance. A press release is not evidence that something
  // matters, and a vendor's own benchmark is not an independent benchmark.
  vendor_press_release: ["vendor_own_specification", "vendor_own_price", "vendor_own_release_date"],
  independent_high_quality: [
    "independent_performance",
    "independent_significance",
    "third_party_compatibility",
    "user_experience",
  ],
  social_forum: [],
  unclassified: [],
};

/**
 * Ordering used only to break a conflict, never to rank quality in general.
 * vendor_press_release sits below independent reporting here even though its
 * trust_level is 'primary', because a conflict is decided on independence.
 */
export const CLASS_RANK: Record<SourceClass, number> = {
  primary: 4,
  independent_high_quality: 3,
  vendor_press_release: 2,
  social_forum: 1,
  unclassified: 0,
};

export const CLASS_LABEL: Record<SourceClass, string> = {
  primary: "primary (documentation / standards / regulator)",
  independent_high_quality: "independent high-quality reporting",
  vendor_press_release: "vendor press release",
  social_forum: "social / forum",
  unclassified: "unclassified",
};

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

export type SourceInput = {
  url?: string | null;
  publisher?: string | null;
  organisation?: string | null;
  /** Registry source_type, when the row came from a registered source. */
  sourceType?: EngineSourceType | null;
  trustLevel?: TrustLevel | null;
  /** Non-null means this row repeats someone else's claim. */
  originatesFromUrl?: string | null;
};

export type SourceClassification = {
  sourceClass: SourceClass;
  /** False when the row repeats another source's claim (circular reporting). */
  independent: boolean;
  /** True when this class carries no factual authority at all. */
  signalOnly: boolean;
  authorityFor: readonly ClaimDomain[];
  rank: number;
  explanation: string;
};

// Hosts whose content is user-generated. Not a blocklist — these sources are
// genuinely useful for spotting an emerging question ("everyone's SD card is
// corrupting") before any outlet covers it. They are simply never the proof.
const SOCIAL_HOSTS =
  /(^|\.)(reddit\.com|x\.com|twitter\.com|threads\.net|bsky\.app|facebook\.com|instagram\.com|tiktok\.com|discord\.com|quora\.com|stackexchange\.com|stackoverflow\.com|youtube\.com)$/i;

const FORUM_HOST = /(^|\.)forums?\./i;

// Hosts that are standards bodies or regulators by nature of their name/TLD.
const REGULATOR_HOSTS =
  /(^|\.)(gov|gov\.uk|europa\.eu|iso\.org|ieee\.org|ietf\.org|w3\.org|fcc\.gov|nist\.gov|jedec\.org|usb\.org|vesa\.org)$/i;

// Hosts that ARE a company's own newsroom, whatever the registry says they are.
//
// WHY THIS RULE EXISTS
// --------------------
// All 12 active discovery feeds are registered `source_type = 'rss_atom'`,
// including blog.google, blogs.nvidia.com and newsroom.intel.com — which are
// manufacturer newsrooms in every sense except the registry column.
// SOURCE_TYPE_CLASS maps 'rss_atom' to 'unclassified', and 'unclassified' has
// an EMPTY authority list, so every claim from every live feed was carrying no
// factual authority at all. A vendor is at least authoritative about its own
// price and its own specification, and losing that is a real loss.
//
// The rule can only ever fire on a row that is otherwise `unclassified`, and it
// grants ONLY the vendor-own domains. It cannot promote anything to `primary`
// and — the part that matters — it never grants independent_performance or
// independent_significance. A press release classified correctly is still not
// evidence that the story is news; qualifiesAsNews() now says so explicitly
// instead of falling through an unclassified row.
//
// Aggregators are excluded by name: news.google.com carries the `news.` prefix
// but publishes nothing of its own, so treating it as Google's newsroom would
// be wrong in both directions.
const VENDOR_NEWSROOM_HOST =
  /^(?:newsroom|news|press|pressroom|presscentre|presscenter|media|blog|blogs|corporate|about|investor|investors)\./i;

const NOT_A_NEWSROOM_HOST =
  /^(?:news\.google\.com|news\.ycombinator\.com|news\.microsoft\.com\.feedburner|feedproxy\.google\.com|feeds\.feedburner\.com|news\.bbc\.co\.uk)$/i;

const VENDOR_NEWSROOM_PATH = /\/(?:newsroom|press-releases?|press-release|pressroom|press-centre|press-center)(?:\/|$)/i;

const SOURCE_TYPE_CLASS: Record<EngineSourceType, SourceClass> = {
  official_docs: "primary",
  regulatory_dataset: "primary",
  public_api: "primary",
  // A vendor's structured product feed is the vendor stating its own facts —
  // authoritative about itself, exactly like a press release.
  product_feed: "vendor_press_release",
  manufacturer_newsroom: "vendor_press_release",
  trusted_editorial: "independent_high_quality",
  rss_atom: "unclassified",
  other_approved: "unclassified",
};

function hostOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

function pathOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).pathname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Whether a URL is a company's own newsroom, judged from the URL rather than
 * from the registry column that is supposed to say so. Used only to resolve an
 * `unclassified` row; never to demote a classified one.
 */
export function looksLikeVendorNewsroom(url: string | null | undefined): boolean {
  const host = hostOf(url);
  if (!host) return false;
  if (NOT_A_NEWSROOM_HOST.test(host)) return false;
  if (VENDOR_NEWSROOM_HOST.test(host)) return true;
  const path = pathOf(url);
  return path !== null && VENDOR_NEWSROOM_PATH.test(path);
}

export function classifySource(input: SourceInput): SourceClassification {
  const independent = !input.originatesFromUrl;
  const host = hostOf(input.url);
  const reasons: string[] = [];

  let sourceClass: SourceClass = "unclassified";

  if (input.sourceType) {
    sourceClass = SOURCE_TYPE_CLASS[input.sourceType];
    reasons.push(`registry source_type '${input.sourceType}'`);
  }

  // Host evidence can only ever move a row toward LESS authority, or resolve an
  // unclassified row. It never promotes a press release to primary.
  if (host && (SOCIAL_HOSTS.test(host) || FORUM_HOST.test(host))) {
    sourceClass = "social_forum";
    reasons.push(`user-generated host ${host}`);
  } else if (sourceClass === "unclassified" && host && REGULATOR_HOSTS.test(host)) {
    sourceClass = "primary";
    reasons.push(`standards/regulator host ${host}`);
  } else if (
    sourceClass === "unclassified" &&
    // Only where trust_level does not already say this is an independent
    // outlet. A `secondary` source on blog.<outlet> is a blog by a publication,
    // not a vendor newsroom, and must not be demoted into one.
    (!input.trustLevel || input.trustLevel === "primary") &&
    looksLikeVendorNewsroom(input.url)
  ) {
    sourceClass = "vendor_press_release";
    reasons.push(
      `vendor newsroom URL (${host}) — the registry records source_type '${input.sourceType ?? "none"}', which classifies as unclassified and would carry NO authority at all`
    );
  }

  if (sourceClass === "unclassified" && input.trustLevel) {
    // Fall back to trust_level only when nothing better is recorded, and never
    // upgrade to `primary` on trust_level alone — trust_level says who the
    // organisation is, not what kind of document this is.
    sourceClass =
      input.trustLevel === "community"
        ? "social_forum"
        : input.trustLevel === "secondary"
          ? "independent_high_quality"
          : "vendor_press_release";
    reasons.push(
      input.trustLevel === "primary"
        ? "trust_level 'primary' with no document type recorded — treated as a vendor statement, not as documentation"
        : `trust_level '${input.trustLevel}'`
    );
  }

  if (!reasons.length) reasons.push("nothing recorded about the document type, host or trust level");

  const authorityFor = CLASS_AUTHORITY[sourceClass];
  const explanation =
    `Classified ${CLASS_LABEL[sourceClass]} (${reasons.join("; ")}). ` +
    (authorityFor.length
      ? `Citable for: ${authorityFor.join(", ")}.`
      : `Carries no factual authority — usable to identify a question, never to answer one.`) +
    (independent ? "" : ` Repeats ${input.originatesFromUrl}, so it corroborates nothing.`);

  return {
    sourceClass,
    independent,
    signalOnly: authorityFor.length === 0,
    authorityFor,
    rank: CLASS_RANK[sourceClass],
    explanation,
  };
}

/** Whether a source class may be cited for a given kind of assertion. */
export function isAuthoritativeFor(sourceClass: SourceClass, domain: ClaimDomain): boolean {
  return CLASS_AUTHORITY[sourceClass].includes(domain);
}

/**
 * The specific rule the Phase 3 review queue violated: recency is not
 * newsworthiness. A press release published an hour ago is still a press
 * release, and nothing about it constitutes independent evidence that the
 * story matters.
 *
 * Note that no timestamp is an input here. That is the point — there is no
 * value of "how recent" that could change the answer.
 */
export function qualifiesAsNews(classifications: SourceClassification[]): {
  qualifies: boolean;
  reason: string;
} {
  const independent = classifications.filter(
    (c) => c.independent && c.sourceClass === "independent_high_quality"
  );
  if (independent.length > 0) {
    return {
      qualifies: true,
      reason: `${independent.length} independent outlet(s) reported this, which is evidence of significance beyond the vendor's own announcement.`,
    };
  }
  const vendorOnly =
    classifications.length > 0 && classifications.every((c) => c.sourceClass === "vendor_press_release");
  return {
    qualifies: false,
    reason: vendorOnly
      ? "Every source is the vendor's own announcement. That establishes what the vendor said, not that it is news — recency is not significance."
      : "No independent high-quality source has covered this, so there is no evidence of significance beyond the announcement itself.",
  };
}

// ---------------------------------------------------------------------------
// Conflict reconciliation
// ---------------------------------------------------------------------------

/**
 * Domains where a disagreement is never resolved automatically. A reader acts
 * on these — spends money, books a delivery date, buys an incompatible part,
 * or relies on a legal statement — so an auto-resolved wrong answer costs them
 * something real.
 */
export const HUMAN_REVIEW_DOMAINS: readonly ClaimDomain[] = [
  "vendor_own_price",
  "vendor_own_release_date",
  "legal_regulatory",
  "third_party_compatibility",
];

export type ConflictingAssertion = {
  /** Stable identifier for the evidence row asserting this value. */
  sourceId: string;
  value: string;
  classification: SourceClassification;
};

export type ConflictGroup = {
  value: string;
  sourceIds: string[];
  bestClass: SourceClass;
  bestRank: number;
  /** True when at least one source in the group is independent AND authoritative. */
  authoritative: boolean;
};

export type Reconciliation = {
  claimKey: string;
  domain: ClaimDomain;
  outcome: "no_conflict" | "resolved_by_authority" | "needs_human_review";
  /** Null whenever a human must decide. Never a "first one wins" pick. */
  chosenValue: string | null;
  /** Every distinct value seen, sorted — nothing is silently dropped. */
  distinctValues: string[];
  groups: ConflictGroup[];
  explanation: string;
};

/** Normalised for grouping only; the original text is what gets reported. */
function conflictKey(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[–—]/g, "-")
    .replace(/(\d),(?=\d{3}\b)/g, "$1")
    .replace(/\s+/g, " ");
}

export function reconcileConflict(input: {
  claimKey: string;
  domain: ClaimDomain;
  assertions: ConflictingAssertion[];
}): Reconciliation {
  const { claimKey, domain, assertions } = input;

  if (assertions.length === 0) {
    return {
      claimKey,
      domain,
      outcome: "needs_human_review",
      chosenValue: null,
      distinctValues: [],
      groups: [],
      explanation:
        "No source asserts a value for this claim, so there is nothing to reconcile and nothing to publish.",
    };
  }

  const byKey = new Map<string, ConflictingAssertion[]>();
  for (const a of assertions) {
    const key = conflictKey(a.value);
    const bucket = byKey.get(key);
    if (bucket) bucket.push(a);
    else byKey.set(key, [a]);
  }

  const groups: ConflictGroup[] = [...byKey.values()]
    .map((members) => {
      // Highest-ranked member decides the group's canonical spelling, so the
      // reported value comes from the best source rather than the earliest row.
      const best = members.reduce((b, m) =>
        m.classification.rank > b.classification.rank ? m : b
      );
      return {
        value: best.value,
        sourceIds: members.map((m) => m.sourceId).sort(),
        bestClass: best.classification.sourceClass,
        bestRank: best.classification.rank,
        authoritative: members.some(
          (m) => m.classification.independent && isAuthoritativeFor(m.classification.sourceClass, domain)
        ),
      };
    })
    // Order-independent: ranked by authority, ties broken alphabetically, never
    // by input position.
    .sort((a, b) => b.bestRank - a.bestRank || a.value.localeCompare(b.value));

  const distinctValues = groups.map((g) => g.value).sort((a, b) => a.localeCompare(b));

  if (groups.length === 1) {
    const only = groups[0];
    return {
      claimKey,
      domain,
      outcome: "no_conflict",
      chosenValue: only.authoritative ? only.value : null,
      distinctValues,
      groups,
      explanation: only.authoritative
        ? `All ${assertions.length} source(s) agree on "${only.value}", and at least one is an independent source authoritative for ${domain}.`
        : `All ${assertions.length} source(s) agree on "${only.value}", but none of them is an independent source authoritative for ${domain}. Agreement between non-authoritative sources is not confirmation.`,
    };
  }

  const losers = groups.slice(1).map((g) => `"${g.value}" (${CLASS_LABEL[g.bestClass]})`);

  if (HUMAN_REVIEW_DOMAINS.includes(domain)) {
    return {
      claimKey,
      domain,
      outcome: "needs_human_review",
      chosenValue: null,
      distinctValues,
      groups,
      explanation:
        `Sources disagree on ${claimKey}: ${distinctValues.map((v) => `"${v}"`).join(" vs ")}. ` +
        `${domain} is a domain a reader acts on, so a disagreement is never resolved automatically — ` +
        `a human must establish which is correct.`,
    };
  }

  const [top, second] = groups;
  const decisive = top.bestRank > second.bestRank && top.authoritative;

  if (!decisive) {
    return {
      claimKey,
      domain,
      outcome: "needs_human_review",
      chosenValue: null,
      distinctValues,
      groups,
      explanation:
        `Sources disagree on ${claimKey}: ${distinctValues.map((v) => `"${v}"`).join(" vs ")}. ` +
        (top.bestRank === second.bestRank
          ? `The conflicting values are backed by sources of equal standing (${CLASS_LABEL[top.bestClass]}), so nothing decides between them.`
          : `The strongest value is not backed by an independent source authoritative for ${domain}.`) +
        ` Referred for human review rather than picking one.`,
    };
  }

  return {
    claimKey,
    domain,
    outcome: "resolved_by_authority",
    chosenValue: top.value,
    distinctValues,
    groups,
    explanation:
      `Sources disagree on ${claimKey}. Resolved to "${top.value}" because it is backed by an independent ` +
      `${CLASS_LABEL[top.bestClass]} source, which outranks ${losers.join(" and ")} for ${domain}. ` +
      `The rejected value(s) are recorded rather than discarded, and the article must not present the ` +
      `figure as undisputed.`,
  };
}
