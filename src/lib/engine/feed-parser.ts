// Minimal, dependency-free RSS/Atom parser.
//
// Deliberately tolerant rather than strict: requirement 10 says jobs must be
// "safe if a source becomes unavailable or changes format". A feed that
// half-breaks should yield the items it can and drop the rest, never throw and
// kill the whole discovery run. Every function here returns data or an empty
// array — no exceptions escape.
//
// No XML library is used on purpose: a regex-based extractor over a bounded
// payload avoids adding a parsing dependency (and its CVE surface) for what is
// a simple, well-shaped extraction job.

export type FeedItem = {
  title: string;
  link: string | null;
  publishedAt: string | null;
  summary: string | null;
};

function decodeEntities(input: string): string {
  return input
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    // Ampersand last, so an already-decoded &amp;lt; doesn't double-decode.
    .replace(/&amp;/g, "&");
}

function stripTags(input: string): string {
  // CDATA must be unwrapped BEFORE tag stripping. `<![CDATA[...]]>` contains
  // no `>` until its terminator, so a naive `<[^>]*>` strip swallows the
  // entire payload and silently produces an empty title — which then drops
  // the item. Unwrap first, then strip real tags, then decode entities.
  const unwrapped = input.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
  return decodeEntities(unwrapped.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

function firstMatch(block: string, tags: string[]): string | null {
  for (const tag of tags) {
    const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "i");
    const m = block.match(re);
    if (m && m[1]) {
      const value = stripTags(m[1]);
      if (value) return value;
    }
  }
  return null;
}

/** Atom links carry the URL in an href attribute rather than as text. */
function extractLink(block: string): string | null {
  const text = firstMatch(block, ["link"]);
  if (text && /^https?:\/\//i.test(text)) return text;
  const href = block.match(/<link[^>]*\bhref=["']([^"']+)["']/i);
  if (href && href[1]) return decodeEntities(href[1]);
  const guid = firstMatch(block, ["guid", "id"]);
  if (guid && /^https?:\/\//i.test(guid)) return guid;
  return null;
}

function normaliseDate(raw: string | null): string | null {
  if (!raw) return null;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

/**
 * Parse an RSS or Atom document into items. Returns [] for anything
 * unparseable — including HTML served where a feed was expected, which is a
 * common real-world failure when a source silently moves its feed.
 */
export function parseFeed(xml: string, maxItems = 40): FeedItem[] {
  if (!xml || typeof xml !== "string") return [];

  const blocks = xml.match(/<(item|entry)(?:\s[^>]*)?>[\s\S]*?<\/\1>/gi);
  if (!blocks) return [];

  const items: FeedItem[] = [];
  for (const block of blocks.slice(0, maxItems)) {
    const title = firstMatch(block, ["title"]);
    if (!title) continue; // An item with no title is not usable as a candidate.
    items.push({
      title,
      link: extractLink(block),
      publishedAt: normaliseDate(firstMatch(block, ["pubDate", "published", "updated", "dc:date"])),
      summary: firstMatch(block, ["description", "summary", "content"]),
    });
  }
  return items;
}

/** Heuristic mapping from a headline to a discovery type. Deterministic, no AI. */
export function classifyDiscoveryType(title: string, summary: string | null): string {
  const text = `${title} ${summary ?? ""}`.toLowerCase();
  if (/\brecall\b|\bsecurity (advisory|notice|update)\b|\bvulnerabilit/.test(text)) {
    return "recall_or_security";
  }
  if (/\bfirmware\b|\bsoftware update\b|\bpatch\b|\bdriver\b/.test(text)) return "firmware_release";
  if (/\bspecification|\bspecs?\b.*(change|updated|revised)/.test(text)) return "spec_change";
  if (/\bannounc|\bunveil|\breveal|\blaunch|\bintroduc|\bnow available\b/.test(text)) {
    return "product_launch";
  }
  if (/\bupdate|\brefresh|\brevision\b/.test(text)) return "product_update";
  return "technology_news";
}

/**
 * Conservative claim classification from wording. Defaults to the weakest
 * plausible status — never upgrades a claim on ambiguity, matching the
 * confidence engine's stance that uncertainty must not decay into fact.
 */
export function classifyClaimStatus(title: string, summary: string | null, sourceTrust: string): string {
  const text = `${title} ${summary ?? ""}`.toLowerCase();
  if (/\brumou?r|\ballegedly\b|\breportedly\b|\bleak/.test(text)) {
    return /\bleak/.test(text) ? "leak" : "rumour";
  }
  if (/\bestimat|\bexpected to\b|\bcould\b|\bmight\b/.test(text)) return "estimate";
  // Only a primary source can produce a primary-confirmed claim.
  if (sourceTrust === "primary") return "confirmed_primary";
  return "reported_secondary";
}
