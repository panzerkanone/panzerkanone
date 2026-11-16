/**
 * The reading of the reference ruleset (engine/rulesets/reference): the one
 * file of the game layer that knows the shape of its views, actions and events
 * and puts them into words. It decides nothing. Every number it shows it reads
 * from the ruleset's data, its scenario, a view or an event, or asks of the
 * ruleset's own public answers (attackOf, defenseOf, coverDefenseAt, the
 * compiled board's step costs).
 *
 * One number is worked out here because nothing hands it over: the cost of an
 * offered move, summed along the offered path from the compiled board's step
 * costs (the same sum the ruleset writes into the move's event). It is a
 * request to the engine's owner (docs/review/M5/game-layer-handover.md).
 */
import { labelOf } from '../../../engine/core/hex';
import type { ReferenceRuleset, TypeInfo } from '../../../engine/rulesets/reference/rules';
import type { UnitTypeData } from '../../../engine/rulesets/reference/data';
import type { AttackQuery, RefAction, RefEvent, RefView, UnitState } from '../../../engine/rulesets/reference/types';
import type { Figure, GameInfo, Offer, Position, Reading, SideInfo, Step, UnitInfo } from './reading';

export type ReferenceReading = Reading<RefView, RefAction, RefEvent, AttackQuery>;

function capital(s: string): string {
  return s.length === 0 ? s : `${s.charAt(0).toUpperCase()}${s.slice(1)}`;
}

/** "a", "a and b", "a, b and c". */
function listed(names: readonly string[]): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1] as string}`;
}

export function readReference(rules: ReferenceRuleset): ReferenceReading {
  const grid = rules.board.grid;
  const data = rules.data;
  const scenario = rules.scenario;
  const seats = rules.seats;
  const typeData = new Map<string, UnitTypeData>(data.unitTypes.map(t => [t.id, t]));
  const label = (hex: number): string => labelOf(grid, hex);
  const seatOf = (side: number): string => seats[side] ?? '';
  const sideName = (side: number): string => scenario.sides[side]?.name ?? seatOf(side);
  const phaseName = (phase: string): string => capital(phase);

  const typeOfId = (id: string): UnitTypeData => {
    const t = typeData.get(id);
    if (!t) throw new Error(`reading: unknown unit type '${id}'`);
    return t;
  };

  // Every unit of the match, with a name that tells it from the others of its type and side.
  const sides: SideInfo[] = scenario.sides.map((s, i) => ({ seat: s.id, name: s.name, stock: i === 0 ? 'first' : 'second' }));
  const units: UnitInfo[] = [];
  rules.rosters.forEach((roster, side) => {
    const perType = new Map<string, number>();
    for (const id of roster) perType.set(rules.unitTypes[id] as string, (perType.get(rules.unitTypes[id] as string) ?? 0) + 1);
    const seen = new Map<string, number>();
    for (const id of roster) {
      const t = typeOfId(rules.unitTypes[id] as string);
      const k = (seen.get(t.id) ?? 0) + 1;
      seen.set(t.id, k);
      units[id] = {
        id: String(id),
        seat: seatOf(side),
        name: (perType.get(t.id) ?? 0) > 1 ? `${t.name} ${k}` : t.name,
        face: {
          stock: side === 0 ? 'first' : 'second',
          title: t.name,
          kind: t.id,
          numbers: {
            attack: data.targetClasses.map(c => String(t.firepower[c] ?? 0)).join('/'),
            range: String(t.range),
            defence: String(t.defense),
            move: String(t.allowance),
          },
        },
      };
    }
  });

  const zones: Record<string, number[]> = {};
  rules.zones.forEach((zone, side) => {
    const list: number[] = [];
    zone.forEach((inZone, hex) => {
      if (inZone === 1) list.push(hex);
    });
    zones[seatOf(side)] = list;
  });

  const info: GameInfo = {
    title: scenario.name,
    turns: scenario.turns,
    grid: { cols: grid.cols, rows: grid.rows },
    sides,
    units,
    objectives: rules.objectives.map(o => ({ hex: o.hex, points: o.points })),
    zones,
    dice: { count: data.dice.count, faces: data.dice.faces },
  };

  const nameOf = (unit: number): string => units[unit]?.name ?? `unit ${unit}`;
  const unitAt = (view: RefView, id: string): UnitState => {
    const u = view.units[Number(id)];
    if (!u) throw new Error(`reading: no unit '${id}'`);
    return u;
  };
  const ids = (list: readonly string[]): number[] => list.map(Number);

  const coverWords = (hex: number): string => {
    const bonus = rules.coverDefenseAt(hex);
    const cover = rules.board.coverOf(hex);
    return bonus > 0 ? `+${bonus} in ${cover}` : '';
  };

  const ending = (winner: number, reason: string): string => {
    if (reason === 'broken') {
      if (winner < 0) return 'Both sides are broken: a draw.';
      const loser = sideName(winner === 0 ? 1 : 0);
      return `${sideName(winner)} wins: ${loser} is broken, down to ${scenario.brokenAt} units.`;
    }
    if (reason === 'turn-limit') {
      return winner < 0 ? `A draw: level on points after turn ${scenario.turns}.` : `${sideName(winner)} wins on points after turn ${scenario.turns}.`;
    }
    return winner < 0 ? `A draw (${reason}).` : `${sideName(winner)} wins (${reason}).`;
  };

  const resultWords = (result: string): { name: string; effect: string } => {
    if (result === 'destroyed') return { name: 'Destroyed', effect: 'taken off the board' };
    if (result === 'suppressed') return { name: 'Suppressed', effect: 'cannot act until its side’s next turn ends' };
    if (result === 'none') return { name: 'No effect', effect: '' };
    return { name: capital(result), effect: '' };
  };

  return {
    info,

    position(v: RefView): Position {
      const own = v.viewer;
      const placed = own >= 0 ? v.sides[own]?.placed ?? null : null;
      const roster = own >= 0 ? rules.rosters[own] ?? [] : [];
      return {
        stage: v.stage,
        turn: v.turn,
        phase: v.phase === '' ? '' : phaseName(v.phase),
        deciding: v.stage === 'over' ? [] : v.stage === 'setup' ? seats.filter((_, i) => v.sides[i]?.submitted !== true) : [seatOf(v.side)],
        units: v.units.map(u => {
          let hex = u.hex;
          // During set-up a seat's own placements are in its side's list, in force order.
          if (v.stage === 'setup' && u.side === own && placed !== null) {
            const j = roster.indexOf(u.id);
            hex = j >= 0 && j < placed.length ? (placed[j] as number) : -1;
          }
          return {
            id: String(u.id), seat: seatOf(u.side), hex, destroyed: u.destroyed, suppressed: u.suppressed, spent: u.spent,
            target: u.target >= 0 ? String(u.target) : null,
          };
        }),
        sides: v.sides.map((s, i) => ({ seat: seatOf(i), score: s.score, losses: s.losses, ready: s.submitted })),
        result: v.result ? { winner: v.result.winner >= 0 ? seatOf(v.result.winner) : null, reason: v.result.reason } : null,
      };
    },

    offer(v: RefView, a: RefAction): Offer<RefAction> {
      switch (a.type) {
        case 'place':
          return { kind: 'place', unit: String(a.unit), hex: a.hex, action: a };
        case 'submit':
          return { kind: 'ready', action: a };
        case 'fire':
          return { kind: 'attack', unit: String(a.unit), target: String(a.target), action: a };
        case 'hold':
          return { kind: 'hold', unit: String(a.unit), action: a };
        case 'move': {
          const u = unitAt(v, String(a.unit));
          const t: TypeInfo = rules.typeOf(u);
          let at = u.hex;
          let cost = 0;
          for (const h of a.path) {
            cost += rules.board.cost(t.mover, at, h) ?? 0;
            at = h;
          }
          return { kind: 'move', unit: String(a.unit), path: a.path.slice(), cost, budget: t.allowance, action: a };
        }
        case 'end':
          return { kind: 'end', action: a };
        default:
          return { kind: 'other', action: a };
      }
    },

    attackQuery(attackers: readonly string[], target: string): AttackQuery {
      return { attackers: ids(attackers), target: Number(target) };
    },

    attackFigures(v: RefView, attackers: readonly string[], target: string): Figure[] {
      const t = unitAt(v, target);
      const attack = rules.attackOf(v.units, ids(attackers), t.id);
      const defence = rules.defenseOf(v.units, t.id);
      const cover = coverWords(t.hex);
      return [
        { label: 'Attack', value: String(attack) },
        { label: 'Defence', value: cover === '' ? String(defence) : `${defence} (${cover})` },
      ];
    },

    resultWords,

    phaseNote(v: RefView): string {
      // The ruleset's data names its phases and no more; these two lines put what its fire and
      // movement rules say of each into a sentence (a request: the data should carry them).
      if (v.stage !== 'play') return '';
      if (v.phase === 'gunnery') return 'Fire is declared now and resolved together when the phase ends. A unit that fires does not move this turn.';
      if (v.phase === 'manoeuvre') return 'Each unit that has not fired may move once.';
      return '';
    },

    unitFigures(v: RefView, unit: string): Figure[] {
      const u = unitAt(v, unit);
      const t = typeOfId(u.type);
      const out: Figure[] = [
        { label: 'Firepower', value: data.targetClasses.map(c => `${t.firepower[c] ?? 0} on ${c}`).join(', ') },
        { label: 'Range', value: String(t.range) },
        { label: 'Defence', value: `${t.defense} (${t.class} target)` },
        { label: 'Movement', value: `${t.allowance} (${t.mover})` },
        { label: 'Worth', value: String(t.value) },
      ];
      if (u.destroyed) {
        out.push({ label: 'Now', value: 'destroyed' });
      } else if (u.hex >= 0) {
        const cover = coverWords(u.hex);
        // "Has acted" is about the side whose turn it is; the other side's is last turn's news.
        const itsTurn = v.stage === 'play' && u.side === v.side;
        const state = u.suppressed ? 'suppressed' : u.target >= 0 ? `aiming at ${nameOf(u.target)}` : !itsTurn ? 'not its turn' : u.spent ? 'has acted this turn' : 'ready';
        out.push({ label: 'Hex', value: `${label(u.hex)} ${rules.board.coverOf(u.hex)}${cover === '' ? '' : ` (${cover.replace(/ in .*/, '')} defence)`}` });
        out.push({ label: 'Now', value: state });
      }
      return out;
    },

    endingWords(v: RefView): string {
      return v.result ? ending(v.result.winner, v.result.reason) : '';
    },

    step(e: RefEvent, before: RefView): Step {
      switch (e.type) {
        case 'placed':
          return { kind: 'placed', unit: String(e.unit), hex: e.hex, say: null };
        case 'submitted':
          return { kind: 'ready', seat: seatOf(e.side), say: { seat: seatOf(e.side), text: 'Set-up handed in.' } };
        case 'revealed':
          return { kind: 'revealed', say: { seat: null, text: 'Both sides are on the board.' } };
        case 'phase_begun': {
          const phase = phaseName(e.phase);
          return {
            kind: 'phase', turn: e.turn, seat: seatOf(e.side), phase, fresh: e.fresh,
            say: { seat: seatOf(e.side), text: e.fresh ? `Turn ${e.turn}: ${phase.toLowerCase()}.` : `${phase}.` },
          };
        }
        case 'declared': {
          const side = before.units[e.unit]?.side ?? 0;
          return {
            kind: 'declared', unit: String(e.unit), target: String(e.target),
            say: { seat: seatOf(side), text: `${nameOf(e.unit)} aims at ${nameOf(e.target)}.` },
          };
        }
        case 'held': {
          const side = before.units[e.unit]?.side ?? 0;
          return { kind: 'held', unit: String(e.unit), say: { seat: seatOf(side), text: `${nameOf(e.unit)} holds.` } };
        }
        case 'moved': {
          const u = before.units[e.unit];
          const from = u ? u.hex : -1;
          const to = e.path[e.path.length - 1] as number;
          return {
            kind: 'moved', unit: String(e.unit), path: e.path.slice(), cost: e.cost,
            say: { seat: seatOf(u?.side ?? 0), text: `${nameOf(e.unit)} moves ${from >= 0 ? `${label(from)} to ` : 'to '}${label(to)}, cost ${e.cost}.` },
          };
        }
        case 'attack': {
          const side = before.units[e.attackers[0] as number]?.side ?? 0;
          const words = resultWords(e.result);
          const sum = e.dice.reduce((a, b) => a + b, 0);
          const rolled = e.dice.length > 0 ? `dice ${e.dice.join(' + ')} = ${sum}` : 'no roll needed';
          const names = e.attackers.map(nameOf);
          return {
            kind: 'attack', attackers: e.attackers.map(String), target: String(e.target), dice: e.dice.slice(),
            result: words.name, fate: e.result === 'destroyed' ? 'destroyed' : e.result === 'suppressed' ? 'marked' : 'none',
            figures: [{ label: 'Attack', value: String(e.attack) }, { label: 'Defence', value: String(e.defense) }],
            say: {
              seat: seatOf(side),
              text: `${listed(names)} ${names.length > 1 ? 'fire' : 'fires'} on ${nameOf(e.target)}: ${e.attack} against ${e.defense}, ${rolled}: ${words.name.toLowerCase()}.`,
            },
          };
        }
        case 'recovered': {
          const side = before.units[e.unit]?.side ?? 0;
          return { kind: 'recovered', unit: String(e.unit), say: { seat: seatOf(side), text: `${nameOf(e.unit)} recovers.` } };
        }
        case 'scored':
          return {
            kind: 'scored', seat: seatOf(e.side), hex: e.hex, points: e.points,
            say: { seat: seatOf(e.side), text: `Holds ${label(e.hex)}: ${e.points} points.` },
          };
        case 'ended':
          return { kind: 'ended', winner: e.winner >= 0 ? seatOf(e.winner) : null, say: { seat: null, text: ending(e.winner, e.reason) } };
        default:
          return { kind: 'other', say: null };
      }
    },
  };
}
