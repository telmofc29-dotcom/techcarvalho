import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

// A SOURCE LINT, not a unit test.
//
// WHY THIS IS A TEST AND NOT A CODE REVIEW ITEM
// ---------------------------------------------
// 20260824_translation_model.sql gave content_items a `locale` column and made
// slugs unique per locale. Every public query that reads content_items and does
// NOT filter on locale will, the moment a translation is published, mix a
// Portuguese article into an English listing — on the homepage, in search
// results, in "related articles", and in the sitemap as a URL that 404s.
//
// An audit found eighteen such queries. Fixing eighteen call sites is easy;
// keeping them fixed is not. The nineteenth gets added six months from now by
// someone who has never heard of this, nothing errors, and the site quietly
// starts serving two languages at one URL space.
//
// So the rule is enforced mechanically against the source. It is deliberately
// crude — it reads files and looks for a locale filter near each query — and
// crude is the point: it needs no runtime, no database, and no fixtures, so it
// cannot rot.
//
// HOW TO SATISFY IT
// -----------------
// Add `.eq("locale", ROOT_LOCALE)` (or an explicit locale variable) within a
// few lines of the `.from("content_items")` call. If a query genuinely must
// span every locale — the translation coverage reader is the real example —
// name the file in ALLOWED_UNSCOPED with the reason.

const PUBLIC_DIRS = ["src/lib/public", "src/app/(public)"];
const EXTRA_FILES = ["src/app/sitemap.ts"];

/**
 * Files whose content_items queries legitimately span locales.
 *
 * Each needs a REASON, not just an entry. An allow-list nobody has to justify
 * becomes the place unscoped queries go to hide.
 */
const ALLOWED_UNSCOPED: Record<string, string> = {
  "src/lib/public/article-translation.ts":
    "This module's entire job is to find the OTHER locales of an article. Scoping it to English would make it always return English.",
};

/** How many lines after `.from("content_items")` a locale filter may appear. */
const PROXIMITY_LINES = 14;

function walk(dir: string): string[] {
  let out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = join(dir, e);
    if (statSync(full).isDirectory()) out = out.concat(walk(full));
    else if (/\.tsx?$/.test(full) && !/\.test\.tsx?$/.test(full)) out.push(full);
  }
  return out;
}

test("every PUBLIC read of content_items is scoped to a locale", () => {
  const root = process.cwd();
  const files = [...PUBLIC_DIRS.flatMap((d) => walk(join(root, d))), ...EXTRA_FILES.map((f) => join(root, f))];

  const offenders: string[] = [];

  for (const file of files) {
    let source: string;
    try {
      source = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    if (!source.includes('from("content_items")')) continue;

    const rel = relative(root, file).replace(/\\/g, "/");
    if (rel in ALLOWED_UNSCOPED) continue;

    const lines = source.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].includes('from("content_items")')) continue;
      const window = lines.slice(i, i + PROXIMITY_LINES).join("\n");
      // Accepts .eq("locale", …) and .in("locale", …) — a page that
      // deliberately serves several locales is still scoped.
      if (!/\.(eq|in)\(\s*["']locale["']/.test(window)) {
        offenders.push(`${rel}:${i + 1}`);
      }
    }
  }

  assert.deepEqual(
    offenders,
    [],
    "These public queries read content_items without a locale filter. Once a translation " +
      "is published they will mix languages into English pages, and the sitemap will emit " +
      "URLs that 404. Add .eq(\"locale\", ROOT_LOCALE), or add the file to ALLOWED_UNSCOPED " +
      "with a reason:\n  " + offenders.join("\n  ")
  );
});

test("the lint is actually looking at files — a vacuous pass would be worthless", () => {
  // If the directory names ever change, the test above would pass by finding
  // nothing at all. This asserts it really did inspect the public tree.
  const root = process.cwd();
  const files = PUBLIC_DIRS.flatMap((d) => walk(join(root, d)));
  assert.ok(files.length > 10, `expected to scan the public tree, found ${files.length} files`);
  const withQueries = files.filter((f) => readFileSync(f, "utf8").includes('from("content_items")'));
  assert.ok(withQueries.length > 0, "expected at least one public file to query content_items");
});

test("every allow-list entry names a real file", () => {
  // A stale allow-list entry silently exempts nothing and hides the fact that
  // the exemption is no longer needed.
  const root = process.cwd();
  for (const rel of Object.keys(ALLOWED_UNSCOPED)) {
    const source = readFileSync(join(root, rel), "utf8");
    assert.ok(
      source.includes('from("content_items")'),
      `${rel} is allow-listed but no longer queries content_items — remove the entry.`
    );
  }
});
