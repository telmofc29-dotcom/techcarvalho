import { test } from "node:test";
import assert from "node:assert/strict";
import { formatSpecValue } from "./spec-value.ts";

test("THE REAL DEFECT: a double-encoded string is unwrapped, not printed raw", () => {
  // Verbatim from production — 98 of 582 spec rows are stored like this, and
  // 22 product pages were publishing the quotes and backslashes to readers.
  assert.equal(formatSpecValue('"1/1.3\\", 13.5 stops dynamic range"'), '1/1.3", 13.5 stops dynamic range');
  assert.equal(formatSpecValue('"A19 Pro"'), "A19 Pro");
  assert.equal(formatSpecValue('"6.3\\""'), '6.3"');
  assert.equal(formatSpecValue('"Super Retina XDR OLED, ProMotion 120Hz"'), "Super Retina XDR OLED, ProMotion 120Hz");
});

test("an ordinary string is left completely alone", () => {
  assert.equal(formatSpecValue("45 MP full-frame CMOS"), "45 MP full-frame CMOS");
  assert.equal(formatSpecValue("256GB / 512GB / 1TB"), "256GB / 512GB / 1TB");
  assert.equal(formatSpecValue("RockSteady 3.0+ / HorizonSteady"), "RockSteady 3.0+ / HorizonSteady");
});

test("a numeric-looking string is NOT silently retyped", () => {
  // "256" parses as a NUMBER, not a string, so the unwrap must decline. Getting
  // this wrong would strip meaning from values that only look like numbers.
  assert.equal(formatSpecValue("256"), "256");
  assert.equal(formatSpecValue("2026"), "2026");
});

test("a value containing an inch mark survives", () => {
  // The genuine case that makes naive quote-stripping dangerous.
  assert.equal(formatSpecValue('1/1.9" CMOS, ~27MP'), '1/1.9" CMOS, ~27MP');
});

test("booleans read as words, not as true/false", () => {
  assert.equal(formatSpecValue(true), "Yes");
  assert.equal(formatSpecValue(false), "No");
});

test("absent values yield null so the caller can say so honestly", () => {
  assert.equal(formatSpecValue(null), null);
  assert.equal(formatSpecValue(undefined), null);
  assert.equal(formatSpecValue(""), null);
  assert.equal(formatSpecValue("   "), null);
  assert.equal(formatSpecValue('""'), null, "an encoded empty string is still empty");
});

test("an object never reaches a reader as [object Object]", () => {
  assert.equal(formatSpecValue({ a: 1 }), null);
  assert.equal(formatSpecValue({}), null);
});

test("NaN and Infinity are not rendered", () => {
  assert.equal(formatSpecValue(Number.NaN), null);
  assert.equal(formatSpecValue(Number.POSITIVE_INFINITY), null);
});

test("arrays are joined, and each element is unwrapped", () => {
  assert.equal(formatSpecValue(["USB-C", "HDMI"]), "USB-C, HDMI");
  assert.equal(formatSpecValue(['"USB-C"', '"HDMI 2.1"']), "USB-C, HDMI 2.1");
  assert.equal(formatSpecValue([]), null);
  assert.equal(formatSpecValue([null, ""]), null);
});

test("a unit is appended once, and never twice", () => {
  assert.equal(formatSpecValue(45, "MP"), "45 MP");
  // The catalogue stores values that already carry their unit; appending the
  // definition's unit would give "20m without case m".
  assert.equal(formatSpecValue("20m without case, 60m with case", "m"), "20m without case, 60m with case");
  assert.equal(formatSpecValue("45 MP", "MP"), "45 MP");
});

test("the unit is applied to a list as a whole, not to every item", () => {
  assert.equal(formatSpecValue([1, 2], "GB"), "1, 2 GB");
});

test("unwrapping is bounded and cannot loop", () => {
  // Triple-encoded is absurd but must terminate rather than spin.
  const triple = JSON.stringify(JSON.stringify(JSON.stringify("x")));
  assert.equal(formatSpecValue(triple), "x");
});
