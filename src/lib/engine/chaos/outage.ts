// CHAOS: real upstream outages, induced with real sockets.
//
// WHY A REAL SERVER RATHER THAN A STUBBED fetch()
// -----------------------------------------------
// `source_outage_test` requires `chaos_proven`, and the whole distinction that
// level draws is between a failure that was DESCRIBED to the system and a
// failure that actually happened to it. Handing a classifier the string
// "ECONNREFUSED" describes an outage. Binding a socket, closing it, and issuing
// a real request at it produces one — and produces whatever error Node and this
// operating system genuinely raise, including the ones nobody would have thought
// to write into a fixture.
//
// So this module stands up throwaway HTTP servers on loopback and breaks them in
// the five ways a feed source actually breaks:
//
//   1. gone          — nothing listening. Connection refused.
//   2. server_error  — 503 with a body. Reachable, useless.
//   3. hangs         — accepts the connection and never answers. Times out.
//   4. moved         — 200 OK serving an HTML page where a feed used to be.
//                      THE DANGEROUS ONE: it is a complete success at every
//                      layer below the parser, and yields zero items.
//   5. empty_feed    — 200 OK serving a well-formed feed with no entries.
//                      THE ONLY CASE that honestly means "this source had no
//                      news", and it is here as the control: a proof that a
//                      detector fires on outages is worth nothing without a
//                      demonstration that it does not fire on quiet.
//
// safeFetchText() — the function the discovery job actually uses — lives in
// src/lib/engine/cron.ts, which begins `import "server-only"` and cannot be
// loaded here. Its body is REPLICATED verbatim below, and the replication is
// flagged rather than hidden: a proof resting on it covers the behaviour of that
// algorithm, not the identity of that function.
//
// NOT server-only.

import { createServer, type Server } from "node:http";
import { parseFeed } from "../feed-parser.ts";
import { errorFamily, type ProviderEpisode } from "../stage-outcome.ts";

export type OutageKind = "gone" | "server_error" | "hangs" | "moved" | "empty_feed" | "healthy";

const HEALTHY_FEED = `<?xml version="1.0"?><rss version="2.0"><channel>
<item><title>Acme Corp announces the RX-7 sensor module</title><link>https://example.invalid/a</link><pubDate>Mon, 18 Aug 2026 10:00:00 GMT</pubDate><description>A new module.</description></item>
<item><title>Acme Corp publishes firmware 2.1 for the RX-7</title><link>https://example.invalid/b</link><pubDate>Mon, 18 Aug 2026 11:00:00 GMT</pubDate><description>Firmware.</description></item>
</channel></rss>`;

const EMPTY_FEED = `<?xml version="1.0"?><rss version="2.0"><channel>
<title>Acme Corp newsroom</title><link>https://example.invalid/</link><description>No items this week.</description>
</channel></rss>`;

const MOVED_TO_HTML = `<!doctype html><html><head><title>Acme Corp Newsroom</title></head>
<body><h1>Our newsroom has moved</h1><p>Please update your bookmarks.</p></body></html>`;

export type FakeSource = {
  url: string;
  kind: OutageKind;
  close: () => Promise<void>;
};

/**
 * Stand up (or deliberately fail to stand up) one upstream source.
 *
 * `gone` binds a port, learns it, then closes the listener — so the URL points
 * at a port that genuinely has nothing on it. Picking an arbitrary port and
 * hoping would make the test flaky in the direction of a false pass.
 */
export async function startFakeSource(kind: OutageKind): Promise<FakeSource> {
  const server: Server = createServer((req, res) => {
    switch (kind) {
      case "server_error":
        res.writeHead(503, { "content-type": "text/plain", "retry-after": "120" });
        res.end("Service Unavailable");
        return;
      case "hangs":
        // Accept and never answer. The client's own timeout has to save it.
        return;
      case "moved":
        res.writeHead(200, { "content-type": "text/html" });
        res.end(MOVED_TO_HTML);
        return;
      case "empty_feed":
        res.writeHead(200, { "content-type": "application/rss+xml" });
        res.end(EMPTY_FEED);
        return;
      default:
        res.writeHead(200, { "content-type": "application/rss+xml" });
        res.end(HEALTHY_FEED);
    }
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  const url = `http://127.0.0.1:${port}/feed.xml`;

  const close = () =>
    new Promise<void>((resolve) => {
      server.closeAllConnections?.();
      server.close(() => resolve());
    });

  if (kind === "gone") {
    // Take the socket away. The URL now points at nothing at all.
    await close();
    return { url, kind, close: async () => {} };
  }

  return { url, kind, close };
}

// ---------------------------------------------------------------------------
// The fetch the discovery job performs
// ---------------------------------------------------------------------------

/**
 * REPLICA of `safeFetchText` from src/lib/engine/cron.ts (server-only, so it
 * cannot be imported here). Kept byte-for-byte in behaviour, including the part
 * this harness exists to complain about: every distinguishable failure —
 * connection refused, 404, 503, timeout — collapses into the SAME `null`.
 */
export async function safeFetchTextReplica(url: string, timeoutMs = 10_000): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "user-agent": "TechCarvalhoBot/1.0 (+https://www.techcarvalho.com)",
        accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
      },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const text = await res.text();
    return text.slice(0, 2_000_000);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export type SourceObservation = {
  url: string;
  /** What safeFetchText (the production algorithm) would have returned. */
  safeFetchResult: "body" | "null";
  /** What actually happened, at the resolution safeFetchText discards. */
  transport: "ok" | "refused" | "timeout" | "http_error" | "other";
  httpStatus: number | null;
  /** The real error, verbatim, when there was one. */
  errorMessage: string | null;
  /** Items the REAL parseFeed() extracted from whatever came back. */
  itemsParsed: number;
  bodyBytes: number;
  /**
   * Whether the body is a feed DOCUMENT at all, irrespective of how many entries
   * it has.
   *
   * parseFeed() cannot answer this — it returns `[]` for an item-less but
   * perfectly valid feed AND for an HTML error page, which is precisely the
   * collapse that makes "the source moved" and "the source had a quiet week"
   * indistinguishable to the discovery job. Measured here so the harness can
   * show the distinction that the production path does not have.
   */
  looksLikeFeed: boolean;
};

/** A structural check parseFeed() does not perform: is this a feed document? */
export function looksLikeFeedDocument(body: string): boolean {
  return /<rss\b|<feed\b|<rdf:RDF\b/i.test(body.slice(0, 4_000));
}

/**
 * Poll a source and record what genuinely happened, at full resolution.
 *
 * Deliberately richer than safeFetchText so the harness can show what the
 * production path throws away. Both readings are reported: `safeFetchResult` is
 * what the engine sees today, `transport` is what was true.
 */
export async function observeSource(url: string, timeoutMs = 2_000): Promise<SourceObservation> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "user-agent": "TechCarvalhoBot/1.0 (+https://www.techcarvalho.com)",
        accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
      },
      cache: "no-store",
    });
    if (!res.ok) {
      return {
        url,
        safeFetchResult: "null",
        transport: "http_error",
        httpStatus: res.status,
        errorMessage: `HTTP ${res.status} ${res.statusText}`,
        itemsParsed: 0,
        bodyBytes: 0,
        looksLikeFeed: false,
      };
    }
    const body = await res.text();
    return {
      url,
      safeFetchResult: "body",
      transport: "ok",
      httpStatus: res.status,
      errorMessage: null,
      itemsParsed: parseFeed(body).length,
      bodyBytes: body.length,
      looksLikeFeed: looksLikeFeedDocument(body),
    };
  } catch (e) {
    const message = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    const aborted = e instanceof Error && (e.name === "AbortError" || e.name === "TimeoutError");
    return {
      url,
      safeFetchResult: "null",
      transport: aborted ? "timeout" : /fetch failed|ECONNREFUSED/i.test(message) ? "refused" : "other",
      httpStatus: null,
      errorMessage: message,
      itemsParsed: 0,
      bodyBytes: 0,
      looksLikeFeed: false,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Translate a real observation into the ProviderEpisode vocabulary
 * stage-outcome.ts classifies on.
 *
 * The mapping is the honest one and it is where "this source had no news" gets
 * refused: `moved` produced a perfectly valid HTTP 200 and zero items, and it is
 * reported as `malformed` (a defect in our reader or a source that changed
 * shape), NEVER as `empty`. Only a document we successfully read and understood,
 * which contained no entries, earns `empty`.
 */
export function episodeFrom(provider: string, o: SourceObservation): ProviderEpisode {
  if (o.transport === "refused" || o.transport === "timeout" || o.transport === "other") {
    return {
      provider,
      called: true,
      status: "unreachable",
      detail: o.errorMessage ?? "no detail",
      responsesParsed: 0,
      responsesFailed: 1,
    };
  }
  if (o.transport === "http_error") {
    return {
      provider,
      called: true,
      status: "rate_limited",
      detail: o.errorMessage ?? "no detail",
      responsesParsed: 0,
      responsesFailed: 1,
    };
  }
  if (o.itemsParsed === 0 && !o.looksLikeFeed) {
    // Reachable, 200, and what came back is not a feed document at all. Under no
    // circumstances is this "no news" — a moved feed serving an HTML notice looks
    // exactly like this, and the source may be publishing daily behind it.
    return {
      provider,
      called: true,
      status: "malformed",
      detail: `HTTP 200 with ${o.bodyBytes} bytes that are not a feed document and yielded zero items`,
      responsesParsed: 0,
      responsesFailed: 1,
    };
  }
  if (o.itemsParsed === 0 && o.looksLikeFeed) {
    // A well-formed feed containing no entries. THE ONLY honest "no news", and
    // reachable only because the body was structurally checked — parseFeed()
    // alone returns exactly the same `[]` for the HTML case above.
    return {
      provider,
      called: true,
      status: "empty",
      detail: "a well-formed feed document containing zero entries",
      responsesParsed: 1,
      responsesFailed: 0,
    };
  }
  return { provider, called: true, status: "ok", detail: `${o.itemsParsed} item(s)`, responsesParsed: 1, responsesFailed: 0 };
}

/** The error family the engine would file a real transport failure under. */
export function familyOf(o: SourceObservation): ReturnType<typeof errorFamily> {
  return errorFamily(o.errorMessage ? { message: o.errorMessage } : null);
}

// ---------------------------------------------------------------------------
// Source health — where an outage is supposed to become a breaker input
// ---------------------------------------------------------------------------

/**
 * The `engine_sources` health registry, as the `source_failures` breaker reads
 * it via `engine_source_health`.
 *
 * Modelled here because the interesting question is not "does the registry count
 * correctly" but "does the count ever get WRITTEN". In deployed production
 * `engine_record_source_check` is `returns void`, so the discovery job declares
 * that write blind and cannot tell whether it landed. If it silently does not,
 * this registry never moves and the breaker that watches it reads a permanently
 * healthy world.
 */
export type SourceRegistry = {
  record(source: string, success: boolean, landed: boolean): void;
  snapshot(): { checked: number; failed: number; maxConsecutiveFailures: number };
};

export function createSourceRegistry(sources: readonly string[]): SourceRegistry {
  const consecutive = new Map<string, number>(sources.map((s) => [s, 0]));
  const lastOutcome = new Map<string, boolean>();

  return {
    record(source, success, landed) {
      lastOutcome.set(source, success);
      // `landed: false` models the write being silently denied — the row is not
      // updated and nothing anywhere raises.
      if (!landed) return;
      consecutive.set(source, success ? 0 : (consecutive.get(source) ?? 0) + 1);
    },
    snapshot() {
      const checked = lastOutcome.size;
      const failed = [...lastOutcome.values()].filter((ok) => !ok).length;
      const maxConsecutiveFailures = Math.max(0, ...[...consecutive.values()]);
      return { checked, failed, maxConsecutiveFailures };
    },
  };
}
