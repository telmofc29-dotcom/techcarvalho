// Promotional-content detection.
//
// WHY THIS EXISTS
// ---------------
// Found by reading all 16 briefs the engine had actually produced. Every one of
// them was a vendor press release, and several were not even about products:
//
//   "Pre-order Call of Duty: Modern Warfare 4 and Play the Beta Today"
//   "Get closer to the game with Gemini and Pixel"
//   "Free Play Days - Train Sim World 6, Icarus: Console Edition"
//   "Universitas Gadjah Mada, Indosat and NVIDIA Open Indonesia's First
//    University AI Center to Develop Local AI Talent"
//
// The cause is structural rather than a bug. The discovery sources are
// manufacturer newsrooms, which is the correct choice for PRIMARY evidence —
// a vendor is the most reliable source for what a vendor is doing. But a
// newsroom publishes marketing alongside news, and the brief builder was
// taking the vendor's headline verbatim as the proposed article title. The
// result is a queue of press releases waiting to be republished.
//
// That is the "thin content" failure this publication explicitly rejects.
// Relevance does not catch it either: "Intel Gamer Days 2026 Kicking Off with
// AAA Gaming Bundle" is genuinely consumer-gaming relevant. It is relevant AND
// promotional, which are different axes.
//
// WHAT THIS DOES NOT DO
// ---------------------
// It does not decide a topic is uninteresting. A real launch announced in a
// press release is still a real launch. It flags copy written to sell rather
// than to inform, so the engine stops proposing that TechCarvalho reprint it.
//
// Deterministic. No AI provider.

type Rule = { pattern: RegExp; weight: number; label: string };

const PROMOTIONAL: Rule[] = [
  // Direct calls to action — the clearest marker of copy written to sell.
  { pattern: /\bpre-?order\b/i, weight: 10, label: "pre-order call to action" },
  { pattern: /\bbuy now\b|\bshop now\b|\border (yours|today)\b/i, weight: 10, label: "purchase call to action" },
  { pattern: /\bavailable now\b.*\b(from|for) [£$€]/i, weight: 8, label: "price-led availability push" },
  // Time-boxed promotions
  { pattern: /\bfree play days?\b/i, weight: 10, label: "time-limited promotion" },
  { pattern: /\b(gamer|prime|black friday|cyber monday) (days?|week)\b/i, weight: 9, label: "sales event" },
  { pattern: /\b(deal|sale|discount|save (up to )?\d+%|bundle offer)\b/i, weight: 7, label: "discount promotion" },
  { pattern: /\bgiveaway\b|\bsweepstakes?\b|\benter to win\b/i, weight: 10, label: "giveaway" },
  // Marketing register
  { pattern: /\blevels? up\b|\bsupercharge[sd]?\b|\bunleash(es|ed)?\b/i, weight: 6, label: "marketing verb" },
  // Second-person aspirational address ("Get closer to...", "Tap into...") is
  // advertising voice, not reporting voice. Weighted as a standalone marker
  // because a news headline essentially never addresses the reader this way.
  { pattern: /\bget closer to\b|\btap into\b|\bdive into\b|\bexperience the\b/i, weight: 8, label: "marketing address" },
  { pattern: /\bclass is in session\b|\bwe're excited\b|\bthrilled to\b/i, weight: 7, label: "promotional voice" },
  // Second-person imperative selling a named product: "Keep your SAT prep on
  // track with ... in Gemini", "Bring the Fire: Play Games on GeForce NOW
  // With ...". News headlines report what happened; they do not instruct the
  // reader to do something with a product.
  {
    // Anchored to the start OR to just after a colon, because the slogan
    // format hides the imperative behind one: "Best in Class: Stream PC Games
    // ... With GeForce NOW".
    pattern: /(?:^|:\s*)(keep|bring|stream|play|discover|meet|say hello to|make|turn|build)\b[^:]*\b(with|in|on|using)\b/i,
    weight: 8,
    label: "second-person product imperative",
  },
  // Colon-led slogan headline ("Best in Class:", "Bring the Fire:").
  { pattern: /\bbest in class\b|\bnext level\b|\bgame changer\b/i, weight: 7, label: "marketing superlative" },
  // Vendor explainer framing. Soft on its own — TechCarvalho legitimately uses
  // this format — but a real signal when combined with anything else.
  { pattern: /\beverything you need to know\b/i, weight: 5, label: "vendor explainer framing" },
  // Vendor developer-diary format.
  { pattern: /^inside the\b|\binside the (maps|world|making|design)\b/i, weight: 6, label: "vendor dev diary" },
  // Datacentre / AI-infrastructure PR. Not consumer technology in any form.
  { pattern: /\bai (factory|factories|cent(er|re))\b/i, weight: 9, label: "AI-infrastructure PR" },
  { pattern: /\b(largest|first) .*(facility|factory|cent(er|re))\b/i, weight: 8, label: "infrastructure milestone PR" },
  { pattern: /\bpartnership[s]?\b|\bcollaborat(es|ion)\b.*\bbrand\b/i, weight: 5, label: "brand partnership" },
  // Corporate/institutional PR that is not consumer tech at all
  { pattern: /\buniversity\b.*\b(center|centre)\b|\btalent\b|\bcurriculum\b/i, weight: 8, label: "institutional PR" },
  { pattern: /\bnow available for commercial use\b|\benterprise customers\b/i, weight: 7, label: "B2B availability" },
  { pattern: /\b(quarterly|fiscal) results?\b|\bearnings\b/i, weight: 10, label: "financial PR" },
  // Vendor listicle formats that carry no editorial judgement
  { pattern: /^next week on\b/i, weight: 8, label: "vendor schedule listicle" },
  { pattern: /^(this week|coming) (on|to)\b/i, weight: 7, label: "vendor schedule listicle" },
  { pattern: /\bnew games for\b .*\d/i, weight: 6, label: "vendor release calendar" },
];

/**
 * Score at or above which a brief should not be proposed for publication as
 * written. Set so a single strong marker (pre-order, giveaway, Free Play Days)
 * is enough, while one soft marketing verb is not.
 */
export const PROMOTIONAL_THRESHOLD = 8;

export type PromotionalVerdict = {
  score: number;
  isPromotional: boolean;
  matched: string[];
  explanation: string;
};

export function classifyPromotional(
  title: string,
  summary?: string | null
): PromotionalVerdict {
  // Weighted on the TITLE, because the title is what would become the article
  // headline. A summary quoting marketing copy is not the same problem.
  const matched: string[] = [];
  let score = 0;
  for (const rule of PROMOTIONAL) {
    if (rule.pattern.test(title)) {
      score += rule.weight;
      matched.push(rule.label);
    }
  }
  // The summary contributes at reduced weight AND under a hard cap, so it can
  // break a tie but can never on its own push a clean headline over the line.
  // Press releases routinely end with a "pre-order now" paragraph; that is a
  // fact about the source, not about whether the story is worth covering.
  if (summary) {
    let summaryScore = 0;
    for (const rule of PROMOTIONAL) {
      if (!matched.includes(rule.label) && rule.pattern.test(summary)) {
        summaryScore += Math.floor(rule.weight / 3);
      }
    }
    score += Math.min(summaryScore, PROMOTIONAL_THRESHOLD - 1);
  }

  const isPromotional = score >= PROMOTIONAL_THRESHOLD;
  return {
    score,
    isPromotional,
    matched,
    explanation: isPromotional
      ? `Reads as promotional copy rather than news (score ${score}: ${matched.join(", ") || "summary signals"}). ` +
        `The underlying event may still be worth covering, but not by reprinting the vendor's headline — ` +
        `it needs a reader question of our own.`
      : `No strong promotional markers (score ${score}). Treated as a genuine editorial opportunity.`,
  };
}

/**
 * Whether a proposed title is just the vendor's headline.
 *
 * A brief that copies the source headline verbatim has done no editorial work.
 * Even for a legitimate announcement, TechCarvalho's version should be framed
 * around what the reader wants to know.
 */
export function isVerbatimVendorHeadline(
  proposedTitle: string,
  sourceTitle: string | null | undefined
): boolean {
  if (!sourceTitle) return false;
  const norm = (s: string) =>
    s.toLowerCase().replace(/&#?\w+;/g, " ").replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
  return norm(proposedTitle) === norm(sourceTitle);
}
