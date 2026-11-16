/**
 * Seeded random bytes, for tests and the chaos runs: a RandomBytes port whose
 * stream is fixed by a seed and a tag, so that a game can be played again
 * byte for byte. Block i of the stream is
 *   SHA-256( "seeded bytes, version 1\n" + tag + "\n" + seed + "\n" + i )
 * and the stream is the blocks one after another. Each call to bytes(n) takes
 * the next n bytes.
 *
 * These are NOT secret: whoever knows the seed and the tag knows every byte.
 * A real host hands its host the platform's cryptographic source instead.
 */
import { sha256Words, utf8, wordsToBytes } from '../engine/core/sha256';
import type { RandomBytes } from './ports';

export class SeededBytes implements RandomBytes {
  readonly #seed: number;
  readonly #tag: string;
  #block = 0;
  #buffer: Uint8Array = new Uint8Array(0);
  #offset = 0;
  /** How many bytes have been handed out. */
  given = 0;

  constructor(seed: number, tag: string) {
    if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new Error(`a seed is a whole number from 0 to 4294967295, got ${seed}`);
    this.#seed = seed;
    this.#tag = tag;
  }

  bytes(n: number): Uint8Array {
    if (!Number.isInteger(n) || n < 0 || n > 1 << 20) throw new Error(`bytes: n must be a whole number from 0 to 1048576, got ${n}`);
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      if (this.#offset >= this.#buffer.length) {
        this.#buffer = wordsToBytes(sha256Words(utf8(`seeded bytes, version 1\n${this.#tag}\n${this.#seed}\n${this.#block}`)));
        this.#block += 1;
        this.#offset = 0;
      }
      out[i] = this.#buffer[this.#offset++] as number;
    }
    this.given += n;
    return out;
  }
}
