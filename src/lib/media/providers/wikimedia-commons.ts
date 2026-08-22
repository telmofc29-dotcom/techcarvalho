// Wikimedia Commons provider.
//
// APPROVED FOR SEARCH. NOT APPROVED PER ASSET.
// --------------------------------------------
// Commons is the route that unblocked the first fourteen products on this
// site, and it is also the source of every rejected candidate in the same
// batches. Its own reuse guidance says the Foundation "does not provide any
// warranty regarding the copyright status or correctness of licensing terms"
// (https://commons.wikimedia.org/wiki/Commons:Reusing_content_outside_Wikimedia).
// A licence template is an uploader's claim. This module's job is to fetch
// that claim AND everything that could contradict it, and hand both to
// rights-verification.ts. It reaches no conclusion of its own.
//
// THE METHOD, LEARNED EXPENSIVELY
// -------------------------------
// docs/product-media-strategy.md §3a records a plain-text probe reporting ZERO
// freely-licensed files for three products that had perfectly good CC BY-SA 4.0
// photography. The generalisable lesson, quoted from that document:
//
//     "The method is: enumerate the Commons category in full. Not one of the
//      fourteen successes across §3a and §3b would have been found by name
//      search alone."
//
// So this provider is category-first:
//
//   1. find categories, both by searching namespace 14 for the product name
//      AND by walking the MANUFACTURER's subcategory tree — the step that
//      reaches "Category:GoPro Hero 13 black", lowercase and unguessable;
//   2. filter those category titles through matchCategoryTitle(), which
//      refuses capturing-device categories ("Category:Taken with…",
//      "Category:DJI FC8482") because they collect images taken BY the device;
//   3. enumerate every accepted category IN FULL, following continuations;
//   4. only then fall back to intitle / insource / free text.
//
// OPERATIONAL NOTES THAT ARE NOT OPTIONAL
// ---------------------------------------
//   * Requests are spaced 2500ms. A real 429 was hit on the third request of
//     an earlier import.
//   * Commons returns an HTML error page, not JSON, when it rate-limits. Every
//     response body is checked to start with "{" before parsing, so a throttle
//     surfaces as `rate_limited` instead of an unrelated JSON syntax error.
//   * A descriptive User-Agent is required by Wikimedia's policy.

import { licenceUrl as deedUrl } from "../licence-links.ts";
import { isCapturingDeviceCategory, matchCategoryTitle, type SubjectIdentity } from "./query-expansion.ts";
import type {
  DiscoveredCandidate,
  MediaProvider,
  ProvenanceRecord,
  ProviderApproval,
  ProviderOutcome,
  ProviderQuery,
  ResolveResult,
  SearchResult,
} from "./types.ts";

const API = "https://commons.wikimedia.org/w/api.php";
const USER_AGENT = "TechCarvalhoBot/1.0 (+https://www.techcarvalho.com; media-rights-verification)";
export const COMMONS_REQUEST_SPACING_MS = 2500;

export const COMMONS_APPROVAL: ProviderApproval = {
  id: "wikimedia_commons",
  label: "Wikimedia Commons",
  approvedForSearch: true,
  exposesPrimaryEvidence: true,
  requestSpacingMs: COMMONS_REQUEST_SPACING_MS,
  termsUrl: "https://commons.wikimedia.org/wiki/Commons:Reusing_content_outside_Wikimedia",
  rationale:
    "Approved for SEARCH only. Commons exposes each file's own licence template in raw wikitext, the uploader's " +
    "author/source/permission fields, and the embedded EXIF — i.e. primary evidence that can be cross-checked, not a " +
    "rendered badge. Commons itself disclaims any warranty on licence correctness, so no asset from it is approved " +
    "by virtue of coming from it. Roughly one candidate in four fails verification here.",
};

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

export type CommonsFetch = (url: string) => Promise<{ status: number; text: string }>;

const defaultFetch: CommonsFetch = async (url) => {
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT, Accept: "application/json" } });
  return { status: res.status, text: await res.text() };
};

type ApiResult<T> = { ok: true; data: T } | { ok: false; outcome: Exclude<ProviderOutcome, { status: "ok" }> };

// NOTE: written with explicit field assignments rather than TypeScript
// parameter properties. `npm test` runs node --test in strip-only mode, which
// rejects parameter properties outright — a constructor shorthand here would
// make this module unloadable by the test runner.
export class CommonsClient {
  private last = 0;
  private readonly doFetch: CommonsFetch;
  private readonly spacingMs: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(
    doFetch: CommonsFetch = defaultFetch,
    spacingMs: number = COMMONS_REQUEST_SPACING_MS,
    sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))
  ) {
    this.doFetch = doFetch;
    this.spacingMs = spacingMs;
    this.sleep = sleep;
  }

  async call<T>(params: Record<string, string>): Promise<ApiResult<T>> {
    const wait = this.spacingMs - (Date.now() - this.last);
    if (wait > 0) await this.sleep(wait);
    this.last = Date.now();

    const url = `${API}?${new URLSearchParams({ format: "json", formatversion: "2", ...params })}`;

    let res: { status: number; text: string };
    try {
      res = await this.doFetch(url);
    } catch (e) {
      return { ok: false, outcome: { status: "outage", detail: `network error: ${(e as Error).message}` } };
    }

    if (res.status === 429 || res.status === 503) {
      return { ok: false, outcome: { status: "rate_limited", detail: `HTTP ${res.status} from ${url}` } };
    }
    if (res.status >= 500) {
      return { ok: false, outcome: { status: "outage", detail: `HTTP ${res.status} from ${url}` } };
    }
    // The check that matters: Commons hands back an HTML error page when it
    // throttles, and a bare .json() would throw something unrelated to the
    // real problem.
    const body = res.text.trimStart();
    if (!body.startsWith("{")) {
      return {
        ok: false,
        outcome: {
          status: body.toLowerCase().includes("too many requests") || body.toLowerCase().includes("rate limit")
            ? "rate_limited"
            : "malformed",
          detail: `Non-JSON response (HTTP ${res.status}): ${body.slice(0, 200)}`,
        },
      };
    }
    try {
      const parsed = JSON.parse(body) as T & { error?: { code?: string; info?: string } };
      if (parsed.error) {
        return { ok: false, outcome: { status: "malformed", detail: `API error ${parsed.error.code}: ${parsed.error.info}` } };
      }
      return { ok: true, data: parsed };
    } catch (e) {
      return { ok: false, outcome: { status: "malformed", detail: `Body began with "{" but did not parse: ${(e as Error).message}` } };
    }
  }
}

// ---------------------------------------------------------------------------
// API shapes (only the fields actually read)
// ---------------------------------------------------------------------------

type SearchResponse = { query?: { search?: { title: string; snippet?: string }[] } };
type CategoryMembersResponse = {
  query?: { categorymembers?: { title: string; ns: number }[] };
  continue?: { cmcontinue?: string };
};
type ExtMetadataValue = { value?: string | number };
type PageInfo = {
  title: string;
  missing?: boolean;
  categories?: { title: string }[];
  imageinfo?: {
    url?: string;
    descriptionurl?: string;
    thumburl?: string;
    width?: number;
    height?: number;
    size?: number;
    mime?: string;
    sha1?: string;
    extmetadata?: Record<string, ExtMetadataValue>;
    commonmetadata?: { name: string; value: unknown }[];
    metadata?: { name: string; value: unknown }[];
  }[];
  revisions?: { slots?: { main?: { content?: string } } }[];
};
type PagesResponse = { query?: { pages?: PageInfo[] } };

// ---------------------------------------------------------------------------
// Parsing helpers (pure, exported for tests)
// ---------------------------------------------------------------------------

/** Strip the HTML Commons wraps `Artist` and `Credit` in. */
export function stripHtml(value: string | null | undefined): string | null {
  if (!value) return null;
  const text = value
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
  return text || null;
}

/** First href in an HTML fragment — Commons links the author's user page. */
export function firstHref(value: string | null | undefined): string | null {
  if (!value) return null;
  const m = /href="([^"]+)"/i.exec(value);
  if (!m) return null;
  const raw = m[1];
  if (raw.startsWith("//")) return `https:${raw}`;
  if (raw.startsWith("/")) return `https://commons.wikimedia.org${raw}`;
  return raw;
}

/**
 * Licence templates in raw wikitext, mapped to the licence strings this
 * project recognises.
 *
 * Reading the TEMPLATE rather than the rendered badge is the point: the badge
 * is generated from the template, so trusting the badge adds a rendering step
 * between us and the uploader's actual declaration, and that step is where the
 * Openverse failure mode lives.
 */
const LICENCE_TEMPLATES: [RegExp, string][] = [
  [/\{\{\s*self\s*\|[^}]*cc[-\s]?by[-\s]?sa[-\s]?4\.0/i, "CC BY-SA 4.0"],
  [/\{\{\s*self\s*\|[^}]*cc[-\s]?by[-\s]?sa[-\s]?3\.0/i, "CC BY-SA 3.0"],
  [/\{\{\s*self\s*\|[^}]*cc[-\s]?by[-\s]?4\.0/i, "CC BY 4.0"],
  [/\{\{\s*self\s*\|[^}]*cc[-\s]?by[-\s]?3\.0/i, "CC BY 3.0"],
  // "all versions" dual-licence forms. The reuser may choose any listed
  // version, and choosing the newest is both standard practice and the
  // strictest reading of what was granted.
  [/\{\{\s*self\s*\|[^}]*cc[-\s]?by[-\s]?sa[-\s]?all/i, "CC BY-SA 4.0"],
  [/\{\{\s*cc[-\s]?by[-\s]?sa[-\s]?all\s*[|},]/i, "CC BY-SA 4.0"],
  // The trailing comma matters: {{Cc-by-sa-4.0,3.0,2.5,2.0,1.0}} is a common
  // multi-version tag and a `[|}]`-only terminator misses it entirely, which
  // — now that an unreadable primary declaration is a blocker — would refuse
  // a correctly-licensed file for a parsing reason.
  [/\{\{\s*cc[-\s]?by[-\s]?sa[-\s]?4\.0\s*[|},]/i, "CC BY-SA 4.0"],
  [/\{\{\s*cc[-\s]?by[-\s]?sa[-\s]?3\.0\s*[|},]/i, "CC BY-SA 3.0"],
  [/\{\{\s*cc[-\s]?by[-\s]?sa[-\s]?2\.0\s*[|},]/i, "CC BY-SA 2.0"],
  [/\{\{\s*cc[-\s]?by[-\s]?4\.0\s*[|},]/i, "CC BY 4.0"],
  [/\{\{\s*cc[-\s]?by[-\s]?3\.0\s*[|},]/i, "CC BY 3.0"],
  [/\{\{\s*cc[-\s]?by[-\s]?2\.0\s*[|},]/i, "CC BY 2.0"],
  // {{self|cc-zero}} is a distinct form from {{Cc-zero}} and was missing here:
  // the first live run found CC0 files whose licence this module could not read
  // from the wikitext at all, which — now that an unreadable primary
  // declaration is a blocker — would have refused perfectly good files for the
  // wrong reason. A pattern gap and a rights problem look identical from the
  // outside, so both get fixed rather than one being assumed.
  [/\{\{\s*self\s*\|[^}]*cc[-\s]?zero/i, "CC0"],
  [/\{\{\s*self\s*\|[^}]*cc0/i, "CC0"],
  [/\{\{\s*cc[-\s]?zero\s*[|}]/i, "CC0"],
  [/\{\{\s*cc0[-\s]?1\.0\s*[|}]/i, "CC0"],
  [/\{\{\s*pd[-\s]?self\s*[|}]/i, "Public domain"],
  [/\{\{\s*pd[-\s]?user\b/i, "Public domain"],
  [/\{\{\s*pd[-\s]?old\b/i, "Public domain"],
  [/\{\{\s*pd[-\s]?usgov\b/i, "Public domain"],
  // Any other {{PD-…}} tag. Deliberately last so the specific forms above win.
  //
  // CAVEAT, and it is the reason this is a public-domain COPYRIGHT claim and
  // nothing more: {{PD-ineligible}} and {{PD-textlogo}} say a mark is below the
  // threshold of originality for copyright. They say nothing about TRADEMARK,
  // which is a separate right held by the brand — the same distinction that
  // disqualified Pexels and Unsplash for product photography (see
  // docs/stock-provider-assessment.md). Files carrying these are almost always
  // logos, and the entity gate refuses logos on its own grounds.
  [/\{\{\s*pd[-\s][a-z]/i, "Public domain"],
];

/**
 * Licence templates that are positively unusable here, matched FIRST.
 *
 * Order matters: a file tagged both `{{cc-by-sa-4.0}}` and `{{cc-by-nc-4.0}}`
 * must read as NonCommercial, not as the friendlier of the two.
 */
const PROHIBITIVE_TEMPLATES: [RegExp, string][] = [
  [/\{\{\s*cc[-\s]?by[-\s]?nc/i, "CC BY-NC (NonCommercial)"],
  [/\{\{\s*cc[-\s]?by[-\s]?nd/i, "CC BY-ND (NoDerivatives)"],
  [/\{\{\s*cc[-\s]?by[-\s]?sa[-\s]?nc/i, "CC BY-NC-SA (NonCommercial)"],
  [/\{\{\s*non[-\s]?free/i, "Non-free content"],
  [/\{\{\s*fair[\s_-]?use/i, "Fair use"],
  [/\{\{\s*copyright[\s_-]?by[\s_-]?wikimedia/i, "Wikimedia-specific copyright tag"],
];

export function licenceFromWikitext(wikitext: string): { licence: string | null; raw: string | null } {
  for (const [pattern, label] of PROHIBITIVE_TEMPLATES) {
    const m = pattern.exec(wikitext);
    if (m) return { licence: label, raw: m[0] };
  }
  for (const [pattern, label] of LICENCE_TEMPLATES) {
    const m = pattern.exec(wikitext);
    if (m) return { licence: label, raw: m[0] };
  }
  return { licence: null, raw: null };
}

/**
 * Pull a named field out of an {{Information}} template.
 *
 * A field's value runs to the next line beginning with `|` or `}`. An earlier
 * version instead looked ahead for `\n|<name>=` with `<name>` matching
 * `[a-zA-Z_]+` — which does not match `other versions`, because of the space.
 * The result was that `permission=` on every one of François de Dijon's GoPro
 * uploads captured the literal text "|other versions=", `meaningfulPermission()`
 * saw a populated permission field, and the pipeline refused four perfectly
 * good CC BY-SA 4.0 photographs as `rights_conflicting`.
 *
 * Worth recording precisely because it failed in the SAFE direction and was
 * therefore invisible in the outcome: the engine reported "nothing usable
 * found", which is exactly what a genuinely empty search reports. Only reading
 * the per-candidate reason showed the search had worked and the parser had not.
 * A fail-closed system still has to be right, or it fails closed on everything.
 */
export function informationField(wikitext: string, field: string): string | null {
  const re = new RegExp(`\\|\\s*${field}\\s*=([^\\n]*(?:\\n(?!\\s*[|}])[^\\n]*)*)`, "i");
  const m = re.exec(wikitext);
  if (!m) return null;
  const value = m[1].replace(/\s+/g, " ").trim();
  return value || null;
}

/**
 * A `permission=` field that actually says something.
 *
 * Empty is the NORMAL, healthy state for an own-work CC upload — every one of
 * the four accepted files in the 2026-08 batch had it empty. A populated one
 * usually points at an OTRS/VRT ticket or a restriction, and either way it is
 * a statement about rights that a human must read.
 */
export function meaningfulPermission(value: string | null): string | null {
  if (!value) return null;
  const v = value.trim();
  if (!v) return null;
  if (/^(see below|own work|self|-|n\/a|none)$/i.test(v)) return null;
  return v;
}

type NamedMeta = { name: string; value: unknown }[] | undefined;
function metaValue(meta: NamedMeta, name: string): string | null {
  if (!meta) return null;
  const hit = meta.find((m) => m.name.toLowerCase() === name.toLowerCase());
  if (!hit || hit.value === null || hit.value === undefined) return null;
  return String(hit.value).trim() || null;
}

/**
 * Rights assertions embedded in the file that CONTRADICT a free licence.
 *
 * This is the check that disqualified File:Canon_EOS_5D.jpg. It is also the
 * check that must NOT fire on the GoPro file, whose EXIF Copyright reads
 * "Francois Leblond" — a bare authorship assertion naming the photographer is
 * exactly what a correctly-licensed CC file looks like, because CC does not
 * waive copyright. Only a RESERVATION of rights is a conflict.
 */
export function exifRightsConflict(copyright: string | null): string | null {
  if (!copyright) return null;
  const v = copyright.trim();
  if (!v) return null;
  if (/all\s+rights\s+reserved/i.test(v)) return `EXIF Copyright asserts "${v}" — all rights reserved contradicts a free licence.`;
  if (/\bno\s+(unauthori[sz]ed|commercial)\s+use\b/i.test(v)) return `EXIF Copyright restricts use: "${v}".`;
  if (/\bdo\s+not\s+(copy|reproduce|distribute)\b/i.test(v)) return `EXIF Copyright forbids reuse: "${v}".`;
  if (/\bnot\s+for\s+(commercial|redistribution)\b/i.test(v)) return `EXIF Copyright restricts use: "${v}".`;
  return null;
}

// ---------------------------------------------------------------------------
// The provider
// ---------------------------------------------------------------------------

export type CommonsProviderOptions = {
  identity: SubjectIdentity;
  client?: CommonsClient;
  /** Cap on categories enumerated, so a broad tree cannot run away. */
  maxCategories?: number;
  /** Cap on files pulled from any one category. */
  maxPerCategory?: number;
};

export function createCommonsProvider(options: CommonsProviderOptions): MediaProvider {
  const client = options.client ?? new CommonsClient();
  const identity = options.identity;
  const maxCategories = options.maxCategories ?? 8;
  const maxPerCategory = options.maxPerCategory ?? 200;

  async function searchTitles(
    srsearch: string,
    namespace: 6 | 14,
    limit: number
  ): Promise<ApiResult<{ title: string; snippet?: string }[]>> {
    const r = await client.call<SearchResponse>({
      action: "query",
      list: "search",
      srsearch,
      srnamespace: String(namespace),
      srlimit: String(limit),
    });
    if (!r.ok) return r;
    return { ok: true, data: r.data.query?.search ?? [] };
  }

  /** Enumerate a category IN FULL, following continuations. */
  async function enumerateCategory(
    categoryTitle: string,
    type: "file" | "subcat"
  ): Promise<ApiResult<string[]>> {
    const titles: string[] = [];
    let cmcontinue: string | undefined;
    for (let page = 0; page < 10; page++) {
      const params: Record<string, string> = {
        action: "query",
        list: "categorymembers",
        cmtitle: categoryTitle,
        cmtype: type,
        cmlimit: "500",
      };
      if (cmcontinue) params.cmcontinue = cmcontinue;
      const r = await client.call<CategoryMembersResponse>(params);
      if (!r.ok) return r;
      for (const m of r.data.query?.categorymembers ?? []) titles.push(m.title);
      cmcontinue = r.data.continue?.cmcontinue;
      if (!cmcontinue || titles.length >= maxPerCategory) break;
    }
    return { ok: true, data: titles.slice(0, maxPerCategory) };
  }

  /** Batch-fetch categories + basic imageinfo for up to 50 file titles. */
  async function enrich(titles: string[]): Promise<ApiResult<Map<string, PageInfo>>> {
    const out = new Map<string, PageInfo>();
    for (let i = 0; i < titles.length; i += 50) {
      const batch = titles.slice(i, i + 50);
      const r = await client.call<PagesResponse>({
        action: "query",
        titles: batch.join("|"),
        prop: "categories|imageinfo",
        cllimit: "max",
        clshow: "!hidden",
        iiprop: "size|mime",
      });
      if (!r.ok) return r;
      for (const p of r.data.query?.pages ?? []) out.set(p.title, p);
    }
    return { ok: true, data: out };
  }

  return {
    approval: COMMONS_APPROVAL,

    async search(queries: ProviderQuery[], limits): Promise<SearchResult> {
      const queryLog: SearchResult["queryLog"] = [];
      const fileTitles = new Map<string, ProviderQuery>();
      const acceptedCategories = new Map<string, ProviderQuery>();
      let hardFailure: Exclude<ProviderOutcome, { status: "ok" }> | null = null;

      const note = (q: ProviderQuery, hits: number, text: string) => queryLog.push({ query: q, hits, note: text });

      // --- Phase A: locate categories -------------------------------------
      for (const q of queries) {
        if (q.strategy !== "category_lookup") continue;
        if (acceptedCategories.size >= maxCategories) break;

        const r = await searchTitles(q.value, 14, 30);
        if (!r.ok) {
          hardFailure = r.outcome;
          note(q, 0, `FAILED (${r.outcome.status}): ${"detail" in r.outcome ? r.outcome.detail : ""}`);
          continue;
        }

        const found = r.data.map((s) => s.title);
        const accepted: string[] = [];
        const refused: string[] = [];
        for (const title of found) {
          const m = matchCategoryTitle(title, identity);
          if (m.accepted) {
            accepted.push(title);
            if (!acceptedCategories.has(title)) acceptedCategories.set(title, q);
          } else {
            refused.push(`${title} — ${m.reason}`);
          }
        }

        // A BROAD lookup (manufacturer/family) also walks the subcategory tree.
        // This is the step that reaches a lowercase, differently-spelled or
        // differently-languaged product category no name query would guess.
        let subcatNote = "";
        if (q.identityTokens.length === 0) {
          for (const parent of found.slice(0, 5)) {
            const subs = await enumerateCategory(parent, "subcat");
            if (!subs.ok) {
              hardFailure = subs.outcome;
              subcatNote += ` subcat walk of ${parent} FAILED (${subs.outcome.status}).`;
              continue;
            }
            for (const sub of subs.data) {
              const m = matchCategoryTitle(sub, identity);
              if (m.accepted && !acceptedCategories.has(sub)) {
                acceptedCategories.set(sub, q);
                accepted.push(sub);
              } else if (!m.accepted && isCapturingDeviceCategory(sub)) {
                refused.push(`${sub} — capturing-device category, skipped`);
              }
            }
            subcatNote += ` walked ${subs.data.length} subcategories of ${parent};`;
          }
        }

        note(
          q,
          accepted.length,
          `namespace-14 search returned ${found.length} categor(ies); accepted ${accepted.length} [${accepted.join(", ") || "none"}]; ` +
            `refused ${refused.length}${refused.length ? `: ${refused.slice(0, 4).join(" || ")}` : ""}.${subcatNote}`
        );
      }

      // --- Phase B: enumerate every accepted category IN FULL --------------
      for (const [cat, q] of acceptedCategories) {
        const files = await enumerateCategory(cat, "file");
        if (!files.ok) {
          hardFailure = files.outcome;
          note(q, 0, `Enumerating ${cat} FAILED (${files.outcome.status}).`);
          continue;
        }
        for (const t of files.data) if (!fileTitles.has(t)) fileTitles.set(t, q);
        note(q, files.data.length, `Enumerated ${cat} IN FULL: ${files.data.length} file(s).`);
      }

      // --- Phase C: text-shaped searches, least trusted --------------------
      for (const q of queries) {
        if (fileTitles.size >= limits.maxCandidates) break;
        let srsearch: string;
        if (q.strategy === "intitle_search") srsearch = `intitle:"${q.value}"`;
        else if (q.strategy === "insource_search") srsearch = `insource:"${q.value}"`;
        else if (q.strategy === "text_search") srsearch = q.value;
        else continue;

        const r = await searchTitles(srsearch, 6, 30);
        if (!r.ok) {
          hardFailure = r.outcome;
          note(q, 0, `FAILED (${r.outcome.status}): ${"detail" in r.outcome ? r.outcome.detail : ""}`);
          continue;
        }
        let added = 0;
        for (const s of r.data) {
          if (!fileTitles.has(s.title)) {
            fileTitles.set(s.title, q);
            added++;
          }
        }
        note(q, r.data.length, `${srsearch} returned ${r.data.length} file(s), ${added} new.`);
      }

      if (fileTitles.size === 0) {
        return {
          outcome: hardFailure ?? { status: "no_results" },
          candidates: [],
          queryLog,
        };
      }

      // --- Phase D: batch-enrich so the entity gate has real descriptors ---
      const titles = [...fileTitles.keys()].slice(0, limits.maxCandidates);
      const enriched = await enrich(titles);
      const info = enriched.ok ? enriched.data : new Map<string, PageInfo>();
      if (!enriched.ok) {
        hardFailure = enriched.outcome;
        queryLog.push({
          query: { strategy: "text_search", value: "(metadata batch)", rationale: "", identityTokens: [] },
          hits: 0,
          note: `Batch metadata fetch FAILED (${enriched.outcome.status}) — candidates proceed with title-only descriptors.`,
        });
      }

      const candidates: DiscoveredCandidate[] = titles.map((title) => {
        const page = info.get(title);
        const cats = (page?.categories ?? []).map((c) => c.title);
        const mime = page?.imageinfo?.[0]?.mime ?? null;
        return {
          provider: "wikimedia_commons",
          providerRef: title,
          title,
          foundBy: fileTitles.get(title)!,
          descriptors: [...cats, ...(mime ? [`mime:${mime}`] : [])],
        };
      });

      return { outcome: { status: "ok" }, candidates, queryLog };
    },

    async resolve(candidate: DiscoveredCandidate): Promise<ResolveResult> {
      // ONE request, carrying everything needed to cross-check a claim:
      // structured licence metadata, the raw wikitext the badge is generated
      // from, the embedded EXIF, and the file's own sha1.
      const r = await client.call<PagesResponse>({
        action: "query",
        titles: candidate.providerRef,
        prop: "imageinfo|revisions|categories",
        iiprop: "url|size|mime|sha1|extmetadata|commonmetadata|metadata",
        rvprop: "content",
        rvslots: "main",
        cllimit: "max",
        clshow: "!hidden",
      });
      if (!r.ok) return { outcome: r.outcome, provenance: null };

      const page = r.data.query?.pages?.[0];
      if (!page || page.missing) {
        return {
          outcome: { status: "not_found", detail: `Commons file page missing: ${candidate.providerRef}` },
          provenance: null,
        };
      }
      const ii = page.imageinfo?.[0];
      if (!ii) {
        return {
          outcome: { status: "malformed", detail: `No imageinfo for ${candidate.providerRef}` },
          provenance: null,
        };
      }

      const wikitext = page.revisions?.[0]?.slots?.main?.content ?? "";
      const ext = ii.extmetadata ?? {};
      const extStr = (k: string): string | null => {
        const v = ext[k]?.value;
        return v === undefined || v === null ? null : String(v);
      };

      const evidence: ProvenanceRecord["evidence"] = [];
      const conflicts: string[] = [];

      // --- Licence: the template, read from raw wikitext -------------------
      const fromText = licenceFromWikitext(wikitext);
      if (fromText.licence) {
        evidence.push({
          kind: "licence_template",
          detail: `${fromText.raw} => ${fromText.licence}`,
          origin: `raw wikitext of ${candidate.providerRef} (action=query&prop=revisions&rvslots=main)`,
        });
      } else if (wikitext) {
        evidence.push({
          kind: "licence_template",
          detail: "no recognised licence template found in the wikitext",
          origin: `raw wikitext of ${candidate.providerRef}`,
        });
      }

      // --- Licence: the structured metadata --------------------------------
      const shortName = extStr("LicenseShortName");
      const usageTerms = extStr("UsageTerms");
      const licenceMetadata = shortName ?? usageTerms;
      if (licenceMetadata) {
        evidence.push({
          kind: "licence_metadata",
          detail: `LicenseShortName="${shortName ?? ""}" UsageTerms="${usageTerms ?? ""}" License="${extStr("License") ?? ""}"`,
          origin: "imageinfo extmetadata",
        });
      }

      // --- Author / source / permission ------------------------------------
      const artistHtml = extStr("Artist");
      const creator = stripHtml(artistHtml) ?? informationField(wikitext, "author")?.replace(/\[\[|\]\]/g, "") ?? null;
      const creatorPageUrl = firstHref(artistHtml);
      if (creator) {
        evidence.push({
          kind: "author_field",
          detail: `Artist="${creator}"${creatorPageUrl ? ` (${creatorPageUrl})` : ""}`,
          origin: artistHtml ? "imageinfo extmetadata Artist" : "wikitext {{Information|author=}}",
        });
      }

      const sourceField = extStr("Credit") ?? informationField(wikitext, "source");
      if (sourceField) {
        evidence.push({ kind: "source_field", detail: `source/credit="${stripHtml(sourceField)}"`, origin: "extmetadata Credit / wikitext source=" });
      }

      const permission = meaningfulPermission(informationField(wikitext, "permission"));
      evidence.push({
        kind: "permission_field",
        detail: permission ? `permission="${permission}"` : "permission= is empty, the normal state for an own-work CC upload",
        origin: "wikitext {{Information|permission=}}",
      });
      if (permission) {
        conflicts.push(
          `The permission field is populated ("${permission}"), which usually points at a VRT ticket or a condition. ` +
            "A human must read it; it is not safe to assume it agrees with the licence template."
        );
      }

      const restrictions = extStr("Restrictions");
      if (restrictions && restrictions.trim()) {
        evidence.push({ kind: "restriction_field", detail: `Restrictions="${restrictions}"`, origin: "imageinfo extmetadata" });
        conflicts.push(`Commons records a restriction on this file: "${restrictions}".`);
      }

      // --- EXIF, the cross-check ------------------------------------------
      const meta = (ii.commonmetadata ?? []).concat(ii.metadata ?? []) as NamedMeta;
      const exifArtist = metaValue(meta, "Artist");
      const exifCopyright = metaValue(meta, "Copyright");
      const exifModel = metaValue(meta, "Model");
      if (exifArtist) evidence.push({ kind: "exif_artist", detail: `EXIF Artist="${exifArtist}"`, origin: "imageinfo commonmetadata" });
      evidence.push({
        kind: "exif_copyright",
        detail: exifCopyright ? `EXIF Copyright="${exifCopyright}"` : "no EXIF Copyright field",
        origin: "imageinfo commonmetadata",
      });
      if (exifModel) {
        evidence.push({ kind: "licence_metadata", detail: `EXIF Model="${exifModel}"`, origin: "imageinfo commonmetadata" });
      }
      const exifConflict = exifRightsConflict(exifCopyright);
      if (exifConflict) conflicts.push(exifConflict);

      // --- Dimensions, type, hash ------------------------------------------
      if (ii.width && ii.height) {
        evidence.push({ kind: "file_dimensions", detail: `${ii.width}x${ii.height}`, origin: "imageinfo" });
      }
      if (ii.mime) evidence.push({ kind: "mime_type", detail: ii.mime, origin: "imageinfo" });
      if (ii.sha1) {
        evidence.push({
          kind: "content_hash",
          detail: `sha1:${ii.sha1}`,
          origin: "imageinfo sha1 of the ORIGINAL file — lets a later change at source be detected",
        });
      }
      for (const c of page.categories ?? []) {
        evidence.push({ kind: "category_membership", detail: c.title, origin: "prop=categories" });
      }

      // --- Attribution ------------------------------------------------------
      const attributionRequiredRaw = extStr("AttributionRequired");
      const effectiveLicence = fromText.licence ?? licenceMetadata;
      const attributionRequired =
        attributionRequiredRaw === null
          ? effectiveLicence
            ? !/^(cc0|public domain)/i.test(effectiveLicence)
            : null
          : /true/i.test(attributionRequiredRaw);

      const attributionFromSource = stripHtml(extStr("Attribution"));
      const attributionText =
        attributionFromSource ??
        (attributionRequired && creator && effectiveLicence
          ? `Photo: ${creator}, ${effectiveLicence}, via Wikimedia Commons`
          : null);

      const provenance: ProvenanceRecord = {
        provider: "wikimedia_commons",
        providerRef: candidate.providerRef,
        originalFileUrl: ii.url ?? null,
        sourcePageUrl: ii.descriptionurl ?? `https://commons.wikimedia.org/wiki/${encodeURIComponent(candidate.providerRef.replace(/ /g, "_"))}`,
        originalFileName: candidate.providerRef.replace(/^File:/i, ""),
        creator,
        creatorPageUrl,
        licenceDeclared: fromText.licence,
        licenceMetadata,
        licenceUrl: deedUrl(effectiveLicence),
        attributionRequired,
        attributionText,
        acquiredAt: new Date().toISOString(),
        verifiedAt: new Date().toISOString(),
        width: ii.width ?? null,
        height: ii.height ?? null,
        mimeType: ii.mime ?? null,
        byteSize: ii.size ?? null,
        contentHash: ii.sha1 ? `sha1:${ii.sha1}` : null,
        evidence,
        conflicts,
      };

      return { outcome: { status: "ok" }, provenance };
    },
  };
}
