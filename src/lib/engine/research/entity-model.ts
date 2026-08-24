// SUBJECT RESOLUTION — what is this story actually about?
//
// WHY NOT manufacturer_id
// -----------------------
// The existing schema routes subjects through `engine_discoveries.manufacturer_id`,
// which is NULL on all 195 production rows and is the wrong shape even when
// populated. Mozilla, NASA, the IETF, VESA, Arduino and the Bluetooth SIG all
// publish first-party announcements and not one of them is a manufacturer. A
// model that can only express "which manufacturer" cannot describe most of what
// this engine reads.
//
// So an ORGANISATION here is anything that can speak for itself, and a PRODUCT
// LINE is a name that implies one. `iPhone` implies Apple whether or not a
// manufacturer row exists.
//
// WHY ALIASES ARE HAND-WRITTEN
// ----------------------------
// Because the alternative is substring matching, and substring matching on
// company names is how "Apple" matches "Applebee's" and "Arm" matches "alarm".
// The list below is deliberately small, specific, and word-boundary matched. It
// is not trying to know every product in existence — it is trying to answer
// "who would have to confirm this?" for the categories TechCarvalho covers.
//
// This is a lookup table, not intelligence. It is honest about that.
//
// PURE. No `server-only`, no network.

export type Organisation = {
  /** Canonical display name. */
  name: string;
  /** Domains this organisation speaks from. Used for first-party authority. */
  domains: string[];
  /**
   * Names that imply this organisation. Matched on word boundaries,
   * case-insensitively. Order does not matter; longest match wins.
   */
  aliases: string[];
  /** Taxonomy slugs this organisation's news usually belongs to. */
  categories: string[];
};

export const ORGANISATIONS: readonly Organisation[] = [
  {
    name: "Apple",
    domains: ["apple.com"],
    aliases: ["apple", "iphone", "ipad", "macbook", "imac", "airpods", "apple watch", "vision pro", "ios", "ipados", "macos", "apple silicon", "m4", "m5"],
    categories: ["smartphones", "computing"],
  },
  {
    name: "Samsung",
    domains: ["samsung.com", "samsungmobilepress.com"],
    aliases: ["samsung", "galaxy", "exynos", "one ui"],
    categories: ["smartphones", "computing"],
  },
  {
    name: "Google",
    domains: ["google.com", "blog.google", "android.com"],
    aliases: ["google", "pixel", "android", "tensor", "gemini", "chromeos"],
    categories: ["smartphones", "ai-hardware", "computing"],
  },
  {
    name: "NVIDIA",
    domains: ["nvidia.com"],
    aliases: ["nvidia", "geforce", "rtx", "gtx", "dlss", "cuda", "blackwell", "rubin", "jetson"],
    categories: ["computing", "ai-hardware", "gaming"],
  },
  {
    name: "AMD",
    domains: ["amd.com"],
    aliases: ["amd", "ryzen", "radeon", "epyc", "threadripper", "fsr", "rdna"],
    categories: ["computing", "gaming", "ai-hardware"],
  },
  {
    name: "Intel",
    domains: ["intel.com"],
    aliases: ["intel", "core ultra", "xeon", "arc gpu", "lunar lake", "panther lake"],
    categories: ["computing", "ai-hardware"],
  },
  {
    name: "Canon",
    domains: ["canon.com", "canon.co.uk", "global.canon"],
    aliases: ["canon", "eos", "rf lens", "cinema eos", "powershot"],
    categories: ["cameras-photography", "camera-lenses"],
  },
  {
    name: "Nikon",
    domains: ["nikon.com", "nikonusa.com"],
    aliases: ["nikon", "nikkor", "z8", "z9", "coolpix"],
    categories: ["cameras-photography", "camera-lenses"],
  },
  {
    name: "Sony",
    domains: ["sony.com", "sonyinteractive.com", "playstation.com"],
    aliases: ["sony", "playstation", "ps5", "ps6", "alpha camera", "bravia", "dualsense"],
    categories: ["gaming", "cameras-photography"],
  },
  {
    name: "Microsoft",
    domains: ["microsoft.com", "xbox.com"],
    aliases: ["microsoft", "xbox", "windows", "surface", "copilot", "game pass"],
    categories: ["gaming", "computing"],
  },
  {
    name: "Nintendo",
    domains: ["nintendo.com", "nintendo-europe-press.com"],
    aliases: ["nintendo", "switch 2", "zelda", "mario"],
    categories: ["gaming"],
  },
  {
    name: "Rockstar Games",
    domains: ["rockstargames.com", "take2games.com"],
    aliases: ["rockstar games", "grand theft auto", "gta 6", "gta vi", "take-two"],
    categories: ["gaming"],
  },
  {
    name: "DJI",
    domains: ["dji.com"],
    aliases: ["dji", "mavic", "osmo", "dji mini", "dji air", "dji avata"],
    categories: ["drones-fpv", "action-cameras"],
  },
  {
    name: "GoPro",
    domains: ["gopro.com"],
    aliases: ["gopro", "hero13", "hero 13", "gopro max"],
    categories: ["action-cameras"],
  },
  {
    name: "Qualcomm",
    domains: ["qualcomm.com"],
    aliases: ["qualcomm", "snapdragon"],
    categories: ["smartphones", "computing"],
  },
  {
    name: "TP-Link",
    domains: ["tp-link.com"],
    aliases: ["tp-link", "deco", "archer router"],
    categories: ["networking"],
  },
  {
    name: "Mozilla",
    domains: ["mozilla.org"],
    aliases: ["mozilla", "firefox"],
    categories: ["computing"],
  },
  {
    name: "Raspberry Pi",
    domains: ["raspberrypi.com", "raspberrypi.org"],
    aliases: ["raspberry pi"],
    categories: ["computing", "3d-printing"],
  },
  {
    name: "Arduino",
    domains: ["arduino.cc"],
    aliases: ["arduino"],
    categories: ["computing", "smart-home-robots"],
  },
  {
    name: "NASA",
    domains: ["nasa.gov"],
    aliases: ["nasa", "artemis", "james webb", "jwst"],
    categories: ["astrophotography"],
  },
  {
    name: "ESA",
    domains: ["esa.int"],
    aliases: ["european space agency", "esa"],
    categories: ["astrophotography"],
  },
  {
    name: "VESA",
    domains: ["vesa.org", "displayport.org"],
    aliases: ["vesa", "displayport", "adaptive-sync", "displayhdr"],
    categories: ["computing", "networking"],
  },
  {
    name: "Bluetooth SIG",
    domains: ["bluetooth.com"],
    aliases: ["bluetooth sig", "bluetooth le", "bluetooth core"],
    categories: ["networking", "smart-home-robots"],
  },
  {
    name: "IETF",
    domains: ["ietf.org"],
    aliases: ["ietf", "rfc "],
    categories: ["networking"],
  },
  {
    name: "Home Assistant",
    domains: ["home-assistant.io", "openhomefoundation.org", "esphome.io"],
    aliases: ["home assistant", "esphome", "open home foundation"],
    categories: ["smart-home-robots"],
  },
  {
    name: "Roborock",
    domains: ["roborock.com"],
    aliases: ["roborock"],
    categories: ["smart-home-robots"],
  },
  {
    name: "Amazon",
    domains: ["amazon.com", "aboutamazon.com"],
    aliases: ["amazon devices", "echo show", "alexa", "kindle"],
    categories: ["smart-home-robots"],
  },
] as const;

export type SubjectMatch = {
  organisation: Organisation;
  /** The alias that matched, so the decision is explainable. */
  matchedAlias: string;
};

/**
 * Resolve the organisations a piece of text is about.
 *
 * Word-boundary matched, longest-alias-first so "apple watch" beats "apple" and
 * the more specific match is the one reported. Returns ALL matches, because a
 * story genuinely can be about two organisations ("NVIDIA partners with Canon")
 * and collapsing that to one would lose the second subject.
 */
export function resolveSubjects(text: string): SubjectMatch[] {
  const haystack = ` ${text.toLowerCase().replace(/[^a-z0-9\s.-]/g, " ").replace(/\s+/g, " ")} `;
  const matches: SubjectMatch[] = [];

  for (const org of ORGANISATIONS) {
    let best: string | null = null;
    for (const alias of org.aliases) {
      const a = alias.toLowerCase();
      // Word-boundary match. Substring matching is how "Arm" finds "alarm".
      const pattern = new RegExp(`(^|[^a-z0-9])${escapeRegex(a)}([^a-z0-9]|$)`);
      if (pattern.test(haystack) && (!best || a.length > best.length)) best = a;
    }
    if (best) matches.push({ organisation: org, matchedAlias: best });
  }

  // Longest alias first: the most specific subject leads.
  return matches.sort((a, b) => b.matchedAlias.length - a.matchedAlias.length);
}

/** The single most likely subject, or null when nothing matched. */
export function primarySubject(text: string): SubjectMatch | null {
  return resolveSubjects(text)[0] ?? null;
}

/** Domains that count as first-party for a piece of text's subject. */
export function subjectDomainsForText(text: string): string[] {
  return [...new Set(resolveSubjects(text).flatMap((m) => m.organisation.domains))];
}

/** Best-guess category from the resolved subject. Null when unknown — never invented. */
export function categoryForText(text: string): string | null {
  return primarySubject(text)?.organisation.categories[0] ?? null;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export type QueryKind =
  /**
   * Specific enough that a match means "the same story". Contains at least one
   * term beyond the subject's own name — a model number, a version, a feature.
   */
  | "identifying"
  /**
   * Broad. "Apple", "iPhone". Useful for browsing what a subject is in the news
   * for; useless as proof that two articles describe the same claim.
   */
  | "topical";

export type ResearchQuery = { query: string; kind: QueryKind };

/**
 * Research queries for a subject, tagged by how much a match proves.
 *
 * THE DISTINCTION IS LOAD-BEARING, and it comes from a real failure. The first
 * version returned plain strings, so the pipeline treated "Apple" and
 * "iPhone 18" as equally good evidence. Researching "iPhone 18" then matched
 * "Apple's four-pack of AirTags is $20 off" at full strength and reported six
 * independent origins corroborating it — six outlets that had merely each
 * mentioned Apple.
 *
 * Only `identifying` queries may be used as evidence. `topical` ones are kept
 * because they are genuinely useful for finding what a subject is in the news
 * for, but a match on one proves only that the article is about the same
 * COMPANY, which is not the same as being about the same THING.
 *
 * These are matched against feed items the engine has already fetched, not sent
 * to a search API — there is no budget for one and none is needed.
 */
export function researchQueries(title: string, subject: SubjectMatch | null): ResearchQuery[] {
  const out: ResearchQuery[] = [];
  const seen = new Set<string>();
  const add = (query: string, kind: QueryKind) => {
    const q = query.trim();
    if (q.length < 3 || seen.has(q.toLowerCase())) return;
    seen.add(q.toLowerCase());
    out.push({ query: q, kind });
  };

  const cleaned = title.replace(/[^\w\s-]/g, " ").replace(/\s+/g, " ").trim();

  // Terms belonging to the subject's identity. A query made only of these
  // describes WHO, never WHAT.
  const identityTerms = new Set<string>(
    subject
      ? [
          ...subject.organisation.name.toLowerCase().split(/\s+/),
          ...subject.organisation.aliases.flatMap((a) => a.toLowerCase().split(/\s+/)),
        ]
      : []
  );

  // Numbers are kept at any length: the model number is usually the most
  // distinctive token in a technology topic, and dropping it turns "iPhone 18"
  // into "iPhone". See distinctiveTerms in research-pipeline.ts.
  const titleTerms = cleaned
    .split(" ")
    .filter((w) => (w.length > 1 || /^\d+$/.test(w)) && !STOPWORDS.has(w.toLowerCase()));
  const beyondIdentity = titleTerms.filter((w) => !identityTerms.has(w.toLowerCase()));

  // The full title identifies the story when it says more than who it is about.
  // With no subject resolved there is no identity to exceed, so a distinctive
  // phrase like "Robotaxis" identifies on its own.
  add(cleaned, beyondIdentity.length > 0 || !subject ? "identifying" : "topical");

  // Subject plus the first distinguishing term: "iphone ultra", "eos r7".
  //
  // AN IDENTIFYING QUERY MUST KEEP ITS SUBJECT ANCHOR. An earlier version also
  // emitted the distinguishing terms on their own — for "iPhone Ultra foldable"
  // that produced the bare query "ultra foldable", which then matched
  // "Galaxy S27 Ultra" and "Xiaomi 18 Fold" at full strength and reported them
  // as independent origins corroborating an Apple story. Dropping the subject
  // turns a specific query into a generic one, which is exactly the failure
  // MIN_QUERY_TERMS was already guarding against from the other direction.
  if (subject && beyondIdentity.length > 0) {
    add(`${subject.matchedAlias} ${beyondIdentity[0]}`, "identifying");
    if (beyondIdentity.length > 1) {
      add(`${subject.matchedAlias} ${beyondIdentity.slice(0, 2).join(" ")}`, "identifying");
    }
  } else if (!subject && beyondIdentity.length > 1) {
    // With no resolved subject there is no anchor to keep, so the distinctive
    // terms are all there is to go on.
    add(beyondIdentity.slice(0, 3).join(" "), "identifying");
  }

  if (subject) {
    add(subject.organisation.name, "topical");
    add(subject.matchedAlias, "topical");
  }

  return out;
}

/**
 * Whether a string is nothing more than an organisation's name or alias.
 *
 * This is what MIN_QUERY_TERMS was really trying to express. A single-word
 * query is dangerous when the word is "Apple", because every Apple story
 * contains it; it is perfectly precise when the word is "robotaxis". The length
 * of the query was a proxy for that distinction and a bad one — it also blocked
 * every genuine single-word topic.
 */
export function isOrganisationName(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (!t) return true;
  return ORGANISATIONS.some(
    (o) => o.name.toLowerCase() === t || o.aliases.some((a) => a.toLowerCase() === t)
  );
}

/** Just the queries that can carry evidence. */
export function identifyingQueries(queries: readonly ResearchQuery[]): string[] {
  return queries.filter((q) => q.kind === "identifying").map((q) => q.query);
}

const STOPWORDS = new Set([
  "the", "and", "for", "with", "from", "that", "this", "your", "what", "when", "will",
  "have", "here", "more", "than", "into", "over", "just", "about", "everything",
  "you", "need", "know", "now", "new", "how",
]);
