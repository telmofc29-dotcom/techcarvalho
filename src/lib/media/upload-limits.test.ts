// Regression tests for the upload size/type gate.
//
// THE PRODUCTION FAILURE THESE REPRODUCE
// --------------------------------------
// Production log, build cbd81f1, digest 4292037696@E394:
//
//   Error: Body exceeded 1 MB limit.
//   statusCode: 413
//
// Every real photograph exceeded Next's 1 MB Server Action body cap, and the
// resulting throw reached the admin as a masked React #441. Nothing on the
// client warned first, because nothing on the client knew a limit existed.
//
// It went undetected by automated tests for a specific and embarrassing reason:
// every upload fixture was a 1x1 PNG of 68 bytes. A test suite that only ever
// uploads something tiny cannot discover a size limit. These tests assert the
// behaviour at REAL sizes.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ACCEPTED_FORMATS_LABEL,
  MAX_UPLOAD_BYTES,
  checkUploadCandidate,
  formatBytes,
  isIssuedStoragePath,
  mediaTypeForMime,
  sanitizeFileName,
} from "./upload-limits.ts";

const MB = 1024 * 1024;
const jpg = (size: number) => ({ name: "photo.jpg", type: "image/jpeg", size });

// --- The sizes that used to fail ---------------------------------------------

test("a 2 MB photograph is accepted — it was not, under the 1 MB action cap", () => {
  const result = checkUploadCandidate(jpg(2 * MB));
  assert.equal(result.ok, true);
});

for (const mb of [0.5, 2, 5, 10, 19]) {
  test(`${mb} MB is within the limit`, () => {
    assert.equal(checkUploadCandidate(jpg(Math.round(mb * MB))).ok, true);
  });
}

test("the limit is 20 MB, above Vercel's 4.5 MB function body cap", () => {
  // The point of the direct-to-storage path. If this ever drops to 4.5 MB or
  // below, someone has quietly routed uploads back through a function.
  assert.equal(MAX_UPLOAD_BYTES, 20 * MB);
  assert.ok(MAX_UPLOAD_BYTES > 4.5 * MB);
});

// --- The boundary --------------------------------------------------------------

test("exactly at the limit is accepted", () => {
  assert.equal(checkUploadCandidate(jpg(MAX_UPLOAD_BYTES)).ok, true);
});

test("one byte over the limit is refused", () => {
  const result = checkUploadCandidate(jpg(MAX_UPLOAD_BYTES + 1));
  assert.equal(result.ok, false);
});

// --- The message the admin actually reads --------------------------------------

test("an oversized file names BOTH its size and the limit", () => {
  const result = checkUploadCandidate(jpg(Math.round(24.6 * MB)));
  assert.equal(result.ok, false);
  if (result.ok) return;
  // "This file is 24.6 MB. The current upload limit is 20 MB."
  assert.match(result.error, /This file is 24\.6 MB/);
  assert.match(result.error, /limit is 20\.0 MB/);
});

test("an unsupported type lists what IS accepted", () => {
  const result = checkUploadCandidate({ name: "notes.pdf", type: "application/pdf", size: 1000 });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.error, /Unsupported file type/);
  assert.match(result.error, /application\/pdf/);
  assert.ok(result.error.includes(ACCEPTED_FORMATS_LABEL));
});

test("an empty file is refused before anything is sent", () => {
  const result = checkUploadCandidate(jpg(0));
  assert.equal(result.ok, false);
});

// --- Type mapping ---------------------------------------------------------------

test("images and videos map to the right media_type", () => {
  assert.equal(mediaTypeForMime("image/jpeg"), "image");
  assert.equal(mediaTypeForMime("image/svg+xml"), "image");
  assert.equal(mediaTypeForMime("video/mp4"), "video");
  assert.equal(mediaTypeForMime("video/quicktime"), "video");
  assert.equal(mediaTypeForMime("application/zip"), null);
  assert.equal(mediaTypeForMime(""), null);
});

test("checkUploadCandidate reports the media type for accepted files", () => {
  const image = checkUploadCandidate(jpg(1000));
  assert.equal(image.ok && image.mediaType, "image");
  const video = checkUploadCandidate({ name: "clip.mp4", type: "video/mp4", size: 1000 });
  assert.equal(video.ok && video.mediaType, "video");
});

// --- formatBytes ------------------------------------------------------------------

test("formatBytes is readable at each scale", () => {
  assert.equal(formatBytes(512), "512 B");
  assert.equal(formatBytes(2048), "2 KB");
  assert.equal(formatBytes(5 * MB), "5.0 MB");
  assert.equal(formatBytes(Math.round(24.6 * MB)), "24.6 MB");
});

test("formatBytes never throws on nonsense", () => {
  assert.equal(formatBytes(Number.NaN), "unknown size");
  assert.equal(formatBytes(-1), "unknown size");
});

// --- Storage path authorisation ----------------------------------------------------
//
// finaliseMediaUpload accepts a path from the client, so the shape it will
// accept has to be exactly the shape the server issues. Anything else would let
// a finalise call point a new row at an object it did not upload.

test("a path this application issued is recognised", () => {
  assert.equal(isIssuedStoragePath("image/0f8fad5b-d9cb-469f-a165-70867728950e-photo.jpg"), true);
  assert.equal(isIssuedStoragePath("video/0f8fad5b-d9cb-469f-a165-70867728950e-clip.mp4"), true);
});

test("paths this application did not issue are refused", () => {
  for (const bad of [
    "image/photo.jpg",
    "other/0f8fad5b-d9cb-469f-a165-70867728950e-photo.jpg",
    "image/../0f8fad5b-d9cb-469f-a165-70867728950e-photo.jpg",
    "0f8fad5b-d9cb-469f-a165-70867728950e-photo.jpg",
    "image/0f8fad5b-d9cb-469f-a165-70867728950e-photo.jpg/../../secret",
    "",
  ]) {
    assert.equal(isIssuedStoragePath(bad), false, `should refuse: ${bad}`);
  }
});

test("sanitizeFileName strips every character that could shape a path", () => {
  assert.equal(sanitizeFileName("My Photo (1).JPG"), "my-photo-1-.jpg");

  // Dots survive, because they are part of a legitimate extension. That is
  // safe: traversal needs a SEPARATOR, and no input can produce one. The
  // resulting name is also re-checked by isIssuedStoragePath, which pins the
  // whole path to `<image|video>/<uuid>-<name>`.
  for (const hostile of ["../../etc/passwd", "a/b\\c", "..\\..\\windows", "x/../../y"]) {
    const cleaned = sanitizeFileName(hostile);
    assert.doesNotMatch(cleaned, /[/\\]/, `no separator may survive: ${hostile} -> ${cleaned}`);
    assert.equal(
      isIssuedStoragePath(`image/0f8fad5b-d9cb-469f-a165-70867728950e-${cleaned}`),
      true,
      "a sanitised name still yields a valid issued path"
    );
  }
});
