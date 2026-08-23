// Turning a jsonb spec value into something a reader should see.
//
// WHY THIS EXISTS
// ---------------
// Both the product page and the comparison table rendered spec values with
// `String(value)`. That is correct for most of the catalogue and wrong for 98
// of 582 rows, which are DOUBLE-ENCODED: the stored jsonb is a JSON string
// whose contents are themselves JSON. `String()` on one of those yields the
// outer encoding verbatim, so 22 product pages were publishing things like
//
//     "1/1.3\", 13.5 stops dynamic range"
//     "6.3\""
//
// quotation marks, backslashes and all, in the visible specification table.
//
// TWO SEPARATE FIXES, AND THIS IS ONLY ONE OF THEM
// ------------------------------------------------
// The data is also wrong and should be normalised — see
// supabase/migrations_pending/20260825_normalise_double_encoded_specs.sql. This
// module is the DISPLAY half, and it is worth having even after the data is
// clean: it is the difference between a bad write showing up as a slightly odd
// value and a bad write publishing raw JSON to readers. Rendering is where the
// guarantee belongs, because rendering is the last point before a person sees it.
//
// WHAT IT WILL NOT DO
// -------------------
// It never returns "[object Object]" or "undefined" or "null" as visible text.
// A value it cannot make sense of yields null, and every caller already knows
// how to render an absent value honestly ("Not recorded" in the comparison
// table, omitted on the product page). A placeholder that looks like data is
// worse than a gap that looks like a gap.
//
// Pure. No I/O.

/** Guard against a pathologically nested value; three is already absurd. */
const MAX_UNWRAP_DEPTH = 3;

/**
 * Unwrap a JSON-encoded string, repeatedly, but ONLY while the result is
 * itself a string.
 *
 * The "only a string" condition is what keeps this safe. `"256"` parses to the
 * NUMBER 256, not a string, so it is left alone rather than silently retyped —
 * and `"256GB / 512GB / 1TB"` does not parse at all, so it is left alone too.
 * The rule fires exactly on the double-encoding case it was written for.
 */
function unwrapJsonString(input: string): string {
  let current = input;
  for (let depth = 0; depth < MAX_UNWRAP_DEPTH; depth++) {
    const trimmed = current.trim();
    // A JSON string literal always starts and ends with a double quote. Cheap
    // test first so the overwhelming majority of values never reach JSON.parse.
    if (trimmed.length < 2 || !trimmed.startsWith('"') || !trimmed.endsWith('"')) return current;
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (typeof parsed !== "string") return current;
      current = parsed;
    } catch {
      return current;
    }
  }
  return current;
}

/**
 * Format one spec value for display.
 *
 * Returns null when there is nothing honest to show, which callers render as
 * their own absent-value state rather than as an empty cell.
 */
export function formatSpecValue(value: unknown, unit: string | null = null): string | null {
  if (value === null || value === undefined) return null;

  if (typeof value === "boolean") return value ? "Yes" : "No";

  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    return withUnit(String(value), unit);
  }

  if (typeof value === "string") {
    const text = unwrapJsonString(value).trim();
    if (text === "") return null;
    return withUnit(text, unit);
  }

  if (Array.isArray(value)) {
    // Each element formatted on its own, so a list of double-encoded strings
    // comes out clean too. The unit goes on the list, not on every item.
    const parts = value
      .map((v) => formatSpecValue(v, null))
      .filter((s): s is string => s !== null && s !== "");
    if (parts.length === 0) return null;
    return withUnit(parts.join(", "), unit);
  }

  // An object. There is no general way to render one as a specification value,
  // and String() would print "[object Object]" to a reader. Nothing is the
  // honest answer.
  return null;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Append the definition's unit, unless the value already carries it.
 *
 * Checking only the END of the string is not enough: this catalogue stores
 * "20m without case, 60m with case" against a unit of "m", which ends in
 * "case". So the test is whether the unit appears ATTACHED TO A NUMBER anywhere
 * in the value — "20m", "45 MP", "6.3\"" — which is what carrying a unit
 * actually looks like and does not fire on an unrelated word that happens to
 * contain the same letters.
 */
function withUnit(text: string, unit: string | null): string {
  const u = (unit ?? "").trim();
  if (u === "") return text;

  // A word-boundary anchor is meaningless for a symbol unit like " or °, so
  // those are matched without one.
  const isWordUnit = /^[a-z0-9]+$/i.test(u);
  const pattern = new RegExp(
    `\\d\\s*${escapeRegExp(u)}${isWordUnit ? "\\b" : ""}`,
    "i"
  );
  if (pattern.test(text)) return text;

  return `${text} ${u}`;
}
