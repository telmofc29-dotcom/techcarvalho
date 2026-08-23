// The locale vocabulary. One definition, imported everywhere.
//
// URL STRATEGY: ENGLISH AT THE ROOT
// ---------------------------------
// English stays at `/`, and pt/es/fr take a prefix. The alternative — moving
// English to `/en/` — buys route symmetry and costs a site-wide redirect layer
// whose exclusion list (/api, /auth, /admin, sitemap.xml, robots.txt, metadata
// routes) is the highest-risk piece of this phase. Google's current guidance
// expresses no preference between URL structures and is silent on whether the
// default language may live at the root, so the symmetry is worth nothing to a
// crawler and the redirect layer is a real hazard. Nothing moves.
//
// The internal route tree can still be symmetric later (app/[lang]/ with the
// root served by a proxy rewrite); that is a code shape, not a URL change, and
// it does not require any existing URL to move.
//
// Pure data and pure functions. No I/O, no framework imports — this file is
// imported by the sitemap, by metadata, by the proxy and by admin, and a
// dependency on any of those would make it unusable by the others.

export const LOCALES = ["en", "pt", "es", "fr"] as const;
export type Locale = (typeof LOCALES)[number];

/** The editorial source language. Everything else is a translation OF this. */
export const SOURCE_LOCALE: Locale = "en";

/** The locale served at the bare path, with no prefix in the URL. */
export const ROOT_LOCALE: Locale = "en";

export const LOCALE_LABELS: Record<Locale, string> = {
  en: "English",
  pt: "Português",
  es: "Español",
  fr: "Français",
};

/**
 * The BCP-47 tag for `hreflang` and `<html lang>`.
 *
 * Deliberately unregioned. "pt" covers Portuguese wherever it is read; "pt-PT"
 * or "pt-BR" would be a claim about which variety this site is written in, and
 * making that claim wrongly is worse than not making it. It can be narrowed
 * later if the editorial voice genuinely diverges.
 */
export const LOCALE_TAGS: Record<Locale, string> = {
  en: "en",
  pt: "pt",
  es: "es",
  fr: "fr",
};

export function isLocale(value: string): value is Locale {
  return (LOCALES as readonly string[]).includes(value);
}

/**
 * The URL path for a route in a locale.
 *
 * The root locale gets no prefix, which is the whole point of the strategy
 * above: `/articles/foo` stays `/articles/foo` in English and becomes
 * `/pt/articles/foo` in Portuguese.
 */
export function localePath(locale: Locale, path: string): string {
  const clean = path.startsWith("/") ? path : `/${path}`;
  if (locale === ROOT_LOCALE) return clean;
  return `/${locale}${clean === "/" ? "" : clean}`;
}

/**
 * Split a path into its locale and the route beneath it.
 *
 * A path with no recognised prefix belongs to the root locale — it is not an
 * error, because that is what every existing English URL looks like.
 */
export function splitLocalePath(path: string): { locale: Locale; rest: string } {
  const clean = path.startsWith("/") ? path : `/${path}`;
  const [, first, ...others] = clean.split("/");
  if (first && isLocale(first) && first !== ROOT_LOCALE) {
    return { locale: first, rest: `/${others.join("/")}`.replace(/\/$/, "") || "/" };
  }
  return { locale: ROOT_LOCALE, rest: clean };
}

/**
 * Pick the best locale from an Accept-Language header.
 *
 * SUGGESTION ONLY. The caller must not redirect on this — a visitor who
 * chose English must not be bounced to Portuguese because their browser
 * happens to prefer it, and a crawler sending no header must always reach the
 * root locale. Returns null when nothing is a confident match, which the caller
 * should read as "leave them where they are".
 */
export function preferredLocale(acceptLanguage: string | null | undefined): Locale | null {
  if (!acceptLanguage) return null;

  const ranked = acceptLanguage
    .split(",")
    .map((part) => {
      const [tag, ...params] = part.trim().split(";");
      const q = params.find((p) => p.trim().startsWith("q="));
      const quality = q ? Number.parseFloat(q.split("=")[1]) : 1;
      return { tag: tag.trim().toLowerCase(), quality: Number.isNaN(quality) ? 0 : quality };
    })
    .filter((x) => x.tag !== "" && x.quality > 0)
    .sort((a, b) => b.quality - a.quality);

  for (const { tag } of ranked) {
    // Match the primary subtag, so pt-BR and pt-PT both resolve to pt.
    const primary = tag.split("-")[0];
    if (isLocale(primary)) return primary;
  }
  return null;
}

/**
 * The hreflang set for one route.
 *
 * ONLY locales that genuinely have this page. A cluster listing a translation
 * that does not exist is worse than no cluster: Google treats non-reciprocal
 * clusters as untrustworthy and ignores them wholesale, and a reader following
 * the link lands on a 404. Fabricating an alternate is the multilingual version
 * of fabricating a source.
 *
 * x-default points at the root locale — the version to serve when no other
 * alternate matches the user.
 */
export function hreflangMap(
  path: string,
  availableLocales: readonly Locale[]
): Record<string, string> {
  const out: Record<string, string> = {};
  if (availableLocales.length === 0) return out;

  for (const locale of LOCALES) {
    if (!availableLocales.includes(locale)) continue;
    out[LOCALE_TAGS[locale]] = localePath(locale, path);
  }
  if (availableLocales.includes(ROOT_LOCALE)) {
    out["x-default"] = localePath(ROOT_LOCALE, path);
  }
  return out;
}
