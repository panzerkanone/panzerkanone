/**
 * What a computer seat's agent is (ruling 10). The host asks it for one
 * action at a time, from the seat's view, the legal actions asked of that
 * view, and the seat's own random stream; never the state, the match, the
 * host, the store, a dice source, a key or a seed. It may answer at once or
 * later (a promise); the host never waits for it, and an answer that comes
 * after the position moved on is dropped.
 *
 * An engine Agent (engine/ai/agent.ts) is a SeatAgent as it is.
 *
 * The stream for a seat's n-th decision (n counting from 0, the seat's
 * accepted actions so far) draws hash(agentSeed, 'computer/seat<i>/<n>', j)
 * (engine/core/random.ts), i being the seat's index. It is keyed by the
 * seat's own count of decisions, never by the match's action number (ruling
 * 30), and the agent seed is drawn from the host's random-bytes port when the
 * match is made and kept in the store.
 */
import { RandomStream } from '../engine/core/random';

export interface SeatAgent<V, A> {
  /** The agent's id, as records name it: lower-case letters, digits, _ and -. */
  readonly id: string;
  decide(view: V, legal: readonly A[], stream: RandomStream): A | PromiseLike<A>;
}

/** The stream a computer seat's agent is handed for the seat's n-th decision. */
export function computerStream(agentSeed: number, seatIndex: number, decision: number): RandomStream {
  return new RandomStream(agentSeed, `computer/seat${seatIndex}/${decision}`);
}

/** How many answers a computer seat may give at one position before the host stops asking until the position moves. */
export const COMPUTER_TRIES = 3;
