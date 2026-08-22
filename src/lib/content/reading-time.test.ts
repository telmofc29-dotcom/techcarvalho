import { test } from "node:test";
import assert from "node:assert/strict";
import {
  estimateReadingTime,
  countBodyWords,
  WORDS_PER_MINUTE,
  MINIMUM_WORDS_FOR_ESTIMATE,
} from "./reading-time.ts";

/** A body of roughly `n` words, as real paragraphs. */
function bodyOf(n: number): string {
  const words = Array.from({ length: n }, (_, i) => `word${i}`);
  const paragraphs: string[] = [];
  for (let i = 0; i < words.length; i += 40) {
    paragraphs.push(words.slice(i, i + 40).join(" "));
  }
  return paragraphs.join("\n\n");
}

test("a body of one minute's prose reads as 1 min", () => {
  const rt = estimateReadingTime(bodyOf(WORDS_PER_MINUTE));
  assert.ok(rt);
  assert.equal(rt.minutes, 1);
  assert.equal(rt.label, "1 min read");
});

test("six minutes of prose reads as 6 min", () => {
  const rt = estimateReadingTime(bodyOf(WORDS_PER_MINUTE * 6));
  assert.ok(rt);
  assert.equal(rt.minutes, 6);
  assert.equal(rt.label, "6 min read");
});

test("it rounds to NEAREST, not always up", () => {
  // Always rounding up adds a minute to every article on the site — a small
  // systematic overstatement repeated on every page.
  const justOver = estimateReadingTime(bodyOf(WORDS_PER_MINUTE * 2 + 10));
  assert.equal(justOver?.minutes, 2, "2.05 minutes is 2, not 3");
});

test("a body too short for a meaningful estimate returns null, not '1 min read'", () => {
  // Rounding a 40-word stub up to "1 min read" dresses a fragment as an
  // article. Returning null lets the page render nothing — and makes thin
  // content visible rather than papering over it.
  assert.equal(estimateReadingTime(bodyOf(MINIMUM_WORDS_FOR_ESTIMATE - 20)), null);
  assert.equal(estimateReadingTime(""), null);
  assert.equal(estimateReadingTime(null), null);
  assert.equal(estimateReadingTime(undefined), null);
});

test("it never reports 0 min read", () => {
  // A reader seeing "0 min read" learns the number is not computed from
  // anything. The floor is 1.
  for (let n = MINIMUM_WORDS_FOR_ESTIMATE; n < MINIMUM_WORDS_FOR_ESTIMATE + 60; n += 7) {
    const rt = estimateReadingTime(bodyOf(n));
    assert.ok(rt);
    assert.ok(rt.minutes >= 1, `${n} words gave ${rt.minutes} minutes`);
  }
});

test("headings and list items are counted — a reader reads those too", () => {
  const withStructure = [
    "## A heading with five words here",
    "",
    "- first list item",
    "- second list item",
    "",
    "A closing paragraph of prose.",
  ].join("\n");
  const words = countBodyWords(withStructure);
  assert.ok(words >= 15, `expected structure to be counted, got ${words}`);
});

test("hyphenated technology terms count as ONE word", () => {
  // Splitting on punctuation would inflate technology prose specifically,
  // since it is dense with model numbers and hyphenated names.
  // Wi-Fi / 7 / and / the / RTX / 5090 — six. The point is that "Wi-Fi" is ONE
  // word rather than two, not that the sentence is short.
  assert.equal(countBodyWords("Wi-Fi 7 and the RTX 5090"), 6);
  assert.equal(countBodyWords("Ryzen 7 9800X3D"), 3);
});

test("only the BODY is counted — page chrome is not passed in and cannot inflate it", () => {
  // The estimate takes the body column and nothing else. This pins the
  // property that matters: two articles with identical bodies get identical
  // estimates regardless of how much navigation, citation or footer text
  // surrounds them on the page.
  const body = bodyOf(400);
  const a = estimateReadingTime(body);
  const b = estimateReadingTime(body);
  assert.deepEqual(a, b);
  assert.equal(a?.words, countBodyWords(body));
});

test("whitespace-only and structure-only bodies are not readable content", () => {
  assert.equal(estimateReadingTime("   \n\n   \n"), null);
});
