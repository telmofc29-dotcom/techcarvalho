// How sure are we, in words a reader can act on.
//
// WHY THIS EXISTS
// ---------------
// A technology site publishes two very different kinds of statement. "The Canon
// EOS R5 records 8K" is a specification, taken from the manufacturer, and it is
// either right or it is a mistake. "Canon is preparing an R5 Mark III for
// spring" is a claim about the future, and how much a reader should trust it
// depends entirely on who said it and whether anybody else independently
// knows it.
//
// This module labels the SECOND kind. It is deliberately not a badge on every
// page: a spec table sourced from the manufacturer's own documentation gains
// nothing from a confidence chip, and putting one there would train readers to
// ignore it in the one place it matters.
//
// WHAT IT REFUSES TO DO
// ---------------------
// 1. NO PERCENTAGES. The engine computes a numeric confidence internally
//    (see src/lib/engine/confidence.ts) and that number is genuinely useful for
//    ranking work in the admin. Showing it to a reader would be false
//    precision: "68% confident" looks measured, but the inputs are editorial
//    judgements, and dressing a judgement in a decimal makes it harder to argue
//    with, not easier. The public surface is six words, not a score.
//
// 2. NO COUNTING URLs. Ten articles copying one original report are not ten
//    confirmations. Corroboration is measured in VOICES — distinct originating
//    publishers, with syndication, aggregators, tracking-parameter duplicates
//    and multiple pages from one domain all collapsed — by
//    src/lib/engine/independence.ts, which this module reuses rather than
//    reimplementing. Adding a fifth outlet repeating the same wire story must
//    not move the band, and source-confidence.test.ts asserts exactly that.
//
// 3. NO GUESSING AT DISAGREEMENT. Two of the six bands — `developing` and
//    `conflicting` — cannot be derived from what this site stores. Nothing in
//    `source_records` expresses "this source contradicts that one"; it holds a
//    URL, a publisher and a reliability tier. A heuristic over those would
//    produce a confident-looking label from no evidence at all, which is the
//    exact failure this project has spent whole phases removing. So both are
//    EDITORIAL flags, set by a person, and their absence means "not flagged",
//    never "checked and fine".
//
// WHAT THE PUBLIC SIDE CAN SEE
// ----------------------------
// `origin_examined` and `originates_from_url` live on engine_discovery_evidence,
// which is admin-only. `source_records` — the table a published article's
// sources actually come from — has neither. So on the public side every voice
// is `origin_unexamined` and carries HALF corroboration weight. That is the
// correct fail-closed direction and it has a real consequence worth stating:
// corroboration between secondary outlets alone never reaches `confirmed`.
// Only a primary source does. Unknown lowers confidence; it never raises it.
//
// Pure. No I/O, no clock, no database.

import { assessIndependence, type IndependenceRow } from "../engine/independence.ts";
import type { ContentType, ReliabilityTier } from "../types/database.ts";

/**
 * The six bands, weakest to strongest in the two ordered runs. `conflicting`
 * and `developing` are not points on the same scale — they describe the STATE
 * of a story rather than the weight behind it, which is why neither can be
 * computed from a source list.
 */
export type ConfidenceBand =
  /** A primary source — the company, standards body or agency itself — says so. */
  | "confirmed"
  /** Two or more genuinely independent outlets, none of them primary. */
  | "strongly_supported"
  /** Editorially flagged: the story is actively changing. */
  | "developing"
  /** One voice. Everything else is a repetition of it. */
  | "single_source"
  /** Only community/forum-grade voices: enthusiast leaks, unnamed accounts. */
  | "rumour_unconfirmed"
  /** Editorially flagged: sources make claims that cannot all be true. */
  | "conflicting";

/**
 * A source as the PUBLIC side actually holds it. Deliberately narrower than
 * the engine's evidence row: if a field is admin-only, it does not appear here,
 * so this module cannot accidentally be given something a reader's page could
 * never supply.
 */
export type PublicSource = {
  url: string;
  publisher: string | null;
  reliabilityTier: ReliabilityTier;
};

/**
 * The editorial flags. Both default to false, and false means NOT FLAGGED —
 * it is not a claim that anyone checked.
 */
export type EditorialClaimState = {
  /** A person marked this story as still unfolding. */
  developing?: boolean;
  /** A person read the sources and found them irreconcilable. */
  conflicting?: boolean;
  /**
   * A person marked the underlying CLAIM as unconfirmed, whatever the standing
   * of who reported it.
   *
   * This exists because of a real mislabelling found on this site:
   * "next-gen-console-rumor-tracker-ps6-xbox" — an article whose subject is
   * explicitly rumour — came out as "Strongly supported", because three
   * reputable outlets had each covered it. That reading is not a bug in the
   * voice counting; it is `source_records.reliability_tier` answering a
   * different question. The tier grades WHO PUBLISHED (is DPReview a serious
   * outlet? yes) and not WHAT THEY CLAIMED (are they reporting a fact or
   * relaying a rumour?). Three independent reports OF A RUMOUR are strong
   * sourcing of a weak claim, and the band must follow the claim.
   *
   * The engine's evidence rows carry claim_status for exactly this, but that
   * table is admin-only; the public source list has no equivalent. So until it
   * does, an editor says so here.
   */
  unconfirmed?: boolean;
};

export type ConfidenceAssessment = {
  band: ConfidenceBand;
  /** The short chip label. */
  label: string;
  /**
   * Plain language, for a reader with no interest in our source model. Says
   * what we know and how we know it — never a score, never jargon.
   */
  explanation: string;
  /** Distinct originating voices. NOT a count of sources or links. */
  independentVoices: number;
  /** Sources that added no new voice, because they repeat one already counted. */
  repeatedSources: number;
};

/**
 * Content types whose central claim is contestable and time-sensitive.
 *
 * `news` only. A review, guide, comparison or troubleshooting piece is our own
 * editorial work rather than a report of someone else's claim — its
 * trustworthiness is a question about us, answered by the sources list and the
 * editorial policy page, not by a chip that would appear identically on all of
 * them and therefore mean nothing.
 */
const BANDED_TYPES: ReadonlySet<ContentType> = new Set<ContentType>(["news"]);

/**
 * Takes a plain string rather than ContentType on purpose. The article page
 * reads `content.type` as a string off the row, and a cast there would silently
 * accept a value the union no longer covers. A Set lookup fails closed instead:
 * an unrecognised type gets no chip, which is the safe direction.
 */
export function shouldShowConfidence(type: string): boolean {
  return BANDED_TYPES.has(type as ContentType);
}

const LABEL: Record<ConfidenceBand, string> = {
  confirmed: "Confirmed",
  strongly_supported: "Strongly supported",
  developing: "Developing",
  single_source: "Single-source report",
  rumour_unconfirmed: "Rumour — unconfirmed",
  conflicting: "Conflicting reports",
};

export function confidenceLabel(band: ConfidenceBand): string {
  return LABEL[band];
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

/**
 * Assess a published story's sources.
 *
 * Returns null when there is nothing to assess. That is deliberately distinct
 * from a weak band: a story with no recorded sources has not been judged
 * poorly, it has not been judged at all, and labelling it "Rumour" would invent
 * a finding. The caller shows its own "no sources recorded" state, which is a
 * different and more honest thing to say.
 */
export function assessSourceConfidence(
  sources: readonly PublicSource[],
  editorial: EditorialClaimState = {}
): ConfidenceAssessment | null {
  if (sources.length === 0) return null;

  // Reuse the engine's voice collapsing. originatesFromUrl is null and
  // originExamined is false for every public row — see the header — so each
  // voice is `origin_unexamined` at half weight.
  const rows: IndependenceRow[] = sources.map((s, i) => ({
    id: `source:${i}`,
    url: s.url,
    publisher: s.publisher,
    originatesFromUrl: null,
    originExamined: false,
  }));
  const independence = assessIndependence(rows);
  const voices = independence.independentVoices;
  const repeated = sources.length - voices;

  // Which tiers survived as their own voice. A primary source that is merely
  // quoted BY another outlet still counts: assessIndependence attributes the
  // row to the originating voice, so being echoed does not erase it.
  const hasPrimary = sources.some((s) => s.reliabilityTier === "primary");
  const hasSecondary = sources.some((s) => s.reliabilityTier === "secondary");

  const echoNote =
    repeated > 0
      ? ` ${repeated} other ${plural(repeated, "source repeats", "sources repeat")} ` +
        `${plural(repeated, "that account", "those accounts")} rather than adding to it.`
      : "";

  // --- The editorial flags win, because they encode something a person read
  // --- and the source list cannot express.
  //
  // `conflicting` outranks `developing`: a reader who is about to act on the
  // story needs to know the accounts disagree more than they need to know it
  // is still moving.
  if (editorial.conflicting) {
    return {
      band: "conflicting",
      label: LABEL.conflicting,
      explanation:
        `The sources we have disagree, and we have not been able to establish which is right. ` +
        `We have set out what each one says rather than picking a version.`,
      independentVoices: voices,
      repeatedSources: repeated,
    };
  }
  // Ranked above `developing` and below `conflicting`: a reader needs "these
  // accounts disagree" more than "this is unconfirmed", but "this is
  // unconfirmed" more than "this is still moving" — a developing story that is
  // also unconfirmed must not read as the safer of the two.
  if (editorial.unconfirmed) {
    return {
      band: "rumour_unconfirmed",
      label: LABEL.rumour_unconfirmed,
      explanation:
        `Whoever reported this, the claim itself is not confirmed. Reputable outlets ` +
        `covering a rumour are reporting that the rumour exists — that is not the same ` +
        `as the thing being true.` + echoNote,
      independentVoices: voices,
      repeatedSources: repeated,
    };
  }
  if (editorial.developing) {
    return {
      band: "developing",
      label: LABEL.developing,
      explanation:
        `This story is still changing. What is written here was accurate when we published it, ` +
        `and we expect to update it as more becomes known.`,
      independentVoices: voices,
      repeatedSources: repeated,
    };
  }

  if (hasPrimary) {
    return {
      band: "confirmed",
      label: LABEL.confirmed,
      explanation:
        `Confirmed by a primary source — the company, standards body or agency directly ` +
        `responsible, rather than someone reporting on them.` + echoNote,
      independentVoices: voices,
      repeatedSources: repeated,
    };
  }

  if (hasSecondary && voices >= 2) {
    return {
      band: "strongly_supported",
      label: LABEL.strongly_supported,
      explanation:
        `${voices} independent publications report this separately, but nobody directly ` +
        `involved has confirmed it. We count publications that did their own reporting — ` +
        `outlets repeating one original report are not separate confirmations.` + echoNote,
      independentVoices: voices,
      repeatedSources: repeated,
    };
  }

  if (hasSecondary) {
    return {
      band: "single_source",
      label: LABEL.single_source,
      explanation:
        `This traces back to one publication. It may well be right, but nothing we have ` +
        `found confirms it independently.` + echoNote,
      independentVoices: voices,
      repeatedSources: repeated,
    };
  }

  return {
    band: "rumour_unconfirmed",
    label: LABEL.rumour_unconfirmed,
    explanation:
      `This comes from community reporting — forums, enthusiast accounts or unnamed ` +
      `sources — and no publication or company has confirmed it. Treat it as unconfirmed.` +
      echoNote,
    independentVoices: voices,
    repeatedSources: repeated,
  };
}
