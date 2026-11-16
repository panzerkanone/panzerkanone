/**
 * The title screen's randomness: every number is the engine's hash of (seed, tag, stable id), as a
 * share from 0 up to (not including) 1. Nothing carries state from one draw to the next, so what
 * the screen shows at a time depends on the seed and the time alone. The platform's random
 * function is never used.
 *
 * (The engine's module is named by its path, not by the client's `@engine` alias, so that the
 * tests can load this file without the client's bundler.)
 */
import { hashWith, tagHash } from '../../../engine/core/random';

export type Draw = (id: number) => number;

/** The draws of one tag: `draw(id)` is the same number every time for the same seed, tag and id. */
export function drawsOf(seed: number, tag: string): Draw {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new Error(`a seed is a whole number from 0 to 4294967295, got ${seed}`);
  const tagH = tagHash(tag);
  return id => hashWith(seed, tagH, id) / 0x100000000;
}

/** A seed out of an address's `seed` value; the screen's own seed when there is none or it is not one. */
export function seedFrom(text: string | null, fallback: number): number {
  if (text === null || !/^\d{1,10}$/.test(text)) return fallback;
  const n = Number(text);
  return n <= 0xffffffff ? n : fallback;
}
