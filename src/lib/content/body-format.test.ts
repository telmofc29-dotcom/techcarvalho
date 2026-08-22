import { test } from "node:test";
import assert from "node:assert/strict";
import { parseBodyBlocks, excerptFromBody } from "./body-format.ts";

test("plain paragraphs separated by blank lines", () => {
  const blocks = parseBodyBlocks("First paragraph.\n\nSecond paragraph.");
  assert.deepEqual(blocks, [
    { kind: "paragraph", text: "First paragraph." },
    { kind: "paragraph", text: "Second paragraph." },
  ]);
});

test("a multi-line paragraph is joined with spaces", () => {
  const blocks = parseBodyBlocks("Line one\nline two continues.");
  assert.deepEqual(blocks, [{ kind: "paragraph", text: "Line one line two continues." }]);
});

test("## and ### produce heading levels 2 and 3", () => {
  const blocks = parseBodyBlocks("## Section\n\n### Subsection");
  assert.deepEqual(blocks, [
    { kind: "heading", level: 2, text: "Section" },
    { kind: "heading", level: 3, text: "Subsection" },
  ]);
});

test("- lines group into a single list block", () => {
  const blocks = parseBodyBlocks("- one\n- two\n- three");
  assert.deepEqual(blocks, [{ kind: "list", items: ["one", "two", "three"] }]);
});

test("mixed heading, paragraph, and list in one body", () => {
  const blocks = parseBodyBlocks("## Verdict\n\nIt's solid.\n\n- Pro one\n- Pro two");
  assert.deepEqual(blocks, [
    { kind: "heading", level: 2, text: "Verdict" },
    { kind: "paragraph", text: "It's solid." },
    { kind: "list", items: ["Pro one", "Pro two"] },
  ]);
});

test("empty body yields no blocks", () => {
  assert.deepEqual(parseBodyBlocks(""), []);
});

test("a line starting with a bare '-' character but no space is treated as a paragraph, not a list item", () => {
  const blocks = parseBodyBlocks("-5 degrees outside.");
  assert.deepEqual(blocks, [{ kind: "paragraph", text: "-5 degrees outside." }]);
});

// excerptFromBody is the last-resort <meta description> for a piece whose
// editor never wrote one. It must never invent text, and must never emit a
// fragment that reads as broken.

test("excerptFromBody: uses the opening paragraph, not a heading", () => {
  assert.equal(
    excerptFromBody("## Verdict\n\nThe A7 IV is the most complete camera Sony has shipped."),
    "The A7 IV is the most complete camera Sony has shipped."
  );
});

test("excerptFromBody: returns null when there is nothing to describe", () => {
  assert.equal(excerptFromBody(null), null);
  assert.equal(excerptFromBody(""), null);
  assert.equal(excerptFromBody("## Only a heading"), null);
  assert.equal(excerptFromBody("- only\n- a list"), null);
});

test("excerptFromBody: truncates on a word boundary and marks the cut", () => {
  const long = ("word ".repeat(80)).trim();
  const result = excerptFromBody(long);
  assert.ok(result);
  assert.ok(result!.length <= 161, `expected a trimmed description, got ${result!.length} chars`);
  assert.ok(result!.endsWith("…"));
  assert.equal(result!.includes("wor…"), false, "must not cut mid-word");
});

test("excerptFromBody: a short paragraph is returned whole, with no ellipsis", () => {
  const result = excerptFromBody("Short and complete.");
  assert.equal(result, "Short and complete.");
});

test("excerptFromBody: refuses a 160-character run with no spaces — that is not prose", () => {
  assert.equal(excerptFromBody("x".repeat(400)), null);
});
