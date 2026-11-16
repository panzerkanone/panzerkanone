/**
 * A player: an agent that plays a seat through a SeatClient, from the
 * client's view and the legal actions asked of that view, as a person at a
 * table would. It is how tests and the chaos runs play session games.
 *
 * Its random stream for a decision is keyed by the seat's own count of
 * decisions (the commands of this seat the host has accepted so far), never
 * by the match's action number (ruling 30): the same seed gives the same
 * choices however messages to and from the other seat arrive. The stream for
 * decision n draws hash(seed, 'player/<seat>/<n>', j).
 */
import { RandomStream } from '../engine/core/random';
import type { SeatClient } from './client';
import type { SeatAgent } from './computer';

export interface PlayerOptions<V, A> {
  readonly client: SeatClient;
  readonly agent: SeatAgent<V, A>;
  /** The seed of the player's streams. */
  readonly seed: number;
  /** The seat's legal actions, asked of a view. */
  readonly legal: (view: V) => readonly A[];
  /** Concede instead of deciding, when this says so for the view and the count of decisions so far. */
  readonly concedeWhen?: (view: V, decisions: number) => boolean;
}

export class Player<V, A> {
  readonly client: SeatClient;
  readonly #agent: SeatAgent<V, A>;
  readonly #seed: number;
  readonly #legal: (view: V) => readonly A[];
  readonly #concedeWhen: ((view: V, decisions: number) => boolean) | undefined;
  /** Commands chosen. */
  chosen = 0;
  conceded = false;

  constructor(opts: PlayerOptions<V, A>) {
    this.client = opts.client;
    this.#agent = opts.agent;
    this.#seed = opts.seed;
    this.#legal = opts.legal;
    this.#concedeWhen = opts.concedeWhen;
  }

  /** The seat's decisions so far: its commands the host accepted. */
  get decisions(): number {
    return this.client.acceptedCommands;
  }

  /**
   * Decide and send one command if the client is ready and the seat is due in
   * its view. True when something was sent. An agent that answers later (a
   * promise) is not for players: their answers are taken at once.
   */
  act(): boolean {
    const c = this.client;
    if (c.seat === null || !c.ready || this.conceded) return false;
    const view = c.view as V;
    const legal = this.#legal(view);
    if (legal.length === 0) return false;
    const n = this.decisions;
    if (this.#concedeWhen?.(view, n)) {
      this.conceded = true;
      c.concede();
      return true;
    }
    const choice = this.#agent.decide(view, legal, new RandomStream(this.#seed, `player/${c.seat}/${n}`));
    if (typeof (choice as { then?: unknown } | null)?.then === 'function') throw new Error('a player takes its agent\'s answer at once');
    c.command(choice);
    this.chosen += 1;
    return true;
  }
}
