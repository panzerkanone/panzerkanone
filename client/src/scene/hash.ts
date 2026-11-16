/**
 * Seeded randomness for the scene: a hash of (seed, tag, stable id). Nothing in
 * client/src/scene calls the platform's random number generator.
 */

/** A number in [0, 1) for a seed, a tag and an id. */
export function hash01(seed: number, tag: string, id: number): number {
  let h = 2166136261 ^ seed;
  for (let i = 0; i < tag.length; i++) {
    h ^= tag.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= id + 0x9e3779b9;
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** The seed of every procedural surface of the scene. */
export const SCENE_SEED = 20261111;
