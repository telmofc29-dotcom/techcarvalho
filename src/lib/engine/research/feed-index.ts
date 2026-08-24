// FETCHING THE EDITORIAL CORPUS.
//
// The I/O half of the research pipeline. Plain `fetch()` over free RSS/Atom —
// no API key, no paid tier, no scraping of anything that declined.
//
// THREE RULES
// -----------
// 1. A SOURCE THAT REFUSES IS RECORDED, NOT RETRIED HARDER. A 403 is the
//    publisher saying no. This project does not rotate user agents or work
//    around it; the source is marked blocked with its status and moves on.
//
// 2. ONE SLOW FEED MUST NOT STALL THE PASS. Every fetch has its own timeout and
//    its own failure, and the corpus is whatever came back. A research run over
//    18 of 23 feeds is worth having; a run that hangs on one is not.
//
// 3. FAILURES ARE PART OF THE RESULT. `sourcesFailed` travels with the corpus so
//    a caller can say "found nothing across 23 sources" or "found nothing across
//    the 6 that answered" — which are very different statements, and only the
//    second one is honest when 17 feeds timed out.

import { parseFeed, type FeedItem } from "../feed-parser.ts";
import { SEED_SOURCES, sourcesForCategory, type SeedSource } from "./source-seed.ts";
import type { IndexedItem } from "./research-pipeline.ts";

export const FETCH_TIMEOUT_MS = 12_000;
export const USER_AGENT = "TechCarvalhoBot/1.0 (+https://www.techcarvalho.com)";

export type CorpusResult = {
  items: IndexedItem[];
  attempted: string[];
  read: string[];
  failed: { organisation: string; reason: string }[];
};

async function fetchFeed(source: SeedSource): Promise<{ items: FeedItem[] } | { error: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(source.feedUrl, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "user-agent": USER_AGENT,
        accept: "application/rss+xml, application/atom+xml, application/xml;q=0.9, */*;q=0.8",
      },
    });
    if (!res.ok) {
      // 403 is a refusal, not a bug. Named as such so nobody "fixes" it.
      return {
        error:
          res.status === 403
            ? `HTTP 403 — the publisher declines automated access.`
            : `HTTP ${res.status}`,
      };
    }
    const xml = await res.text();
    const items = parseFeed(xml, 60);
    if (items.length === 0) return { error: "Responded, but contained no parseable feed items." };
    return { items };
  } catch (err) {
    const name = err instanceof Error ? err.name : String(err);
    return { error: name === "AbortError" ? `Timed out after ${FETCH_TIMEOUT_MS}ms` : name };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch the feeds worth consulting for a category, in parallel.
 *
 * `limit` caps how many are consulted so one research pass cannot fan out
 * across the whole registry for a low-value discovery. Sources are already
 * ordered by authority tier, so the cap keeps the best ones.
 */
export async function buildCorpus(
  category: string | null,
  options: { limit?: number; sources?: readonly SeedSource[] } = {}
): Promise<CorpusResult> {
  const pool = options.sources ?? sourcesForCategory(category);
  const chosen = pool.slice(0, options.limit ?? pool.length);

  const attempted = chosen.map((s) => s.organisation);
  const read: string[] = [];
  const failed: { organisation: string; reason: string }[] = [];
  const items: IndexedItem[] = [];

  const results = await Promise.all(
    chosen.map(async (source) => ({ source, result: await fetchFeed(source) }))
  );

  for (const { source, result } of results) {
    if ("error" in result) {
      failed.push({ organisation: source.organisation, reason: result.error });
      continue;
    }
    read.push(source.organisation);
    for (const item of result.items) items.push({ ...item, source });
  }

  return { items, attempted, read, failed };
}

/** The whole registry, for a topic that spans categories. */
export async function buildFullCorpus(options: { limit?: number } = {}): Promise<CorpusResult> {
  return buildCorpus(null, { ...options, sources: SEED_SOURCES });
}
