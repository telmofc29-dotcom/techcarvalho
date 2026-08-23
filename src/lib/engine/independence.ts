// Source independence.
//
// WHY THIS EXISTS
// ---------------
// confidence.ts has always claimed that corroboration "only counts from
// INDEPENDENT sources", and implemented that claim as a single test:
// `!e.originates_from_url`. In production, `originates_from_url` is NULL on
// 118 of 118 evidence rows — it has never had a writer — so 100% of evidence
// read as independent and the corroboration bonus had never once contributed
// anything. The rule was correct and the mechanism was decorative.
//
// The deeper problem is that one nullable column cannot express what
// independence actually is. Five situations arrive looking identical if all
// you count is rows:
//
//   1. Two genuinely independent outlets, each doing its own reporting.
//   2. Two outlets both repeating one upstream report.
//   3. A manufacturer's own announcement, plus an article quoting it.
//   4. Five pages on one publisher's domain.
//   5. Genuine independent corroboration of an announcement.
//
// (1) and (5) are corroboration. (2), (3) and (4) are one voice speaking once
// and being echoed. This module distinguishes them by collapsing evidence rows
// into VOICES — distinct originating publishers — and reporting how many
// voices there are, never how many URLs.
//
// THE INVARIANT
// -------------
// Adding more URLs from a voice already counted never changes
// `corroborationWeight`. That is the property that stops "many websites
// repeated it" from reading as "many sources confirmed it", and it is asserted
// directly in independence.test.ts rather than left as an intention.
//
// UNEXAMINED IS NOT INDEPENDENT
// -----------------------------
// The absence of `originates_from_url` is not a statement that a source is
// original. It is usually a statement that nobody looked. This project has
// been bitten repeatedly by treating "unmeasured" as "fine" (see
// engine_job_runs.stage_outcome, and the NULL write-count columns in
// cron.ts), so `originExamined` is carried explicitly and a voice whose origin
// was never examined contributes HALF the corroboration weight of one that was
// checked and found original. Unknown lowers confidence; it never raises it.
//
// Pure and deterministic. No network, no AI, no clock, no database.

// ---------------------------------------------------------------------------
// URL canonicalisation
// ---------------------------------------------------------------------------

/**
 * Query parameters that identify a campaign, a referrer or a session rather
 * than a document. Two URLs differing only in these are the same page, and
 * treating them as two sources is exactly how a share link becomes a
 * "second source".
 */
const TRACKING_PARAMS = new Set([
  "fbclid", "gclid", "dclid", "msclkid", "yclid", "igshid", "mc_cid", "mc_eid",
  "_hsenc", "_hsmi", "ref", "ref_src", "referrer", "source", "src", "cmp",
  "campaign", "ito", "ncid", "spm", "s_kwcid", "sr_share", "smid", "partner",
  "at_medium", "at_campaign", "wt.mc_id", "sh", "share", "smtyp", "taid",
  "__twitter_impression", "guccounter", "guce_referrer", "guce_referrer_sig",
]);

function isTrackingParam(key: string): boolean {
  const k = key.toLowerCase();
  return k.startsWith("utm_") || TRACKING_PARAMS.has(k);
}

/**
 * Hosts that wrap somebody else's URL rather than publishing anything. The
 * wrapper is not a source: `news.google.com/...&url=https://vendor.example/x`
 * is one sighting of vendor.example, not a sighting of Google. Unwrapping is
 * restricted to this list because a `?url=` parameter on an ordinary page is
 * usually part of the page, not a redirect target.
 */
const REDIRECT_WRAPPERS = new Set([
  "news.google.com", "feedproxy.google.com", "feeds.feedburner.com",
  "news.url.google.com", "url.google.com", "out.reddit.com", "l.facebook.com",
  "lm.facebook.com", "away.vk.com", "getpocket.com", "flip.it", "trib.al",
  "link.techcarvalho.example",
]);

const REDIRECT_TARGET_PARAMS = ["url", "u", "target", "redirect", "to"];

/** Subdomains that are a delivery variant of the same publisher, not a different one. */
const HOST_NOISE_PREFIX = /^(?:www|www\d|m|mobile|amp|amp-|web|en|edition)\./;

/**
 * Multi-label public suffixes this project actually meets. Deliberately a
 * short pragmatic list rather than the full Public Suffix List (which would be
 * a dependency and a periodic update obligation).
 *
 * A MISS HERE FAILS CLOSED. If a suffix is absent, two different publishers
 * under it collapse into one voice — which UNDER-counts corroboration and
 * lowers confidence. The opposite error (splitting one publisher into two
 * voices) is the one that would inflate confidence, and it cannot be caused by
 * a missing entry.
 */
const MULTI_LABEL_SUFFIXES = new Set([
  "co.uk", "org.uk", "ac.uk", "gov.uk", "me.uk", "net.uk", "sch.uk",
  "com.au", "net.au", "org.au", "edu.au", "gov.au",
  "co.jp", "ne.jp", "or.jp", "ac.jp", "go.jp",
  "co.nz", "net.nz", "org.nz", "govt.nz",
  "co.za", "org.za", "com.br", "net.br", "org.br", "gov.br",
  "com.cn", "net.cn", "org.cn", "gov.cn", "com.tw", "com.hk", "com.sg",
  "co.kr", "or.kr", "co.in", "net.in", "org.in", "gov.in",
  "com.mx", "com.ar", "com.tr", "co.il", "com.pl", "com.es",
]);

/** Lowercased hostname with delivery-variant prefixes removed, or null. */
export function hostOf(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    const host = url.hostname.toLowerCase();
    const stripped = host.replace(HOST_NOISE_PREFIX, "");
    return stripped || host;
  } catch {
    return null;
  }
}

/**
 * The domain a publisher is identified by. `blogs.nvidia.com`,
 * `www.nvidia.com` and `nvidia.com/en-gb` are one voice, so grouping happens
 * here rather than on the full hostname.
 *
 * NOTE the asymmetry with shadow-io.ts's buildSourceIndex, which matches on
 * EXACT host and says so explicitly: that function decides PERMISSION, where
 * widening the key would let a tenant of a shared press-release host inherit
 * another company's grants. This function decides how much a claim is
 * corroborated, where widening the key only ever merges voices and therefore
 * only ever lowers confidence. Different question, different safe direction.
 */
export function registrableDomain(host: string | null | undefined): string | null {
  if (!host) return null;
  const labels = host.split(".").filter(Boolean);
  if (labels.length <= 2) return labels.join(".") || null;
  const lastTwo = labels.slice(-2).join(".");
  if (MULTI_LABEL_SUFFIXES.has(lastTwo) && labels.length >= 3) {
    return labels.slice(-3).join(".");
  }
  return lastTwo;
}

function stripAmp(pathname: string): string {
  let p = pathname;
  p = p.replace(/\/amp\/?$/i, "/");
  p = p.replace(/\.amp$/i, "");
  return p;
}

/**
 * A comparable form of a URL: wrapper unwrapped, tracking stripped, AMP
 * variant folded onto the canonical page, parameters ordered, fragment and
 * trailing slash removed. Returns null for anything that is not an http(s)
 * URL — never a partially-cleaned string, because a half-canonical URL that
 * compares unequal to itself is worse than no URL at all.
 */
export function canonicalUrl(raw: string | null | undefined, depth = 0): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;

  // Unwrap a redirect wrapper before anything else — everything below should
  // describe the document, not the link that pointed at it.
  const rawHost = url.hostname.toLowerCase().replace(/^www\./, "");
  if (depth < 3 && REDIRECT_WRAPPERS.has(rawHost)) {
    for (const param of REDIRECT_TARGET_PARAMS) {
      const candidate = url.searchParams.get(param);
      if (candidate && /^https?:\/\//i.test(candidate)) {
        const inner = canonicalUrl(candidate, depth + 1);
        if (inner) return inner;
      }
    }
  }

  const host = hostOf(trimmed);
  if (!host) return null;

  const params = [...url.searchParams.entries()]
    .filter(([key, value]) => {
      if (isTrackingParam(key)) return false;
      if (key.toLowerCase() === "output" && value.toLowerCase() === "amp") return false;
      if (key.toLowerCase() === "outputtype" && value.toLowerCase() === "amp") return false;
      if (key.toLowerCase() === "amp") return false;
      return value !== "";
    })
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  let path = stripAmp(url.pathname);
  path = path.replace(/\/(?:index|default)\.(?:html?|php|aspx?)$/i, "/");
  if (path.length > 1) path = path.replace(/\/+$/, "");
  if (!path) path = "/";

  const query = params.length
    ? "?" + params.map(([k, v]) => `${k}=${v}`).join("&")
    : "";
  // Scheme is normalised away: http and https of the same page are the same
  // document, and a source that upgraded to TLS is not a second source.
  return `${host}${path}${query}`;
}

/** True when both URLs point at the same document once canonicalised. */
export function sameDocument(a: string | null | undefined, b: string | null | undefined): boolean {
  const ca = canonicalUrl(a);
  const cb = canonicalUrl(b);
  return ca !== null && ca === cb;
}

// ---------------------------------------------------------------------------
// Upstream attribution
// ---------------------------------------------------------------------------

/**
 * Phrases that mark what follows as somebody else's reporting rather than the
 * publisher's own. Kept narrow on purpose: a wrong upstream link is a
 * fabricated provenance record, and this project's standing rule is that a
 * record which cannot be reconstructed should say LESS, not more.
 */
const ATTRIBUTION_LEAD =
  "(?:via|source|sources|credit|h/t|hat tip|originally (?:reported|published|posted)(?:\\s+(?:by|at|on))?|first (?:reported|spotted|seen)(?:\\s+(?:by|at|on))?|as (?:reported|spotted)(?:\\s+by)?|according to|reports?)";

const BARE_URL_ATTRIBUTION = new RegExp(
  `\\b${ATTRIBUTION_LEAD}\\b[\\s:\\-–—>\\[\\(]{0,4}(https?://[^\\s<>"'\\]\\)]+)`,
  "i"
);

const HTML_ATTRIBUTION = new RegExp(
  `\\b${ATTRIBUTION_LEAD}\\b[^<]{0,40}<a[^>]+href\\s*=\\s*["']([^"']+)["']`,
  "i"
);

/**
 * Recover the URL a feed item says it got its claim from, when — and only
 * when — the item states it explicitly.
 *
 * Returns null far more often than not, and that is the correct behaviour: a
 * NULL here means "no upstream citation was found", which independence
 * treats as UNKNOWN, not as "original". Guessing an upstream would invent
 * provenance; guessing "no upstream" would invent independence. Neither is
 * available, so neither is asserted.
 *
 * A citation pointing at the citing publisher's own domain is discarded: an
 * outlet linking its own earlier article is continuing to speak, not
 * repeating someone else.
 */
export function extractUpstreamAttribution(
  text: string | null | undefined,
  selfUrl?: string | null
): string | null {
  if (!text) return null;
  const match = text.match(HTML_ATTRIBUTION) ?? text.match(BARE_URL_ATTRIBUTION);
  if (!match || !match[1]) return null;

  // Trailing sentence punctuation is not part of the URL.
  const cleaned = match[1].replace(/[.,;:'"”’)\]]+$/, "");
  const canonical = canonicalUrl(cleaned);
  if (!canonical) return null;

  const selfCanonical = canonicalUrl(selfUrl);
  if (selfCanonical && selfCanonical === canonical) return null;

  const upstreamDomain = registrableDomain(hostOf(cleaned));
  const selfDomain = registrableDomain(hostOf(selfUrl));
  if (upstreamDomain && selfDomain && upstreamDomain === selfDomain) return null;

  return cleaned;
}

// ---------------------------------------------------------------------------
// Independence assessment
// ---------------------------------------------------------------------------

export type IndependenceRow = {
  /** Stable identifier for reporting. Falls back to the canonical URL. */
  id?: string | null;
  url?: string | null;
  publisher?: string | null;
  /** Non-null means this row states it is repeating someone else's claim. */
  originatesFromUrl?: string | null;
  /**
   * Whether anything actually LOOKED for an upstream citation on this row.
   * false (the default) means unknown, which is weaker than examined-and-none-
   * found — it is never treated as evidence of originality.
   */
  originExamined?: boolean | null;
};

export type VoiceBasis =
  /** Retrieved directly, and checked for an upstream citation — none found. */
  | "examined_original"
  /** Retrieved directly, but nobody checked whether it was repeating someone. */
  | "origin_unexamined"
  /** Never retrieved; known only because other rows cite it. */
  | "cited_by_others_only"
  /** No URL and no publisher — cannot be attributed to any voice at all. */
  | "unattributable";

/** Full corroboration weight only for a voice whose origin was actually checked. */
const WEIGHT_BY_BASIS: Record<VoiceBasis, number> = {
  examined_original: 1,
  origin_unexamined: 0.5,
  cited_by_others_only: 0.5,
  unattributable: 0,
};

export type SourceVoice = {
  /** Registrable domain, `publisher:<name>`, or the unattributable bucket. */
  key: string;
  label: string;
  basis: VoiceBasis;
  /** Evidence rows retrieved from this voice itself. */
  directRowIds: string[];
  /** Evidence rows that cite this voice as where the claim came from. */
  echoRowIds: string[];
  /** Distinct documents retrieved from this voice. */
  documents: string[];
  weight: number;
  reason: string;
};

export type IndependenceAssessment = {
  /** One entry per originating voice, ordered deterministically. */
  voices: SourceVoice[];
  /** Distinct originating voices. NOT a count of URLs or of evidence rows. */
  independentVoices: number;
  /** Rows attributed to a voice other than their own publisher. */
  echoedRows: number;
  /** Rows folded into a voice already present because they share its domain. */
  sameVoiceRows: number;
  /** Rows whose origin was never examined. Unknown, not independent. */
  unexaminedRows: number;
  /** Rows carrying neither a usable URL nor a publisher. */
  unattributableRows: number;
  /**
   * Corroboration available BEYOND the strongest voice, in weighted voices.
   * confidence.ts multiplies this; it is a float because an unexamined voice
   * is worth half of a checked one.
   */
  corroborationWeight: number;
  explanation: string;
};

const UNATTRIBUTABLE_KEY = "\u0000unattributable";

function publisherKey(publisher: string | null | undefined): string | null {
  const name = (publisher ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  return name ? `publisher:${name}` : null;
}

type Resolved = {
  rowId: string;
  voiceKey: string;
  voiceLabel: string;
  isEcho: boolean;
  document: string | null;
  originExamined: boolean;
  attributable: boolean;
};

function resolveRow(row: IndependenceRow, index: number): Resolved {
  const canonical = canonicalUrl(row.url);
  const rowId = row.id ?? canonical ?? `row:${index}`;
  const ownDomain = registrableDomain(hostOf(row.url));
  const upstreamDomain = registrableDomain(hostOf(row.originatesFromUrl));

  // A citation pointing back at the citing publisher is not an upstream — it
  // is the same voice continuing to speak.
  const isEcho = upstreamDomain !== null && upstreamDomain !== ownDomain;

  if (isEcho) {
    return {
      rowId,
      voiceKey: upstreamDomain,
      voiceLabel: upstreamDomain,
      isEcho: true,
      document: canonical,
      originExamined: true, // an upstream was recorded, so one was looked for
      attributable: true,
    };
  }

  const key = ownDomain ?? publisherKey(row.publisher) ?? UNATTRIBUTABLE_KEY;
  return {
    rowId,
    voiceKey: key,
    voiceLabel: ownDomain ?? (row.publisher ?? "").trim(),
    isEcho: false,
    document: canonical,
    originExamined: row.originExamined === true,
    attributable: key !== UNATTRIBUTABLE_KEY,
  };
}

/**
 * Collapse evidence rows into originating voices.
 *
 * Order-independent by construction: voices are sorted by a stated rule and
 * never by input position, so reversing the input array produces an identical
 * result. "Whichever we processed first" is the silent failure this whole area
 * of the codebase exists to prevent.
 */
export function assessIndependence(rows: readonly IndependenceRow[]): IndependenceAssessment {
  if (rows.length === 0) {
    return {
      voices: [],
      independentVoices: 0,
      echoedRows: 0,
      sameVoiceRows: 0,
      unexaminedRows: 0,
      unattributableRows: 0,
      corroborationWeight: 0,
      explanation: "No evidence rows, so there is nothing to corroborate.",
    };
  }

  const resolved = rows.map(resolveRow);

  type Bucket = {
    key: string;
    label: string;
    directRowIds: string[];
    echoRowIds: string[];
    documents: Set<string>;
    anyExamined: boolean;
  };
  const buckets = new Map<string, Bucket>();

  for (const r of resolved) {
    let bucket = buckets.get(r.voiceKey);
    if (!bucket) {
      bucket = {
        key: r.voiceKey,
        label: r.voiceLabel || r.voiceKey,
        directRowIds: [],
        echoRowIds: [],
        documents: new Set<string>(),
        anyExamined: false,
      };
      buckets.set(r.voiceKey, bucket);
    }
    if (r.isEcho) {
      bucket.echoRowIds.push(r.rowId);
    } else {
      bucket.directRowIds.push(r.rowId);
      if (r.originExamined) bucket.anyExamined = true;
      if (r.document) bucket.documents.add(r.document);
    }
  }

  const voices: SourceVoice[] = [...buckets.values()].map((b) => {
    const basis: VoiceBasis =
      b.key === UNATTRIBUTABLE_KEY
        ? "unattributable"
        : b.directRowIds.length === 0
          ? "cited_by_others_only"
          : b.anyExamined
            ? "examined_original"
            : "origin_unexamined";

    const reason =
      basis === "unattributable"
        ? `${b.directRowIds.length} evidence row(s) carry neither a usable URL nor a publisher, so they cannot be attributed to any voice and contribute no corroboration.`
        : basis === "cited_by_others_only"
          ? `${b.label} was never retrieved directly; it is known only because ${b.echoRowIds.length} other row(s) cite it as the origin of the claim.`
          : basis === "examined_original"
            ? `${b.label} was retrieved directly and checked for an upstream citation; none was found.` +
              (b.echoRowIds.length ? ` ${b.echoRowIds.length} other row(s) repeat it.` : "")
            : `${b.label} was retrieved directly, but nothing checked whether it was repeating another source, so its independence is unknown rather than established.` +
              (b.echoRowIds.length ? ` ${b.echoRowIds.length} other row(s) repeat it.` : "");

    return {
      key: b.key,
      label: b.label,
      basis,
      directRowIds: [...b.directRowIds].sort(),
      echoRowIds: [...b.echoRowIds].sort(),
      documents: [...b.documents].sort(),
      weight: WEIGHT_BY_BASIS[basis],
      reason,
    };
  });

  // Strongest first, then alphabetical. Never input order.
  voices.sort(
    (a, b) =>
      b.weight - a.weight ||
      b.directRowIds.length - a.directRowIds.length ||
      (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)
  );

  const echoedRows = resolved.filter((r) => r.isEcho).length;
  const unattributableRows = resolved.filter((r) => !r.attributable).length;
  const unexaminedRows = resolved.filter((r) => !r.isEcho && !r.originExamined).length;
  // Rows that added no new voice: every row past the first in its own bucket.
  const sameVoiceRows = voices.reduce(
    (total, v) => total + Math.max(v.directRowIds.length - 1, 0),
    0
  );

  const corroborationWeight = voices
    .slice(1)
    .reduce((total, v) => total + v.weight, 0);
  const independentVoices = voices.filter((v) => v.basis !== "unattributable").length;

  const parts: string[] = [
    `${rows.length} evidence row(s) resolve to ${independentVoices} distinct originating voice(s).`,
  ];
  if (echoedRows > 0) {
    parts.push(
      `${echoedRows} row(s) name another source as the origin of the claim, so they repeat a voice already counted rather than adding one.`
    );
  }
  if (sameVoiceRows > 0) {
    parts.push(
      `${sameVoiceRows} row(s) are additional pages from a publisher already counted; more pages from one publisher is not more sources.`
    );
  }
  if (unattributableRows > 0) {
    parts.push(
      `${unattributableRows} row(s) have neither a usable URL nor a publisher and contribute no corroboration.`
    );
  }
  if (unexaminedRows > 0) {
    parts.push(
      `${unexaminedRows} row(s) were never checked for an upstream citation, so their independence is unknown and counts at half weight.`
    );
  }
  parts.push(
    corroborationWeight > 0
      ? `Corroboration beyond the strongest voice: ${corroborationWeight.toFixed(2)} weighted voice(s).`
      : `No corroboration beyond the strongest voice.`
  );

  return {
    voices,
    independentVoices,
    echoedRows,
    sameVoiceRows,
    unexaminedRows,
    unattributableRows,
    corroborationWeight: Number(corroborationWeight.toFixed(3)),
    explanation: parts.join(" "),
  };
}
