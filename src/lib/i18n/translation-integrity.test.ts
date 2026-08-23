import { test } from "node:test";
import assert from "node:assert/strict";
import { extractProtectedTokens, checkTranslationIntegrity } from "./translation-integrity.ts";

const has = (text: string, token: string) =>
  extractProtectedTokens(text).some((t) => t.token.toLowerCase() === token.toLowerCase());

test("IEEE amendment designations are protected whole, not split into numbers", () => {
  const tokens = extractProtectedTokens("IEEE published 802.11be in 2025.");
  assert.ok(tokens.some((t) => t.token === "802.11be" && t.kind === "ieee_standard"));
  // "802" must not also appear as a bare figure — that would make the report
  // noisy and would let a real missing figure hide among the duplicates.
  assert.ok(!tokens.some((t) => t.token === "802"));
});

test("A DECIMAL COMMA IS A DIFFERENT FACT", () => {
  // The specific error this module exists for: a translator working into a
  // comma-decimal language renders 802.11be as 802,11be. Nothing errors.
  const r = checkTranslationIntegrity(
    "The 802.11be amendment was published.",
    "A emenda 802,11be foi publicada."
  );
  assert.equal(r.clean, false);
  assert.ok(r.missing.some((t) => t.token === "802.11be"));
});

test("Wi-Fi generation names survive, including the 6E form", () => {
  assert.ok(has("Wi-Fi 6E extends Wi-Fi 6 to 6 GHz.", "Wi-Fi 6E"));
  const r = checkTranslationIntegrity(
    "Wi-Fi 6E is not a new generation.",
    "O Wi-Fi 6 E nao e uma nova geracao." // spaced, therefore a different token
  );
  assert.equal(r.clean, false);
});

test("measurements keep their unit", () => {
  assert.ok(has("channels of 160 MHz", "160 MHz"));
  assert.ok(has("at least 100 Mb/s", "100 Mb/s"));
  assert.ok(has("30 Gbit/s throughput", "30 Gbit/s"));
});

test("a dropped frequency is caught", () => {
  const r = checkTranslationIntegrity(
    "The range runs from 5925 to 7125 MHz.",
    "A gama vai de 5925 MHz para cima." // 7125 silently lost
  );
  assert.equal(r.clean, false);
  assert.ok(r.missing.some((t) => t.token.includes("7125")));
});

test("model tokens mixing letters and digits are protected", () => {
  assert.ok(has("the Canon EOS R5 body", "R5"));
  assert.ok(has("a Canon EOS 60D", "60D"));
  assert.ok(has("an RTX5090", "RTX5090"));
  // A plain word is not a model token.
  assert.ok(!has("the camera body", "camera"));
});

test("organisations are protected as proper nouns", () => {
  const tokens = extractProtectedTokens("Wi-Fi Alliance and IEEE and Ofcom agree.");
  const names = tokens.filter((t) => t.kind === "organisation").map((t) => t.token);
  assert.ok(names.includes("Wi-Fi Alliance"));
  assert.ok(names.includes("IEEE"));
  assert.ok(names.includes("Ofcom"));
});

test("case and spacing differences are NOT failures", () => {
  // Languages capitalise differently; that is translation, not corruption.
  const r = checkTranslationIntegrity(
    "Wi-Fi Alliance certified it at 320 MHz.",
    "A wi-fi alliance certificou-o a 320 MHz."
  );
  assert.equal(r.clean, true, r.missing.map((m) => m.token).join(", "));
});

test("a faithful translation reports clean", () => {
  const r = checkTranslationIntegrity(
    "IEEE lists 802.11ax as published on 19 May 2021, with 160 MHz channels and WPA3.",
    "O IEEE indica a publicacao da 802.11ax a 19 de maio de 2021, com canais de 160 MHz e WPA3."
  );
  assert.equal(r.clean, true, `missing: ${r.missing.map((m) => m.token).join(", ")}`);
  assert.ok(r.sourceTokens > 0, "a source with no protected tokens would make this vacuous");
});

test("the report says how many tokens it checked, so a vacuous pass is visible", () => {
  // An empty source would otherwise report clean:true and mean nothing.
  const r = checkTranslationIntegrity("", "");
  assert.equal(r.sourceTokens, 0);
  assert.equal(r.clean, true, "technically clean — and the token count is what reveals it is empty");
});

test("only MISSING tokens are reported, never additions", () => {
  const r = checkTranslationIntegrity(
    "Wi-Fi 7 arrived.",
    "O Wi-Fi 7 chegou, certificado a 8 de janeiro de 2024."
  );
  assert.equal(r.clean, true, "an added date is legitimate expansion, not an error");
});

test("LOCALE NUMBER FORMATTING IS NOT CORRUPTION", () => {
  // Found by using this on a real Portuguese translation: Portuguese writes
  // 1200 where English writes "1,200", and 9,6 where English writes "9.6".
  // Both are correct localisation of a QUANTITY.
  const r = checkTranslationIntegrity(
    "The FCC opened 1,200 megahertz, and Wi-Fi 6 peaks near 9.6 Gbps.",
    "A FCC abriu 1200 megahertz, e o Wi-Fi 6 chega perto de 9,6 Gbps."
  );
  assert.equal(r.clean, true, `missing: ${r.missing.map((m) => m.token).join(", ")}`);
});

test("...but a DESIGNATION may never be reformatted, even in the same document", () => {
  // The other half of the same rule. A quantity may localise; an identifier
  // may not. Getting this backwards in either direction defeats the checker.
  const r = checkTranslationIntegrity(
    "802.11be at 1,200 MHz.",
    "802,11be a 1200 MHz."
  );
  assert.equal(r.clean, false);
  assert.ok(r.missing.some((t) => t.token === "802.11be"));
  assert.ok(!r.missing.some((t) => t.token.includes("1,200")), "the quantity was fine");
});

test("a hyphen and a space are the same word separator in a designation", () => {
  // The English source of the first translated article uses BOTH "1024-QAM"
  // and "1024 QAM". A translation that picks one form has not changed a fact.
  const r = checkTranslationIntegrity(
    "4K QAM beats 1024 QAM, and 1024-QAM beat 256-QAM.",
    "O 4K QAM supera o 1024-QAM, e o 1024-QAM superou o 256-QAM."
  );
  assert.equal(r.clean, true, `missing: ${r.missing.map((m) => m.token).join(", ")}`);
});
