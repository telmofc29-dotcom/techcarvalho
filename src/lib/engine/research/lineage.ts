// SOURCE LINEAGE — counting origins, not URLs.
//
// THE FAILURE THIS PREVENTS
// -------------------------
// Bloomberg reports something. The Verge writes it up citing Bloomberg. Engadget
// writes it up citing Bloomberg. MacRumors aggregates all three. A naive counter
// sees four publishers and calls it strongly corroborated.
//
// It is ONE report. Four URLs, one origin, zero independent confirmation. And
// this is not an edge case — it is the normal shape of technology news, which
// makes it the single most likely way this engine would talk itself into
// publishing a rumour as a fact.
//
// TWO WAYS TO COLLAPSE A VOICE
// ----------------------------
// 1. CITATION. The article names who it got it from. Detected from the text.
// 2. OWNERSHIP. Two mastheads, one owner — The Verge and Polygon are both Vox;
//    Wired and Ars are both Condé Nast; Tom's Hardware, PC Gamer and Digital
//    Camera World are all Future plc. Declared in the source registry.
//
// Both collapse to a single ORIGIN. The count that reaches the evidence model is
// distinct origins, and nothing else.
//
// WHAT IT CANNOT DO
// -----------------
// It cannot detect an uncited lift. If an outlet reproduces another's reporting
// without saying so, this counts two origins, because there is nothing in the
// text to see. That is a known limit, stated rather than papered over: this
// reduces false corroboration, it does not eliminate it.
//
// PURE. No `server-only`, no network.

import { hostOf, registrableDomain } from "../independence.ts";

export type LineageInput = {
  url: string;
  /** Publisher name, when known. */
  publisher?: string | null;
  /** Title and summary text, searched for citations of another outlet. */
  text?: string | null;
  /** Corporate owner from the source registry. Falls back to the domain. */
  independenceGroup?: string | null;
};

export type OriginRole =
  /** No upstream citation found. Treated as its own origin. */
  | "origin"
  /** Names another outlet as the source of the claim. */
  | "derived"
  /** Same corporate owner as an origin already counted. */
  | "same_owner";

export type LineageNode = {
  url: string;
  domain: string;
  publisher: string | null;
  role: OriginRole;
  /** For `derived`, who it cites. For `same_owner`, the group. */
  attributedOrigin: string | null;
  /** The origin key this node collapses into. */
  originKey: string;
};

export type LineageAssessment = {
  nodes: LineageNode[];
  /** Distinct origins. THIS is the number the evidence model may use. */
  independentOrigins: number;
  originKeys: string[];
  /** URLs that added no new voice, with the reason. */
  collapsed: { url: string; reason: string }[];
  explanation: string;
};

/**
 * Outlets whose bylines commonly appear as the ORIGIN of technology scoops.
 *
 * Used only to recognise a citation ("according to Bloomberg"), never to grant
 * authority. Naming an outlet here does not make it trustworthy; it makes a
 * citation OF it detectable, so the citing article can be correctly collapsed.
 */
const KNOWN_ORIGIN_OUTLETS: readonly string[] = [
  "bloomberg", "reuters", "the wall street journal", "wsj", "the information",
  "the new york times", "nikkei", "digitimes", "the elec", "etnews",
  "ming-chi kuo", "mark gurman", "ross young", "korea herald", "financial times",
  "the verge", "ars technica", "engadget", "techcrunch", "wired", "cnet",
  "macrumors", "9to5mac", "appleinsider", "gsmarena", "ign", "eurogamer",
  "gamespot", "pc gamer", "polygon", "tom's hardware", "techpowerup",
  "videocardz", "petapixel", "digital camera world", "dpreview",
];

const CITATION_PATTERNS: readonly RegExp[] = [
  /according to ([\w'’.\- ]{3,40})/i,
  /\bvia ([\w'’.\- ]{3,40})/i,
  /\bfirst reported by ([\w'’.\- ]{3,40})/i,
  /\breport(?:ed|s)? (?:by|from) ([\w'’.\- ]{3,40})/i,
  /\b([\w'’.\- ]{3,40}) reports?\b/i,
  /\bsources? (?:tell|told) ([\w'’.\- ]{3,40})/i,
  /\bciting ([\w'’.\- ]{3,40})/i,
];

/**
 * Find the outlet a piece of text credits, if any.
 *
 * Only returns a name it RECOGNISES. A free-text capture would happily return
 * "the company" or "people familiar", and treating those as an upstream outlet
 * would collapse independent reports into a phantom shared origin — which is
 * the opposite error and just as bad.
 */
export function citedOrigin(text: string | null | undefined, selfDomain: string): string | null {
  if (!text) return null;
  for (const pattern of CITATION_PATTERNS) {
    const m = text.match(pattern);
    if (!m || !m[1]) continue;
    const candidate = m[1].toLowerCase().trim().replace(/[.,;:]+$/, "");
    const hit = KNOWN_ORIGIN_OUTLETS.find(
      (o) => candidate === o || candidate.startsWith(o) || candidate.endsWith(o)
    );
    if (!hit) continue;
    // An outlet citing itself is not derived.
    if (selfDomain.includes(hit.replace(/[^a-z0-9]/g, "").slice(0, 8))) continue;
    return hit;
  }
  return null;
}

/**
 * Collapse a set of URLs into independent origins.
 *
 * Processing order is deliberate: origins are established FIRST, then derived
 * and same-owner nodes collapse into them. Doing it in one pass would let the
 * first URL seen win regardless of whether it was the actual origin.
 */
export function assessLineage(inputs: readonly LineageInput[]): LineageAssessment {
  const nodes: LineageNode[] = [];
  const collapsed: { url: string; reason: string }[] = [];

  const enriched = inputs.map((i) => {
    const domain = registrableDomain(hostOf(i.url)) ?? "unknown";
    return {
      ...i,
      domain,
      cited: citedOrigin(i.text ?? null, domain),
      group: (i.independenceGroup ?? domain).toLowerCase(),
    };
  });

  const seenGroups = new Set<string>();

  for (const e of enriched) {
    // 1. Cites someone else -> collapses into that origin.
    if (e.cited) {
      nodes.push({
        url: e.url,
        domain: e.domain,
        publisher: e.publisher ?? null,
        role: "derived",
        attributedOrigin: e.cited,
        originKey: `cited:${e.cited}`,
      });
      collapsed.push({ url: e.url, reason: `Credits ${e.cited}, so it repeats that report rather than confirming it.` });
      continue;
    }

    // 2. Same corporate owner as a voice already counted.
    if (seenGroups.has(e.group)) {
      nodes.push({
        url: e.url,
        domain: e.domain,
        publisher: e.publisher ?? null,
        role: "same_owner",
        attributedOrigin: e.group,
        originKey: `group:${e.group}`,
      });
      collapsed.push({
        url: e.url,
        reason: `Same owner (${e.independenceGroup ?? e.domain}) as a source already counted, so it is not a second voice.`,
      });
      continue;
    }

    seenGroups.add(e.group);
    nodes.push({
      url: e.url,
      domain: e.domain,
      publisher: e.publisher ?? null,
      role: "origin",
      attributedOrigin: null,
      originKey: `group:${e.group}`,
    });
  }

  const originKeys = [...new Set(nodes.map((n) => n.originKey))];
  const independentOrigins = new Set(nodes.filter((n) => n.role === "origin").map((n) => n.originKey)).size;

  const parts = [
    `${inputs.length} URL(s) resolve to ${independentOrigins} independent origin(s).`,
  ];
  const derived = nodes.filter((n) => n.role === "derived").length;
  const sameOwner = nodes.filter((n) => n.role === "same_owner").length;
  if (derived > 0) parts.push(`${derived} credit another outlet and add no voice.`);
  if (sameOwner > 0) parts.push(`${sameOwner} share an owner with a source already counted.`);
  if (derived === 0 && sameOwner === 0 && inputs.length > 1) {
    parts.push("No shared owner or upstream citation detected between them.");
  }
  parts.push(
    "An uncited lift cannot be detected from the text, so this reduces false corroboration rather than eliminating it."
  );

  return {
    nodes,
    independentOrigins,
    originKeys,
    collapsed,
    explanation: parts.join(" "),
  };
}
