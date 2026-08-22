// Creative Commons licence deed URLs.
//
// CC BY and CC BY-SA both require the reuser to "provide a link to the
// license" and "a link to the material" — not merely to name them. The
// product page was rendering its credit as plain text, so with twelve
// Commons-sourced product photographs live, the site was naming the licence
// it depends on without linking to it.
//
// The licence string is whatever was recorded on the asset when a human
// verified the file page, so this maps the forms that actually appear rather
// than trying to parse arbitrary text.

const DEEDS: [RegExp, string][] = [
  [/^cc[\s-]?by[\s-]?sa[\s-]?4(\.0)?$/i, "https://creativecommons.org/licenses/by-sa/4.0/"],
  [/^cc[\s-]?by[\s-]?sa[\s-]?3(\.0)?$/i, "https://creativecommons.org/licenses/by-sa/3.0/"],
  [/^cc[\s-]?by[\s-]?sa[\s-]?2\.5$/i, "https://creativecommons.org/licenses/by-sa/2.5/"],
  [/^cc[\s-]?by[\s-]?sa[\s-]?2(\.0)?$/i, "https://creativecommons.org/licenses/by-sa/2.0/"],
  [/^cc[\s-]?by[\s-]?4(\.0)?$/i, "https://creativecommons.org/licenses/by/4.0/"],
  [/^cc[\s-]?by[\s-]?3(\.0)?$/i, "https://creativecommons.org/licenses/by/3.0/"],
  [/^cc[\s-]?by[\s-]?2\.5$/i, "https://creativecommons.org/licenses/by/2.5/"],
  [/^cc[\s-]?by[\s-]?2(\.0)?$/i, "https://creativecommons.org/licenses/by/2.0/"],
  [/^cc0([\s-]?1(\.0)?)?$/i, "https://creativecommons.org/publicdomain/zero/1.0/"],
  [/^public domain$/i, "https://creativecommons.org/publicdomain/mark/1.0/"],
];

/**
 * Deed URL for a recorded licence string, or null when it is not a licence
 * whose exact terms are known.
 *
 * Null is a real answer: linking an unrecognised licence string to a guessed
 * deed would misstate the terms the image is actually used under, which is
 * worse than showing the name alone.
 */
export function licenceUrl(license: string | null | undefined): string | null {
  if (!license) return null;
  const key = license.trim();
  for (const [pattern, url] of DEEDS) {
    if (pattern.test(key)) return url;
  }
  return null;
}

/** Whether a licence requires attribution at all. CC0 and PD do not. */
export function requiresAttribution(license: string | null | undefined): boolean {
  if (!license) return false;
  return !/^(cc0|public domain)/i.test(license.trim());
}

/**
 * The host shown as the "link to the material", e.g. "Wikimedia Commons".
 * Falls back to the bare hostname so an unfamiliar source is still named
 * rather than silently rendered as a bare URL.
 */
export function sourceLabel(sourceUrl: string | null | undefined): string | null {
  if (!sourceUrl) return null;
  try {
    const host = new URL(sourceUrl).hostname.replace(/^www\./, "");
    if (host.endsWith("wikimedia.org")) return "Wikimedia Commons";
    if (host.endsWith("wikipedia.org")) return "Wikipedia";
    return host;
  } catch {
    return null;
  }
}
