/**
 * The local host of Formation Impulse: a kernel Match on the ruleset built
 * from the four texts (a scenario, the rules data, the unit file, the map),
 * in the page itself, with seeded dice (host.ts) and the planning computer
 * opponent of opponent-planner.ts for the computer's seats.
 */
import { parse as parseText } from 'yaml';
import type { Agent } from '../../../engine/ai/agent';
import { loadImpulseMatch } from '../../../engine/rulesets/impulse/load';
import type { ImpulseContent, ImpulseTexts } from '../../../engine/rulesets/impulse/load';
import type { ImpulseRuleset } from '../../../engine/rulesets/impulse/rules';
import type { ImpulseAction, ImpulseEvent, ImpulseState, ImpulseView, OutcomeQuery } from '../../../engine/rulesets/impulse/types';
import { MatchHost } from './host';
import type { Player } from './host';
import { ImpulsePlanner } from './opponent-planner';
import { levelFrom } from './opponent-table';
import type { SeatPort, Update } from './port';
import { readImpulse } from './reading-impulse';
import type { ImpulseReading } from './reading-impulse';

export type ImpulsePort = SeatPort<ImpulseView, ImpulseAction, ImpulseEvent, OutcomeQuery>;
export type ImpulseUpdate = Update<ImpulseView, ImpulseEvent>;
export type ImpulseAgent = Agent<ImpulseView, ImpulseAction>;

export interface ImpulseOptions {
  readonly texts: ImpulseTexts;
  /** The game's seed: a whole number from 0 to 4294967295. */
  readonly seed: number;
  /** Who plays each seat, in order of play. */
  readonly players: readonly Player[];
  /** The computer's level: easy, normal or hard (the page's address has `ai=`); normal for anything else or nothing. */
  readonly level?: string | null;
  /** The agent of each seat, given the ruleset; the planning opponent at that level when left out (opponentById of opponent-planner.ts makes any by its id). */
  readonly agents?: (ruleset: ImpulseRuleset, seatIndex: number) => ImpulseAgent;
  /** The short name a unit type's counter prints, when the page has one (see readImpulse). */
  readonly label?: (type: string) => string | null;
  /** The player's guide to these rules, as the text of its file (content/rulebooks/); left out, the game has no rule book. */
  readonly rulebook?: { readonly file: string; readonly text: string };
}

function load(texts: ImpulseTexts): ImpulseContent {
  const loaded = loadImpulseMatch(texts);
  if (!loaded.content) throw new Error(`the game's content could not be loaded:\n${loaded.problems.join('\n')}`);
  return loaded.content;
}

export class ImpulseHost extends MatchHost<ImpulseState, ImpulseAction, ImpulseEvent, ImpulseView, OutcomeQuery> {
  declare readonly ruleset: ImpulseRuleset;
  readonly reading: ImpulseReading;

  constructor(opts: ImpulseOptions) {
    const { ruleset, refs } = load(opts.texts);
    const make = opts.agents ?? ((r: ImpulseRuleset): ImpulseAgent => new ImpulsePlanner(r, levelFrom(opts.level)));
    super({ ruleset, seed: opts.seed, players: opts.players, agents: ruleset.seats.map((_, i) => make(ruleset, i)), refs });
    let book: { raw: unknown; file: string } | undefined;
    if (opts.rulebook) {
      try {
        book = { raw: parseText(opts.rulebook.text) as unknown, file: opts.rulebook.file };
      } catch (err) {
        throw new Error(`${opts.rulebook.file}: not readable as YAML: ${err instanceof Error ? err.message.split('\n')[0] ?? '' : String(err)}`);
      }
    }
    this.reading = readImpulse(ruleset, opts.label, book);
  }
}
