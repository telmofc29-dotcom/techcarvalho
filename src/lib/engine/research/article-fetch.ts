// FULL-TEXT FETCHING — and admitting when it did not happen.
//
// Deliberately NOT `server-only`: this uses nothing but global fetch(), and the
// acceptance scripts run it outside Next. Marking it server-only bought no
// safety and only made it unrunnable from a script.
//
// WHY
// ---
// Claims were extracted from RSS summaries, which are often two sentences and
// sometimes just the headline repeated. A summary yields a handful of thin
// claims; the article yields what the outlet actually reported. But a pipeline
// that upgrades to full text MUST record which one it got, because the failure
// mode is silent and severe: an article assembled from four headlines, labelled
// as researched from four sources, reads exactly like one assembled from four
// full articles.
//
// So every fetch returns a `contentSource` and, when it is not full text, the
// REASON. Nothing here ever reports a summary as an article.
//
// WHAT IT WILL NOT DO
// -------------------
// No bypassing. Not of robots.txt, not of a 403, not of a paywall, not of an
// anti-bot challenge, not of authentication. Each of those is a publisher
// saying no, recorded as such and left alone. There is no user-agent rotation
// here and there must not be one added.
//
// robots.txt is checked BEFORE the article is requested, and a disallow means
// the article is never fetched at all — not fetched-then-discarded. Asking and
// then ignoring the answer is worse than not asking.

import { hostOf } from "../independence.ts";

export type ContentSource = "full_text" | "feed_summary";

export type FetchFailureReason =
  /** robots.txt disallows this path for our agent. */
  | "robots_disallowed"
  /** HTTP 401/403 — the publisher declined. */
  | "blocked"
  /** Paywall or consent-wall markers found in the response. */
  | "paywalled"
  /** Network error, timeout, or a non-2xx that is not a refusal. */
  | "fetch_failed"
  /** Fetched, but too little readable prose to be worth extracting from. */
  | "summary_only"
  /** Not HTML, or an extractor could not make sense of it. */
  | "unsupported";

export type ArticleContent = {
  url: string;
  contentSource: ContentSource;
  /** Readable text when full_text, the supplied summary otherwise. */
  text: string;
  /** Null when contentSource is full_text. */
  failureReason: FetchFailureReason | null;
  /** Human-readable detail for the run log. */
  note: string | null;
  charCount: number;
};

export const ARTICLE_TIMEOUT_MS = 12_000;
export const USER_AGENT = "TechCarvalhoBot/1.0 (+https://www.techcarvalho.com)";

/**
 * Below this many characters of extracted prose, the fetch is not treated as an
 * upgrade over the feed summary.
 *
 * A page that yields 300 characters is usually navigation and a consent banner,
 * and calling that "full text" would be the exact dishonesty this module exists
 * to prevent.
 */
export const MIN_FULL_TEXT_CHARS = 1200;

// ---------------------------------------------------------------------------
// robots.txt
// ---------------------------------------------------------------------------

const robotsCache = new Map<string, { disallow: string[]; fetchedAt: number }>();
const ROBOTS_TTL_MS = 60 * 60 * 1000;

/**
 * Fetch and parse the Disallow rules that apply to us.
 *
 * Deliberately simple and deliberately CONSERVATIVE: rules from `User-agent: *`
 * and from any agent line naming us are both collected. A robots.txt we cannot
 * read is treated as ALLOWING — that is the standard's own default, and
 * treating an unreachable robots.txt as a blanket ban would silently disable
 * research against any publisher having a bad minute.
 */
export async function robotsDisallowsPath(url: string): Promise<boolean> {
  const host = hostOf(url);
  if (!host) return false;
  const origin = new URL(url).origin;

  let entry = robotsCache.get(origin);
  if (!entry || Date.now() - entry.fetchedAt > ROBOTS_TTL_MS) {
    entry = { disallow: [], fetchedAt: Date.now() };
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 6000);
      const res = await fetch(`${origin}/robots.txt`, {
        signal: controller.signal,
        headers: { "user-agent": USER_AGENT },
      });
      clearTimeout(timer);
      if (res.ok) entry.disallow = parseRobots(await res.text());
    } catch {
      // Unreachable robots.txt: allow, per the standard's default.
    }
    robotsCache.set(origin, entry);
  }

  const path = new URL(url).pathname;
  return entry.disallow.some((rule) => rule.length > 0 && path.startsWith(rule));
}

export function parseRobots(text: string): string[] {
  const lines = text.split(/\r?\n/).map((l) => l.replace(/#.*$/, "").trim());
  const disallow: string[] = [];
  let applies = false;
  for (const line of lines) {
    const ua = line.match(/^user-agent:\s*(.+)$/i);
    if (ua) {
      const agent = ua[1].trim().toLowerCase();
      applies = agent === "*" || agent.includes("techcarvalho");
      continue;
    }
    const dis = line.match(/^disallow:\s*(.*)$/i);
    if (dis && applies) {
      const rule = dis[1].trim();
      // "Disallow:" with an empty value means allow everything.
      if (rule) disallow.push(rule);
    }
  }
  return disallow;
}

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

const PAYWALL_MARKERS = [
  "subscribe to continue",
  "subscribers only",
  "this article is for subscribers",
  "create a free account to continue",
  "you have reached your article limit",
  "please enable javascript",
  "checking your browser before",
  "verify you are human",
];

/**
 * Pull readable prose out of an HTML document.
 *
 * Not a full readability implementation — script/style/nav are stripped, then
 * paragraph text is joined. It is deliberately crude, and `MIN_FULL_TEXT_CHARS`
 * is what stops crude from becoming dishonest: if this returns too little, the
 * result is reported as `summary_only` rather than as a successful full-text
 * fetch.
 */
export function extractReadableText(html: string): string {
  const withoutNoise = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
    .replace(/<header[\s\S]*?<\/header>/gi, " ")
    .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
    .replace(/<aside[\s\S]*?<\/aside>/gi, " ")
    .replace(/<form[\s\S]*?<\/form>/gi, " ");

  const paragraphs = [...withoutNoise.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)]
    .map((m) => stripTags(m[1]))
    .filter((t) => t.length > 40);

  const text = paragraphs.join("\n\n");
  return text.length > 0 ? text : stripTags(withoutNoise);
}

function stripTags(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#8217;|&rsquo;/g, "'")
    .replace(/&#8220;|&#8221;|&ldquo;|&rdquo;/g, '"')
    .replace(/&#8230;|&hellip;/g, "...")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#\d+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ---------------------------------------------------------------------------
// The fetch
// ---------------------------------------------------------------------------

/**
 * Fetch an article, falling back to the supplied summary.
 *
 * ALWAYS returns usable content — the summary is the floor, never an error —
 * so a research pass is never blocked by one publisher. What changes is
 * `contentSource`, and that is what downstream code and the owner both read.
 */
export async function fetchArticle(
  url: string,
  fallbackSummary: string
): Promise<ArticleContent> {
  const summary = (fallbackSummary ?? "").trim();
  const fallback = (reason: FetchFailureReason, note: string): ArticleContent => ({
    url,
    contentSource: "feed_summary",
    text: summary,
    failureReason: reason,
    note,
    charCount: summary.length,
  });

  if (await robotsDisallowsPath(url)) {
    // Asked, and told no. The article is not requested at all.
    return fallback("robots_disallowed", "robots.txt disallows this path for our agent.");
  }

  let res: Response;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ARTICLE_TIMEOUT_MS);
    res = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: { "user-agent": USER_AGENT, accept: "text/html,application/xhtml+xml" },
    });
    clearTimeout(timer);
  } catch (err) {
    const name = err instanceof Error ? err.name : String(err);
    return fallback("fetch_failed", name === "AbortError" ? "Timed out." : name);
  }

  if (res.status === 401 || res.status === 403) {
    return fallback("blocked", `HTTP ${res.status} — the publisher declines automated access.`);
  }
  if (!res.ok) {
    return fallback("fetch_failed", `HTTP ${res.status}`);
  }

  const contentType = res.headers.get("content-type") ?? "";
  if (!/text\/html|application\/xhtml/i.test(contentType)) {
    return fallback("unsupported", `Content-Type was ${contentType || "unset"}.`);
  }

  const html = await res.text();
  const lower = html.toLowerCase();
  const marker = PAYWALL_MARKERS.find((m) => lower.includes(m));
  if (marker) {
    // A consent or anti-bot interstitial is not an article, and treating the
    // wall's own copy as reporting would be worse than having no text at all.
    return fallback("paywalled", `Access wall detected ("${marker}").`);
  }

  const text = extractReadableText(html);
  if (text.length < MIN_FULL_TEXT_CHARS) {
    return fallback(
      "summary_only",
      `Only ${text.length} characters of prose extracted (minimum ${MIN_FULL_TEXT_CHARS}).`
    );
  }

  return {
    url,
    contentSource: "full_text",
    text,
    failureReason: null,
    note: null,
    charCount: text.length,
  };
}

/** Rollup for a run log. */
export function summariseFetches(results: readonly ArticleContent[]) {
  const byReason = new Map<string, number>();
  for (const r of results) {
    if (r.failureReason) byReason.set(r.failureReason, (byReason.get(r.failureReason) ?? 0) + 1);
  }
  return {
    total: results.length,
    fullText: results.filter((r) => r.contentSource === "full_text").length,
    feedSummary: results.filter((r) => r.contentSource === "feed_summary").length,
    reasons: Object.fromEntries(byReason),
  };
}
