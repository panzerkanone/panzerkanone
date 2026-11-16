/**
 * SHA-256 (FIPS 180-4), written out in TypeScript so the engine needs no
 * platform API. Content hashes of maps, rulesets, scenarios and game states
 * are SHA-256 of their canonical text (canonical.ts), as lower-case hex.
 *
 * Text is hashed as UTF-8. A lone surrogate is encoded as U+FFFD, as the
 * platform encoders do.
 */

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const W = new Uint32Array(64);

/** UTF-8 bytes of a string. */
export function utf8(text: string): Uint8Array {
  // Worst case is 3 bytes per UTF-16 unit.
  const out = new Uint8Array(text.length * 3);
  let n = 0;
  for (let i = 0; i < text.length; i++) {
    let c = text.charCodeAt(i);
    if (c < 0x80) {
      out[n++] = c;
    } else if (c < 0x800) {
      out[n++] = 0xc0 | (c >> 6);
      out[n++] = 0x80 | (c & 63);
    } else if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length) {
      const d = text.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) {
        c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00);
        i++;
        out[n++] = 0xf0 | (c >> 18);
        out[n++] = 0x80 | ((c >> 12) & 63);
        out[n++] = 0x80 | ((c >> 6) & 63);
        out[n++] = 0x80 | (c & 63);
      } else {
        out[n++] = 0xef; out[n++] = 0xbf; out[n++] = 0xbd;
      }
    } else if (c >= 0xd800 && c <= 0xdfff) {
      out[n++] = 0xef; out[n++] = 0xbf; out[n++] = 0xbd;
    } else {
      out[n++] = 0xe0 | (c >> 12);
      out[n++] = 0x80 | ((c >> 6) & 63);
      out[n++] = 0x80 | (c & 63);
    }
  }
  return out.subarray(0, n);
}

/** SHA-256 of a byte array, as eight 32-bit words. */
export function sha256Words(bytes: Uint8Array): Uint32Array {
  const len = bytes.length;
  // Message + 0x80 + zero padding + 8-byte length, a multiple of 64 bytes.
  const total = (((len + 9 + 63) >> 6) << 6);
  const msg = new Uint8Array(total);
  msg.set(bytes);
  msg[len] = 0x80;
  const bits = len * 8;
  // Lengths up to 2^53 bits: the high word takes what does not fit in 32 bits.
  const hi = Math.floor(bits / 0x100000000);
  const lo = bits >>> 0;
  msg[total - 8] = hi >>> 24; msg[total - 7] = (hi >>> 16) & 255; msg[total - 6] = (hi >>> 8) & 255; msg[total - 5] = hi & 255;
  msg[total - 4] = lo >>> 24; msg[total - 3] = (lo >>> 16) & 255; msg[total - 2] = (lo >>> 8) & 255; msg[total - 1] = lo & 255;

  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
  let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
  const w = W;
  for (let off = 0; off < total; off += 64) {
    for (let i = 0; i < 16; i++) {
      const j = off + i * 4;
      w[i] = ((msg[j] as number) << 24) | ((msg[j + 1] as number) << 16) | ((msg[j + 2] as number) << 8) | (msg[j + 3] as number);
    }
    for (let i = 16; i < 64; i++) {
      const x = w[i - 15] as number;
      const y = w[i - 2] as number;
      const s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
      const s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
      w[i] = ((w[i - 16] as number) + s0 + (w[i - 7] as number) + s1) | 0;
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (let i = 0; i < 64; i++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + (K[i] as number) + (w[i] as number)) | 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0; h5 = (h5 + f) | 0; h6 = (h6 + g) | 0; h7 = (h7 + h) | 0;
  }
  return new Uint32Array([h0, h1, h2, h3, h4, h5, h6, h7]);
}

const HEX = '0123456789abcdef';

function wordsToHex(words: Uint32Array): string {
  let s = '';
  for (let i = 0; i < words.length; i++) {
    const v = words[i] as number;
    for (let k = 28; k >= 0; k -= 4) s += HEX[(v >>> k) & 15];
  }
  return s;
}

/** SHA-256 of a byte array, as 64 lower-case hex digits. */
export function sha256Hex(bytes: Uint8Array): string {
  return wordsToHex(sha256Words(bytes));
}

/** SHA-256 of a string's UTF-8 bytes, as 64 lower-case hex digits. */
export function sha256Text(text: string): string {
  return wordsToHex(sha256Words(utf8(text)));
}

/** The eight words of a SHA-256 value as 32 bytes, most significant first. */
export function wordsToBytes(words: Uint32Array): Uint8Array {
  const out = new Uint8Array(words.length * 4);
  for (let i = 0; i < words.length; i++) {
    const v = words[i] as number;
    out[i * 4] = v >>> 24;
    out[i * 4 + 1] = (v >>> 16) & 255;
    out[i * 4 + 2] = (v >>> 8) & 255;
    out[i * 4 + 3] = v & 255;
  }
  return out;
}

/**
 * HMAC-SHA-256 (RFC 2104) of a message under a key, as eight 32-bit words.
 * Without the key the value cannot be computed or told from random, which is
 * what a host's dice rest on (kernel/dice.ts, KeyedDice).
 */
export function hmacSha256Words(key: Uint8Array, message: Uint8Array): Uint32Array {
  const BLOCK = 64;
  const k = key.length > BLOCK ? wordsToBytes(sha256Words(key)) : key;
  const inner = new Uint8Array(BLOCK + message.length);
  const outer = new Uint8Array(BLOCK + 32);
  for (let i = 0; i < BLOCK; i++) {
    const b = i < k.length ? (k[i] as number) : 0;
    inner[i] = b ^ 0x36;
    outer[i] = b ^ 0x5c;
  }
  inner.set(message, BLOCK);
  outer.set(wordsToBytes(sha256Words(inner)), BLOCK);
  return sha256Words(outer);
}

/** HMAC-SHA-256 as 64 lower-case hex digits. */
export function hmacSha256Hex(key: Uint8Array, message: Uint8Array): string {
  return wordsToHex(hmacSha256Words(key, message));
}
