/**
 * The reading of Formation Impulse (engine/rulesets/impulse; the rules are
 * docs/rules/rules-v1.md): the one file of the game layer that knows the shape
 * of its views, actions and events and puts them into words. It decides
 * nothing. What is legal comes from the legal list; every chance from the
 * ruleset's own outcomes (asked through the port) and its preview of the fire
 * a move draws (rules 8.8); every other number from the rules data, the unit
 * file, the scenario, a view or an event, or from the ruleset's public answers
 * (ownColumn, assaultColumn, overrunColumn, inCommandNow, the compiled board's
 * step costs and cover).
 *
 * Three numbers are worked out here because nothing hands them over (each is
 * a request to the engine's owner, docs/review/M5/fuller-rules-handover.md):
 * the cost of an offered path (summed from the board's step costs, as the
 * ruleset writes it into the move's event), the cost of an overrun (that sum
 * through the target and exit hexes plus overrun.cost, rule 12.8), and the
 * support added to the best column of an attack by several units (rules 7.4
 * and 12.3, from support.steps and assault.support). A test holds each
 * against the event the ruleset then makes.
 *
 * The game is played with the whole side moving (rules 5.9, `sequence.activation: side`): a side's
 * turn is its one activation, which the layer sends by itself, and a player gives no order. Rules
 * data that says otherwise is refused here, aloud: the layer has no way to play the formation game.
 *
 * How the ruleset's things are said in the layer's vocabulary (reading.ts):
 *   activating the side        `auto`: it carries no choice (the other use of the order, a pass, is
 *                              the turn ended with nothing done, and can be done after it as well)
 *   ending the activation,     `end`: the side's turn ends
 *     and a pass
 *   a formation                nothing: the layer's groups are the units that stand near one another
 *                              (GROUP_REACH), which this file works out from where they are. A
 *                              formation is named only in the briefing's order of battle and in a
 *                              unit's designation ("1a")
 *   fire by one or more units  an `attack` (one action for the set)
 *   a close assault            a `charge`
 *   an overrun                 a `drive`
 *   mounting                   `board`; dismounting is a `move` of one hex with the verb "dismounts"
 *   a fire mission, smoke      a `call` of variant 'call' or 'screen'; waiting, an `incoming` marker;
 *                              smoke on the map, a `screen` marker
 *   fire discipline            the side's `setting`: one switch, which sets every formation alike
 *                              by the rules' own action for each
 *   landing due missions       `auto`: it is the side's only legal action (5.4)
 *   reaction fire              a forecast's shots; an `attack` step with `at`
 *   a move that leaves the     a `move` that `keeps`: it leaves the unit Moved, which is `moved` on a
 *     unit Moved (6.8)         unit of a position, with what it can still do (`still`): armor after a
 *                              short move may fire or move on; a unit that can close assault, after a
 *                              move with movement over, may close assault or move on (rulings 77, 80
 *                              and 81). The move's forecast says what it can still do (`after`), and
 *                              the forecast of fire by a Moved unit says what its chance already
 *                              carries (`counted`). Which moves keep is the ruleset's own answer
 *                              (moveLeaves), and so is the chance. A Moved unit's moves on (6.9) are
 *                              plain moves within what is left of its allowance (the offer's budget)
 */
import { distance, labelOf } from '../../../engine/core/hex';
import { PathSearch, routeTo } from '../../../engine/core/path';
import type { ImpulseRuleset, UnitInfo as RuleUnit } from '../../../engine/rulesets/impulse/rules';
import type {
  AssaultUnit, Attack, Discipline, Effect, ImpulseAction, ImpulseEvent, ImpulseView, OutcomeQuery, ReactionPlan, UnitState,
} from '../../../engine/rulesets/impulse/types';
import type { PortOutcome } from './port';
import type {
  Attempt, Badge, Briefing, Chance, Figure, Forecast, GameInfo, GroupNow, Guide, MarkerNow, Offer, Position, Reading, Roll, RuleBook, Shot,
  SideInfo, Step, UnitCard, UnitInfo, UnitNow,
} from './reading';
import { readRuleBook } from './rulebook';

export type ImpulseReading = Reading<ImpulseView, ImpulseAction, ImpulseEvent, OutcomeQuery>;

/** "a", "a and b", "a, b and c". */
function listed(names: readonly string[]): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1] as string}`;
}

function signed(n: number): string {
  return n >= 0 ? `+${n}` : `−${-n}`;
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** The support of `n` units attacking together (rules 7.4, 12.3): the steps for the second, the third and so on, the last repeating. */
function supportOf(steps: readonly number[], n: number): number {
  let total = 0;
  for (let k = 0; k < n - 1; k++) total += steps[Math.min(k, steps.length - 1)] ?? 0;
  return total;
}

/**
 * What a side's fire discipline (rules 3.5, 8.2) is called where a player reads it: what its Ready units shoot at during
 * the enemy's turn ("Reaction fire" and the setting; the owner, 2026-11-14, of "fire discipline: mixed": "I'm not even sure
 * what that means").
 */
const SETTING_WORDS: Readonly<Record<Discipline, string>> = { free: 'any target', armor: 'armor only', hold: 'hold fire' };
/** A side whose formations are not all set alike (a scenario may start it so). */
const SETTING_MIXED = 'mixed';
/**
 * How near two units of a side must stand to be of one group: within this many hexes of another of its units, and so
 * on from unit to unit. It is this file's own number, for finding and naming units: no rule reads it.
 */
const GROUP_REACH = 2;
/** What each setting does, in one sentence. */
const SETTING_LONG: Readonly<Record<Discipline, string>> = {
  free: 'Your Ready units fire at any enemy that moves in their sight.',
  armor: 'Your Ready units fire only at enemy armor that moves in their sight.',
  hold: 'Your Ready units hold their fire while the enemy moves.',
};

/** A rule book as parsed from its file (content/rulebooks/), not yet checked, and the file's name for its problems. */
export interface RuleBookSource {
  readonly raw: unknown;
  readonly file: string;
}

/**
 * `counterLabel`, when given, is the short name a unit type's counter prints in its title band (the page has
 * them from the unit art's data); a type it has none for prints its full name. `book`, when given, is the
 * player's guide to these rules: it is checked here against the rules data and the scenario, whose values
 * its text names, and a book with a problem is refused aloud (nothing of it is shown).
 */
export function readImpulse(rules: ImpulseRuleset, counterLabel?: (type: string) => string | null, book?: RuleBookSource): ImpulseReading {
  if (!rules.sideProfile) {
    throw new Error('the game is played with the whole side moving (sequence.activation: side in the rules data); this rules data says otherwise, and the game has no way to play it');
  }
  const grid = rules.board.grid;
  const data = rules.rules;
  const scenario = rules.scenario;
  const seats = rules.seats;
  const table = data.fireTable;
  const label = (hex: number): string => labelOf(grid, hex);
  const seatOf = (side: number): string => seats[side] ?? '';
  const sideName = (side: number): string => scenario.sides[side]?.name ?? seatOf(side);
  const ru = (i: number): RuleUnit => {
    const u = rules.unitInfo[i];
    if (!u) throw new Error(`reading: no unit ${i}`);
    return u;
  };

  // ---- what the match is played with ----
  // What the scenario tells a player before the first turn, when it has that (scenario.ts checks it against the sides, their formations and the objectives).
  const told = scenario.briefing;
  const shortName = (side: number): string => told?.sides[side]?.short ?? sideName(side);
  const sides: SideInfo[] = scenario.sides.map((s, i) => {
    const mark = told?.sides[i]?.mark;
    return {
      seat: s.id, name: s.name, stock: s.counters === 'stock-b' ? 'second' : s.counters === 'stock-a' ? 'first' : i === 0 ? 'first' : 'second',
      short: shortName(i),
      ...(mark !== undefined && mark !== 'none' ? { mark } : {}),
    };
  });
  // A formation's number among its side's, from 1: it is in a unit's designation ("1a") and in the briefing's order of battle, and nowhere else.
  const formationNumber = (formation: number): number => (rules.sideFormations[rules.formationInfo[formation]?.side ?? 0] ?? []).indexOf(formation) + 1;
  const units: UnitInfo[] = rules.unitInfo.map(u => {
    const mark = String(formationNumber(u.formation));
    const letter = String.fromCharCode(97 + (rules.formationInfo[u.formation]?.units.indexOf(u.index) ?? 0));
    const t = u.type;
    return {
      id: String(u.index),
      seat: seatOf(u.side),
      name: `${t.name} ${mark}${letter}`,
      tag: `${mark}${letter}`,
      // What its type can ever do besides moving and firing (12.1, 12.7, 14.1, 13.1).
      ways: [t.assaults ? 'charge' : '', t.overruns ? 'drive' : '', t.rides ? 'board' : '', t.indirect ? 'call' : '', t.indirect ? 'screen' : ''].filter(w => w !== ''),
      face: {
        stock: sides[u.side]?.stock ?? 'first',
        title: counterLabel?.(t.id) ?? t.name,
        kind: t.kind,
        numbers: { attack: `${t.ap}/${t.he}`, range: String(t.range), defence: String(t.defense), move: String(t.move) },
        art: t.id,
      },
    };
  });
  const zones: Record<string, number[]> = {};
  rules.zones.forEach((zone, side) => {
    const list: number[] = [];
    zone.forEach((inZone, hex) => {
      if (inZone === 1) list.push(hex);
    });
    zones[seatOf(side)] = list;
  });
  // ---- the briefing: the forces and their points from the scenario's own units, the win conditions from what the ruleset plays by ----
  const percent = (share: number): string => `${Math.round(share * 1000) / 10}%`;
  const killWords = rules.killShare[0] === 1 && rules.killShare[1] === 2
    ? 'half its points'
    : `${plural(rules.killShare[0], 'point')} for every ${rules.killShare[1]} of its points`;
  const briefing: Briefing | undefined = told ? {
    title: told.title,
    dateline: `${told.date} \u00b7 ${told.place} \u00b7 ${plural(rules.lastTurn, 'turn')}`,
    picture: told.picture,
    paragraphs: [told.background, told.situation],
    note: told.note,
    forces: scenario.sides.map((s, si) => {
      const mark = told.sides[si]?.mark;
      const mine = rules.sideFormations[si] ?? [];
      return {
        seat: s.id,
        name: s.name,
        mark: mark !== undefined && mark !== 'none' ? mark : null,
        aim: told.sides[si]?.aim ?? '',
        groups: mine.map((f, k) => {
          // Like types together, in the order the scenario first lists each.
          const lines: { type: string; name: string; n: number; points: number }[] = [];
          for (const u of rules.formationInfo[f]?.units ?? []) {
            const t = ru(u).type;
            const had = lines.find(l => l.type === t.id);
            if (had) {
              had.n += 1;
              had.points += t.cost;
            } else {
              lines.push({ type: t.id, name: t.name, n: 1, points: t.cost });
            }
          }
          const role = told.sides[si]?.formations[k]?.role;
          return {
            name: `Formation ${formationNumber(f)}${role !== undefined ? ` \u00b7 ${role}` : ''}`,
            lines: lines.map(l => ({ type: l.type, text: l.n > 1 ? `${l.name} \u00d7 ${l.n}` : l.name, points: l.points })),
          };
        }),
        totalLabel: 'Strength',
        total: (rules.sideUnits[si] ?? []).reduce((sum, u) => sum + ru(u).type.cost, 0),
      };
    }),
    winTitle: 'How to win',
    goals: rules.objectives.map((o, k) => ({ hex: o.hex, name: told.objectives[k]?.name ?? label(o.hex), worth: `${plural(o.points, 'point')} a turn` })),
    terms: [{ label: 'A kill scores', value: killWords }],
    endTitle: 'The game ends',
    endings: [
      { label: `After turn ${rules.lastTurn}`, value: 'the higher score wins' },
      { label: `A lead of ${rules.suddenDeathLead} points`, value: 'wins at once' },
      { label: `${percent(rules.breakShare)} of strength lost`, value: 'that side loses' },
    ],
  } : undefined;

  // ---- the rule book: its text names values of the rules data (`rules.`) and of this scenario (`game.`) ----
  let rulebook: RuleBook | undefined;
  if (book) {
    const first = seats.indexOf(scenario.initiative);
    // A board printed for another season is priced from that season's table (ruling 83): the book's table of costs
    // then shows that table, as the game charges it. (A summer board has none: `movement` itself.)
    const seasonTable = data.seasons?.[rules.board.season];
    const read = readRuleBook(book.raw, book.file, {
      rules: seasonTable ? { ...data, movement: seasonTable } : data,
      game: {
        turns: rules.lastTurn,
        lead: rules.suddenDeathLead,
        breakShare: rules.breakShare,
        kill: { points: rules.killShare[0], cost: rules.killShare[1] },
        first: sideName(first),
        second: sideName(first === 0 ? 1 : 0),
        sides: scenario.sides.map((s, i) => ({ name: s.name, short: shortName(i), units: (rules.sideUnits[i] ?? []).length })),
        // How near units stand to be shown as one group: this file's own number, named in the book's text like every other.
        groupReach: GROUP_REACH,
      },
    }, data.id);
    if (!read.book) throw new Error(`the rule book could not be read:\n${read.problems.join('\n')}`);
    rulebook = read.book;
  }

  // ---- Moved (6.8): a unit of `moveFire.class` that moves no more than a share of its movement can still fire once
  // ---- that turn at `moveFire.steps` on its own column, or move on (6.9); a unit that can close assault and keeps
  // ---- movement over can still close assault, or move on ----
  const shortMoves = data.moveFire.class !== 'none';
  /** What a shot after a short move gets, as a sentence; '' when it gets nothing. */
  const AFTER_SHORT = shortMoves && data.moveFire.steps !== 0 ? `That shot gets ${signed(data.moveFire.steps)}.` : '';
  /**
   * When a fire mission lands (13.3): at the start of the caller's first impulse after the other side has finished one.
   * Under `initiative.policy: fixed` the sides alternate, so that is the caller's next turn.
   */
  const LANDS = data.initiative.policy === 'fixed'
    ? 'It lands at the start of your next turn.'
    : 'It lands at the start of your first turn after your opponent’s next turn.';
  /** What a Moved unit can still do, in a few words: after a short move of armor, or after a move with movement over. */
  const STILL_FIRE = 'fire or move on';
  const STILL_CHARGE = 'close assault or move on';
  /** What a unit Moved now can still do, or null when it is not Moved. */
  const stillOf = (v: ImpulseView, i: number): { readonly words: string; readonly attack: 'attack' | 'charge' } | null => {
    const may = rules.movedMay(v, i);
    if (!may) return null;
    return may.fire ? { words: STILL_FIRE, attack: 'attack' } : { words: may.assault ? STILL_CHARGE : 'move on', attack: 'charge' };
  };
  /** What a move of `cost` would leave a unit that is not Moved able to do, if it keeps (6.8): fire, or close assault. */
  const stillAfter = (i: number, cost: number): string => {
    const most = rules.shortMove(i);
    return most !== null && cost <= most ? STILL_FIRE : STILL_CHARGE;
  };

  const info: GameInfo = {
    title: scenario.name,
    turns: rules.lastTurn,
    grid: { cols: grid.cols, rows: grid.rows },
    sides,
    units,
    objectives: rules.objectives.map(o => ({ hex: o.hex, points: o.points })),
    zones,
    dice: { count: table.dice.count, faces: table.dice.faces },
    rich: true,
    attackSets: true,
    words: {
      end: 'End turn', charge: 'Close assault', drive: 'Overrun', board: 'Mount', unload: 'Dismount',
      call: 'Fire mission', screen: 'Smoke', setting: 'Reaction fire', route: 'Other route', advance: 'Advance after', preset: 'Deploy for me',
      // What each setting of reaction fire does, in one sentence, by its words; and what a side whose units are not all set
      // alike is told (the first press of H sets them all to the first setting).
      [`setting:${SETTING_WORDS.free}`]: SETTING_LONG.free, [`setting:${SETTING_WORDS.armor}`]: SETTING_LONG.armor, [`setting:${SETTING_WORDS.hold}`]: SETTING_LONG.hold,
      [`setting:${SETTING_MIXED}`]: `Your units are not all set alike. Press H to set them all to ${SETTING_WORDS.free}.`,
      takeBack: 'Take back', start: 'Hand in',
      // Words a panel prints: what the groups are called, and what their number keys do.
      groups: 'Groups', groupKeys: 'go to a group and make it the active group (no unit is chosen)',
      // What two gestures do, for the list of keys.
      addClick: 'add a unit to fire or close assault together (click it again to remove it)', pointing: 'point at something to see what a click will do; one click does it',
      shiftTab: 'choose the unit before (in a way switched on by its key, step back through its choices)',
      // What an attack's two chances are of: "58% to suppress or destroy, 17% to destroy".
      chanceAny: 'to suppress or destroy', chanceKill: 'to destroy',
      // What becomes of units a player does not use in a turn (8.1), for the prompt that counts those that can still act.
      unused: 'Units you haven\u2019t used will fire at enemies that move in their sight.',
      // A move that leaves the unit Moved (6.8): the legend's words for the darker hexes of a reach; what a Moved unit is
      // told when it has nothing to attack, by fire or by close assault; and what a shot after a short move gets (a
      // sentence, or nothing when it gets nothing).
      nearLegend: 'Unit can still act after moving here',
      // A unit added to a close assault that is not beside the enemy the others are beside (12.1, ruling 81); and what the
      // close assault's prompt says when the units chosen have no target in common.
      chargeJoin: 'Unit must be next to the target to join.', chargeMove: 'First move each unit next to the target.',
      noTarget: 'no enemy visible', noCharge: 'no enemy armor next to unit',
      ...(shortMoves ? {
        shortMove: 'Short move',
        ...(AFTER_SHORT !== '' ? { movedShot: AFTER_SHORT } : {}),
      } : {}),
    },
    settings: [SETTING_WORDS.free, SETTING_WORDS.armor, SETTING_WORDS.hold],
    ...(briefing ? { briefing } : {}),
    ...(rulebook ? { rulebook } : {}),
  };

  const nameOf = (unit: number): string => units[unit]?.name ?? `unit ${unit}`;
  const names = (list: readonly number[]): string => listed(list.map(nameOf));
  const ids = (list: readonly string[]): number[] => list.map(Number);
  const unitAt = (view: ImpulseView, i: number): UnitState => {
    const u = view.units[i];
    if (!u) throw new Error(`reading: no unit '${i}'`);
    return u;
  };
  /** Where a unit's counter is: its hex, or its carrier's. */
  const whereIs = (view: ImpulseView, i: number): number => {
    const u = unitAt(view, i);
    if (u.destroyed) return -1;
    if (u.carriedBy >= 0) return view.units[u.carriedBy]?.hex ?? -1;
    return u.hex;
  };
  const missionOf = (view: ImpulseView, i: number): boolean => view.missions.some(m => m.battery === i);
  /** Ready to be given something to do (rules 5.5): in play, not Spent, not Suppressed, not a battery with a mission waiting. */
  const readyNow = (view: ImpulseView, i: number): boolean => {
    const u = unitAt(view, i);
    return !u.destroyed && !u.spent && !u.suppressed && (u.hex >= 0 || u.carriedBy >= 0) && !(ru(i).battery && missionOf(view, i));
  };

  const effectWords = (effect: string): { name: string; effect: string } => {
    if (effect === 'destroyed') return { name: 'Destroyed', effect: 'removed from the board' };
    if (effect === 'suppressed') return { name: 'Suppressed', effect: 'cannot act until it recovers; a second hit destroys it' };
    if (effect === 'none') return { name: 'No effect', effect: '' };
    return { name: effect, effect: '' };
  };
  const fateOf = (effect: Effect): 'destroyed' | 'marked' | 'none' => (effect === 'destroyed' ? 'destroyed' : effect === 'suppressed' ? 'marked' : 'none');
  const rolled = (dice: readonly number[]): string => (dice.length > 0 ? `dice ${dice.join(' + ')} = ${dice.reduce((a, b) => a + b, 0)}` : 'no roll needed');
  /** The figures of a column: the column, and what the dice must show for each effect. */
  const columnFigures = (column: number): Figure[] => [
    { label: 'Column', value: signed(column) },
    { label: 'Suppresses on', value: `${Math.max(table.dice.count, table.suppress - column)}+` },
    { label: 'Destroys on', value: `${Math.max(table.dice.count, table.destroy - column)}+` },
  ];
  /** The chance a column gives, before the roll: the ways the dice reach each threshold, of all their throws (the fire table, 7.3). */
  const chanceAt = (column: number): { ways: number; kill: number; of: number } => {
    let sums = [1];
    for (let d = 0; d < table.dice.count; d++) {
      const next = new Array<number>(sums.length + table.dice.faces).fill(0);
      sums.forEach((n, s) => {
        for (let f = 1; f <= table.dice.faces; f++) next[s + f] = (next[s + f] as number) + n;
      });
      sums = next;
    }
    const of = sums.reduce((a, n) => a + n, 0);
    const atLeast = (need: number): number => sums.reduce((a, n, s) => (s >= need ? a + n : a), 0);
    return { ways: atLeast(Math.max(table.dice.count, table.suppress - column)), kill: atLeast(Math.max(table.dice.count, table.destroy - column)), of };
  };
  const coverWords = (hex: number): string => {
    const cover = rules.board.coverOf(hex);
    const fire = rules.coverFire[hex] ?? 0;
    return `${cover}${fire > 0 ? `, ${signed(-fire)} to fire on it` : ''}${rules.conceals[hex] === 1 ? ', hides' : ''}`;
  };

  const ending = (winner: number, reason: string, v?: ImpulseView): string => {
    const loser = sideName(winner === 0 ? 1 : 0);
    // Both sides may have lost their share at the same end phase: the higher score then wins (15.3).
    const w = v?.sides[winner];
    const both = w !== undefined && w.startCost > 0 && w.lost >= rules.breakShare * w.startCost;
    if (reason === 'break' && both) return `Both sides are broken. The ${sideName(winner)} wins with the higher score.`;
    if (reason === 'break') return `The ${sideName(winner)} wins. The ${loser} is broken.`;
    if (reason === 'sudden death') return `The ${sideName(winner)} wins: it leads by ${rules.suddenDeathLead} points or more.`;
    if (reason === 'turn limit') return `The ${sideName(winner)} wins on points after turn ${rules.lastTurn}.`;
    return `The ${sideName(winner)} wins (${reason}).`;
  };

  /** The cost of a path from a hex, by the board's step costs. */
  const pathCost = (mover: number, from: number, path: readonly number[]): number => {
    let at = from;
    let cost = 0;
    for (const h of path) {
      cost += rules.board.cost(mover, at, h) ?? 0;
      at = h;
    }
    return cost;
  };

  /** The fire a legal action would draw (rules 8.8), from the ruleset's own preview. */
  const plansOf = (view: ImpulseView, action: ImpulseAction): ReactionPlan[] => {
    if (view.viewer === null) return [];
    return rules.preview(view, view.viewer, action) ?? [];
  };
  const shotsOf = (view: ImpulseView, plans: readonly ReactionPlan[]): Shot[] => plans.flatMap(pl => pl.shots.map(s => ({
    by: String(s.reactor), on: String(pl.unit), hex: s.hex, from: unitAt(view, s.reactor).hex, ways: s.effect, kill: s.destroy, of: s.of,
    figures: [{ label: 'Column', value: signed(s.column) }],
  })));
  const riskOf = (shots: readonly Shot[]): number => 1 - shots.reduce((clear, s) => clear * (1 - (s.of > 0 ? s.ways / s.of : 0)), 1);

  /** The chance of each named case over a list of outcomes: `caseOf` names the case an outcome's result falls in. */
  const tally = (outcomes: readonly PortOutcome[], cases: readonly { name: string; effect: string }[], caseOf: (parts: readonly string[]) => number, keep = 3): Chance[] => {
    const of = outcomes[0]?.of ?? 1;
    const ways = cases.map(() => 0);
    for (const o of outcomes) {
      const k = caseOf(o.result === '-' ? [] : o.result.split(' / '));
      if (k >= 0 && k < ways.length) ways[k] = (ways[k] as number) + o.ways;
    }
    // The first `keep` cases are always shown, a chance of nothing included; the rest only when they can happen.
    return cases.map((c, k) => ({ name: c.name, effect: c.effect, ways: ways[k] as number, of })).filter((c, k) => c.ways > 0 || k < keep);
  };
  /** What becomes of a unit under the fire of a list of result parts ("reaction 12: suppressed"): 0 untouched, 1 suppressed, 2 destroyed. */
  const underFire = (parts: readonly string[]): number => {
    let worst = 0;
    for (const p of parts) {
      if (!p.startsWith('reaction ')) continue;
      if (p.endsWith(': destroyed')) worst = 2;
      else if (p.endsWith(': suppressed')) worst = Math.max(worst, 1);
    }
    return worst;
  };

  /** The chance of an attack whose table's first two rows are Destroyed and Suppressed, of some effect and of destroying (a Suppressed target is destroyed by either, 7.7). */
  const chanceOf = (rows: readonly Chance[], suppressed: boolean): { ways: number; kill: number; of: number } => {
    const destroyed = rows[0]?.ways ?? 0;
    const marked = rows[1]?.ways ?? 0;
    return { ways: destroyed + marked, kill: suppressed ? destroyed + marked : destroyed, of: rows[0]?.of ?? 1 };
  };

  /**
   * What a move that keeps (6.8) leaves the unit able to do, and what it could do from where it would stand: the enemy it
   * could fire on, or close assault, there (asked of the ruleset's own check, on the position with the unit moved there).
   */
  const keptWords = (v: ImpulseView, i: number, path: readonly number[]): string => {
    const cost = pathCost(ru(i).mover, unitAt(v, i).hex, path);
    const still = stillAfter(i, cost);
    const end = path[path.length - 1] as number;
    const there = { ...v, format: 'impulse/1' as const, units: v.units.map((u, k) => (k === i ? { ...u, hex: end, moved: true, moveUsed: cost } : u)) };
    const enemies = (rules.sideUnits[1 - ru(i).side] ?? []).filter(e => !unitAt(v, e).destroyed && unitAt(v, e).hex >= 0);
    const seat = v.viewer ?? seatOf(ru(i).side);
    const firing = still === STILL_FIRE;
    const can = enemies.filter(e => rules.check(there, seat, firing
      ? { type: 'fire', firers: [i], target: e }
      : { type: 'assault', units: [{ unit: i, path: [] }], target: e, advance: [] }) === null);
    const what = can.length === 0 ? '' : can.length <= 2 ? names(can) : plural(can.length, 'enemy unit');
    const shot = firing && AFTER_SHORT !== '' ? ` ${AFTER_SHORT}` : '';
    if (firing) return `Unit can still ${still}.${what !== '' ? ` From there: can fire on ${what}.${shot}` : ' From there: no enemy in sight yet.'}`;
    return `Unit can still ${still}.${what !== '' ? ` From there: can close assault ${what}.` : ''}`;
  };

  const forecast = (view: ImpulseView, action: ImpulseAction, ask: (q: OutcomeQuery) => readonly PortOutcome[]): Forecast => {
    const seat = view.viewer ?? '';
    const outcomes = (): readonly PortOutcome[] => ask({ seat, action });
    const blank: Forecast = { title: '', figures: [], tables: [], shots: [], risk: 0, note: '' };
    switch (action.type) {
      case 'fire': {
        const target = unitAt(view, action.target);
        const own = action.firers.map(f => rules.ownColumn(view, f, action.target, target.hex) ?? 0);
        const column = Math.max(...own) + supportOf(data.support.steps, own.length);
        const cover = rules.coverFire[target.hex] ?? 0;
        const rows = tally(outcomes(), [
          effectWords('destroyed'),
          target.suppressed ? { name: 'Suppressed', effect: 'already suppressed, so it is destroyed' } : effectWords('suppressed'),
          effectWords('none'),
        ], parts => (parts.includes('fire: destroyed') ? 0 : parts.includes('fire: suppressed') ? 1 : 2));
        // 6.8: a firer that has made its short move fires at `moveFire.steps` on its own column. The ruleset's own column
        // (and so every chance here) has it already: this only says so.
        const moved = action.firers.filter(f => unitAt(view, f).moved);
        const counted = moved.length > 0 && data.moveFire.steps !== 0
          ? action.firers.length > 1
            ? `${names(moved)} moved this turn: ${signed(data.moveFire.steps)} to ${moved.length > 1 ? 'each one’s' : 'that unit’s'} own column, counted in the chance.`
            : `Unit moved this turn: ${signed(data.moveFire.steps)}, counted in the chance.`
          : '';
        return {
          title: `${names(action.firers)} ${action.firers.length > 1 ? 'fire' : 'fires'} on ${nameOf(action.target)} (${sideName(ru(action.target).side)})`,
          figures: columnFigures(column),
          tables: [{ title: '', rows }],
          shots: [],
          risk: 0,
          note: `${action.firers.length > 1 ? `Best column ${signed(Math.max(...own))}, support ${signed(supportOf(data.support.steps, own.length))}. ` : ''}`
            + `Target in ${rules.board.coverOf(target.hex)}${cover > 0 ? `: ${signed(-cover)}` : ''}. ${counted !== '' ? `${counted} ` : ''}Every unit that fires becomes Spent and Revealed.`,
          chance: chanceOf(rows, target.suppressed),
          ...(counted !== '' ? { counted } : {}),
        };
      }
      case 'move':
      case 'dismount': {
        const plans = plansOf(view, action);
        const shots = shotsOf(view, plans);
        const to = action.type === 'move' ? (action.path[action.path.length - 1] as number) : action.hex;
        const title = action.type === 'move' ? `${nameOf(action.unit)} to ${label(to)}` : `${nameOf(action.unit)} dismounts to ${label(to)}`;
        // 6.8, 6.9: what the move leaves the unit, where a move may leave it Moved at all (the ruleset's own answer): what it
        // can still do, and what it could do from there; or that it will be Spent.
        const after = action.type === 'move' && (unitAt(view, action.unit).moved || rules.shortMove(action.unit) !== null || rules.assaultsAfterMove(action.unit))
          ? { after: rules.moveLeaves(view, action.unit, action.path) === 'moved'
            ? keptWords(view, action.unit, action.path)
            : 'Unit will be Spent.' }
          : {};
        const afterNote = after.after !== undefined ? ` ${after.after}` : '';
        if (shots.length === 0) return { ...blank, title, note: `No fire on the way.${afterNote}`, ...after };
        const rows = tally(outcomes(), [
          { name: 'Gets through', effect: '' },
          { name: 'Suppressed', effect: 'stops where it is hit' },
          effectWords('destroyed'),
        ], underFire);
        return {
          title, figures: [], tables: [{ title: `${nameOf(action.unit)} under fire`, rows }], shots, risk: riskOf(shots),
          note: `${plural(shots.length, 'enemy unit')} would fire. Each one that fires becomes Spent and Revealed.${afterNote}`,
          ...after,
        };
      }
      case 'assault': {
        const plans = plansOf(view, action);
        const shots = shotsOf(view, plans);
        const all = action.units.map(u => u.unit);
        const own = all.map(u => rules.assaultColumn(view, u, action.target));
        const column = Math.max(...own) + supportOf(data.assault.support, own.length);
        const target = unitAt(view, action.target);
        const rows = tally(outcomes(), [
          effectWords('destroyed'),
          target.suppressed ? { name: 'Suppressed', effect: 'already suppressed, so it is destroyed' } : effectWords('suppressed'),
          { name: 'Thrown back', effect: 'no effect, and every attacking unit is suppressed' },
          { name: 'Does not go in', effect: 'no unit reaches the target' },
        ], parts => (parts.includes('assault: destroyed') ? 0 : parts.includes('assault: suppressed') ? 1 : parts.includes('assault: none') ? 2 : 3));
        return {
          title: `${names(all)} ${all.length > 1 ? 'assault' : 'assaults'} ${nameOf(action.target)} (${sideName(ru(action.target).side)})`,
          figures: columnFigures(column),
          tables: [{ title: '', rows }],
          shots,
          risk: riskOf(shots),
          note: `${all.length > 1 ? `Best column ${signed(Math.max(...own))}, support ${signed(supportOf(data.assault.support, own.length))}. ` : ''}`
            + `${shots.length > 0 ? `${plural(shots.length, 'shot')} on the way in. ` : 'No fire on the way in. '}`
            + `${action.advance.length > 0 ? 'If the target is destroyed, your units advance into its hex.' : 'Your units stay where they are.'}`,
          chance: chanceOf(rows, target.suppressed),
          // 12.3: a Suppressed target is closed with at a better column.
          ...(!target.suppressed && data.assault.vsSuppressed > 0 ? { easier: `A close assault on a suppressed target gets ${signed(data.assault.vsSuppressed)}.` } : {}),
        };
      }
      case 'overrun': {
        const plans = plansOf(view, action);
        const shots = shotsOf(view, plans);
        const plan = plans[0];
        const exit = plan ? (plan.path[plan.path.length - 1] as number) : -1;
        const all = outcomes();
        const attacked = new Set<number>();
        for (const o of all) for (const p of o.result.split(' / ')) {
          const m = /^overrun on (\d+): /.exec(p);
          if (m) attacked.add(Number(m[1]));
        }
        const tables = [...attacked].sort((a, b) => a - b).map(t => ({
          title: `${nameOf(t)} (column ${signed(rules.overrunColumn(action.unit, t, action.target))})`,
          rows: tally(all, [
            effectWords('destroyed'),
            unitAt(view, t).suppressed ? { name: 'Suppressed', effect: 'already suppressed, so it is destroyed' } : effectWords('suppressed'),
            effectWords('none'),
            { name: 'Not reached', effect: 'the overrun is stopped on the way' },
          ], parts => (parts.includes(`overrun on ${t}: destroyed`) ? 0 : parts.includes(`overrun on ${t}: suppressed`) ? 1 : parts.includes(`overrun on ${t}: none`) ? 2 : 3)),
        }));
        if (shots.length > 0) {
          tables.push({
            title: `${nameOf(action.unit)} under fire`,
            rows: tally(all, [{ name: 'Gets through', effect: '' }, { name: 'Suppressed', effect: 'stops where it is hit' }, effectWords('destroyed')], underFire),
          });
        }
        return {
          title: `${nameOf(action.unit)} overruns ${label(action.target)} and comes out at ${exit >= 0 ? label(exit) : '?'}`,
          figures: [],
          tables,
          shots,
          risk: riskOf(shots),
          note: `${shots.length > 0 ? `${plural(shots.length, 'shot')} on the way. ` : 'No fire on the way. '}Unit ends Spent and Revealed in ${exit >= 0 ? label(exit) : 'the hex beyond'}.`,
          // Any effect: on at least one of the units in the hex.
          chance: {
            ways: all.filter(o => o.result.split(' / ').some(p => /^overrun on \d+: (destroyed|suppressed)$/.test(p))).reduce((a, o) => a + o.ways, 0),
            kill: all.filter(o => o.result.split(' / ').some(p => /^overrun on \d+: destroyed$/.test(p))).reduce((a, o) => a + o.ways, 0),
            of: all[0]?.of ?? 1,
          },
        };
      }
      case 'mission': {
        const t = ru(action.unit).type;
        const here = view.units.map((u, i) => (!u.destroyed && u.hex === action.hex ? i : -1)).filter(i => i >= 0);
        return {
          ...blank,
          title: `${nameOf(action.unit)}: ${action.kind === 'he' ? 'fire mission' : 'smoke'} on ${label(action.hex)}`,
          figures: action.kind === 'he' ? [{ label: 'Firepower', value: String(t.he) }, { label: 'Against armor', value: signed(data.artillery.vsHard) }] : [],
          note: `${LANDS} ${action.kind === 'he' ? 'It hits every unit then in the hex, friend or enemy.' : 'It blocks sight through the hex until the turn ends.'}`
            + ` ${here.length > 0 ? `In the hex now: ${names(here)}.` : 'The hex is empty now.'}`,
        };
      }
      case 'mount':
        return { ...blank, title: `${nameOf(action.unit)} mounts ${nameOf(action.transport)}`, note: 'Draws no fire. Unit will be Spent, but not the transport.' };
      default:
        return blank;
    }
  };

  /** How many of the events that follow are the effects of the one before them. */
  const absorbed = (rest: readonly ImpulseEvent[] | undefined, own: (e: ImpulseEvent) => boolean): number => {
    let n = 0;
    for (const e of rest ?? []) {
      if (!own(e)) break;
      n += 1;
    }
    return n;
  };
  const rollOf = (a: Attack): Roll => ({
    target: String(a.unit), dice: a.dice.slice(), result: effectWords(a.result).name, fate: fateOf(a.result), figures: [{ label: 'Column', value: signed(a.column) }],
  });
  /** For a unit that enters `path` and is then fired at: the place in the path of each shot's hex. */
  const haltsOf = (unit: number, path: readonly number[], rest: readonly ImpulseEvent[] | undefined): number[] => {
    const halts: number[] = [];
    for (const e of rest ?? []) {
      if (e.type === 'reaction') {
        if (e.mover !== unit) break;
        halts.push(path.lastIndexOf(e.hex));
      } else if (e.type !== 'revealed' && e.type !== 'destroyed' && e.type !== 'suppressed' && e.type !== 'missionLost') {
        break;
      }
    }
    return halts;
  };

  // ---- why something tried cannot be done (reading.ts, `why`) ----
  // Every reason is the ruleset's own: the thing tried is written as the action it would be and handed to the ruleset's
  // check, and the code it answers with is put into words, with the numbers it turns on (a distance by the hex module, a
  // sight line and a column by the ruleset's own functions, a cost by the board's steps through the path module's flood).

  const search = new PathSearch(rules.board);
  /** The ruleset's code for refusing an action of the view's seat, or null when it is legal. */
  const refusal = (v: ImpulseView, action: ImpulseAction): string | null => {
    if (v.viewer === null) return 'unknown_seat';
    return rules.check({ ...v, format: 'impulse/1' }, v.viewer, action)?.code ?? null;
  };
  /** The farthest a unit's direct fire reaches (7.3). */
  const reachOf = (i: number): number => Math.floor(data.rangeSteps.longFactor * ru(i).type.range);
  /** An attack whose column can do nothing on its best roll (7.5, 7.6). */
  const cannotHurt = (column: number): string => `no roll can hurt it (column ${signed(column)})`;
  /**
   * A close assault is made on armour only: the rules data says so with `assault.targets: hard`, a key the engine is
   * gaining (the owner's ruling of 2026-11-13) and that rules data without it does not have. Read as it is found, so
   * that the words are right with either.
   */
  const armourOnly = (data.assault as { readonly targets?: string }).targets === 'hard';
  const ARMOUR_ONLY = 'close assault works only on armor';
  /** The enemy units on the board that hold their hex against a unit's movement (6.3; 14.7 for a combat unit). */
  const heldAgainst = (v: ImpulseView, i: number): Uint8Array => {
    const blocked = new Uint8Array(rules.board.n);
    const me = ru(i);
    for (const e of rules.sideUnits[1 - me.side] ?? []) {
      const u = unitAt(v, e);
      if (u.destroyed || u.hex < 0) continue;
      const r = ru(e);
      if (me.combat && r.transport && !r.combat && rules.passengerOf(v, e) < 0) continue;
      blocked[u.hex] = 1;
    }
    return blocked;
  };
  const fullWords = (v: ImpulseView, i: number, hex: number): string => {
    const n = (rules.sideUnits[ru(i).side] ?? []).filter(o => o !== i && !unitAt(v, o).destroyed && unitAt(v, o).hex === hex).length;
    return `that hex already holds ${plural(n, 'unit')} of yours, the most it can`;
  };
  /** What a refusal code says of the unit itself, or of the moment; '' when the code is about something else. */
  const unitWords = (v: ImpulseView, i: number, code: string | null): string => {
    switch (code) {
      case 'not_your_turn':
        return 'it\'s your opponent\'s turn';
      case 'must_land':
        return 'your artillery lands first';
      case 'game_over':
        return 'the game is over';
      case 'wrong_stage':
        return v.stage === 'deploy' ? 'the set-up is not yet handed in' : 'the set-up is over';
      case 'unknown_seat':
        return 'you are watching';
      case 'not_your_unit':
        return 'that is an enemy unit';
      case 'not_on_board':
        return 'unit is destroyed';
      case 'not_activated':
        // No activation is open: the side's turn has not been opened yet, or cannot be (5.9: no unit of it could act).
        return refusal(v, { type: 'activateSide' }) === 'no_unit_can_act'
          ? 'none of your units can act' : 'your turn is still starting';
      case 'spent':
        return 'unit is Spent';
      case 'suppressed':
        return 'unit is Suppressed';
      // A Moved unit can do one thing more and nothing else (rulings 77, 80 and 81).
      case 'moved':
        return `unit has moved and can only ${stillOf(v, i)?.words ?? 'move on'}`;
      case 'mission_waiting':
        return 'unit has a fire mission waiting';
      case 'carried':
        return `unit is carried by ${nameOf(unitAt(v, i).carriedBy)}`;
      default:
        return '';
    }
  };
  /** With several units in what was tried, the one a reason is about is named in it ("unit is Spent": "Pz IV H 1b is Spent"). */
  const about = (many: boolean, i: number, words: string): string => {
    if (!many) return words;
    if (words.startsWith('unit ')) return `${nameOf(i)} ${words.slice(5)}`;
    if (words.startsWith('it ')) return `${nameOf(i)} ${words.slice(3)}`;
    if (words.startsWith('its ')) return `the ${words.slice(4)} of ${nameOf(i)}`;
    return `${words}, for ${nameOf(i)}`;
  };

  const whyFire = (v: ImpulseView, firers: readonly number[], t: number): string => {
    const many = firers.length > 1;
    const target = unitAt(v, t);
    for (const f of firers) {
      const code = refusal(v, { type: 'fire', firers: [f], target: t });
      const own = unitWords(v, f, code);
      if (own !== '') return about(many, f, own);
      switch (code) {
        case 'battery':
          return about(many, f, 'unit is a battery: it fires only missions');
        case 'bad_target':
        case 'unknown_unit':
          return 'that is not an enemy unit in play';
        case 'target_carried':
          return 'the target is carried';
        case 'no_firepower':
          return about(many, f, `unit has no firepower against ${ru(t).type.class === 'hard' ? 'armor' : 'soft targets'}`);
        case 'no_sight':
          return about(many, f, 'no line of sight');
        case 'out_of_range':
          return about(many, f, `unit reaches ${reachOf(f)} hexes, the target is ${distance(grid, unitAt(v, f).hex, target.hex)}`);
        case 'concealed':
          return `the target is hidden in ${rules.board.coverOf(target.hex)}`;
        case 'cannot_suppress':
          // Alone it can do nothing; with the others it may: that is judged below.
          if (!many) return cannotHurt(rules.ownColumn(v, f, t, target.hex) ?? 0);
          break;
        default:
          break;
      }
    }
    if (!many) return '';
    const code = refusal(v, { type: 'fire', firers: firers.slice().sort((a, b) => a - b), target: t });
    const own = firers.map(f => rules.ownColumn(v, f, t, target.hex) ?? 0);
    const best = Math.max(...own);
    if (code === 'not_within_support') {
      const weak = firers.filter((_, k) => (own[k] as number) < best - data.support.within);
      return `${names(weak)} ${weak.length > 1 ? 'are' : 'is'} too weak to join this fire`;
    }
    if (code === 'cannot_suppress') return cannotHurt(best + supportOf(data.support.steps, own.length));
    // Legal, and yet not among the actions offered: fewer of the same units give the same chances (17).
    if (code === null) return 'fewer of these units do as well';
    return '';
  };

  const whyMove = (v: ImpulseView, i: number, hex: number): string => {
    const u = unitAt(v, i);
    const t = ru(i).type;
    if (u.carriedBy >= 0) {
      const code = refusal(v, { type: 'dismount', unit: i, hex });
      const own = unitWords(v, i, code);
      if (own !== '') return own;
      if (code === 'dismount_far') return `unit can only get down next to ${nameOf(u.carriedBy)}`;
      if (code === 'enemy_hex') return 'the enemy holds that hex';
      if (code === 'stacking') return fullWords(v, i, hex);
      if (code === 'impassable') return 'unit cannot enter that hex';
      return '';
    }
    const own = unitWords(v, i, refusal(v, { type: 'move', unit: i, path: [hex] }));
    if (own !== '') return own;
    if (hex === u.hex) return 'unit is already there';
    if (t.move <= 0) return 'unit must be carried to move';
    const blocked = heldAgainst(v, i);
    if (blocked[hex] === 1) return 'the enemy holds that hex';
    const flood = search.flood(ru(i).mover, u.hex, blocked);
    const cost = flood.cost[hex] ?? -1;
    if (cost < 0) {
      if ((rules.enterable[ru(i).mover] as Uint8Array)[hex] !== 1) return `${t.mover} units cannot enter that hex`;
      return 'no way there is open';
    }
    const path = (routeTo(flood, hex) ?? []).slice(1);
    const code = refusal(v, { type: 'move', unit: i, path });
    if (code === 'over_allowance') return `it costs ${cost}, unit has ${t.move}`;
    // 6.9: a Moved unit moves on with what is left of its allowance.
    if (code === 'over_remaining') return `it costs ${cost}, unit has ${rules.allowanceLeft(v, i)} left`;
    if (code === 'stacking') return fullWords(v, i, hex);
    return '';
  };

  /** A unit's cheapest way to each hex beside a hex, the cheapest first: for a close assault (12.1) the target's own hex is never entered. */
  const approaches = (v: ImpulseView, i: number, hex: number, shut: boolean): { end: number; path: number[]; cost: number }[] => {
    const u = unitAt(v, i);
    const blocked = heldAgainst(v, i);
    if (shut) blocked[hex] = 1;
    const flood = search.flood(ru(i).mover, u.hex, blocked);
    const out: { end: number; path: number[]; cost: number }[] = [];
    for (let d = 0; d < 6; d++) {
      const n = rules.board.neighbour[hex * 6 + d] ?? -1;
      if (n < 0) continue;
      if (n === u.hex) out.push({ end: n, path: [], cost: 0 });
      else if ((flood.cost[n] ?? -1) >= 0 && blocked[n] !== 1) out.push({ end: n, path: (routeTo(flood, n) ?? []).slice(1), cost: flood.cost[n] as number });
    }
    return out.sort((a, b) => a.cost - b.cost);
  };

  const whyAssault = (v: ImpulseView, units: readonly number[], t: number | null): string => {
    const many = units.length > 1;
    const anyEnemy = (rules.sideUnits[1 - ru(units[0] ?? 0).side] ?? []).find(e => !unitAt(v, e).destroyed && unitAt(v, e).hex >= 0) ?? -1;
    for (const i of units) {
      const code = refusal(v, { type: 'assault', units: [{ unit: i, path: [] }], target: t ?? anyEnemy, advance: [] });
      const own = unitWords(v, i, code);
      if (own !== '') return about(many, i, own);
      if (code === 'cannot_assault') return about(many, i, 'unit cannot close assault');
      if (code === 'bad_target' || code === 'unknown_unit') return t === null ? 'no enemy unit is on the board' : 'that is not an enemy unit in play';
      if (code === 'target_carried' && t !== null) return 'the target is carried';
      if (code === 'assault_target_soft' && t !== null) return ARMOUR_ONLY;
    }
    // 12.1 (ruling 81): under assault.moveShare 0 a close assault moves no unit: every unit stands next to the target.
    const adjacent = data.assault.moveShare === 0;
    if (t === null) {
      const i = units[0] as number;
      if (adjacent) return `no enemy ${armourOnly ? 'armor' : 'unit'} next to unit`;
      return `no enemy ${armourOnly ? 'armor' : 'unit'} within ${Math.floor(ru(i).type.move * data.assault.moveShare)} movement of unit`;
    }
    const hex = unitAt(v, t).hex;
    if (adjacent) {
      const far = units.filter(i => distance(grid, whereIs(v, i), hex) !== 1);
      if (far.length > 0) return many ? `${names(far)} ${far.length > 1 ? 'are' : 'is'} not next to ${nameOf(t)}` : `unit is not next to ${nameOf(t)}`;
    }
    const chosen: AssaultUnit[] = [];
    for (const i of units) {
      const share = Math.floor(ru(i).type.move * data.assault.moveShare);
      const ways = approaches(v, i, hex, true);
      if (ways.length === 0) return about(many, i, `unit has no open way next to ${nameOf(t)}`);
      // The first way whose path the ruleset accepts (what it says of the column is judged below, for them all together).
      const codes = ways.map(w => refusal(v, { type: 'assault', units: [{ unit: i, path: w.path }], target: t, advance: [] }));
      const ok = codes.findIndex(c => c === null || c === 'cannot_suppress' || c === 'not_within_support');
      if (ok < 0) {
        if (codes.includes('assault_target_soft')) return ARMOUR_ONLY;
        if (codes.every(c => c === 'assault_too_far')) return about(many, i, `unit can use ${share} movement, getting next to the target costs ${(ways[0] as { cost: number }).cost}`);
        if (codes.every(c => c === 'assault_too_far' || c === 'stacking')) return about(many, i, `unit has no room next to the target within ${share} movement`);
        return '';
      }
      chosen.push({ unit: i, path: (ways[ok] as { path: number[] }).path });
    }
    const own = units.map(i => rules.assaultColumn(v, i, t));
    const best = Math.max(...own);
    const weak = units.filter((_, k) => (own[k] as number) < best - data.support.within);
    if (weak.length > 0) return `${names(weak)} ${weak.length > 1 ? 'are' : 'is'} too weak to join this assault`;
    const column = best + supportOf(data.assault.support, own.length);
    if (!rules.table.canSuppress(column)) return cannotHurt(column);
    if (many && refusal(v, { type: 'assault', units: chosen, target: t, advance: [] }) === 'stacking') return 'not enough room next to the target for all of them';
    return '';
  };

  const whyOverrun = (v: ImpulseView, i: number, hex: number): string => {
    const u = unitAt(v, i);
    const t = ru(i).type;
    const probe = refusal(v, { type: 'overrun', unit: i, path: [], target: hex >= 0 ? hex : u.hex });
    const own = unitWords(v, i, probe);
    if (own !== '') return own;
    if (probe === 'cannot_overrun') return 'unit cannot overrun';
    if (hex < 0) return 'no soft target in reach on open ground';
    // One way in for each side of the hex: the cheapest path to the hex beside it on that side that keeps out of the hex
    // itself and of the hex straight beyond it, where the unit comes out (12.7, 12.8).
    const held = heldAgainst(v, i);
    const ways: { path: number[]; beyond: number }[] = [];
    for (let d = 0; d < 6; d++) {
      const beyond = rules.board.neighbour[hex * 6 + d] ?? -1;
      const beside = rules.board.neighbour[hex * 6 + ((d + 3) % 6)] ?? -1;
      if (beside < 0) continue;
      if (beside === u.hex) {
        ways.push({ path: [], beyond });
        continue;
      }
      const blocked = Uint8Array.from(held);
      blocked[hex] = 1;
      if (beyond >= 0) blocked[beyond] = 1;
      if (blocked[beside] === 1) continue;
      const flood = search.flood(ru(i).mover, u.hex, blocked);
      if ((flood.cost[beside] ?? -1) >= 0) ways.push({ path: (routeTo(flood, beside) ?? []).slice(1), beyond });
    }
    if (ways.length === 0) return 'unit has no open way next to that hex';
    const codes = ways.map(w => refusal(v, { type: 'overrun', unit: i, path: w.path, target: hex }));
    if (codes.includes(null)) return '';
    if (codes.includes('overrun_ground')) return `${rules.board.coverOf(hex)} cannot be overrun`;
    if (codes.includes('overrun_hard')) return 'enemy armor is in that hex';
    if (codes.includes('overrun_no_target')) return 'no enemy unit is there';
    if (codes.includes('cannot_suppress')) return 'no roll can hurt them';
    if (codes.includes('over_allowance')) {
      // The whole movement of the cheapest way that fails only by its cost (12.8): the path, into the hex, out of it, and the fight.
      let least = Infinity;
      ways.forEach((w, k) => {
        if (codes[k] === 'over_allowance' && w.beyond >= 0) least = Math.min(least, pathCost(ru(i).mover, u.hex, [...w.path, hex, w.beyond]) + data.overrun.cost);
      });
      return least < Infinity ? `it costs ${least}, unit has ${t.move}` : '';
    }
    return 'no clear hex beyond it';
  };

  const whyMount = (v: ImpulseView, i: number, carrier: number | null): string => {
    const code = refusal(v, { type: 'mount', unit: i, transport: carrier ?? i });
    const own = unitWords(v, i, code);
    if (own !== '') return own;
    if (code === 'cannot_ride') return 'unit cannot be carried';
    if (carrier === null) return 'no free transport next to unit';
    switch (code) {
      case 'cannot_carry':
        return `${nameOf(carrier)} carries no units`;
      case 'enemy_transport':
        return `${nameOf(carrier)} is an enemy unit`;
      case 'bad_target':
        return `${nameOf(carrier)} is destroyed`;
      case 'transport_full':
        return `${nameOf(carrier)} already carries ${nameOf(rules.passengerOf(v, carrier))}`;
      case 'transport_suppressed':
        return `${nameOf(carrier)} is Suppressed`;
      case 'transport_far':
        return `${nameOf(carrier)} is not next to unit`;
      default:
        return '';
    }
  };

  const whyMission = (v: ImpulseView, i: number, hex: number, variant: string): string => {
    const u = unitAt(v, i);
    const t = ru(i).type;
    const code = refusal(v, { type: 'mission', unit: i, hex: hex >= 0 ? hex : Math.max(0, u.hex), kind: variant === 'screen' ? 'smoke' : 'he' });
    const own = unitWords(v, i, code);
    if (own !== '') return own;
    if (code === 'battery') return 'only a battery calls artillery';
    const span = `${t.indirect?.minRange ?? 0} to ${t.range}`;
    if (hex < 0) return 'none of your units sees a hex in range';
    if (code === 'mission_range') return `unit reaches ${span} hexes, that hex is ${distance(grid, u.hex, hex)}`;
    if (code === 'mission_unobserved') return 'none of your units sees that hex';
    return '';
  };

  const why = (v: ImpulseView, attempt: Attempt): string => {
    switch (attempt.kind) {
      case 'select': {
        const i = Number(attempt.unit);
        const u = unitAt(v, i);
        const probe: ImpulseAction = u.carriedBy >= 0
          ? { type: 'dismount', unit: i, hex: whereIs(v, i) }
          : { type: 'mount', unit: i, transport: i };
        const code = refusal(v, probe);
        // 6.8: a Moved unit can do one thing more. It is asked about here because nothing is listed for it: nothing to
        // attack, and no way on open to it.
        if (code === 'moved') return 'unit has moved and has nothing left to do';
        const own = unitWords(v, i, code);
        if (own !== '') return own;
        // Ready, and nothing is listed for it (it is asked only then): what it lacks, by what its type can do at all, so that a
        // player sees why (the owner, 2026-11-14, of the guns Tab stepped to: "a unit that can't do anything").
        const t = ru(i).type;
        const fire = t.indirect ? 'no hex to call fire on' : t.range > 0 && (t.ap > 0 || t.he > 0) ? 'no enemy it can fire on' : '';
        const go = t.move > 0 ? 'nowhere to move' : t.rides ? 'it moves only on a transport' : 'it cannot move';
        return fire !== '' ? `${fire}, and ${go}` : go;
      }
      case 'attack':
        return whyFire(v, ids(attempt.units), Number(attempt.target));
      case 'move':
        return whyMove(v, Number(attempt.unit), attempt.hex);
      case 'charge':
        return whyAssault(v, ids(attempt.units), attempt.target === null ? null : Number(attempt.target));
      case 'drive':
        return whyOverrun(v, Number(attempt.unit), attempt.hex);
      case 'board':
        return whyMount(v, Number(attempt.unit), attempt.carrier === null ? null : Number(attempt.carrier));
      case 'call':
        return whyMission(v, Number(attempt.unit), attempt.hex, attempt.variant);
      case 'place': {
        const i = Number(attempt.unit);
        const code = refusal(v, { type: 'place', unit: i, hex: attempt.hex });
        const own = unitWords(v, i, code);
        if (own !== '') return own;
        if (code === 'placement_zone') return 'that hex is outside your zone';
        if (code === 'impassable') return `${ru(i).type.mover} units cannot stand there`;
        if (code === 'stacking') return 'that hex is full';
        if (code === 'already_placed') return 'unit is placed already';
        return '';
      }
      case 'end': {
        // The turn is ended by ending the side's activation, or, when none could be opened, by the pass (5.5, 5.9).
        const code = refusal(v, { type: 'end' });
        return unitWords(v, 0, code === 'not_activated' ? refusal(v, { type: 'pass' }) : code);
      }
      default:
        return '';
    }
  };

  /** The steps of a turn's loop as a player meets them. */
  const STEPS = ['Your turn', 'The enemy\u2019s turn'];
  /** The units of a side that could still be given something to do (5.5, 5.7). */
  const ableOf = (v: ImpulseView, side: number): number[] => (rules.sideUnits[side] ?? []).filter(i => readyNow(v, i));
  /** A side's fire discipline: the setting all its formations share, or that they are not set alike. */
  const settingOf = (v: ImpulseView, side: number): string => {
    const all = new Set((rules.sideFormations[side] ?? []).map(f => v.formations[f]?.discipline).filter((d): d is Discipline => d !== undefined));
    const only = all.size === 1 ? [...all][0] : undefined;
    return only !== undefined ? SETTING_WORDS[only] : SETTING_MIXED;
  };
  /** The groups of every side as its units stand: units within GROUP_REACH of one another, and so on from unit to unit; a carried unit is where its carrier is. */
  const groupsOf = (v: ImpulseView): GroupNow[] => {
    const out: GroupNow[] = [];
    rules.sideUnits.forEach((list, side) => {
      const here = list.filter(i => whereIs(v, i) >= 0).sort((a, b) => a - b);
      const taken = new Set<number>();
      let number = 0;
      // The groups are numbered in the order of their first units, so a number stays with a group while its first unit does.
      for (const first of here) {
        if (taken.has(first)) continue;
        number += 1;
        const members = [first];
        taken.add(first);
        for (let k = 0; k < members.length; k++) {
          const at = whereIs(v, members[k] as number);
          for (const other of here) {
            if (taken.has(other) || distance(grid, at, whereIs(v, other)) > GROUP_REACH) continue;
            taken.add(other);
            members.push(other);
          }
        }
        out.push({ id: `${seatOf(side)}:${first}`, seat: seatOf(side), number, name: `Group ${number}`, units: members.sort((a, b) => a - b).map(String) });
      }
    });
    return out;
  };
  const SET_UP_STEPS = ['1 Place your units', '2 Hand in the set-up', 'Both sides are shown'];
  /** What a player does in the set-up, and why, in the guide and the phase's note. */
  const SET_UP_WHY = 'Place your units in your zone and hand in the set-up. The other side cannot see them until both sides have handed in.';

  const guide = (v: ImpulseView, seat: string | null): Guide => {
    const own = seat === null ? -1 : seats.indexOf(seat);
    if (v.stage === 'over') return { steps: STEPS, step: -1, title: 'Game over', todo: v.result ? ending(v.result.winner, v.result.reason, v) : '', why: '' };
    const SET_UP_NOTE = 'Neither side sees the other\u2019s units until both have handed in.';
    if (v.stage === 'deploy') {
      const finished = v.deployment?.finished ?? [];
      // The units still to place: a unit that starts carried is placed with its transport, and is not counted by itself.
      const placed = own >= 0 ? v.deployment?.placed[own] ?? [] : [];
      const waiting = own < 0 ? 0 : (rules.sideUnits[own] ?? []).filter(i => ru(i).setupCarrier < 0 && (placed[ru(i).place] ?? -1) < 0).length;
      if (own < 0) return { steps: SET_UP_STEPS, step: -1, title: 'Set-up', todo: 'Both sides are placing their units.', why: '' };
      if (finished[own] === true) {
        return {
          steps: SET_UP_STEPS, step: 2, title: 'Waiting for the other side', todo: 'Your set-up is handed in. The other side is still placing.',
          why: SET_UP_NOTE,
        };
      }
      return {
        steps: SET_UP_STEPS,
        step: waiting > 0 ? 0 : 1,
        title: waiting > 0 ? `Place your units \u00b7 ${waiting} to go` : 'Hand in the set-up',
        todo: waiting > 0 ? 'Pick a unit in the folder. Then click a tinted hex in your zone.' : 'Every unit is placed. Press Enter to hand in the set-up, or click a unit to move it.',
        why: SET_UP_WHY,
      };
    }
    const side = v.impulse;
    if (own < 0) {
      return { steps: STEPS, step: -1, title: `The ${sideName(side)} is moving`, todo: 'You are watching. The computer plays both sides.', why: '' };
    }
    if (side !== own) {
      return {
        steps: STEPS, step: 1, title: 'The enemy\u2019s turn',
        todo: 'Watch. Your Ready units fire automatically at enemies that move in their sight.',
        why: 'You can act again when your opponent ends the turn.',
      };
    }
    if (!v.activation && v.missions.some(m => m.due && ru(m.battery).side === side)) {
      return {
        steps: STEPS, step: 0, title: 'Your turn', todo: 'Your artillery lands first.',
        why: `Artillery you call lands at the start of ${data.initiative.policy === 'fixed' ? 'your next turn' : 'your first turn after your opponent\u2019s next turn'}.`,
      };
    }
    // (The turn ends by itself when no unit is left that could act, rule 5.7; before that the player ends it.)
    const able = ableOf(v, side).length;
    return {
      steps: STEPS, step: 0, title: 'Your turn',
      todo: able > 0 ? 'Click a unit to act with it. Press E when you\u2019re done.' : 'None of your units can act. Press E to end your turn.',
      why: 'Each of your units can do one thing this turn, in any order. A unit that has acted is Spent until your next turn. A unit that has not acted stays Ready and fires automatically at enemies that move in its sight.',
    };
  };

  const unitCard = (v: ImpulseView, unit: string): UnitCard => {
    const i = Number(unit);
    const u = unitAt(v, i);
    const r = ru(i);
    const t = r.type;
    const tiles: UnitCard['tiles'] = [
      { kind: 'fire', value: `${t.ap} / ${t.he}`, label: r.battery ? 'Missions AP / HE' : 'Fire AP / HE' },
      { kind: 'range', value: t.indirect ? `${t.indirect.minRange}\u2013${t.range}` : String(t.range), label: 'Range' },
      { kind: 'defence', value: String(t.defense), label: t.class === 'hard' ? 'Armor' : 'Defense' },
      { kind: 'move', value: String(t.move), label: 'Move' },
      { kind: 'close', value: String(t.close), label: 'Close' },
      { kind: 'cost', value: String(t.cost), label: 'Cost' },
    ];
    const stamp: UnitCard['stamp'] = u.destroyed ? { word: 'Destroyed', tone: 'alert' }
      : u.suppressed ? { word: 'Suppressed', tone: 'alert' }
        : v.stage !== 'play' ? null
          : u.spent ? { word: 'Spent', tone: 'faint' } : u.moved ? { word: 'Moved', tone: 'plain' } : { word: 'Ready', tone: 'plain' };
    const lines: Figure[] = [];
    const hex = whereIs(v, i);
    if (hex >= 0) lines.push({ label: 'Hex', value: `${label(hex)} \u00b7 ${coverWords(hex)}` });
    // Its fire discipline is its side's one switch; a scenario may start a side with its parts set unlike, and then each says its own.
    const f = v.formations[r.formation];
    if (f && v.stage !== 'deploy' && !u.destroyed && r.combat && !r.battery) lines.push({ label: 'Reaction fire', value: SETTING_WORDS[f.discipline] });
    if (t.range > 0 && !t.indirect) lines.push({ label: 'Long range', value: `up to ${Math.floor(data.rangeSteps.longFactor * t.range)} hexes, at ${signed(data.rangeSteps.long)}` });
    if (t.indirect) lines.push({ label: 'Fires', value: 'missions only, on hexes your units see' });
    const can = [t.assaults ? 'close assault' : '', t.overruns ? 'overrun' : '', t.rides ? 'ride a transport' : '', t.carries > 0 ? 'carry one unit' : '', t.move === 0 ? 'move only when carried' : ''].filter(x => x !== '');
    if (can.length > 0) lines.push({ label: 'Can', value: can.join(' \u00b7 ') });
    if (!u.destroyed) {
      const passenger = rules.passengerOf(v, i);
      const now: string[] = [];
      if (u.carriedBy >= 0) now.push(`carried by ${nameOf(u.carriedBy)}`);
      if (passenger >= 0) now.push(`carries ${nameOf(passenger)}`);
      if (u.moved) now.push(`can still ${stillOf(v, i)?.words ?? 'act'}`);
      if (u.revealed > 0) now.push('Revealed');
      if (r.battery && missionOf(v, i)) now.push('fire mission waiting');
      if (now.length > 0) lines.push({ label: 'Now', value: now.join(' \u00b7 ') });
    }
    return { tiles, stamp, lines };
  };

  return {
    info,
    forecast,
    guide,
    unitCard,

    position(v: ImpulseView): Position {
      const own = v.viewer === null ? -1 : seats.indexOf(v.viewer);
      const deploying = v.stage === 'deploy';
      const placed = deploying && own >= 0 ? v.deployment?.placed[own] ?? null : null;
      const unitsNow: UnitNow[] = v.units.map((u, i) => {
        const r = ru(i);
        let hex = whereIs(v, i);
        let carriedBy: string | null = u.carriedBy >= 0 && !u.destroyed ? String(u.carriedBy) : null;
        if (deploying) {
          // A seat's own placements are in its side's list; a unit that starts carried is with its transport.
          hex = -1;
          carriedBy = null;
          if (r.side === own && placed) {
            const at = r.setupCarrier >= 0 ? ru(r.setupCarrier).place : r.place;
            hex = placed[at] ?? -1;
            if (r.setupCarrier >= 0 && hex >= 0) carriedBy = String(r.setupCarrier);
          }
        }
        return {
          id: String(i), seat: seatOf(r.side), hex, destroyed: u.destroyed, suppressed: u.suppressed, spent: u.spent, target: null,
          carriedBy, revealed: u.revealed > 0 && !u.destroyed,
          // 6.8: Moved, a state beside Spent (never both), and what it can still do.
          ...(u.moved && !u.destroyed ? { moved: true, still: stillOf(v, i) ?? { words: 'move on', attack: 'charge' as const } } : {}),
        };
      });
      const finished = v.deployment?.finished ?? [];
      const deciding = v.stage === 'over' ? [] : deploying ? seats.filter((_, i) => finished[i] !== true) : [seatOf(v.impulse)];
      const side = v.impulse;
      const due = v.stage === 'play' && v.missions.some(m => m.due && ru(m.battery).side === side);
      let phase = '';
      const status: Figure[] = [];
      if (v.stage === 'play') {
        // Whose turn it is, as this viewer would say it.
        phase = due && !v.activation ? 'Fire missions land' : own < 0 ? `${shortName(side)} turn` : side === own ? 'Your turn' : 'The enemy\u2019s turn';
        const alive = (rules.sideUnits[side] ?? []).filter(i => !unitAt(v, i).destroyed).length;
        status.push({ label: 'Can still act', value: `${ableOf(v, side).length} of ${plural(alive, 'unit')}` });
        // 5.1: under `fixed` the same side moves first on every turn; under the other policies only this turn is known.
        status.push({ label: data.initiative.policy === 'fixed' ? 'Moves first every turn' : 'Moves first this turn', value: sideName(v.initiative) });
      }
      const markers: MarkerNow[] = [
        ...v.smoke.map(hex => ({ hex, kind: 'screen' as const, label: 'Smoke', seat: null })),
        ...v.missions.map(m => ({
          hex: m.hex, kind: 'incoming' as const, label: `${m.kind === 'he' ? 'Fire mission' : 'Smoke mission'}${m.due ? ', due' : ''}`, seat: seatOf(ru(m.battery).side),
        })),
      ];
      return {
        stage: deploying ? 'setup' : v.stage,
        turn: v.turn,
        phase,
        deciding,
        units: unitsNow,
        sides: v.sides.map((s, i) => ({
          seat: seatOf(i), score: s.score, losses: s.lost, ready: deploying ? finished[i] === true : true,
          note: deploying ? '' : `lost ${s.lost} of ${s.startCost}`,
          ...(v.stage === 'play' ? { setting: settingOf(v, i) } : {}),
        })),
        result: v.result ? { winner: seatOf(v.result.winner), reason: v.result.reason } : null,
        status,
        groups: v.stage === 'play' ? groupsOf(v) : [],
        markers,
        holders: v.holders.map(h => (h >= 0 ? seatOf(h) : null)),
      };
    },

    offer(v: ImpulseView, a: ImpulseAction): Offer<ImpulseAction> {
      switch (a.type) {
        case 'place':
          return { kind: 'place', unit: String(a.unit), hex: a.hex, action: a };
        case 'unplace':
          return { kind: 'takeBack', unit: String(a.unit), action: a };
        case 'submit':
          return { kind: 'ready', action: a };
        case 'takeSetup':
          return { kind: 'preset', action: a };
        case 'land':
          return { kind: 'auto', action: a };
        case 'activateSide':
          // The side's turn opens (5.9). It carries no choice: its only other use, the pass, is the turn ended with nothing done, which `end` does too.
          return { kind: 'auto', action: a };
        case 'pass':
          // Offered only while no activation is open: after `activateSide` has been sent it is not; before, it is the turn of a side none of whose units could act.
          return { kind: 'end', action: a };
        case 'discipline':
          return { kind: 'setting', of: String(a.formation), setting: SETTING_WORDS[a.setting], action: a };
        case 'fire':
          return { kind: 'attack', unit: String(a.firers[0] as number), with: a.firers.slice(1).map(String), target: String(a.target), action: a };
        case 'move': {
          const r = ru(a.unit);
          const cost = pathCost(r.mover, unitAt(v, a.unit).hex, a.path);
          // 6.8: a move that keeps leaves the unit Moved, not Spent; which moves keep is the ruleset's own answer. A short
          // move of armor is called so on the table. 6.9: a Moved unit's budget is what is left of its allowance.
          const keeps = rules.moveLeaves(v, a.unit, a.path) === 'moved';
          const still = keeps ? stillAfter(a.unit, cost) : '';
          return {
            kind: 'move', unit: String(a.unit), path: a.path.slice(), cost, budget: rules.allowanceLeft(v, a.unit),
            ...(keeps ? { keeps, still, ...(still === STILL_FIRE && shortMoves ? { tag: 'Short move' } : {}) } : {}), action: a,
          };
        }
        case 'dismount':
          return { kind: 'move', unit: String(a.unit), path: [a.hex], cost: 0, budget: 0, verb: 'dismounts', off: String(unitAt(v, a.unit).carriedBy), action: a };
        case 'assault':
          return {
            kind: 'charge', units: a.units.map(u => ({ unit: String(u.unit), path: u.path.slice() })), target: String(a.target),
            advance: a.advance.map(String), action: a,
          };
        case 'overrun': {
          const r = ru(a.unit);
          // The exit hex is not in the action: it follows from the path (12.7). The ruleset's own plan of the move names it.
          const plan = v.viewer === null ? null : rules.preview(v, v.viewer, a)?.[0] ?? null;
          const exit = plan ? (plan.path[plan.path.length - 1] as number) : -1;
          const cost = pathCost(r.mover, unitAt(v, a.unit).hex, exit >= 0 ? [...a.path, a.target, exit] : a.path) + data.overrun.cost;
          return { kind: 'drive', unit: String(a.unit), path: a.path.slice(), through: a.target, exit, cost, budget: r.type.move, action: a };
        }
        case 'mount':
          return { kind: 'board', unit: String(a.unit), carrier: String(a.transport), action: a };
        case 'mission':
          return { kind: 'call', unit: String(a.unit), hex: a.hex, variant: a.kind === 'he' ? 'call' : 'screen', action: a };
        case 'end':
          return { kind: 'end', action: a };
        default:
          return { kind: 'other', action: a };
      }
    },

    attackQuery(attackers: readonly string[], target: string): OutcomeQuery {
      const firers = ids(attackers).sort((a, b) => a - b);
      return { seat: seatOf(ru(firers[0] ?? 0).side), action: { type: 'fire', firers, target: Number(target) } };
    },

    attackFigures(v: ImpulseView, attackers: readonly string[], target: string): Figure[] {
      const t = Number(target);
      const hex = unitAt(v, t).hex;
      const own = ids(attackers).map(f => rules.ownColumn(v, f, t, hex) ?? 0);
      return own.length === 0 ? [] : columnFigures(Math.max(...own) + supportOf(data.support.steps, own.length));
    },

    resultWords(result: string): { name: string; effect: string } {
      return effectWords(result.replace(/^.*: /, ''));
    },

    phaseNote(v: ImpulseView): string {
      if (v.stage === 'deploy') return SET_UP_WHY;
      if (v.stage !== 'play') return '';
      return 'Each unit can do one thing a turn. A unit that has not acted stays Ready and fires automatically at enemies that move in its sight. Every unit is Ready again when its side\u2019s turn begins.';
    },

    unitFigures(v: ImpulseView, unit: string): Figure[] {
      const i = Number(unit);
      const u = unitAt(v, i);
      const r = ru(i);
      const t = r.type;
      const out: Figure[] = [];
      const fire = [t.ap > 0 ? `${t.ap} at armor` : '', t.he > 0 ? `${t.he} at soft targets` : ''].filter(s => s !== '');
      out.push({ label: r.battery ? 'Missions' : 'Fire', value: fire.length > 0 ? fire.join(', ') : 'none' });
      if (t.range > 0) out.push({ label: 'Range', value: t.indirect ? `${t.indirect.minRange} to ${t.range} hexes, on hexes your units see` : `${t.range} hexes (up to ${Math.floor(data.rangeSteps.longFactor * t.range)} at ${signed(data.rangeSteps.long)})` });
      out.push({ label: 'Defense', value: `${t.defense} (${t.class === 'hard' ? 'armor' : 'soft'})` });
      out.push({ label: 'Movement', value: t.move > 0 ? `${t.move} ${t.mover}` : 'none (must be carried)' });
      out.push({ label: 'Close combat', value: String(t.close) });
      const can = [t.assaults ? 'close assault' : '', t.overruns ? 'overrun' : '', t.rides ? 'ride a transport' : '', t.carries > 0 ? 'carry one unit' : ''].filter(s => s !== '');
      if (can.length > 0) out.push({ label: 'Can', value: can.join(', ') });
      out.push({ label: 'Cost', value: String(t.cost) });
      const f = v.formations[r.formation];
      if (f && v.stage !== 'deploy' && r.combat && !r.battery) out.push({ label: 'Reaction fire', value: `${SETTING_WORDS[f.discipline]}. ${SETTING_LONG[f.discipline]}` });
      if (u.destroyed) {
        out.push({ label: 'Now', value: 'destroyed' });
        return out;
      }
      const hex = whereIs(v, i);
      if (hex >= 0) out.push({ label: 'Hex', value: `${label(hex)} ${coverWords(hex)}` });
      const passenger = rules.passengerOf(v, i);
      const state: string[] = [];
      if (u.carriedBy >= 0) state.push(`carried by ${nameOf(u.carriedBy)}`);
      if (passenger >= 0) state.push(`carries ${nameOf(passenger)}`);
      if (u.suppressed) state.push('suppressed');
      if (v.stage === 'play') state.push(u.spent ? 'Spent' : u.moved ? `Moved (can still ${stillOf(v, i)?.words ?? 'act'})` : 'Ready');
      if (u.revealed > 0) state.push('Revealed');
      if (r.battery && missionOf(v, i)) state.push('fire mission waiting');
      if (state.length > 0) out.push({ label: 'Now', value: state.join(', ') });
      return out;
    },

    endingWords(v: ImpulseView): string {
      return v.result ? ending(v.result.winner, v.result.reason, v) : '';
    },

    why,

    step(e: ImpulseEvent, before: ImpulseView, rest?: readonly ImpulseEvent[]): Step {
      const seatOfUnit = (i: number): string => seatOf(ru(i).side);
      /** A label at a unit's counter: plain, or good or bad news for its own side. */
      const badge = (i: number, words: string, news?: 'good' | 'bad'): Badge => ({
        hex: whereIs(before, i), unit: String(i), words, ...(news ? { seat: seatOfUnit(i), news } : {}),
      });
      switch (e.type) {
        case 'placed':
          return { kind: 'placed', unit: String(e.unit), hex: e.hex ?? -1, say: null };
        case 'submitted':
          return { kind: 'ready', seat: seatOf(e.side), say: { seat: seatOf(e.side), text: e.setup ? 'Takes the scenario\u2019s set-up.' : 'Hands in the set-up.' } };
        case 'deployed':
          return { kind: 'revealed', say: { seat: null, text: 'Both sides are on the board.' } };
        case 'impulse':
          return { kind: 'other', say: e.due.length > 0 ? { seat: seatOf(e.side), text: `${plural(e.due.length, 'fire mission')} due.` } : null };
        case 'activated':
          // A side's turn opens (5.9): nothing a player gives or is shown. The turn's own lines are in the log (its first move, and its end).
          return { kind: 'other', say: null };
        case 'activationEnded':
          return { kind: 'other', hold: 'phase', say: { seat: seatOf(e.side), text: `The ${sideName(e.side)} ends its turn.` } };
        case 'passed':
          return { kind: 'other', hold: 'phase', say: { seat: seatOf(e.side), text: `The ${sideName(e.side)} ends its turn without acting.` } };
        case 'disciplineSet': {
          // The side's one switch sets its formations one after another: it is said once, when the last of them is set.
          const side = rules.formationInfo[e.formation]?.side ?? 0;
          const alike = (rules.sideFormations[side] ?? []).every(f => f === e.formation || before.formations[f]?.discipline === e.setting);
          return { kind: 'other', say: alike ? { seat: seatOf(side), text: `The ${sideName(side)} sets reaction fire to ${SETTING_WORDS[e.setting]}.` } : null };
        }
        case 'moved': {
          const from = whereIs(before, e.unit);
          const last = e.path[e.path.length - 1] as number;
          const passenger = rules.passengerOf(before, e.unit);
          return {
            kind: 'moved', unit: String(e.unit), path: e.path.slice(), cost: e.cost,
            ...(e.hex !== last ? { to: e.hex } : {}),
            halts: haltsOf(e.unit, e.path, rest),
            ...(passenger >= 0 ? { with: [String(passenger)] } : {}),
            say: {
              seat: seatOfUnit(e.unit),
              text: `${nameOf(e.unit)}${passenger >= 0 ? `, carrying ${nameOf(passenger)},` : ''} moves ${from >= 0 ? `${label(from)} to ` : 'to '}${label(last)}, cost ${e.cost}.`
                + `${e.after === 'moved' ? ` Unit can still ${stillAfter(e.unit, e.cost)}.` : ''}`,
            },
            // 6.8: a move that keeps leaves it Moved. The table says so where it comes to rest.
            ...(e.after === 'moved' ? { badges: [{ hex: e.hex, unit: String(e.unit), words: `Moved: can ${stillAfter(e.unit, e.cost) === STILL_FIRE ? 'fire' : 'assault'} or move on`, late: true }] } : {}),
          };
        }
        case 'dismounted':
          return {
            kind: 'moved', unit: String(e.unit), path: [e.hex], cost: 0, halts: haltsOf(e.unit, [e.hex], rest),
            say: { seat: seatOfUnit(e.unit), text: `${nameOf(e.unit)} dismounts at ${label(e.hex)}.` },
            badges: [{ hex: e.hex, unit: String(e.unit), words: 'Dismounted' }],
          };
        case 'reaction': {
          const words = effectWords(e.result);
          return {
            kind: 'attack', attackers: [String(e.reactor)], target: String(e.mover), dice: e.dice.slice(), result: words.name, fate: fateOf(e.result),
            figures: columnFigures(e.column), title: 'Reaction fire', at: e.hex, chance: chanceAt(e.column),
            absorb: absorbed(rest, x => (x.type === 'revealed' && x.unit === e.reactor) || ((x.type === 'suppressed' || x.type === 'destroyed') && x.unit === e.mover)
              || x.type === 'missionLost' || x.type === 'setDown'),
            say: {
              seat: seatOfUnit(e.reactor),
              text: `${nameOf(e.reactor)} fires on ${nameOf(e.mover)} as it enters ${label(e.hex)}: column ${signed(e.column)}, ${rolled(e.dice)}: ${words.name.toLowerCase()}.`,
            },
          };
        }
        case 'fired': {
          const words = effectWords(e.result);
          return {
            kind: 'attack', attackers: e.firers.map(String), target: String(e.target), dice: e.dice.slice(), result: words.name, fate: fateOf(e.result),
            figures: columnFigures(e.column), title: 'Fire', chance: chanceAt(e.column),
            absorb: absorbed(rest, x => (x.type === 'revealed' && e.firers.includes(x.unit)) || ((x.type === 'suppressed' || x.type === 'destroyed') && x.unit === e.target)
              || x.type === 'missionLost' || x.type === 'setDown'),
            say: {
              seat: seatOfUnit(e.firers[0] as number),
              text: `${names(e.firers)} ${e.firers.length > 1 ? 'fire' : 'fires'} on ${nameOf(e.target)}: column ${signed(e.column)}, ${rolled(e.dice)}: ${words.name.toLowerCase()}.`,
            },
          };
        }
        case 'assaulted': {
          const words = e.result === 'none' ? { name: 'Thrown back' } : effectWords(e.result);
          const hex = whereIs(before, e.target);
          const tail = e.result === 'none' ? ` ${names(e.units)} ${e.units.length > 1 ? 'are' : 'is'} suppressed.` : e.advanced.length > 0 ? ` ${names(e.advanced)} ${e.advanced.length > 1 ? 'advance' : 'advances'} into ${label(hex)}.` : '';
          return {
            kind: 'attack', attackers: e.units.map(String), target: String(e.target), dice: e.dice.slice(), result: words.name, fate: fateOf(e.result),
            figures: columnFigures(e.column), title: 'Close assault', chance: chanceAt(e.column),
            advance: e.advanced.map(u => ({ unit: String(u), hex })),
            absorb: absorbed(rest, x => x.type === 'revealed' || x.type === 'suppressed' || x.type === 'destroyed' || x.type === 'missionLost' || x.type === 'setDown'),
            say: {
              seat: seatOfUnit(e.units[0] as number),
              text: `${names(e.units)} ${e.units.length > 1 ? 'assault' : 'assaults'} ${nameOf(e.target)}: column ${signed(e.column)}, ${rolled(e.dice)}: ${words.name.toLowerCase()}.${tail}`,
            },
          };
        }
        case 'overran': {
          const results = e.attacks.map(a => `${nameOf(a.unit)} ${effectWords(a.result).name.toLowerCase()} (column ${signed(a.column)}, ${rolled(a.dice)})`);
          return {
            kind: 'strikes', title: 'Overrun', attackers: [String(e.unit)], hex: e.target, rolls: e.attacks.map(rollOf), through: { unit: String(e.unit), exit: e.exit },
            absorb: absorbed(rest, x => x.type === 'suppressed' || x.type === 'destroyed' || x.type === 'missionLost' || x.type === 'setDown'),
            say: { seat: seatOfUnit(e.unit), text: `${nameOf(e.unit)} overruns ${label(e.target)} and comes out at ${label(e.exit)}${results.length > 0 ? `: ${results.join('; ')}` : ''}.` },
          };
        }
        case 'suppressed':
          return { kind: 'other', say: null, badges: [badge(e.unit, 'Suppressed', 'bad')] };
        case 'destroyed':
          return {
            kind: 'removed', unit: String(e.unit), say: { seat: seatOfUnit(e.unit), text: `${nameOf(e.unit)} is destroyed.` },
            badges: [badge(e.unit, 'Destroyed', 'bad')],
          };
        case 'recovered':
          return {
            kind: 'recovered', unit: String(e.unit), say: { seat: seatOfUnit(e.unit), text: `${nameOf(e.unit)} recovers.` },
            badges: [badge(e.unit, 'Recovers', 'good')],
          };
        case 'revealed':
          return { kind: 'other', say: null };
        case 'mounted':
          return {
            kind: 'boarded', unit: String(e.unit), carrier: String(e.transport), say: { seat: seatOfUnit(e.unit), text: `${nameOf(e.unit)} mounts ${nameOf(e.transport)}.` },
            badges: [{ hex: whereIs(before, e.transport), unit: String(e.transport), words: 'Mounted' }],
          };
        case 'setDown':
          return {
            kind: 'other', say: { seat: seatOfUnit(e.unit), text: `${nameOf(e.unit)} is set down at ${label(e.hex)}, suppressed.` },
            badges: [{ hex: e.hex, unit: String(e.unit), words: 'Set down, suppressed', seat: seatOfUnit(e.unit), news: 'bad' }],
          };
        case 'missionCalled':
          return {
            kind: 'other', hold: 'phase',
            say: { seat: seatOfUnit(e.battery), text: `${nameOf(e.battery)} calls ${e.kind === 'he' ? 'a fire mission' : 'smoke'} on ${label(e.hex)}.` },
            badges: [{ hex: e.hex, unit: null, words: e.kind === 'he' ? 'Fire mission called' : 'Smoke called' }],
          };
        case 'missionLanded': {
          if (e.kind === 'smoke') {
            return {
              kind: 'other', hold: 'result',
              say: { seat: seatOfUnit(e.battery), text: `Smoke from ${nameOf(e.battery)} lands on ${label(e.hex)}.` },
              badges: [{ hex: e.hex, unit: null, words: 'Smoke' }],
            };
          }
          const results = e.attacks.map(a => `${nameOf(a.unit)} ${effectWords(a.result).name.toLowerCase()} (column ${signed(a.column)}, ${rolled(a.dice)})`);
          return {
            kind: 'strikes', title: 'Fire mission', attackers: [String(e.battery)], hex: e.hex, rolls: e.attacks.map(rollOf),
            absorb: absorbed(rest, x => x.type === 'suppressed' || x.type === 'destroyed' || x.type === 'missionLost' || x.type === 'setDown'),
            say: { seat: seatOfUnit(e.battery), text: `The fire mission of ${nameOf(e.battery)} lands on ${label(e.hex)}${results.length > 0 ? `: ${results.join('; ')}` : ': nothing is there'}.` },
          };
        }
        case 'missionLost':
          return {
            kind: 'other', say: { seat: seatOfUnit(e.battery), text: `The mission of ${nameOf(e.battery)} on ${label(e.hex)} is lost.` },
            badges: [{ hex: e.hex, unit: null, words: 'Mission lost', seat: seatOfUnit(e.battery), news: 'bad' }],
          };
        case 'smoke':
          return { kind: 'other', say: e.placed ? null : { seat: null, text: `The smoke on ${label(e.hex)} clears.` } };
        case 'objective':
          return {
            kind: 'other', hold: 'score', say: { seat: seatOf(e.holder), text: `The ${sideName(e.holder)} takes ${label(e.hex)}.` },
            badges: [{ hex: e.hex, unit: null, words: `Taken by the ${shortName(e.holder)}`, seat: seatOf(e.holder), news: 'good' }],
          };
        case 'scored':
          return {
            kind: 'other', hold: 'score',
            say: { seat: seatOf(e.side), text: `The ${sideName(e.side)} scores ${e.objectives} for objectives and ${e.kills} for kills: ${e.total} in all.` },
          };
        case 'turnEnded':
          return {
            kind: 'phase', turn: e.turn + 1, seat: seatOf(e.initiative), phase: `${shortName(e.initiative)} turn`, fresh: true,
            say: { seat: seatOf(e.initiative), text: `Turn ${e.turn + 1} begins. The ${sideName(e.initiative)} moves first.` },
          };
        case 'ended':
          return { kind: 'ended', winner: seatOf(e.winner), say: { seat: null, text: ending(e.winner, e.reason, before) } };
        default:
          return { kind: 'other', say: null };
      }
    },
  };
}
