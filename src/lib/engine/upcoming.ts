// UPCOMING LAUNCH INTELLIGENCE — knowing about something before launch day.
//
// The engine could only react to developments that had already happened. This
// reads the TIMING out of a headline, so a story about something scheduled is
// distinguishable from a story about something that shipped.
//
// TIMING HAS ITS OWN CERTAINTY, SEPARATE FROM THE CLAIM
// -----------------------------------------------------
// This is the whole reason the module exists rather than a regex in a job.
// These two are both "October", and they are not the same fact:
//
//   "New iPad Mini With Four Upgrades Expected to Launch by Late October"
//       -> a RUMOURED window. Nobody has said this.
//   "Apple's New Mac Mini and Mac Studio Are Now Available to Pre-Order"
//       -> availability that demonstrably exists right now.
//
// A date extracted from a rumour is a RUMOURED date. It must never be rendered,
// drafted or stored as a schedule. So `dateAssertable` is derived from the
// claim's confirmation state, never from how confidently the sentence is
// phrased — "will definitely launch in October" is still a rumour if only a
// leaker said it.
//
// WHAT IT DELIBERATELY DOES NOT DO
// --------------------------------
// It does not resolve a relative phrase into a calendar date. "Next month"
// against a publication date is arithmetic this cannot do safely: feeds
// frequently carry no publication date, and a wrong date is worse than a
// phrase. The phrase is preserved verbatim instead, which is always true.

import { classifyConfirmation, type ConfirmationState } from "./opportunity-score.ts";

export type TimingKind =
  /** An explicit calendar reference: "September 9", "Q4 2026", "in 2028". */
  | "dated"
  /** A relative window: "next month", "later this year", "within weeks". */
  | "relative"
  /** Tied to a named industry event: "at WWDC", "Ahead of RTX Spark Launch". */
  | "event"
  /** Buyable or shipping imminently: "now available to pre-order". */
  | "imminent"
  /** Future-tense with no timing at all. */
  | "unspecified";

export type UpcomingSignal = {
  /** True when the headline is about something that has NOT happened yet. */
  isUpcoming: boolean;
  kind: TimingKind;
  /** The timing phrase exactly as written. Never normalised into a date. */
  timingText: string | null;
  /** The claim's confirmation state, carried through unchanged. */
  confirmation: ConfirmationState;
  /**
   * Whether the timing may be stated as a schedule.
   *
   * False for rumour and speculation, however specific the date sounds. This is
   * the flag that stops a leaked date being rendered as an announced one.
   */
  dateAssertable: boolean;
  reason: string;
};

// Ordered most specific first.
const TIMING_RULES: readonly { kind: TimingKind; pattern: RegExp }[] = [
  // Explicit calendar references.
  { kind: "dated", pattern: /\b(january|february|march|april|may|june|july|august|september|october|november|december|sept?\.?)\s+\d{1,2}\b/i },
  { kind: "dated", pattern: /\b\d{1,2}\s+(january|february|march|april|may|june|july|august|september|october|november|december)\b/i },
  { kind: "dated", pattern: /\b(q[1-4]|h[12])\s*20\d{2}\b/i },
  { kind: "dated", pattern: /\b(early|mid|late)[- ](january|february|march|april|may|june|july|august|september|october|november|december|20\d{2})\b/i },
  { kind: "dated", pattern: /\b(in|by|during|for)\s+20\d{2}\b/i },
  { kind: "dated", pattern: /\b20\d{2}\s+(release|launch|debut)\b/i },

  // Named industry events. These ARE a schedule when a first party names one.
  { kind: "event", pattern: /\b(wwdc|ces\b|ifa\b|computex|gamescom|gdc\b|hot chips|opening night live|game awards|unpacked|made by google|build 20\d\d|ignite|gtc\b|siggraph|photokina)\b/i },
  { kind: "event", pattern: /\bahead of (the )?[A-Z][\w' ]{2,28}(launch|event|release|show)\b/i },
  { kind: "event", pattern: /\b(september|october|november|december|spring|autumn|fall|summer|winter) event\b/i },

  // Buyable ahead of general availability, or shipping within days.
  //
  // "out now" and "available today" are DELIBERATELY ABSENT: they mean the
  // thing has already shipped, which is the opposite of upcoming. Including
  // them classified "Nvidia DLSS 4.5, out now" as a future launch.
  { kind: "imminent", pattern: /\b(now available to pre[- ]?order|pre[- ]?orders? (are |now )?(open|live|start|available)|goes on sale|ships? (this|next) (week|month))\b/i },

  // Relative windows.
  { kind: "relative", pattern: /\b(next (month|week|year)|later this (year|month)|within (weeks|months|days)|in the coming (weeks|months|days)|this (autumn|fall|spring|summer|winter)|as early as next \w+|by the end of the year)\b/i },
];

/** Future tense without any timing attached. */
const FUTURE_TENSE =
  /\b(will (launch|announce|arrive|ship|release|unveil|introduce|debut)|to launch|to arrive|set to (launch|arrive|ship|debut)|expected to|upcoming|due to (launch|arrive)|is coming|are coming|planned for|slated for|release date)\b/i;

/**
 * Read the timing out of a headline.
 *
 * @param headline The headline text.
 * @param options.firstParty An evidence URL on the subject's own domain. Only
 *   this can make a schedule assertable, exactly as with confirmation.
 */
export function detectUpcoming(
  headline: string,
  options: { firstParty?: boolean } = {}
): UpcomingSignal {
  const confirmation = classifyConfirmation(headline, options).state;

  // A date is only a schedule when somebody actually committed to it.
  const dateAssertable = confirmation === "confirmed" || confirmation === "announced";

  let kind: TimingKind = "unspecified";
  let timingText: string | null = null;
  for (const rule of TIMING_RULES) {
    const m = headline.match(rule.pattern);
    if (m) { kind = rule.kind; timingText = m[0]; break; }
  }

  // Explicit past/present availability overrides everything: a thing that is
  // already out cannot be upcoming, however many future-tense words surround it.
  // The "to pre-order" exclusion is load-bearing. "Are Now Available to
  // Pre-Order" contains "are now available", and matching that classified a
  // pre-order announcement — the clearest possible upcoming launch — as
  // something that had already shipped.
  const alreadyShipped =
    /\b(out now|released today|now shipping)\b/i.test(headline) ||
    /\b((is|are) now available|available (today|now))\b(?!\s*(to|for)\s*pre[- ]?order)/i.test(headline);

  const hasFutureTense = FUTURE_TENSE.test(headline);
  // "imminent" and a timing phrase both imply the thing has not fully landed;
  // future tense alone counts even with no timing attached.
  const isUpcoming = !alreadyShipped && (kind !== "unspecified" || hasFutureTense);

  let reason: string;
  if (!isUpcoming) {
    reason = "Describes something that has already happened.";
  } else if (!dateAssertable) {
    reason =
      timingText
        ? `Timing "${timingText}" comes from an unconfirmed report — a ${confirmation}, not a schedule.`
        : `Described as upcoming, but the claim is a ${confirmation} with no stated timing.`;
  } else if (timingText) {
    reason = `Scheduled: "${timingText}", ${confirmation === "confirmed" ? "confirmed by the company" : "announced publicly"}.`;
  } else {
    reason = "Announced as upcoming, with no specific timing stated.";
  }

  return { isUpcoming, kind, timingText, confirmation, dateAssertable, reason };
}

/**
 * How much a scheduled item should be brought forward in the queue.
 *
 * A CONFIRMED imminent launch is the most actionable thing an editorial queue
 * can hold — the work can be prepared before the day. A rumoured date is worth
 * knowing and worth nothing extra in ranking, so it gets no boost at all rather
 * than a small one: a small boost is how rumours creep up a list.
 */
export function upcomingBoost(signal: UpcomingSignal): number {
  if (!signal.isUpcoming || !signal.dateAssertable) return 0;
  switch (signal.kind) {
    case "imminent": return 0.10;
    case "dated": return 0.08;
    case "event": return 0.06;
    case "relative": return 0.03;
    default: return 0.01;
  }
}
