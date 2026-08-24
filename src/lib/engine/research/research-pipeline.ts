// THE RESEARCH PIPELINE — actively going and looking, rather than waiting.
//
// WHAT "RESEARCH" MEANS HERE, CONCRETELY
// --------------------------------------
// The engine could only ever learn about a story if a feed it already polled
// happened to mention it. That is not research; it is coincidence. This module
// takes a discovery and goes out to the editorial registry to find what OTHER
// publications have said about the same subject.
//
// It does that without a search API, because there is no budget for one and
// none is needed: the registry's 23 verified feeds are fetched, indexed, and
// searched IN MEMORY against the discovery's subject terms. Pulling the recent
// output of twenty-three publications and looking through it is a real search
// over a real corpus — just one this project owns rather than rents.
//
// The honest limit: it can only find what is in those feeds' recent windows.
// A story older than a feed's window is invisible. That is stated in the result
// rather than hidden, because "we found nothing" and "we could not have found
// it" are different facts.
//
// ORDER OF OPERATIONS
// -------------------
//   resolve subject -> build queries -> match feed items -> assess lineage
//   -> extract claims -> classify -> decide
//
// Lineage runs BEFORE claim counting on purpose. Counting claims across four
// articles that all cite Bloomberg would produce an impressive-looking pile of
// evidence representing one report.
//
// PURE. The fetching half is feed-index.ts; this module takes what it found.

import type { FeedItem } from "../feed-parser.ts";
import { assessLineage, type LineageAssessment } from "./lineage.ts";
import { extractClaims, summariseClaims, type AtomicClaim, type ClaimBreakdown } from "./claim-extraction.ts";
import {
  primarySubject,
  researchQueries,
  identifyingQueries,
  type SubjectMatch,
  type ResearchQuery,
} from "./entity-model.ts";
import { assessCorroboration, type CorroborationVerdict } from "../corroboration.ts";
import type { SeedSource } from "./source-seed.ts";

export type IndexedItem = FeedItem & {
  source: SeedSource;
};

export type ResearchMatch = {
  item: IndexedItem;
  /** Which query matched, so the result is explainable. */
  matchedQuery: string;
  /** 0..1, how much of the query's distinctive terms the item carries. */
  strength: number;
};

export type ResearchResult = {
  subject: SubjectMatch | null;
  queries: ResearchQuery[];
  /** Feeds consulted, by organisation. */
  sourcesAttempted: string[];
  sourcesRead: string[];
  sourcesFailed: { organisation: string; reason: string }[];
  matches: ResearchMatch[];
  lineage: LineageAssessment;
  claims: AtomicClaim[];
  claimBreakdown: ClaimBreakdown;
  corroboration: CorroborationVerdict;
  /** What TechCarvalho may do with this, in plain words. */
  decision: ResearchDecision;
};

export type ResearchDecision = {
  articleEligible: boolean;
  productEligible: boolean;
  /** The strongest framing the evidence supports. */
  framing: "confirmed" | "reported" | "rumoured" | "insufficient";
  suggestedTitle: string | null;
  reasons: string[];
};

/**
 * How many of a query's distinctive words an item must carry to count.
 *
 * Deliberately high. A loose match floods the evidence set with items that
 * merely mention the same company, and an evidence set full of near-misses is
 * worse than an empty one — it looks like corroboration.
 */
export const MATCH_THRESHOLD = 0.6;

/**
 * Distinctive terms a query needs before it may be used as EVIDENCE matching.
 *
 * This exists because of a real failure caught on the first live run. The query
 * generator emits broad angles — "Apple", "iphone" — so that a story can be
 * found however an outlet led with it. But a one-term query scores a perfect
 * 1.00 against any item containing that term, so researching "iPhone 18"
 * matched "Apple's four-pack of AirTags is $20 off" at full strength and
 * reported six independent origins corroborating it.
 *
 * That is manufactured corroboration, and it is the worst thing this pipeline
 * could do: it converts "several outlets mention Apple" into "several outlets
 * confirm this claim".
 *
 * Broad queries remain useful for FINDING candidates; they are simply not
 * specific enough to prove two articles are about the same thing. Two terms is
 * the minimum at which a match means something — "iphone" plus "18", not
 * "apple" alone.
 */
export const MIN_QUERY_TERMS = 2;

const STOPWORDS = new Set([
  "the", "and", "for", "with", "from", "that", "this", "your", "what", "when",
  "will", "have", "here", "more", "than", "into", "over", "just", "about",
  "everything", "you", "need", "know", "now", "new", "how", "its", "are", "was",
]);

/**
 * The words in a query that carry meaning.
 *
 * NUMBERS ARE KEPT AT ANY LENGTH, and that is not a detail. The first version
 * filtered every token of two characters or fewer, which silently deleted the
 * single most distinctive part of most technology topics: the model number.
 * "The Witcher 4" became "witcher", "iPhone 18" became "iphone", "GTA 6" became
 * "gta". Every one then fell below MIN_QUERY_TERMS and matched nothing at all —
 * so the pipeline reported "no coverage exists" for stories that were sitting
 * in the corpus it had just downloaded.
 *
 * A wrong answer that looks like a principled refusal is the worst failure this
 * system can produce, because nothing about it looks broken.
 */
function distinctiveTerms(text: string): string[] {
  return [
    ...new Set(
      text
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter((w) => (w.length > 2 || /^\d+$/.test(w)) && !STOPWORDS.has(w))
    ),
  ];
}

/**
 * Score one item against one query.
 *
 * Returns the fraction of the query's distinctive terms present in the item's
 * title and summary. Symmetric scoring (Jaccard) was tried first and is wrong
 * here: a long article summary should not be penalised for containing words the
 * short query lacks.
 */
export function matchStrength(query: string, item: FeedItem): number {
  const terms = distinctiveTerms(query);
  if (terms.length === 0) return 0;
  const haystack = `${item.title} ${item.summary ?? ""}`.toLowerCase();
  const hits = terms.filter((t) => haystack.includes(t)).length;
  const coverage = hits / terms.length;

  // PROXIMITY IS REQUIRED, not merely rewarded.
  //
  // Bag-of-words coverage alone is too loose to be evidence, and the failure is
  // not hypothetical: researching "iPhone Ultra" matched an article headlined
  // "If these Galaxy S27 Ultra renders are accurate, Samsung can't stop Apple
  // copycat claims. iPhone..." — both terms present, entirely different
  // subject. It also matched "Apple Seeds watchOS 27 Beta", where "iPhone"
  // appears in a download instruction and "Ultra" in a watch model.
  //
  // Requiring the terms to occur CLOSE TOGETHER is what distinguishes "an
  // article about the iPhone Ultra" from "an article that happens to contain
  // both words". Single-term queries have nothing to be near, and are already
  // excluded from evidence matching by MIN_QUERY_TERMS.
  if (terms.length < 2) return coverage;
  return proximityOf(terms, haystack) ? coverage : 0;
}

/**
 * Whether the query's terms appear within a short window of each other.
 *
 * The window allows a few intervening words so "iPhone 18 Pro Max" still
 * matches a query of "iphone max", while "iPhone" in paragraph one and "Ultra"
 * in paragraph four does not.
 */
// Three words, not six. At six, "iPhone" and "18" co-occurring incidentally in
// a paragraph about the Apple Watch was enough to register as a match. A real
// product reference is adjacent or nearly so — "iPhone 18", "iPhone 18 Pro" —
// so tightening the window cuts coincidence without losing genuine mentions.
export const PROXIMITY_WINDOW_WORDS = 3;

export function proximityOf(terms: readonly string[], haystack: string): boolean {
  const words = haystack.replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);
  const positions = terms.map((t) =>
    words.reduce<number[]>((acc, w, i) => {
      if (w.includes(t)) acc.push(i);
      return acc;
    }, [])
  );
  // A term that appears nowhere cannot be near anything.
  if (positions.some((p) => p.length === 0)) return false;

  // Cheapest sufficient test: does some occurrence of the first term have an
  // occurrence of every other term within the window?
  return positions[0].some((anchor) =>
    positions
      .slice(1)
      .every((occurrences) => occurrences.some((p) => Math.abs(p - anchor) <= PROXIMITY_WINDOW_WORDS))
  );
}

/**
 * Find items across the indexed corpus that are about the same thing.
 *
 * One match per SOURCE is kept — the strongest. Three articles from one outlet
 * about one story are one voice, and keeping all three would inflate the
 * evidence set before lineage ever gets a chance to collapse it.
 */
export function findMatches(
  queries: readonly string[],
  corpus: readonly IndexedItem[],
  threshold = MATCH_THRESHOLD
): ResearchMatch[] {
  const bestBySource = new Map<string, ResearchMatch>();

  // Only queries specific enough to identify a STORY may match. See
  // MIN_QUERY_TERMS — this is the guard against "mentions Apple" being read as
  // "confirms this claim".
  const usable = queries.filter((q) => distinctiveTerms(q).length >= MIN_QUERY_TERMS);
  if (usable.length === 0) return [];

  for (const item of corpus) {
    let best: { query: string; strength: number } | null = null;
    for (const query of usable) {
      const strength = matchStrength(query, item);
      if (strength < threshold) continue;
      if (!best || strength > best.strength) best = { query, strength };
    }
    if (!best) continue;

    const key = item.source.organisation;
    const existing = bestBySource.get(key);
    if (!existing || best.strength > existing.strength) {
      bestBySource.set(key, { item, matchedQuery: best.query, strength: best.strength });
    }
  }

  return [...bestBySource.values()].sort((a, b) => b.strength - a.strength);
}

/**
 * Run the pipeline over one discovery against an already-fetched corpus.
 *
 * `originalUrl` and `originalPublisher` describe the discovery's own source, so
 * it participates in lineage alongside anything newly found — a vendor
 * announcement plus two outlets covering it is the case this must get right.
 */
export function researchDiscovery(input: {
  title: string;
  summary?: string | null;
  originalUrl?: string | null;
  originalPublisher?: string | null;
  originalIndependenceGroup?: string | null;
  subjectDomains?: readonly string[];
  aboutUnreleasedProduct?: boolean;
  corpus: readonly IndexedItem[];
  sourcesAttempted: string[];
  sourcesRead: string[];
  sourcesFailed: { organisation: string; reason: string }[];
}): ResearchResult {
  const subject = primarySubject(`${input.title} ${input.summary ?? ""}`);
  const queries = researchQueries(input.title, subject);
  // ONLY identifying queries may produce evidence. A topical match proves the
  // article is about the same company, not about the same claim.
  const matches = findMatches(identifyingQueries(queries), input.corpus);

  // Lineage over the discovery's own source plus everything found.
  const lineageInputs = [
    ...(input.originalUrl
      ? [
          {
            url: input.originalUrl,
            publisher: input.originalPublisher ?? null,
            text: `${input.title} ${input.summary ?? ""}`,
            independenceGroup: input.originalIndependenceGroup ?? null,
          },
        ]
      : []),
    ...matches.map((m) => ({
      url: m.item.link ?? "",
      publisher: m.item.source.organisation,
      text: `${m.item.title} ${m.item.summary ?? ""}`,
      independenceGroup: m.item.source.independenceGroup,
    })),
  ].filter((l) => l.url);

  const lineage = assessLineage(lineageInputs);

  // Claims from everything matched, plus the discovery's own text.
  const claims = [
    ...extractClaims(`${input.title}. ${input.summary ?? ""}`, { max: 6 }),
    ...matches.flatMap((m) => extractClaims(`${m.item.title}. ${m.item.summary ?? ""}`, { max: 4 })),
  ];
  const claimBreakdown = summariseClaims(claims);

  // Corroboration is assessed on ORIGINS, not URLs — which is the entire point
  // of running lineage first. Synthetic per-origin URLs are passed so the
  // existing model counts exactly the voices lineage established.
  const originUrls = lineage.nodes
    .filter((n) => n.role === "origin")
    .map((n) => `https://${n.domain}/`);
  const corroboration = assessCorroboration({
    sourceUrls: [
      ...originUrls,
      ...(input.subjectDomains ?? []).map((d) => `https://${d}/`).filter(() =>
        // Include the subject's own domain only if the discovery genuinely came
        // from it, so first-party authority is never granted retroactively.
        input.originalUrl ? (input.subjectDomains ?? []).some((d) => input.originalUrl!.includes(d)) : false
      ),
    ],
    subjectDomains: input.subjectDomains ?? [],
    claimStatus: "unverified",
    aboutUnreleasedProduct: input.aboutUnreleasedProduct ?? false,
  });

  return {
    subject,
    queries,
    sourcesAttempted: input.sourcesAttempted,
    sourcesRead: input.sourcesRead,
    sourcesFailed: input.sourcesFailed,
    matches,
    lineage,
    claims,
    claimBreakdown,
    corroboration,
    decision: decide({
      title: input.title,
      subject,
      lineage,
      claimBreakdown,
      corroboration,
      aboutUnreleasedProduct: input.aboutUnreleasedProduct ?? false,
    }),
  };
}

/**
 * What may be built from this.
 *
 * THE DISTINCTION THE OWNER ASKED FOR, made explicit: an article and a
 * catalogue product have different bars. Rumours about an unreleased phone can
 * justify a well-framed article long before they justify a canonical product
 * page — a product page asserts that a thing EXISTS with an identity, and an
 * empty one is worse than none.
 */
export function decide(input: {
  title: string;
  subject: SubjectMatch | null;
  lineage: LineageAssessment;
  claimBreakdown: ClaimBreakdown;
  corroboration: CorroborationVerdict;
  aboutUnreleasedProduct: boolean;
}): ResearchDecision {
  const origins = input.lineage.independentOrigins;
  const reasons: string[] = [];

  // ---- framing --------------------------------------------------------
  let framing: ResearchDecision["framing"];
  if (input.corroboration.claimClass === "first_party_announcement" && input.corroboration.sufficient) {
    framing = "confirmed";
    reasons.push("Announced by the subject itself, so what was announced can be stated plainly.");
  } else if (origins >= 2) {
    framing = "reported";
    reasons.push(
      `${origins} independent origins report this. Reportable with attribution, not as established fact.`
    );
  } else if (origins === 1) {
    framing = "rumoured";
    reasons.push(
      "One independent origin. Coverable only as an explicitly unconfirmed report, never as fact."
    );
  } else {
    framing = "insufficient";
    reasons.push("No independent origin found. There is nothing here that could be written honestly.");
  }

  // ---- article --------------------------------------------------------
  // One origin is ENOUGH for an article, provided the framing is honest. This
  // is the owner's rule: TechCarvalho may cover "Apple is reportedly working
  // on X" without waiting for Apple to confirm it.
  const articleEligible = framing !== "insufficient" && input.claimBreakdown.total >= 2;
  if (!articleEligible && framing !== "insufficient") {
    reasons.push(
      `Only ${input.claimBreakdown.total} extractable claim(s); at least 2 are needed to write something worth reading.`
    );
  }

  // ---- product --------------------------------------------------------
  // Strictly higher. A catalogue entry asserts identity, so it needs the
  // subject's own confirmation or several independent origins — and never a
  // rumour alone.
  const productEligible =
    framing === "confirmed" ||
    (framing === "reported" && origins >= 3 && !input.aboutUnreleasedProduct);
  if (!productEligible) {
    reasons.push(
      input.aboutUnreleasedProduct
        ? "No catalogue product: the maker has not confirmed this exists, and a product page asserts that it does."
        : "No catalogue product: identity is not established firmly enough, and specifications are never invented to fill one."
    );
  }

  return {
    articleEligible,
    productEligible,
    framing,
    suggestedTitle: articleEligible ? suggestTitle(input.title, input.subject, framing) : null,
    reasons,
  };
}

/**
 * A title that matches the evidence.
 *
 * The title is where a site most often over-claims, so it is derived from the
 * FRAMING rather than from the source headline. A rumour cannot produce a
 * headline that reads as confirmation, whatever the original said.
 */
export function suggestTitle(
  originalTitle: string,
  subject: SubjectMatch | null,
  framing: ResearchDecision["framing"]
): string | null {
  const name = subjectNoun(originalTitle, subject);
  switch (framing) {
    case "confirmed":
      return originalTitle;
    case "reported":
      return `${name}: what has been reported so far`;
    case "rumoured":
      return `${name} rumours: what is reported and what is still unknown`;
    case "insufficient":
      return null;
  }
}

function subjectNoun(title: string, subject: SubjectMatch | null): string {
  if (!subject) return title.split(/[:—-]/)[0].trim();
  // Prefer the specific alias as it appears in the title, capitalised as found.
  const idx = title.toLowerCase().indexOf(subject.matchedAlias);
  if (idx >= 0) {
    const found = title.slice(idx, idx + subject.matchedAlias.length);
    // Extend to include a trailing model number when present.
    const after = title.slice(idx + subject.matchedAlias.length).match(/^\s+\d+[A-Za-z]*/);
    return (found + (after ? after[0] : "")).trim();
  }
  return subject.organisation.name;
}
