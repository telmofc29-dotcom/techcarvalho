import { test } from "node:test";
import assert from "node:assert/strict";
import { metaValue, unwrapMetaValue, exifRightsConflict } from "./wikimedia-commons.ts";

// REGRESSION: the EXIF rights cross-check was blind to lang-structured values.
//
// Verified against the live Commons API on 2026-08-22. For File:Canon EOS 5D.jpg
// the API returns the SAME field twice, in two different shapes:
//
//   commonmetadata.Copyright = [{"name":"x-default","value":"©2008 Charles Lanteigne"},
//                               {"name":"_type","value":"lang"}]
//   metadata.Copyright       = "©2008 Charles Lanteigne\n\n"
//
// resolve() concatenates commonmetadata first, and metaValue() did
// `String(hit.value).trim()` on the first match — producing the literal string
// "[object Object],[object Object]". That was handed to exifRightsConflict(),
// which therefore could not fire on any lang-typed EXIF Copyright, and was
// stored verbatim as primary provenance evidence.
//
// It failed OPEN: a rights reservation written into the file's own metadata was
// invisible, and the asset came out looking fully evidenced. File:Canon EOS 5D.jpg
// is the file this project cites as the reason the check exists.

const LANG_STRUCTURED = [
  { name: "x-default", value: "©2008 Charles Lanteigne" },
  { name: "_type", value: "lang" },
];

test("the exact live shape that produced [object Object] now reads correctly", () => {
  assert.equal(unwrapMetaValue(LANG_STRUCTURED), "©2008 Charles Lanteigne");
  assert.notEqual(unwrapMetaValue(LANG_STRUCTURED), "[object Object],[object Object]");
});

test("a rights RESERVATION is caught in lang-structured form, not just flat form", () => {
  // The two forms must reach the same verdict. Before the fix, the flat form was
  // refused and the identical text in structured form was accepted.
  const reservation = "©2026 Someone. All rights reserved.";
  const flat = [{ name: "Copyright", value: reservation }];
  const structured = [
    { name: "Copyright", value: [{ name: "x-default", value: reservation }, { name: "_type", value: "lang" }] },
  ];

  const flatVerdict = exifRightsConflict(metaValue(flat, "Copyright"));
  const structuredVerdict = exifRightsConflict(metaValue(structured, "Copyright"));

  assert.ok(flatVerdict, "the flat form must be refused");
  assert.ok(structuredVerdict, "the SAME text structured must also be refused");
  assert.equal(structuredVerdict, flatVerdict, "the shape of the value must not change the verdict");
});

test("a bare authorship line still does NOT conflict, in either shape", () => {
  // CC does not waive copyright, so naming the photographer is what a correctly
  // licensed file looks like. The fix must not make the check trigger-happy.
  const author = "Francois Leblond";
  assert.equal(exifRightsConflict(metaValue([{ name: "Copyright", value: author }], "Copyright")), null);
  assert.equal(
    exifRightsConflict(
      metaValue([{ name: "Copyright", value: [{ name: "x-default", value: author }, { name: "_type", value: "lang" }] }], "Copyright")
    ),
    null
  );
});

test("both buckets are searched, so ordering cannot decide readability", () => {
  // resolve() concatenates commonmetadata ahead of metadata. If the first entry
  // is unreadable, the flat duplicate that follows must still be found — the
  // fix must not depend on which bucket happens to come first.
  const both = [
    { name: "Copyright", value: [{ name: "_type", value: "lang" }] },
    { name: "Copyright", value: "©2008 Charles Lanteigne" },
  ];
  assert.equal(metaValue(both, "Copyright"), "©2008 Charles Lanteigne");
});

test("an uninterpretable value is null — 'unreadable', not a garbage string", () => {
  // A stringified object matches no pattern, so it reads as "this field says
  // nothing" rather than "this field could not be read". null is honest.
  assert.equal(unwrapMetaValue({ nested: { deeper: true } }), null);
  assert.equal(unwrapMetaValue([]), null);
  assert.equal(unwrapMetaValue([{ name: "_type", value: "lang" }]), null);
  assert.equal(unwrapMetaValue(""), null);
});

test("'en' is used when x-default is absent", () => {
  assert.equal(
    unwrapMetaValue([{ name: "en", value: "All rights reserved" }, { name: "_type", value: "lang" }]),
    "All rights reserved"
  );
});
