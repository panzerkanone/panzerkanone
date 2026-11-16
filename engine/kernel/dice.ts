/**
 * Dice sources. A match is given one; apply asks it for roll number k.
 *
 *   SeededDice(seed)        hash(seed, 'dice', k): for tests and simulation
 *   KeyedDice(key, game)    HMAC-SHA-256 of the game's id and the roll number under a
 *                           secret key: for a host whose players must not foretell a roll
 *   RecordedDice(rolls)     answers from the rolls a record holds: for replaying a game whose
 *                           dice cannot be made again (a keyed game, before its key is public)
 *   ThrowingDice            fails if asked: proves that replaying events needs no dice
 *   FixedDice(faces)        answers the given faces in turn, whatever k is: for
 *                           enumerating every dice value of an attack
 *
 * WHO CAN FORETELL A ROLL
 *
 * Seeded dice are reproducible, and that is all they are: the same seed gives
 * the same game, which is what a test or a tuning run needs. They are NOT
 * secret. A seed is 32 bits and every seat is sent the faces that are rolled:
 * about a dozen of them single out the seed, and trying every seed takes
 * about a minute on one core (measured: docs/review/M1b/round3). In the
 * simulator the agents' own random streams also derive from the game's seed
 * and can be run backwards to it. So seeded dice are for trusted agents only.
 *
 * Keyed dice cannot be foretold by anyone without the key: nothing a seat is
 * sent, and nothing derived from a game seed, helps to compute the next face.
 * That holds only while the host keeps to these rules:
 *   - The key is 16 to 64 bytes from a cryptographic random source. A phrase
 *     is not a key, and a guessable key is found from a handful of faces. The
 *     class can check a key's length, not how it was made.
 *   - One key serves one game. The game's id is part of every roll, so the
 *     same key under another id rolls differently; a host still makes a new
 *     key for every match.
 *   - The dice object stays with the host. Whoever holds it can ask it for
 *     rolls to come, and code in the same process can reach its key (by the
 *     debugger protocol, or by replacing a built-in the hash uses). Code
 *     that is not the host's own (an agent of unknown origin, a client) runs
 *     somewhere else: a worker or another machine. A Match keeps its dice in
 *     a private member for the same reason.
 *   - What a host publishes before a game is commitment(), a hash of the key
 *     under a label of its own. Never the plain SHA-256 of the key.
 *   - A commitment shows that the host did not change its key during the
 *     game. It does not show that the host did not pick a key it liked: a host
 *     can try keys until the first rolls suit it. Dice that neither side can
 *     steer need a committed contribution from every seat mixed into the key.
 *     That protocol is Milestone 7a's; this class is its building block.
 */
import { rollFace } from '../core/random';
import { hmacSha256Words, sha256Hex, utf8 } from '../core/sha256';
import type { Dice } from './ruleset';

export class SeededDice implements Dice {
  readonly seed: number;
  calls = 0;

  constructor(seed: number) {
    if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new Error(`a dice seed is a whole number from 0 to 4294967295, got ${seed}`);
    this.seed = seed;
  }

  roll(k: number, faces: number): number {
    checkRoll(k, faces);
    this.calls += 1;
    return rollFace(this.seed, k, faces);
  }
}

/** The shortest key KeyedDice accepts: 16 bytes, 128 bits. */
export const MIN_DICE_KEY_BYTES = 16;
/**
 * The longest: 64 bytes, one block of the hash. (HMAC hashes a longer key down
 * first, so the plain hash of a longer key would BE its working key.)
 */
export const MAX_DICE_KEY_BYTES = 64;

const COMMITMENT_LABEL = 'dice key commitment, version 1\n';

/** A roll number is a whole number from 0; a die has 1 to 2^32 faces. The same for every dice source. */
function checkRoll(k: number, faces: number): void {
  if (!Number.isSafeInteger(k) || k < 0) throw new Error(`a roll number is a whole number from 0, got ${k}`);
  if (!Number.isInteger(faces) || faces < 1 || faces > 0x100000000) throw new Error(`a die has 1 to 4294967296 faces, got ${faces}`);
}

/** A game's id, as keyed dice take it: 1 to 128 visible ASCII characters, so it has one spelling and one encoding. */
const GAME_ID = /^[\x21-\x7e]{1,128}$/;

export class KeyedDice implements Dice {
  readonly #key: Uint8Array;
  readonly #game: string;
  calls = 0;

  /**
   * `key`: MIN_DICE_KEY_BYTES to MAX_DICE_KEY_BYTES random bytes that only the
   * host knows. `game`: the id of the one game these dice are for (1 to 128
   * visible ASCII characters, no spaces).
   */
  constructor(key: Uint8Array, game: string) {
    if (!(key instanceof Uint8Array)) throw new Error('a dice key is a Uint8Array of random bytes');
    // A copy of the bytes, taken first: whatever kind of byte array was passed (a Node Buffer's
    // slice() is a view, not a copy) and whatever its owner does with it next, these stay.
    const bytes = new Uint8Array(key);
    if (bytes.length < MIN_DICE_KEY_BYTES || bytes.length > MAX_DICE_KEY_BYTES) {
      throw new Error(`a dice key is ${MIN_DICE_KEY_BYTES} to ${MAX_DICE_KEY_BYTES} bytes, got ${bytes.length}`);
    }
    // The commonest mistake: a buffer that was never filled, or was wiped before it was passed.
    if (bytes.every(b => b === bytes[0])) throw new Error('a dice key is random bytes, not one byte repeated (an unfilled or wiped buffer?)');
    if (typeof game !== 'string' || !GAME_ID.test(game)) {
      throw new Error('keyed dice need the id of the one game they are for: 1 to 128 visible ASCII characters');
    }
    this.#key = bytes;
    this.#game = game;
  }

  roll(k: number, faces: number): number {
    checkRoll(k, faces);
    this.calls += 1;
    if (faces === 1) return 1;
    // Every face equally likely: take 32-bit words of the keyed hash until one falls below the
    // largest multiple of `faces` (the first almost always does).
    const limit = Math.floor(0x100000000 / faces) * faces;
    for (let block = 0; ; block++) {
      // The id's length comes first, so no two games, rolls or dice share a message.
      const words = hmacSha256Words(this.#key, utf8(`game ${this.#game.length}:${this.#game} roll ${k} of ${faces} block ${block}`));
      for (let i = 0; i < words.length; i++) {
        const w = words[i] as number;
        if (w < limit) return (w % faces) + 1;
      }
    }
  }

  /**
   * What a host may publish before the game to bind itself to this key: the
   * SHA-256 of a fixed label followed by the key, as hex. Revealing the key
   * afterwards lets anyone check it against this and re-roll the game.
   */
  commitment(): string {
    const label = utf8(COMMITMENT_LABEL);
    const bytes = new Uint8Array(label.length + this.#key.length);
    bytes.set(label, 0);
    bytes.set(this.#key, label.length);
    return sha256Hex(bytes);
  }
}

/** One roll as a record holds it: its number, the die's faces, and the face that came up. */
export interface RecordedRoll {
  readonly k: number;
  readonly faces: number;
  readonly face: number;
}

/**
 * Dice that answer from the rolls a record holds. A roll the record does not
 * hold, or one asked for with another number of faces, is an error: a replay
 * that asks for it is not the recorded game.
 */
export class RecordedDice implements Dice {
  readonly #rolls = new Map<number, RecordedRoll>();
  readonly #asked = new Set<number>();
  calls = 0;

  constructor(rolls: readonly RecordedRoll[]) {
    for (const r of rolls) {
      checkRoll(r.k, r.faces);
      if (!Number.isInteger(r.face) || r.face < 1 || r.face > r.faces) throw new Error(`roll ${r.k}: no face ${String(r.face)} on a die of ${r.faces}`);
      if (this.#rolls.has(r.k)) throw new Error(`roll ${r.k} is recorded twice`);
      this.#rolls.set(r.k, { k: r.k, faces: r.faces, face: r.face });
    }
  }

  roll(k: number, faces: number): number {
    checkRoll(k, faces);
    this.calls += 1;
    const r = this.#rolls.get(k);
    if (r === undefined) throw new Error(`roll ${k} is not in the record`);
    if (r.faces !== faces) throw new Error(`roll ${k} was recorded on a die of ${r.faces}, asked for on a die of ${faces}`);
    this.#asked.add(k);
    return r.face;
  }

  /** The recorded roll numbers that were never asked for, in order: a replay that leaves any is not the recorded game. */
  unused(): number[] {
    return [...this.#rolls.keys()].filter(k => !this.#asked.has(k)).sort((a, b) => a - b);
  }
}

export class ThrowingDice implements Dice {
  roll(k: number): number {
    throw new Error(`a die was asked for (roll ${k}) where none may be rolled`);
  }
}

export class FixedDice implements Dice {
  private readonly faces: readonly number[];
  private next = 0;
  /** The roll numbers asked for, in order. */
  readonly asked: number[] = [];

  constructor(faces: readonly number[]) {
    this.faces = faces;
  }

  roll(k: number, faces: number): number {
    const v = this.faces[this.next % this.faces.length];
    this.next += 1;
    this.asked.push(k);
    if (v === undefined || !Number.isInteger(v) || v < 1 || v > faces) throw new Error(`FixedDice: no face ${String(v)} on a ${faces}-sided die`);
    return v;
  }
}
