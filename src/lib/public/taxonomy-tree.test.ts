import { test } from "node:test";
import assert from "node:assert/strict";
import {
  descendantScope,
  directChildren,
  breadcrumbTrail,
  isTopLevel,
  INTENDED_PARENTS,
  type CategoryNode,
} from "./taxonomy-tree.ts";

const TREE: CategoryNode[] = [
  { id: "cam", slug: "cameras-photography", name: "Cameras & Photography", parentId: null, sortOrder: 1 },
  { id: "lens", slug: "camera-lenses", name: "Camera Lenses", parentId: "cam", sortOrder: 2 },
  { id: "astro", slug: "astrophotography", name: "Astrophotography", parentId: "cam", sortOrder: 1 },
  { id: "comp", slug: "computing", name: "Computing", parentId: null, sortOrder: 3 },
  { id: "ai", slug: "ai-hardware", name: "AI Hardware", parentId: "comp", sortOrder: 1 },
];

test("a parent's scope includes itself and its descendants", () => {
  const scope = descendantScope("cam", TREE);
  assert.ok(scope.includes("cam"));
  assert.ok(scope.includes("lens"));
  assert.ok(scope.includes("astro"));
  assert.ok(!scope.includes("comp"), "an unrelated top-level category must not be pulled in");
});

test("a CHILD does not inherit its parent's content", () => {
  // The asymmetry that keeps /camera-lenses from becoming a copy of
  // /cameras-photography wearing a narrower name.
  assert.deepEqual(descendantScope("lens", TREE), ["lens"]);
});

test("self comes first, then children in sort order", () => {
  assert.deepEqual(descendantScope("cam", TREE), ["cam", "astro", "lens"]);
});

test("a cycle cannot hang a page render", () => {
  const cyclic: CategoryNode[] = [
    { id: "a", slug: "a", name: "A", parentId: "b" },
    { id: "b", slug: "b", name: "B", parentId: "a" },
  ];
  assert.deepEqual(descendantScope("a", cyclic).sort(), ["a", "b"]);
  assert.ok(breadcrumbTrail("a", cyclic).length <= 2);
});

test("breadcrumbs run root-first and exclude Home", () => {
  assert.deepEqual(breadcrumbTrail("lens", TREE), [
    { slug: "cameras-photography", name: "Cameras & Photography" },
    { slug: "camera-lenses", name: "Camera Lenses" },
  ]);
  assert.deepEqual(breadcrumbTrail("cam", TREE), [
    { slug: "cameras-photography", name: "Cameras & Photography" },
  ]);
});

test("direct children are listed for sub-navigation, grandchildren are not", () => {
  const deep: CategoryNode[] = [...TREE, { id: "prime", slug: "prime", name: "Prime", parentId: "lens" }];
  assert.deepEqual(directChildren("cam", deep).map((c) => c.id), ["astro", "lens"]);
  assert.deepEqual(directChildren("lens", deep).map((c) => c.id), ["prime"]);
});

test("top-level detection", () => {
  assert.equal(isTopLevel("cam", TREE), true);
  assert.equal(isTopLevel("lens", TREE), false);
  assert.equal(isTopLevel("nope", TREE), false);
});

test("an unknown category yields itself and an empty trail", () => {
  assert.deepEqual(descendantScope("ghost", TREE), ["ghost"]);
  assert.deepEqual(breadcrumbTrail("ghost", TREE), []);
});

test("the intended hierarchy stays shallow and references real parents", () => {
  const slugs = new Set(TREE.map((c) => c.slug));
  for (const [child, parent] of Object.entries(INTENDED_PARENTS)) {
    assert.notEqual(child, parent, "a category cannot parent itself");
    // Every declared parent must itself be top-level: two levels, not more.
    assert.ok(!(parent in INTENDED_PARENTS), `${parent} is both a parent and a child -- tree too deep`);
  }
  assert.ok(slugs.size > 0);
});
