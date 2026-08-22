// Date presentation helpers for the public site.
//
// These live in the data layer rather than in components on purpose: reading
// the clock during render is an impure operation (react-hooks/purity), so a
// component must be handed an already-computed label instead of computing one
// itself. `now` is an explicit parameter so the behaviour is deterministic and
// testable rather than depending on ambient state.

/**
 * Relative freshness while "how recent" is still the useful information,
 * absolute date once it stops being.
 *
 * Returns null for a missing/invalid date or a future one — the caller renders
 * nothing rather than inventing a plausible-looking timestamp.
 */
export function freshnessLabel(publishedAt: string | null, now: number = Date.now()): string | null {
  if (!publishedAt) return null;
  const published = new Date(publishedAt);
  if (Number.isNaN(published.getTime())) return null;

  const hours = Math.floor((now - published.getTime()) / 3_600_000);
  if (hours < 0) return null;
  if (hours < 1) return "Just published";
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return absoluteDateLabel(publishedAt);
}

/** Plain absolute date, e.g. "21 Aug 2026". Null when there is no real date. */
export function absoluteDateLabel(publishedAt: string | null): string | null {
  if (!publishedAt) return null;
  const published = new Date(publishedAt);
  if (Number.isNaN(published.getTime())) return null;
  return published.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}
