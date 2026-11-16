/**
 * The closed lists of the protocol: why a message is refused, and why a
 * connection is closed. A rejection a host sends carries one of
 * PROTOCOL_REJECTION_CODES or one of the match ruleset's own
 * `rejectionCodes` (the codes `Match.submit` gives). Some names appear in
 * both lists (`game_over`, `not_your_turn`, `unknown_seat`): they mean the
 * same thing.
 */

export const PROTOCOL_REJECTION_CODES = [
  // The first three steps of the pipeline. Each counts against the connection's invalid-message budget.
  'too_large',          // over MAX_MESSAGE_BYTES in UTF-8, refused before parsing
  'not_json',           // not JSON text
  'invalid',            // JSON, but not a message of the protocol (the detail names each problem and its place)
  // The budget.
  'budget_spent',       // a well-formed message on a connection that has spent its invalid-message budget
  // Who is sending.
  'not_joined',         // the connection has not joined (claim, resume or watch) and the message needs it
  'already_joined',     // a claim, resume or watch on a connection that has already joined
  'spectator',          // a spectator may only ask for its view
  'replaced',           // the seat was taken over by a newer connection; this one is dead
  // Joining.
  'protocol_version',   // the hello names another protocol version
  'wrong_match',        // the hello names another match
  'content_mismatch',   // the client holds other content: the detail names it and both hashes
  'unknown_seat',       // no seat of this match has that name
  'seat_taken',         // the seat is already claimed
  'computer_seat',      // the seat is played by the host's computer
  'bad_token',          // no seat has that token
  // The dice exchange (ruling 12).
  'dice_waiting',       // the match has not started: the detail names the seats it waits for and for what
  'dice_failed',        // the match will not start: a seat's reveal did not match its commitment
  'dice_not_ready',     // a reveal sent before every commitment was stored
  'dice_wrong_stage',   // a dice message the exchange is not at (a commitment during the reveals, anything once play began)
  'already_committed',  // a second, different commitment from a seat
  'already_revealed',   // a second, different reveal from a seat
  // The match.
  'not_your_turn',      // the seat is not due to decide
  'game_over',          // the match is over
  'stale',              // the command's sequence number is not the host's (checked while one seat is due)
  // The host.
  'internal_error',     // the host failed while judging the message; nothing changed; the fault is in its list
  'store_failed',       // the store refused to commit; nothing changed; sending again is safe
  'host_closed',        // this host was closed or replaced by one rebuilt from the same store
] as const;

export type ProtocolRejectionCode = (typeof PROTOCOL_REJECTION_CODES)[number];

/** The rejection codes of a message refused at size, parse or validation: these count against the budget. */
export const INVALID_CODES: readonly ProtocolRejectionCode[] = ['too_large', 'not_json', 'invalid'];

/** Rejections that are not remembered for a repeated id: the cause is the host's, and sending again may succeed. */
export const PASSING_CODES: readonly ProtocolRejectionCode[] = ['internal_error', 'store_failed', 'host_closed'];

/** Why a host closes a connection. The connection is sent a `closed` message with the reason first. */
export const CLOSE_REASONS = [
  'invalid_budget',     // the connection spent its invalid-message budget (ruling 18)
  'replaced',           // a newer connection resumed the same seat (ruling 4)
  'update_failed',      // the host could not project or send this connection's update (ruling 20): rejoin
  'host_closed',        // the host is shutting down
] as const;

export type CloseReason = (typeof CLOSE_REASONS)[number];

/** Why a match will not start (ruling 12). */
export const DICE_FAILURES = ['reveal_mismatch'] as const;
export type DiceFailure = (typeof DICE_FAILURES)[number];

/** Every code a rejection may carry, given the ruleset's own list. */
export function rejectionCodesWith(rulesetCodes: readonly string[]): string[] {
  const out: string[] = [...PROTOCOL_REJECTION_CODES];
  for (const c of rulesetCodes) if (!out.includes(c)) out.push(c);
  return out;
}
