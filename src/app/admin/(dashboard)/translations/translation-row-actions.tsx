"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Badge } from "@/components/admin/ui";
import {
  TRANSLATION_STATE_LABELS,
  TRANSLATION_STATE_TONES,
  type TranslationCoverageState,
} from "@/lib/admin/translation-status";
import { createTranslationFormAction } from "./actions";
import type { CreateTranslationResult } from "./types";

// One form per source article, with a submit button per missing locale. The
// clicked button's name/value ("locale") is what tells the action which locale
// was asked for, so three locales need three buttons and not three forms.
//
// The result is rendered inline and a failure is shown as a failure. An action
// that silently did nothing would look identical to one that worked until the
// page was reloaded — the same silent-success shape the read path guards
// against, on the write path.

export type RowCell = {
  locale: string;
  localeLabel: string;
  state: TranslationCoverageState;
  translationId: string | null;
  translatedAt: string | null;
  sourceRevisionSeen: number | null;
  sourceRevision: number;
};

export function TranslationRowActions({
  sourceId,
  cells,
}: {
  sourceId: string;
  cells: RowCell[];
}) {
  const [result, formAction, pending] = useActionState<CreateTranslationResult | null, FormData>(
    createTranslationFormAction,
    null
  );

  return (
    <form action={formAction} className="flex flex-col gap-1.5">
      <input type="hidden" name="source_id" value={sourceId} />
      <div className="flex flex-wrap items-center gap-2">
        {cells.map((cell) => (
          <span key={cell.locale} className="inline-flex items-center gap-1.5">
            <span className="text-xs font-medium uppercase text-neutral-500">{cell.locale}</span>
            <Badge tone={TRANSLATION_STATE_TONES[cell.state]}>
              {TRANSLATION_STATE_LABELS[cell.state]}
            </Badge>
            {cell.translationId ? (
              <Link
                href={`/admin/content/${cell.translationId}`}
                className="text-xs text-neutral-700 underline hover:text-neutral-900 rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900"
              >
                open
              </Link>
            ) : (
              <button
                type="submit"
                name="locale"
                value={cell.locale}
                disabled={pending}
                className="rounded border border-neutral-300 px-2 py-0.5 text-xs font-medium text-neutral-700 hover:bg-neutral-100 disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900"
              >
                {pending ? "Creating…" : `Start ${cell.localeLabel}`}
              </button>
            )}
            {cell.state === "stale" && (
              <span className="text-xs text-red-700">
                source rev {cell.sourceRevision}, translated from{" "}
                {cell.sourceRevisionSeen === null ? "an unrecorded revision" : cell.sourceRevisionSeen}
              </span>
            )}
          </span>
        ))}
      </div>

      {result && !result.ok && (
        <p role="alert" className="text-xs text-red-700">
          {result.error}
        </p>
      )}
      {result && result.ok && (
        <p className="text-xs text-green-800">
          Draft translation created.{" "}
          <Link href={`/admin/content/${result.id}`} className="underline">
            Write it
          </Link>{" "}
          — it has no body yet and is not published.
        </p>
      )}
    </form>
  );
}
