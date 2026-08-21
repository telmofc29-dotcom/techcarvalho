import { test } from "node:test";
import assert from "node:assert/strict";
import { buildMetadata, buildNotFoundMetadata } from "./metadata.ts";

test("buildMetadata: sets a page-specific canonical", () => {
  const result = buildMetadata({ title: "Widget", path: "/products/widget" });
  assert.ok(String(result.alternates?.canonical).endsWith("/products/widget"));
});

test("buildMetadata: noindex still keeps a canonical (used for e.g. /search)", () => {
  const result = buildMetadata({ title: "Search", path: "/search", noindex: true });
  assert.deepEqual(result.robots, { index: false, follow: false });
  assert.ok(result.alternates?.canonical);
});

test("buildNotFoundMetadata: noindex", () => {
  const result = buildNotFoundMetadata();
  assert.deepEqual(result.robots, { index: false, follow: false });
});

test("buildNotFoundMetadata: never emits a canonical — a 404 has nothing valid to canonicalize to", () => {
  const result = buildNotFoundMetadata();
  assert.equal(result.alternates, undefined);
});
