/**
 * The dice exchange (PLAN ruling R7 as amended; docs/bars/M1c.md rulings 12,
 * 25, 27 and 29), and the one pure function that checks a finished game's
 * dice.
 *
 * THE EXCHANGE, STEP BY STEP
 *
 *   1. When the match is made the host draws a secret of 32 bytes from its
 *      random-bytes port and stores it. Its commitment is
 *        SHA-256( "session dice: host secret commitment, version 1\n" ++ secret )
 *      as hex: never the plain SHA-256 of the secret. Every seat is sent the
 *      commitment and the match id in its welcome, before it can contribute.
 *   2. Every seat draws a contribution of 32 bytes and sends its commitment
 *        SHA-256( "session dice: seat contribution commitment, version 1\n"
 *                 ++ "match <length>:<match id>\nseat <length>:<seat>\n" ++ contribution )
 *      A computer seat's contribution is drawn by the host, from its port,
 *      when the match is made, and its commitment stored with the match: it is
 *      stored before any reveal, like a person's.
 *   3. Only when the store call holding the last commitment has returned does
 *      the host tell every connection that the reveals may begin (a `dice`
 *      message, stage `reveal`). A reveal sent earlier is refused.
 *   4. Each seat reveals its contribution. The host checks it against the
 *      stored commitment. One that does not match stops the match from ever
 *      starting: every connection is told, naming the seat. A seat that never
 *      reveals holds the match at this step, and every command is refused with
 *      `dice_waiting`, naming the seats it waits for.
 *   5. With every contribution stored the game's key is
 *        HMAC-SHA-256 under the secret, of the text
 *          "session dice: game key, version 1\nmatch <length>:<match id>\n"
 *          then for each seat, in the scenario's seat order,
 *          "seat <length>:<seat> contribution <hex length>:<hex>\n"
 *      and play is on KeyedDice(key, match id). The host records every roll
 *      it makes (roll number, faces, face) against the action that was
 *      accepted; the rolls of an action that was refused are never recorded.
 *   6. When the match is over (by the ruleset or by a concession, even one
 *      made before the match started) the host publishes the dice record:
 *      the match id, its commitment, its secret, each seat's commitment and
 *      contribution, and every roll.
 *
 * Anyone can then call verifyDice with the record and what one seat holds:
 * the commitment and match id it was sent before it contributed, and its own
 * contribution (ruling 27). The function re-derives the key and re-rolls
 * every recorded roll; it knows nothing of the rules.
 *
 * LIMITS (ruling 29). These are stated, not fixed; no protocol with one host
 * removes them.
 *
 *   - Once every reveal is in, the host knows the game's key and so every roll
 *     to come. It can tell a player.
 *   - The host can refuse to start a match whose rolls it dislikes, by claiming
 *     that a seat failed to reveal (it holds every reveal and the store).
 *   - The reveal proves only that the dice were not changed after the
 *     commitments: that the host did not choose its secret after seeing the
 *     contributions, and that no seat chose its contribution after seeing the
 *     others'. A seat that reveals last can still decline to reveal, which
 *     stops the match (as above) but steers no roll.
 *   - The check takes no events, so it cannot tell a roll that was never made
 *     from one that was, when the record gives it its true face: a roll added
 *     at the end, or a roll whose number of faces was changed to one on which
 *     the key happens to give the same face (1 chance in that number). A seat
 *     compares the record's rolls with the faces in the events it was sent.
 *   - In one process, code that runs beside the host can read its secret and
 *     the key (kernel/dice.ts says how). A host that plays code it does not
 *     trust runs it elsewhere.
 */
import { hmacSha256Words, sha256Hex, utf8, wordsToBytes } from '../engine/core/sha256';
import { KeyedDice } from '../engine/kernel/dice';
import { hexToBytes } from '../protocol/check';
import { CONTRIBUTION_BYTES, SECRET_BYTES } from '../protocol/limits';
import type { DiceRecord } from '../protocol/messages';
import { validateDiceRecord } from '../protocol/validate';

export const HOST_COMMITMENT_LABEL = 'session dice: host secret commitment, version 1\n';
export const SEAT_COMMITMENT_LABEL = 'session dice: seat contribution commitment, version 1\n';
export const GAME_KEY_LABEL = 'session dice: game key, version 1\n';

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

function named(word: string, value: string): string {
  return `${word} ${value.length}:${value}`;
}

/** The host's commitment to its secret. */
export function hostCommitmentOf(secret: Uint8Array): string {
  return sha256Hex(concat(utf8(HOST_COMMITMENT_LABEL), secret));
}

/** A seat's commitment to its contribution, bound to the match and the seat. */
export function seatCommitmentOf(match: string, seat: string, contribution: Uint8Array): string {
  return sha256Hex(concat(utf8(`${SEAT_COMMITMENT_LABEL}${named('match', match)}\n${named('seat', seat)}\n`), contribution));
}

/** The text the game key is the HMAC of. `contributions`: [seat, hex] in seat order. */
export function gameKeyMessage(match: string, contributions: readonly (readonly [string, string])[]): string {
  let text = `${GAME_KEY_LABEL}${named('match', match)}\n`;
  for (const [seat, hex] of contributions) text += `${named('seat', seat)} ${named('contribution', hex)}\n`;
  return text;
}

/** The game's key: HMAC-SHA-256 of gameKeyMessage under the host's secret, 32 bytes. */
export function gameKeyOf(match: string, secret: Uint8Array, contributions: readonly (readonly [string, string])[]): Uint8Array {
  if (secret.length !== SECRET_BYTES) throw new Error(`a host secret is ${SECRET_BYTES} bytes, got ${secret.length}`);
  return wordsToBytes(hmacSha256Words(secret, utf8(gameKeyMessage(match, contributions))));
}

/** The dice a match is played on once every contribution is in. */
export function gameDiceOf(match: string, secret: Uint8Array, contributions: readonly (readonly [string, string])[]): KeyedDice {
  return new KeyedDice(gameKeyOf(match, secret, contributions), match);
}

/** What one seat holds to check the dice afterwards (ruling 27). A spectator holds no contribution: seat and contribution null. */
export interface HeldDice {
  /** The match id the seat was sent before it contributed. */
  readonly match: string;
  /** The host's commitment the seat was sent before it contributed. */
  readonly commitment: string;
  readonly seat: string | null;
  /** The seat's own contribution, as hex. */
  readonly contribution: string | null;
}

export type DiceVerdict =
  | { readonly honest: true }
  | {
    readonly honest: false;
    /** What does not match: the record's shape, the match id, the commitment, the secret, a contribution, or a roll. */
    readonly what: 'malformed' | 'match' | 'commitment' | 'secret' | 'contribution' | 'roll';
    /** Whose contribution, for `contribution`. */
    readonly seat: string | null;
    /** The first roll number that differs, for `roll`. */
    readonly roll: number | null;
    readonly detail: string;
  };

function dishonest(what: Exclude<DiceVerdict, { honest: true }>['what'], detail: string, seat: string | null = null, roll: number | null = null): DiceVerdict {
  return { honest: false, what, seat, roll, detail };
}

/**
 * Is a published dice record honest, as far as one seat can tell? Pure: it
 * takes the record and what the seat holds, and nothing of the rules, the
 * state or the events. The same inputs always give the same answer.
 */
export function verifyDice(record: unknown, held: HeldDice): DiceVerdict {
  const shape = validateDiceRecord(record);
  if (!shape.ok) return dishonest('malformed', shape.problems.slice(0, 3).join('; '));
  const r: DiceRecord = shape.message;
  if (r.match !== held.match) return dishonest('match', 'the record names another match than the one this seat was sent');
  if (r.commitment !== held.commitment) return dishonest('commitment', 'the record carries another commitment than the one this seat was sent before it contributed');
  const secret = hexToBytes(r.secret);
  if (hostCommitmentOf(secret) !== r.commitment) return dishonest('secret', "the published secret does not match the host's commitment");
  const rolled = r.rolls.length > 0;
  if (held.seat !== null) {
    const mine = r.seats.find(s => s.seat === held.seat);
    if (!mine) return dishonest('contribution', `the record has no entry for ${held.seat}`, held.seat);
    if (held.contribution !== null && (mine.contribution !== null || rolled) && mine.contribution !== held.contribution) {
      return dishonest('contribution', `the record does not carry ${held.seat}'s own contribution`, held.seat);
    }
  }
  for (const s of r.seats) {
    if (s.contribution === null) {
      if (rolled) return dishonest('contribution', `dice were rolled, but the record has no contribution from ${s.seat}`, s.seat);
      continue;
    }
    if (s.commitment === null || seatCommitmentOf(r.match, s.seat, hexToBytes(s.contribution)) !== s.commitment) {
      return dishonest('contribution', `${s.seat}'s contribution does not match its commitment`, s.seat);
    }
  }
  if (!rolled) return { honest: true };
  const contributions = r.seats.map(s => [s.seat, s.contribution as string] as const);
  for (const [, hex] of contributions) {
    if (hex.length !== CONTRIBUTION_BYTES * 2) return dishonest('malformed', 'a contribution is not 32 bytes');
  }
  let dice: KeyedDice;
  try {
    dice = gameDiceOf(r.match, secret, contributions);
  } catch (err) {
    return dishonest('secret', `no dice can be made from the record: ${(err as Error).message}`);
  }
  for (let i = 0; i < r.rolls.length; i++) {
    const roll = r.rolls[i] as DiceRecord['rolls'][number];
    if (roll.k !== i) return dishonest('roll', `roll ${i} is missing or out of place: the record has roll ${roll.k} there`, null, i);
    let face: number;
    try {
      face = dice.roll(roll.k, roll.faces);
    } catch (err) {
      return dishonest('roll', `roll ${i}: ${(err as Error).message}`, null, i);
    }
    if (face !== roll.face) return dishonest('roll', `roll ${i} on a die of ${roll.faces} came up ${face}, the record says ${roll.face}`, null, i);
  }
  return { honest: true };
}
