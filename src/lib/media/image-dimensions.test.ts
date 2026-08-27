import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readImageDimensions, isPlausible } from "./image-dimensions.ts";

// Byte-level fixtures, built by hand. Each is the smallest header that a real
// file of that format would carry, so a passing test means the parser reads the
// actual specified layout rather than something that happens to work.

const png = (w: number, h: number): Uint8Array => {
  const b = new Uint8Array(24);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  b.set([0x49, 0x48, 0x44, 0x52], 12); // "IHDR"
  new DataView(b.buffer).setUint32(16, w);
  new DataView(b.buffer).setUint32(20, h);
  return b;
};

const jpeg = (w: number, h: number, { withExif = false } = {}): Uint8Array => {
  const parts: number[] = [0xff, 0xd8];
  if (withExif) {
    // A large APP1 the parser must skip over to reach the frame header.
    const len = 400;
    parts.push(0xff, 0xe1, (len >> 8) & 0xff, len & 0xff);
    for (let i = 0; i < len - 2; i++) parts.push(0x00);
  }
  parts.push(0xff, 0xc0, 0x00, 0x11, 0x08, (h >> 8) & 0xff, h & 0xff, (w >> 8) & 0xff, w & 0xff);
  for (let i = 0; i < 8; i++) parts.push(0x00);
  return new Uint8Array(parts);
};

const gif = (w: number, h: number): Uint8Array => {
  const b = new Uint8Array(10);
  b.set([0x47, 0x49, 0x46, 0x38, 0x39, 0x61], 0); // "GIF89a"
  b[6] = w & 0xff; b[7] = (w >> 8) & 0xff;
  b[8] = h & 0xff; b[9] = (h >> 8) & 0xff;
  return b;
};

describe("it reads the real bytes", () => {
  test("PNG", () => {
    assert.deepEqual(readImageDimensions(png(1920, 1080)), { width: 1920, height: 1080, format: "png" });
  });

  test("JPEG", () => {
    assert.deepEqual(readImageDimensions(jpeg(1280, 853)), { width: 1280, height: 853, format: "jpeg" });
  });

  test("JPEG with a large EXIF block before the frame header", () => {
    // The realistic case: a camera JPEG whose SOF sits well past the start.
    assert.deepEqual(readImageDimensions(jpeg(4000, 3000, { withExif: true })), {
      width: 4000, height: 3000, format: "jpeg",
    });
  });

  test("GIF", () => {
    assert.deepEqual(readImageDimensions(gif(300, 200)), { width: 300, height: 200, format: "gif" });
  });
});

describe("it fails to null rather than guessing", () => {
  test("an unrecognised file yields null", () => {
    assert.equal(readImageDimensions(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])), null);
  });

  test("an empty buffer yields null", () => {
    assert.equal(readImageDimensions(new Uint8Array(0)), null);
  });

  test("a truncated PNG yields null, not a partial read", () => {
    assert.equal(readImageDimensions(png(1920, 1080).subarray(0, 15)), null);
  });

  test("a JPEG that reaches its scan without a frame header yields null", () => {
    assert.equal(readImageDimensions(new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0x00, 0x02, 0, 0, 0, 0])), null);
  });
});

describe("implausible measurements are refused", () => {
  // A wrong number is worse than a null, because it silences the audit that
  // flagged the gap in the first place.
  test("zero is not plausible", () => {
    assert.equal(isPlausible({ width: 0, height: 100, format: "png" }), false);
  });

  test("absurdly large is not plausible", () => {
    assert.equal(isPlausible({ width: 999999, height: 100, format: "png" }), false);
  });

  test("null is not plausible", () => {
    assert.equal(isPlausible(null), false);
  });

  test("an ordinary photograph is plausible", () => {
    assert.equal(isPlausible({ width: 1280, height: 853, format: "jpeg" }), true);
  });
});

test("a filename is never used as a measurement", () => {
  // Both unmeasured production assets are named "1280px-...". The filename is a
  // claim somebody typed; only the bytes are evidence.
  const notReallyAnImage = new Uint8Array(Buffer.from("1280px-milky-way.jpg contents that are not an image"));
  assert.equal(readImageDimensions(notReallyAnImage), null);
});
