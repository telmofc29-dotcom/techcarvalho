import "server-only";
import { createClient } from "@/lib/supabase/server";
import { logQueryError } from "@/lib/log/query-error";
import { LOCALES, ROOT_LOCALE, type Locale } from "@/lib/i18n/locales";

// Which language versions of an article actually EXIST and are published.
//
// WHY THIS IS A QUERY AND NOT A CONFIGURATION
// -------------------------------------------
// The temptation with a multilingual site is to declare "we support pt, es, fr"
// once and then emit an hreflang for all four on every page. That produces a
// link to a page that 404s, which is worse than no link: it tells a search
// engine and a reader that a Portuguese version exists when it does not, and
// the reader who follows it leaves.
//
// So availability is READ, per article, every time. A locale appears in the
// switcher and in hreflang only when a row exists for it with
// status='published' and published_at <= now. There are currently ZERO
// translations in this database, which means the correct output of this module
// today is "English only, no alternates, no hreflang" — and that is what it
// returns, without any special-casing.
//
// WHAT A TRANSLATION IS AND IS NOT
// --------------------------------
// A translation shares its source's `translation_group_id`. It carries PROSE —
// title and body. It does not carry, and must never carry, a translated
// product name, model number, manufacturer, specification value, measurement,
// source record, citation or media provenance record: those are facts about
// objects in the world, they are the same fact in every language, and they stay
// on the shared rows the translation points at. `products` deliberately has no
// locale column at all, so there is nowhere for a translated "Canon EOS 60D" to
// be stored even by mistake — a structural guarantee rather than a rule
// somebody has to remember.

export type TranslationAvailability = {
  /** Locales with a genuinely published version of this article, always including 'en'. */
  available: Locale[];
  /** slug per locale — a translation may legitimately carry a different slug. */
  slugByLocale: Partial<Record<Locale, string>>;
};

/**
 * Find the published language versions of an article, given the group it
 * belongs to.
 *
 * Degrades to "English only" on a query failure rather than throwing — a
 * visitor must never see an error page because the language switcher could not
 * be built. But it calls logQueryError first, so a real failure is visible in
 * the server log instead of looking identical to "no translations exist", which
 * is exactly the state the site is in today and would otherwise mask the bug
 * forever.
 */
export async function getTranslationAvailability(
  translationGroupId: string,
  sourceSlug: string
): Promise<TranslationAvailability> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("content_items")
    .select("locale, slug, status, published_at")
    .eq("translation_group_id", translationGroupId)
    .eq("status", "published")
    .lte("published_at", new Date().toISOString());

  if (error) {
    logQueryError(`article-translation.availability(${translationGroupId})`, error);
    return { available: [ROOT_LOCALE], slugByLocale: { [ROOT_LOCALE]: sourceSlug } };
  }

  const slugByLocale: Partial<Record<Locale, string>> = {};
  for (const row of data ?? []) {
    const locale = row.locale as Locale;
    if (LOCALES.includes(locale)) slugByLocale[locale] = row.slug;
  }
  // The source row is the one the caller already has in hand; include it even
  // if the query somehow missed it, so a page always knows about itself.
  slugByLocale[ROOT_LOCALE] ??= sourceSlug;

  const available = LOCALES.filter((l) => slugByLocale[l] !== undefined);
  return { available, slugByLocale };
}

/**
 * Resolve a translated article by locale and slug.
 *
 * Returns null when no PUBLISHED row exists for that pair, which the route
 * turns into a 404. That is deliberate and is the whole answer to "no empty or
 * placeholder locale pages": a Portuguese URL for an article nobody has
 * translated does not render a stub, a machine-translated guess, or the English
 * text under a Portuguese path. It does not exist, and says so.
 */
export async function getTranslatedArticleSlug(
  locale: Locale,
  slug: string
): Promise<{ id: string; translationGroupId: string } | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("content_items")
    .select("id, translation_group_id")
    .eq("locale", locale)
    .eq("slug", slug)
    .eq("status", "published")
    .lte("published_at", new Date().toISOString())
    .maybeSingle();

  if (error) {
    logQueryError(`article-translation.resolve(${locale}:${slug})`, error);
    return null;
  }
  if (!data) return null;
  return { id: data.id, translationGroupId: data.translation_group_id };
}
