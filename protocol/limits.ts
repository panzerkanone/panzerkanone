/**
 * The protocol's fixed numbers. Every limit a host or a client applies is
 * named here, once (docs/bars/M1c.md, rulings 4, 15, 18 and 19).
 */

/** The protocol's version: a hello naming another is refused (`protocol_version`). */
export const PROTOCOL_VERSION = 1;

/** The largest message, in UTF-8 bytes, counted before the text is parsed (ruling 19). */
export const MAX_MESSAGE_BYTES = 16 * 1024;

/**
 * How many messages refused at size, parse or validation one connection may
 * send (ruling 18). The connection that reaches it is closed with the reason
 * `invalid_budget`; a well-formed message it sends afterwards is refused with
 * `budget_spent`. Rejoining starts a new budget.
 */
export const INVALID_MESSAGE_BUDGET = 8;

/**
 * A client that rejoins (or asks for its view) naming the last sequence
 * number it applied is sent the events of the actions after it, when no more
 * than this many actions have passed; otherwise the events are left out and
 * the answer says so (ruling 15).
 */
export const REJOIN_EVENT_LIMIT = 64;

/** A seat token: 16 random bytes from the host's random-bytes port, written as 32 lower-case hex digits (ruling 4). */
export const TOKEN_BYTES = 16;

/** A claim key: 16 random bytes a client draws to make its claim repeatable (see the README, "claim"). */
export const CLAIM_KEY_BYTES = 16;

/** The host's dice secret: 32 random bytes (ruling 12). */
export const SECRET_BYTES = 32;

/** A seat's dice contribution: 32 random bytes (ruling 12). */
export const CONTRIBUTION_BYTES = 32;

/** A command id: 1 to this many characters of [A-Za-z0-9._:-]. */
export const MAX_ID_LENGTH = 64;

/** A seat name as a message carries it: 1 to this many characters. */
export const MAX_SEAT_LENGTH = 64;

/** The deepest an action may nest (lists and mappings inside it). */
export const MAX_ACTION_DEPTH = 32;

/** A match id: 1 to 128 characters of [A-Za-z0-9._:-], so that it has one spelling and one encoding. */
export const MATCH_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

/** A command id. */
export const ID_PATTERN = /^[A-Za-z0-9._:-]+$/;

/**
 * The length of a text in UTF-8 bytes, as engine/core/sha256.ts encodes it (a
 * lone surrogate is 3 bytes, the length of U+FFFD). Counting stops as soon as
 * it passes `stopAfter`, so a huge text costs no more than a small one.
 */
export function utf8Length(text: string, stopAfter: number = Number.MAX_SAFE_INTEGER): number {
  let n = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length) {
      const d = text.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) {
        n += 4;
        i++;
      } else {
        n += 3;
      }
    } else n += 3;
    if (n > stopAfter) return n;
  }
  return n;
}

/** True when a text is longer than MAX_MESSAGE_BYTES in UTF-8. */
export function tooLarge(text: string): boolean {
  // Every UTF-16 unit is at least one byte, so a text longer than the limit in units is over it.
  if (text.length > MAX_MESSAGE_BYTES) return true;
  return utf8Length(text, MAX_MESSAGE_BYTES) > MAX_MESSAGE_BYTES;
}
