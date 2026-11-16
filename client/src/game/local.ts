/**
 * The local host of the reference ruleset: a kernel Match on it and its
 * scenario, in the page itself, with seeded dice (host.ts), the heuristic
 * agent for computer seats and for set-up advice.
 *
 * Seeds: as host.ts says; set-up advice number d for a seat draws from
 * 'advice/seat<i>/<d>/<k>'.
 */
import { RandomStream } from '../../../engine/core/random';
import { HeuristicAgent } from '../../../engine/ai/heuristic';
import { SeededDice } from '../../../engine/kernel/dice';
import type { ReferenceRuleset } from '../../../engine/rulesets/reference/rules';
import type { AttackQuery, RefAction, RefEvent, RefState, RefView } from '../../../engine/rulesets/reference/types';
import { loadMatchContent } from '../../../engine/sim/content';
import type { MatchContent, TextFile } from '../../../engine/sim/content';
import { MatchHost } from './host';
import type { Player } from './host';
import type { SeatPort, Update } from './port';
import { readReference } from './reading-reference';
import type { ReferenceReading } from './reading-reference';

export { playersFrom, seedFrom } from './host';
export type { Player } from './host';
export type RefPort = SeatPort<RefView, RefAction, RefEvent, AttackQuery>;
export type RefUpdate = Update<RefView, RefEvent>;

export interface LocalOptions {
  readonly texts: { readonly scenario: TextFile; readonly ruleset: TextFile; readonly map: TextFile };
  /** The game's seed: a whole number from 0 to 4294967295. */
  readonly seed: number;
  /** Who plays each seat, in order of play. */
  readonly players: readonly Player[];
}

function load(texts: LocalOptions['texts']): MatchContent {
  const loaded = loadMatchContent(texts);
  if (!loaded.content) throw new Error(`the game's content could not be loaded:\n${loaded.problems.join('\n')}`);
  return loaded.content;
}

export class LocalHost extends MatchHost<RefState, RefAction, RefEvent, RefView, AttackQuery> {
  declare readonly ruleset: ReferenceRuleset;
  readonly reading: ReferenceReading;

  constructor(opts: LocalOptions) {
    const { ruleset, refs } = load(opts.texts);
    super({ ruleset, seed: opts.seed, players: opts.players, agents: ruleset.seats.map(() => new HeuristicAgent(ruleset)), refs });
    this.reading = readReference(ruleset);
  }

  /**
   * The set-up a seat's adviser would make from where the seat stands: the
   * agent's own choices, played on a copy of the match until it would hand
   * the set-up in. Nothing here touches the match.
   */
  override advice(seat: string, deal: number): RefAction[] {
    const i = this.ruleset.seats.indexOf(seat);
    if (i < 0 || !Number.isInteger(deal) || deal < 0) return [];
    const scratch = this.match.fork(new SeededDice(0));
    const agent = this.agents[i];
    if (!agent) return [];
    const out: RefAction[] = [];
    for (let k = 0; k < this.ruleset.board.n; k++) {
      const view = scratch.view(seat);
      const legal = this.ruleset.legalActions(view);
      if (legal.length === 0) break;
      const chosen = agent.decide(view, legal, new RandomStream(this.agentSeeds[i] as number, `advice/seat${i}/${deal}/${k}`));
      if (this.reading.offer(view, chosen).kind !== 'place' || !scratch.submit(seat, chosen).ok) break;
      out.push(chosen);
    }
    return out;
  }
}
