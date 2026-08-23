import { test } from "node:test";
import assert from "node:assert/strict";
import { fileNameFromStoragePath, existingFileNames } from "./existing-filenames.ts";

// REGRESSION TESTS for the React #441 on /admin/media/new.
//
// #441 decodes to "An error occurred in the Server Components render" — a
// server-side throw whose message production deliberately hides. The page did
// `row.storage_path.split("/")` on a value nothing guaranteed to be a string,
// and discarded the query error that would have explained it.
//
// Every shape below would have thrown a TypeError during render, taking the
// whole page down with a message nobody could read.

test("A NULL STORAGE PATH DOES NOT THROW", () => {
  assert.equal(fileNameFromStoragePath(null), "");
});

test("undefined, numbers and objects do not throw either", () => {
  // The types say `string`. The runtime says whatever PostgREST returned.
  for (const bad of [undefined, 42, {}, [], true, Symbol.iterator]) {
    assert.doesNotThrow(() => fileNameFromStoragePath(bad as unknown));
    assert.equal(fileNameFromStoragePath(bad as unknown), "");
  }
});

test("ONE BAD ROW CANNOT TAKE DOWN THE WHOLE PAGE", () => {
  // The actual failure mode: 112 good rows and one null, and the only route
  // for adding media stops loading.
  const rows = [
    { storage_path: "image/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee-canon-r5.jpg" },
    { storage_path: null },
    { storage_path: "image/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee-ps5.png" },
  ];
  assert.doesNotThrow(() => existingFileNames(rows));
  assert.deepEqual(existingFileNames(rows), ["canon-r5.jpg", "ps5.png"]);
});

test("a null or undefined row list yields an empty array", () => {
  assert.deepEqual(existingFileNames(null), []);
  assert.deepEqual(existingFileNames(undefined), []);
  assert.deepEqual(existingFileNames([]), []);
});

test("the uuid prefix is stripped to recover the original filename", () => {
  const path = "image/0f7a1b2c-3d4e-5f60-7182-93a4b5c6d7e8-canon-eos-r5-front.jpg";
  assert.equal(fileNameFromStoragePath(path), "canon-eos-r5-front.jpg");
});

test("a path with NO uuid prefix keeps its basename intact", () => {
  // Slicing 37 characters off a short legacy name would return a fragment or
  // nothing, and the duplicate warning would then compare against rubbish.
  assert.equal(fileNameFromStoragePath("image/logo.svg"), "logo.svg");
  assert.equal(fileNameFromStoragePath("logo.svg"), "logo.svg");
});

test("EMPTY NAMES ARE DROPPED, not returned", () => {
  // An empty string matches every future upload's duplicate check and would
  // warn on all of them — which is how a useful warning becomes noise.
  const rows = [{ storage_path: "" }, { storage_path: "image/" }, { storage_path: null }];
  assert.deepEqual(existingFileNames(rows), []);
});

test("a row that is itself null does not throw", () => {
  assert.doesNotThrow(() => existingFileNames([null as unknown as { storage_path: string }]));
  assert.deepEqual(existingFileNames([null as unknown as { storage_path: string }]), []);
});
