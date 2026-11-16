/**
 * A seat held by a link: what a game played by shared links (worker/, client/src/net/) adds to
 * the claim of the session core, and nothing more. The host is unchanged by it.
 *
 * Each seat of such a game has a link key: 16 random bytes that the player who makes the game
 * draws, one for each seat, and that travel only in the seat's link (never to the server). From
 * it the seat's client derives, the same way every time, whatever it draws from its random-bytes
 * port (SeatClient draws its claim key, then its dice contribution):
 *
 *   claim key      HMAC-SHA-256(link key, CLAIM_LABEL), its first 16 bytes
 *   contribution   HMAC-SHA-256(link key, CONTRIBUTION_LABEL), 32 bytes
 *
 * So the same link opened again, on another day or another machine, claims the same seat again
 * (a repeat of a claim with the same key gets the same welcome and token) and reveals the
 * contribution it committed to, however many times the page was reloaded between the commitment
 * and the reveal. The server is told, when the game is made, only each seat's invitation check
 *
 *   check          SHA-256(INVITE_LABEL + the claim key as 32 lower-case hex digits), as hex
 *
 * and lets a claim through only when its key gives the seat's check. It learns a claim key when
 * the seat is first claimed, and from it cannot work out the contribution (that would need the
 * link key), so ruling R7 holds as it does for any seat: the host's secret is fixed and committed
 * before any contribution is known to it. The player who made the game knows both link keys, and
 * so both contributions; without the host's secret that tells him nothing of the rolls.
 */
import { hmacSha256Words, sha256Hex, utf8, wordsToBytes } from '../engine/core/sha256';
import { bytesToHex } from '../protocol/check';
import { CLAIM_KEY_BYTES, CONTRIBUTION_BYTES } from '../protocol/limits';
import type { RandomBytes } from './ports';

export const LINK_KEY_BYTES = 16;
export const CLAIM_LABEL = 'panzerkanone link: claim key, version 1\n';
export const CONTRIBUTION_LABEL = 'panzerkanone link: dice contribution, version 1\n';
export const INVITE_LABEL = 'panzerkanone link: invitation check, version 1\n';

function keyed(linkKey: Uint8Array, label: string): Uint8Array {
  if (!(linkKey instanceof Uint8Array) || linkKey.length !== LINK_KEY_BYTES) throw new Error(`a link key is ${LINK_KEY_BYTES} bytes`);
  return wordsToBytes(hmacSha256Words(linkKey, utf8(label)));
}

/** The claim key a seat's link gives: 16 bytes. */
export function claimKeyOf(linkKey: Uint8Array): Uint8Array {
  return keyed(linkKey, CLAIM_LABEL).slice(0, CLAIM_KEY_BYTES);
}

/** The dice contribution a seat's link gives: 32 bytes. */
export function contributionOf(linkKey: Uint8Array): Uint8Array {
  return keyed(linkKey, CONTRIBUTION_LABEL).slice(0, CONTRIBUTION_BYTES);
}

/** The invitation check of a claim key given as hex (the claim message's `key`): what the server keeps for a seat. */
export function inviteCheckOf(claimKeyHex: string): string {
  return sha256Hex(utf8(`${INVITE_LABEL}${claimKeyHex}`));
}

/** The invitation check of a seat's link key. */
export function inviteCheckOfLink(linkKey: Uint8Array): string {
  return inviteCheckOf(bytesToHex(claimKeyOf(linkKey)));
}

/**
 * The random-bytes port of a seat client playing by a link: the claim key, then the contribution,
 * then nothing (a seat client draws those two, in that order, when it is made, and no more).
 */
export class LinkBytes implements RandomBytes {
  readonly #stream: Uint8Array;
  #at = 0;

  constructor(linkKey: Uint8Array) {
    const claim = claimKeyOf(linkKey);
    const contribution = contributionOf(linkKey);
    this.#stream = new Uint8Array(claim.length + contribution.length);
    this.#stream.set(claim, 0);
    this.#stream.set(contribution, claim.length);
  }

  bytes(n: number): Uint8Array {
    if (!Number.isInteger(n) || n < 0 || this.#at + n > this.#stream.length) {
      throw new Error(`a link gives ${this.#stream.length} bytes in all (its claim key and its contribution); ${n} more were asked for after ${this.#at}`);
    }
    const out = this.#stream.slice(this.#at, this.#at + n);
    this.#at += n;
    return out;
  }
}
