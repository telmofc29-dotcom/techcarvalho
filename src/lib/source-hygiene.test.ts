import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// A LITERAL CONTROL CHARACTER IN SOURCE IS INVISIBLE AND SILENTLY WRONG.
//
// A scripted edit once wrote a real backspace byte (0x08) where a regex needed
// the two characters \ and b. The result, /<BS>(reportedly|...)<BS>/gi, is a
// VALID regular expression that simply never matches, so the hedge-stripping
// step stopped working with no error anywhere. It rendered identically to the
// correct code in the editor, in `git diff`, and in every file read — the only
// way to see it was to dump the bytes.
//
// Nothing legitimate in this codebase needs a raw control character in source,
// so scanning for them costs nothing and makes that failure impossible to
// reintroduce unnoticed.
const FORBIDDEN = new Set([0x08, 0x07, 0x0b, 0x0c, 0x1b, 0x00]);
const NAMES: Record<number, string> = {
  0x08: "BACKSPACE (likely a mangled \b)",
  0x07: "BELL (likely a mangled \a)",
  0x0b: "VERTICAL TAB (likely a mangled \v)",
  0x0c: "FORM FEED (likely a mangled \f)",
  0x1b: "ESCAPE",
  0x00: "NUL",
};

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

test("no source file contains a raw control character", () => {
  const offenders: string[] = [];
  for (const file of sourceFiles("src")) {
    const bytes = readFileSync(file);
    for (let i = 0; i < bytes.length; i++) {
      if (FORBIDDEN.has(bytes[i])) {
        const line = bytes.subarray(0, i).toString("utf8").split("\n").length;
        offenders.push(`${file}:${line} contains ${NAMES[bytes[i]]}`);
        break;
      }
    }
  }
  assert.deepEqual(offenders, [], `\n${offenders.join("\n")}`);
});
