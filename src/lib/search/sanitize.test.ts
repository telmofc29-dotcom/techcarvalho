import { test } from "node:test";
import assert from "node:assert/strict";
import { sanitizeSearchTerm } from "./sanitize.ts";

test("passes through ordinary text unchanged", () => {
  assert.equal(sanitizeSearchTerm("Canon EOS R5"), "Canon EOS R5");
});

test("strips comma, parens, and percent — PostgREST filter syntax", () => {
  assert.equal(sanitizeSearchTerm("a,b(c)d%e"), "abcde");
});

test("trims surrounding whitespace", () => {
  assert.equal(sanitizeSearchTerm("  camera  "), "camera");
});

test("a filter-injection attempt is neutralized, not rejected", () => {
  // Without sanitization this could inject an extra .or() clause via
  // PostgREST's comma-separated filter syntax.
  const attempt = "x,name.ilike.*)or(id.neq.0";
  const cleaned = sanitizeSearchTerm(attempt);
  assert.ok(!cleaned.includes(","));
  assert.ok(!cleaned.includes("("));
  assert.ok(!cleaned.includes(")"));
});

test("empty/whitespace-only input yields empty string", () => {
  assert.equal(sanitizeSearchTerm("   "), "");
});
