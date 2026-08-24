// THE EDITORIAL SOURCE REGISTRY — verified, free, and grouped by who owns it.
//
// WHY THIS FILE EXISTS
// --------------------
// The engine could never corroborate anything because 28 of its 29 sources were
// companies writing about themselves. Google's blog does not confirm NVIDIA
// stories. Adding independent journalism is not a nice-to-have; it is the
// precondition for the whole evidence model doing anything at all.
//
// EVERY ENTRY BELOW WAS PROBED WITH PLAIN `fetch()` — the same call the
// deployed engine makes — and returned HTTP 200 with parseable feed items.
// Candidates that returned 403, 404 or 415 are recorded in BLOCKED_SOURCES
// rather than quietly dropped, because "we chose not to" and "they refused us"
// are different facts and the second one may change.
//
// INDEPENDENCE GROUPS ARE THE POINT
// ---------------------------------
// Counting publishers is not counting independent voices. The Verge and Polygon
// are both Vox Media. Wired and Ars Technica are both Condé Nast. Tom's
// Hardware, PC Gamer, Digital Camera World and Amateur Photographer are all
// Future plc. Three "independent confirmations" that are three Future titles
// running the same wire story is one voice wearing three hats — and it is
// exactly the failure that makes a rumour look corroborated.
//
// So every source declares an `independenceGroup`, and the research stage counts
// DISTINCT GROUPS, never distinct domains. Where a publisher is genuinely
// independent the group is its own name.
//
// COST: ZERO. All RSS/Atom over plain HTTP. No API keys, no paid tier, no
// scraping of anything that asked not to be scraped.

export type PublisherType =
  /** Independent journalism. Reports on other people's products. */
  | "editorial"
  /** A company or body publishing about itself. Authoritative for its own acts. */
  | "first_party"
  /** Standards body or regulator. First-party for its own publications. */
  | "standards_body";

export type UseTier =
  /** Primary authority for its own subject matter. */
  | "A"
  /** Established publication with editorial standards. Good for REPORTED. */
  | "B"
  /** Specialist or secondary reporting. Usable, weaker alone. */
  | "C";

export type SeedSource = {
  organisation: string;
  /** Registrable domain, used for matching evidence URLs back to this source. */
  domain: string;
  feedUrl: string;
  publisherType: PublisherType;
  useTier: UseTier;
  /**
   * Corporate owner. Sources sharing a group are NOT independent of each other,
   * however different their mastheads look.
   */
  independenceGroup: string;
  /** Taxonomy slugs this source is worth consulting for. */
  categories: string[];
  /** Items observed when probed. Recorded so a feed that goes quiet is visible. */
  verifiedItems: number;
};

/**
 * Sources verified reachable on 2026-08-24 with plain `fetch()`.
 *
 * `useTier` is about AUTHORITY, not quality: an A-tier first-party source is
 * authoritative only for its own actions, and a B-tier editorial source is
 * often the better source for anything a vendor would rather not say.
 */
export const SEED_SOURCES: readonly SeedSource[] = [
  // ---- General technology ------------------------------------------------
  {
    organisation: "The Verge",
    domain: "theverge.com",
    feedUrl: "https://www.theverge.com/rss/index.xml",
    publisherType: "editorial",
    useTier: "B",
    independenceGroup: "Vox Media",
    categories: ["computing", "smartphones", "gaming", "smart-home-robots", "ai-hardware"],
    verifiedItems: 10,
  },
  {
    organisation: "Ars Technica",
    domain: "arstechnica.com",
    feedUrl: "https://feeds.arstechnica.com/arstechnica/index",
    publisherType: "editorial",
    useTier: "B",
    independenceGroup: "Conde Nast",
    categories: ["computing", "ai-hardware", "networking", "smart-home-robots"],
    verifiedItems: 20,
  },
  {
    organisation: "Engadget",
    domain: "engadget.com",
    feedUrl: "https://www.engadget.com/rss.xml",
    publisherType: "editorial",
    useTier: "B",
    independenceGroup: "Yahoo",
    categories: ["computing", "smartphones", "gaming", "cameras-photography"],
    verifiedItems: 20,
  },
  {
    organisation: "TechCrunch",
    domain: "techcrunch.com",
    feedUrl: "https://techcrunch.com/feed/",
    publisherType: "editorial",
    useTier: "B",
    independenceGroup: "Regent",
    categories: ["ai-hardware", "computing", "smart-home-robots"],
    verifiedItems: 20,
  },
  {
    organisation: "Wired",
    domain: "wired.com",
    feedUrl: "https://www.wired.com/feed/rss",
    publisherType: "editorial",
    useTier: "B",
    // Same owner as Ars Technica. Two Condé Nast titles are one voice.
    independenceGroup: "Conde Nast",
    categories: ["computing", "ai-hardware", "smart-home-robots"],
    verifiedItems: 50,
  },
  {
    organisation: "CNET",
    domain: "cnet.com",
    feedUrl: "https://www.cnet.com/rss/news/",
    publisherType: "editorial",
    useTier: "B",
    independenceGroup: "Ziff Davis",
    categories: ["computing", "smartphones", "smart-home-robots"],
    verifiedItems: 25,
  },

  // ---- Apple and mobile --------------------------------------------------
  {
    organisation: "MacRumors",
    domain: "macrumors.com",
    feedUrl: "https://feeds.macrumors.com/MacRumors-All",
    publisherType: "editorial",
    useTier: "C",
    independenceGroup: "MacRumors",
    categories: ["smartphones", "computing"],
    verifiedItems: 20,
  },
  {
    organisation: "9to5Mac",
    domain: "9to5mac.com",
    feedUrl: "https://9to5mac.com/feed/",
    publisherType: "editorial",
    useTier: "C",
    independenceGroup: "9to5 Network",
    categories: ["smartphones", "computing"],
    verifiedItems: 100,
  },
  {
    organisation: "AppleInsider",
    domain: "appleinsider.com",
    feedUrl: "https://appleinsider.com/rss/news/",
    publisherType: "editorial",
    useTier: "C",
    independenceGroup: "AppleInsider",
    categories: ["smartphones", "computing"],
    verifiedItems: 50,
  },
  {
    organisation: "GSMArena",
    domain: "gsmarena.com",
    feedUrl: "https://www.gsmarena.com/rss-news-reviews.php3",
    publisherType: "editorial",
    useTier: "B",
    independenceGroup: "GSMArena",
    categories: ["smartphones"],
    verifiedItems: 20,
  },
  {
    organisation: "Android Authority",
    domain: "androidauthority.com",
    feedUrl: "https://www.androidauthority.com/feed/",
    publisherType: "editorial",
    useTier: "B",
    independenceGroup: "Authority Media",
    categories: ["smartphones"],
    verifiedItems: 80,
  },
  {
    organisation: "Android Police",
    domain: "androidpolice.com",
    feedUrl: "https://www.androidpolice.com/feed/",
    publisherType: "editorial",
    useTier: "C",
    independenceGroup: "Valnet",
    categories: ["smartphones"],
    verifiedItems: 10,
  },

  // ---- Cameras -----------------------------------------------------------
  {
    organisation: "PetaPixel",
    domain: "petapixel.com",
    feedUrl: "https://petapixel.com/feed/",
    publisherType: "editorial",
    useTier: "B",
    independenceGroup: "PetaPixel",
    categories: ["cameras-photography", "camera-lenses", "astrophotography"],
    verifiedItems: 20,
  },
  {
    organisation: "Digital Camera World",
    domain: "digitalcameraworld.com",
    feedUrl: "https://www.digitalcameraworld.com/feeds/all",
    publisherType: "editorial",
    useTier: "B",
    independenceGroup: "Future plc",
    categories: ["cameras-photography", "camera-lenses"],
    verifiedItems: 50,
  },
  {
    organisation: "Amateur Photographer",
    domain: "amateurphotographer.com",
    feedUrl: "https://amateurphotographer.com/feed/",
    publisherType: "editorial",
    useTier: "C",
    independenceGroup: "Kelsey Media",
    categories: ["cameras-photography", "camera-lenses"],
    verifiedItems: 50,
  },

  // ---- Gaming ------------------------------------------------------------
  {
    organisation: "IGN",
    domain: "ign.com",
    feedUrl: "https://feeds.ign.com/ign/all",
    publisherType: "editorial",
    useTier: "B",
    independenceGroup: "Ziff Davis",
    categories: ["gaming"],
    verifiedItems: 20,
  },
  {
    organisation: "Eurogamer",
    domain: "eurogamer.net",
    feedUrl: "https://www.eurogamer.net/feed",
    publisherType: "editorial",
    useTier: "B",
    independenceGroup: "IGN Entertainment",
    categories: ["gaming"],
    verifiedItems: 100,
  },
  {
    organisation: "GameSpot",
    domain: "gamespot.com",
    feedUrl: "https://www.gamespot.com/feeds/mashup/",
    publisherType: "editorial",
    useTier: "B",
    independenceGroup: "Fandom",
    categories: ["gaming"],
    verifiedItems: 15,
  },
  {
    organisation: "PC Gamer",
    domain: "pcgamer.com",
    feedUrl: "https://www.pcgamer.com/rss/",
    publisherType: "editorial",
    useTier: "B",
    independenceGroup: "Future plc",
    categories: ["gaming", "computing"],
    verifiedItems: 50,
  },
  {
    organisation: "Polygon",
    domain: "polygon.com",
    feedUrl: "https://www.polygon.com/rss/index.xml",
    publisherType: "editorial",
    useTier: "B",
    // Same owner as The Verge.
    independenceGroup: "Vox Media",
    categories: ["gaming"],
    verifiedItems: 10,
  },

  // ---- PC and components -------------------------------------------------
  {
    organisation: "Tom's Hardware",
    domain: "tomshardware.com",
    feedUrl: "https://www.tomshardware.com/feeds/all",
    publisherType: "editorial",
    useTier: "B",
    independenceGroup: "Future plc",
    categories: ["computing", "ai-hardware", "3d-printing"],
    verifiedItems: 50,
  },
  {
    organisation: "TechPowerUp",
    domain: "techpowerup.com",
    feedUrl: "https://www.techpowerup.com/rss/news",
    publisherType: "editorial",
    useTier: "B",
    independenceGroup: "TechPowerUp",
    categories: ["computing", "ai-hardware"],
    verifiedItems: 113,
  },

  // ---- Robotics ----------------------------------------------------------
  {
    organisation: "IEEE Spectrum",
    domain: "spectrum.ieee.org",
    feedUrl: "https://spectrum.ieee.org/feeds/feed.rss",
    publisherType: "editorial",
    useTier: "B",
    independenceGroup: "IEEE",
    categories: ["smart-home-robots", "ai-hardware", "networking"],
    verifiedItems: 30,
  },
] as const;

/**
 * Candidates that refused automated access when probed.
 *
 * Recorded rather than deleted. A 403 is the publisher declining, and this
 * project does not work around that — but it is also not permanent, and the
 * next person to wonder "why is there no VideoCardz?" deserves the answer.
 */
export const BLOCKED_SOURCES: readonly {
  organisation: string;
  feedUrl: string;
  status: number;
  note: string;
}[] = [
  { organisation: "VideoCardz", feedUrl: "https://videocardz.com/feed", status: 403, note: "Refused automated access." },
  { organisation: "VGC", feedUrl: "https://www.videogameschronicle.com/feed/", status: 403, note: "Refused automated access." },
  { organisation: "All3DP", feedUrl: "https://all3dp.com/feed/", status: 403, note: "Refused automated access." },
  { organisation: "3D Printing Industry", feedUrl: "https://3dprintingindustry.com/feed/", status: 415, note: "Rejected the request media type." },
  { organisation: "FCC", feedUrl: "https://www.fcc.gov/news-events/rss", status: 403, note: "Refused automated access." },
  { organisation: "Ofcom", feedUrl: "https://www.ofcom.org.uk/rss/news", status: 404, note: "Feed URL no longer valid; needs a replacement." },
  { organisation: "Wi-Fi Alliance", feedUrl: "https://www.wi-fi.org/news-events/newsroom/rss", status: 404, note: "Feed URL no longer valid; needs a replacement." },
  { organisation: "Photography Blog", feedUrl: "https://www.photographyblog.com/feed", status: 404, note: "Feed URL no longer valid." },
  { organisation: "Notebookcheck", feedUrl: "https://www.notebookcheck.net/News.152.0.html?type=9", status: 200, note: "Responded 200 but contained no parseable feed items." },
] as const;

/** Distinct independent voices available, which is the number that matters. */
export function independenceGroups(sources: readonly SeedSource[] = SEED_SOURCES): string[] {
  return [...new Set(sources.map((s) => s.independenceGroup))].sort();
}

/** Sources worth consulting for a category, best authority first. */
export function sourcesForCategory(
  category: string | null,
  sources: readonly SeedSource[] = SEED_SOURCES
): SeedSource[] {
  const pool = category ? sources.filter((s) => s.categories.includes(category)) : [...sources];
  // Fall back to the whole registry rather than returning nothing: a discovery
  // with an unmapped category should still be researched, just less precisely.
  const chosen = pool.length > 0 ? pool : [...sources];
  const tierRank: Record<UseTier, number> = { A: 0, B: 1, C: 2 };
  return [...chosen].sort((a, b) => tierRank[a.useTier] - tierRank[b.useTier]);
}
