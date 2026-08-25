// WHICH SECTION DOES THIS DEVELOPMENT BELONG IN?
//
// The scanner used `entity.categories[0]` — the FIRST category of whichever
// company was matched. Apple's first category is "smartphones", so every Mac
// Studio, Mac mini, iPad and MacBook story was filed under smartphones. A dozen
// drafts landed in the wrong section, and the section counts that guide the
// next run were wrong with them.
//
// A company does not have a category. A DEVELOPMENT does. Sony makes cameras,
// televisions and a games console; Samsung makes phones, displays and storage;
// Apple makes phones and desktop computers. Reading the category off the
// company is guessing with extra steps.
//
// So: match the subject against product vocabulary, and use the company's
// categories only to break ties and as a last resort. The entity's own
// categories still constrain the answer — a Canon headline cannot be filed
// under 3D printing just because it says "printer".

/** Ordered most-specific first: the first rule that matches a subject wins. */
const CATEGORY_RULES: readonly { category: string; pattern: RegExp }[] = [
  // --- 3D printing (before "printer" can be read as an office device) ------
  { category: "3d-printing", pattern: /\b(3d[- ]print\w*|filament|pla\b|petg|abs filament|resin print\w*|slicer|fdm|sla print\w*|extruder|print bed|nozzle|bambu|prusa|elegoo|anycubic|creality|ultimaker|makerbot|cura)\b/i },

  // --- Cameras and lenses --------------------------------------------------
  { category: "camera-lenses", pattern: /\b(lens|lenses|prime lens|zoom lens|\d{2,3}mm|f\/[\d.]+|nikkor|rf \d|gm ii|sigma art|tamron)\b/i },
  { category: "astrophotography", pattern: /\b(astrophotograph\w*|star tracker|telescope|deep[- ]sky|milky way|astro camera)\b/i },
  { category: "action-cameras", pattern: /\b(action cam\w*|gopro|hero \d|hero\d|insta360|ace pro|osmo (action|pocket)|360 camera)\b/i },
  { category: "cameras-photography", pattern: /\b(camera|mirrorless|dslr|full[- ]frame|aps-c|sensor|eos|coolpix|powershot|lumix|fujifilm|x-t\d|a7 |a7r|z6|z8|z9|shutter|iso|viewfinder)\b/i },

  // --- Drones --------------------------------------------------------------
  { category: "drones-fpv", pattern: /\b(drone|drones|fpv|quadcopter|mavic|avata|evo lite|evo max|autel|uas|part 107)\b/i },

  // --- Networking ----------------------------------------------------------
  { category: "networking", pattern: /\b(router|routers|mesh (wi-?fi|network)|wi-?fi [4-8]\b|wifi [4-8]\b|ethernet|switch port|access point|nas\b|orbi|nighthawk|unifi|deco|omada|802\.11|network switch|firewall)\b/i },

  // --- Gaming --------------------------------------------------------------
  { category: "gaming", pattern: /\b(playstation|ps5|ps6|dualsense|xbox|game pass|nintendo|switch 2|steam deck|steamos|steam machine|console|handheld console|game studio|video game)\b/i },

  // --- AI hardware ---------------------------------------------------------
  { category: "ai-hardware", pattern: /\b(ai (chip|accelerator|model|data ?cent(re|er))|npu|tops\b|llm|chatgpt|gemini|copilot|claude|inference|hbm\d?|tensor core|dgx|blackwell)\b/i },

  // --- Robots and smart home ----------------------------------------------
  { category: "smart-home-robots", pattern: /\b(robot|robotics|humanoid|smart home|matter (standard|protocol|spec)|thread border|alexa|echo (show|dot)|home assistant|vacuum|optimus)\b/i },

  // --- Computing (desktops, laptops, components, OS) -----------------------
  // Deliberately last of the specific rules: "chip" and "update" appear in
  // phone stories too, so anything with a clearer signal has already matched.
  { category: "computing", pattern: /\b(mac\b|macs\b|macbook|imac|mac mini|mac studio|mac pro|ipad|windows|pc\b|laptop|desktop|motherboard|gpu|graphics card|cpu|processor|ryzen|geforce|rtx|radeon|xeon|core ultra|ssd|hard drive|hdd|nvme|ram\b|ddr5|memory|monitor|workstation|server|thinkpad|xps|mini pc|chromebook|linux|macos)\b/i },

  // --- Smartphones ---------------------------------------------------------
  { category: "smartphones", pattern: /\b(iphone|android|galaxy s\d|galaxy z|pixel \d|smartphone|phone|ios \d|ipados|one ui|oxygenos|hyperos|nothing phone|foldable|airpods|earbuds|smartwatch|apple watch)\b/i },
];

export type CategoryChoice = {
  category: string;
  /** How the answer was reached. Shown in reports so a wrong filing is traceable. */
  basis: "subject" | "entity_default";
  matched: string | null;
};

/**
 * Choose the section for a development.
 *
 * @param subject      The headline or subject phrase.
 * @param entityCategories The matched company's categories, used to constrain
 *                     and to fall back to. Never the primary signal.
 */
export function categoryForSubject(
  subject: string,
  entityCategories: readonly string[]
): CategoryChoice {
  const allowed = new Set(entityCategories);

  // First pass: a rule the company plausibly operates in.
  for (const rule of CATEGORY_RULES) {
    if (!allowed.has(rule.category)) continue;
    const m = subject.match(rule.pattern);
    if (m) return { category: rule.category, basis: "subject", matched: m[0] };
  }

  // Second pass: the subject is clearly about something the company's declared
  // categories do not cover. Sony's watchlist entry lists cameras and gaming,
  // and Sony also ships phones; the SUBJECT is the better evidence, so an
  // unambiguous match outside the declared set still wins.
  for (const rule of CATEGORY_RULES) {
    const m = subject.match(rule.pattern);
    if (m) return { category: rule.category, basis: "subject", matched: m[0] };
  }

  // Nothing recognisable. Fall back to the company's first category, which is
  // what the old code did unconditionally — now it is the last resort and is
  // labelled as a guess rather than presented as a classification.
  return { category: entityCategories[0] ?? "computing", basis: "entity_default", matched: null };
}
