// READ AN IMAGE'S REAL DIMENSIONS OUT OF ITS OWN BYTES.
//
// WHY THIS EXISTS
// ---------------
// Two published hero images had no recorded width or height, so the Discover
// audit could not check them against Google's 1200px minimum and correctly
// reported IMAGE UNMEASURED rather than guessing. Both filenames begin
// "1280px-", which is exactly the sort of thing that invites a guess. A filename
// is a claim somebody typed; it is not a measurement, and recording it as one
// would put a fabricated fact in the database.
//
// So this reads the actual file header. The number that lands in the database
// is the number in the image.
//
// NO DEPENDENCY. Every format below states its dimensions in a fixed position
// near the start of the file, so this needs a few dozen bytes and no decoder —
// which matters for a project whose paid-services budget is zero and whose
// dependency list is deliberately tiny.
//
// FAILS BY RETURNING NULL. An unrecognised or truncated file yields null, never
// a plausible-looking default. "I could not measure this" is a useful answer;
// "1280x720, probably" is not.
//
// Pure. The caller does the I/O and hands over the bytes.

export type ImageDimensions = { width: number; height: number; format: string };

/**
 * Parse dimensions from the leading bytes of an image.
 *
 * 64 KiB is more than enough for every format here — JPEG is the only one that
 * can push its size marker far in, and then only past large EXIF blocks.
 */
export function readImageDimensions(bytes: Uint8Array): ImageDimensions | null {
  return png(bytes) ?? gif(bytes) ?? webp(bytes) ?? jpeg(bytes) ?? avif(bytes);
}

const u16be = (b: Uint8Array, i: number): number => (b[i] << 8) | b[i + 1];
const u32be = (b: Uint8Array, i: number): number =>
  ((b[i] << 24) >>> 0) + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3];
const u16le = (b: Uint8Array, i: number): number => b[i] | (b[i + 1] << 8);
const ascii = (b: Uint8Array, i: number, n: number): string =>
  String.fromCharCode(...b.subarray(i, i + n));

/** PNG: an 8-byte signature, then an IHDR chunk whose payload starts at 16. */
function png(b: Uint8Array): ImageDimensions | null {
  if (b.length < 24) return null;
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (let i = 0; i < 8; i++) if (b[i] !== sig[i]) return null;
  if (ascii(b, 12, 4) !== "IHDR") return null;
  return { width: u32be(b, 16), height: u32be(b, 20), format: "png" };
}

/** GIF: "GIF87a"/"GIF89a" then little-endian width and height. */
function gif(b: Uint8Array): ImageDimensions | null {
  if (b.length < 10) return null;
  const magic = ascii(b, 0, 6);
  if (magic !== "GIF87a" && magic !== "GIF89a") return null;
  return { width: u16le(b, 6), height: u16le(b, 8), format: "gif" };
}

/** WebP: RIFF container with three possible chunk layouts. */
function webp(b: Uint8Array): ImageDimensions | null {
  if (b.length < 30) return null;
  if (ascii(b, 0, 4) !== "RIFF" || ascii(b, 8, 4) !== "WEBP") return null;
  const chunk = ascii(b, 12, 4);
  if (chunk === "VP8X") {
    // 24-bit little-endian, stored as (value - 1).
    const w = 1 + (b[24] | (b[25] << 8) | (b[26] << 16));
    const h = 1 + (b[27] | (b[28] << 8) | (b[29] << 16));
    return { width: w, height: h, format: "webp" };
  }
  if (chunk === "VP8 ") {
    // Lossy: a 3-byte start code, then 14-bit dimensions.
    return { width: u16le(b, 26) & 0x3fff, height: u16le(b, 28) & 0x3fff, format: "webp" };
  }
  if (chunk === "VP8L") {
    // Lossless: 14 bits each, packed across four bytes after the 0x2f marker.
    const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1, format: "webp" };
  }
  return null;
}

/**
 * JPEG: walk the marker segments to the first Start Of Frame.
 *
 * The dimensions are in SOF0-SOF15, excluding the four markers in that range
 * that are not frame headers (DHT, JPG, DAC, and the restart markers).
 */
function jpeg(b: Uint8Array): ImageDimensions | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) {
      i++; // resynchronise rather than give up on one stray byte
      continue;
    }
    const marker = b[i + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    if (marker === 0xda || marker === 0xd9) return null; // reached the scan; no SOF
    const length = u16be(b, i + 2);
    if (length < 2) return null;
    const isFrame =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isFrame) {
      return { height: u16be(b, i + 5), width: u16be(b, i + 7), format: "jpeg" };
    }
    i += 2 + length;
  }
  return null;
}

/**
 * AVIF/HEIF: an ISOBMFF box structure; dimensions live in the `ispe` box.
 *
 * Scanned for rather than walked, because the box tree varies by encoder and
 * the payload layout of `ispe` itself does not: version+flags, then width and
 * height as 32-bit big-endian.
 */
function avif(b: Uint8Array): ImageDimensions | null {
  if (b.length < 16 || ascii(b, 4, 4) !== "ftyp") return null;
  for (let i = 0; i + 16 < Math.min(b.length, 65536); i++) {
    if (ascii(b, i, 4) !== "ispe") continue;
    const width = u32be(b, i + 8);
    const height = u32be(b, i + 12);
    if (width > 0 && height > 0 && width < 100000 && height < 100000) {
      return { width, height, format: "avif" };
    }
  }
  return null;
}

/**
 * Does a measurement look sane enough to record?
 *
 * A parser that misreads a truncated file can produce 0 or an absurd number.
 * Writing that into the database would be worse than leaving the field null,
 * because a wrong number silences the very audit that flagged the gap.
 */
export function isPlausible(d: ImageDimensions | null): d is ImageDimensions {
  if (!d) return false;
  return (
    Number.isInteger(d.width) &&
    Number.isInteger(d.height) &&
    d.width > 0 &&
    d.height > 0 &&
    d.width <= 60000 &&
    d.height <= 60000
  );
}
