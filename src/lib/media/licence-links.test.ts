import { test } from "node:test";
import assert from "node:assert/strict";
import { licenceUrl, requiresAttribution, sourceLabel } from "./licence-links.ts";

// The licence strings recorded on the twelve Commons-sourced product photos
// actually live on the site.
const REAL = [
  ["CC BY-SA 3.0", "https://creativecommons.org/licenses/by-sa/3.0/"],
  ["CC BY-SA 4.0", "https://creativecommons.org/licenses/by-sa/4.0/"],
  ["CC BY 2.0", "https://creativecommons.org/licenses/by/2.0/"],
  ["CC0", "https://creativecommons.org/publicdomain/zero/1.0/"],
  ["Public domain", "https://creativecommons.org/publicdomain/mark/1.0/"],
] as const;

test("every licence string in production maps to its deed", () => {
  for (const [license, url] of REAL) {
    assert.equal(licenceUrl(license), url, license);
  }
});

test("BY-SA and BY are never confused — they are different obligations", () => {
  assert.equal(licenceUrl("CC BY 4.0"), "https://creativecommons.org/licenses/by/4.0/");
  assert.equal(licenceUrl("CC BY-SA 4.0"), "https://creativecommons.org/licenses/by-sa/4.0/");
  assert.notEqual(licenceUrl("CC BY 3.0"), licenceUrl("CC BY-SA 3.0"));
});

test("version numbers are not collapsed", () => {
  assert.notEqual(licenceUrl("CC BY-SA 2.0"), licenceUrl("CC BY-SA 2.5"));
  assert.notEqual(licenceUrl("CC BY-SA 3.0"), licenceUrl("CC BY-SA 4.0"));
});

test("an unrecognised licence returns null rather than a guess", () => {
  // Linking an unknown licence to a guessed deed would misstate the terms the
  // image is actually used under — worse than showing the name alone.
  for (const l of ["All rights reserved", "GFDL", "Fair use", "Editorial use only", "", null, undefined]) {
    assert.equal(licenceUrl(l), null, String(l));
  }
});

test("whitespace and separator variations still resolve", () => {
  assert.equal(licenceUrl("  CC BY-SA 4.0  "), "https://creativecommons.org/licenses/by-sa/4.0/");
  assert.equal(licenceUrl("cc by sa 4.0"), "https://creativecommons.org/licenses/by-sa/4.0/");
});

test("CC0 and public domain require no attribution; CC BY does", () => {
  assert.equal(requiresAttribution("CC0"), false);
  assert.equal(requiresAttribution("Public domain"), false);
  assert.equal(requiresAttribution("CC BY 2.0"), true);
  assert.equal(requiresAttribution("CC BY-SA 4.0"), true);
});

test("the source is named, not shown as a bare URL", () => {
  assert.equal(sourceLabel("https://commons.wikimedia.org/wiki/File:Canon_EOS_7D.jpg"), "Wikimedia Commons");
  assert.equal(sourceLabel("https://en.wikipedia.org/wiki/Canon_EOS_7D"), "Wikipedia");
  assert.equal(sourceLabel("https://example.com/photo"), "example.com");
});

test("a missing or malformed source URL yields no label", () => {
  for (const u of [null, undefined, "", "not a url"]) {
    assert.equal(sourceLabel(u), null, String(u));
  }
});
