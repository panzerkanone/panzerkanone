/**
 * The agent contract (research-ai section 4.0): an agent receives a view of
 * the game (never the state; new data it may do with as it likes), the list
 * of legal actions (asked of that view), and its own random stream (never the
 * dice source and never a seed; see kernel/dice.ts for what that does and
 * does not keep from an agent), and returns one of the legal actions. It holds no
 * memory between calls, so the same view, list and stream give the same
 * choice. What an agent knows of the rules (the board, the outcome
 * distribution of an attack) it is given when it is made.
 */
import type { RandomStream } from '../core/random';

export interface Agent<V, A> {
  /** The agent's id, as written in records. */
  readonly id: string;
  decide(view: V, legal: readonly A[], stream: RandomStream): A;
}
