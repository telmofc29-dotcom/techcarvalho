import "server-only";
import { createClient } from "@/lib/supabase/server";
import { SOURCE_LOCALE, type Locale } from "@/lib/i18n/locales";
import {
  classifyTranslation,
  isTranslationStale,
  isTranslated,
  emptyStateTotals,
  type TranslationCoverageState,
} from "@/lib/admin/translation-status";
import type { ContentStatus, TranslationState } from "@/lib/types/database";

// Translation coverage, computed from what is actually in the database.
//
// EVERY QUERY CHECKS ITS OWN ERROR, BY NAME, AND THROWS
// ----------------------------------------------------
// The failure this guards against is specific to a coverage report: `?? []` on
// the translations query would render "81 articles, 0 translated" — which is
// currently the TRUE answer, and would go on looking true forever after the
// first translation existed. A report whose broken state is pixel-identical to
// its correct state cannot be trusted at all. So each query is named
// individually (an admin needs to know WHICH table failed) and a throw is
// surfaced by src/app/admin/(dashboard)/error.tsx.
//
// WHY NOT content_translation_status()
// ------------------------------------
// The RPC exists, is admin-only, and computes the same staleness expression.
// It is not used here for one concrete reason: it does not return
// translation_reviewed_by, so it cannot distinguish "current" from "reviewed" —
// two of the six states this dashboard has to show. Widening its return type
// means a migration, and the columns are readable directly by an admin under
// RLS anyway ("admins can read all content" in 20260819202305_rls_policies.sql).
// The staleness rule is therefore written twice, and translation-status.ts says
// so at its head so the two are changed together.
//
// RLS IS STILL THE BOUNDARY
// -------------------------
// Reading the columns directly does not weaken anything: an anon client running
// these same queries sees only published rows, and this module is server-only
// and reached exclusively from pages that call requireAdmin() first.

export type TranslationCell = {
  locale: Locale;
  localeLabel: string;
  state: TranslationCoverageState;
  /** null when nothing exists for this pair yet. */
  translationId: string | null;
  translationState: TranslationState | null;
  /** The translation's own editorial status — a translation is published through the normal workflow. */
  translationStatus: ContentStatus | null;
  translatedAt: string | null;
  /** The source revision this translation was made from. */
  sourceRevisionSeen: number | null;
  /** The source's revision right now. */
  sourceRevision: number;
  isStale: boolean;
};

export type TranslationCoverageRow = {
  sourceId: string;
  translationGroupId: string;
  title: string;
  slug: string;
  status: ContentStatus;
  translatableRevision: number;
  cells: TranslationCell[];
  /** How many target locales have any row at all. Used only for sorting/counting. */
  translatedCount: number;
};

/**
 * A translation row whose translation_group_id matches no source-language row.
 *
 * Should be impossible — the CHECK constraint requires a source_content_id on
 * any non-'en' row. Reported rather than silently dropped: a coverage report
 * that quietly discards rows it cannot place is exactly the silent-success
 * shape this project keeps getting bitten by.
 */
export type OrphanTranslation = {
  id: string;
  title: string;
  locale: Locale;
  translationGroupId: string;
  sourceContentId: string | null;
};

export type TranslationOverview = {
  /** Every locale except the source one, in the database's own sort order. */
  targetLocales: { code: Locale; label: string }[];
  sourceLocale: Locale;
  rows: TranslationCoverageRow[];
  totals: Record<TranslationCoverageState, number>;
  /** Per-target-locale breakdown, keyed by locale code. */
  byLocale: Record<string, Record<TranslationCoverageState, number>>;
  counts: {
    /** Source-language articles. */
    sources: number;
    /** sources x target locales — the number of cells the grid has. */
    pairs: number;
    /** Pairs that have a translation row of any kind. */
    translated: number;
    /** Translation rows that could not be attached to a source. */
    orphans: number;
  };
  orphans: OrphanTranslation[];
};

export async function getTranslationOverview(): Promise<TranslationOverview> {
  const supabase = await createClient();

  const [localesRes, sourcesRes, translationsRes] = await Promise.all([
    supabase.from("locales").select("code, label, bcp47, is_source, sort_order").order("sort_order"),
    supabase
      .from("content_items")
      .select("id, title, slug, status, translation_group_id, translatable_revision")
      .eq("locale", SOURCE_LOCALE)
      .order("title"),
    supabase
      .from("content_items")
      .select(
        "id, title, slug, status, locale, translation_group_id, source_content_id, translation_state, source_revision_seen, translated_at, translation_reviewed_by"
      )
      .neq("locale", SOURCE_LOCALE),
  ]);

  // Named individually so a failure says WHICH read failed. "locales failed" and
  // "translations failed" send an admin to completely different places.
  for (const [label, res] of [
    ["locales", localesRes],
    ["content_items (sources)", sourcesRes],
    ["content_items (translations)", translationsRes],
  ] as const) {
    if (res.error) {
      throw new Error(`translation coverage: reading ${label} failed — ${res.error.message}`);
    }
    if (res.data === null) {
      throw new Error(`translation coverage: ${label} returned null rather than rows`);
    }
  }

  const locales = localesRes.data!;
  const sources = sourcesRes.data!;
  const translations = translationsRes.data!;

  // An empty locales table is a broken installation, not a zero-result. Without
  // this the page would render "0 pairs, nothing to do" — the honest-looking
  // empty state that this project's error-handling rule exists to prevent.
  if (locales.length === 0) {
    throw new Error(
      "translation coverage: public.locales is empty. Expected at least the source locale — 20260824_translation_model.sql seeds en/pt/es/fr."
    );
  }

  const targetLocales = locales
    .filter((l) => l.code !== SOURCE_LOCALE)
    .map((l) => ({ code: l.code as Locale, label: l.label }));

  // Keyed by group + locale. A group should hold at most one row per locale;
  // if the database ever holds two, the later one wins here and the count of
  // rows vs. cells below still reflects reality via the orphan tally.
  const byGroupLocale = new Map<string, (typeof translations)[number]>();
  for (const t of translations) {
    byGroupLocale.set(`${t.translation_group_id}::${t.locale}`, t);
  }

  const sourceGroups = new Set(sources.map((s) => s.translation_group_id));
  const orphans: OrphanTranslation[] = translations
    .filter((t) => !sourceGroups.has(t.translation_group_id))
    .map((t) => ({
      id: t.id,
      title: t.title,
      locale: t.locale as Locale,
      translationGroupId: t.translation_group_id,
      sourceContentId: t.source_content_id,
    }));

  const totals = emptyStateTotals();
  const byLocale: Record<string, Record<TranslationCoverageState, number>> = {};
  for (const l of targetLocales) byLocale[l.code] = emptyStateTotals();

  const rows: TranslationCoverageRow[] = sources.map((src) => {
    const cells: TranslationCell[] = targetLocales.map((locale) => {
      const t = byGroupLocale.get(`${src.translation_group_id}::${locale.code}`) ?? null;
      const sourceRevision = src.translatable_revision ?? 1;
      const sourceRevisionSeen = t?.source_revision_seen ?? null;

      const state = classifyTranslation({
        translationId: t?.id ?? null,
        translationState: t?.translation_state ?? null,
        sourceRevision,
        sourceRevisionSeen,
        reviewedBy: t?.translation_reviewed_by ?? null,
      });

      totals[state] += 1;
      byLocale[locale.code][state] += 1;

      return {
        locale: locale.code,
        localeLabel: locale.label,
        state,
        translationId: t?.id ?? null,
        translationState: (t?.translation_state ?? null) as TranslationState | null,
        translationStatus: (t?.status ?? null) as ContentStatus | null,
        translatedAt: t?.translated_at ?? null,
        sourceRevisionSeen,
        sourceRevision,
        // false when nothing exists: there is no translation for the source to
        // have changed underneath.
        isStale: t ? isTranslationStale(sourceRevision, sourceRevisionSeen) : false,
      };
    });

    return {
      sourceId: src.id,
      translationGroupId: src.translation_group_id,
      title: src.title,
      slug: src.slug,
      status: src.status,
      translatableRevision: src.translatable_revision ?? 1,
      cells,
      translatedCount: cells.filter((c) => isTranslated(c.state)).length,
    };
  });

  // Least-covered first, then alphabetical. A limited amount of editorial time
  // should reach the articles with nothing at all before the ones with two of
  // three locales done.
  rows.sort((a, b) => a.translatedCount - b.translatedCount || a.title.localeCompare(b.title));

  return {
    targetLocales,
    sourceLocale: SOURCE_LOCALE,
    rows,
    totals,
    byLocale,
    counts: {
      sources: sources.length,
      pairs: sources.length * targetLocales.length,
      translated: rows.reduce((sum, r) => sum + r.translatedCount, 0),
      orphans: orphans.length,
    },
    orphans,
  };
}
