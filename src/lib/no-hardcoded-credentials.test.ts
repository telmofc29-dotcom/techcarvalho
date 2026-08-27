import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

// NO SOURCE FILE MAY CARRY A CREDENTIAL.
//
// WHY THIS TEST EXISTS
// --------------------
// scripts/audit-media-rights.ts carried a real production admin email and
// password as string literals, and it was committed (ab4b085). Nineteen other
// scripts in the same directory read process.env correctly, which is precisely
// why nobody noticed: the surrounding code looked right, and the one exception
// was a single line in the middle of a file about something else.
//
// A convention that holds in 19 places out of 20 is not a convention, it is an
// accident with a good record. This makes it mechanical.
//
// WHAT IT CHECKS
// --------------
// A sign-in call whose password argument is a STRING LITERAL rather than an
// environment lookup. It deliberately does not try to detect "things that look
// like passwords" — that is unbounded, and a check that cries wolf gets
// deleted. This targets the one shape that actually happened and that actually
// matters: a literal handed to an authentication call.
//
// It scans the whole repository, not just src/, because the file that broke the
// rule was in scripts/ and would not have been covered otherwise. That was the
// other half of the miss.

const HERE = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = join(HERE, "..", "..");

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".next",
  "out",
  "dist",
  "build",
  ".vercel",
]);

const CODE_EXTENSIONS = [".ts", ".tsx", ".js", ".mjs", ".cjs", ".jsx"];

function walk(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    let stats;
    try {
      stats = statSync(full);
    } catch {
      continue; // a symlink or a file that vanished mid-walk is not a finding
    }
    if (stats.isDirectory()) walk(full, found);
    else if (CODE_EXTENSIONS.some((e) => entry.endsWith(e))) found.push(full);
  }
  return found;
}

/**
 * `password: "..."` or `password:'...'` — a literal, in any spacing.
 *
 * `password: process.env.X`, `password`, `password: pw` and
 * `password: formData.get("password")` all pass, because none of them puts a
 * secret in the file. An empty string passes too: it is a placeholder, not a
 * credential.
 */
const LITERAL_PASSWORD = /\bpassword\s*:\s*(["'])(?!\s*\1)[^"'\n]+\1/;

/**
 * The same shape for an API key or token handed straight to a client.
 *
 * Deliberately narrow: only the `service_role`/`serviceRole` names, which are
 * the ones that would be catastrophic in a client bundle.
 */
const LITERAL_SERVICE_KEY = /\b(service_?[Rr]ole[A-Za-z]*)\s*[:=]\s*(["'])(?!\s*\2)[^"'\n]{20,}\2/;

test("no source file hardcodes a password literal", () => {
  const offenders: string[] = [];
  for (const file of walk(REPO_ROOT)) {
    // This file necessarily contains the patterns it is looking for.
    if (file.endsWith("no-hardcoded-credentials.test.ts")) continue;
    const source = readFileSync(file, "utf-8");
    for (const [index, line] of source.split(/\r?\n/).entries()) {
      // A comment showing the invocation shape is documentation, not a secret:
      //   TC_ADMIN_EMAIL=... TC_ADMIN_PASSWORD=... npx tsx scripts/x.ts
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) continue;
      if (LITERAL_PASSWORD.test(line)) {
        offenders.push(`${relative(REPO_ROOT, file)}:${index + 1}`);
      }
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `credential literal(s) found — read them from process.env instead:\n  ${offenders.join("\n  ")}`
  );
});

test("no source file hardcodes a service-role key", () => {
  const offenders: string[] = [];
  for (const file of walk(REPO_ROOT)) {
    if (file.endsWith("no-hardcoded-credentials.test.ts")) continue;
    const source = readFileSync(file, "utf-8");
    for (const [index, line] of source.split(/\r?\n/).entries()) {
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) continue;
      if (LITERAL_SERVICE_KEY.test(line)) {
        offenders.push(`${relative(REPO_ROOT, file)}:${index + 1}`);
      }
    }
  }
  assert.deepEqual(offenders, [], `service-role key literal(s):\n  ${offenders.join("\n  ")}`);
});

// This codebase has no service-role key at all — every read and write goes
// through anon/authenticated and is gated by RLS. Pinning that here means an
// attempt to introduce one has to delete a test that says why it must not.
test("no NEXT_PUBLIC_ variable is ever assigned a service-role key", () => {
  const offenders: string[] = [];
  for (const file of walk(REPO_ROOT)) {
    if (file.endsWith("no-hardcoded-credentials.test.ts")) continue;
    const source = readFileSync(file, "utf-8");
    for (const [index, line] of source.split(/\r?\n/).entries()) {
      if (/NEXT_PUBLIC_[A-Z_]*/.test(line) && /service_?[Rr]ole/.test(line)) {
        offenders.push(`${relative(REPO_ROOT, file)}:${index + 1}`);
      }
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `a NEXT_PUBLIC_ variable reaches the browser bundle:\n  ${offenders.join("\n  ")}`
  );
});
