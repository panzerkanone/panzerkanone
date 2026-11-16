/**
 * The view hash a host sends with every whole view and every update, and that
 * a client checks after applying a change (rulings 7 and 8):
 *
 *   SHA-256 of the UTF-8 text
 *     "view hash, version 1\n" + viewer + "\n" + canonicalJson(view)
 *   as 64 lower-case hex digits, where viewer is "seat:" followed by the
 *   seat's name, or "spectator", and canonicalJson is engine/core/canonical.ts
 *   (keys sorted by UTF-16 code unit, no white space).
 *
 * The viewer is part of the text, so two viewers never share a hash even when
 * their views are equal, and no view hash is ever a state hash (a state hash
 * is the SHA-256 of the canonical state alone).
 */
import { canonicalJson } from '../engine/core/canonical';
import { sha256Text } from '../engine/core/sha256';

export const VIEW_HASH_LABEL = 'view hash, version 1\n';

/** The viewer as the view hash names it: "seat:<name>", or "spectator" for null. */
export function viewerLabel(seat: string | null): string {
  return seat === null ? 'spectator' : `seat:${seat}`;
}

export function viewHash(seat: string | null, view: unknown): string {
  return sha256Text(`${VIEW_HASH_LABEL}${viewerLabel(seat)}\n${canonicalJson(view)}`);
}
