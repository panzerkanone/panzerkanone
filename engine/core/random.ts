/**
 * Seeded randomness in hash form: every random number is a hash of
 * (seed, tag, stable id). Nothing carries generator state from one draw to the
 * next, so a draw never depends on how many other draws were made before it,
 * or in what order.
 *
 *   - Dice: the k-th roll of a match is hashOf(seed, 'dice', k). The roll's
 *     number is its stable id, and the state keeps the number of the next roll.
 *   - An agent's stream: draw j of a decision is hashOf(seed, tag, j), the tag
 *     naming the agent's seat and the decision. Its seed is the agents' seed,
 *     which the simulator derives from the game's seed under a tag of its own
 *     and which is never the dice seed (sim/runner.ts, agentSeedsOf).
 *
 * Seeds are whole numbers from 0 to 2^32 - 1. Stable ids are whole numbers
 * from 0 to 2^53 - 1. The platform random function is never used in the engine.
 */

/** A 32-bit mixing function (a bijection on 32-bit words). */
export function mix32(x: number): number {
  let h = x | 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return h >>> 0;
}

/** A 32-bit hash of a tag (FNV-1a over UTF-16 units, then mixed). */
export function tagHash(tag: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < tag.length; i++) {
    h ^= tag.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return mix32(h ^ tag.length);
}

function checkSeed(seed: number): void {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
    throw new Error(`a seed is a whole number from 0 to 4294967295, got ${seed}`);
  }
}

function checkId(id: number): void {
  if (!Number.isSafeInteger(id) || id < 0) throw new Error(`a stable id is a whole number from 0 up, got ${id}`);
}

/** hash(seed, tag, id) with the tag already hashed: a 32-bit unsigned number. */
export function hashWith(seed: number, tagH: number, id: number): number {
  const lo = id >>> 0;
  const hi = Math.floor(id / 0x100000000) >>> 0;
  let h = mix32(seed ^ 0x9e3779b9);
  h = mix32(h ^ tagH);
  h = mix32((h + lo) ^ 0x85ebca6b);
  h = mix32(h ^ hi ^ 0xc2b2ae35);
  return h;
}

/** hash(seed, tag, id): a 32-bit unsigned number. */
export function hashOf(seed: number, tag: string, id: number): number {
  checkSeed(seed);
  checkId(id);
  return hashWith(seed, tagHash(tag), id);
}

/** A whole number from 0 to n - 1 taken from a 32-bit hash, without bias (rejection, re-mixed). */
export function uniformBelow(u32: number, n: number): number {
  if (!Number.isInteger(n) || n < 1 || n > 0x100000000) throw new Error(`cannot draw below ${n}`);
  const limit = 0x100000000 - (0x100000000 % n);
  let u = u32 >>> 0;
  let attempt = 0;
  while (u >= limit) {
    attempt += 1;
    u = mix32((u + Math.imul(attempt, 0x9e3779b9)) | 0);
  }
  return u % n;
}

/** The face (1 to `faces`) of roll number k of a seed: hash(seed, 'dice', k). */
export function rollFace(seed: number, k: number, faces: number): number {
  return 1 + uniformBelow(hashOf(seed, 'dice', k), faces);
}

/**
 * An agent's own random stream for one decision: draw j is hash(seed, tag, j).
 * Two streams made with the same seed and tag give the same numbers.
 *
 * The stream is what an agent is handed, so it hands over nothing but its
 * draws: the seed and the tag sit in private class members (#seed, #tagH),
 * which no property access, key listing or JSON text shows. That keeps a seed
 * from being passed along by accident. It is not secrecy: the hash can be run
 * backwards, so the draws give the seed, and in the simulator the agents'
 * seeds trace back to the game's seed and so to its seeded dice
 * (kernel/dice.ts says who can foretell a roll, and what to use instead).
 */
export class RandomStream {
  readonly #seed: number;
  readonly #tagH: number;
  #drawn = 0;

  constructor(seed: number, tag: string) {
    checkSeed(seed);
    this.#seed = seed;
    this.#tagH = tagHash(tag);
  }

  /** How many numbers have been drawn. */
  get count(): number {
    return this.#drawn;
  }

  /** The next 32-bit unsigned number. */
  nextU32(): number {
    const v = hashWith(this.#seed, this.#tagH, this.#drawn);
    this.#drawn += 1;
    return v;
  }

  /** A whole number from 0 to n - 1. */
  below(n: number): number {
    return uniformBelow(this.nextU32(), n);
  }

  /** A number in [0, 1). */
  unit(): number {
    return this.nextU32() / 0x100000000;
  }
}
