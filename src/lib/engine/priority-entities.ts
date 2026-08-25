// EDITORIAL PRIORITY — which companies TechCarvalho watches closely.
//
// WHY THIS IS NOT "TRENDING"
// --------------------------
// This is a CONFIGURATION, not a measurement. It is legitimate to say "Samsung
// is a high-priority coverage entity for TechCarvalho" because that is an
// editorial decision somebody made. It would not be legitimate to say "Samsung
// is trending" without data this site does not have, and the two must never be
// allowed to blur — a priority tier is an opinion about what matters, and a
// popularity figure is a claim about the world.
//
// So nothing here produces a number that looks like demand. Tiers are named,
// the reason travels with the score, and the owner sees the reason.
//
// WHY THE PREVIOUS RUN MISSED MAJOR COMPANIES
// -------------------------------------------
// The expansion pass searched for fixed subject strings — "Samsung Galaxy",
// "AMD Ryzen", "Apple iPhone" — and got NO_COVERAGE for nearly all of them.
// Not because nothing was happening, but because a brand-only query is
// TOPICAL: it identifies a company, not a story, and the matcher correctly
// refuses to treat "mentions Samsung" as "is about this development".
//
// The fix is to invert the search. Instead of asking "is there a story called
// 'Samsung Galaxy'?", ask "what is the corpus saying about Samsung, and which
// of those are we not covering?". That is what entity-driven discovery does,
// and it is why this file exists rather than a longer subject list.
//
// PURE. No `server-only`, no Supabase, no network.

export type PriorityTier = 1 | 2 | 3;

export const TIER_LABELS: Record<PriorityTier, string> = {
  1: "Watch closely",
  2: "Important",
  3: "Normal",
};

export type PriorityEntity = {
  name: string;
  tier: PriorityTier;
  /** Names and product lines that indicate this entity. Matched word-boundary. */
  aliases: string[];
  /** Taxonomy slugs this entity's developments usually belong to. */
  categories: string[];
};

/**
 * The watchlist.
 *
 * Tier 1 is deliberately small: companies whose product cycles ARE the beat
 * this site covers. A tier that contains everything prioritises nothing.
 *
 * Data, not logic — the scoring below reads this table, so adding an entity is
 * a one-line change and needs no code.
 */
export const PRIORITY_ENTITIES: readonly PriorityEntity[] = [
  // ---- Tier 1: the beat --------------------------------------------------
  { name: "Apple", tier: 1, aliases: ["apple", "iphone", "ipad", "macbook", "ios", "airpods", "apple watch", "vision pro"], categories: ["smartphones", "computing"] },
  { name: "Samsung", tier: 1, aliases: ["samsung", "galaxy", "one ui", "exynos"], categories: ["smartphones"] },
  { name: "Google", tier: 1, aliases: ["google", "pixel", "android", "gemini", "tensor"], categories: ["smartphones", "ai-hardware"] },
  { name: "Microsoft", tier: 1, aliases: ["microsoft", "windows", "surface", "copilot", "xbox"], categories: ["computing", "gaming"] },
  { name: "NVIDIA", tier: 1, aliases: ["nvidia", "geforce", "rtx", "dlss", "blackwell", "cuda"], categories: ["computing", "gaming", "ai-hardware"] },
  { name: "AMD", tier: 1, aliases: ["amd", "ryzen", "radeon", "epyc", "fsr", "threadripper"], categories: ["computing", "gaming"] },
  { name: "Intel", tier: 1, aliases: ["intel", "core ultra", "xeon", "arc"], categories: ["computing"] },
  { name: "Canon", tier: 1, aliases: ["canon", "eos", "powershot"], categories: ["cameras-photography", "camera-lenses"] },
  { name: "Nikon", tier: 1, aliases: ["nikon", "nikkor", "coolpix"], categories: ["cameras-photography", "camera-lenses"] },
  { name: "Sony", tier: 1, aliases: ["sony", "playstation", "ps5", "dualsense", "bravia", "alpha a7", "xperia"], categories: ["cameras-photography", "gaming"] },
  { name: "Nintendo", tier: 1, aliases: ["nintendo", "switch 2", "zelda", "mario"], categories: ["gaming"] },
  { name: "Valve", tier: 1, aliases: ["valve", "steam deck", "steamos", "steam machine", "half-life"], categories: ["gaming"] },
  { name: "DJI", tier: 1, aliases: ["dji", "mavic", "osmo", "avata"], categories: ["drones-fpv", "action-cameras"] },
  { name: "Tesla", tier: 1, aliases: ["tesla", "optimus"], categories: ["smart-home-robots"] },
  { name: "Bambu Lab", tier: 1, aliases: ["bambu lab", "bambulab", "x1 carbon", "ams"], categories: ["3d-printing"] },
  { name: "Creality", tier: 1, aliases: ["creality", "ender"], categories: ["3d-printing"] },
  { name: "OpenAI", tier: 1, aliases: ["openai", "chatgpt", "gpt-5", "sora"], categories: ["ai-hardware"] },

  // ---- Tier 2: regular meaningful developments ---------------------------
  { name: "Qualcomm", tier: 2, aliases: ["qualcomm", "snapdragon"], categories: ["smartphones", "computing"] },
  // "arm" alone cannot be an alias: it would match "robotic arm" in every
  // robotics story and silently attribute them to the chip designer. These
  // multi-word forms cover how the company actually appears in headlines
  // ("Arm and UNICEF launch...", "Arm's next core") without that collision.
  { name: "ARM", tier: 2, aliases: ["arm holdings", "arm cortex", "arm ltd", "armv9", "neoverse", "cortex-x", "arm and", "arm's", "arm announces", "arm unveils", "arm launches", "arm reveals", "arm-based", "arm architecture", "arm chip", "arm cpu"], categories: ["computing", "ai-hardware"] },
  { name: "ASUS", tier: 2, aliases: ["asus", "rog"], categories: ["computing", "networking"] },
  { name: "MSI", tier: 2, aliases: ["msi"], categories: ["computing"] },
  { name: "Gigabyte", tier: 2, aliases: ["gigabyte", "aorus"], categories: ["computing"] },
  { name: "Corsair", tier: 2, aliases: ["corsair", "icue", "elgato", "vengeance"], categories: ["computing", "gaming"] },
  { name: "Western Digital", tier: 2, aliases: ["western digital", "sandisk", "wd_black", "wd black", "ultrastar"], categories: ["computing"] },
  { name: "Seagate", tier: 2, aliases: ["seagate", "ironwolf", "barracuda", "exos"], categories: ["computing"] },
  { name: "Fujifilm", tier: 2, aliases: ["fujifilm", "fujinon"], categories: ["cameras-photography"] },
  { name: "Panasonic", tier: 2, aliases: ["panasonic", "lumix"], categories: ["cameras-photography"] },
  { name: "Sigma", tier: 2, aliases: ["sigma"], categories: ["camera-lenses"] },
  { name: "Tamron", tier: 2, aliases: ["tamron"], categories: ["camera-lenses"] },
  { name: "GoPro", tier: 2, aliases: ["gopro", "hero13", "hero 13", "hero14", "max 2"], categories: ["action-cameras"] },
  { name: "Insta360", tier: 2, aliases: ["insta360", "insta 360", "ace pro", "x5"], categories: ["action-cameras", "drones-fpv"] },
  { name: "Meta", tier: 2, aliases: ["meta platforms", "quest 3", "ray-ban meta"], categories: ["ai-hardware", "smart-home-robots"] },
  // Added 2026-08-25. Named on the owner's watchlist but absent from this
  // table, so their developments were never even measured as gaps.
  { name: "Xiaomi", tier: 2, aliases: ["xiaomi", "redmi", "poco", "hyperos"], categories: ["smartphones"] },
  { name: "OnePlus", tier: 2, aliases: ["oneplus", "oxygenos"], categories: ["smartphones"] },
  { name: "Nothing", tier: 2, aliases: ["nothing phone", "nothing ear", "nothing os", "cmf by nothing"], categories: ["smartphones"] },
  { name: "Dell", tier: 2, aliases: ["dell", "alienware", "xps laptop"], categories: ["computing"] },
  { name: "HP", tier: 2, aliases: ["hp inc", "omen", "hp spectre", "hp envy"], categories: ["computing"] },
  { name: "Lenovo", tier: 2, aliases: ["lenovo", "thinkpad", "legion go", "yoga laptop"], categories: ["computing"] },
  { name: "Anthropic", tier: 2, aliases: ["anthropic", "claude"], categories: ["ai-hardware"] },
  { name: "Boston Dynamics", tier: 2, aliases: ["boston dynamics", "atlas robot", "spot robot"], categories: ["smart-home-robots"] },
  { name: "Figure", tier: 2, aliases: ["figure ai", "figure 03", "figure robot", "helix"], categories: ["smart-home-robots"] },
  { name: "Amazon", tier: 2, aliases: ["amazon devices", "alexa", "echo show", "kindle"], categories: ["smart-home-robots"] },
  { name: "TP-Link", tier: 2, aliases: ["tp-link", "tplink", "deco", "omada", "tapo"], categories: ["networking", "computing"] },
  { name: "Netgear", tier: 2, aliases: ["netgear", "orbi", "nighthawk"], categories: ["networking", "computing"] },
  { name: "Ubiquiti", tier: 2, aliases: ["ubiquiti", "unifi", "ui.com", "amplifi"], categories: ["networking", "computing"] },
  { name: "Prusa", tier: 2, aliases: ["prusa"], categories: ["3d-printing"] },
  { name: "Anycubic", tier: 2, aliases: ["anycubic"], categories: ["3d-printing"] },
  { name: "Elegoo", tier: 2, aliases: ["elegoo", "neptune"], categories: ["3d-printing"] },
  { name: "UltiMaker", tier: 2, aliases: ["ultimaker", "cura", "makerbot", "method xl"], categories: ["3d-printing"] },
  { name: "Autel", tier: 2, aliases: ["autel robotics", "autel", "evo lite", "evo max"], categories: ["drones-fpv"] },
] as const;

// ---------------------------------------------------------------------------
// Event importance
// ---------------------------------------------------------------------------

export type EventImportance = "major" | "notable" | "routine" | "trivial";

export const IMPORTANCE_LABELS: Record<EventImportance, string> = {
  major: "Major development",
  notable: "Notable development",
  routine: "Routine",
  trivial: "Low interest",
};

/**
 * Signals of a genuinely significant development.
 *
 * Matched against the headline, which is what an outlet chose to lead with.
 * Deliberately about the KIND of event rather than about how excited the
 * writing is: "unveils", "launches" and "discontinues" describe things that
 * happened, whereas "amazing" and "you won't believe" describe the writer.
 */
const MAJOR_SIGNALS: readonly RegExp[] = [
  /\b(launch(es|ed)?|unveil(s|ed)?|announc(e|es|ed)|introduc(e|es|ed)|reveal(s|ed))\b/i,
  /\b(next[- ]gen(eration)?|new generation|flagship|successor)\b/i,
  // "arrives" and "hits shelves" are how availability is usually phrased in a
  // headline, and their absence classified a console launch as routine.
  /\b(release date|now available|goes on sale|ships?|arrives?|hits shelves|out now)\b/i,
  /\b(discontinu(e|es|ed)|end of (life|support)|recall)\b/i,
  /\b(acquisition|acquires|merger)\b/i,
];

const NOTABLE_SIGNALS: readonly RegExp[] = [
  /\b(update|updates|updated|firmware|patch|version \d)\b/i,
  /\b(price|pricing|cost|cheaper|increase)\b/i,
  /\b(benchmark|performance|tested|review)\b/i,
  /\b(support|compatibility|adds?)\b/i,
];

// A COMPANY'S NEWSROOM IS NOT ONLY PRODUCT NEWS.
//
// Registering first-party newsrooms made a company's own announcements
// publishable on one source, which is correct. It also let in everything ELSE
// those newsrooms publish. One run produced "Samsung Electronics Announces
// Second Quarter 2026 Results", "Intel Announces Leadership Appointment" and
// "Samsung Announces Addition of Louvre Collection to Samsung Art Store" as
// technology drafts.
//
// These are real, corroborated announcements. They are simply not the kind of
// development this publication covers, so they are classified ROUTINE: still
// visible in reports, never drafted unattended.
const CORPORATE_SIGNALS: readonly RegExp[] = [
  /\b(quarterly|full[- ]year|first|second|third|fourth) (quarter|half)\b/i,
  /\b(q[1-4] \d{4}|earnings|revenue|dividend|shareholder|stock offering|share buyback|fiscal year|financial results)\b/i,
  /\b(appoints?|appointment|names? .{0,24}\b(ceo|cfo|cto|president)|board of directors|steps down|resigns)\b/i,
  /\b(lawsuit|settlement|antitrust|files? suit|court ruling)\b/i,
];

// SUBJECTS OUTSIDE WHAT THIS PUBLICATION COVERS.
//
// Samsung and LG announce large-appliance and television products through the
// same newsroom as their phones. A microwave is a genuine Samsung launch and
// still has no place here.
const OFF_TOPIC_SIGNALS: readonly RegExp[] = [
  /\b(microwave|refrigerator|fridge|washing machine|dishwasher|oven|air conditioner|vacuum cleaner|dryer)\b/i,
  /\b(art store|collection to|gallery|fashion|apparel|cookware|furniture)\b/i,
];

const TRIVIAL_SIGNALS: readonly RegExp[] = [
  /\b(deal|deals|discount|sale|save \$|% off|coupon|bundle)\b/i,
  // Retail-promotion phrasing that names no price and so escaped the rule
  // above. "Stock up on Seagate hard drives" became a draft: it is shopping
  // advice, not a development, whatever company it names.
  // "on sale" is deliberately NOT here. It means both "discounted" and
  // "available to buy", and the launch rule below already claims the second
  // sense with "goes on sale" — listing it as a promotion would reclassify
  // genuine availability announcements as shopping posts.
  /\b(stock up|lowest price|best price|price drop|prime day|black friday|cyber monday|shop |buy now|grab )\b/i,
  /\b(giveaway|sweepstake|contest)\b/i,
  /\b(rumou?r roundup|week in review|best of|top \d+)\b/i,
  /\b(sponsored|partnership|celebrates)\b/i,
  // FIRST-PERSON OPINION COLUMNS ARE NOT DEVELOPMENTS.
  //
  // "It Took Apple 8 Years to Listen to Me" contains a major-sounding verb and
  // is a personal essay. It reached a created draft before this rule existed,
  // which is exactly the kind of thin filler an unattended run must not make.
  /(^|\s)(i|i'?ve|i'?m|my|me|we)(\s|$|[,.!?])/i,
  /^(why|how) i\b/i,
  /\b(opinion|editorial|column|rant|hands[- ]on)\b/i,
  // ANOTHER OUTLET'S REVIEW IS NOT A DEVELOPMENT TECHCARVALHO CAN COVER.
  //
  // A review is the outlet's own testing. TechCarvalho has not handled the
  // hardware, so there is nothing here it can honestly say — and drafting from
  // one would put someone else's measured results behind our byline, which the
  // no-fabricated-testing rule forbids outright. The product's LAUNCH is a
  // development; the review of it is not.
  /\b(review|reviewed|unboxing|teardown|benchmarked|we tested|tested it)\b/i,
];

export function classifyImportance(headline: string): {
  importance: EventImportance;
  reason: string;
} {
  // Trivial is checked FIRST: "Save $200 on the new flagship" contains a major
  // signal and is still a deal post. What the piece IS matters more than what
  // it mentions.
  for (const p of TRIVIAL_SIGNALS) {
    if (p.test(headline)) {
      return { importance: "trivial", reason: "Reads as a deal, promotion or roundup rather than a development." };
    }
  }
  for (const p of OFF_TOPIC_SIGNALS) {
    if (p.test(headline)) {
      return { importance: "trivial", reason: "A real announcement, but outside the subjects this publication covers." };
    }
  }
  // Checked before MAJOR_SIGNALS: "Samsung Electronics Announces Second
  // Quarter 2026 Results" contains "announces" and would otherwise read as a
  // major product development.
  for (const p of CORPORATE_SIGNALS) {
    if (p.test(headline)) {
      return { importance: "routine", reason: "Corporate, financial or personnel news rather than a product development." };
    }
  }
  for (const p of MAJOR_SIGNALS) {
    if (p.test(headline)) {
      return { importance: "major", reason: "Describes a launch, announcement, availability change or end of life." };
    }
  }
  for (const p of NOTABLE_SIGNALS) {
    if (p.test(headline)) {
      return { importance: "notable", reason: "Describes an update, price change or measured performance." };
    }
  }
  return { importance: "routine", reason: "No signal of a significant development in the headline." };
}

// ---------------------------------------------------------------------------
// Entity resolution
// ---------------------------------------------------------------------------

export function entitiesIn(text: string): PriorityEntity[] {
  const haystack = ` ${text.toLowerCase().replace(/[^a-z0-9\s.-]/g, " ").replace(/\s+/g, " ")} `;
  const found: PriorityEntity[] = [];
  for (const entity of PRIORITY_ENTITIES) {
    const hit = entity.aliases.some((a) => {
      const pattern = new RegExp(`(^|[^a-z0-9])${a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`);
      return pattern.test(haystack);
    });
    if (hit) found.push(entity);
  }
  return found.sort((a, b) => a.tier - b.tier || a.name.localeCompare(b.name));
}

export function highestTier(text: string): PriorityTier {
  return entitiesIn(text)[0]?.tier ?? 3;
}

// ---------------------------------------------------------------------------
// Combined scoring
// ---------------------------------------------------------------------------

const TIER_WEIGHT: Record<PriorityTier, number> = { 1: 40, 2: 20, 3: 0 };
const IMPORTANCE_WEIGHT: Record<EventImportance, number> = {
  major: 35,
  notable: 15,
  routine: 0,
  // Negative: a deal post about a Tier 1 company should rank BELOW a genuine
  // development from a Tier 3 one. Priority buys attention, not indulgence.
  trivial: -45,
};

export type PriorityAssessment = {
  entities: PriorityEntity[];
  tier: PriorityTier;
  importance: EventImportance;
  /** Ordering weight. Never displayed as a metric — it is not a measurement. */
  score: number;
  /** Why this was surfaced, in plain words, for the owner. */
  reason: string;
  /** True when it should skip the ordinary queue and be looked at now. */
  urgent: boolean;
};

/**
 * Combine editorial priority with event importance and evidence.
 *
 * `ageDays` and `independentOrigins` are the only inputs here that describe the
 * world; everything else is configuration. That separation is deliberate, and
 * `reason` names which part did the work so a high rank is never mysterious.
 */
export function assessPriority(input: {
  headline: string;
  ageDays?: number;
  independentOrigins?: number;
  alreadyCovered?: boolean;
}): PriorityAssessment {
  const entities = entitiesIn(input.headline);
  const tier = entities[0]?.tier ?? 3;
  const { importance, reason: importanceReason } = classifyImportance(input.headline);

  let score = TIER_WEIGHT[tier] + IMPORTANCE_WEIGHT[importance];

  const age = input.ageDays ?? 0;
  if (age <= 2) score += 20;
  else if (age <= 7) score += 10;
  else if (age > 30) score -= 15;

  score += Math.min(input.independentOrigins ?? 0, 4) * 6;

  // A gap is the whole point: a major development from a watched company that
  // this site has not touched is the most valuable thing the engine can find.
  if (input.alreadyCovered === false) score += 15;
  if (input.alreadyCovered === true) score -= 30;

  const parts: string[] = [];
  if (entities.length > 0) {
    parts.push(
      `${TIER_LABELS[tier]} entity (${entities.slice(0, 3).map((e) => e.name).join(", ")}).`
    );
  } else {
    parts.push("No watchlist entity named in the headline.");
  }
  parts.push(importanceReason);
  if (input.alreadyCovered === false) parts.push("TechCarvalho has no coverage of it.");
  if (input.alreadyCovered === true) parts.push("TechCarvalho already covers this.");

  return {
    entities,
    tier,
    importance,
    score,
    reason: parts.join(" "),
    // Urgent means "look at this before the ordinary queue", and requires all
    // three: a watched company, a real development, and a gap in our coverage.
    urgent: tier === 1 && importance === "major" && input.alreadyCovered === false,
  };
}

/** Tier 1 and 2 entity names, for callers that want the watchlist itself. */
export function watchlist(tier?: PriorityTier): PriorityEntity[] {
  return PRIORITY_ENTITIES.filter((e) => tier === undefined || e.tier === tier);
}
