import { test } from "node:test";
import assert from "node:assert/strict";
import { isSyntheticPath, isSyntheticHost, TEST_PATH_PREFIX } from "./path-filter.ts";

// Verbatim paths that actually reached production analytics. `/_rls-verify-test`
// alone was 61 page views — the most-viewed page on the site. The last two
// survived the manual SQL cleanup because its patterns did not anticipate them,
// which is the whole argument for filtering at write time.
const REAL_SYNTHETIC = [
  "/_rls-verify-test",
  "/verify-finaljourney-home-1787315742598",
  "/verify-finaljourney-product-1787315745279",
  "/verify-finalratelimit-1787315748123",
  "/retest-no-select",
  "/repro-full-shape",
];

test("every synthetic path that reached production is now excluded", () => {
  for (const p of REAL_SYNTHETIC) {
    assert.equal(isSyntheticPath(p), true, `WOULD STILL RECORD: ${p}`);
  }
});

test("the reserved test prefix is excluded in every form", () => {
  for (const p of [TEST_PATH_PREFIX, "/__test/home", "/__test-rate-limit", "/__test/products/x"]) {
    assert.equal(isSyntheticPath(p), true, p);
  }
});

test("real public routes are always recorded", () => {
  const real = [
    "/",
    "/articles",
    "/articles/gta-6-release-date-status",
    "/articles/wifi-connected-but-no-internet",
    "/products",
    "/products/canon-eos-r5",
    "/manufacturers/canon",
    "/search",
    "/computing",
    "/cameras-photography",
    "/smart-home-robots",
    "/privacy",
    "/editorial-policy",
  ];
  for (const p of real) {
    assert.equal(isSyntheticPath(p), false, `WRONGLY DROPPED: ${p}`);
  }
});

test("a trailing epoch timestamp marks a path as synthetic", () => {
  assert.equal(isSyntheticPath("/anything-1787315742598"), true);
  // A real slug that merely contains digits must survive.
  assert.equal(isSyntheticPath("/articles/rtx-5090-vs-rtx-5080-worth-the-upgrade"), false);
  assert.equal(isSyntheticPath("/articles/wifi-generations-explained-wifi-4-to-wifi-7"), false);
  // A 4-digit year is not a 13-digit epoch.
  assert.equal(isSyntheticPath("/articles/best-gpus-2026"), false);
});

test("legacy markers are matched in nested segments too", () => {
  assert.equal(isSyntheticPath("/articles/verify-something"), true);
  assert.equal(isSyntheticPath("/products/e2e-fixture"), true);
});

test("a legitimate slug merely containing a marker word is not dropped", () => {
  // "verify" as a whole word inside a real slug, not the "verify-" test prefix.
  assert.equal(isSyntheticPath("/articles/how-to-verify-your-gpu-drivers"), false);
  assert.equal(isSyntheticPath("/articles/two-factor-verification-explained"), false);
});

test("empty and missing paths are not treated as synthetic", () => {
  // These are rejected earlier as invalid payloads; this filter must not be
  // the thing that decides they are test traffic.
  for (const p of [null, undefined, "", "   "]) {
    assert.equal(isSyntheticPath(p), false, String(p));
  }
});

test("local and preview hosts are excluded", () => {
  for (const h of ["localhost:3000", "127.0.0.1:3000", "techcarvalho-git-main.vercel.app", "mymac.local"]) {
    assert.equal(isSyntheticHost(h), true, h);
  }
});

test("the production host is always recorded", () => {
  for (const h of ["www.techcarvalho.com", "techcarvalho.com", "WWW.TECHCARVALHO.COM"]) {
    assert.equal(isSyntheticHost(h), false, h);
  }
});
