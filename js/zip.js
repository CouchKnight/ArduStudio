// A tiny ZIP writer, used to build .arduboy packages.
//
// Entries are stored uncompressed (method 0). That is a perfectly ordinary ZIP
// that every reader accepts, and it means the same code runs in the browser and
// in Node without pulling in a deflate implementation for each. A package is a
// few tens of KB, so the bytes saved by compressing would not be worth it.

// Standard CRC-32 (the one ZIP and PNG both use), table built once on load.
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const enc = new TextEncoder();

// Growable little-endian byte writer. ZIP is little-endian throughout.
class ByteWriter {
  constructor() { this.parts = []; this.length = 0; }
  bytes(b) { this.parts.push(b); this.length += b.length; return this; }
  u8(v) { return this.bytes(Uint8Array.of(v & 0xff)); }
  u16(v) { return this.bytes(Uint8Array.of(v & 0xff, (v >>> 8) & 0xff)); }
  u32(v) {
    return this.bytes(Uint8Array.of(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff));
  }
  finish() {
    const out = new Uint8Array(this.length);
    let at = 0;
    for (const p of this.parts) { out.set(p, at); at += p.length; }
    return out;
  }
}

// MS-DOS date/time, which is what a ZIP header carries. Seconds have 2-second
// resolution in that format, hence the halving.
function dosDateTime(date) {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: ((date.getHours() & 0x1f) << 11) | ((date.getMinutes() & 0x3f) << 5) | ((date.getSeconds() / 2) & 0x1f),
    date: (((year - 1980) & 0x7f) << 9) | (((date.getMonth() + 1) & 0x0f) << 5) | (date.getDate() & 0x1f),
  };
}

/**
 * Build a ZIP archive.
 * @param {Array<{name: string, data: Uint8Array|string}>} entries
 * @param {Date} [date] timestamp stamped on every entry
 * @returns {Uint8Array}
 */
export function makeZip(entries, date = new Date()) {
  const { time: dosTime, date: dosDate } = dosDateTime(date);
  const out = new ByteWriter();
  const central = [];

  for (const entry of entries) {
    const name = enc.encode(entry.name);
    const data = typeof entry.data === 'string' ? enc.encode(entry.data) : entry.data;
    const crc = crc32(data);
    const offset = out.length;

    out.u32(0x04034b50)   // local file header
      .u16(20)            // version needed: 2.0
      .u16(0)             // flags
      .u16(0)             // method 0 = stored
      .u16(dosTime).u16(dosDate)
      .u32(crc)
      .u32(data.length)   // compressed size == uncompressed, being stored
      .u32(data.length)
      .u16(name.length)
      .u16(0)             // extra field length
      .bytes(name)
      .bytes(data);

    central.push({ name, crc, size: data.length, offset });
  }

  const centralStart = out.length;
  for (const e of central) {
    out.u32(0x02014b50)   // central directory header
      .u16(20)            // version made by
      .u16(20)            // version needed
      .u16(0).u16(0)      // flags, method
      .u16(dosTime).u16(dosDate)
      .u32(e.crc)
      .u32(e.size).u32(e.size)
      .u16(e.name.length)
      .u16(0).u16(0)      // extra, comment
      .u16(0)             // disk number
      .u16(0)             // internal attributes
      .u32(0)             // external attributes
      .u32(e.offset)
      .bytes(e.name);
  }
  const centralSize = out.length - centralStart;

  out.u32(0x06054b50)     // end of central directory
    .u16(0).u16(0)        // this disk, disk with central directory
    .u16(central.length).u16(central.length)
    .u32(centralSize)
    .u32(centralStart)
    .u16(0);              // comment length

  return out.finish();
}

/**
 * Read a ZIP back. Only understands what makeZip() writes (stored entries), and
 * exists so tests can verify an archive rather than trust the writer.
 * @returns {Array<{name: string, data: Uint8Array, crc: number}>}
 */
export function readZip(bytes) {
  const dec = new TextDecoder();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = [];
  let at = 0;
  while (at + 4 <= bytes.length && view.getUint32(at, true) === 0x04034b50) {
    const crc = view.getUint32(at + 14, true);
    const size = view.getUint32(at + 18, true);
    const nameLen = view.getUint16(at + 26, true);
    const extraLen = view.getUint16(at + 28, true);
    const nameAt = at + 30;
    const dataAt = nameAt + nameLen + extraLen;
    out.push({
      name: dec.decode(bytes.subarray(nameAt, nameAt + nameLen)),
      data: bytes.subarray(dataAt, dataAt + size),
      crc,
    });
    at = dataAt + size;
  }
  return out;
}
