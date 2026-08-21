import { test } from "node:test";
import assert from "node:assert/strict";
import { sanitizeEventText, sanitizeSlug } from "./events.ts";

test("sanitizeEventText: strips angle brackets", () => {
  assert.equal(sanitizeEventText("<script>alert(1)</script>"), "scriptalert(1)/script");
});

test("sanitizeEventText: trims whitespace", () => {
  assert.equal(sanitizeEventText("  hello world  "), "hello world");
});

test("sanitizeEventText: caps length at 200 characters", () => {
  const input = "a".repeat(500);
  assert.equal(sanitizeEventText(input).length, 200);
});

test("sanitizeSlug: strips anything outside [a-z0-9-]", () => {
  assert.equal(sanitizeSlug("../../etc/passwd"), "etcpasswd");
});

test("sanitizeSlug: allows a normal slug through unchanged", () => {
  assert.equal(sanitizeSlug("sony-a7-iv"), "sony-a7-iv");
});

test("sanitizeSlug: caps length at 100 characters", () => {
  const input = "a".repeat(300);
  assert.equal(sanitizeSlug(input).length, 100);
});
