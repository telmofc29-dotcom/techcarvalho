import { test } from "node:test";
import assert from "node:assert/strict";
import { absoluteUrl, SITE_URL } from "./site.ts";

test("joins a leading-slash path onto SITE_URL", () => {
  assert.equal(absoluteUrl("/products/foo"), `${SITE_URL}/products/foo`);
});

test("adds a missing leading slash", () => {
  assert.equal(absoluteUrl("products/foo"), `${SITE_URL}/products/foo`);
});

test("root path", () => {
  assert.equal(absoluteUrl("/"), `${SITE_URL}/`);
});
