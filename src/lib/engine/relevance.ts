// Consumer-tech relevance classification.
//
// Phase 3 showed the real failure mode: pointing the engine at official
// manufacturer newsrooms produces a flood of investor relations, stock
// offerings, executive appointments and corporate PR. Those are legitimate
// press releases; they are simply worthless to a consumer technology
// publication. Without a filter, the opportunity stage ends up ranking
// "Intel Announces Proposed $15 Billion Common Stock Offering".
//
// This stage is deliberately DETERMINISTIC — no AI, no API, no per-item cost.
// It is a scored keyword/pattern classifier, which is genuinely sufficient
// because the two classes are lexically very distinct (SEC/earnings vocabulary
// vs product vocabulary).
//
// Two design rules, both to avoid silently losing things:
//  1. Nothing is discarded. A rejected discovery is marked and kept, with the
//     reason, so an admin can inspect and override.
//  2. The decision carries an explanation naming the signals that produced it.

export type RelevanceVerdict = "relevant" | "rejected" | "uncertain";

export type RelevanceResult = {
  verdict: RelevanceVerdict;
  score: number;
  /** Signals that pushed the item toward consumer relevance. */
  positiveSignals: string[];
  /** Signals that pushed it toward corporate/irrelevant. */
  negativeSignals: string[];
  /** Best-guess content angle, used later to seed a brief. */
  suggestedAngle: ContentAngle | null;
  explanation: string;
};

export type ContentAngle =
  | "product_launch"
  | "hardware"
  | "software_update"
  | "compatibility"
  | "security"
  | "recall"
  | "bug_or_problem"
  | "performance"
  | "specifications"
  | "pricing"
  | "discontinuation"
  | "comparison"
  | "buying_question"
  | "emerging_tech"
  // Something a reader can go outside and photograph — an eclipse, an aurora,
  // a comet. Distinct from a product angle because the useful piece is a
  // planning guide, not a review.
  | "observable_event";

// Strong corporate/financial markers. These are heavily weighted because a
// single unambiguous hit (an SEC filing, an earnings call) is essentially
// conclusive — no consumer article comes out of it.
const HARD_NEGATIVE: { pattern: RegExp; label: string; weight: number }[] = [
  { pattern: /\b(common stock|stock offering|shares? outstanding|securities|prospectus|underwrit)/i, label: "stock/securities language", weight: 10 },
  { pattern: /\b(quarterly|annual) (results|earnings|report)\b|\bearnings (call|release|per share)\b|\bfiscal (year|quarter|q[1-4])\b/i, label: "earnings/financial reporting", weight: 10 },
  { pattern: /\b(sec filing|form 8-k|form 10-[kq]|proxy statement|shareholder|dividend|buyback|repurchase)\b/i, label: "regulatory/shareholder filing", weight: 10 },
  { pattern: /\b(appoints?|appointment|names? .{0,30}(ceo|cfo|coo|cto|president|chair|board)|joins? the board|steps? down|resign)/i, label: "executive appointment", weight: 8 },
  { pattern: /\b(acquisition|acquires?|merger|divest|joint venture|strategic partnership)\b/i, label: "corporate M&A", weight: 5 },
  { pattern: /\b(award|recognit|named a leader|ranked|celebrat|anniversary|sponsorship|charit|donat|scholarship|internship|career)/i, label: "corporate PR/awards", weight: 5 },
  { pattern: /\b(investor|analyst day|capital markets|guidance|outlook for the (year|quarter))\b/i, label: "investor communications", weight: 8 },
  // B2B / industrial / government-programme material. Production surfaced
  // these as genuine false positives: "Intel and Lens Technology Collaborate
  // to Enable Advanced Semiconductor Packaging" and "Intel Completes RAMP-C
  // Program" both scored positive off incidental spec vocabulary despite
  // having no consumer angle at all.
  { pattern: /\b(semiconductor packaging|foundry|fab(rication)? (plant|facility|capacity)|wafer|advanced packaging|process node roadmap)\b/i, label: "semiconductor manufacturing (B2B)", weight: 9 },
  { pattern: /\b(ramp-c|defen[cs]e program|government program|federal (contract|program)|consortium|industry alliance)\b/i, label: "government/industry programme", weight: 9 },
  { pattern: /\b(enterprise|data ?cent(er|re)|hyperscal|b2b|supply chain|oem partner|channel partner|workforce|manufacturing capacity)\b/i, label: "enterprise/industrial audience", weight: 7 },
  { pattern: /\bcollaborat(e|es|ion) (with|to)\b/i, label: "corporate collaboration framing", weight: 4 },
];

// Consumer-relevant signals, each mapped to the angle it implies.
const POSITIVE: { pattern: RegExp; label: string; weight: number; angle: ContentAngle }[] = [
  { pattern: /\b(launch|launches|launched|unveil|announces? the new|introduc|now available|goes on sale|release date|ships? (today|now))\b/i, label: "product launch language", weight: 6, angle: "product_launch" },
  { pattern: /\b(gpu|cpu|processor|graphics card|console|smartphone|laptop|handheld|headset|camera|lens|drone|router|ssd|monitor|motherboard)\b/i, label: "consumer hardware noun", weight: 5, angle: "hardware" },
  { pattern: /\b(firmware|driver|software update|patch|update \d|version \d|rolls? out|beta|os update)\b/i, label: "software/firmware update", weight: 5, angle: "software_update" },
  { pattern: /\b(compatib|supports?|works? with|interoperab|backwards? compatible|cross-?platform)\b/i, label: "compatibility change", weight: 4, angle: "compatibility" },
  { pattern: /\b(vulnerabilit|security (flaw|issue|update|advisory)|exploit|cve-|patch(ed)? a (flaw|bug)|malware|breach)\b/i, label: "consumer security issue", weight: 8, angle: "security" },
  { pattern: /\brecall(s|ed|ing)?\b|\bsafety (notice|warning|issue)\b|\bfire (risk|hazard)\b/i, label: "recall/safety", weight: 9, angle: "recall" },
  { pattern: /\b(bug|glitch|issue affecting|problem with|failing|failure rate|defect|crash(es|ing)?|overheat)\b/i, label: "consumer-facing fault", weight: 6, angle: "bug_or_problem" },
  { pattern: /\b(benchmark|performance (gain|improve|uplift|regression)|faster than|fps|frame rate|latency|throughput)\b/i, label: "performance claim", weight: 5, angle: "performance" },
  { pattern: /\b(spec|specification|mm|nm process|megapixel|\d+\s?(gb|tb|mhz|ghz|hz|w|mah|nits)\b)/i, label: "specification detail", weight: 4, angle: "specifications" },
  { pattern: /\b(price|pricing|costs?|\$\d|£\d|€\d|msrp|price (cut|increase|drop|rise))\b/i, label: "pricing information", weight: 5, angle: "pricing" },
  // No trailing \b here: several alternatives are deliberate prefixes
  // ("discontinu" must match "discontinues"/"discontinued"), and a trailing
  // word boundary would prevent exactly that.
  { pattern: /\b(discontinu|end of life|eol\b|no longer (available|supported)|sunset|retire[sd]?\b)/i, label: "discontinuation", weight: 6, angle: "discontinuation" },
  { pattern: /\b(vs\.?|versus|compared? (to|with)|difference between|which should you)\b/i, label: "comparison framing", weight: 5, angle: "comparison" },
  { pattern: /\b(worth it|should you (buy|upgrade)|best .{0,20}for|how to choose|buying guide)\b/i, label: "buying question", weight: 6, angle: "buying_question" },
  { pattern: /\b(wi-?fi \d|bluetooth \d|matter|thread|usb-?c|hdmi \d|pcie \d|ai pc|npu|on-?device ai)\b/i, label: "emerging consumer tech", weight: 5, angle: "emerging_tech" },
  // Consumer gaming/storefront activity — free play days, betas, pre-orders,
  // bundles, sales. Genuinely useful to readers, and previously scored zero
  // and rejected ("Intel Gamer Days 2026 ... AAA Gaming Bundle").
  { pattern: /\b(free play days|game pass|pre-?order|open beta|play the beta|now playable|gam(e|ing) bundle|gamer days)\b/i, label: "consumer gaming/storefront offer", weight: 7, angle: "buying_question" },
  { pattern: /\b(game|title|dlc|expansion|season pass)\b[\s\S]{0,30}\b(launch|release|available|out now|beta)\b/i, label: "game release", weight: 5, angle: "product_launch" },

  // --- Vocabulary added after measuring the classifier against the ten
  // non-vendor sources added on 2026-08-22. The lists above were tuned on
  // vendor product PR and scored genuine category news at zero:
  //   "VESA Introduces DisplayHDR True Black 1400"        -> 0, rejected
  //   "Webb Opens Treasure Chest"                          -> 0, rejected
  //   "Home Assistant 2026.8: Approachable by design"      -> 0, rejected
  // Each of those is real news for a category the site actively publishes in.

  // Observable sky events. The astrophotography category has 10 published
  // articles and two sources (NASA, ESA), and no way to recognise its news.
  {
    pattern: /\b(solar|lunar) eclipse\b|\baurora\b|\bnorthern lights\b|\bmeteor shower\b|\bcomet\b|\bsupermoon\b|\bconjunction\b|\boccultation\b|\bperseids?\b|\bgeminids?\b/i,
    label: "observable sky event", weight: 7, angle: "observable_event",
  },
  // Astronomy imaging subjects and gear.
  {
    pattern: /\b(telescope|observatory|nebula|galaxy|galaxies|star cluster|deep[- ]sky|exoplanet|webb|hubble|equatorial mount|star tracker|astrophotograph)/i,
    label: "astronomy subject or gear", weight: 5, angle: "hardware",
  },
  // Display technology. "monitor" was already a hardware noun, but the panel
  // vocabulary that actually carries display news was absent.
  {
    pattern: /\b(hdr\d*|displayhdr|oled|qd-?oled|mini-?led|micro-?led|refresh rate|displayport|adaptive-?sync|freesync|g-?sync|vrr|colour gamut|color gamut|panel|nits)\b/i,
    label: "display technology", weight: 5, angle: "specifications",
  },
  // Smart-home platform and ecosystem changes.
  {
    pattern: /\b(home assistant|homekit|smartthings|z-?wave|zigbee|works with|local control|automation|smart home hub|border router)\b/i,
    label: "smart-home ecosystem", weight: 5, angle: "compatibility",
  },
];

/** Above this, accept. Below the reject floor, reject. Between, uncertain. */
export const RELEVANCE_ACCEPT_THRESHOLD = 5;
export const RELEVANCE_REJECT_THRESHOLD = 0;

export function classifyRelevance(input: { title: string; summary?: string | null }): RelevanceResult {
  const text = `${input.title} ${input.summary ?? ""}`;

  const positiveSignals: string[] = [];
  const negativeSignals: string[] = [];
  const angleScores = new Map<ContentAngle, number>();
  let score = 0;

  for (const n of HARD_NEGATIVE) {
    if (n.pattern.test(text)) {
      score -= n.weight;
      negativeSignals.push(n.label);
    }
  }
  for (const p of POSITIVE) {
    if (p.pattern.test(text)) {
      score += p.weight;
      positiveSignals.push(p.label);
      angleScores.set(p.angle, (angleScores.get(p.angle) ?? 0) + p.weight);
    }
  }

  // A hardware noun alone is not enough: "Intel announces stock offering" also
  // contains "Intel". The corporate markers must actually be outweighed, which
  // the weighting above ensures (a single stock/earnings hit is -10).
  const suggestedAngle =
    [...angleScores.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  let verdict: RelevanceVerdict;
  if (score >= RELEVANCE_ACCEPT_THRESHOLD) verdict = "relevant";
  else if (score <= RELEVANCE_REJECT_THRESHOLD) verdict = "rejected";
  else verdict = "uncertain";

  return {
    verdict,
    score,
    positiveSignals,
    negativeSignals,
    suggestedAngle: verdict === "rejected" ? null : suggestedAngle,
    explanation: explain(verdict, score, positiveSignals, negativeSignals, suggestedAngle),
  };
}

function explain(
  verdict: RelevanceVerdict,
  score: number,
  pos: string[],
  neg: string[],
  angle: ContentAngle | null
): string {
  const parts: string[] = [`Relevance score ${score}.`];
  if (neg.length > 0) parts.push(`Corporate/non-consumer signals: ${neg.join("; ")}.`);
  if (pos.length > 0) parts.push(`Consumer-tech signals: ${pos.join("; ")}.`);
  if (pos.length === 0 && neg.length === 0) parts.push("No recognised signals either way.");

  if (verdict === "relevant") {
    parts.push(`Accepted as consumer-relevant${angle ? `, best angle "${angle}"` : ""}.`);
  } else if (verdict === "rejected") {
    parts.push("Rejected as not consumer-relevant. Kept for inspection — an admin can override.");
  } else {
    parts.push("Too weak to accept, too ambiguous to reject — left for human review.");
  }
  return parts.join(" ");
}
