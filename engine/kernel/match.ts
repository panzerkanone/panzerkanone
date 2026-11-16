/**
 * A match: one ruleset, one dice source, the current state, and the log of
 * every accepted action with the events it produced and the state hash after
 * it. Everything a record, a replay, a save file or a view needs comes from
 * this log.
 *
 *   const m = new Match(ruleset, new SeededDice(seed));
 *   m.pending()                    // who must decide now
 *   m.view(seat)                   // what a seat sees (null: a spectator)
 *   m.legalActions(seat)           // the seat's legal actions, asked of its view
 *   m.submit(seat, action)         // { ok, state, events } or { ok: false, rejection }
 *   m.end({ winner, reason })      // end the match with a stated result (a session
 *                                  // matter, e.g. a concession: PLAN 11, ruling 10)
 *
 * The match is the host's. What a seat may be handed is a view, its legal
 * actions and the events it sees (eventsSeenBy), each new data that shares no
 * object with the state or the log. The state itself (m.state), the log and
 * the dice source stay with the host. The dice seed lives in the dice source,
 * never in the state, so no view and no event can carry it. (Events do carry
 * the faces that were rolled. Whether those give away the rolls to come
 * depends on the dice source: see dice.ts.)
 */
import type { Applied, Decision, Dice, GameEvent, MatchResult, Rejection, Ruleset, Seat } from './ruleset';

export interface LoggedAction<E extends GameEvent> {
  readonly seq: number;
  readonly seat: Seat;
  readonly action: unknown;
  readonly events: readonly E[];
  /** The state hash after this action. */
  readonly hash: string;
}

export class Match<S, A, E extends GameEvent, V, Q> {
  readonly ruleset: Ruleset<S, A, E, V, Q>;
  /** The host's dice, in a private member: whoever holds a dice source can ask it for rolls to come. */
  readonly #dice: Dice;
  readonly initialHash: string;
  readonly log: LoggedAction<E>[] = [];
  private current: S;
  private stated: MatchResult | null = null;

  /** Start a match at the ruleset's initial state, or at `start` (whose game began at `initialHash`). */
  constructor(ruleset: Ruleset<S, A, E, V, Q>, dice: Dice, start?: S, initialHash?: string) {
    this.ruleset = ruleset;
    this.#dice = dice;
    this.current = start ?? ruleset.initial();
    this.initialHash = initialHash ?? ruleset.hash(this.current);
  }

  /** The current state: the host's own, never to be handed to a seat (hand it view(seat)). */
  get state(): S {
    return this.current;
  }

  /** What a viewer (a seat, or null for a spectator) sees now: new data, sharing nothing with the state. */
  view(viewer: Seat | null): V {
    return this.ruleset.view(this.current, viewer);
  }

  /** A seat's legal actions now, asked of the seat's view as a client or an agent would ask them. */
  legalActions(seat: Seat): A[] {
    return this.ruleset.legalActions(this.ruleset.view(this.current, seat));
  }

  /** The hash of the current state. */
  get hash(): string {
    const last = this.log[this.log.length - 1];
    return last ? last.hash : this.initialHash;
  }

  /** A result stated by end(), if any. */
  get statedEnd(): MatchResult | null {
    return this.stated;
  }

  pending(): Decision {
    if (this.stated) return { kind: 'over' };
    return this.ruleset.pending(this.current);
  }

  /** The result: a stated end, else the ruleset's result once the game is over, else null. */
  result(): MatchResult | null {
    return this.stated ?? this.ruleset.result(this.current);
  }

  /** Validate and apply one action of one seat. Never throws for a bad action. */
  submit(seat: Seat, action: unknown): Applied<S, E> {
    if (this.stated) {
      const rejection: Rejection = { code: 'game_over', detail: `the match was ended: ${this.stated.reason}` };
      return { ok: false, rejection };
    }
    const res = this.ruleset.apply(this.current, seat, action, this.#dice);
    if (!res.ok) return res;
    // The whole log entry is made before the state moves: if the hash or the copy fails, the
    // match is exactly as it was. The log keeps its own copy of the action: the caller's object
    // stays the caller's.
    const entry: LoggedAction<E> = { seq: this.log.length + 1, seat, action: plainCopy(action), events: res.events, hash: this.ruleset.hash(res.state) };
    this.current = res.state;
    this.log.push(entry);
    return res;
  }

  /**
   * A copy of this match, at the same state with the same log, that rolls from
   * another dice source. Nothing else differs: this is how a test changes only
   * the dice seed.
   */
  fork(dice: Dice): Match<S, A, E, V, Q> {
    const m = new Match(this.ruleset, dice, this.current, this.initialHash);
    m.log.push(...this.log);
    m.stated = this.stated;
    return m;
  }

  /** End the match with a stated result. Later submissions are refused with 'game_over'. */
  end(result: MatchResult): void {
    if (result.winner !== null && !this.ruleset.seats.includes(result.winner)) {
      throw new Error(`end: '${result.winner}' is not a seat of this match`);
    }
    this.stated = result;
  }

  /** The events a viewer (a seat, or null for a spectator) has seen so far, in order: copies, as eventFor gives them. */
  eventsSeenBy(viewer: Seat | null): E[] {
    const out: E[] = [];
    for (const entry of this.log) {
      for (const e of entry.events) {
        const seen = this.ruleset.eventFor(e, viewer);
        if (seen !== null) out.push(seen);
      }
    }
    return out;
  }
}

/** A deep copy of plain data (mappings, lists, numbers, strings, booleans, null). */
export function plainCopy(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(plainCopy);
  if (typeof v === 'object' && v !== null) {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v)) {
      // defineProperty, so that a key named __proto__ stays a key and never sets the prototype.
      Object.defineProperty(out, k, { value: plainCopy((v as Record<string, unknown>)[k]), enumerable: true, writable: true, configurable: true });
    }
    return out;
  }
  return v;
}
