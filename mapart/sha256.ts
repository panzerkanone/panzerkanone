/**
 * SHA-256 of a string's UTF-8 bytes, in plain TypeScript, so the display-list
 * hash is the same function in Node and in the bake worker (no platform API).
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

/** UTF-8 bytes of a string. */
export function utf8Bytes(text: string): Uint8Array {
  // Worst case 3 bytes per UTF-16 unit.
  const out = new Uint8Array(text.length * 3);
  let n = 0;
  for (let i = 0; i < text.length; i++) {
    let c = text.charCodeAt(i);
    if (c < 0x80) {
      out[n++] = c;
    } else if (c < 0x800) {
      out[n++] = 0xc0 | (c >> 6);
      out[n++] = 0x80 | (c & 63);
    } else if (c >= 0xd800 && c < 0xdc00 && i + 1 < text.length) {
      const d = text.charCodeAt(i + 1);
      if (d >= 0xdc00 && d < 0xe000) {
        c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00);
        i++;
        out[n++] = 0xf0 | (c >> 18);
        out[n++] = 0x80 | ((c >> 12) & 63);
        out[n++] = 0x80 | ((c >> 6) & 63);
        out[n++] = 0x80 | (c & 63);
        continue;
      }
      out[n++] = 0xef;
      out[n++] = 0xbf;
      out[n++] = 0xbd;
    } else {
      out[n++] = 0xe0 | (c >> 12);
      out[n++] = 0x80 | ((c >> 6) & 63);
      out[n++] = 0x80 | (c & 63);
    }
  }
  return out.subarray(0, n);
}

/** SHA-256 of bytes, as 64 lower-case hex digits. */
export function sha256Bytes(bytes: Uint8Array): string {
  const len = bytes.length;
  const blocks = Math.ceil((len + 9) / 64);
  const msg = new Uint8Array(blocks * 64);
  msg.set(bytes);
  msg[len] = 0x80;
  const bits = len * 8;
  const view = new DataView(msg.buffer);
  view.setUint32(msg.length - 8, Math.floor(bits / 4294967296), false);
  view.setUint32(msg.length - 4, bits >>> 0, false);

  const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const W = new Uint32Array(64);
  for (let b = 0; b < blocks; b++) {
    for (let t = 0; t < 16; t++) W[t] = view.getUint32(b * 64 + t * 4, false);
    for (let t = 16; t < 64; t++) {
      const w15 = W[t - 15] as number;
      const w2 = W[t - 2] as number;
      const s0 = ((w15 >>> 7) | (w15 << 25)) ^ ((w15 >>> 18) | (w15 << 14)) ^ (w15 >>> 3);
      const s1 = ((w2 >>> 17) | (w2 << 15)) ^ ((w2 >>> 19) | (w2 << 13)) ^ (w2 >>> 10);
      W[t] = ((W[t - 16] as number) + s0 + (W[t - 7] as number) + s1) >>> 0;
    }
    let a = H[0] as number;
    let bb = H[1] as number;
    let c = H[2] as number;
    let d = H[3] as number;
    let e = H[4] as number;
    let f = H[5] as number;
    let g = H[6] as number;
    let h = H[7] as number;
    for (let t = 0; t < 64; t++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + (K[t] as number) + (W[t] as number)) >>> 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const maj = (a & bb) ^ (a & c) ^ (bb & c);
      const t2 = (S0 + maj) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = bb;
      bb = a;
      a = (t1 + t2) >>> 0;
    }
    H[0] = ((H[0] as number) + a) >>> 0;
    H[1] = ((H[1] as number) + bb) >>> 0;
    H[2] = ((H[2] as number) + c) >>> 0;
    H[3] = ((H[3] as number) + d) >>> 0;
    H[4] = ((H[4] as number) + e) >>> 0;
    H[5] = ((H[5] as number) + f) >>> 0;
    H[6] = ((H[6] as number) + g) >>> 0;
    H[7] = ((H[7] as number) + h) >>> 0;
  }
  let out = '';
  for (let i = 0; i < 8; i++) out += (H[i] as number).toString(16).padStart(8, '0');
  return out;
}

/** SHA-256 of a string's UTF-8 bytes. */
export function sha256Text(text: string): string {
  return sha256Bytes(utf8Bytes(text));
}
