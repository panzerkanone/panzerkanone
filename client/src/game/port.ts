/**
 * A seat's port to a game in progress: the only thing the interface knows of
 * one. Whatever backs it (the local host of local.ts today; the session host
 * in a worker or over a socket later) gives a seat exactly this and no more:
 *
 *   view()             the seat's view now
 *   legal()            every action the seat may take now, asked of that view
 *   outcomes(query)    the exact outcome distribution of an attack it is considering
 *   submit(action)     accepted (and the number of the action it became) or the rejection's code
 *   updates(from, h)   the stream of what the seat may see: one update for each accepted action
 *                      of any seat, in order, with that action's events as this seat sees them
 *                      (the ruleset's eventFor: its own and the other side's) and the seat's
 *                      view after each
 *   setUpAdvice(deal)  optional: a whole set-up the seat's adviser would make
 *
 * Only plain data crosses it (views, actions, events, outcome lists, numbers,
 * strings): nothing here is a function of the host's, a state or a dice
 * source. The four types are the ruleset's own and stay opaque to everything
 * but a reading (reading.ts).
 *
 * What a remote host supplies and what the page works out itself is in
 * docs/review/M5/game-layer-handover.md, "A worker or socket host".
 */

/** One possible result of an attack: `ways` of the `of` equally likely dice values (the kernel's Outcome, as plain data). */
export interface PortOutcome {
  readonly result: string;
  readonly ways: number;
  readonly of: number;
  readonly p: number;
}

/** The answer to a submitted action. */
export type Answer =
  | { readonly ok: true; readonly seq: number }
  | { readonly ok: false; readonly code: string; readonly detail: string };

/** One event as the seat sees it, and the seat's view just after it. */
export interface Seen<V, E> {
  readonly event: E;
  readonly view: V;
}

/**
 * What one accepted action showed the seat. `seq` counts the match's accepted
 * actions from 1 with no gaps. `events` is empty when the seat may see none of
 * them (the other side's hidden set-up); `view` is the seat's view after the
 * whole action.
 */
export interface Update<V, E> {
  readonly seq: number;
  readonly events: readonly Seen<V, E>[];
  readonly view: V;
}

export interface SeatPort<V, A, E, Q> {
  /** The seat this port is for; null for a spectator, who has no legal action. */
  readonly seat: string | null;
  /** The number of the last accepted action (0 before the first). */
  seq(): number;
  /** The seat's view now: new plain data each call. */
  view(): V;
  /** Every action the seat may take now. */
  legal(): readonly A[];
  /** The exact outcome distribution of an attack. */
  outcomes(query: Q): readonly PortOutcome[];
  /** Offer one action. Never throws for a refused action: the answer says why. */
  submit(action: A): Promise<Answer>;
  /**
   * Every update numbered `from` or later, in order: those already made at
   * once, the rest as they happen. Returns a function that stops it. An
   * action's update may reach the handler before or after its submit answers.
   */
  updates(from: number, handler: (update: Update<V, E>) => void): () => void;
  /**
   * The set-up the seat's adviser would make from where the seat stands, as
   * the actions to submit in order. `deal` picks one of many (0, 1, 2, ...);
   * the same deal gives the same set-up. Absent when the host has no adviser.
   */
  setUpAdvice?(deal: number): readonly A[];
}
