// A minimal PNG encoder for the .arduboy banner.
//
// The banner has to be produced in Node as well as the browser — the CLI has no
// canvas — so rather than depend on toDataURL this writes the file directly. The
// zlib stream inside IDAT uses *stored* (uncompressed) deflate blocks, which is
// legal and means neither runtime needs a compression library. A 128x64 image
// costs about 8 KB that way, which is nothing next to the .hex beside it.

import { crc32 } from './zip.js';

const SIGNATURE = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);

function u32be(v) {
  return Uint8Array.of((v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff);
}

function concat(chunks) {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return out;
}

// A PNG chunk: length, type, data, CRC over type+data.
function chunk(type, data) {
  const typeBytes = Uint8Array.of(...[...type].map((c) => c.charCodeAt(0)));
  const body = concat([typeBytes, data]);
  return concat([u32be(data.length), body, u32be(crc32(body))]);
}

// Adler-32, the checksum a zlib stream ends with.
function adler32(bytes) {
  let a = 1, b = 0;
  for (let i = 0; i < bytes.length; i++) {
    a = (a + bytes[i]) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

// Wrap raw bytes in a zlib stream made of stored deflate blocks. Each block
// carries at most 65535 bytes and repeats its length once inverted, which is
// what lets a decoder copy it straight through.
function zlibStored(raw) {
  const parts = [Uint8Array.of(0x78, 0x01)]; // CMF/FLG for deflate, no preset dict
  const MAX = 0xffff;
  if (raw.length === 0) {
    parts.push(Uint8Array.of(1, 0, 0, 0xff, 0xff));
  }
  for (let at = 0; at < raw.length; at += MAX) {
    const slice = raw.subarray(at, Math.min(at + MAX, raw.length));
    const last = at + MAX >= raw.length ? 1 : 0;
    parts.push(Uint8Array.of(last, slice.length & 0xff, (slice.length >>> 8) & 0xff,
      ~slice.length & 0xff, (~slice.length >>> 8) & 0xff));
    parts.push(slice);
  }
  parts.push(u32be(adler32(raw)));
  return concat(parts);
}

/**
 * Encode an 8-bit greyscale image as a PNG.
 * @param {Uint8Array} pixels one byte per pixel, row-major, length w*h
 * @param {number} w
 * @param {number} h
 * @returns {Uint8Array}
 */
export function encodeGreyscalePng(pixels, w, h) {
  if (pixels.length !== w * h) {
    throw new Error(`expected ${w * h} pixels for ${w}x${h}, got ${pixels.length}`);
  }
  // Each scanline is prefixed with its filter type; 0 means "no filtering",
  // which keeps the encoder honest and trivial.
  const raw = new Uint8Array((w + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w + 1)] = 0;
    raw.set(pixels.subarray(y * w, y * w + w), y * (w + 1) + 1);
  }

  const ihdr = concat([
    u32be(w), u32be(h),
    Uint8Array.of(8, 0, 0, 0, 0), // 8-bit, colour type 0 (greyscale), no interlace
  ]);

  return concat([
    SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlibStored(raw)),
    chunk('IEND', new Uint8Array(0)),
  ]);
}

/**
 * Turn the emulator's framebuffer into a PNG. `fb` holds one byte per pixel,
 * non-zero meaning lit — the Arduboy screen is white-on-black, so lit pixels
 * become white.
 */
export function framebufferToPng(fb, w, h) {
  const px = new Uint8Array(w * h);
  for (let i = 0; i < px.length; i++) px[i] = fb[i] ? 0xff : 0x00;
  return encodeGreyscalePng(px, w, h);
}
