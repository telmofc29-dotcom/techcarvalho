import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LOCALES, SOURCE_LOCALE, ROOT_LOCALE, isLocale, localePath, splitLocalePath,
  preferredLocale, hreflangMap, LOCALE_TAGS,
} from "./locales.ts";

test("English keeps the bare path — no existing URL moves", () => {
  // The whole URL strategy in one assertion. Moving English to /en/ would cost
  // a site-wide redirect layer for symmetry a crawler does not care about.
  assert.equal(localePath("en", "/articles/wi-fi-7-explained"), "/articles/wi-fi-7-explained");
  assert.equal(localePath("en", "/"), "/");
  assert.equal(ROOT_LOCALE, "en");
  assert.equal(SOURCE_LOCALE, "en");
});

test("other locales take a prefix", () => {
  assert.equal(localePath("pt", "/articles/foo"), "/pt/articles/foo");
  assert.equal(localePath("es", "/"), "/es");
  assert.equal(localePath("fr", "products"), "/fr/products");
});

test("splitting is the exact inverse, including for unprefixed English", () => {
  for (const locale of LOCALES) {
    for (const path of ["/", "/articles", "/articles/some-slug", "/products/x"]) {
      const built = localePath(locale, path);
      const split = splitLocalePath(built);
      assert.equal(split.locale, locale, `${locale} ${path} -> ${built}`);
      assert.equal(split.rest, path === "/" ? "/" : path, `${locale} ${path} -> ${built}`);
    }
  }
});

test("an unprefixed path is English, not an error", () => {
  // Every existing URL on the site looks like this.
  assert.deepEqual(splitLocalePath("/articles/foo"), { locale: "en", rest: "/articles/foo" });
});

test("a path whose first segment merely looks like a locale is not mangled", () => {
  // 'estimates' starts with 'es'. Segment matching must be exact.
  assert.deepEqual(splitLocalePath("/estimates/foo"), { locale: "en", rest: "/estimates/foo" });
  assert.equal(isLocale("estimates"), false);
});

test("Accept-Language is a SUGGESTION and resolves regional variants", () => {
  assert.equal(preferredLocale("pt-BR,pt;q=0.9,en;q=0.8"), "pt");
  assert.equal(preferredLocale("fr-CA"), "fr");
  assert.equal(preferredLocale("en-GB,en;q=0.9"), "en");
});

test("quality ordering is respected, not header order", () => {
  assert.equal(preferredLocale("de;q=0.9,es;q=1.0"), "es");
});

test("no confident match returns null — leave the visitor where they are", () => {
  assert.equal(preferredLocale(null), null);
  assert.equal(preferredLocale(""), null);
  assert.equal(preferredLocale("de,ja;q=0.8"), null);
  assert.equal(preferredLocale("en;q=0"), null, "q=0 means explicitly unacceptable");
});

test("hreflang lists ONLY locales that genuinely have the page", () => {
  // A cluster naming a translation that does not exist is worse than no
  // cluster: Google ignores non-reciprocal clusters wholesale, and a reader
  // following the link gets a 404. This is the multilingual version of
  // fabricating a source.
  const map = hreflangMap("/articles/foo", ["en", "pt"]);
  assert.deepEqual(map, {
    en: "/articles/foo",
    pt: "/pt/articles/foo",
    "x-default": "/articles/foo",
  });
  assert.equal("es" in map, false);
  assert.equal("fr" in map, false);
});

test("no available locales yields no hreflang at all", () => {
  assert.deepEqual(hreflangMap("/x", []), {});
});

test("x-default appears only when the root locale is actually available", () => {
  const map = hreflangMap("/articles/foo", ["pt", "fr"]);
  assert.equal("x-default" in map, false);
  assert.equal(map[LOCALE_TAGS.pt], "/pt/articles/foo");
});

test("locale tags are unregioned — the site makes no claim about variety", () => {
  // 'pt-PT' vs 'pt-BR' would assert which Portuguese this is written in.
  for (const l of LOCALES) assert.equal(LOCALE_TAGS[l].includes("-"), false);
});
