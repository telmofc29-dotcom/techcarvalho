// RSS 2.0 SERIALISATION.
//
// Pure and testable on purpose: the route does the data access, this does the
// XML. A feed is one of the few outputs where a single unescaped ampersand
// makes the whole document unparseable to every consumer, so the escaping is
// the part that needs tests, not the fetching.
//
// RSS 2.0 rather than Atom because it is what feed readers, Google's news
// tooling and every aggregator accept without negotiation, and because
// <pubDate> in RFC 822 is what those consumers sort on.

// Explicit .ts extension: this module is loaded directly by `node --test`,
// which is Node ESM and does not resolve extensionless relative imports.
import { SITE_NAME, SITE_URL, SITE_TAGLINE } from "./site.ts";

export type FeedItem = {
  title: string;
  /** Absolute URL. */
  url: string;
  /** Plain text. Markup is escaped, never passed through. */
  description: string;
  /** ISO 8601. Items without one are dropped by buildFeed. */
  publishedAt: string | null;
  /** Absolute URL of a representative image, when one genuinely exists. */
  imageUrl?: string | null;
  category?: string | null;
};

/**
 * Escape text for XML.
 *
 * Applied to EVERY interpolated value without exception. Article titles in this
 * database already contain quotes and ampersands — `"Display Driver Stopped
 * Responding" & What It Means` is a real published title — and one of those
 * unescaped produces a document no reader can parse, which fails as a blank
 * feed rather than as an error anyone would notice.
 */
export function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Strip control characters that are illegal in XML 1.0 at any escaping.
 *
 * Content pulled from feeds and editors picks these up, and unlike the five
 * escapable characters there is no representation for them — they can only be
 * removed. A single 0x08 in a title makes the document invalid.
 */
export function stripInvalidXmlChars(value: string): string {
  // Allowed: tab, newline, carriage return, and everything from 0x20 up.
  const illegal = new RegExp("[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F]", "g");
  return value.replace(illegal, "");
}

function clean(value: string): string {
  return escapeXml(stripInvalidXmlChars(value));
}

/** RFC 822, which is what RSS 2.0 <pubDate> requires. */
export function toRfc822(iso: string): string {
  return new Date(iso).toUTCString();
}

export type FeedOptions = {
  /** Feed title, e.g. "Tech Carvalho" or "Tech Carvalho — Cameras". */
  title: string;
  /** Absolute URL of the page this feed represents. */
  siteUrl: string;
  /** Absolute URL of the feed itself, for the atom:link self reference. */
  feedUrl: string;
  description: string;
};

/**
 * Build an RSS 2.0 document.
 *
 * Items with no publication date are DROPPED rather than given today's date.
 * Substituting a date would tell every aggregator that an old article is new,
 * which is the feed equivalent of fabricating a timestamp.
 */
export function buildFeed(items: readonly FeedItem[], options: FeedOptions): string {
  const dated = items.filter((i) => i.publishedAt !== null);
  const newest = dated
    .map((i) => i.publishedAt as string)
    .sort()
    .pop();

  const entries = dated
    .map((item) => {
      const bits = [
        `      <title>${clean(item.title)}</title>`,
        `      <link>${clean(item.url)}</link>`,
        // isPermaLink=false: the URL is the identity, but declaring it a
        // permalink invites readers to re-fetch it as a GUID endpoint.
        `      <guid isPermaLink="false">${clean(item.url)}</guid>`,
        `      <pubDate>${toRfc822(item.publishedAt as string)}</pubDate>`,
        `      <description>${clean(item.description)}</description>`,
      ];
      if (item.category) bits.push(`      <category>${clean(item.category)}</category>`);
      // enclosure needs a type and a length by spec; length="0" is the
      // conventional value when it is not known without fetching the image.
      if (item.imageUrl) {
        bits.push(`      <enclosure url="${clean(item.imageUrl)}" type="image/jpeg" length="0" />`);
      }
      return `    <item>\n${bits.join("\n")}\n    </item>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${clean(options.title)}</title>
    <link>${clean(options.siteUrl)}</link>
    <description>${clean(options.description)}</description>
    <language>en</language>
    <atom:link href="${clean(options.feedUrl)}" rel="self" type="application/rss+xml" />${
      newest ? `\n    <lastBuildDate>${toRfc822(newest)}</lastBuildDate>` : ""
    }
${entries}
  </channel>
</rss>
`;
}

export const SITE_FEED_DEFAULTS: Omit<FeedOptions, "feedUrl"> = {
  title: SITE_NAME,
  siteUrl: SITE_URL,
  description: SITE_TAGLINE,
};
