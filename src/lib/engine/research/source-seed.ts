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

  // ---- 3D printing -------------------------------------------------------
  //
  // Added after the research engine returned INSUFFICIENT for every 3D-printing
  // topic. The cause was not the engine: the category had exactly ONE source
  // (Tom's Hardware's general feed), and the three dedicated outlets probed
  // earlier all refused automated access. These four answered.
  {
    organisation: "Tom's Hardware 3D Printing",
    domain: "tomshardware.com",
    feedUrl: "https://www.tomshardware.com/feeds/tag/3d-printing",
    publisherType: "editorial",
    useTier: "B",
    // Same owner as the main Tom's Hardware feed, so the two are ONE voice.
    independenceGroup: "Future plc",
    categories: ["3d-printing"],
    verifiedItems: 50,
  },
  {
    organisation: "3DPrint.com",
    domain: "3dprint.com",
    feedUrl: "https://3dprint.com/feed/",
    publisherType: "editorial",
    useTier: "B",
    independenceGroup: "3DPrint.com",
    categories: ["3d-printing"],
    verifiedItems: 10,
  },
  {
    organisation: "Prusa Research",
    domain: "prusa3d.com",
    feedUrl: "https://blog.prusa3d.com/feed/",
    // A vendor writing about its own printers: authoritative for what Prusa
    // announced, and for nothing else.
    publisherType: "first_party",
    useTier: "A",
    independenceGroup: "Prusa Research",
    categories: ["3d-printing"],
    verifiedItems: 10,
  },
  {
    organisation: "Bambu Lab",
    domain: "bambulab.com",
    feedUrl: "https://blog.bambulab.com/rss/",
    publisherType: "first_party",
    useTier: "A",
    independenceGroup: "Bambu Lab",
    categories: ["3d-printing"],
    verifiedItems: 15,
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

  // =========================================================================
  // Added 2026-08-25, all probed live before being written down.
  //
  // A coverage-health audit found ten watched companies returning ZERO corpus
  // items. The cause was not that nothing was happening at them — it was that
  // no registered feed covered their subject at all. Two categories the
  // watchlist actively uses, `drones-fpv` and `action-cameras`, had NO tagged
  // source whatsoever, which is why tier 1 DJI surfaced four items and Autel
  // surfaced none. Storage, networking hardware and semiconductors had no
  // specialist source either.
  //
  // First-party newsrooms are the most valuable addition here. They are the
  // only `assertable` claim class in the corroboration model, so a launch can
  // be reported as confirmed rather than as somebody's account of it.
  // =========================================================================

  // ---- Storage -----------------------------------------------------------
  {
    organisation: "Blocks & Files",
    domain: "blocksandfiles.com",
    feedUrl: "https://blocksandfiles.com/feed/",
    publisherType: "editorial",
    useTier: "B",
    independenceGroup: "Blocks & Files",
    categories: ["computing"],
    verifiedItems: 70,
  },
  {
    organisation: "StorageReview",
    domain: "storagereview.com",
    feedUrl: "https://www.storagereview.com/feed",
    publisherType: "editorial",
    useTier: "C",
    independenceGroup: "StorageReview",
    categories: ["computing"],
    verifiedItems: 30,
  },
  {
    organisation: "Western Digital",
    domain: "westerndigital.com",
    feedUrl: "https://blog.westerndigital.com/feed/",
    publisherType: "first_party",
    useTier: "A",
    independenceGroup: "Western Digital",
    categories: ["computing"],
    verifiedItems: 10,
  },

  // ---- Components and semiconductors -------------------------------------
  {
    organisation: "KitGuru",
    domain: "kitguru.net",
    feedUrl: "https://www.kitguru.net/feed/",
    publisherType: "editorial",
    useTier: "C",
    independenceGroup: "KitGuru",
    categories: ["computing", "gaming"],
    verifiedItems: 30,
  },
  {
    organisation: "EE Times",
    domain: "eetimes.com",
    feedUrl: "https://www.eetimes.com/feed/",
    publisherType: "editorial",
    useTier: "B",
    independenceGroup: "AspenCore",
    categories: ["computing", "ai-hardware"],
    verifiedItems: 10,
  },
  {
    organisation: "Arm",
    domain: "arm.com",
    feedUrl: "https://newsroom.arm.com/rss",
    publisherType: "first_party",
    useTier: "A",
    independenceGroup: "Arm",
    categories: ["computing", "ai-hardware"],
    verifiedItems: 6,
  },
  {
    organisation: "Intel Newsroom",
    domain: "intel.com",
    feedUrl: "https://newsroom.intel.com/feed",
    publisherType: "first_party",
    useTier: "A",
    independenceGroup: "Intel",
    categories: ["computing", "ai-hardware"],
    verifiedItems: 10,
  },
  {
    organisation: "Lenovo",
    domain: "lenovo.com",
    feedUrl: "https://news.lenovo.com/feed/",
    publisherType: "first_party",
    useTier: "A",
    independenceGroup: "Lenovo",
    categories: ["computing"],
    verifiedItems: 42,
  },

  // ---- Networking and infrastructure -------------------------------------
  {
    organisation: "ServeTheHome",
    domain: "servethehome.com",
    feedUrl: "https://www.servethehome.com/feed/",
    publisherType: "editorial",
    useTier: "B",
    independenceGroup: "ServeTheHome",
    categories: ["networking", "computing"],
    verifiedItems: 6,
  },

  // ---- Drones and action cameras -----------------------------------------
  //
  // Both categories previously had zero sources despite the watchlist naming
  // them. DroneDJ shares an owner with 9to5Mac and 9to5Google, so the three
  // must never be counted as independent corroboration of one another.
  {
    organisation: "DroneDJ",
    domain: "dronedj.com",
    feedUrl: "https://dronedj.com/feed/",
    publisherType: "editorial",
    useTier: "C",
    independenceGroup: "9to5 Network",
    categories: ["drones-fpv", "action-cameras"],
    verifiedItems: 25,
  },
  {
    organisation: "DroneLife",
    domain: "dronelife.com",
    feedUrl: "https://dronelife.com/feed/",
    publisherType: "editorial",
    useTier: "C",
    independenceGroup: "DroneLife",
    categories: ["drones-fpv"],
    verifiedItems: 10,
  },

  // ---- Robotics ----------------------------------------------------------
  {
    organisation: "The Robot Report",
    domain: "therobotreport.com",
    feedUrl: "https://www.therobotreport.com/feed/",
    publisherType: "editorial",
    useTier: "B",
    independenceGroup: "WTWH Media",
    categories: ["smart-home-robots", "ai-hardware"],
    verifiedItems: 15,
  },

  // ---- First-party newsrooms ---------------------------------------------
  {
    organisation: "Apple Developer News",
    domain: "apple.com",
    feedUrl: "https://developer.apple.com/news/rss/news.rss",
    publisherType: "first_party",
    useTier: "A",
    independenceGroup: "Apple",
    categories: ["smartphones", "computing"],
    verifiedItems: 142,
  },
  {
    organisation: "Samsung Newsroom",
    domain: "samsung.com",
    feedUrl: "https://news.samsung.com/global/feed",
    publisherType: "first_party",
    useTier: "A",
    independenceGroup: "Samsung",
    categories: ["smartphones", "computing"],
    verifiedItems: 50,
  },
  {
    organisation: "Google Blog",
    domain: "blog.google",
    feedUrl: "https://blog.google/rss/",
    publisherType: "first_party",
    useTier: "A",
    independenceGroup: "Google",
    categories: ["smartphones", "ai-hardware", "computing"],
    verifiedItems: 20,
  },
  {
    organisation: "NVIDIA Blog",
    domain: "nvidia.com",
    feedUrl: "https://blogs.nvidia.com/feed/",
    publisherType: "first_party",
    useTier: "A",
    independenceGroup: "NVIDIA",
    categories: ["computing", "ai-hardware", "gaming"],
    verifiedItems: 18,
  },
  {
    organisation: "Meta Newsroom",
    domain: "fb.com",
    feedUrl: "https://about.fb.com/news/feed/",
    publisherType: "first_party",
    useTier: "A",
    independenceGroup: "Meta",
    categories: ["ai-hardware", "smart-home-robots"],
    verifiedItems: 10,
  },

  // ---- First-party gaming ------------------------------------------------
  {
    organisation: "PlayStation Blog",
    domain: "playstation.com",
    feedUrl: "https://blog.playstation.com/feed/",
    publisherType: "first_party",
    useTier: "A",
    independenceGroup: "Sony",
    categories: ["gaming"],
    verifiedItems: 10,
  },
  {
    organisation: "Xbox Wire",
    domain: "xbox.com",
    feedUrl: "https://news.xbox.com/en-us/feed/",
    publisherType: "first_party",
    useTier: "A",
    independenceGroup: "Microsoft",
    categories: ["gaming"],
    verifiedItems: 10,
  },
  {
    organisation: "Steam News",
    domain: "steampowered.com",
    feedUrl: "https://store.steampowered.com/feeds/news.xml",
    publisherType: "first_party",
    useTier: "A",
    independenceGroup: "Valve",
    categories: ["gaming"],
    verifiedItems: 21,
  },

  // ---- Additional editorial breadth --------------------------------------
  //
  // XDA shares an owner with Android Police, and 9to5Google with 9to5Mac and
  // DroneDJ. Registered for reach, grouped so they never inflate independence.
  {
    organisation: "XDA Developers",
    domain: "xda-developers.com",
    feedUrl: "https://www.xda-developers.com/feed/",
    publisherType: "editorial",
    useTier: "C",
    independenceGroup: "Valnet",
    categories: ["smartphones", "computing"],
    verifiedItems: 10,
  },
  {
    organisation: "9to5Google",
    domain: "9to5google.com",
    feedUrl: "https://9to5google.com/feed/",
    publisherType: "editorial",
    useTier: "C",
    independenceGroup: "9to5 Network",
    categories: ["smartphones", "ai-hardware"],
    verifiedItems: 100,
  },
  {
    organisation: "DPReview",
    domain: "dpreview.com",
    feedUrl: "https://www.dpreview.com/feeds/news.xml",
    publisherType: "editorial",
    useTier: "B",
    independenceGroup: "DPReview",
    categories: ["cameras-photography", "camera-lenses"],
    verifiedItems: 30,
  },
  {
    organisation: "Hackaday",
    domain: "hackaday.com",
    feedUrl: "https://hackaday.com/blog/feed/",
    publisherType: "editorial",
    useTier: "C",
    independenceGroup: "Supplyframe",
    categories: ["3d-printing", "computing"],
    verifiedItems: 7,
  },

  // ---- 3D printing manufacturers -----------------------------------------
  {
    organisation: "Anycubic",
    domain: "anycubic.com",
    feedUrl: "https://www.anycubic.com/blogs/news.atom",
    publisherType: "first_party",
    useTier: "A",
    independenceGroup: "Anycubic",
    categories: ["3d-printing"],
    verifiedItems: 30,
  },
  {
    organisation: "Elegoo",
    domain: "elegoo.com",
    feedUrl: "https://www.elegoo.com/blogs/news.atom",
    publisherType: "first_party",
    useTier: "A",
    independenceGroup: "Elegoo",
    categories: ["3d-printing"],
    verifiedItems: 30,
  },
] as const;

/**
 * Feeds that respond but have stopped publishing.
 *
 * A dead feed is worse than a missing one: it answers 200, contributes zero
 * recent items, and makes a coverage gap look like an absence of news. These
 * are deliberately NOT registered, and are listed so nobody re-adds them
 * believing they work.
 */
export const STALE_SOURCES: readonly {
  organisation: string;
  feedUrl: string;
  newestItem: string;
  note: string;
}[] = [
  {
    organisation: "Microsoft News",
    feedUrl: "https://news.microsoft.com/feed/",
    newestItem: "2025-05-07",
    note: "Responds 200 with 10 items, none newer than May 2025. Xbox Wire covers Microsoft's gaming announcements instead.",
  },
  {
    organisation: "SmallNetBuilder",
    feedUrl: "https://www.smallnetbuilder.com/feed/",
    newestItem: "2023-09-05",
    note: "Networking specialist, but publishing stopped in 2023. ServeTheHome registered in its place.",
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
  { organisation: "All3DP", feedUrl: "https://all3dp.com/feed/", status: 403, note: "Refused automated access; the /feed/rss/ variant refuses too." },
  { organisation: "Fabbaloo", feedUrl: "https://www.fabbaloo.com/blog?format=rss", status: 403, note: "Refused automated access." },
  { organisation: "Creality", feedUrl: "https://www.creality.com/blog?format=rss", status: 200, note: "Responded 200 but served no parseable feed items." },
  { organisation: "3D Printing Industry", feedUrl: "https://3dprintingindustry.com/feed/", status: 415, note: "Rejected the request media type." },
  { organisation: "FCC", feedUrl: "https://www.fcc.gov/news-events/rss", status: 403, note: "Refused automated access." },
  { organisation: "Ofcom", feedUrl: "https://www.ofcom.org.uk/rss/news", status: 404, note: "Feed URL no longer valid; needs a replacement." },
  { organisation: "Wi-Fi Alliance", feedUrl: "https://www.wi-fi.org/news-events/newsroom/rss", status: 404, note: "Feed URL no longer valid; needs a replacement." },
  { organisation: "Photography Blog", feedUrl: "https://www.photographyblog.com/feed", status: 404, note: "Feed URL no longer valid." },
  { organisation: "Notebookcheck", feedUrl: "https://www.notebookcheck.net/News.152.0.html?type=9", status: 200, note: "Responded 200 but contained no parseable feed items." },

  // ---- Probed 2026-08-25 while closing the ten zero-coverage entities -----
  //
  // Corsair, Netgear, TP-Link, Ubiquiti and Seagate have NO usable first-party
  // feed between them. Those five are now covered only through editorial
  // sources, which is a real limitation: their own announcements reach this
  // system second-hand or not at all.
  { organisation: "The Register", feedUrl: "https://www.theregister.com/headlines.atom", status: 403, note: "Refused automated access; section feeds refuse too." },
  { organisation: "Network World", feedUrl: "https://www.networkworld.com/index.rss", status: 404, note: "Feed URL no longer valid." },
  { organisation: "Guru3D", feedUrl: "https://www.guru3d.com/rss/news", status: 404, note: "Feed URL no longer valid." },
  { organisation: "Ubiquiti", feedUrl: "https://blog.ui.com/feed/", status: 200, note: "Responded 200 but served no parseable feed items. No first-party feed found." },
  { organisation: "Seagate", feedUrl: "https://blog.seagate.com/feed/", status: 429, note: "Rate-limited on every attempt. Not a refusal in principle — worth retrying later." },
  { organisation: "Netgear", feedUrl: "https://www.netgear.com/about/press-releases/feed/", status: 404, note: "No press feed found at the documented path." },
  { organisation: "TP-Link", feedUrl: "https://www.tp-link.com/us/press/rss/", status: 404, note: "No press feed found." },
  { organisation: "Corsair", feedUrl: "https://www.corsair.com/newsroom/rss", status: 403, note: "Refused automated access." },
  { organisation: "AMD Newsroom", feedUrl: "https://www.amd.com/en/newsroom/rss.xml", status: 0, note: "Connection failed; no feed served at this path." },
  { organisation: "Qualcomm", feedUrl: "https://www.qualcomm.com/news/releases.rss", status: 404, note: "Feed URL no longer valid." },
  { organisation: "DJI", feedUrl: "https://blog.dji.com/feed", status: 0, note: "Connection failed. DroneDJ registered as the editorial route to DJI news." },
  { organisation: "Figure", feedUrl: "https://www.figure.ai/news/rss.xml", status: 404, note: "No feed. The Robot Report registered as the editorial route." },
  { organisation: "UltiMaker", feedUrl: "https://ultimaker.com/blog/feed/", status: 200, note: "Responded 200 but served no parseable feed items." },
  { organisation: "Apple Newsroom", feedUrl: "https://www.apple.com/newsroom/rss/newsroom.rss", status: 404, note: "Retired. developer.apple.com/news/rss/news.rss is registered instead." },
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
