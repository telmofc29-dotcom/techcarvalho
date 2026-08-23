// Who is responsible for a piece, and in what way.
//
// WHY THIS EXISTS
// ---------------
// Every published article on this site carried the byline "By Telmo Carvalho"
// and emitted `author: Person` in its structured data. That is not true of this
// corpus. These pieces were drafted with machine assistance and then read,
// corrected and published by a person. "By" claims the first half of that and
// hides the second; it is the wrong claim, and it is the kind of wrong claim
// that matters most on a site whose entire pitch is that it does not overstate
// what it did.
//
// "Reviewed and published by" is true, and it is a stronger statement than it
// looks: it says a named person put their name against this before it went
// live and is answerable for it. A reader who wants to know whether anybody
// stood behind the page gets a straight answer.
//
// NOT ARCHITECTURALLY PERMANENT
// -----------------------------
// This deliberately models attribution as a per-article FACT, not as a
// site-wide assumption. If a piece is one day written from scratch by a person,
// it gets `authored` and the byline reads "By". If the site one day publishes
// genuine hands-on testing, that is a different claim again and gets its own
// kind rather than being smuggled in under an existing one. The wrong shape
// here would be a boolean, because a boolean cannot grow a third state without
// every call site being revisited.
//
// WHAT IT REFUSES TO EXPRESS
// --------------------------
// There is no kind meaning "staff", "our team", "editorial desk" or any other
// collective that does not exist. This is a one-person publication; a byline
// implying otherwise would be an invention. And no kind asserts testing —
// TESTED is not in this union, because claiming hands-on testing needs
// evidence, not an enum value.
//
// Pure. No I/O.

export type AttributionKind =
  /** A named person wrote this piece themselves. */
  | "authored"
  /**
   * Drafted with machine assistance, then read, corrected and published by a
   * named person who is answerable for it. The honest description of this
   * corpus today, and the DEFAULT.
   */
  | "reviewed_published"
  /** Nobody is named. No byline renders at all. */
  | "unattributed";

/**
 * The default for any article that does not say otherwise.
 *
 * `reviewed_published`, not `authored`, and deliberately not `unattributed`.
 * Defaulting to `authored` would restate the falsehood this module exists to
 * remove; defaulting to `unattributed` would drop a true and useful statement —
 * a person really did review and publish every one of these.
 */
export const DEFAULT_ATTRIBUTION: AttributionKind = "reviewed_published";

export function isAttributionKind(value: unknown): value is AttributionKind {
  return value === "authored" || value === "reviewed_published" || value === "unattributed";
}

/**
 * Coerce whatever the database returned into a kind.
 *
 * An unrecognised value falls back to the DEFAULT rather than throwing or
 * being trusted, so a future enum value added in SQL before it is added here
 * degrades to the modest claim instead of the strong one.
 */
export function attributionKind(value: unknown): AttributionKind {
  return isAttributionKind(value) ? value : DEFAULT_ATTRIBUTION;
}

/**
 * The visible byline, or null when nothing should render.
 *
 * Returns the two halves separately so the page can weight them typographically
 * — the person's name is the part a reader scans for.
 */
export function bylineFor(
  kind: AttributionKind,
  personName: string | null | undefined
): { prefix: string; name: string } | null {
  if (!personName) return null;
  switch (kind) {
    case "authored":
      return { prefix: "By", name: personName };
    case "reviewed_published":
      return { prefix: "Reviewed and published by", name: personName };
    case "unattributed":
      return null;
  }
}

/**
 * How the piece should be described in structured data.
 *
 * The mapping matters as much as the byline, because a crawler reading
 * `author: Person` is being told the same untrue thing a reader was.
 *
 *   authored            -> the person is the author.
 *   reviewed_published  -> the PUBLICATION is the author, and the person is the
 *                          editor. schema.org allows an Organization as author,
 *                          and `editor` is exactly "the person who edited this".
 *                          Together they say what happened without either half
 *                          overstating.
 *   unattributed        -> the publication is the author and no person is named.
 */
export type StructuredAttribution = {
  /** True when the named person should appear as schema.org `author`. */
  personIsAuthor: boolean;
  /** True when the named person should appear as schema.org `editor`. */
  personIsEditor: boolean;
};

export function structuredAttribution(kind: AttributionKind): StructuredAttribution {
  switch (kind) {
    case "authored":
      return { personIsAuthor: true, personIsEditor: false };
    case "reviewed_published":
      return { personIsAuthor: false, personIsEditor: true };
    case "unattributed":
      return { personIsAuthor: false, personIsEditor: false };
  }
}
