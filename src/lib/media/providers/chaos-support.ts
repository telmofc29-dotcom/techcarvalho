// Fault injection for the media pipeline. TEST SUPPORT ONLY.
//
// WHY A REAL SERVER AND NOT A STUB FUNCTION
// -----------------------------------------
// The proofs these tests exist to obtain are `chaos_proven`, and that level
// means the failure was DELIBERATELY INDUCED and the system's real response
// observed. A hand-written `CommonsFetch` that returns `{ status: 500 }` proves
// what the author believed a 500 looks like; it never touches a socket, never
// exercises `fetch`, never produces a real `TypeError: fetch failed` from a
// refused connection, and cannot produce a real abort.
//
// So this module starts an ACTUAL `node:http` server on loopback and points the
// real `fetch()` at it. Connection refused is a real ECONNREFUSED. A timeout is
// a real `AbortSignal` firing against a server that genuinely never answers.
// HTTP 500 / 429 / 503 are real status lines. "HTML instead of JSON" is a real
// body arriving with a 200.
//
// WHERE THE NON-FAULTY RESPONSES COME FROM
// ----------------------------------------
// `chaos-fixtures.json` holds the VERBATIM response bodies Wikimedia Commons
// returned on 2026-08-22 to the eight requests a real `GoPro HERO13 Black` run
// makes: two namespace-14 category searches, two category enumerations, one
// metadata batch, and three per-file resolves carrying raw wikitext,
// extmetadata, EXIF and sha1. Replaying real payloads matters: a scenario in
// which everything is healthy has to reach USABLE_CANDIDATE_FOUND, or the
// scenarios in which one thing is broken prove nothing.
//
// Nothing in this file is imported by any production path.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import type { CommonsFetch } from "./wikimedia-commons.ts";

const FIXTURES: Record<string, string> = JSON.parse(
  readFileSync(new URL("./chaos-fixtures.json", import.meta.url), "utf8")
);

/** The subject those fixtures were captured for. */
export const FIXTURE_SUBJECT = {
  canonicalName: "GoPro HERO13 Black",
  manufacturer: "GoPro",
  aliases: ["GoPro Hero 13 Black", "GoPro Héro 13 Black"],
  family: "GoPro HERO",
};

export const FIXTURE_FILE_TITLES = [
  "File:GoPro Héro 13 Black - 01.jpg",
  "File:GoPro Héro 13 Black - 02.jpg",
  "File:GoPro Héro 13 Black - 03.jpg",
];

/**
 * Reduce a MediaWiki request to the key the fixtures are stored under.
 *
 * Deliberately mirrors the four call shapes `wikimedia-commons.ts` makes, so a
 * future fifth call shape falls through to `other` and is visibly unfixtured
 * rather than silently answered with something plausible.
 */
export function requestSignature(params: Record<string, string>): string {
  if (params.list === "search") return `search::${params.srsearch}::ns${params.srnamespace}`;
  if (params.list === "categorymembers") return `categorymembers::${params.cmtitle}::${params.cmtype}`;
  if (params.prop === "categories|imageinfo") return `enrich::${params.titles}`;
  if (params.prop === "imageinfo|revisions|categories") return `resolve::${params.titles}`;
  return "other";
}

export type RequestFacts = {
  signature: string;
  params: Record<string, string>;
  /** Which of the four call shapes this is, for a plan that wants to fault a stage. */
  stage: "search" | "categorymembers" | "enrich" | "resolve" | "other";
  /** The verbatim body Commons really sent for this request, when one was captured. */
  fixture: string | null;
};

export type FaultDecision =
  /** Answer with the verbatim Commons body (200). Missing fixture -> valid empty shape. */
  | { kind: "fixture" }
  /** Answer with the fixture body after passing it through `edit`. */
  | { kind: "fixture_edited"; edit: (body: string) => string }
  /** Answer with this exact status and body. */
  | { kind: "respond"; status: number; body: string; contentType?: string }
  /** Accept the connection and never answer. Forces a real client timeout. */
  | { kind: "hang" }
  /** Destroy the socket mid-request. A real transport failure, not a status code. */
  | { kind: "destroy" };

export type FaultPlan = (facts: RequestFacts) => FaultDecision;

/** A valid, well-shaped MediaWiki answer meaning "I looked and there is nothing". */
export const HONEST_EMPTY: Record<RequestFacts["stage"], string> = {
  search: JSON.stringify({ batchcomplete: true, query: { search: [] } }),
  categorymembers: JSON.stringify({ batchcomplete: true, query: { categorymembers: [] } }),
  enrich: JSON.stringify({ batchcomplete: true, query: { pages: [] } }),
  resolve: JSON.stringify({ batchcomplete: true, query: { pages: [] } }),
  other: JSON.stringify({ batchcomplete: true }),
};

/** The kind of HTML Wikimedia's edge actually serves instead of JSON. */
export const HTML_ERROR_PAGE =
  "<!DOCTYPE html>\n<html lang=\"en\"><head><title>Wikimedia Error</title></head>\n" +
  "<body><h1>Our servers are currently under maintenance or experiencing a technical problem.</h1>\n" +
  "<p>Please try again in a few minutes.</p></body></html>\n";

export const HTML_RATE_LIMIT_PAGE =
  "<!DOCTYPE html>\n<html lang=\"en\"><head><title>429 Too Many Requests</title></head>\n" +
  "<body><h1>Too Many Requests</h1><p>Rate limit exceeded. Please slow down.</p></body></html>\n";

export type CommonsStub = {
  origin: string;
  /** Every signature the server was asked for, in order. */
  seen: string[];
  close(): Promise<void>;
};

export async function startCommonsStub(plan: FaultPlan): Promise<CommonsStub> {
  const seen: string[] = [];
  const open = new Set<ServerResponse>();

  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const params = Object.fromEntries(url.searchParams) as Record<string, string>;
    const signature = requestSignature(params);
    const stage: RequestFacts["stage"] = signature.startsWith("search::")
      ? "search"
      : signature.startsWith("categorymembers::")
        ? "categorymembers"
        : signature.startsWith("enrich::")
          ? "enrich"
          : signature.startsWith("resolve::")
            ? "resolve"
            : "other";
    const fixture = FIXTURES[signature] ?? null;
    seen.push(signature);

    const decision = plan({ signature, params, stage, fixture });

    const sendJson = (status: number, body: string) => {
      res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
      res.end(body);
    };

    switch (decision.kind) {
      case "fixture":
        sendJson(200, fixture ?? HONEST_EMPTY[stage]);
        return;
      case "fixture_edited":
        sendJson(200, decision.edit(fixture ?? HONEST_EMPTY[stage]));
        return;
      case "respond":
        res.writeHead(decision.status, { "Content-Type": decision.contentType ?? "application/json; charset=utf-8" });
        res.end(decision.body);
        return;
      case "hang":
        open.add(res);
        req.socket.setKeepAlive(true);
        return;
      case "destroy":
        req.socket.destroy();
        return;
    }
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("stub server did not bind a port");

  return {
    origin: `http://127.0.0.1:${address.port}`,
    seen,
    async close() {
      for (const res of open) res.destroy();
      await new Promise<void>((resolve, reject) =>
        server.close((e) => (e && (e as NodeJS.ErrnoException).code !== "ERR_SERVER_NOT_RUNNING" ? reject(e) : resolve()))
      );
    },
  };
}

/** A port nothing is listening on, for inducing a real connection refusal. */
export async function reservedDeadOrigin(): Promise<string> {
  const stub = await startCommonsStub(() => ({ kind: "fixture" }));
  const origin = stub.origin;
  await stub.close();
  return origin;
}

/**
 * A `CommonsFetch` that performs a REAL `fetch` against the stub.
 *
 * The path and every query parameter the provider built are preserved
 * byte-for-byte; only the origin is swapped. So the request under test is the
 * one the production code composes, and the failure it meets is a real one.
 */
export function stubFetch(origin: string, options: { timeoutMs?: number } = {}): CommonsFetch {
  return async (url: string) => {
    const target = new URL(url);
    const rewritten = `${origin}${target.pathname}${target.search}`;
    const res = await fetch(rewritten, {
      headers: { "User-Agent": "TechCarvalhoBot/1.0 (chaos harness)", Accept: "application/json" },
      signal: options.timeoutMs ? AbortSignal.timeout(options.timeoutMs) : undefined,
    });
    return { status: res.status, text: await res.text() };
  };
}
