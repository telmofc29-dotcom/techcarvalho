import { test } from "node:test";
import assert from "node:assert/strict";
import { parseBodyBlocks } from "./body-format.ts";

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
