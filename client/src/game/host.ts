/**
 * A host in the page: a kernel Match on any ruleset, with seeded dice. It
 * backs one port per seat and one for a spectator (port.ts) and lets the
 * computer's seats act, one action each time it is asked (advance), so that
 * whoever shows the game sets the pace. local.ts makes one for the reference
 * ruleset, local-impulse.ts one for Formation Impulse.
 *
 * Seeds (engine/core/random.ts, hashes only; the platform's random function
 * is never used): the dice roll from the game's seed; each seat's agent has a
 * seed of its own derived from it (agentSeedsOf of engine/sim/runner.ts). A
 * computer seat's n-th decision draws from the stream
 * 'computer/seat<i>/<n>', keyed by the seat's own count of accepted actions
 * as the session host keys it.
 *
 * The host holds the state; a port hands out only what the ruleset's view and
 * eventFor give that seat, as new plain data.
 *
 * A game kept in the browser (keep.ts) is brought back by `restore`: every
 * action of its log applied again, in order, on a new match with the same
 * seeded dice. The dice are a function of the seed and the roll's number
 * alone, and the state keeps the number of the next roll, so the same actions
 * from the same start ask for the same rolls and get the same faces: the
 * state after the last is the kept game's, its hash included. Each seat's
 * count of accepted actions is then set from the log, so a computer seat's
 * next decision draws from the stream it would have drawn from had the game
 * never stopped (its agent keeps nothing between decisions: the planner
 * thinks the whole turn through again at each one).
 */
import { RandomStream } from '../../../engine/core/random';
import type { Agent } from '../../../engine/ai/agent';
import { SeededDice } from '../../../engine/kernel/dice';
import { Match, plainCopy } from '../../../engine/kernel/match';
import type { RecordContent } from '../../../engine/kernel/record';
import type { GameEvent, Ruleset } from '../../../engine/kernel/ruleset';
import { agentSeedsOf } from '../../../engine/sim/runner';
import type { Answer, PortOutcome, SeatPort, Seen, Update } from './port';

export type Player = 'person' | 'computer';

/** The content a match is played on, as a record pins it: each file's id, content hash and name. */
export interface ContentRefs {
  readonly ruleset: RecordContent;
  readonly scenario: RecordContent;
  readonly map: RecordContent;
}

/** One accepted action as a kept game holds it: the seat that took it, and the action. */
export type Move = readonly [seat: string, action: unknown];

/** What came of `restore`: the game as it was, or the first action that would not replay, or a state that is not the kept one. */
export type Restore = { readonly ok: true } | { readonly ok: false; readonly at: number; readonly why: string };

/** A seed from the address: a whole number from 0 to 4294967295, or the default 1. */
export function seedFrom(text: string | null): number {
  if (text === null || !/^\d{1,10}$/.test(text)) return 1;
  const n = Number(text);
  return n <= 0xffffffff ? n : 1;
}

/**
 * Who plays, from the address's `sides=`: 'human' (or 'hotseat') both people,
 * 'computer' (or 'watch') both the computer, 'second' the person plays the
 * second side; anything else, the person plays the first side.
 */
export function playersFrom(text: string | null, seats: number): Player[] {
  const all = (p: Player): Player[] => Array.from({ length: seats }, () => p);
  if (text === 'human' || text === 'hotseat') return all('person');
  if (text === 'computer' || text === 'watch') return all('computer');
  const person = text === 'second' ? 1 : 0;
  return Array.from({ length: seats }, (_, i) => (i === person ? 'person' : 'computer'));
}

class HostPort<S, A, E extends GameEvent, V, Q> implements SeatPort<V, A, E, Q> {
  readonly seat: string | null;
  readonly history: Update<V, E>[] = [];
  private readonly host: MatchHost<S, A, E, V, Q>;
  private readonly handlers = new Set<(u: Update<V, E>) => void>();

  constructor(host: MatchHost<S, A, E, V, Q>, seat: string | null) {
    this.host = host;
    this.seat = seat;
  }

  seq(): number {
    return this.host.match.log.length;
  }

  view(): V {
    return this.host.match.view(this.seat);
  }

  legal(): readonly A[] {
    return this.seat === null ? [] : this.host.match.legalActions(this.seat);
  }

  outcomes(query: Q): readonly PortOutcome[] {
    // Asked of the seat's view, as a seat far from the host would ask it.
    return this.host.ruleset.outcomes(this.view(), query).map(o => ({ result: o.result, ways: o.ways, of: o.of, p: o.p }));
  }

  submit(action: A): Promise<Answer> {
    if (this.seat === null) return Promise.resolve({ ok: false, code: 'unknown_seat', detail: 'a spectator has no seat' });
    return Promise.resolve(this.host.submit(this.seat, action));
  }

  updates(from: number, handler: (u: Update<V, E>) => void): () => void {
    for (const u of this.history.slice()) if (u.seq >= from) handler(u);
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  setUpAdvice(deal: number): readonly A[] {
    return this.seat === null ? [] : this.host.advice(this.seat, deal);
  }

  /** The host's: one more update for this seat. */
  push(u: Update<V, E>): void {
    this.history.push(u);
    for (const h of [...this.handlers]) h(u);
  }
}

export interface HostOptions<S, A, E extends GameEvent, V, Q> {
  readonly ruleset: Ruleset<S, A, E, V, Q>;
  /** The game's seed: a whole number from 0 to 4294967295. */
  readonly seed: number;
  /** Who plays each seat, in order of play. */
  readonly players: readonly Player[];
  /** The agent of each seat, in order of play (asked only for a seat the computer plays, and for set-up advice). */
  readonly agents: readonly Agent<V, A>[];
  /** The content the match is played on (what a kept game is checked against); null when the host was not told. */
  readonly refs?: ContentRefs;
}

export class MatchHost<S, A, E extends GameEvent, V, Q> {
  readonly ruleset: Ruleset<S, A, E, V, Q>;
  readonly seed: number;
  readonly players: readonly Player[];
  /** The content the match is played on, as a record pins it; null when the host was not told. */
  readonly refs: ContentRefs | null;
  /** Actions of a computer seat that the host refused (none, unless an agent is broken). */
  readonly problems: string[] = [];
  protected readonly agents: readonly Agent<V, A>[];
  protected readonly agentSeeds: readonly number[];
  private readonly decisions: number[];
  private readonly ports: readonly HostPort<S, A, E, V, Q>[];
  private current: Match<S, A, E, V, Q>;
  private readonly heard = new Set<(seat: string, action: unknown, seq: number) => void>();

  constructor(opts: HostOptions<S, A, E, V, Q>) {
    this.ruleset = opts.ruleset;
    const seats = this.ruleset.seats;
    if (opts.players.length !== seats.length) throw new Error(`${seats.length} seats need ${seats.length} players, got ${opts.players.length}`);
    if (opts.agents.length !== seats.length) throw new Error(`${seats.length} seats need ${seats.length} agents, got ${opts.agents.length}`);
    this.seed = opts.seed;
    this.players = opts.players.slice();
    this.refs = opts.refs ?? null;
    this.current = new Match(this.ruleset, new SeededDice(opts.seed));
    this.agentSeeds = agentSeedsOf(opts.seed, opts.seed, seats.length);
    this.agents = opts.agents.slice();
    this.decisions = seats.map(() => 0);
    this.ports = [...seats.map(s => new HostPort(this, s)), new HostPort(this, null)];
  }

  /** The match itself: the host's own. Nothing outside the hosts' files and the tests reads it. */
  get match(): Match<S, A, E, V, Q> {
    return this.current;
  }

  /** The hash of the state now. */
  get hash(): string {
    return this.current.hash;
  }

  /** The turn the game is in. */
  turn(): number {
    return this.ruleset.turn(this.current.state);
  }

  /** True when the game is over. */
  over(): boolean {
    return this.current.pending().kind === 'over';
  }

  /** Every accepted action so far, in order: the seat that took it and the action (copies). */
  moves(): Move[] {
    return this.current.log.map((e): Move => [e.seat, plainCopy(e.action)]);
  }

  /**
   * Hear every accepted action (the seat, the action as the match logged it, and its seq), once every port has been
   * told of it. Returns a function that stops it.
   */
  onAccepted(f: (seat: string, action: unknown, seq: number) => void): () => void {
    this.heard.add(f);
    return () => {
      this.heard.delete(f);
    };
  }

  /**
   * Bring back a game from its kept log (keep.ts): every move applied again, in order, on a new match with the same
   * seeded dice. When every one is accepted, and the state hash after the last is `hash` (when it is given), the new
   * match takes the place of the one in hand and each seat's count of decisions is set from the log; no port is told
   * anything (the game shown starts from the position as it stands). Otherwise nothing here changes, and the answer
   * says which move would not replay (counted from 1), or that the state is not the kept one. Only for a host on
   * which nothing has been played yet, before anything listens to its ports.
   */
  restore(moves: readonly Move[], hash?: string): Restore {
    if (this.current.log.length > 0) return { ok: false, at: 0, why: 'the game has begun here already' };
    const match = new Match(this.ruleset, new SeededDice(this.seed));
    const counts = this.ruleset.seats.map(() => 0);
    for (let k = 0; k < moves.length; k++) {
      const [seat, action] = moves[k] as Move;
      let res: ReturnType<typeof match.submit>;
      try {
        res = match.submit(seat, action);
      } catch (err) {
        return { ok: false, at: k + 1, why: `it failed: ${err instanceof Error ? err.message : String(err)}` };
      }
      if (!res.ok) return { ok: false, at: k + 1, why: `${res.rejection.code}: ${res.rejection.detail}` };
      const i = this.ruleset.seats.indexOf(seat);
      counts[i] = (counts[i] ?? 0) + 1;
    }
    if (hash !== undefined && match.hash !== hash) return { ok: false, at: moves.length, why: `the state after it is not the kept one (hash ${match.hash}, kept ${hash})` };
    this.current = match;
    counts.forEach((n, i) => {
      this.decisions[i] = n;
    });
    return { ok: true };
  }

  /** A seat's port, or the spectator's (null). */
  port(seat: string | null): SeatPort<V, A, E, Q> {
    const p = this.ports.find(x => x.seat === seat);
    if (!p) throw new Error(`'${String(seat)}' is not a seat of this match`);
    return p;
  }

  /** Apply one action of one seat and tell every port what its seat may see of it. */
  submit(seat: string, action: unknown): Answer {
    const before = this.match.state;
    const res = this.match.submit(seat, action);
    if (!res.ok) return { ok: false, code: res.rejection.code, detail: res.rejection.detail };
    const i = this.ruleset.seats.indexOf(seat);
    this.decisions[i] = (this.decisions[i] ?? 0) + 1;
    const seq = this.match.log.length;
    // The state after each event, once; then each port's view of it.
    const states: S[] = [];
    let s = before;
    for (const e of res.events) {
      s = this.ruleset.reduce(s, [e]);
      states.push(s);
    }
    for (const port of this.ports) {
      const seen: Seen<V, E>[] = [];
      res.events.forEach((e, k) => {
        const shown = this.ruleset.eventFor(e, port.seat);
        if (shown !== null) seen.push({ event: shown, view: this.ruleset.view(states[k] as S, port.seat) });
      });
      port.push({ seq, events: seen, view: this.ruleset.view(res.state, port.seat) });
    }
    const logged = this.match.log[seq - 1];
    for (const f of [...this.heard]) f(seat, logged ? logged.action : action, seq);
    return { ok: true, seq };
  }

  /** True when a computer seat must decide now. */
  computerDue(): boolean {
    return this.dueSeat() !== null;
  }

  private dueSeat(): string | null {
    const d = this.match.pending();
    if (d.kind === 'over') return null;
    for (const seat of d.seats) {
      if (this.players[this.ruleset.seats.indexOf(seat)] === 'computer') return seat;
    }
    return null;
  }

  /** Let one computer seat that must decide take one action. False when none must. */
  advance(): boolean {
    const seat = this.dueSeat();
    if (seat === null) return false;
    const i = this.ruleset.seats.indexOf(seat);
    const view = this.match.view(seat);
    const legal = this.ruleset.legalActions(view);
    if (legal.length === 0) return false;
    const stream = new RandomStream(this.agentSeeds[i] as number, `computer/seat${i}/${this.decisions[i] ?? 0}`);
    const chosen = (this.agents[i] as Agent<V, A>).decide(view, legal, stream);
    const answer = this.submit(seat, chosen);
    if (answer.ok) return true;
    // An agent's illegal choice is the agent's bug: say so and take a listed action instead, as the simulator does.
    this.problems.push(`${seat}'s agent chose an illegal action (${answer.code}: ${answer.detail})`);
    const fresh = this.match.legalActions(seat);
    const fallback = fresh[fresh.length - 1];
    return fallback !== undefined && this.submit(seat, fallback).ok;
  }

  /**
   * The set-up a seat's adviser would make from where the seat stands, as the
   * actions to submit in order; none here (a ruleset whose host has an adviser
   * says so in its own file).
   */
  advice(_seat: string, _deal: number): A[] {
    return [];
  }
}
