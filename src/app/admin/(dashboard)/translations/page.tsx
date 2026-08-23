import { requireAdmin } from "@/lib/dal";
import { getTranslationOverview } from "@/lib/admin/translation-service";
import { LOCALE_LABELS } from "@/lib/i18n/locales";
import {
  TRANSLATION_STATES,
  TRANSLATION_STATE_LABELS,
  TRANSLATION_STATE_DESCRIPTIONS,
  TRANSLATION_STATE_TONES,
} from "@/lib/admin/translation-status";
import { PageHeader, Card, Badge, EmptyState, TextLink, Table, Th, Td } from "@/components/admin/ui";
import { TranslationRowActions } from "./translation-row-actions";

// Translation coverage.
//
// NO PROGRESS BAR. Nothing on this page is allowed to imply more coverage than
// exists. A bar sitting at 0% still reads, at a glance, as a thing that is
// under way; a sentence saying "0 of 243 translated" cannot be misread. The
// same rule as the rest of the site: an empty registry says it is empty.

export const dynamic = "force-dynamic";

export default async function TranslationsPage() {
  await requireAdmin();
  const overview = await getTranslationOverview();

  const { counts, totals, byLocale, targetLocales, rows, orphans } = overview;
  const percent = counts.pairs === 0 ? 0 : Math.round((counts.translated / counts.pairs) * 100);

  return (
    <div>
      <PageHeader
        title="Translations"
        description={`${LOCALE_LABELS[overview.sourceLocale]} is the source language. Every article is written once in ${LOCALE_LABELS[overview.sourceLocale]} and translated into ${targetLocales.map((l) => l.label).join(", ")}. Product names, model numbers, specs, sources and media rights are shared and never translated — a translation carries prose only.`}
      />

      {/* The headline number, stated plainly and without decoration. */}
      <Card className="p-5 mb-6">
        <p className="text-sm text-neutral-900">
          <strong>
            {counts.translated} of {counts.pairs}
          </strong>{" "}
          article/locale pairs have a translation row of any kind ({percent}%).
        </p>
        <p className="text-sm text-neutral-500 mt-1">
          {counts.sources} source {counts.sources === 1 ? "article" : "articles"} ×{" "}
          {targetLocales.length} target {targetLocales.length === 1 ? "locale" : "locales"}.
          {counts.translated === 0 &&
            " Nothing has been translated yet. Every pair below is untranslated, and no locale other than the source has a single row."}
        </p>
      </Card>

      {orphans.length > 0 && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 mb-6">
          <p className="text-sm font-medium text-red-900">
            {orphans.length} translation {orphans.length === 1 ? "row" : "rows"} could not be matched to a
            source article
          </p>
          <p className="text-xs text-red-700 mt-1">
            These have a translation_group_id that no {overview.sourceLocale} row shares, so they appear in no
            row below. They are listed here rather than dropped.
          </p>
          <ul className="mt-2 flex flex-col gap-1">
            {orphans.map((o) => (
              <li key={o.id} className="text-xs text-red-800">
                <TextLink href={`/admin/content/${o.id}`}>{o.title}</TextLink> ({o.locale}, group{" "}
                {o.translationGroupId})
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* The six states, with counts. */}
      <Card className="p-5 mb-6">
        <h2 className="text-sm font-semibold text-neutral-900 mb-3">Coverage by state</h2>
        <ul className="flex flex-col gap-2">
          {TRANSLATION_STATES.map((state) => (
            <li key={state} className="flex flex-col sm:flex-row sm:items-baseline gap-1 sm:gap-3">
              <span className="flex items-center gap-2 shrink-0 sm:w-56">
                <Badge tone={TRANSLATION_STATE_TONES[state]}>{TRANSLATION_STATE_LABELS[state]}</Badge>
                <span className="text-sm font-medium text-neutral-900">{totals[state]}</span>
              </span>
              <span className="text-xs text-neutral-500">{TRANSLATION_STATE_DESCRIPTIONS[state]}</span>
            </li>
          ))}
        </ul>
      </Card>

      {/* Per-locale breakdown. */}
      <Card className="p-5 mb-6">
        <h2 className="text-sm font-semibold text-neutral-900 mb-3">Coverage by locale</h2>
        <Table>
          <thead>
            <tr>
              <Th>Locale</Th>
              {TRANSLATION_STATES.map((state) => (
                <Th key={state}>{TRANSLATION_STATE_LABELS[state]}</Th>
              ))}
              <Th>Of {counts.sources}</Th>
            </tr>
          </thead>
          <tbody>
            {targetLocales.map((locale) => {
              const stats = byLocale[locale.code];
              const done = counts.sources - stats.untranslated;
              return (
                <tr key={locale.code}>
                  <Td>
                    <span className="font-medium text-neutral-900">{locale.label}</span>{" "}
                    <span className="text-neutral-500 text-xs uppercase">{locale.code}</span>
                  </Td>
                  {TRANSLATION_STATES.map((state) => (
                    <Td key={state}>
                      <span className={stats[state] === 0 ? "text-neutral-400" : "text-neutral-900"}>
                        {stats[state]}
                      </span>
                    </Td>
                  ))}
                  <Td>
                    {done} translated
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      </Card>

      {/* The work queue: least-covered articles first. */}
      <Card className="p-5">
        <h2 className="text-sm font-semibold text-neutral-900 mb-1">Articles</h2>
        <p className="text-xs text-neutral-500 mb-3">
          Least-covered first. Starting a translation creates a <strong>draft</strong> row in that locale with
          no body — it is never published by this action, and the English body is deliberately not copied into
          it.
        </p>
        {rows.length === 0 ? (
          <EmptyState
            title="No source articles"
            description={`Nothing in the ${overview.sourceLocale} locale to translate yet.`}
          />
        ) : (
          <ul className="flex flex-col divide-y divide-neutral-100">
            {rows.map((row) => (
              <li key={row.sourceId} className="flex flex-col gap-2 py-3 lg:flex-row lg:items-start lg:justify-between lg:gap-6">
                <div className="min-w-0">
                  <TextLink href={`/admin/content/${row.sourceId}`}>{row.title}</TextLink>
                  <p className="text-xs text-neutral-500 mt-0.5">
                    {row.status} · /{row.slug} · revision {row.translatableRevision} ·{" "}
                    {row.translatedCount} of {targetLocales.length} locales
                  </p>
                </div>
                <TranslationRowActions
                  sourceId={row.sourceId}
                  cells={row.cells.map((c) => ({
                    locale: c.locale,
                    localeLabel: c.localeLabel,
                    state: c.state,
                    translationId: c.translationId,
                    translatedAt: c.translatedAt,
                    sourceRevisionSeen: c.sourceRevisionSeen,
                    sourceRevision: c.sourceRevision,
                  }))}
                />
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
