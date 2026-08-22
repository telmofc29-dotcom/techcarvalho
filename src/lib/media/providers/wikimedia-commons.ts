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
  ParseAnomaly,
  ProvenanceRecord,
  ProviderApproval,
  ProviderAttestation,
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
 * A value a reader produced that nobody should believe.
 *
 * The whole reason this type exists: the `|other versions=` bug produced a
 * PERFECTLY WELL-FORMED string. No exception, no null, no error to log — just
 * the wrong answer, delivered confidently, in the safe direction. There is
 * nothing to catch. The only defence is to look at what came out and ask
 * whether a permission field could plausibly say that.
 */
export type FieldParse =
  /** The field is not in the wikitext at all. */
  | { status: "absent" }
  /** The field is present and empty — the healthy state for `permission=`. */
  | { status: "empty" }
  | { status: "parsed"; value: string }
  /**
   * The field was found and what came out is not believable. NEVER silently
   * downgraded to "absent" or "empty": that is how a parser bug becomes an
   * honest-looking result.
   */
  | { status: "ambiguous"; value: string; anomaly: ParseAnomaly };

/**
 * Is this extracted value evidence that the extractor lost its place?
 *
 * Two checks, both derived from the real incident rather than invented:
 *
 * 1. **A sibling field inside the value.** When `informationField()` looked
 *    ahead for `\n|<name>=` with `<name>` matching `[a-zA-Z_]+`, it could not
 *    see `other versions` — the space — so `permission=` returned the literal
 *    string `|other versions=`. Any `|name=` sitting at brace depth ZERO in a
 *    value means a neighbouring field was swallowed. Depth matters: a legitimate
 *    `{{fr|1=Caméra GoPro}}` contains `|1=` at depth one and is fine.
 *
 * 2. **Unbalanced `{{`/`[[`.** A value that opens a template and never closes
 *    it was cut in the wrong place, so whatever it says is a fragment.
 *
 * Exported because the regression test feeds it the exact string the old parser
 * produced. If that bug ever returns, this fires on its output.
 */
export function fieldValueAnomaly(field: string, value: string): ParseAnomaly | null {
  const swallowed = swallowedSiblingField(value);
  if (swallowed) {
    return {
      where: `informationField(${field})`,
      detail:
        `the extracted value contains the start of another template field ("|${swallowed}=") at brace depth zero, ` +
        `so the reader ran past the end of "${field}=" and captured its neighbour. Extracted: "${truncate(value)}". ` +
        "This is the shape of the `|other versions=` regression, which refused four correctly-licensed photographs.",
    };
  }

  const unbalanced = unbalancedDelimiters(value);
  if (unbalanced) {
    return {
      where: `informationField(${field})`,
      detail:
        `the extracted value has ${unbalanced}, so it is a fragment of a template rather than a field value. ` +
        `Extracted: "${truncate(value)}".`,
    };
  }
  return null;
}

function truncate(value: string, limit = 120): string {
  return value.length > limit ? `${value.slice(0, limit - 3)}…` : value;
}

/** Name of a `|name=` found at brace depth zero inside a value, if any. */
function swallowedSiblingField(value: string): string | null {
  let braces = 0;
  let brackets = 0;
  for (let i = 0; i < value.length; i++) {
    if (value.startsWith("{{", i)) { braces++; i++; continue; }
    if (value.startsWith("}}", i)) { braces = Math.max(0, braces - 1); i++; continue; }
    if (value.startsWith("[[", i)) { brackets++; i++; continue; }
    if (value.startsWith("]]", i)) { brackets = Math.max(0, brackets - 1); i++; continue; }
    if (value[i] !== "|" || braces > 0 || brackets > 0) continue;
    // A pipe at depth zero followed by a plausible field name and an "=".
    const m = /^\|\s*([A-Za-z][A-Za-z0-9 _-]{0,30}?)\s*=/.exec(value.slice(i));
    if (m) return m[1].trim();
  }
  return null;
}

function unbalancedDelimiters(value: string): string | null {
  const opens = (value.match(/\{\{/g) ?? []).length;
  const closes = (value.match(/\}\}/g) ?? []).length;
  if (opens !== closes) return `${opens} "{{" against ${closes} "}}"`;
  const openLinks = (value.match(/\[\[/g) ?? []).length;
  const closeLinks = (value.match(/\]\]/g) ?? []).length;
  if (openLinks !== closeLinks) return `${openLinks} "[[" against ${closeLinks} "]]"`;
  return null;
}

/**
 * Pull a named field out of an {{Information}} template, and say how confident
 * the extraction is.
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
 *
 * So the fix is two-part and the second part is the one that generalises: the
 * regex is correct now, AND the result is checked for the signature of having
 * been extracted wrongly. A future parser bug of the same family produces an
 * `ambiguous` parse, which resolve() turns into an explicit
 * PROVIDER_PARSE_FAILURE instead of a quiet refusal.
 */
export function parseInformationField(wikitext: string, field: string): FieldParse {
  const re = new RegExp(`\\|\\s*${field}\\s*=([^\\n]*(?:\\n(?!\\s*[|}])[^\\n]*)*)`, "gi");
  const values: string[] = [];
  for (const m of wikitext.matchAll(re)) values.push(m[1].replace(/\s+/g, " ").trim());

  if (values.length === 0) return { status: "absent" };

  // The same field declared twice with different content: MediaWiki resolves
  // this by taking the last, we have no way to know which the uploader meant,
  // and guessing about a rights field is the thing this module refuses to do.
  //
  // Empty counts as a value here: one declaration saying nothing and another
  // pointing at a VRT ticket is the WORST version of this, not an exception to
  // it — the empty one is the reading that would let the file through.
  const distinct = new Set(values);
  if (distinct.size > 1) {
    return {
      status: "ambiguous",
      value: values[0],
      anomaly: {
        where: `informationField(${field})`,
        detail:
          `"${field}=" appears ${values.length} times with ${distinct.size} different values ` +
          `(${[...distinct].map((v) => `"${truncate(v)}"`).join(", ")}). Which one the uploader meant is not readable from here.`,
      },
    };
  }

  const value = values[0];
  if (!value) return { status: "empty" };

  const anomaly = fieldValueAnomaly(field, value);
  if (anomaly) return { status: "ambiguous", value, anomaly };
  return { status: "parsed", value };
}

/**
 * Value-or-null convenience over `parseInformationField`.
 *
 * An `ambiguous` parse returns its raw value here rather than null, so a caller
 * that does not ask about ambiguity behaves exactly as before — conservatively.
 * Callers that make a RIGHTS decision must use `parseInformationField` and
 * treat `ambiguous` as a parse failure; resolve() does.
 */
export function informationField(wikitext: string, field: string): string | null {
  const parsed = parseInformationField(wikitext, field);
  switch (parsed.status) {
    case "absent":
    case "empty":
      return null;
    case "parsed":
    case "ambiguous":
      return parsed.value || null;
  }
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

/**
 * The result of reading ONE embedded-metadata field — with "I could not read
 * this" as a first-class answer rather than as a null.
 *
 * WHY THIS TYPE EXISTS AT ALL
 * ---------------------------
 * The first fix for the lang-structured bug returned `null` for every shape it
 * could not interpret. `null` is the same value this reader returns for a file
 * that carries no Copyright field at all — so "this file says nothing about
 * rights" and "this file says something about rights and we could not read it"
 * arrived at the rights check as the identical answer, and the identical answer
 * is *proceed*.
 *
 * That is the SAME failure as the bug it was fixing, one layer up: a rights
 * assertion made invisible by a reader that could not parse it. Returning null
 * is quieter than returning "[object Object]" and no safer.
 *
 * For rights-bearing metadata the unreadable case therefore STOPS the
 * candidate. For descriptive metadata (Model, and the identity half of Artist)
 * it does not, and `metaValue()` below is the deliberately lax reader for those
 * — an unreadable camera model is not a rights claim, and refusing a file over
 * one would be refusing it for a reason that has nothing to do with rights.
 */
export type MetaRead =
  /** No entry with this name in `commonmetadata` or `metadata`. */
  | { status: "absent" }
  /** Entry present, value empty/whitespace/an empty container: it asserts nothing. */
  | { status: "empty" }
  /** Interpreted. */
  | { status: "read"; value: string }
  /**
   * The entry is THERE and its shape is not one this reader models. Never
   * collapsed to `absent` or `empty`: for a rights-bearing field this is a stop.
   */
  | { status: "unreadable"; detail: string }
  /**
   * The same field arrived more than once carrying materially different values.
   * Resolved by NOBODY — not by taking the first, which is what a plain
   * `.find()` does and what the previous fix still did across the two buckets.
   */
  | { status: "disagreeing"; values: string[]; detail: string };

/** JSON of a value we are about to refuse, so a human can see the real shape. */
function rawShape(value: unknown): string {
  try {
    const json = JSON.stringify(value);
    return truncate(json === undefined ? String(value) : json, 200);
  } catch {
    return "(a value that could not even be serialised)";
  }
}

function isNamedEntry(e: unknown): e is { name: unknown; value: unknown } {
  return typeof e === "object" && e !== null && !Array.isArray(e) && "name" in e && "value" in e;
}

/**
 * Every string anywhere inside an embedded value, whatever shape it is in.
 *
 * The reservation scan runs over THIS rather than over the interpreted value,
 * so a rights reservation buried in a structure this reader cannot interpret is
 * still seen. "We could not parse it" must never be the reason a file's own
 * "all rights reserved" goes unnoticed — that is precisely how the original bug
 * did its damage.
 */
export function embeddedStrings(value: unknown, budget = 400): string[] {
  const out: string[] = [];
  const walk = (v: unknown, depth: number): void => {
    if (out.length >= budget || depth > 12) return;
    if (typeof v === "string") {
      if (v.trim()) out.push(v.trim());
      return;
    }
    if (Array.isArray(v)) {
      for (const item of v) walk(item, depth + 1);
      return;
    }
    if (typeof v === "object" && v !== null) {
      for (const item of Object.values(v as Record<string, unknown>)) walk(item, depth + 1);
    }
  };
  walk(value, 0);
  return out;
}

/**
 * Unwrap one embedded-metadata value.
 *
 * THE BUG THIS FIXES, verified against live Commons on 2026-08-22.
 *
 * MediaWiki returns some embedded metadata as a LANGUAGE-STRUCTURED value, and
 * real files do it for exactly the field the rights cross-check depends on:
 *
 *   File:Canon EOS 5D.jpg  commonmetadata.Copyright =
 *     [{"name":"x-default","value":"©2008 Charles Lanteigne"},
 *      {"name":"_type","value":"lang"}]
 *
 * `String(hit.value).trim()` turns that into the literal string
 * "[object Object],[object Object]". That string was then handed to
 * exifRightsConflict() — which therefore could not fire on ANY lang-typed EXIF
 * Copyright, whatever it said — and stored verbatim as primary provenance
 * evidence. File:Canon EOS 5D.jpg is the file this project cites as the reason
 * the check exists, and it was coming out evidence_complete.
 *
 * It failed OPEN, which is what makes it the worst of the three: a rights
 * reservation written in the file's own metadata was invisible, and the
 * resulting asset looked fully evidenced.
 *
 * The correct flat value is present in the same response under `metadata`;
 * resolve() concatenates `commonmetadata` first, so `.find()` reached the
 * broken one. Rather than depend on ordering, the structured shape is unwrapped
 * here: x-default first, then en, then the first entry that is not the `_type`
 * marker.
 *
 * MediaWiki's structured forms, all three of which are live on Commons today:
 *
 *   _type "lang"  a language map. File:GoPro Héro 13 Black - 01.jpg Copyright.
 *   _type "ol"    an ORDERED LIST with numeric names. File:Canon EOS 5D.jpg
 *                 Artist = [{"name":0,"value":"Charles Lanteigne"},{"name":"_type","value":"ol"}].
 *                 Reading only the first item of a list is the same
 *                 pick-the-first mistake in miniature, so every item is kept.
 *   _type "ul"    an unordered list, same treatment.
 *
 * Anything else is `unreadable`, NOT null — see `MetaRead`.
 */
export function unwrapMetaRead(value: unknown): MetaRead {
  if (value === null || value === undefined) return { status: "empty" };
  if (typeof value === "string") {
    const v = value.trim();
    if (!v) return { status: "empty" };
    if (isStringificationArtifact(v)) {
      return {
        status: "unreadable",
        detail:
          `the value arrived as "${truncate(v)}" — a stringified object, which is what the 2026-08 reader produced ` +
          "for every lang-structured Copyright field. It says nothing about the file and must not be read as if it did.",
      };
    }
    return { status: "read", value: v };
  }
  // A number or a boolean is unambiguously readable — there is no parse in
  // doubt, the value simply is not prose. `Copyright: 2008` is a scalar that
  // says what it says.
  if (typeof value === "number" || typeof value === "boolean") return { status: "read", value: String(value) };
  if (Array.isArray(value)) return unwrapStructuredMeta(value);
  return {
    status: "unreadable",
    detail: `an object carrying no MediaWiki "_type" marker, so which of its keys is the value is a guess: ${rawShape(value)}`,
  };
}

function unwrapStructuredMeta(value: unknown[]): MetaRead {
  if (value.length === 0) return { status: "empty" };

  const entries = value.filter(isNamedEntry);
  if (entries.length !== value.length) {
    return {
      status: "unreadable",
      detail:
        "an array whose elements are not MediaWiki {name, value} entries. Picking one of them, or joining them, " +
        `would be inventing a reading: ${rawShape(value)}`,
    };
  }

  const marker = entries.find((e) => String(e.name).toLowerCase() === "_type");
  const type = marker === undefined ? null : String(marker.value).toLowerCase();
  const items = entries.filter((e) => String(e.name).toLowerCase() !== "_type");

  if (items.length === 0) {
    return {
      status: "unreadable",
      detail:
        `a ${type ?? "structured"}-typed value that carries the "_type" marker and no entries at all. The field is ` +
        `present and its content is missing, which is not the same as the field being absent: ${rawShape(value)}`,
    };
  }

  if (type === null || type === "lang") {
    const named = (want: string) => items.find((e) => String(e.name).toLowerCase() === want);
    const picked = named("x-default") ?? named("en") ?? items[0];
    const inner = unwrapMetaRead(picked.value);
    if (inner.status === "unreadable") {
      return {
        status: "unreadable",
        detail: `the "${String(picked.name)}" entry of a language-structured value is itself unreadable — ${inner.detail}`,
      };
    }
    // Only one language is REPORTED, which is a presentation choice. It is not
    // a rights choice: `embeddedStrings()` scans every language, so a
    // reservation written only in the French entry is still seen.
    return inner;
  }

  if (type === "ol" || type === "ul") {
    const parts: string[] = [];
    for (const item of items) {
      const inner = unwrapMetaRead(item.value);
      if (inner.status === "unreadable") {
        return { status: "unreadable", detail: `item "${String(item.name)}" of a ${type} value is unreadable — ${inner.detail}` };
      }
      if (inner.status === "read") parts.push(inner.value);
    }
    if (parts.length === 0) return { status: "empty" };
    return { status: "read", value: parts.join("; ") };
  }

  return {
    status: "unreadable",
    detail: `an unrecognised MediaWiki structured value, "_type":"${type}": ${rawShape(value)}`,
  };
}

/**
 * Value-or-null unwrap. The LAX reader — see `MetaRead` for why that is a
 * category and not an oversight. Unreadable and empty both come back null, so
 * this must not be used for a field a rights decision is made from.
 */
export function unwrapMetaValue(value: unknown): string | null {
  const read = unwrapMetaRead(value);
  return read.status === "read" ? read.value : null;
}

/** Every entry in either bucket carrying this field name. */
function metaEntries(meta: NamedMeta, name: string): { name: string; value: unknown }[] {
  if (!meta) return [];
  return meta.filter((m) => String(m.name).toLowerCase() === name.toLowerCase());
}

/** Whitespace/case/unicode-insensitive form, used ONLY to compare two readings. */
function comparableMeta(value: string): string {
  return value.normalize("NFC").replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * STRICT read of one embedded field, across both metadata buckets.
 *
 * Three things this does that `metaValue()` does not, each of which is a way the
 * previous fix could still lose a rights assertion:
 *
 * 1. **Unreadable is reported**, not converted into null.
 * 2. **Every entry is read**, and if two of them disagree the answer is
 *    `disagreeing` — NOT the first one. `commonmetadata` and `metadata` are two
 *    renderings of the same embedded block; if they render different text, one
 *    of them is wrong and picking either is guessing about rights. The previous
 *    fix iterated all entries but returned the first READABLE one, so a benign
 *    `commonmetadata.Copyright` sitting in front of a restrictive
 *    `metadata.Copyright` would have silenced the restriction — the original
 *    failure mode with the ordering reversed.
 * 3. **An empty entry never outvotes a populated one.** MediaWiki routinely
 *    renders one bucket and not the other; an entry that says nothing is not a
 *    second opinion. (Unlike a wikitext field declared twice, where empty IS a
 *    competing declaration — see `parseInformationField`. Two renderings of one
 *    embedded block and two authored declarations are different situations.)
 */
export function readEmbeddedField(meta: NamedMeta, name: string): MetaRead {
  const hits = metaEntries(meta, name);
  if (hits.length === 0) return { status: "absent" };

  const reads = hits.map((h) => unwrapMetaRead(h.value));

  const unreadable = reads.filter((r): r is Extract<MetaRead, { status: "unreadable" }> => r.status === "unreadable");
  if (unreadable.length > 0) {
    return {
      status: "unreadable",
      detail:
        `"${name}" is present in the file's embedded metadata and could not be interpreted: ` +
        unreadable.map((u) => u.detail).join(" — and separately: "),
    };
  }

  const byComparable = new Map<string, string>();
  for (const r of reads) {
    if (r.status !== "read") continue;
    const key = comparableMeta(r.value);
    if (!byComparable.has(key)) byComparable.set(key, r.value);
  }

  const values = [...byComparable.values()];
  if (values.length === 0) return { status: "empty" };
  if (values.length === 1) return { status: "read", value: values[0] };
  return {
    status: "disagreeing",
    values,
    detail:
      `"${name}" appears ${hits.length} times in the embedded metadata with ${values.length} different values ` +
      `(${values.map((v) => `"${truncate(v)}"`).join(", ")}). Which one the file actually asserts is not readable from here.`,
  };
}

/**
 * First readable value for a field. The LAX reader, kept for DESCRIPTIVE fields
 * (camera Model, the identity half of Artist) where an uninterpretable value is
 * a missing caption rather than a missing permission.
 *
 * Do not call this for a field a rights decision rests on. `readEmbeddedField()`
 * is the one that can say "unreadable" and "these two disagree"; this one
 * cannot, by construction.
 */
export function metaValue(meta: NamedMeta, name: string): string | null {
  for (const hit of metaEntries(meta, name)) {
    const unwrapped = unwrapMetaValue(hit.value);
    if (unwrapped !== null) return unwrapped;
  }
  return null;
}

/**
 * Rights assertions embedded in the file that CONTRADICT a free licence.
 *
 * This is the check the project believed had disqualified File:Canon_EOS_5D.jpg.
 * It is also the check that must NOT fire on the GoPro file, whose EXIF
 * Copyright reads "Francois Leblond" — a bare authorship assertion naming the
 * photographer is exactly what a correctly-licensed CC file looks like, because
 * CC does not waive copyright. Only a RESERVATION of rights is a conflict.
 */
const RIGHTS_RESERVATION_PATTERNS: [RegExp, (field: string, v: string) => string][] = [
  [/all\s+rights\s+reserved/i, (f, v) => `${f} asserts "${v}" — all rights reserved contradicts a free licence.`],
  [/\bno\s+(unauthori[sz]ed|commercial)\s+use\b/i, (f, v) => `${f} restricts use: "${v}".`],
  [/\bdo\s+not\s+(copy|reproduce|distribute)\b/i, (f, v) => `${f} forbids reuse: "${v}".`],
  [/\bnot\s+for\s+(commercial|redistribution)\b/i, (f, v) => `${f} restricts use: "${v}".`],
  // ADDED 2026-08-22 after reading the live embedded metadata of the very file
  // this project cites as the reason the check exists. File:Canon EOS 5D.jpg
  // carries, in `commonmetadata.UsageTerms`, lang-structured:
  //
  //   "No Usage Rights Granted Without Written Authorization from Charles Lanteigne"
  //
  // Not one of the four patterns above matches that sentence. The four were
  // written from the phrase a human had quoted, not from what the file says.
  [/\bno\s+(usage\s+)?rights?\s+(are\s+|is\s+)?granted\b/i, (f, v) => `${f} states that no rights are granted: "${v}".`],
  [
    /\bwithout\s+(prior\s+|express\s+|explicit\s+)*written\s+(authori[sz]ation|permission|consent|approval)\b/i,
    (f, v) => `${f} requires prior written permission, which is not a free grant: "${v}".`,
  ],
  [
    /\b(unauthori[sz]ed|unauthorised)\s+(use|reproduction|duplication|copying|distribution)\b/i,
    (f, v) => `${f} restricts use: "${v}".`,
  ],
  [
    /\bmay\s+not\s+be\s+(used|reused|reproduced|copied|distributed|republished|published|sold)\b/i,
    (f, v) => `${f} forbids reuse: "${v}".`,
  ],
  [/\b(written\s+)?permission\s+(is\s+)?required\b/i, (f, v) => `${f} requires permission: "${v}".`],
  [/\bcommercial\s+use\s+(is\s+)?(strictly\s+)?(prohibited|forbidden|not\s+permitted)\b/i, (f, v) => `${f} restricts use: "${v}".`],
];

/**
 * A value that reached us as a stringified object — the ORIGINAL BUG's own
 * output, "[object Object],[object Object]".
 *
 * Kept separate from the reservation patterns because it is not a statement the
 * FILE makes; it is evidence that something upstream lost the value. So it
 * makes a field `unreadable` (a reader defect, PROVIDER_PARSE_FAILURE) rather
 * than a rights conflict. `embeddedRightsConflict()` still refuses it outright,
 * as a net under any caller that hands a raw string straight to the check.
 */
export function isStringificationArtifact(value: string): boolean {
  return /\[object (Object|Array|Null|Undefined)\]/.test(value);
}

/**
 * Rights assertions embedded in a file that CONTRADICT a free licence, for any
 * rights-bearing embedded field.
 *
 * "Some rights reserved" is deliberately absent from the patterns: it is
 * Creative Commons' own tagline, and a check that fires on it would refuse
 * exactly the files this pipeline exists to find.
 */
export function embeddedRightsConflict(field: string, value: string | null): string | null {
  if (!value) return null;
  const v = value.trim();
  if (!v) return null;
  if (isStringificationArtifact(v)) {
    return (
      `${field} could not be read: the value arrived as "${v}", which is a stringified object rather than anything ` +
      "the file asserts. A rights field whose content we cannot see is not a rights field that says nothing."
    );
  }
  return rightsReservationMessage(field, v);
}

/** Only a RESERVATION written by the file — no reader-defect detection. */
function rightsReservationMessage(field: string, value: string): string | null {
  for (const [pattern, message] of RIGHTS_RESERVATION_PATTERNS) {
    if (pattern.test(value)) return message(field, value);
  }
  return null;
}

export function exifRightsConflict(copyright: string | null): string | null {
  return embeddedRightsConflict("EXIF Copyright", copyright);
}

/**
 * Embedded fields that ASSERT TERMS, and are therefore read strictly: an
 * unreadable one stops the candidate.
 *
 * `Artist` and `Credit` are not in this list — they are identity fields, and an
 * unreadable one is a missing credit rather than a hidden restriction, which is
 * not worth refusing a correctly-licensed photograph over. They ARE scanned for
 * reservation text (below), because a photographer who writes "© X, all rights
 * reserved" into the Artist field has still written a reservation.
 */
export const RIGHTS_BEARING_EMBEDDED_FIELDS = [
  "Copyright",
  "UsageTerms",
  "CopyrightNotice",
  "Rights",
  "WebStatement",
] as const;

/** Additionally scanned for reservation text, but not strictly required to parse. */
export const RIGHTS_SCANNED_EMBEDDED_FIELDS = [...RIGHTS_BEARING_EMBEDDED_FIELDS, "Artist", "Credit"] as const;

/** How a field is named in a conflict message. */
function embeddedFieldLabel(field: string): string {
  return field === "Copyright" ? "EXIF Copyright" : `Embedded ${field}`;
}

export type EmbeddedRightsReading = {
  /** Conflicts to record on the provenance record. Any one of these blocks. */
  conflicts: string[];
  /** Evidence lines describing what was read, and from where. */
  notes: { field: string; detail: string }[];
  /**
   * Rights-bearing fields that are PRESENT and could not be interpreted, and in
   * which no reservation text was visible either. Non-empty means the candidate
   * must stop as a PARSE FAILURE: we are looking at a rights assertion we cannot
   * read, and "could not read" is not "says nothing".
   */
  unreadable: { field: string; detail: string }[];
};

/**
 * Read every rights-bearing embedded field, failing closed on the unknown.
 *
 * Order of precedence, and it matters:
 *
 *   1. A reservation VISIBLE anywhere inside the raw value wins, whatever shape
 *      the value is in. That is a fact about the FILE, and it is more useful to
 *      a human than "we could not parse it".
 *   2. Otherwise, an uninterpretable rights-bearing field is a PARSE FAILURE —
 *      it says the reader is wrong, not the file, which is the same distinction
 *      resolve() already draws for an ambiguous {{Information}} field.
 *   3. Two readings that disagree are a CONFLICT: the file contradicts itself
 *      and neither reading may be preferred.
 */
export function readEmbeddedRights(meta: NamedMeta): EmbeddedRightsReading {
  const conflicts: string[] = [];
  const notes: { field: string; detail: string }[] = [];
  const unreadable: { field: string; detail: string }[] = [];
  const reserved = new Set<string>();

  // (1) The reservation scan, over EVERY string inside every entry — including
  //     entries whose overall shape is not interpretable.
  for (const field of RIGHTS_SCANNED_EMBEDDED_FIELDS) {
    for (const entry of metaEntries(meta, field)) {
      for (const text of embeddedStrings(entry.value)) {
        // Deliberately the RESERVATION check only. A stringification artifact
        // found in here is a reader defect, and must route to `unreadable`
        // below rather than be reported as something the file says.
        const conflict = rightsReservationMessage(embeddedFieldLabel(field), text);
        if (!conflict) continue;
        reserved.add(field);
        if (!conflicts.includes(conflict)) conflicts.push(conflict);
      }
    }
  }

  // (2)/(3) The strict read.
  for (const field of RIGHTS_BEARING_EMBEDDED_FIELDS) {
    const read = readEmbeddedField(meta, field);
    switch (read.status) {
      case "absent":
        break;
      case "empty":
        notes.push({ field, detail: `embedded ${field} is present and empty` });
        break;
      case "read":
        notes.push({ field, detail: `embedded ${field}="${read.value}"` });
        break;
      case "disagreeing": {
        notes.push({ field, detail: `embedded ${field} DISAGREES WITH ITSELF: ${read.detail}` });
        const conflict =
          `The file's own embedded metadata gives ${field} more than once with different content: ${read.detail} ` +
          "Neither reading may be preferred over the other, and the permissive one is exactly the one a " +
          "pick-the-first reader would have chosen.";
        if (!conflicts.includes(conflict)) conflicts.push(conflict);
        break;
      }
      case "unreadable":
        notes.push({ field, detail: `embedded ${field} UNREADABLE: ${read.detail}` });
        if (!reserved.has(field)) unreadable.push({ field, detail: read.detail });
        break;
    }
  }

  return { conflicts, notes, unreadable };
}

/**
 * Turn an original Commons file URL into a standard-bucket thumbnail URL.
 *
 * `https://upload.wikimedia.org/wikipedia/commons/5/5e/Foo.jpg?utm_source=…`
 *   -> `https://upload.wikimedia.org/wikipedia/commons/thumb/5/5e/Foo.jpg/1920px-Foo.jpg`
 *
 * Returns the original URL unchanged when the path is not in the expected
 * hashed-directory form, so an unfamiliar layout downloads the full-size
 * original rather than a URL this function guessed at.
 */
export function commonsThumbUrl(originalUrl: string, width: number): string {
  let parsed: URL;
  try {
    parsed = new URL(originalUrl);
  } catch {
    return originalUrl;
  }
  // Drop the query string entirely — it is analytics, not part of the path.
  const path = parsed.pathname;
  const match = /^(.*\/commons)\/([0-9a-f])\/([0-9a-f]{2})\/([^/]+)$/.exec(path);
  if (!match) return `${parsed.origin}${path}`;
  const [, prefix, d1, d2, file] = match;
  return `${parsed.origin}${prefix}/thumb/${d1}/${d2}/${file}/${width}px-${file}`;
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

  // --- What this provider can PROVE about the responses it read -------------
  //
  // `{ status: "no_results" }` is a claim, and a claim from the component whose
  // reader might be the broken thing. So every call is counted, and every
  // response that arrives in a shape this code does not recognise is recorded
  // as an anomaly rather than quietly coalescing to an empty array — which is
  // what `r.data.query?.search ?? []` did, and which is indistinguishable from
  // Commons genuinely having nothing.
  let responsesParsed = 0;
  let responsesFailed = 0;
  let parseAnomalies: ParseAnomaly[] = [];

  function resetAttestation(): void {
    responsesParsed = 0;
    responsesFailed = 0;
    parseAnomalies = [];
  }

  function attestation(): ProviderAttestation {
    return { responsesParsed, responsesFailed, parseAnomalies: [...parseAnomalies] };
  }

  /** Every API call goes through here so nothing can be read without being counted. */
  async function call<T>(params: Record<string, string>): Promise<ApiResult<T>> {
    const r = await client.call<T>(params);
    if (r.ok) responsesParsed++;
    else responsesFailed++;
    return r;
  }

  /**
   * A response that parsed as JSON but does not contain the key we asked for.
   *
   * MediaWiki returns `query.search: []` for a search with no hits, so an
   * ABSENT key is not "no hits" — it is a response we do not understand.
   * Recorded as an anomaly and reported as zero rows: the search continues (a
   * later query may still find something) but the run can no longer classify
   * as NO_RESULTS, because NO_RESULTS means we read the answer.
   */
  function noteShapeAnomaly(where: string, detail: string): void {
    parseAnomalies.push({ where, detail });
  }

  async function searchTitles(
    srsearch: string,
    namespace: 6 | 14,
    limit: number
  ): Promise<ApiResult<{ title: string; snippet?: string }[]>> {
    const r = await call<SearchResponse>({
      action: "query",
      list: "search",
      srsearch,
      srnamespace: String(namespace),
      srlimit: String(limit),
    });
    if (!r.ok) return r;
    if (!Array.isArray(r.data.query?.search)) {
      noteShapeAnomaly(
        "commons list=search",
        `the response to srsearch="${srsearch}" (ns ${namespace}) carried no query.search array. MediaWiki returns an ` +
          "EMPTY array for a search with no hits, so a missing one is a response shape this code does not understand — " +
          "not a finding that nothing matched."
      );
      return { ok: true, data: [] };
    }
    return { ok: true, data: r.data.query.search };
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
      const r = await call<CategoryMembersResponse>(params);
      if (!r.ok) return r;
      if (!Array.isArray(r.data.query?.categorymembers)) {
        noteShapeAnomaly(
          "commons list=categorymembers",
          `enumerating ${categoryTitle} (${type}) returned a body with no query.categorymembers array. An empty ` +
            "category yields an empty array, so this is an unrecognised response rather than an empty category."
        );
        break;
      }
      for (const m of r.data.query.categorymembers) titles.push(m.title);
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
      const r = await call<PagesResponse>({
        action: "query",
        titles: batch.join("|"),
        prop: "categories|imageinfo",
        cllimit: "max",
        clshow: "!hidden",
        iiprop: "size|mime",
      });
      if (!r.ok) return r;
      if (!Array.isArray(r.data.query?.pages)) {
        noteShapeAnomaly(
          "commons prop=categories|imageinfo",
          `the metadata batch for ${batch.length} title(s) carried no query.pages array. Every candidate in this ` +
            "batch would proceed with a title-only descriptor, which weakens the entity gate silently."
        );
        continue;
      }
      for (const p of r.data.query.pages) out.set(p.title, p);
    }
    return { ok: true, data: out };
  }

  return {
    approval: COMMONS_APPROVAL,

    async search(queries: ProviderQuery[], limits): Promise<SearchResult> {
      resetAttestation();
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
        // `no_results` here is a POSITIVE claim — "every query ran and Commons
        // has nothing" — so it ships with the count of responses actually read
        // and parsed, and with any response whose shape this code did not
        // recognise. Without that, an empty shelf and a broken reader produce
        // the identical line in a summary, which is the bug this whole taxonomy
        // exists to make impossible.
        return {
          outcome: hardFailure ?? { status: "no_results" },
          candidates: [],
          queryLog,
          attestation: attestation(),
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

      return { outcome: { status: "ok" }, candidates, queryLog, attestation: attestation() };
    },

    async resolve(candidate: DiscoveredCandidate): Promise<ResolveResult> {
      // ONE request, carrying everything needed to cross-check a claim:
      // structured licence metadata, the raw wikitext the badge is generated
      // from, the embedded EXIF, and the file's own sha1.
      const r = await call<PagesResponse>({
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

      // A body with no `query.pages` array at all is not "the page is missing"
      // — MediaWiki reports a missing page AS a page, with `missing: true`. The
      // two must not collapse: one is a fact about Commons, the other is a
      // response we did not understand.
      if (!Array.isArray(r.data.query?.pages)) {
        return {
          outcome: {
            status: "malformed",
            detail:
              `The resolve response for ${candidate.providerRef} carried no query.pages array. A missing file is ` +
              "reported by MediaWiki as a page object with missing:true, so this is an unrecognised response shape.",
          },
          provenance: null,
        };
      }
      const page = r.data.query.pages[0];
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

      // --- Can we read this page's own {{Information}} template at all? -----
      //
      // THE CHECK THE `|other versions=` BUG NEEDED. Every field this module
      // makes a rights decision from is parsed here first, and a parse that
      // produced something implausible stops the candidate as an explicit
      // PARSE FAILURE rather than flowing on as a "populated permission field"
      // — which is a rights CONFLICT, a refusal, and indistinguishable in the
      // summary from a file that genuinely carries a condition.
      //
      // Both are refusals; the difference is entirely in what they tell a
      // human. One says "read this file's permission note", the other says
      // "fix this parser". The first bug cost four photographs because it only
      // ever said the first thing.
      for (const field of ["permission", "author", "source"] as const) {
        const parsed = parseInformationField(wikitext, field);
        if (parsed.status !== "ambiguous") continue;
        return {
          outcome: {
            status: "malformed",
            detail:
              `Could not read {{Information|${field}=}} on ${candidate.providerRef}: ${parsed.anomaly.detail} ` +
              "Refused as a PARSE FAILURE, not as a rights finding — this says the reader is wrong, not the file.",
          },
          provenance: null,
        };
      }

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
      //
      // Both buckets, concatenated. `commonmetadata` is the raw common set and
      // `metadata` the formatted one; the SAME field appears in both, and on
      // real files it appears in two different SHAPES (see unwrapMetaRead).
      const meta = (ii.commonmetadata ?? []).concat(ii.metadata ?? []) as NamedMeta;

      // Descriptive reads: lax on purpose. An unreadable camera model is not a
      // rights claim and must not refuse a correctly-licensed photograph.
      const exifArtist = metaValue(meta, "Artist");
      const exifModel = metaValue(meta, "Model");
      if (exifArtist) evidence.push({ kind: "exif_artist", detail: `EXIF Artist="${exifArtist}"`, origin: "imageinfo commonmetadata" });

      // Rights reads: strict. Unreadable is a stop, disagreement is a conflict,
      // and every rights-bearing field is read — not only `Copyright`.
      const embeddedRights = readEmbeddedRights(meta);
      const copyrightRead = readEmbeddedField(meta, "Copyright");
      evidence.push({
        kind: "exif_copyright",
        detail:
          copyrightRead.status === "read"
            ? `EXIF Copyright="${copyrightRead.value}"`
            : copyrightRead.status === "disagreeing"
              ? `EXIF Copyright DISAGREES WITH ITSELF: ${copyrightRead.detail}`
              : copyrightRead.status === "unreadable"
                ? `EXIF Copyright is PRESENT AND UNREADABLE: ${copyrightRead.detail}`
                : "no EXIF Copyright field",
        origin: "imageinfo commonmetadata/metadata",
      });
      for (const note of embeddedRights.notes) {
        if (note.field === "Copyright") continue; // already recorded above
        evidence.push({ kind: "restriction_field", detail: note.detail, origin: "imageinfo commonmetadata/metadata" });
      }
      for (const c of embeddedRights.conflicts) if (!conflicts.includes(c)) conflicts.push(c);

      // A rights-bearing embedded field that is THERE and unreadable stops the
      // candidate, and stops it as a PARSE FAILURE rather than as a rights
      // finding — the same distinction drawn for an ambiguous {{Information}}
      // field above. Reaching a rights verdict from a field we could not read
      // is the shape of the bug this whole module keeps re-learning: the
      // previous fix returned null here, and null is indistinguishable from
      // "this file makes no rights assertion", which is a green light.
      if (embeddedRights.unreadable.length > 0) {
        return {
          outcome: {
            status: "malformed",
            detail:
              `Rights-bearing embedded metadata on ${candidate.providerRef} could not be interpreted: ` +
              embeddedRights.unreadable.map((u) => u.detail).join(" | ") +
              " Refused as a PARSE FAILURE, not as a rights finding — a rights field this reader cannot read is not a " +
              "rights field that says nothing, and treating the two the same is how an embedded reservation goes " +
              "unnoticed under a free licence badge.",
          },
          provenance: null,
        };
      }
      if (exifModel) {
        evidence.push({ kind: "licence_metadata", detail: `EXIF Model="${exifModel}"`, origin: "imageinfo commonmetadata" });
      }

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
