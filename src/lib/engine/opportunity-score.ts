// OPPORTUNITY RANKING — why one story outranks another.
//
// WHAT WAS WRONG
// --------------
// assessPriority sums five coarse terms (tier, importance, recency, origins,
// coverage gap). Across 39 real production opportunities that produced THREE
// distinct values, and the ties were not close calls:
//
//   100    (PR) Apple Introduces New Mac Studio with M5 Max and M5 Ultra
//   100    Updated Apple Developer Program License Agreement now available
//   100    Crazy report reveals Exynos 2700 could outperform Snapdragon 8 Elite
//
//   94.64  Apple Reveals M6 as First-Ever 2nm Chip
//   94.64  Apple TV unveils Matthew McConaughey comedy series
//   94.64  Apple's Emergency SOS Live Video is now available in Brazil
//
//   91.96  Hot Chips 2026: Intel Xeon 7 'Diamond Rapids' comes with 256 P-cores
//   91.96  Minisforum Launches $1,800 M2 Pro Mini PC With Intel Arc B390 iGPU
//
// A one-source rumour tying with a confirmed first-party flagship launch is not
// a ranking. Neither is a licence agreement tying with new silicon.
//
// THE FOUR DIMENSIONS THAT ACTUALLY SEPARATE THEM
// -----------------------------------------------
// Each was chosen by reading the list above, not invented:
//
//   1. CONFIRMATION. "(PR) Apple Introduces" and "Crazy report reveals ...
//      could" are not the same kind of claim. assessPriority ignored this
//      entirely, which is how a rumour reached the top.
//   2. SIGNIFICANCE. A Mac Studio launch, a developer licence agreement and a
//      TV comedy series are not equally worth covering, whoever ships them.
//   3. CENTRALITY. In "Minisforum Launches Mini PC With Intel Arc", Intel is a
//      COMPONENT. The story is Minisforum's. Attributing it to Intel and then
//      ranking it beside Intel's own Xeon launch overstates it.
//   4. BREADTH. "available in Brazil" is a regional rollout of an existing
//      feature; a new iPad is a product launch.
//
// This EXTENDS assessPriority rather than replacing it: entity tier and event
// importance still come from there, and this adds what it cannot see.
//
// THE NUMBER IS AN ORDERING KEY, NOT A MEASUREMENT. It is never shown to
// readers, and the admin surfaces the REASONS. Nothing here estimates search
// volume, traffic or demand — none of which this project possesses.

import { assessPriority, type PriorityAssessment } from "./priority-entities.ts";

// ---------------------------------------------------------------------------
// Confirmation state — never collapsed
// ---------------------------------------------------------------------------

export type ConfirmationState =
  | "confirmed"
  | "announced"
  | "reported"
  | "rumour"
  | "speculation";

/**
 * Weight per state.
 *
 * The gap between `announced` and `rumour` is deliberately the largest single
 * step in this module. A rumour may be worth covering — hedged — but it must
 * never outrank a thing that demonstrably happened.
 */
const CONFIRMATION_WEIGHT: Record<ConfirmationState, number> = {
  confirmed: 1,
  announced: 0.85,
  reported: 0.6,
  rumour: 0.28,
  speculation: 0.12,
};

const SPECULATION_MARKERS = /\b(could|might|may|possibly|some believe|speculat\w*|what if|we think)\b/i;
const RUMOUR_MARKERS = /\b(rumou?r\w*|reportedly|allegedly|apparently|leak\w*|crazy report|is said to|claims? to|expected to|tipped to|purported\w*)\b/i;
// Pre-order language is an announcement: opening pre-orders is a company
// committing publicly to a product. Without it, "Mac Studio pre-orders are
// open" was classed `reported` and its timing was not assertable — plainly
// wrong for something you can already buy.
const ANNOUNCE_MARKERS = /\b(announce[sd]?|unveil[sed]*|introduce[sd]?|reveal[sed]*|launch(es|ed)?|debut[sed]*|now available|goes on sale|out now|ships?|pre[- ]?orders? (are |now )?(open|live|available))\b/i;

/**
 * Classify how certain a headline's claim is.
 *
 * `firstParty` comes from the corroboration layer — an evidence URL on the
 * subject's own domain — and is the only thing that earns `confirmed`. A
 * publisher writing "Apple announces" is reporting an announcement; the company
 * saying it is the announcement.
 */
export function classifyConfirmation(
  headline: string,
  options: { firstParty?: boolean } = {}
): { state: ConfirmationState; reason: string } {
  // Checked FIRST. "expected to launch" contains a launch verb, and reading
  // the announcement marker first would promote every rumour that mentions one.
  if (SPECULATION_MARKERS.test(headline) && RUMOUR_MARKERS.test(headline)) {
    return { state: "speculation", reason: "Hedged twice over — speculation about an unconfirmed report." };
  }
  if (RUMOUR_MARKERS.test(headline)) {
    return { state: "rumour", reason: "Reported as a rumour or leak, not as a confirmed development." };
  }
  if (SPECULATION_MARKERS.test(headline)) {
    return { state: "speculation", reason: "Speculative: describes what might happen, not what has." };
  }
  if (options.firstParty && ANNOUNCE_MARKERS.test(headline)) {
    return { state: "confirmed", reason: "Confirmed by the company itself, on its own channel." };
  }
  if (ANNOUNCE_MARKERS.test(headline)) {
    return { state: "announced", reason: "An announcement, reported by an independent publication." };
  }
  return { state: "reported", reason: "Reported as fact, without a first-party source." };
}

// ---------------------------------------------------------------------------
// Significance — what KIND of development this is
// ---------------------------------------------------------------------------

export type Significance =
  | "flagship_hardware"
  | "core_silicon"
  | "platform_software"
  | "product_variant"
  | "spec_or_performance"
  | "legal_or_regulatory"
  | "regional_rollout"
  | "commerce"
  | "corporate_admin"
  | "off_topic_media";

const SIGNIFICANCE_WEIGHT: Record<Significance, number> = {
  flagship_hardware: 1,
  core_silicon: 0.95,
  platform_software: 0.68,
  product_variant: 0.6,
  spec_or_performance: 0.5,
  legal_or_regulatory: 0.4,
  regional_rollout: 0.22,
  commerce: 0.16,
  corporate_admin: 0.08,
  off_topic_media: 0.04,
};

// Ordered: the first match wins, most specific first. Each pattern is anchored
// in a real headline from the production list.
const SIGNIFICANCE_RULES: readonly { kind: Significance; pattern: RegExp; why: string }[] = [
  // "Apple TV unveils Matthew McConaughey comedy series" — a TV commission is
  // not a technology development, whoever ships it.
  { kind: "off_topic_media", pattern: /\b(comedy|drama|series from|film|movie|season \d|streaming show|documentary|podcast)\b/i,
    why: "Entertainment programming rather than a technology development." },
  // "Updated Apple Developer Program License Agreement now available"
  { kind: "corporate_admin", pattern: /\b(licen[cs]e agreement|terms (of service|and conditions)|program agreement|privacy policy|earnings|quarterly results|appoints?|board of directors)\b/i,
    why: "Administrative or corporate paperwork, not a product development." },
  // "iPhone Trade-In Values Slide", "$300 Price Premium", and — found in the
  // ranked output — "Apple price hikes continue as Mac mini ... is now $899"
  // and "Here's Your Last Chance to Get a Nintendo Switch 2 for $399.99".
  // Both had ranked as flagship_hardware because they name a flagship product;
  // the product is what the story is ABOUT, not what kind of story it is.
  { kind: "commerce", pattern: /\b(trade[- ]in|price (premium|hike|hikes|rise|rises|cut|cuts|drop|drops|increase|increases)|discount|deal|sale price|cheaper|resale|voucher|last chance|now \$\d|for \$\d)\b/i,
    why: "A commerce or pricing story rather than a product development." },
  // "Apple's Emergency SOS Live Video is now available in Brazil"
  { kind: "regional_rollout", pattern: /\b(now available in|rolls? out (to|in)|expands? to|launches? in) (the )?[A-Z][a-z]+/,
    why: "A regional rollout of something that already exists." },
  { kind: "legal_or_regulatory", pattern: /\b(investigation|lawsuit|antitrust|regulator|court|fined?|settlement|subpoena)\b/i,
    why: "A legal or regulatory development." },
  // Checked BEFORE the product rules below. "Nintendo Announces First Switch 2
  // Bundles" matched the flagship rule on "Switch 2" and ranked as a console
  // launch; the story is a bundle of a console that already exists. A variant
  // marker describes the DEVELOPMENT, while the product name only says what
  // the development concerns.
  { kind: "product_variant", pattern: /\b(bundles?|anniversary|limited edition|colou?rway|variant|refresh|special edition)\b/i,
    why: "A variant or bundle of an existing product." },
  // "Apple Reveals M6 as First-Ever 2nm Chip", "Intel Xeon 7 Diamond Rapids"
  { kind: "core_silicon", pattern: /\b(\d+nm|silicon|soc\b|chipset|xeon|ryzen|core ultra|snapdragon|exynos|tensor|m\d+ (pro|max|ultra)\b|architecture|p-cores?|e-cores?)\b/i,
    why: "Core silicon: the component everything else in the category is built on." },
  // "Apple Introduces New Mac Studio", "New iPad Mini", "AMD RDNA 4m GPU"
  { kind: "flagship_hardware", pattern: /\b(mac (studio|mini|pro)|macbook|imac|ipad|iphone \d|galaxy s\d|pixel \d|rtx \d|radeon|geforce|playstation \d|xbox series|switch \d|eos r\d|nikon z\d|alpha a\d|mavic|osmo|x1 carbon|core one)\b/i,
    why: "A flagship hardware launch." },
  // "iOS 27 beta 7", "DLSS 4.5", "Nothing OS 5.0", "Windows 11 to Get..."
  { kind: "platform_software", pattern: /\b(ios \d|ipados|macos|watchos|android \d+|windows \d+|one ui|oxygenos|nothing os|dlss|fsr|firmware|driver|beta \d|update \d)\b/i,
    why: "A platform software release affecting a large installed base." },
  { kind: "spec_or_performance", pattern: /\b(benchmark|performance|fps\b|throughput|battery life|beats|outperform\w*|faster than)\b/i,
    why: "A specification or performance claim." },
];

export function classifySignificance(headline: string): { kind: Significance; why: string } {
  for (const rule of SIGNIFICANCE_RULES) {
    if (rule.pattern.test(headline)) return { kind: rule.kind, why: rule.why };
  }
  return { kind: "spec_or_performance", why: "A development with no clearer classification." };
}

// ---------------------------------------------------------------------------
// Centrality — is the watched company the SUBJECT, or a component?
// ---------------------------------------------------------------------------

/**
 * True when the entity is the actor of the headline rather than a part inside
 * somebody else's product.
 *
 * "Minisforum Launches $1,800 Mini PC With Intel Arc B390" is Minisforum's
 * story. Ranking it beside Intel's own Xeon launch, under Intel, overstates it
 * by a wide margin — and that tie is in the production data.
 */
export function isSubjectOfHeadline(headline: string, aliases: readonly string[]): boolean {
  const text = headline.replace(/^\(PR\)\s*/i, "").trim();
  // Everything before the first verb-ish break is the subject region. Cheap and
  // good enough: a company named after "with", "featuring", "powered by" or
  // "using" is a component, and one named at the start is the actor.
  // A PLATFORM LIST IS NOT AN ACTOR EITHER.
  //
  // "(PR) Focus Entertainment Unveils Elta ... Set for 2027 Release on PC,
  // PlayStation & Xbox" was attributed to Microsoft as the SUBJECT. Xbox is
  // named, but as a platform the game ships on — the story is Focus
  // Entertainment's. "on"/"for" alone are too common to use ("Apple on Tuesday
  // announced"), so only the release-target phrasings are listed.
  const componentMarker =
    /\b(with|featuring|powered by|using|inside|based on|equipped with|packs?|release on|releases on|available on|coming to|launch(es|ing)? on|out on|ships? on)\b/i;
  const idx = text.search(componentMarker);
  const subjectRegion = idx > 0 ? text.slice(0, idx) : text;
  return aliases.some((a) => {
    const p = new RegExp(`(^|[^a-z0-9])${a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`, "i");
    return p.test(subjectRegion);
  });
}

// ---------------------------------------------------------------------------
// The model
// ---------------------------------------------------------------------------

/**
 * Component weights. They sum to 1, so the score is a weighted mean of values
 * that are each already 0..1 — which is what gives it fine granularity instead
 * of the three buckets the additive model produced.
 *
 * Significance and confirmation carry the most because they are what the old
 * model was blind to. Entity tier is deliberately NOT dominant: the owner's
 * rule is that priority buys attention, not indulgence, so a tier 1 company's
 * licence agreement must still lose to a tier 2 company's flagship launch.
 */
export const WEIGHTS = {
  significance: 0.28,
  confirmation: 0.22,
  entityPriority: 0.18,
  centrality: 0.12,
  freshness: 0.08,
  evidence: 0.07,
  coverageGap: 0.05,
} as const;

export type ScoreComponent = { name: keyof typeof WEIGHTS; value: number; weight: number; why: string };

export type OpportunityRanking = {
  /** 0..100, two decimal places. An ordering key, never a measurement. */
  score: number;
  confirmation: ConfirmationState;
  significance: Significance;
  isSubject: boolean;
  components: ScoreComponent[];
  /** One human sentence naming the two strongest reasons. */
  summary: string;
  /** The underlying priority assessment, unchanged. */
  priority: PriorityAssessment;
};

function tierValue(tier: number | null): number {
  if (tier === 1) return 1;
  if (tier === 2) return 0.62;
  if (tier === 3) return 0.3;
  return 0.12;
}

function freshnessValue(ageDays: number | undefined): number {
  if (ageDays === undefined) return 0.4;
  if (ageDays <= 1) return 1;
  if (ageDays <= 3) return 0.85;
  if (ageDays <= 7) return 0.6;
  if (ageDays <= 14) return 0.35;
  if (ageDays <= 30) return 0.2;
  return 0.08;
}

function evidenceValue(origins: number | undefined): number {
  const n = origins ?? 1;
  if (n >= 5) return 1;
  if (n === 4) return 0.88;
  if (n === 3) return 0.74;
  if (n === 2) return 0.55;
  return 0.3;
}

export function rankOpportunity(input: {
  headline: string;
  /** Aliases of the entity this opportunity is attributed to. */
  entityAliases?: readonly string[];
  ageDays?: number;
  independentOrigins?: number;
  alreadyCovered?: boolean;
  /** An evidence URL on the subject's own domain. Only this earns `confirmed`. */
  firstParty?: boolean;
}): OpportunityRanking {
  const priority = assessPriority({
    headline: input.headline,
    ageDays: input.ageDays,
    independentOrigins: input.independentOrigins,
    alreadyCovered: input.alreadyCovered,
  });

  const confirmation = classifyConfirmation(input.headline, { firstParty: input.firstParty });
  const significance = classifySignificance(input.headline);
  const isSubject = input.entityAliases
    ? isSubjectOfHeadline(input.headline, input.entityAliases)
    : true;

  const tier = priority.tier;

  const components: ScoreComponent[] = [
    { name: "significance", value: SIGNIFICANCE_WEIGHT[significance.kind], weight: WEIGHTS.significance, why: significance.why },
    { name: "confirmation", value: CONFIRMATION_WEIGHT[confirmation.state], weight: WEIGHTS.confirmation, why: confirmation.reason },
    { name: "entityPriority", value: tierValue(tier), weight: WEIGHTS.entityPriority,
      why: tier ? `Tier ${tier} watchlist entity.` : "Not a watchlist entity." },
    { name: "centrality", value: isSubject ? 1 : 0.3, weight: WEIGHTS.centrality,
      why: isSubject ? "The company is the subject of the story." : "The company is a component in somebody else's product." },
    { name: "freshness", value: freshnessValue(input.ageDays), weight: WEIGHTS.freshness,
      why: input.ageDays === undefined ? "Publication date unknown." : `About ${Math.round(input.ageDays)} day(s) old.` },
    { name: "evidence", value: evidenceValue(input.independentOrigins), weight: WEIGHTS.evidence,
      why: `${input.independentOrigins ?? 1} independent origin(s).` },
    { name: "coverageGap", value: input.alreadyCovered ? 0 : 1, weight: WEIGHTS.coverageGap,
      why: input.alreadyCovered ? "TechCarvalho already covers this." : "TechCarvalho has no coverage of it." },
  ];

  const raw = components.reduce((sum, c) => sum + c.value * c.weight, 0);
  const score = Math.round(raw * 100 * 100) / 100;

  // The two components contributing most, so the explanation names what
  // actually drove the ranking rather than restating the inputs.
  const top = [...components].sort((a, b) => b.value * b.weight - a.value * a.weight).slice(0, 2);
  const summary = top.map((c) => c.why).join(" ");

  return { score, confirmation: confirmation.state, significance: significance.kind, isSubject, components, summary, priority };
}
