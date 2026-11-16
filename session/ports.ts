/**
 * The ports: everything a host needs from outside, handed to it (ruling 2).
 * A host never asks the platform for anything. Tests hand it seeded bytes, a
 * memory store and outboxes that queue; a real host hands it the platform's
 * cryptographic source, a database and sockets.
 *
 *   Store          the match's stored JSON text: read whole when a host is built, written one commit at a time
 *   RandomBytes    random bytes: the dice secret, seat tokens, a computer seat's contribution and stream seed
 *   Outbox         one per connection: the host's messages to it, as JSON text, and closing it
 *   HostContent    the ruleset, scenario and map the match is played on, handed in when the host is
 *                  made and again whenever it is rebuilt (ruling 23)
 */
import type { CloseReason } from '../protocol/codes';
import type { RecordContent } from '../engine/kernel/record';
import type { GameEvent, Ruleset } from '../engine/kernel/ruleset';

/** One key of the store and its new JSON text. */
export interface StoreWrite {
  readonly key: string;
  readonly text: string;
}

/**
 * The store. It holds JSON text under keys and nothing else (ruling 6).
 *
 *   load()          every key and its text (empty for a new match)
 *   commit(writes)  write every key given, all or none, then return; throws when it cannot
 *
 * A host makes exactly one commit call for each message that changes what is
 * stored, and none for any other message, and sends nothing about it until
 * the call has returned. The interface is synchronous: a store that answers
 * later (a promise) is not supported in this milestone.
 */
export interface Store {
  load(): Readonly<Record<string, string>>;
  commit(writes: readonly StoreWrite[]): void;
}

/** A source of random bytes: n bytes, fresh each call. */
export interface RandomBytes {
  bytes(n: number): Uint8Array;
}

/** A connection's outbox. `send` takes one message as JSON text; `close` ends the connection after what was sent. */
export interface Outbox {
  send(text: string): void;
  close(reason: CloseReason): void;
}

/** A match's content: the ruleset (built for its scenario and map) and the three pins. */
export interface HostContent<S, A, E extends GameEvent, V, Q> {
  readonly ruleset: Ruleset<S, A, E, V, Q>;
  readonly refs: { readonly ruleset: RecordContent; readonly scenario: RecordContent; readonly map: RecordContent };
}
