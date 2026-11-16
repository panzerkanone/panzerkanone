/**
 * The Ruleset interface: everything the kernel, the agents, the simulator and
 * (later) the host and the interface ask of a set of rules. PLAN.md section 4:
 * actions in, typed events out; the ruleset answers which actions are legal,
 * what exactly an attack can do, and what a seat may see.
 *
 * A ruleset object is made for one match's static content (its data, its
 * scenario, its compiled board) and holds no game state. Game state is a
 * plain-data value of type S that the ruleset never mutates: apply returns a
 * new state. The kernel knows nothing of any ruleset's units, phases, terrain
 * or sides; it sees seats, actions, events, rejections and outcomes.
 *
 *   pending(s)                       which seats must decide now (one or more), or that the game is over
 *   view(s, viewer)                  what a seat (or a spectator, viewer null) may see
 *   legalActions(view)               every action the view's seat may take now; none for a spectator
 *   check(s, seat, action)           null when legal, else a rejection with a code from rejectionCodes
 *   apply(s, seat, action, dice)     a new state and typed events, or a rejection; never throws for a bad
 *                                    action and never mutates s
 *   reduce(s, events)                the state the events lead to: replaying events needs no dice
 *   outcomes(at, attack)             the exact outcome distribution of an attack, from a state or a view
 *   eventFor(e, viewer)              what a seat (or a spectator) sees of an event; null when hidden
 *   result(s)                        the result once the game is over, else null
 *   turn(s)                          the turn number the game is in
 *   copy(s), hash(s)                 an independent deep copy; SHA-256 of the full state
 *   invariants(s)                    every structural rule the state breaks (empty when sound)
 *   checkEvent(e)                    problems with an event against the event schema (empty when valid)
 *
 * Two sides of the table. The host holds the state: check and apply judge an
 * action against it, and nothing else may. A seat holds only its view, so
 * legal actions are asked of a view: the preview of a client, an agent and
 * the host all call the one function, and the host gets a seat's list by
 * building that seat's view first (Match.legalActions). Hidden information
 * therefore cannot shape a seat's list: what the view hides, the list cannot
 * depend on.
 *
 * Nothing handed to a seat is shared with the state: view and eventFor return
 * new data (copies), so a seat that writes into what it was given changes
 * nothing the host keeps.
 */

/** A seat: one decision-maker in a match, named by the scenario. */
export type Seat = string;

/** Every event has a type from the ruleset's closed list (eventTypes). */
export interface GameEvent {
  readonly type: string;
}

/**
 * A dice source: the face (1 to `faces`) of roll number k. Rolls are
 * numbered from 0 for the whole match; the state keeps the number of the next
 * roll. A seeded source answers hash(seed, 'dice', k) (core/random.ts).
 */
export interface Dice {
  roll(k: number, faces: number): number;
}

/** Who must decide now. */
export type Decision =
  | { readonly kind: 'decide'; readonly seats: readonly Seat[] }
  | { readonly kind: 'over' };

/** Why an action was refused. `code` is from the ruleset's closed list. */
export interface Rejection {
  readonly code: string;
  readonly detail: string;
}

export type Applied<S, E> =
  | { readonly ok: true; readonly state: S; readonly events: readonly E[] }
  | { readonly ok: false; readonly rejection: Rejection };

/** One possible result of an attack: `ways` of the `of` equally likely dice values. */
export interface Outcome {
  readonly result: string;
  readonly ways: number;
  readonly of: number;
  /** ways / of. */
  readonly p: number;
}

/** How a game ended: the winning seat (null for a draw) and why. */
export interface MatchResult {
  readonly winner: Seat | null;
  readonly reason: string;
}

/** A reference to static content: its id and content hash. */
export interface ContentRef {
  readonly id: string;
  readonly hash: string;
}

/** The rejection codes every ruleset shares (a ruleset adds its own to the closed list). */
export const KERNEL_REJECTION_CODES = [
  'unknown_seat',     // the seat is not a seat of this match
  'not_your_turn',    // the seat is not among those who must decide now
  'game_over',        // the game has ended
  'malformed',        // not an action object, a missing or unknown key, a value of the wrong type
  'unknown_action',   // the action's type is not one of this ruleset's actions
] as const;

export interface Ruleset<S, A, E extends GameEvent, V, Q> {
  /** The ruleset's id and version, and the content hash of its data. */
  readonly id: string;
  readonly version: string;
  readonly content: ContentRef;
  /** The seats of this match, in order. */
  readonly seats: readonly Seat[];
  /** The closed list of rejection codes (including KERNEL_REJECTION_CODES). */
  readonly rejectionCodes: readonly string[];
  /** The closed list of event types. */
  readonly eventTypes: readonly string[];

  /** The state a match starts in. */
  initial(): S;
  pending(s: S): Decision;
  /**
   * Every action the seat whose view this is may take now (none for a
   * spectator's view, or when the seat need not decide). It reads the view
   * alone: never the state.
   */
  legalActions(view: V): A[];
  check(s: S, seat: Seat, action: unknown): Rejection | null;
  apply(s: S, seat: Seat, action: unknown, dice: Dice): Applied<S, E>;
  reduce(s: S, events: readonly E[]): S;
  outcomes(at: S | V, attack: Q): Outcome[];
  /** What a seat (or a spectator, viewer null) may see: new data that shares no object with s. */
  view(s: S, viewer: Seat | null): V;
  /** What a seat (or a spectator) sees of an event, as a copy that shares no object with e; null when hidden. */
  eventFor(e: E, viewer: Seat | null): E | null;
  result(s: S): MatchResult | null;
  /** The turn number the game is in (for reports). */
  turn(s: S): number;
  copy(s: S): S;
  hash(s: S): string;
  invariants(s: S): string[];
  checkEvent(e: unknown): string[];
}
