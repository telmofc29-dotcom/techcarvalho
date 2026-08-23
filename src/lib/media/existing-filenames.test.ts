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

// ---------------------------------------------------------------------------
// resolveExistingFileNames — the #441 resilience guarantee
// ---------------------------------------------------------------------------
//
// /admin/media/new was reported crashing in production with "Minified React
// error #441", which is React masking a Server Component throw. The route's
// only optional dependency is this filename lookup, and a throw anywhere inside
// it — not just a returned `error`, which was already handled — reaches React
// and takes the upload form off the page entirely.
//
// These assert the contract the page depends on: whatever happens in that
// lookup, it resolves, it never throws, the failure is reported rather than
// swallowed, and `names` is always a usable array so the client component's
// `existingFileNames.map(...)` cannot fault either.

import { resolveExistingFileNames } from "./existing-filenames.ts";

const noopLog = () => {};

test("resolveExistingFileNames returns names on success", async () => {
  const result = await resolveExistingFileNames(
    async () => ({ data: [{ storage_path: "image/123e4567-e89b-12d3-a456-426614174000-photo.png" }], error: null }),
    noopLog
  );
  assert.deepEqual(result, { names: ["photo.png"], failure: null });
});

test("A RETURNED QUERY ERROR degrades instead of throwing", async () => {
  const result = await resolveExistingFileNames(
    async () => ({ data: null, error: { message: "permission denied for table media_assets" } }),
    noopLog
  );
  assert.deepEqual(result.names, []);
  assert.equal(result.failure, "permission denied for table media_assets");
});

test("A THROWN ERROR degrades instead of producing React #441", async () => {
  // This is the case that was unhandled. createClient() reads cookies and
  // builds a Supabase client; it raises rather than returning { error }.
  const result = await resolveExistingFileNames(async () => {
    throw new Error("Invalid session cookie");
  }, noopLog);
  assert.deepEqual(result.names, []);
  assert.equal(result.failure, "Invalid session cookie");
});

test("a rejected promise degrades", async () => {
  const result = await resolveExistingFileNames(() => Promise.reject(new Error("fetch failed")), noopLog);
  assert.deepEqual(result.names, []);
  assert.equal(result.failure, "fetch failed");
});

test("a non-Error throw still yields a string reason", async () => {
  const result = await resolveExistingFileNames(async () => {
    throw "supabase exploded";
  }, noopLog);
  assert.deepEqual(result.names, []);
  assert.equal(result.failure, "supabase exploded");
});

test("EVERY failure is logged, never silently swallowed", async () => {
  const logged: string[] = [];
  await resolveExistingFileNames(
    async () => ({ data: null, error: { message: "boom" } }),
    (context) => logged.push(context)
  );
  await resolveExistingFileNames(async () => {
    throw new Error("bang");
  }, (context) => logged.push(context));
  assert.equal(logged.length, 2, "both the returned-error and thrown paths must log");
  assert.match(logged[1], /threw/, "the thrown path is distinguishable in the logs");
});

test("names is ALWAYS an array, so the client component can map over it", async () => {
  for (const fetchRows of [
    async () => ({ data: null, error: null }),
    async () => ({ data: null, error: { message: "x" } }),
    async () => {
      throw new Error("y");
    },
  ] as const) {
    const result = await resolveExistingFileNames(fetchRows, noopLog);
    assert.ok(Array.isArray(result.names));
    assert.doesNotThrow(() => result.names.map((n) => n.toLowerCase()));
  }
});

test("a malformed row inside a SUCCESSFUL response cannot throw", async () => {
  const result = await resolveExistingFileNames(
    async () => ({
      data: [{ storage_path: null }, { storage_path: 42 }, {}, { storage_path: "image/ok.png" }] as never,
      error: null,
    }),
    noopLog
  );
  assert.equal(result.failure, null);
  assert.deepEqual(result.names, ["ok.png"]);
});
