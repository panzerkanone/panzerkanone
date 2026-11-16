/**
 * The headless simulator: plays one game between agents and returns its
 * record and a one-line summary. Deterministic: the same content, seeds and
 * agents give the same record, byte for byte, in every run.
 *
 * Seeds. A game has a seed. The dice seed is the game's seed unless set apart
 * (which is how a test changes only the dice). Each seat's agent has a seed of
 * its own, derived from the game's seed under a tag of its own,
 * hash(game seed, 'agents/seat<i>', 0) (agentSeedsOf), and never equal to the
 * dice seed; the record keeps both. An agent's stream for one decision draws
 * hash(agent seed, 'agent/seat<i>/<seq>', j) and shows nothing but its draws
 * (core/random.ts), so no seed is handed to an agent. That is all it means:
 * the draws themselves can be run backwards to the game's seed, and seeded
 * dice can be foretold from the faces every seat is sent (kernel/dice.ts).
 * The simulator's agents are the game's own code and are trusted.
 *
 * What an agent is handed (research-ai section 4.0): the seat's view, the
 * legal actions asked of that view, and its stream. Never the state, the
 * match or the dice source; the view is new data, so nothing the agent does
 * to it reaches the state.
 *
 * An agent is asked for one action at a time. When several seats must decide
 * (simultaneous set-up), the seat asked is the (number of actions so far,
 * modulo the number of seats deciding)-th of them, so they take turns.
 */
import { RandomStream, hashOf } from '../core/random';
import { SeededDice } from '../kernel/dice';
import { checkInvariants } from '../kernel/invariants';
import { Match } from '../kernel/match';
import { SeededRecord, recordOf } from '../kernel/record';
import type { Seat } from '../kernel/ruleset';
import type { Agent } from '../ai/agent';
import { HeuristicAgent } from '../ai/heuristic';
import { RandomAgent } from '../ai/random';
import type { ReferenceRuleset } from '../rulesets/reference/rules';
import type { AttackQuery, RefAction, RefEvent, RefState, RefView } from '../rulesets/reference/types';
import type { MatchContent } from './content';

export const AGENT_KINDS = ['heuristic', 'random'] as const;
export const DEFAULT_AGENT = 'heuristic';
export const DEFAULT_CAP = 5000;

export type RefMatch = Match<RefState, RefAction, RefEvent, RefView, AttackQuery>;

export function makeAgent(kind: string, rules: ReferenceRuleset): Agent<RefView, RefAction> {
  if (kind === 'heuristic') return new HeuristicAgent(rules);
  if (kind === 'random') return new RandomAgent<RefView, RefAction>();
  throw new Error(`unknown agent '${kind}' (known: ${AGENT_KINDS.join(', ')})`);
}

/** The random stream an agent is given for one decision: seat by index, so renaming a seat changes nothing. */
export function agentStream(seed: number, seatIndex: number, seq: number): RandomStream {
  return new RandomStream(seed, `agent/seat${seatIndex}/${seq}`);
}

/**
 * The agents' seeds of a game, one per seat: hash(game seed, 'agents/seat<i>', k)
 * for the first k (from 0) that is not the dice seed. A tag of their own, so an
 * agent's seed is never the dice seed itself (it can still be traced back to it).
 */
export function agentSeedsOf(gameSeed: number, diceSeed: number, seats: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < seats; i++) {
    let k = 0;
    let s = hashOf(gameSeed, `agents/seat${i}`, k);
    while (s === diceSeed) s = hashOf(gameSeed, `agents/seat${i}`, ++k);
    out.push(s);
  }
  return out;
}

export interface GameSummary {
  readonly seed: number;
  /** The winning seat, 'draw', or null when the game did not finish. */
  readonly winner: string | null;
  readonly turns: number;
  readonly actions: number;
  readonly finalHash: string;
  readonly invariantViolations: number;
  readonly illegalActions: number;
  /** The result's reason, or 'cap' (the safety cap was reached) or 'stopped' (a save point). */
  readonly endedBy: string;
  /** Accepted actions per seat and action type. */
  readonly byType: Readonly<Record<string, Readonly<Record<string, number>>>>;
}

/** One decision, as the test hook onDecision sees it (the host's side: the agent saw only view, legal and its stream). */
export interface Decided {
  /** The match, before the chosen action is applied. */
  readonly match: RefMatch;
  readonly seat: Seat;
  readonly seatIndex: number;
  readonly seq: number;
  /** The seed of the seat's agent (the stream was agentStream(agentSeed, seatIndex, seq)). */
  readonly agentSeed: number;
  readonly state: RefState;
  /** The view the agent was given. */
  readonly view: RefView;
  readonly legal: readonly RefAction[];
  readonly chosen: RefAction;
}

export interface PlayOptions {
  /** The game's seed. */
  readonly seed: number;
  /** The dice seed, when not the game's seed. */
  readonly diceSeed?: number;
  /**
   * The agent of each seat, in seat order (default: heuristic for every seat):
   * an agent kind (AGENT_KINDS), or an agent object (a test's probe, say; the
   * record names it by its id).
   */
  readonly agents?: readonly (string | Agent<RefView, RefAction>)[];
  /** Stop with no result after this many actions (default DEFAULT_CAP). */
  readonly cap?: number;
  /** Stop after this many actions: a save point. */
  readonly stopAfter?: number;
  /** A saved record to continue: its actions are applied first (each hash checked), its seeds and agents are used. */
  readonly resume?: SeededRecord;
  /** Check the invariants after every action (default true). */
  readonly invariants?: boolean;
  /** Called after each agent decision, before the action is applied. */
  readonly onDecision?: (d: Decided) => void;
}

export interface PlayResult {
  readonly record: SeededRecord;
  readonly summary: GameSummary;
  readonly violations: readonly string[];
  readonly match: RefMatch;
}

export function playGame(content: MatchContent, opts: PlayOptions): PlayResult {
  const rules = content.ruleset;
  const seats = rules.seats;
  const resume = opts.resume;
  const diceSeed = resume ? resume.seed : opts.diceSeed ?? opts.seed;
  const given = resume ? resume.agents.map(a => a.agent) : opts.agents ?? seats.map(() => DEFAULT_AGENT);
  const seeds = resume ? resume.agents.map(a => a.seed) : agentSeedsOf(opts.seed, diceSeed, seats.length);
  if (given.length !== seats.length || seeds.length !== seats.length) throw new Error(`play: ${seats.length} seats need ${seats.length} agents`);
  if (seeds.includes(diceSeed)) throw new Error(`play: an agent's seed is the dice seed ${diceSeed}; an agent is never handed the dice seed`);
  const agents = given.map(a => (typeof a === 'string' ? makeAgent(a, rules) : a));
  const kinds = agents.map(a => a.id);
  const match: RefMatch = new Match(rules, new SeededDice(diceSeed));
  const byType: Record<string, Record<string, number>> = {};
  for (const s of seats) byType[s] = {};
  const count = (seat: Seat, action: unknown): void => {
    const type = typeof action === 'object' && action !== null ? String((action as { type?: unknown }).type) : '?';
    const t = byType[seat] as Record<string, number>;
    t[type] = (t[type] ?? 0) + 1;
  };

  if (resume) {
    if (resume.ruleset.hash !== content.refs.ruleset.hash || resume.scenario.hash !== content.refs.scenario.hash || resume.map.hash !== content.refs.map.hash) {
      throw new Error('resume: the record was played on different content (compare the ruleset, scenario and map hashes)');
    }
    for (const a of resume.actions) {
      const res = match.submit(a.seat, a.action);
      if (!res.ok) throw new Error(`resume: action ${a.seq} was refused: ${res.rejection.code}: ${res.rejection.detail}`);
      if (match.hash !== a.hash) throw new Error(`resume: action ${a.seq}: state hash ${match.hash}, the record has ${a.hash}`);
      count(a.seat, a.action);
    }
  }

  const cap = opts.cap ?? DEFAULT_CAP;
  const check = opts.invariants !== false;
  const violations: string[] = [];
  let illegal = 0;
  let endedBy = '';
  for (;;) {
    if (opts.stopAfter !== undefined && match.log.length >= opts.stopAfter) {
      endedBy = 'stopped';
      break;
    }
    const d = match.pending();
    if (d.kind === 'over') break;
    if (match.log.length >= cap) {
      endedBy = 'cap';
      break;
    }
    // Seats deciding at once are asked in turn, by the number of actions so far, so a
    // game resumed from a record asks them in the same order as the uninterrupted one.
    const seat = d.seats[match.log.length % d.seats.length] as Seat;
    const si = seats.indexOf(seat);
    // The seat's view first; its legal actions are asked of that view, as a client would ask.
    const view = match.view(seat);
    const legal = rules.legalActions(view);
    const seq = match.log.length + 1;
    const agentSeed = seeds[si] as number;
    const chosen = (agents[si] as Agent<RefView, RefAction>).decide(view, legal, agentStream(agentSeed, si, seq));
    opts.onDecision?.({ match, seat, seatIndex: si, seq, agentSeed, state: match.state, view, legal, chosen });
    let res = match.submit(seat, chosen);
    let accepted: unknown = chosen;
    if (!res.ok) {
      illegal++;
      violations.push(`action ${seq}: ${seat}'s agent chose an illegal action (${res.rejection.code}: ${res.rejection.detail})`);
      // A fresh list: the one the agent was handed is the agent's to spoil.
      const fresh = match.legalActions(seat);
      const fallback = fresh[fresh.length - 1];
      if (fallback === undefined) throw new Error(`action ${seq}: ${seat} must decide but has no legal action`);
      res = match.submit(seat, fallback);
      accepted = fallback;
      if (!res.ok) throw new Error(`action ${seq}: a listed legal action was refused: ${res.rejection.code}`);
    }
    count(seat, accepted);
    if (check) for (const v of checkInvariants(rules, match.state)) violations.push(`after action ${match.log.length}: ${v}`);
  }

  const result = match.result();
  const record = recordOf(match, {
    ruleset: content.refs.ruleset, scenario: content.refs.scenario, map: content.refs.map, seed: diceSeed,
    agents: seats.map((seat, i) => ({ seat, agent: kinds[i] as string, seed: seeds[i] as number })),
  });
  const summary: GameSummary = {
    seed: opts.seed,
    winner: result ? result.winner ?? 'draw' : null,
    turns: rules.turn(match.state),
    actions: match.log.length,
    finalHash: match.hash,
    invariantViolations: violations.length - illegal,
    illegalActions: illegal,
    endedBy: result ? result.reason : endedBy,
    byType,
  };
  return { record, summary, violations, match };
}
