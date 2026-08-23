import Link from "next/link";
import type { ConfidenceAssessment, ConfidenceBand } from "@/lib/public/source-confidence";

// The reader-facing confidence note.
//
// Shown on news stories only (see shouldShowConfidence). It sits between the
// headline and the body because its whole purpose is to change how the next
// 800 words are read — placed under the sources at the bottom it would arrive
// after the reader had already formed a view.
//
// DESIGN INTENT
// -------------
// Deliberately not a shiny badge. A confidence chip that looks like a
// certification seal invites the reader to trust the seal instead of the
// reasoning, which is the opposite of the point. It is a quiet bordered note
// with one strong word, a sentence of plain English, and a link to the sources
// so the reader can check the claim rather than take ours for it.
//
// The tone colours encode the band, but colour is never the ONLY carrier —
// every band states its position in words too, so this works in greyscale, for
// a colourblind reader, and in a screen reader.

const TONE: Record<ConfidenceBand, { wrap: string; dot: string; label: string }> = {
  confirmed: {
    wrap: "border-emerald-200 bg-emerald-50/60",
    dot: "bg-emerald-500",
    label: "text-emerald-900",
  },
  strongly_supported: {
    wrap: "border-sky-200 bg-sky-50/60",
    dot: "bg-sky-500",
    label: "text-sky-900",
  },
  developing: {
    wrap: "border-amber-200 bg-amber-50/60",
    dot: "bg-amber-500",
    label: "text-amber-900",
  },
  single_source: {
    wrap: "border-amber-200 bg-amber-50/50",
    dot: "bg-amber-400",
    label: "text-amber-900",
  },
  rumour_unconfirmed: {
    wrap: "border-zinc-300 bg-zinc-50",
    dot: "bg-zinc-400",
    label: "text-zinc-800",
  },
  conflicting: {
    wrap: "border-rose-200 bg-rose-50/60",
    dot: "bg-rose-500",
    label: "text-rose-900",
  },
};

export function SourceConfidenceNote({
  assessment,
  /** True when the page renders a Sources list this can point at. */
  hasSourceList,
}: {
  assessment: ConfidenceAssessment;
  hasSourceList: boolean;
}) {
  const tone = TONE[assessment.band];

  return (
    <aside
      className={`mt-6 rounded-xl border px-4 py-3.5 sm:px-5 ${tone.wrap}`}
      aria-labelledby="confidence-heading"
    >
      <p className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
        <span
          aria-hidden="true"
          className={`h-2 w-2 shrink-0 rounded-full ${tone.dot}`}
        />
        <span
          id="confidence-heading"
          className={`text-xs font-bold uppercase tracking-wider ${tone.label}`}
        >
          {assessment.label}
        </span>
        {/* The voice count, in words. Never a percentage, and never a count of
            links — see the header of lib/public/source-confidence.ts. */}
        <span className="text-xs text-zinc-500">
          {assessment.independentVoices === 1
            ? "1 independent source"
            : `${assessment.independentVoices} independent sources`}
          {assessment.repeatedSources > 0 && `, ${assessment.repeatedSources} repeating`}
        </span>
      </p>
      <p className="mt-2 text-sm leading-relaxed text-zinc-700">
        {assessment.explanation}
        {hasSourceList && (
          <>
            {" "}
            <Link
              href="#sources-heading"
              className="whitespace-nowrap font-medium underline decoration-zinc-400 underline-offset-2 hover:text-accent"
            >
              See the sources
            </Link>
            .
          </>
        )}
      </p>
    </aside>
  );
}
