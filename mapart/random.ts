/**
 * Seeded randomness for the map art. Every random choice is a hash of the map
 * seed, a feature tag and stable whole-number ids (a hex number, a lattice
 * cell, a side key). There is no shared random stream, so the order in which
 * hexes are visited can never change a result, and editing one hex changes
 * only the choices whose ids touch it (docs/art/map-art-spec.md, section 3).
 *
 * Floats are never hashed: ids are whole numbers.
 */

/** FNV-1a of a tag, as an unsigned 32-bit number. */
export function tagHash(tag: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < tag.length; i++) {
    h ^= tag.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** The murmur3 finaliser: a good 32-bit mix. */
function fmix(h: number): number {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Hash of (seed, tag, ids) as an unsigned 32-bit number. Ids must be whole numbers. */
export function hash32(seed: number, tag: string, ...ids: readonly number[]): number {
  let h = fmix((seed >>> 0) ^ 0x9e3779b9);
  h = fmix(h ^ tagHash(tag));
  for (const id of ids) {
    // Whole numbers of any sign: the low and high 32 bits are mixed in turn.
    const lo = id | 0;
    const hi = Math.floor(id / 4294967296) | 0;
    h = fmix(Math.imul(h ^ lo, 0x27d4eb2f) + 0x165667b1);
    if (hi !== 0 && hi !== -1) h = fmix(h ^ hi);
  }
  return h >>> 0;
}

/** A number in [0, 1) from (seed, tag, ids). */
export function unit(seed: number, tag: string, ...ids: readonly number[]): number {
  return hash32(seed, tag, ...ids) / 4294967296;
}

/** A number in [lo, hi) from (seed, tag, ids). */
export function between(lo: number, hi: number, seed: number, tag: string, ...ids: readonly number[]): number {
  return lo + (hi - lo) * unit(seed, tag, ...ids);
}

/** A number in [-1, 1) from (seed, tag, ids). */
export function signedUnit(seed: number, tag: string, ...ids: readonly number[]): number {
  return 2 * unit(seed, tag, ...ids) - 1;
}

/**
 * hash32(seed, tag, i, j) for many cells of a lattice: the tag is mixed once,
 * and each call gives exactly what hash32 gives for two whole-number ids
 * below 2^31 in size.
 */
export function cellHasher(seed: number, tag: string): (i: number, j: number) => number {
  const h0 = fmix(fmix((seed >>> 0) ^ 0x9e3779b9) ^ tagHash(tag));
  return (i: number, j: number): number => {
    const h1 = fmix(Math.imul(h0 ^ (i | 0), 0x27d4eb2f) + 0x165667b1);
    return fmix(Math.imul(h1 ^ (j | 0), 0x27d4eb2f) + 0x165667b1);
  };
}

/**
 * A permutation of 0..n-1 shuffled from a seed (Fisher-Yates, each swap from
 * its own hash). Used by the `--hex-order` check to visit hexes in another order.
 */
export function shuffledOrder(n: number, seed: number): number[] {
  const out = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = hash32(seed, 'hex-order', i) % (i + 1);
    const t = out[i] as number;
    out[i] = out[j] as number;
    out[j] = t;
  }
  return out;
}
