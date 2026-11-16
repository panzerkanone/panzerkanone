/**
 * The planning opponent of Formation Impulse: the computer's seat in the game
 * as it ships, at three levels (easy, normal, hard). It follows the engine's
 * agent contract (engine/ai/agent.ts): a view, the legal list and its own
 * random stream in, one of the listed actions out; no memory between calls; no
 * randomness but the stream. The stand-in it replaces (opponent-impulse.ts) is
 * kept, and any of them can be made by its id (opponentById).
 *
 * How it decides. One decision is one action, and the whole turn is thought
 * through again at every decision, since the dice of the last action are
 * known by then.
 *
 *   What a position is worth is judged where the side's own move ends: the
 *   ruleset's own `end` is applied, and the position at the next decision is
 *   valued in points of the final margin (worth): the score; each objective
 *   for the turns that remain, by who holds it, who stands on it and who can
 *   reach it; what each side has left; what the side that moves next can do to
 *   the other (volleys, danger: its fire as its best use of its shooters,
 *   from where they stand or after a short move, close assaults by every
 *   company that could reach a tank, overruns, shells on the way); and what
 *   the units left Ready would do to the enemy's moves. A side that is losing
 *   on points as things stand counts its own risks for less: it must attack.
 *
 *   What an action is worth is the mean of that over the ruleset's exact list
 *   of the action's outcomes (branches: reaction fire, a stopped move and a
 *   thrown-back assault are all in it), with what the units still to act could
 *   do in each outcome (potential), less the same of the position as it is.
 *   Every action is first given a quick guess; the best guesses are looked at
 *   exactly.
 *
 *   The order of a turn comes from that potential (an action that opens
 *   something for the others gains by it, and a unit's action costs what else
 *   it could have done) and from chains valued the same way: a short move and
 *   the shot from the new place, alone or with the units that already have the
 *   target in their sights; fire on a tank and then the charge; fire on a unit
 *   that would react and then the move it would have shot at. The first step
 *   of the best chain is what is sent.
 *
 * It takes the best action while one is worth taking, sets each formation's
 * fire discipline for the enemy's move, and ends. Every column and chance is
 * the ruleset's (ownColumn, assaultColumn, overrunColumn, the fire table,
 * planPath, preview, branches, the landing of a mission); every weight of its
 * own is in opponent-table.ts, and a level is a row of that table: how many of
 * its units it thinks of together, how far it looks, a seeded chance of a
 * lesser choice, what a Ready unit is worth to it. No level sees more of the
 * game than its seat does, and none has a clock: its effort is counted.
 *
 * It does not fire smoke, and it looks one enemy move ahead by estimate, not
 * by search.
 */
import { distance } from '../../../engine/core/hex';
import { PathSearch, routeTo } from '../../../engine/core/path';
import type { FloodResult } from '../../../engine/core/path';
import type { RandomStream } from '../../../engine/core/random';
import type { Agent } from '../../../engine/ai/agent';
import type { ImpulseRuleset, UnitInfo } from '../../../engine/rulesets/impulse/rules';
import type { Branch, Discipline, ImpulseAction, ImpulseView, MissionState, PlannedShot, Position, UnitState } from '../../../engine/rulesets/impulse/types';
import { DISCIPLINES } from '../../../engine/rulesets/impulse/types';
import { ImpulseOpponent } from './opponent-impulse';
import { DEFAULT_LEVEL, LEVELS, TABLES } from './opponent-table';
import type { Level, PlannerTable } from './opponent-table';

/** The planning opponent's id without its level; an opponent's own id ends in its level: impulse-planner/1:normal. */
export const PLANNER_ID = 'impulse-planner/1';
export const STAND_IN_ID = 'impulse-stand-in/1';

/** The id of the planning opponent at a level: what a record of a game names. */
export function plannerId(level: Level): string {
  return `${PLANNER_ID}:${level}`;
}

/** The opponents of the real rules: the planning opponent at each level (the game seats `normal`), and the stand-in it replaced. */
export const OPPONENT_IDS: readonly string[] = [...LEVELS.map(plannerId), STAND_IN_ID];

export type ImpulseAgent = Agent<ImpulseView, ImpulseAction>;

/** An opponent of the real rules by its id; null for an id that is not one. */
export function opponentById(id: string, rules: ImpulseRuleset): ImpulseAgent | null {
  for (const level of LEVELS) if (id === plannerId(level)) return new ImpulsePlanner(rules, level);
  if (id === STAND_IN_ID) return new ImpulseOpponent(rules);
  return null;
}

type Act<T extends ImpulseAction['type']> = Extract<ImpulseAction, { type: T }>;

/** A won game, in points: more than any margin. */
const WON = 1000;
const END: ImpulseAction = { type: 'end' };

/** The chance (0 to 1) that a unit is destroyed, and that it is left Suppressed. */
interface Risk {
  readonly kill: number;
  readonly sup: number;
  /**
   * Of those, what the enemy's close assaults add (rulings 80 to 82), for a tank: weighed apart from the rest, like the
   * reaction fire a move draws (`closeFear`). The Suppressed part may be below 0: a charge turns Suppressed into destroyed.
   */
  readonly charge?: { readonly kill: number; readonly sup: number };
}

/** An enemy company that could close assault a tank: its own column on the tank unhurt and Suppressed, and the chance it gets beside it able to. */
interface Charger {
  readonly col: number;
  readonly colDown: number;
  readonly p: number;
}

const NO_RISK: Risk = { kill: 0, sup: 0 };

/** What a side's fire is reckoned to do to each unit of the other: its chances of being unhurt, Suppressed, destroyed; and the shooters used. */
interface Volleys {
  readonly fine: Float64Array;
  readonly down: Float64Array;
  readonly dead: Float64Array;
  readonly used: Uint8Array;
}

/** One action the side could take now, with what it is thought to be worth. */
interface Option {
  readonly action: ImpulseAction;
  /** The units it uses up. */
  readonly units: readonly number[];
  /** The quick guess of its worth, in points. */
  guess: number;
  /** Its worth by the exact look-ahead, less that of the position as it is: with what the units still to act could do in each (NaN until looked at). */
  gain: number;
  /** The worth of taking it and ending the move, less the worth of ending now. */
  real: number;
  /** In plain words, why it would be done. */
  why: string;
}

/** What the opponent chose and why (for a written game). */
export interface Chosen {
  readonly action: ImpulseAction;
  readonly why: string;
  /** What it thought the action worth, in points of the final margin. */
  readonly gain: number;
}

function supportOf(steps: readonly number[], n: number): number {
  let total = 0;
  for (let k = 0; k < n - 1; k++) total += steps[Math.min(k, steps.length - 1)] ?? 0;
  return total;
}

export class ImpulsePlanner implements ImpulseAgent {
  /** Its id names its level; an opponent made with values of its own besides (a tool's) has a `*` after it. */
  readonly id: string;
  readonly level: Level;
  readonly rules: ImpulseRuleset;
  readonly table: PlannerTable;
  readonly search: PathSearch;
  /** Per unit: the hexes of open ground it covers in a turn (for how many turns away a place is). */
  readonly pace: readonly number[];
  /** For a tool that asks how a decision was reached: handed every action looked at exactly, with its guess and its worth. Changes no decision. */
  trace: ((looked: readonly { action: ImpulseAction; guess: number; gain: number; why: string }[]) => void) | null = null;

  /** The opponent at a level (`normal` when none is given); `over` lays other values on that level's table, for a tool that tunes it. */
  constructor(rules: ImpulseRuleset, level: Level = DEFAULT_LEVEL, over: Partial<PlannerTable> = {}) {
    this.rules = rules;
    this.level = level;
    this.table = { ...TABLES[level], ...over };
    this.id = Object.keys(over).length > 0 ? `${plannerId(level)}*` : plannerId(level);
    this.search = new PathSearch(rules.board);
    const open = rules.rules.movement.enter.open;
    this.pace = rules.unitInfo.map(u => {
      const step = open[u.type.mover];
      return typeof step === 'number' && step > 0 ? Math.max(1, Math.floor(u.type.move / step)) : 1;
    });
  }

  decide(view: ImpulseView, legal: readonly ImpulseAction[], stream: RandomStream): ImpulseAction {
    return this.choose(view, legal, stream).action;
  }

  /** The decision with its reason. */
  choose(view: ImpulseView, legal: readonly ImpulseAction[], stream: RandomStream): Chosen {
    const first = (type: ImpulseAction['type']): ImpulseAction | undefined => legal.find(a => a.type === type);
    const fallback = first('end') ?? first('pass') ?? first('takeSetup') ?? (legal[0] as ImpulseAction);
    const plain = (action: ImpulseAction, why: string): Chosen => ({ action, why, gain: 0 });
    if (view.stage === 'deploy') return plain(first('takeSetup') ?? first('submit') ?? fallback, 'takes the set-up as written');
    const land = first('land');
    if (land) return plain(land, 'the shells it called for arrive');
    const side = view.viewer === null ? -1 : this.rules.seats.indexOf(view.viewer);
    if (side < 0) return plain(fallback, '');
    if (!view.activation) return this.order(view, side, legal, stream) ?? plain(first('pass') ?? fallback, 'nothing is worth an order');
    const mind = new Mind(this, view, side);
    // A change of the whole side's fire discipline under way is finished first, as one press of the side's switch is.
    const going = mind.settingUnderWay(legal);
    if (going) return going;
    const best = mind.best(legal, stream, this.trace);
    if (best) return best;
    const setting = mind.discipline(legal);
    if (setting) return setting;
    return plain(first('end') ?? fallback, 'nothing more is worth doing this turn');
  }

  /**
   * An order to give. Where the whole side moves there is one, and it is given whenever a unit could act. Where formations
   * are activated one at a time: the one whose units' best actions promise most, and a pass when none promises anything.
   */
  private order(view: ImpulseView, side: number, legal: readonly ImpulseAction[], stream: RandomStream): Chosen | null {
    const whole = legal.find(a => a.type === 'activateSide');
    if (whole) return { action: whole, why: 'begins its turn', gain: 0 };
    let best: ImpulseAction | null = null;
    let bestValue = -Infinity;
    for (const a of legal) {
      if (a.type !== 'activate' && a.type !== 'activateUnit') continue;
      const after = this.rules.branches(view, a)[0]?.view;
      let value = 0;
      if (after && after.activation && after.impulse === side) value = new Mind(this, after, side).promise(this.rules.legalActions(after));
      value += stream.unit() * 0.001;
      if (value > bestValue) {
        best = a;
        bestValue = value;
      }
    }
    return best !== null && bestValue >= this.table.orderWorth ? { action: best, why: 'activates the formation with most to do', gain: bestValue } : null;
  }
}

/**
 * One decision's thinking: the position, what the ruleset says comes after it, and what has been worked out of it so far.
 * Made anew for every decision. (It is exported for the tests, which hold its reckoning of reach against the ruleset's own
 * legal list.)
 */
export class Mind {
  private readonly rules: ImpulseRuleset;
  private readonly t: PlannerTable;
  private readonly search: PathSearch;
  private readonly pace: readonly number[];
  private readonly view: ImpulseView;
  private readonly side: number;
  private readonly foe: number;
  private readonly n: number;
  /** The position after this side's `end`: who moves next, in which turn, who is Ready then. */
  private readonly ahead: ImpulseView;
  /** The enemy moves next; and it does so before the turn's scoring. */
  private readonly foeNext: boolean;
  private readonly sameTurn: boolean;
  /** After its next move the enemy moves again before this side does. */
  private readonly foeTwice: boolean;
  /**
   * What this side leaves Ready now is still Ready when the enemy next moves, so holding a unit back buys its reaction fire:
   * the enemy moves next, in the same turn; or, under `ready.when: own-turn` (ruling 84, rules 5.10), in the next turn too,
   * for then no unit is made Ready at the end phase, only a side's own when its turn begins.
   */
  private readonly coverCounts: boolean;
  /** The position the enemy's next move starts from, as far as which of its units can act: under own-turn, `ahead` (made Ready). */
  private readonly foeAt: ImpulseView;
  /** Positions with one side made Ready (5.10), for a move of that side's that comes after one of the other's. */
  private readonly readied = new WeakMap<Position, Position[]>();
  /**
   * How far this side is from winning as things stand, 0 to 1: its score and the objectives as they are now held, counted
   * to the last turn, against `decided`. A side that will lose if nothing changes has less to lose by what it risks.
   */
  private readonly behind: number;
  /** The worth of ending now; and that with what the units still to act could do (the measure every action is held against). */
  private readonly base: number;
  private readonly seen: number;
  /** Per side: 1 where the side's units close a hex to the other side's movement, in the position as it is. */
  private readonly closed: readonly Uint8Array[];
  /** Per unit: what its reaction fire is worth if it is left Ready where it stands. */
  private readonly cover: Float64Array;
  private readonly floods = new Map<number, FloodResult>();
  /** Per position judged: the hexes closed to each side's movement in it, and the floods of its units from where they stand. */
  private readonly shuts = new WeakMap<Position, { closed: Uint8Array[]; floods: Map<number, FloodResult> }>();
  private readonly stands = new Map<number, number[]>();
  private readonly shorts = new Map<number, number[]>();
  private readonly approaches = new Map<number, number>();
  private readonly shells = new Map<string, Risk>();
  private readonly afters = new Map<ImpulseView, ImpulseView>();
  /** Exact look-aheads made (the measure of a decision's work). */
  looks = 0;

  constructor(planner: ImpulsePlanner, view: ImpulseView, side: number) {
    this.rules = planner.rules;
    this.t = planner.table;
    this.search = planner.search;
    this.pace = planner.pace;
    this.view = view;
    this.side = side;
    this.foe = 1 - side;
    this.n = this.rules.board.n;
    const closed = [new Uint8Array(this.n), new Uint8Array(this.n)];
    view.units.forEach((u, i) => {
      if (u.destroyed || u.hex < 0) return;
      const info = this.info(i);
      // An empty transport without firepower closes its hex to nobody that fights (the ruleset's own floods say the same).
      if (info.transport && !info.combat && this.rules.passengerOf(view, i) < 0) return;
      (closed[info.side] as Uint8Array)[u.hex] = 1;
    });
    this.closed = closed;
    this.ahead = this.after(view);
    this.foeNext = this.ahead.impulse === this.foe;
    this.sameTurn = this.ahead.turn === view.turn && this.ahead.stage !== 'over';
    this.foeTwice = this.foeNext && this.sameTurn && this.movesAgain(this.ahead);
    this.coverCounts = this.foeNext && this.ahead.stage === 'play' && (this.sameTurn || this.rules.ownTurnReady);
    this.foeAt = this.rules.ownTurnReady ? this.ahead : view;
    this.behind = this.howFarBehind(this.ahead);
    this.cover = new Float64Array(view.units.length);
    if (this.coverCounts) this.weighCover();
    this.base = this.worth(this.ahead);
    this.seen = this.base + this.t.potential * this.potential(view);
  }

  private info(i: number): UnitInfo {
    return this.rules.unitInfo[i] as UnitInfo;
  }

  /** The margin the game would end on if every objective stayed with its holder and nothing else were destroyed, as a share of `decided` it falls short by. */
  private howFarBehind(a: ImpulseView): number {
    if (a.stage !== 'play' || this.t.desperate <= 0) return 0;
    const rules = this.rules;
    const [kp, kq] = rules.killShare;
    const me = a.sides[this.side] as ImpulseView['sides'][number];
    const them = a.sides[this.foe] as ImpulseView['sides'][number];
    const sum = (list: readonly number[]): number => list.reduce((p, q) => p + q, 0);
    let race = me.score - them.score + (kp / kq) * (sum(them.lostThisTurn) - sum(me.lostThisTurn));
    const left = Math.max(0, rules.lastTurn - a.turn + 1);
    rules.objectives.forEach((o, k) => {
      race += left * o.points * (a.holders[k] === this.side ? 1 : a.holders[k] === this.foe ? -1 : 0);
    });
    // A tie at the last turn goes to the side that did not move first on turn 1 (the ruleset's own rule, asked of the position).
    if (race === 0 && a.firstInitiative === this.side) race = -1;
    return Math.max(0, Math.min(1, -race / Math.max(1, this.t.decided)));
  }

  /** Asked of the ruleset: in a position where the enemy is to move, would it move again straight after (were it to do nothing with this move)? */
  private movesAgain(at: ImpulseView): boolean {
    try {
      let v: ImpulseView = { ...at, viewer: this.rules.seats[this.foe] as string };
      if (v.missions.some(m => m.due && this.info(m.battery).side === this.foe)) v = (this.rules.branches(v, { type: 'land' })[0] as Branch<ImpulseView>).view;
      const next = (this.rules.branches(v, { type: 'pass' })[0] as Branch<ImpulseView>).view;
      return next.stage === 'play' && next.impulse === this.foe;
    } catch {
      return false;
    }
  }

  private name(i: number): string {
    const u = this.info(i);
    return `${u.type.name} ${u.id}`;
  }

  private label(hex: number): string {
    return this.rules.label(hex);
  }

  /** What a unit is worth in points when it is lost: what its loss scores, and what it would still have done. */
  private full(i: number, turn: number): number {
    const [kp, kq] = this.rules.killShare;
    const left = Math.max(1, this.rules.lastTurn - turn + 1);
    return this.info(i).type.cost * (kp / kq + this.t.future * (left / this.rules.lastTurn));
  }

  /** The position after this side ends its move there: the ruleset's own `end`. A position already past it is itself. */
  private after(v: ImpulseView): ImpulseView {
    if (v.stage !== 'play' || !v.activation || v.impulse !== this.side) return v;
    const known = this.afters.get(v);
    if (known) return known;
    const out = (this.rules.branches(v, END)[0] as Branch<ImpulseView>).view;
    this.afters.set(v, out);
    return out;
  }

  // ---------------------------------------------------------------------------
  // where units could go (the board's own search; estimates of the enemy's reach)
  // ---------------------------------------------------------------------------

  /** The cheapest cost for a unit standing in a hex to reach every hex within a limit; -1 beyond it. */
  private flood(unit: number, hex: number, limit: number): Int32Array {
    return this.floodOf(unit, hex, limit).cost;
  }

  /** The same, with the routes (each reached hex's cheapest way back). */
  private floodOf(unit: number, hex: number, limit: number): FloodResult {
    const key = (unit * this.n + hex) * 64 + Math.min(63, Math.max(0, limit));
    const known = this.floods.get(key);
    if (known) return known;
    const info = this.info(unit);
    const out = this.search.flood(info.mover, hex, this.closed[1 - info.side] as Uint8Array, limit);
    this.floods.set(key, out);
    return out;
  }

  /** The hexes closed to each side's movement in a position (6.3: a hex that holds a unit of the other side; an empty transport without firepower closes it to nobody that fights, 14.7). */
  private shutIn(pos: Position): { closed: Uint8Array[]; floods: Map<number, FloodResult> } {
    const known = this.shuts.get(pos);
    if (known) return known;
    const closed = [new Uint8Array(this.n), new Uint8Array(this.n)];
    pos.units.forEach((u, i) => {
      if (u.destroyed || u.hex < 0) return;
      const info = this.info(i);
      if (info.transport && !info.combat && this.rules.passengerOf(pos, i) < 0) return;
      (closed[info.side] as Uint8Array)[u.hex] = 1;
    });
    const out = { closed, floods: new Map<number, FloodResult>() };
    this.shuts.set(pos, out);
    return out;
  }

  private stepOpen(unit: number, from: number, to: number): boolean {
    const c = this.rules.board.cost(this.info(unit).mover, from, to);
    return c !== null && c >= 0 && (this.closed[1 - this.info(unit).side] as Uint8Array)[to] !== 1;
  }

  /**
   * The hexes from which a unit standing in a hex, and not yet moved, could make a close assault this move: where it
   * stands; where a move that leaves it movement over may end (rulings 80 and 81: it is then Moved, and may assault from
   * there); and, where the rules data gives a close assault an approach of its own (`assault.moveShare` above 0, the rule
   * as it was), where that approach may end.
   */
  private stand(unit: number, hex: number): number[] {
    const key = unit * this.n + hex;
    const known = this.stands.get(key);
    if (known) return known;
    const info = this.info(unit);
    const out = [hex];
    if (info.type.move > 0) {
      const approach = this.rules.rules.assault.moveShare > 0;
      const share = approach ? Math.floor(info.type.move * this.rules.rules.assault.moveShare) : -1;
      const over = this.rules.assaultsAfterMove(unit);
      const limit = Math.max(share, over ? info.type.move : -1);
      if (limit > 0) {
        const f = this.floodOf(unit, hex, limit);
        // Whether a move leaves movement over is the ruleset's own answer (moveLeaves), asked of the cheapest way there.
        const from = (this.view.units[unit] as UnitState).hex === hex && !(this.view.units[unit] as UnitState).moved ? this.view : (this.with(this.view, unit, { hex, moved: false, carriedBy: -1 }) as ImpulseView);
        for (let h = 0; h < this.n; h++) {
          const c = f.cost[h] as number;
          if (h === hex || c < 0) continue;
          if (c <= share) out.push(h);
          else if (over && this.rules.moveLeaves(from, unit, (routeTo(f, h) as number[]).slice(1)) === 'moved') out.push(h);
        }
      }
      // 6.2's one hex is the approach's alone: a move of one hex that costs all the unit has leaves it Spent.
      if (approach && this.rules.rules.move.alwaysOne) {
        for (let d = 0; d < 6; d++) {
          const h = this.rules.board.neighbour[hex * 6 + d] as number;
          if (h >= 0 && !out.includes(h) && this.stepOpen(unit, hex, h)) out.push(h);
        }
      }
    }
    this.stands.set(key, out);
    return out;
  }

  /** Could a unit standing in `from` close with a unit standing in `hex` this move? */
  canClose(unit: number, from: number, hex: number): boolean {
    const g = this.rules.board.grid;
    if (distance(g, from, hex) === 1) return true;
    for (const s of this.stand(unit, from)) if (s !== hex && s !== from && distance(g, s, hex) === 1) return true;
    return false;
  }

  /**
   * What the enemy's close assaults in its next move are reckoned to add to the chance that a unit of this side is destroyed,
   * were it to end this move in a hex, Spent (after what the enemy's fire is reckoned to do to it there). For the tests.
   */
  closeRisk(unit: number, hex: number): number {
    const s = this.view.units[unit] as UnitState;
    const there = this.with(this.view, unit, { hex, carriedBy: -1, spent: true, moved: false }) as ImpulseView;
    return this.danger(there, this.foe, !this.foeNext, unit, hex, s.suppressed, s.revealed > 0, true).charge?.kill ?? 0;
  }

  /** The hexes a unit standing in a hex could reach by a short move (and still fire). */
  private shortReach(unit: number, hex: number): number[] {
    const key = unit * this.n + hex;
    const known = this.shorts.get(key);
    if (known) return known;
    const most = this.rules.shortMove(unit);
    const out: number[] = [];
    if (most !== null && most > 0) {
      const cost = this.flood(unit, hex, most);
      for (let h = 0; h < this.n; h++) if (h !== hex && (cost[h] as number) >= 0) out.push(h);
    }
    this.shorts.set(key, out);
    return out;
  }

  /**
   * The hex a short move would take a unit to that sees `hex` from nearest by, or -1 when none does (or none nearer than
   * where it stands, when it sees the hex already).
   */
  private approach(unit: number, from: number, hex: number): number {
    const key = (unit * this.n + from) * this.n + hex;
    const known = this.approaches.get(key);
    if (known !== undefined) return known;
    const g = this.rules.board.grid;
    let near = -1;
    let nearD = this.rules.sees(this.view, from, hex) ? distance(g, from, hex) : Infinity;
    for (const r of this.shortReach(unit, from)) {
      const d = distance(g, r, hex);
      if (d < nearD && d >= 1 && this.rules.sees(this.view, r, hex)) {
        near = r;
        nearD = d;
      }
    }
    this.approaches.set(key, near);
    return near;
  }

  /** Could a unit standing in `from` overrun a hex this move? The way in, the hex beyond, and the cost of the fight. */
  canOverrun(unit: number, from: number, hex: number): boolean {
    const info = this.info(unit);
    const b = this.rules.board;
    const room = info.type.move - this.rules.rules.overrun.cost;
    if (room <= 0) return false;
    const cost = this.flood(unit, from, room);
    const steps = b.stepCost[info.mover] as Int32Array;
    const shut = this.closed[1 - info.side] as Uint8Array;
    for (let d = 0; d < 6; d++) {
      const before = b.neighbour[hex * 6 + d] as number;
      if (before < 0) continue;
      const dir = (d + 3) % 6;
      const beyond = b.neighbour[hex * 6 + dir] as number;
      if (beyond < 0 || shut[beyond] === 1) continue;
      const c1 = steps[before * 6 + dir] as number;
      const c2 = steps[hex * 6 + dir] as number;
      if (c1 < 0 || c2 < 0) continue;
      const c0 = before === from ? 0 : (cost[before] as number);
      if (c0 >= 0 && c0 + c1 + c2 <= room) return true;
    }
    return false;
  }

  /** Could a unit standing in `from` end a move in `hex`? */
  private canReach(unit: number, from: number, hex: number): boolean {
    if (from === hex) return true;
    const info = this.info(unit);
    if (info.type.move <= 0) return false;
    if ((this.flood(unit, from, info.type.move)[hex] as number) >= 0) return true;
    return this.rules.rules.move.alwaysOne && distance(this.rules.board.grid, from, hex) === 1 && this.stepOpen(unit, from, hex);
  }

  /** A position with one unit put elsewhere or in another state (for the ruleset's own column and sight functions). */
  private with(pos: Position, unit: number, patch: Partial<UnitState>): Position {
    const units = pos.units.slice();
    units[unit] = { ...(pos.units[unit] as UnitState), ...patch };
    return { ...pos, units };
  }

  /**
   * The position as the next move of side `by` starts from it. Under `ready.when: own-turn` a side's units are made Ready
   * when its turn begins (ruling 84, rules 5.10), Spent and Moved no longer: so unless `by`'s own move is the one open in
   * the position (its units made Ready already, and those Spent since then Spent for it), its units are put Ready. Under
   * `end-phase` the position itself: units Spent now are counted for a later move by `active`, as they always were.
   */
  private startOf(pos: Position, by: number): Position {
    if (!this.rules.ownTurnReady || pos.impulse === by) return pos;
    let known = this.readied.get(pos);
    if (!known) {
      known = [];
      this.readied.set(pos, known);
    }
    const had = known[by];
    if (had) return had;
    const units = pos.units.slice();
    for (const i of this.rules.sideUnits[by] as readonly number[]) {
      const u = units[i] as UnitState;
      if (!u.destroyed && (u.spent || u.moved || u.moveUsed > 0)) units[i] = { ...u, spent: false, moved: false, moveUsed: 0 };
    }
    const out: Position = { ...pos, units };
    known[by] = out;
    return out;
  }

  // ---------------------------------------------------------------------------
  // what one side's next move could do to a unit of the other
  // ---------------------------------------------------------------------------

  /**
   * Could a unit act in its side's next move, in a position? `later`: that move comes after another of the other side, so
   * units now Spent count too. `open`: the move in question is the one that is open now, and these are its units.
   */
  private active(pos: Position, a: number, later: boolean, open?: readonly number[]): boolean {
    const s = pos.units[a] as UnitState;
    if (s.destroyed || s.hex < 0 || s.suppressed || (!later && s.spent)) return false;
    if (open) return open.includes(a);
    return later || this.rules.sideProfile || !(pos.formations[this.info(a).formation] as { activated: boolean }).activated;
  }

  /** How far from a target a unit may stand and still bring fire on it after a short move: the hexes of the move and its longest range. */
  private strikeReach(a: number): number {
    const ty = this.info(a).type;
    return Math.floor(ty.range * this.rules.rules.rangeSteps.longFactor) + (this.rules.shortMove(a) ?? 0);
  }

  /**
   * The fire the side `by` would bring on the other side's units with its next move, in a position, taken as the best use
   * of its shooters: again and again the attack (a target, and one or more units firing together at the ruleset's own
   * columns) that does most harm for each unit it uses up, until no shooter is left with a shot worth taking. A shooter's
   * column at a target is its best: from where it stands, or, for armour that has not moved, after the short move that
   * brings it nearest in sight of it. Per unit of the other side: the chance that it is still unhurt, Suppressed,
   * destroyed; and the shooters used.
   */
  private volleys(at: Position, by: number, later: boolean, open?: readonly number[]): Volleys {
    const pos = this.startOf(at, by);
    const rules = this.rules;
    const t = this.t;
    const tb = rules.table;
    const total = tb.total;
    const within = rules.rules.support.within;
    const steps = rules.rules.support.steps;
    const n = pos.units.length;
    const fine = new Float64Array(n).fill(1);
    const down = new Float64Array(n);
    const dead = new Float64Array(n);
    const used = new Uint8Array(n);
    const shooters: number[] = [];
    for (const a of rules.sideUnits[by] as readonly number[]) {
      const ty = this.info(a).type;
      if (this.active(pos, a, later, open) && !this.info(a).battery && (ty.ap > 0 || ty.he > 0)) shooters.push(a);
    }
    const targets: { x: number; stake: number; list: { a: number; col: number; far: boolean }[] }[] = [];
    const g = rules.board.grid;
    // A copy of the position in which one shooter at a time is put where its short move would take it.
    const scratch = pos.units.slice();
    const elsewhere: Position = { ...pos, units: scratch };
    for (const x of rules.sideUnits[1 - by] as readonly number[]) {
      const s = pos.units[x] as UnitState;
      if (s.destroyed || s.hex < 0) continue;
      if (s.suppressed) {
        fine[x] = 0;
        down[x] = 1;
      }
      if (shooters.length === 0 || !rules.mayBeFiredAt(pos, 1 - by, s.hex, s.revealed > 0)) continue;
      const hard = this.info(x).type.class === 'hard';
      const list: { a: number; col: number; far: boolean }[] = [];
      for (const a of shooters) {
        const ty = this.info(a).type;
        if ((hard ? ty.ap : ty.he) <= 0) continue;
        const as = pos.units[a] as UnitState;
        let col = rules.sees(pos, as.hex, s.hex) ? rules.ownColumn(pos, a, x, s.hex) : null;
        let far = false;
        // Armour that has not moved may first make a short move: to see the target at all, or to fire from nearer.
        if (!as.moved && rules.shortMove(a) !== null && distance(g, as.hex, s.hex) <= this.strikeReach(a)) {
          const r = this.approach(a, as.hex, s.hex);
          if (r >= 0) {
            scratch[a] = { ...as, hex: r, moved: true };
            const from = rules.ownColumn(elsewhere, a, x, s.hex);
            scratch[a] = as;
            if (from !== null && (col === null || from > col)) {
              col = from;
              far = true;
            }
          }
        }
        if (col !== null) list.push({ a, col, far });
      }
      if (list.length === 0) continue;
      list.sort((p, q) => q.col - p.col);
      const passenger = rules.passengerOf(pos, x);
      targets.push({ x, stake: this.full(x, pos.turn) + (passenger >= 0 ? t.setDown * this.full(passenger, pos.turn) : 0), list });
    }
    const group: number[] = [];
    for (let round = 0; round < shooters.length && targets.length > 0; round++) {
      let bestRate = t.volleyFloor;
      let bestX = -1;
      let bestEff = 0;
      let bestDes = 0;
      let bestGroup: number[] = [];
      for (const T of targets) {
        group.length = 0;
        let top = 0;
        // An attack that some of its units must first move for is trusted less: the move may be shot at, and it leaves them
        // where they can be shot at in turn.
        let trust = t.volley;
        for (const c of T.list) {
          if (used[c.a] === 1) continue;
          if (group.length === 0) top = c.col;
          else if (c.col < top - within || group.length >= t.volleyMost) break;
          group.push(c.a);
          if (c.far) trust = t.volley * t.mobileTrust;
          const col = top + supportOf(steps, group.length);
          if (!tb.canSuppress(col)) continue;
          const w = tb.ways(col, false);
          const eff = (trust * (w.suppressed + w.destroyed)) / total;
          const des = (trust * w.destroyed) / total;
          const rate = (T.stake * ((fine[T.x] as number) * (des + t.supCost * (eff - des)) + (down[T.x] as number) * eff)) / group.length;
          if (rate > bestRate) {
            bestRate = rate;
            bestX = T.x;
            bestEff = eff;
            bestDes = des;
            bestGroup = group.slice();
          }
        }
      }
      if (bestX < 0) break;
      const eff = bestEff;
      const des = bestDes;
      const f = fine[bestX] as number;
      const d = down[bestX] as number;
      dead[bestX] = (dead[bestX] as number) + f * des + d * eff;
      down[bestX] = f * (eff - des) + d * (1 - eff);
      fine[bestX] = f * (1 - eff);
      for (const a of bestGroup) used[a] = 1;
    }
    return { fine, down, dead, used };
  }

  /**
   * The chances that the units of side `by` destroy or suppress unit `x` standing in `hex` with their next move, in a
   * position. With `fire` (volleys, for a unit where it stands) the direct fire is what that reckoning gave it; without,
   * for a hex it might stand in, the units that could fire at the hex fire together in threes. Then: armour that would
   * first make a short move to see it (not when `quick`), every infantry unit that could close with a tank together, and
   * armour that could overrun. `shells`: what a fire mission that lands on it first would do.
   */
  private danger(at: Position, by: number, later: boolean, x: number, hex: number, held: boolean, shown: boolean, quick: boolean, fire?: Volleys, shells?: Risk, open?: readonly number[]): Risk {
    const pos = this.startOf(at, by);
    const rules = this.rules;
    const t = this.t;
    const tb = rules.table;
    const total = tb.total;
    const g = rules.board.grid;
    const info = this.info(x);
    const hard = info.type.class === 'hard';
    const xs = pos.units[x] as UnitState;
    // The unit as it would stand, for the columns that read it.
    const there = xs.hex === hex && xs.suppressed === held ? pos : this.with(pos, x, { hex, suppressed: held, carriedBy: -1 });
    let fine = fire ? (fire.fine[x] as number) : held ? 0 : 1;
    let down = fire ? (fire.down[x] as number) : held ? 1 : 0;
    let dead = fire ? (fire.dead[x] as number) : 0;
    // One attack with a chance of any effect and of destroying: a second effect on a Suppressed unit destroys it.
    const hit = (eff: number, des: number): void => {
      dead += fine * des + down * eff;
      down = fine * (eff - des) + down * (1 - eff);
      fine *= 1 - eff;
    };
    const attack = (col: number, share: number): void => {
      if (!tb.canSuppress(col)) return;
      const w = tb.ways(col, false);
      hit((share * (w.suppressed + w.destroyed)) / total, (share * w.destroyed) / total);
    };
    // Shells that land before it can move: they come first.
    if (shells) hit(shells.kill + shells.sup, shells.kill);
    const fireable = rules.mayBeFiredAt(pos, info.side, hex, shown);
    const charging: number[] = [];
    const seeing: number[] = [];
    const mayCharge = hard && rules.mayBeAssaulted(x);
    const mayRun = !hard && rules.overrunGround[hex] === 1 && !this.armourAt(pos, info.side, hex, x);
    for (const a of rules.sideUnits[by] as readonly number[]) {
      if (!this.active(pos, a, later, open)) continue;
      const s = pos.units[a] as UnitState;
      const ia = this.info(a);
      const ty = ia.type;
      if (fireable && !ia.battery && (hard ? ty.ap : ty.he) > 0 && !(fire && fire.used[a] === 1)) {
        const col = rules.sees(pos, s.hex, hex) ? rules.ownColumn(pos, a, x, hex) : null;
        if (col !== null) {
          if (!fire) seeing.push(col);
        } else if (!fire && !quick && !s.moved && rules.shortMove(a) !== null) {
          // Armour that does not see the hex: the nearest place a short move would take it to that does.
          let near = -1;
          let nearD = Infinity;
          for (const r of this.shortReach(a, s.hex)) {
            const d = distance(g, r, hex);
            if (d < nearD && d >= 1 && rules.sees(pos, r, hex)) {
              near = r;
              nearD = d;
            }
          }
          if (near >= 0) {
            const from = rules.ownColumn(this.with(pos, a, { hex: near, moved: true }), a, x, hex);
            if (from !== null) attack(from, t.mobileShare);
          }
        }
      }
      if (s.moved) {
        // A Moved unit may fire (above), or close assault from where it stands when its move left it movement (ruling 81).
        if (mayCharge && rules.movedMay(pos, a)?.assault === true && distance(g, s.hex, hex) === 1) charging.push(a);
        continue;
      }
      // Every company in the view: after the start a seat's view holds every unit (4.3, 9.2), so this is what the seat knows.
      if (mayCharge && ty.assaults && distance(g, s.hex, hex) <= ty.move + 1) charging.push(a);
      if (mayRun && ty.overruns && this.canOverrun(a, s.hex, hex)) attack(rules.overrunColumn(a, x, hex), t.overrunShare);
    }
    if (seeing.length > 0) {
      // The units that see the hex fire together, the best columns first, as long as the enemy is likely to spare them for it.
      seeing.sort((p, q) => q - p);
      const within = rules.rules.support.within;
      let share = t.fireShare;
      for (let k = 0; k < seeing.length && share > 0.05;) {
        const top = seeing[k] as number;
        let together = 1;
        while (k + together < seeing.length && together < t.volleyMost && (seeing[k + together] as number) >= top - within) together++;
        attack(top + supportOf(rules.rules.support.steps, together), share);
        k += together;
        share *= t.fireShare;
      }
    }
    if (charging.length === 0) return { kill: dead, sup: held ? 0 : down };
    // The close assaults: the companies that could get beside it, alone or together, after the fire above; or, as the enemy
    // would go about it when it means to charge (the chain this opponent makes itself), after all the fire it can bring on
    // the tank first, to shake it. Whichever is likelier to destroy it.
    const before = { kill: dead, sup: held ? 0 : down };
    const goers = this.chargers(there, x, hex, charging);
    if (goers.length === 0) return before;
    let out = this.charged(goers, fine, down, dead, t.assaultShare);
    if (fireable) {
      const first = this.shaken(there, by, later, x, hex, held, shells, open);
      if (first) {
        const then = this.charged(goers, first.fine, first.down, first.dead, t.assaultShare);
        if (then.dead > out.dead) out = then;
      }
    }
    const after = { kill: out.dead, sup: held ? 0 : out.down };
    return { ...after, charge: { kill: after.kill - before.kill, sup: after.sup - before.sup } };
  }

  /**
   * The fire the side `by` could bring on one unit standing in a hex with its next move, all of it on that unit: the units
   * that see the hex, and armour that would first make a short move to (trusted less, `mobileTrust`), firing together at the
   * ruleset's own columns, the best first (as `volleys` groups them). The unit's chances after it, from where it stands now
   * (Suppressed or not, and the shells that land first); null when nothing could fire on it.
   */
  private shaken(there: Position, by: number, later: boolean, x: number, hex: number, held: boolean, shells: Risk | undefined, open?: readonly number[]): { fine: number; down: number; dead: number } | null {
    const rules = this.rules;
    const t = this.t;
    const tb = rules.table;
    const g = rules.board.grid;
    const hard = this.info(x).type.class === 'hard';
    const cols: { col: number; far: boolean }[] = [];
    for (const a of rules.sideUnits[by] as readonly number[]) {
      if (!this.active(there, a, later, open)) continue;
      const ia = this.info(a);
      if (ia.battery || (hard ? ia.type.ap : ia.type.he) <= 0) continue;
      const s = there.units[a] as UnitState;
      if (rules.sees(there, s.hex, hex)) {
        const col = rules.ownColumn(there, a, x, hex);
        if (col !== null) cols.push({ col, far: false });
        continue;
      }
      if (s.moved || rules.shortMove(a) === null || distance(g, s.hex, hex) > this.strikeReach(a)) continue;
      const r = this.approach(a, s.hex, hex);
      if (r < 0) continue;
      const col = rules.ownColumn(this.with(there, a, { hex: r, moved: true }), a, x, hex);
      if (col !== null) cols.push({ col, far: true });
    }
    if (cols.length === 0) return null;
    cols.sort((p, q) => q.col - p.col);
    const top = (cols[0] as { col: number }).col;
    const group = cols.filter(c => c.col >= top - rules.rules.support.within).slice(0, t.volleyMost);
    const col = top + supportOf(rules.rules.support.steps, group.length);
    if (!tb.canSuppress(col)) return null;
    const trust = t.volley * (group.some(c => c.far) ? t.mobileTrust : 1);
    const w = tb.ways(col, false);
    const eff = (trust * (w.suppressed + w.destroyed)) / tb.total;
    const des = (trust * w.destroyed) / tb.total;
    let fine = held ? 0 : 1;
    let down = held ? 1 : 0;
    let dead = 0;
    const hit = (e: number, d: number): void => {
      dead += fine * d + down * e;
      down = fine * (e - d) + down * (1 - e);
      fine *= 1 - e;
    };
    if (shells) hit(shells.kill + shells.sup, shells.kill);
    hit(eff, des);
    return { fine, down, dead };
  }

  /**
   * The enemy companies of a list that could close assault unit `x` standing in `hex`, in a position where it stands there
   * (rulings 80 to 82): each with its own column on the tank unhurt and Suppressed (the ruleset's assaultColumn), and the
   * chance that it gets beside the tank able to assault. A company already beside it (Ready, or Moved with movement over)
   * goes in from where it stands. Another must end a move beside it that leaves it movement over: a hex beside the tank not
   * closed to it, the cheapest way there by the board's own step costs, and the ruleset's own `moveLeaves` on that way; its
   * chance is that of coming through the reaction fire the ruleset plans at that way (planPath), the best way of those it
   * has. The fire of my units that would answer one company is spent on it: the next is planned with those units Spent. So
   * a tank beside its own infantry (fewer hexes to come from, and fire at short range on whoever comes), or in the open in
   * sight of its other units, is safer.
   */
  private chargers(there: Position, x: number, hex: number, list: readonly number[]): Charger[] {
    const rules = this.rules;
    const g = rules.board.grid;
    const b = rules.board;
    const foeSide = 1 - this.info(x).side;
    const down = this.with(there, x, { suppressed: true });
    const shut = this.shutIn(there);
    const blocked = shut.closed[1 - foeSide] as Uint8Array;
    const limit = rules.rules.stack.limit;
    const count = (h: number): number => {
      let k = 0;
      for (const i of rules.sideUnits[foeSide] as readonly number[]) {
        const u = there.units[i] as UnitState;
        if (!u.destroyed && u.hex === h) k++;
      }
      return k;
    };
    const near: { a: number; col: number; colDown: number }[] = [];
    const far: { a: number; col: number; colDown: number; ways: number[][] }[] = [];
    for (const a of list) {
      const s = there.units[a] as UnitState;
      const col = rules.assaultColumn(there, a, x);
      const colDown = rules.assaultColumn(down, a, x);
      if (distance(g, s.hex, hex) === 1) {
        near.push({ a, col, colDown });
        continue;
      }
      if (s.moved) continue;
      const info = this.info(a);
      const fkey = a;
      let f = shut.floods.get(fkey);
      if (!f) {
        f = this.search.flood(info.mover, s.hex, blocked, info.type.move);
        shut.floods.set(fkey, f);
      }
      const ways: number[][] = [];
      for (let d = 0; d < 6; d++) {
        const n = b.neighbour[hex * 6 + d] as number;
        if (n < 0 || blocked[n] === 1 || (f.cost[n] as number) <= 0 || count(n) >= limit) continue;
        const path = (routeTo(f, n) as number[]).slice(1);
        if (rules.moveLeaves(there as ImpulseView, a, path) === 'moved') ways.push(path);
      }
      if (ways.length > 0) far.push({ a, col, colDown, ways });
    }
    const out: Charger[] = near.map(c => ({ col: c.col, colDown: c.colDown, p: 1 }));
    if (far.length === 0) return out;
    // The movers one at a time, the nearest first; the units that fire at one are Spent for the next.
    far.sort((p, q) => Math.min(...p.ways.map(w => w.length)) - Math.min(...q.ways.map(w => w.length)) || q.col - p.col);
    let at: ImpulseView = there as ImpulseView;
    for (const c of far) {
      let best = -1;
      let bestShots: readonly PlannedShot[] = [];
      for (const path of c.ways) {
        const shots = rules.planPath(at, c.a, path).shots;
        let through = 1;
        for (const shot of shots) through *= 1 - shot.effect / shot.of;
        if (through > best) {
          best = through;
          bestShots = shots;
        }
      }
      out.push({ col: c.col, colDown: c.colDown, p: best });
      if (bestShots.length > 0) {
        const units = at.units.slice();
        for (const shot of bestShots) units[shot.reactor] = { ...(units[shot.reactor] as UnitState), spent: true, moved: false };
        at = { ...at, units };
      }
    }
    return out;
  }

  /**
   * What close assaults by a list of companies do to a tank that is unhurt, Suppressed or destroyed with these chances, as
   * the enemy would make them: for each set of companies that gets beside it, all of them together in one assault (the best
   * own column and the others' support, 12.3) or one at a time, the best column first (a second effect on a Suppressed tank
   * destroys it, 7.7), whichever is likelier to destroy it. Each column's chances are the fire table's, as the game's own
   * odds print them. `share`: the chance the enemy goes in at all.
   */
  private charged(list: readonly Charger[], fine: number, down: number, dead: number, share: number): { fine: number; down: number; dead: number } {
    const rules = this.rules;
    const tb = rules.table;
    const total = tb.total;
    const within = rules.rules.support.within;
    const steps = rules.rules.assault.support;
    // The five likeliest to matter: more change little and cost a set of sets each.
    const goers = list.slice().sort((p, q) => q.col - p.col || q.p - p.p).slice(0, 5);
    const k = goers.length;
    // From unhurt and from Suppressed: the chance of each end.
    let fD = 0;
    let fS = 0;
    let dD = 0;
    for (let mask = 1; mask < 1 << k; mask++) {
      let pr = 1;
      const set: Charger[] = [];
      for (let i = 0; i < k; i++) {
        const c = goers[i] as Charger;
        if (mask & (1 << i)) {
          pr *= c.p;
          set.push(c);
        } else pr *= 1 - c.p;
      }
      if (pr <= 1e-9) continue;
      // Together: one assault.
      const together = (down: boolean): { des: number; sup: number } => {
        const cols = set.map(c => (down ? c.colDown : c.col));
        const top = Math.max(...cols);
        const col = top + supportOf(steps, cols.filter(c => c >= top - within).length);
        if (!tb.canSuppress(col)) return { des: 0, sup: 0 };
        const w = tb.ways(col, down);
        return { des: w.destroyed / total, sup: w.suppressed / total };
      };
      // One at a time, the best column first.
      const oneByOne = (startDown: boolean): { des: number; sup: number } => {
        let f = startDown ? 0 : 1;
        let d = startDown ? 1 : 0;
        let x = 0;
        for (const c of set) {
          const wf = tb.canSuppress(c.col) ? tb.ways(c.col, false) : null;
          const wd = tb.canSuppress(c.colDown) ? tb.ways(c.colDown, true) : null;
          const fk = wf ? wf.destroyed / total : 0;
          const fs = wf ? wf.suppressed / total : 0;
          const dk = wd ? wd.destroyed / total : 0;
          x += f * fk + d * dk;
          d = f * fs + d * (1 - dk);
          f *= 1 - fk - fs;
        }
        return { des: x, sup: d };
      };
      const better = (p: { des: number; sup: number }, q: { des: number; sup: number }): { des: number; sup: number } => (q.des > p.des + 1e-12 || (Math.abs(q.des - p.des) <= 1e-12 && q.sup > p.sup) ? q : p);
      const fromFine = set.length > 1 ? better(together(false), oneByOne(false)) : together(false);
      const fromDown = set.length > 1 ? better(together(true), oneByOne(true)) : together(true);
      fD += pr * fromFine.des;
      fS += pr * fromFine.sup;
      dD += pr * fromDown.des;
    }
    fD *= share;
    fS *= share;
    dD *= share;
    return { fine: fine * (1 - fD - fS), down: fine * fS + down * (1 - dD), dead: dead + fine * fD + down * dD };
  }

  /**
   * How much the enemy's next move is counted against a unit of this side: `scale`, for its fire and the rest (less for a
   * side that is behind and must attack, `desperate`; less for a level that gives the enemy's answer little thought, `heed`);
   * and `fear`, for the loss of a tank to its close assaults, which a side that is behind discounts only as far as
   * `closeFear` lets it. `sure`: the close assaults as a chance, for whether what stands on an objective will still stand
   * there at the scoring. That is a matter of fact, not of nerve, so the clock does not touch it: a side that is behind may
   * be willing to lose a tank, but it does not hold the hex with a tank that is gone.
   */
  private weights(foeNext: boolean, fresh: boolean): { scale: number; fear: number; sure: number } {
    const t = this.t;
    const exposure = foeNext ? (this.foeTwice && !fresh ? t.exposureTwice : 1) : t.exposureLater;
    const clock = t.desperate * this.behind;
    return { scale: exposure * (1 - clock) * t.heed, fear: exposure * (1 - clock * (1 - t.closeFear)) * t.heed, sure: exposure * t.heed };
  }

  /** The harm of a risk to a unit, as a share of its stake: destroyed in full, Suppressed at `supCost`; its close assaults at `fear`, the rest at `scale`. */
  private harm(r: Risk, supCost: number, scale: number, fear: number): number {
    const ck = r.charge?.kill ?? 0;
    const cs = r.charge?.sup ?? 0;
    return scale * (r.kill - ck + supCost * (r.sup - cs)) + fear * (ck + supCost * cs);
  }

  /** A risk as chances, for whether what stands on an objective will still stand there: the rest at `scale`, what the close assaults add at `fear` (the caller hands `sure`). */
  private felt(r: Risk, scale: number, fear: number): Risk {
    const ck = r.charge?.kill ?? 0;
    const cs = r.charge?.sup ?? 0;
    const kill = Math.min(1, Math.max(0, scale * (r.kill - ck) + fear * ck));
    return { kill, sup: Math.min(1 - kill, Math.max(0, scale * (r.sup - cs) + fear * cs)) };
  }

  /** Does a hex hold armour of a side, other than one unit? (No overrun enters a hex that does.) */
  private armourAt(pos: Position, side: number, hex: number, except: number): boolean {
    for (const i of this.rules.sideUnits[side] as readonly number[]) {
      if (i === except) continue;
      const u = pos.units[i] as UnitState;
      if (!u.destroyed && u.hex === hex && this.info(i).type.class === 'hard') return true;
    }
    return false;
  }

  /**
   * What a waiting high-explosive mission would do to a unit standing in its hex: the ruleset's own landing, on a copy of
   * the position in which the mission is due and the unit stands there.
   */
  private shelled(m: MissionState, x: number, held: boolean): Risk {
    const key = `${m.battery}/${m.hex}/${x}/${held ? 1 : 0}`;
    const known = this.shells.get(key);
    if (known) return known;
    const owner = this.info(m.battery).side;
    const units = this.view.units.map((u, i) => {
      if (i === x) return { ...u, hex: m.hex, suppressed: held, carriedBy: -1 };
      // Nobody else under this marker: one unit's chances at a time.
      return u.hex === m.hex && !u.destroyed ? { ...u, hex: -1, destroyed: true } : u;
    });
    const battery = units[m.battery] as UnitState;
    let out: Risk = NO_RISK;
    if (!battery.destroyed && !battery.suppressed) {
      const when: ImpulseView = {
        ...this.view, units, viewer: this.rules.seats[owner] as string, impulse: owner, activation: null,
        missions: [{ battery: m.battery, hex: m.hex, kind: m.kind, due: true }],
      };
      let kill = 0;
      let sup = 0;
      for (const b of this.rules.branches(when, { type: 'land' })) {
        const u = b.view.units[x] as UnitState;
        if (u.destroyed) kill += b.p;
        else if (u.suppressed && !held) sup += b.p;
      }
      out = { kill, sup };
    }
    this.shells.set(key, out);
    return out;
  }

  /**
   * What each unit's reaction fire is worth if it stays Ready: its share of the shots the ruleset plans at each enemy unit's
   * first step. The enemy's units are read as its next move finds them (`foeAt`: under own-turn, made Ready, so a unit of
   * its that fired in reaction in this side's move will move again).
   */
  private weighCover(): void {
    const rules = this.rules;
    const t = this.t;
    const view = this.foeAt;
    const b = rules.board;
    for (const e of rules.sideUnits[this.foe] as readonly number[]) {
      const s = view.units[e] as UnitState;
      const ie = this.info(e);
      if (s.destroyed || s.hex < 0 || s.suppressed || s.spent || s.moved || ie.type.move <= 0) continue;
      const steps: number[] = [];
      for (let d = 0; d < 6; d++) {
        const h = b.neighbour[s.hex * 6 + d] as number;
        if (h >= 0 && this.stepOpen(e, s.hex, h)) steps.push(h);
      }
      if (steps.length === 0) continue;
      const passenger = rules.passengerOf(view, e);
      const worth = this.full(e, view.turn) + (passenger >= 0 ? t.setDown * this.full(passenger, view.turn) : 0);
      for (const h of steps) {
        for (const shot of rules.planPath(view, e, [h]).shots) {
          const eff = shot.effect / shot.of;
          const des = shot.destroy / shot.of;
          this.cover[shot.reactor] = (this.cover[shot.reactor] as number) + (t.reactCover * t.moves * worth * (des + (eff - des) * t.supCost)) / steps.length;
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // what a position is worth
  // ---------------------------------------------------------------------------

  /** How much each objective still needs units, in a position. */
  private needs(a: Position): number[] {
    const t = this.t;
    return this.rules.objectives.map((o, k) => {
      if (a.holders[k] !== this.side) return t.needTake;
      for (const i of this.rules.sideUnits[this.side] as readonly number[]) {
        const u = a.units[i] as UnitState;
        if (!u.destroyed && u.hex === o.hex && this.info(i).combat) return t.needHeld;
      }
      return t.needEmpty;
    });
  }

  /** The turns' worth of points an objective still has to give, the later turns counting a little less. */
  private horizon(turn: number): number {
    const left = Math.max(0, this.rules.lastTurn - turn + 1);
    const k = this.t.keep;
    return k >= 1 ? left : (1 - k ** left) / (1 - k);
  }

  /** The pull of the objectives on a unit standing in a hex. */
  private pull(i: number, hex: number, carried: boolean, need: readonly number[], turn: number): number {
    const t = this.t;
    // A gun or a mortar is where it was put: nothing draws it forward.
    if (this.info(i).type.move <= 0) return 0;
    const g = this.rules.board.grid;
    const pace = this.pace[i] as number;
    const hz = this.horizon(turn);
    let v = 0;
    this.rules.objectives.forEach((o, k) => {
      const turns = distance(g, hex, o.hex) / pace + (carried ? 1 : 0);
      if (turns < t.pullTurns) v += (need[k] as number) * o.points * hz * (1 - turns / t.pullTurns);
    });
    return t.pull * v;
  }

  /**
   * The worth of a position at the start of a move (this side's own `end` already applied), in points of the final margin,
   * from this side's seat.
   */
  private worth(a: ImpulseView): number {
    const rules = this.rules;
    const t = this.t;
    const side = this.side;
    const foe = this.foe;
    // With `nerve`, a margin counts for less the larger it already is (see settle): a game won is then a little more than any margin.
    if (a.stage === 'over') {
      const won = t.nerve > 0 ? 1.25 * t.nerve : WON;
      return a.result && a.result.winner === side ? won : -won;
    }
    const foeNext = a.impulse === foe;
    const fresh = a.turn !== this.view.turn;
    const [kp, kq] = rules.killShare;
    const me = a.sides[side] as ImpulseView['sides'][number];
    const them = a.sides[foe] as ImpulseView['sides'][number];
    const sum = (list: readonly number[]): number => list.reduce((p, q) => p + q, 0);
    const lead = me.score - them.score + (kp / kq) * (sum(them.lostThisTurn) - sum(me.lostThisTurn));
    let v = lead;
    // The break: a side past it at the next scoring has lost, whatever the score.
    const near = (s: ImpulseView['sides'][number]): number => (s.startCost > 0 ? s.lost / (rules.breakShare * s.startCost) : 0);
    const mine = near(me);
    const theirs = near(them);
    if (theirs >= 1 && mine < 1) v += t.breakWin;
    else if (mine >= 1 && theirs < 1) v -= t.breakWin;
    else if (mine >= 1 && theirs >= 1) v += lead >= 0 ? t.breakWin : -t.breakWin;
    v += t.breakNear * (Math.min(1, theirs) ** 3 - Math.min(1, mine) ** 3);
    const toSudden = Math.max(-1, Math.min(1, lead / Math.max(1, rules.suddenDeathLead)));
    v += t.suddenNear * toSudden ** 3;

    const left = Math.max(1, rules.lastTurn - a.turn + 1);
    const part = left / rules.lastTurn;
    const need = this.needs(a);
    const risks: (Risk | undefined)[] = [];
    const { scale, fear, sure } = this.weights(foeNext, fresh);
    const onMine = this.volleys(a, foe, !foeNext);
    const onTheirs = this.volleys(a, side, foeNext);
    // Shells on the way. On my units: in full where they land before the unit can move (my own always do; the enemy's when
    // it moves next, or the unit cannot move), in part otherwise. On the enemy's: by the chance that it is still there.
    const shellsOn: (Risk | undefined)[] = [];
    for (const m of a.missions) {
      if (m.kind !== 'he') continue;
      const ours = this.info(m.battery).side === side;
      if (ours) v -= t.missionHold;
      for (let i = 0; i < a.units.length; i++) {
        const s = a.units[i] as UnitState;
        if (s.destroyed || s.hex !== m.hex) continue;
        const info = this.info(i);
        const r = this.shelled(m, i, s.suppressed);
        const fixed = info.type.move <= 0 || s.suppressed;
        let share: number;
        if (info.side === side) share = ours || foeNext || fixed ? 1 : t.dodgeLater;
        else if (!ours) continue;
        else share = !foeNext && m.due ? 1 : info.type.move <= 0 ? t.stayFixed : s.suppressed ? t.stayHeld : rules.objectives.some(o => o.hex === s.hex) ? t.stayGarrison : t.stayMobile;
        const was = shellsOn[i];
        const now = { kill: share * r.kill, sup: share * r.sup };
        shellsOn[i] = was ? { kill: 1 - (1 - was.kill) * (1 - now.kill), sup: Math.max(was.sup, now.sup) * (1 - now.kill) } : now;
      }
    }
    for (let i = 0; i < a.units.length; i++) {
      const s = a.units[i] as UnitState;
      if (s.destroyed) continue;
      const info = this.info(i);
      const own = info.side === side;
      const sign = own ? 1 : -1;
      const full = this.full(i, a.turn);
      v += sign * info.type.cost * t.future * part;
      if (s.suppressed) {
        const misses = own ? s.spent || fresh : s.spent || fresh || foeNext;
        v -= sign * full * (misses ? t.heldDenied : t.heldBrief);
      }
      // Out of command it acts only on an order of its own (the ruleset says who is; under the whole-side profile, nobody).
      if (own && !rules.sideProfile && !rules.inCommandNow(a, i)) v -= t.outOfCommand * full;
      if (s.hex < 0) {
        // Carried: it is where its transport is, and no nearer its work than a turn's dismounting.
        if (own && s.carriedBy >= 0) {
          // Carried, it does nothing: a small cost while the ride still saves it time, a large one once it could as well walk.
          const at = (a.units[s.carriedBy] as UnitState).hex;
          const ride = this.rideGain(i, s.carriedBy, at, need, a.turn);
          v += this.pull(i, at, true, need, a.turn) + ride - full * (ride > 0 ? t.carriedIdle : t.carriedStuck);
        }
        continue;
      }
      if (own) {
        const shells = shellsOn[i];
        const risk = this.danger(a, foe, !foeNext, i, s.hex, s.suppressed, s.revealed > 0, false, onMine, shells);
        risks[i] = this.felt(risk, scale, sure);
        const passenger = rules.passengerOf(a, i);
        const stake = full + (passenger >= 0 ? t.setDown * this.full(passenger, a.turn) : 0);
        // Suppressed while Spent it misses the next turn as well; while Ready with its own move already made, nearly nothing.
        const supCost = !foeNext ? 0.7 * t.supCost : fresh ? 0.6 * t.supCost : s.spent ? (this.foeTwice ? Math.min(1, 2 * t.supCost) : t.supCost) : t.heldBrief;
        v -= stake * this.harm(risk, supCost, scale, fear);
        if (shells && scale < 1) v -= (1 - scale) * stake * (shells.kill + supCost * shells.sup);
        // Held back, it fires in reaction in the enemy's next move: in this turn, or under own-turn in the next as well (5.10).
        if (foeNext && (!fresh || rules.ownTurnReady) && !s.spent && !s.suppressed) v += this.coverOf(i, s) + (info.combat ? t.readyWorth : 0);
        if (info.combat || passenger >= 0) v += this.pull(i, s.hex, false, need, a.turn);
      } else {
        const risk = this.danger(a, side, foeNext, i, s.hex, s.suppressed, s.revealed > 0, false, onTheirs);
        v += (foeNext ? t.threatKept : t.followUp) * full * (risk.kill + t.supCost * risk.sup);
        const shells = shellsOn[i];
        if (shells) v += full * (shells.kill + t.supCost * shells.sup);
      }
    }

    // Objectives: who will hold each at the next scoring, and for how long after.
    const hz = this.horizon(a.turn);
    rules.objectives.forEach((o, k) => {
      const now = a.holders[k] === side ? 1 : a.holders[k] === foe ? -1 : 0;
      let mineHere = 0;
      let allDead = 1;
      let anyDead = 0;
      let noneFit = 1;
      let theirsHold = false;
      for (let i = 0; i < a.units.length; i++) {
        const s = a.units[i] as UnitState;
        if (s.destroyed || s.hex !== o.hex) continue;
        const info = this.info(i);
        if (info.side === side) {
          mineHere++;
          // As it is felt (felt): the scale is already in it.
          const r = risks[i] ?? NO_RISK;
          allDead *= r.kill;
          anyDead = Math.max(anyDead, r.kill + 0.5 * r.sup);
          if (info.combat && !s.suppressed) noneFit *= Math.min(1, r.kill + r.sup);
        } else if (info.combat && !s.suppressed) theirsHold = true;
      }
      let at: number;
      // The next scoring counts in full; the turns after it by how surely what stands on the hex now will still stand there.
      let lasting = 1;
      if (mineHere > 0) {
        const lost = allDead * (this.reaches(a, foe, o.hex, !foeNext) ? t.walkIn : 0);
        const kept = Math.max(0, 1 - noneFit - lost);
        at = kept - lost + Math.max(0, 1 - kept - lost) * now;
        lasting = 1 - Math.min(1, anyDead);
      } else if (theirsHold) at = -1;
      else if (foeNext) at = now - (now + 1) * (this.reaches(a, foe, o.hex, false) ? t.walkIn : 0);
      else at = now + (1 - now) * (this.reaches(a, side, o.hex, false) ? t.walkInLater : 0);
      v += o.points * at * (1 + (hz - 1) * lasting);
    });

    return this.settle(v);
  }

  /**
   * A margin as the chance of winning sees it: nearly itself while the game is close, and less and less for each further
   * point the further ahead or behind the side already is. So a side well ahead will not stake its lead for a little
   * more, and a side well behind will stake what it has left. Off when the table's `nerve` is 0.
   */
  private settle(v: number): number {
    const n = this.t.nerve;
    return n > 0 ? n * Math.tanh(v / n) : v;
  }

  /** Could a combat unit of a side walk onto a hex with its next move? */
  private reaches(at: Position, by: number, hex: number, later: boolean): boolean {
    const a = this.startOf(at, by);
    for (const i of this.rules.sideUnits[by] as readonly number[]) {
      const s = a.units[i] as UnitState;
      if (s.destroyed || s.hex < 0 || s.suppressed || s.moved || (!later && s.spent) || !this.info(i).combat) continue;
      if (this.canReach(i, s.hex, hex)) return true;
    }
    return false;
  }

  private coverOf(i: number, s: UnitState): number {
    const was = this.view.units[i] as UnitState;
    const c = this.cover[i] as number;
    return s.hex === was.hex ? c : this.t.coverMoved * c;
  }

  // ---------------------------------------------------------------------------
  // what an action is worth
  // ---------------------------------------------------------------------------

  /**
   * What this side's units that have not yet acted could still do to the enemy in the move that is open, in points: the
   * same reckoning as is made of the enemy's next move (its fire as its best use of its shooters, short moves and shots,
   * charges, overruns), for the units of the open move that are still Ready or Moved. Nothing once the move is over.
   */
  private potential(v: ImpulseView): number {
    const act = v.activation;
    if (this.t.potential <= 0 || v.stage !== 'play' || !act || v.impulse !== this.side) return 0;
    const fire = this.volleys(v, this.side, false, act.inCommand);
    let total = 0;
    for (const e of this.rules.sideUnits[this.foe] as readonly number[]) {
      const s = v.units[e] as UnitState;
      if (s.destroyed || s.hex < 0) continue;
      const r = this.danger(v, this.side, false, e, s.hex, s.suppressed, s.revealed > 0, false, fire, undefined, act.inCommand);
      // What is reckoned beyond its state now: a unit already Suppressed counts only for its destruction.
      total += this.full(e, v.turn) * (r.kill + this.t.supCost * r.sup);
    }
    return total;
  }

  /** A position in which this side's move may still be open: what ending the move there is worth, and what could still be done in it. */
  private sight(v: ImpulseView): { real: number; seen: number } {
    const real = this.worth(this.after(v));
    return { real, seen: real + this.t.potential * this.potential(v) };
  }

  /**
   * The mean of the positions an action leads to: `real`, the worth of ending the move there; `seen`, that and what the
   * units still to act could do there (potential).
   */
  private mean(branches: readonly Branch<ImpulseView>[]): { real: number; seen: number } {
    this.looks++;
    const most = this.t.outcomes;
    let list = branches;
    if (list.length > most) list = list.slice().sort((p, q) => q.p - p.p).slice(0, most);
    let real = 0;
    let seen = 0;
    let p = 0;
    for (const b of list) {
      const s = this.sight(b.view);
      real += b.p * s.real;
      seen += b.p * s.seen;
      p += b.p;
    }
    return p > 0 ? { real: real / p, seen: seen / p } : { real: -Infinity, seen: -Infinity };
  }

  /** The outcomes of an action in a position; none when the ruleset would refuse it there. */
  private tryBranches(v: ImpulseView, action: ImpulseAction): Branch<ImpulseView>[] {
    if (v.stage !== 'play' || !v.activation || v.impulse !== this.side) return [];
    // The plain reasons it could no longer be made, before the ruleset is asked: a unit of it gone or used, its target gone.
    const can = (u: number): boolean => {
      const s = v.units[u] as UnitState;
      return !s.destroyed && !s.spent && !s.suppressed;
    };
    const stands = (u: number): boolean => {
      const s = v.units[u] as UnitState;
      return !s.destroyed && s.hex >= 0;
    };
    if (action.type === 'fire' && !(action.firers.every(can) && stands(action.target))) return [];
    if (action.type === 'assault' && !(action.units.every(x => can(x.unit)) && stands(action.target))) return [];
    if ((action.type === 'move' || action.type === 'overrun' || action.type === 'dismount') && !can(action.unit)) return [];
    try {
      return this.rules.branches(v, action);
    } catch {
      return [];
    }
  }

  private exact(o: Option): number {
    if (Number.isNaN(o.gain)) {
      const m = this.mean(this.rules.branches(this.view, o.action));
      o.real = m.real - this.base;
      o.gain = m.seen - this.seen;
    }
    return o.gain;
  }

  /** The worth of one action and then another where the first leaves the second open: the better of going on and stopping, outcome by outcome. */
  private chain(firstly: ImpulseAction, then: readonly ImpulseAction[]): number {
    let v = 0;
    for (const b of this.rules.branches(this.view, firstly)) {
      let best = this.sight(b.view).seen;
      for (const next of then) {
        const bs = this.tryBranches(b.view, next);
        if (bs.length > 0) best = Math.max(best, this.mean(bs).seen);
      }
      v += b.p * best;
    }
    this.looks++;
    return v - this.seen;
  }

  // ---------------------------------------------------------------------------
  // quick guesses
  // ---------------------------------------------------------------------------

  /** A unit's own chances at the enemy from a hex with its next shot or charge, in points: what it adds by being there. */
  private reach(u: number, hex: number, moved: boolean): number {
    const rules = this.rules;
    const view = this.view;
    const tb = rules.table;
    const g = rules.board.grid;
    const info = this.info(u);
    const ty = info.type;
    const fights = !info.battery && (ty.ap > 0 || ty.he > 0);
    if (!fights && !ty.assaults) return 0;
    const reachMost = Math.floor(ty.range * rules.rules.rangeSteps.longFactor);
    let there: Position | null = null;
    let v = 0;
    for (const e of rules.sideUnits[this.foe] as readonly number[]) {
      const s = view.units[e] as UnitState;
      if (s.destroyed || s.hex < 0) continue;
      const d = distance(g, hex, s.hex);
      const ie = this.info(e);
      const hard = ie.type.class === 'hard';
      let best = 0;
      if (fights && d <= reachMost && (hard ? ty.ap : ty.he) > 0 && rules.sees(view, hex, s.hex)) {
        there ??= this.with(view, u, { hex, moved, carriedBy: -1 });
        if (rules.mayBeFiredAt(there, this.foe, s.hex, s.revealed > 0)) {
          const col = rules.ownColumn(there, u, e, s.hex);
          if (col !== null) {
            const w = tb.ways(col, s.suppressed);
            best = (w.destroyed + this.t.supCost * w.suppressed) / tb.total;
          }
        }
      }
      if (!moved && ty.assaults && hard && d <= 3 && rules.mayBeAssaulted(e) && this.canClose(u, hex, s.hex)) {
        // With the companies already beside it: what one more adds.
        const cols: number[] = [];
        for (const f of rules.sideUnits[this.side] as readonly number[]) {
          if (f === u) continue;
          const fs = view.units[f] as UnitState;
          if (!fs.destroyed && fs.hex >= 0 && !fs.suppressed && this.info(f).type.assaults && this.canClose(f, fs.hex, s.hex)) cols.push(rules.assaultColumn(view, f, e));
        }
        const odds = (list: number[]): number => {
          if (list.length === 0) return 0;
          const top = Math.max(...list);
          const col = top + supportOf(rules.rules.assault.support, list.filter(c => c >= top - rules.rules.support.within).length);
          if (!tb.canSuppress(col)) return 0;
          const w = tb.ways(col, s.suppressed);
          return (w.destroyed + this.t.supCost * w.suppressed) / tb.total;
        };
        best = Math.max(best, odds([...cols, rules.assaultColumn(view, u, e)]) - odds(cols));
      }
      v += best * this.full(e, view.turn);
    }
    return v;
  }

  /** What standing in a hex is worth to a unit at the end of this move, by the quick reckoning: the terms of `worth` that are its own. */
  private place(u: number, hex: number, state: 'ready' | 'moved' | 'spent', need: readonly number[]): number {
    const rules = this.rules;
    const t = this.t;
    const view = this.view;
    const info = this.info(u);
    const s = view.units[u] as UnitState;
    const turn = this.ahead.turn;
    const passenger = rules.passengerOf(view, u);
    const stake = this.full(u, turn) + (passenger >= 0 ? t.setDown * this.full(passenger, turn) : 0);
    // The unit as it would stand there, Spent, Moved or Ready (whether it would itself fire at what comes at it).
    const there = s.hex === hex && state === 'ready' ? view : this.with(view, u, { hex, carriedBy: -1, spent: state === 'spent', moved: state === 'moved' });
    const risk = this.danger(there as ImpulseView, this.foe, !this.foeNext, u, hex, s.suppressed, s.revealed > 0, true);
    const fresh = !this.sameTurn;
    const supCost = !this.foeNext ? 0.7 * t.supCost : fresh ? 0.6 * t.supCost : state === 'ready' ? t.heldBrief : this.foeTwice ? Math.min(1, 2 * t.supCost) : t.supCost;
    const { scale, fear, sure } = this.weights(this.foeNext, fresh);
    const felt = this.felt(risk, scale, sure);
    let v = -stake * this.harm(risk, supCost, scale, fear);
    if (!rules.sideProfile && hex !== s.hex && s.hex >= 0 && !rules.inCommandNow(this.with(view, u, { hex }), u)) v -= t.outOfCommand * this.full(u, turn);
    if (info.combat || passenger >= 0) v += this.pull(u, hex, false, need, turn);
    if (passenger >= 0) {
      const ride = this.rideGain(passenger, u, hex, need, turn);
      v += this.pull(passenger, hex, true, need, turn) + ride - this.full(passenger, turn) * (ride > 0 ? t.carriedIdle : t.carriedStuck);
    }
    // An objective under it: taken, or kept from an enemy who could walk in.
    const k = rules.objectives.findIndex(o => o.hex === hex);
    if (k >= 0 && info.combat) {
      const o = rules.objectives[k] as { hex: number; points: number };
      const now = view.holders[k] === this.side ? 1 : view.holders[k] === this.foe ? -1 : 0;
      let others = 0;
      for (const i of rules.sideUnits[this.side] as readonly number[]) {
        const f = view.units[i] as UnitState;
        if (i !== u && !f.destroyed && f.hex === hex && this.info(i).combat) others++;
      }
      const gain = now === 1 ? (others > 0 ? 0.05 : this.reaches(view, this.foe, hex, !this.foeNext) ? 2 * t.walkIn : 0.1) : others > 0 ? 0.1 : 1 - now;
      v += o.points * this.horizon(turn) * gain * Math.max(0, 1 - (felt.kill + felt.sup));
    }
    v += (this.foeNext ? t.threatKept : t.followUp) * this.reach(u, hex, false);
    // A Moved unit keeps a share of its cover, and the same share of what a fighting unit left able to act is worth besides
    // (rulings 77 and 80: it may still fire, at a cost, or move on), so that a short move that found no target is moved on
    // from rather than stood on for nothing.
    if (this.coverCounts && state !== 'spent') v += state === 'ready' ? (this.cover[u] as number) + (info.combat ? t.readyWorth : 0) : t.coverMoved * ((this.cover[u] as number) + (info.combat ? t.readyWorth : 0));
    // A marker on the hex.
    for (const m of view.missions) {
      if (m.kind !== 'he' || m.hex !== hex) continue;
      const r = this.shelled(m, u, s.suppressed);
      v -= this.full(u, turn) * (r.kill + t.supCost * r.sup);
    }
    return v;
  }

  /** What the reaction fire planned at a path is expected to cost, and the chance of coming through it. */
  private gauntlet(u: number, path: readonly number[], stake: number, shots: readonly PlannedShot[] = this.rules.planPath(this.view, u, path).shots): { cost: number; through: number } {
    let coming = 1;
    let cost = 0;
    for (const s of shots) {
      const eff = s.effect / s.of;
      const des = s.destroy / s.of;
      cost += coming * stake * (des + (eff - des) * this.t.supCost);
      coming *= 1 - eff;
    }
    // A level that gives the enemy's answer little thought counts the fire on the way for as little.
    return { cost: cost * this.t.heed, through: coming };
  }

  /** The best lone shot a unit would have from a hex after a short move there, in points. */
  private shotFrom(u: number, hex: number): { value: number; target: number } {
    const rules = this.rules;
    const view = this.view;
    const tb = rules.table;
    const ty = this.info(u).type;
    const there = this.with(view, u, { hex, moved: true });
    let value = 0;
    let target = -1;
    for (const e of rules.sideUnits[this.foe] as readonly number[]) {
      const s = view.units[e] as UnitState;
      if (s.destroyed || s.hex < 0) continue;
      if ((this.info(e).type.class === 'hard' ? ty.ap : ty.he) <= 0 || !rules.sees(view, hex, s.hex)) continue;
      if (!rules.mayBeFiredAt(there, this.foe, s.hex, s.revealed > 0)) continue;
      const col = rules.ownColumn(there, u, e, s.hex);
      if (col === null || !tb.canSuppress(col)) continue;
      const w = tb.ways(col, s.suppressed);
      const v = (this.full(e, view.turn) * (w.destroyed + this.t.supCost * w.suppressed)) / tb.total;
      if (v > value) {
        value = v;
        target = e;
      }
    }
    return { value, target };
  }

  /**
   * The best close assault a unit that can close assault would open by a move to a hex that leaves it movement over (rulings
   * 80 and 81), in points: what it adds to the companies that could go in with it on an enemy tank beside that hex (those
   * beside it already and able to, and those that could still come beside it this move), as `reach` reckons one more company;
   * with the target, and the companies beside it already, which may go in with it at once.
   */
  private chargeFrom(u: number, hex: number): { value: number; target: number; with: number[] } {
    const rules = this.rules;
    const view = this.view;
    const tb = rules.table;
    const g = rules.board.grid;
    let value = 0;
    let target = -1;
    let beside: number[] = [];
    const odds = (list: readonly number[], suppressed: boolean): number => {
      if (list.length === 0) return 0;
      const top = Math.max(...list);
      const col = top + supportOf(rules.rules.assault.support, list.filter(c => c >= top - rules.rules.support.within).length);
      if (!tb.canSuppress(col)) return 0;
      const w = tb.ways(col, suppressed);
      return (w.destroyed + this.t.supCost * w.suppressed) / tb.total;
    };
    for (const e of rules.sideUnits[this.foe] as readonly number[]) {
      const s = view.units[e] as UnitState;
      if (s.destroyed || s.hex < 0 || distance(g, hex, s.hex) !== 1 || !rules.mayBeAssaulted(e)) continue;
      const cols: number[] = [];
      const here: number[] = [];
      for (const f of rules.sideUnits[this.side] as readonly number[]) {
        if (f === u) continue;
        const fs = view.units[f] as UnitState;
        if (fs.destroyed || fs.hex < 0 || fs.suppressed || fs.spent || !this.info(f).type.assaults) continue;
        const next = distance(g, fs.hex, s.hex) === 1;
        if (fs.moved ? next && rules.movedMay(view, f)?.assault === true : this.canClose(f, fs.hex, s.hex)) cols.push(rules.assaultColumn(view, f, e));
        if (next && (!fs.moved || rules.movedMay(view, f)?.assault === true)) here.push(f);
      }
      const v = (odds([...cols, rules.assaultColumn(view, u, e)], s.suppressed) - odds(cols, s.suppressed)) * this.full(e, view.turn);
      if (v > value) {
        value = v;
        target = e;
        beside = here.slice(0, Math.max(0, this.t.together - 1));
      }
    }
    return { value: this.t.chargeOpen * value, target, with: beside };
  }

  // ---------------------------------------------------------------------------
  // the options of a move
  // ---------------------------------------------------------------------------

  private pct(x: number): string {
    return `${Math.round(100 * x)}%`;
  }

  /** The chances of an attack on a target at a column, in words. */
  private oddsWords(column: number, target: number): string {
    const w = this.rules.table.ways(column, (this.view.units[target] as UnitState).suppressed);
    const total = this.rules.table.total;
    return `${this.pct((w.suppressed + w.destroyed) / total)} to hurt it, ${this.pct(w.destroyed / total)} to destroy it`;
  }

  /** Every action of the list that might be worth taking, each with a quick guess. */
  private options(legal: readonly ImpulseAction[]): { all: Option[]; follow: Map<ImpulseAction, ImpulseAction> } {
    const rules = this.rules;
    const t = this.t;
    const view = this.view;
    const tb = rules.table;
    const turn = view.turn;
    const need = this.needs(this.ahead);
    const all: Option[] = [];
    /** For a short move: the shot that would follow it. */
    const follow = new Map<ImpulseAction, ImpulseAction>();
    const moves = new Map<number, Act<'move'>[]>();
    const add = (action: ImpulseAction, units: readonly number[], guess: number, why: string): void => {
      all.push({ action, units, guess, gain: NaN, real: NaN, why });
    };
    const spend = (u: number): number => (this.coverCounts ? (this.cover[u] as number) + t.readyWorth : 0);
    const hurt = (target: number, column: number): number => {
      const w = tb.ways(column, (view.units[target] as UnitState).suppressed);
      return (this.full(target, turn) * (w.destroyed + t.supCost * w.suppressed)) / tb.total;
    };
    const foeIn = new Map<number, number[]>();
    for (const e of rules.sideUnits[this.foe] as readonly number[]) {
      const s = view.units[e] as UnitState;
      if (s.destroyed || s.hex < 0) continue;
      const list = foeIn.get(s.hex);
      if (list) list.push(e);
      else foeIn.set(s.hex, [e]);
    }
    // A call now lands no sooner than a call at the next move, where this side moves again before the enemy does.
    const callNow = this.foeNext;
    // A level keeps only so many of its units in hand in one turn (`busy`): once that many have acted, the rest are left as
    // they are, and only a unit that has made its short move may still take its shot.
    let acted = 0;
    for (const u of rules.sideUnits[this.side] as readonly number[]) {
      const s = view.units[u] as UnitState;
      if (!s.destroyed && (s.spent || s.moved)) acted++;
    }
    const handsFull = acted >= t.busy;
    const inHand = (u: number): boolean => !handsFull || (view.units[u] as UnitState).moved;

    for (const a of legal) {
      if (handsFull) {
        const units = a.type === 'fire' ? a.firers : a.type === 'assault' ? a.units.map(x => x.unit) : a.type === 'move' || a.type === 'overrun' || a.type === 'mount' || a.type === 'dismount' || a.type === 'mission' ? [a.unit] : [];
        if (!units.every(inHand)) continue;
      }
      switch (a.type) {
        case 'fire': {
          if (a.firers.length > t.together) break;
          const hex = (view.units[a.target] as UnitState).hex;
          let top = -Infinity;
          for (const f of a.firers) top = Math.max(top, rules.ownColumn(view, f, a.target, hex) ?? -Infinity);
          const column = top + supportOf(rules.rules.support.steps, a.firers.length);
          let guess = hurt(a.target, column);
          for (const f of a.firers) guess -= spend(f) + 0.01;
          const who = a.firers.map(f => this.name(f)).join(' and ');
          add(a, a.firers, guess, `${who} fire${a.firers.length > 1 ? ' together' : 's'} on ${this.name(a.target)}: ${this.oddsWords(column, a.target)}`);
          break;
        }
        case 'move': {
          const list = moves.get(a.unit);
          if (list) list.push(a);
          else moves.set(a.unit, [a]);
          break;
        }
        case 'assault': {
          const units = a.units.map(x => x.unit);
          if (units.length > t.together) break;
          let top = -Infinity;
          for (const u of units) top = Math.max(top, rules.assaultColumn(view, u, a.target));
          const column = top + supportOf(rules.rules.assault.support, units.length);
          const w = tb.ways(column, (view.units[a.target] as UnitState).suppressed);
          let guess = hurt(a.target, column);
          for (const u of units) guess -= spend(u) + (w.none / tb.total) * t.heldDenied * this.full(u, turn);
          const who = units.map(u => this.name(u)).join(', ');
          const many = units.length > 1;
          add(a, units, guess, `${who} ${many ? 'charge' : 'charges'} ${this.name(a.target)}${many ? ' together' : ' alone'}: ${this.oddsWords(column, a.target)}`);
          break;
        }
        case 'overrun': {
          let guess = -spend(a.unit);
          const names: string[] = [];
          for (const e of foeIn.get(a.target) ?? []) {
            const ie = this.info(e);
            if (ie.type.class !== 'soft') continue;
            names.push(this.name(e));
            if (ie.transport && !ie.combat && rules.passengerOf(view, e) < 0) guess += this.full(e, turn);
            else guess += hurt(e, rules.overrunColumn(a.unit, e, a.target));
          }
          add(a, [a.unit], guess, `${this.name(a.unit)} overruns ${names.join(' and ')} in ${this.label(a.target)}`);
          break;
        }
        case 'mount': {
          // Worth it when the transport gets the unit to its work sooner than its own feet. A battery's work is where it stands.
          const at = (view.units[a.unit] as UnitState).hex;
          if (this.info(a.unit).battery && !view.missions.some(m => m.kind === 'he' && m.hex === at)) break;
          const carrier = (view.units[a.transport] as UnitState).hex;
          const ride = this.rideGain(a.unit, a.transport, carrier, need, turn);
          if (ride <= 0) break;
          const guess = this.pull(a.unit, carrier, true, need, turn) + ride - t.carriedIdle * this.full(a.unit, turn) - this.pull(a.unit, at, false, need, turn) - spend(a.unit);
          add(a, [a.unit], guess, `${this.name(a.unit)} mounts ${this.name(a.transport)} to be carried forward`);
          break;
        }
        case 'dismount': {
          const carrier = (view.units[a.unit] as UnitState).carriedBy;
          const from = carrier >= 0 ? (view.units[carrier] as UnitState).hex : a.hex;
          const stake = this.full(a.unit, turn);
          // A carried unit has no hex to set out from: the plan of its one step is the ruleset's preview of the dismount.
          const g = this.gauntlet(a.unit, [a.hex], stake, rules.preview(view, rules.seats[this.side] as string, a)?.[0]?.shots ?? []);
          const ride = this.rideGain(a.unit, carrier, from, need, turn);
          const guess = this.place(a.unit, a.hex, 'spent', need) - this.pull(a.unit, from, true, need, turn) - ride + this.full(a.unit, turn) * (ride > 0 ? t.carriedIdle : t.carriedStuck) - g.cost;
          add(a, [a.unit], guess, `${this.name(a.unit)} dismounts into ${this.label(a.hex)}`);
          break;
        }
        case 'mission': {
          if (a.kind !== 'he' || !callNow) break;
          const there = foeIn.get(a.hex);
          if (!there) break;
          let guess = -t.missionHold;
          const names: string[] = [];
          const m: MissionState = { battery: a.unit, hex: a.hex, kind: 'he', due: true };
          for (const e of there) {
            const s = view.units[e] as UnitState;
            const r = this.shelled(m, e, s.suppressed);
            const stays = this.info(e).type.move <= 0 ? t.stayFixed : s.suppressed ? t.stayHeld : rules.objectives.some(o => o.hex === s.hex) ? t.stayGarrison : t.stayMobile;
            guess += this.full(e, turn) * (r.kill + t.supCost * r.sup) * stays;
            names.push(this.name(e));
          }
          add(a, [a.unit], guess, `${this.name(a.unit)} calls shells onto ${names.join(' and ')} in ${this.label(a.hex)}`);
          break;
        }
        default:
          break;
      }
    }

    // Moves: every place by what it is worth, then the best few with the reaction fire on each listed way there.
    for (const [u, list] of moves) {
      const info = this.info(u);
      const s = view.units[u] as UnitState;
      const passenger = rules.passengerOf(view, u);
      // An empty transport without firepower stays where it is.
      if (!info.combat && passenger < 0) continue;
      // A unit that has moved already and stays is Moved, not Ready (rulings 77 and 80: what it moves on to is weighed against that).
      const stay = this.place(u, s.hex, s.moved ? 'moved' : 'ready', need);
      const stake = this.full(u, turn) + (passenger >= 0 ? t.setDown * this.full(passenger, turn) : 0);
      const short = rules.shortMove(u);
      const here = new Map<number, number>();
      const ranked: { a: Act<'move'>; to: number; raw: number }[] = [];
      for (const a of list) {
        const to = a.path[a.path.length - 1] as number;
        let raw = here.get(to);
        if (raw === undefined) {
          raw = this.place(u, to, 'spent', need) - stay;
          here.set(to, raw);
        }
        ranked.push({ a, to, raw });
      }
      // The shot a short move would open counts for the place; and the close assault that a move with movement over opens
      // (rulings 80 and 81), for a level that tries two-step plans at all (`chains`).
      const shots = new Map<number, { value: number; target: number }>();
      const charges = new Map<number, { value: number; target: number; with: number[] }>();
      const charging = rules.assaultsAfterMove(u) && t.chains > 0 && !s.moved;
      const bonus = (to: number, a: Act<'move'>): number => {
        if (rules.moveLeaves(view, u, a.path) !== 'moved') return 0;
        const most = short ?? -1;
        let cost = 0;
        let at = s.hex;
        for (const h of a.path) {
          cost += rules.board.cost(info.mover, at, h) ?? 0;
          at = h;
        }
        if (short !== null && cost <= most) {
          let shot = shots.get(to);
          if (!shot) {
            shot = this.shotFrom(u, to);
            shots.set(to, shot);
          }
          return shot.value;
        }
        if (!charging) return 0;
        let charge = charges.get(to);
        if (!charge) {
          charge = this.chargeFrom(u, to);
          charges.set(to, charge);
        }
        return charge.value;
      };
      const scored = ranked.map(r => ({ ...r, plus: bonus(r.to, r.a) }));
      scored.sort((p, q) => q.raw + q.plus - (p.raw + p.plus));
      const seen = new Set<number>();
      let weighed = 0;
      for (const r of scored) {
        if (!seen.has(r.to)) {
          if (weighed >= t.movesWeighed) break;
          seen.add(r.to);
          weighed++;
        }
        if (r.raw + r.plus < t.worthIt) continue;
        const g = this.gauntlet(u, r.a.path, stake);
        const guess = g.through * (r.raw + r.plus) - g.cost;
        const shot = shots.get(r.to);
        const charge = charges.get(r.to);
        if (r.plus > 0 && shot && shot.target >= 0) follow.set(r.a, { type: 'fire', firers: [u], target: shot.target });
        else if (r.plus > 0 && charge && charge.target >= 0) {
          // The close assault from the new place: alone, or with the companies beside the target already (ruling 81).
          follow.set(r.a, { type: 'assault', units: [...charge.with, u].map(x => ({ unit: x, path: [] })), target: charge.target, advance: [] });
        }
        add(r.a, [u], guess, '');
      }
    }
    return { all, follow };
  }

  /**
   * What being carried is worth to a unit whose transport stands in a hex: the turns the transport saves it on the way to
   * where it is needed. Nothing once it is near enough to walk as soon as ride.
   */
  private rideGain(u: number, transport: number, at: number, need: readonly number[], turn: number): number {
    if (transport < 0 || at < 0 || this.info(u).type.move <= 0) return 0;
    const g = this.rules.board.grid;
    const slow = this.pace[u] as number;
    const fast = this.pace[transport] as number;
    if (fast <= slow) return 0;
    let best = 0;
    this.rules.objectives.forEach((o, k) => {
      const d = distance(g, at, o.hex);
      const saved = d / slow - (d / fast + 1);
      if (saved > 0) best = Math.max(best, (need[k] as number) * o.points * this.horizon(turn) * Math.min(1, saved / this.t.pullTurns));
    });
    return this.t.pull * best;
  }

  /**
   * The best action of the list, if any is worth taking: the best guesses looked at exactly, then the chains, then the one of
   * most worth. Equal ones are told apart by the stream.
   */
  best(legal: readonly ImpulseAction[], stream: RandomStream, trace: ImpulsePlanner['trace'] = null): Chosen | null {
    const t = this.t;
    // Drawn before anything else, so that it is the same draw whatever the position holds.
    const slip = stream.unit();
    const { all, follow } = this.options(legal);
    if (all.length === 0) return null;
    all.sort((p, q) => q.guess - p.guess);
    // The best guesses, and at least the best of each kind of attack. A level that looks at nothing exactly (`exact` 0) goes
    // by its first impression of every action.
    const looked: Option[] = [];
    const kinds = new Map<string, number>();
    if (t.exact <= 0) {
      for (const o of all) {
        o.gain = o.guess;
        o.real = o.guess;
        looked.push(o);
      }
    }
    for (const o of t.exact <= 0 ? [] : all) {
      const k = o.action.type;
      const had = kinds.get(k) ?? 0;
      const attack = k === 'fire' || k === 'assault' || k === 'overrun';
      if (looked.length < t.exact || (attack && had < 2 && o.guess > -1)) {
        if (o.guess < -3 && !(attack && had < 1)) continue;
        this.exact(o);
        looked.push(o);
        kinds.set(k, had + 1);
      }
    }
    if (looked.length === 0) return null;

    // Chains.
    const chained = new Map<Option, { gain: number; why: string }>();
    let tried = 0;
    const byGain = looked.slice().sort((p, q) => q.gain - p.gain);
    // A short move, then the shot from the new place: alone, or joining the units that already have that target in their sights.
    const fires = looked.filter(o => o.action.type === 'fire');
    for (const o of byGain) {
      if (tried >= t.chains) break;
      const next = follow.get(o.action);
      if (next && next.type === 'assault' && o.action.type === 'move') {
        // A move beside a tank with movement over, then the close assault from there (rulings 80 and 81): alone, and with
        // the companies beside it already.
        tried++;
        const mover = o.action.unit;
        const then: ImpulseAction[] = [{ ...next, units: [{ unit: mover, path: [] }] }];
        if (next.units.length > 1) then.push(next);
        const gain = this.chain(o.action, then);
        if (gain > o.gain + 1e-9) {
          chained.set(o, { gain, why: `${this.name(mover)} moves to ${this.label(o.action.path[o.action.path.length - 1] as number)}, beside ${this.name(next.target)}, to close assault it${next.units.length > 1 ? ' with the companies already there' : ''}` });
        }
        continue;
      }
      if (!next || next.type !== 'fire' || o.action.type !== 'move') continue;
      tried++;
      const mover = o.action.unit;
      const then: ImpulseAction[] = [next];
      let joined = 0;
      for (const f of fires) {
        const fa = f.action;
        if (joined >= 2 || fa.type !== 'fire' || fa.target !== next.target || fa.firers.includes(mover) || fa.firers.length + 1 > t.together) continue;
        then.push({ type: 'fire', firers: [...fa.firers, mover], target: next.target });
        joined++;
      }
      const gain = this.chain(o.action, then);
      if (gain > o.gain + 1e-9) {
        chained.set(o, { gain, why: `${this.name(mover)} moves to ${this.label(o.action.path[o.action.path.length - 1] as number)} for a shot at ${this.name(next.target)}${joined > 0 ? ', to fire with the others that have it in their sights' : ''}` });
      }
    }
    // Fire on a tank, then the charge; fire on a unit that would react, then what it would have shot at.
    for (const second of byGain) {
      if (tried >= t.chains) break;
      const a = second.action;
      const wanted = new Set<number>();
      if (a.type === 'assault') wanted.add(a.target);
      if (a.type === 'move' || a.type === 'overrun' || a.type === 'dismount' || a.type === 'assault') {
        const plans = a.type === 'move' ? [this.rules.planPath(this.view, a.unit, a.path)] : this.rules.preview(this.view, this.rules.seats[this.side] as string, a) ?? [];
        for (const plan of plans) for (const shot of plan.shots) wanted.add(shot.reactor);
      }
      if (wanted.size === 0) continue;
      for (const first of fires) {
        if (tried >= t.chains) break;
        const f = first.action;
        if (f.type !== 'fire' || !wanted.has(f.target) || f.firers.some(u => second.units.includes(u))) continue;
        tried++;
        const gain = this.chain(f, [a]);
        const alone = Math.max(second.gain, first.gain, chained.get(first)?.gain ?? -Infinity);
        if (gain > alone + t.chainEdge) {
          const why = a.type === 'assault' && a.target === f.target
            ? `${f.firers.map(u => this.name(u)).join(' and ')} fire${f.firers.length > 1 ? '' : 's'} on ${this.name(f.target)} first, so that the charge goes in against a shaken target`
            : `${f.firers.map(u => this.name(u)).join(' and ')} fire${f.firers.length > 1 ? '' : 's'} on ${this.name(f.target)} first, to silence it before ${second.units.map(u => this.name(u)).join(' and ')} move${second.units.length > 1 ? '' : 's'} in its sight`;
          chained.set(first, { gain, why });
        }
      }
    }

    // What each unit could do alone, so that an action of several units must beat what the others give up. (Where what the
    // units still to act could do is reckoned into every worth, that is already in it.)
    const alone = new Map<number, number>();
    if (t.potential <= 0) {
      for (const o of looked) {
        if (o.units.length !== 1) continue;
        const u = o.units[0] as number;
        const gain = Math.max(o.gain, chained.get(o)?.gain ?? -Infinity);
        if (gain > (alone.get(u) ?? 0)) alone.set(u, gain);
      }
    }
    let best: Option | null = null;
    let bestNet = -Infinity;
    let bestGain = 0;
    const worth: { o: Option; net: number; gain: number }[] = [];
    for (const o of looked) {
      const gain = Math.max(o.gain, chained.get(o)?.gain ?? -Infinity);
      let net = gain;
      if (t.potential <= 0 && o.units.length > 1) {
        const given = o.units.map(u => alone.get(u) ?? 0);
        net -= given.reduce((p, q) => p + q, 0) - Math.max(...given);
      }
      net += stream.unit() * 0.001;
      if (net >= t.worthIt) worth.push({ o, net, gain });
      if (net > bestNet) {
        best = o;
        bestNet = net;
        bestGain = gain;
      }
    }
    if (slip < t.slip && worth.length >= 2) {
      // A lesser choice than the best (the level's `slip`): still one worth taking.
      worth.sort((p, q) => q.net - p.net);
      const lesser = (slip < t.slip / 3 && worth.length >= 3 ? worth[2] : worth[1]) as { o: Option; net: number; gain: number };
      best = lesser.o;
      bestNet = lesser.net;
      bestGain = lesser.gain;
    }
    if (bestNet < t.worthIt && t.potential > 0) {
      // Nothing betters the position as it stands with all that could still be done in it: then what could be done is
      // done, the action that gains most by itself first.
      for (const o of looked) {
        const real = o.real + stream.unit() * 0.001;
        if (o.real >= t.worthIt && (bestNet < t.worthIt || real > bestNet)) {
          best = o;
          bestNet = real;
          bestGain = o.real;
        }
      }
    }
    if (trace) trace(looked.map(o => ({ action: o.action, guess: o.guess, gain: Math.max(o.gain, chained.get(o)?.gain ?? -Infinity), why: chained.get(o)?.why ?? o.why })));
    if (best === null || bestNet < t.worthIt) return null;
    const chainWhy = chained.get(best);
    const why = chainWhy && chainWhy.gain >= best.gain ? chainWhy.why : best.why !== '' ? best.why : this.whyMove(best.action);
    return { action: best.action, why, gain: bestGain };
  }

  /** The sum of what the units of an open activation could each best do: what an order on it promises. */
  promise(legal: readonly ImpulseAction[]): number {
    const { all } = this.options(legal);
    all.sort((p, q) => q.guess - p.guess);
    const used = new Set<number>();
    let total = 0;
    let looked = 0;
    for (const o of all) {
      if (o.guess < this.t.worthIt || looked >= this.t.exact) break;
      if (o.units.some(u => used.has(u))) continue;
      looked++;
      this.exact(o);
      const gain = o.real;
      if (gain < this.t.worthIt) continue;
      for (const u of o.units) used.add(u);
      total += gain;
    }
    return total;
  }

  /** In plain words, why a unit moves where it does: the largest of the reasons a person would give. */
  private whyMove(a: ImpulseAction): string {
    if (a.type !== 'move') return '';
    const rules = this.rules;
    const view = this.view;
    const u = a.unit;
    const s = view.units[u] as UnitState;
    const to = a.path[a.path.length - 1] as number;
    const who = this.name(u);
    const g = rules.board.grid;
    const where = this.label(to);
    if (view.missions.some(m => m.kind === 'he' && m.hex === s.hex) && !view.missions.some(m => m.kind === 'he' && m.hex === to)) {
      return `${who} steps out from under the shells marked on ${this.label(s.hex)}, to ${where}`;
    }
    const k = rules.objectives.findIndex(o => o.hex === to);
    if (k >= 0 && this.info(u).combat) return `${who} moves onto the objective at ${where}${view.holders[k] === this.side ? ' to keep it' : ' to take it'}`;
    const info = this.info(u);
    if (info.type.class === 'hard') {
      const closers = (hex: number): number => {
        let n = 0;
        for (const e of rules.sideUnits[this.foe] as readonly number[]) {
          const es = view.units[e] as UnitState;
          if (!es.destroyed && es.hex >= 0 && !es.suppressed && this.info(e).type.assaults && this.canClose(e, es.hex, hex)) n++;
        }
        return n;
      };
      const before = closers(s.hex);
      const after = closers(to);
      if (before > after) return `${who} pulls back to ${where}, out of reach of ${before === 1 ? 'the infantry company' : `the ${before} infantry companies`} that could charge it`;
    }
    if (info.type.assaults) {
      for (const e of rules.sideUnits[this.foe] as readonly number[]) {
        const es = view.units[e] as UnitState;
        if (es.destroyed || es.hex < 0 || this.info(e).type.class !== 'hard') continue;
        if (!this.canClose(u, s.hex, es.hex) && this.canClose(u, to, es.hex)) return `${who} closes up to ${where}, within a charge of ${this.name(e)}`;
      }
    }
    const before = this.danger(view, this.foe, !this.foeNext, u, s.hex, s.suppressed, s.revealed > 0, false);
    const after = this.danger(view, this.foe, !this.foeNext, u, to, s.suppressed, s.revealed > 0, false);
    if (before.kill + before.sup > after.kill + after.sup + 0.15) return `${who} moves to ${where}, where less can be brought to bear on it`;
    const shot = this.shotFrom(u, to);
    if (shot.target >= 0 && this.shotFrom(u, s.hex).value < shot.value) return `${who} moves to ${where} for a line of fire on ${this.name(shot.target)}`;
    let nearest = -1;
    let nearestD = Infinity;
    rules.objectives.forEach((o, j) => {
      const d = distance(g, to, o.hex);
      if (d < nearestD && d < distance(g, s.hex, o.hex)) {
        nearestD = d;
        nearest = j;
      }
    });
    if (nearest >= 0) return `${who} moves to ${where}, nearer the objective at ${this.label((rules.objectives[nearest] as { hex: number }).hex)}`;
    return `${who} moves to ${where}`;
  }

  // ---------------------------------------------------------------------------
  // fire discipline
  // ---------------------------------------------------------------------------

  /**
   * A change of fire discipline to make before the move ends, if one is due: fire is held for armour where the shots at the
   * enemy's armour are worth clearly more than the shots at the rest, and is free otherwise. In the formation game each
   * formation is weighed on its own shots. Where the whole side moves (`sequence.activation: side`) a person has one
   * switch for the side's setting (H), and so has the planner: the setting is decided from the sums over all the side's
   * formations and given as H gives it. A press of H goes to the setting after the side's own in the rules' order (to the
   * first when its formations are set unlike) and gives it to each formation in turn; the planner does the same, one
   * formation a decision, and presses again until the side is at the setting it wants (from holding fire for armour back
   * to firing freely is two presses, through holding fire).
   */
  discipline(legal: readonly ImpulseAction[]): Chosen | null {
    // Only when the enemy moves next in this turn, as before ruling 84 (under own-turn the second side's settings would count
    // across the turn's end too; left as it was, docs/review/M7/ready-handover.md and levels2-handover.md).
    if (!this.foeNext || !this.sameTurn) return null;
    const rules = this.rules;
    const t = this.t;
    const view = this.view;
    const mine = rules.sideFormations[this.side] as readonly number[];
    // The shots each unit would take with every formation firing freely, at the enemy's units as its next move finds them.
    const foe = this.foeAt;
    const free: ImpulseView = { ...foe, formations: foe.formations.map((f, i) => (mine.includes(i) ? { ...f, discipline: 'free' as Discipline } : f)) };
    const atHard = new Float64Array(view.formations.length);
    const atSoft = new Float64Array(view.formations.length);
    const b = rules.board;
    for (const e of rules.sideUnits[this.foe] as readonly number[]) {
      const s = foe.units[e] as UnitState;
      const ie = this.info(e);
      if (s.destroyed || s.hex < 0 || s.suppressed || s.spent || s.moved || ie.type.move <= 0) continue;
      const worth = this.full(e, view.turn);
      for (let d = 0; d < 6; d++) {
        const h = b.neighbour[s.hex * 6 + d] as number;
        if (h < 0 || !this.stepOpen(e, s.hex, h)) continue;
        for (const shot of rules.planPath(free, e, [h]).shots) {
          const f = this.info(shot.reactor).formation;
          const v = (worth * (shot.destroy + t.supCost * (shot.effect - shot.destroy))) / shot.of;
          if (ie.type.class === 'hard') atHard[f] = (atHard[f] as number) + v;
          else atSoft[f] = (atSoft[f] as number) + v;
        }
      }
    }
    const choose = (hard: number, soft: number): Discipline => (hard > 0 && hard >= t.armorOnly * soft ? 'armor' : 'free');
    if (!rules.sideProfile) {
      for (const f of mine) {
        const want = choose(atHard[f] as number, atSoft[f] as number);
        const now = (view.formations[f] as { discipline: Discipline }).discipline;
        if (want === now) continue;
        const action = legal.find(a => a.type === 'discipline' && a.formation === f && a.setting === want);
        if (!action) continue;
        const id = (rules.formationInfo[f] as { id: string }).id;
        return { action, why: want === 'armor' ? `formation ${id} holds its fire for armor` : `formation ${id} is free to fire at anything that moves`, gain: 0 };
      }
      return null;
    }
    // The whole side: one setting, from what all its formations would shoot at, given as the side's switch gives it.
    let hard = 0;
    let soft = 0;
    for (const f of mine) {
      hard += atHard[f] as number;
      soft += atSoft[f] as number;
    }
    const want = choose(hard, soft);
    const at = mine.map(f => (view.formations[f] as { discipline: Discipline }).discipline);
    if (at.every(d => d === want)) return null;
    const next = pressTo(at);
    for (let k = 0; k < mine.length; k++) {
      if (at[k] === next) continue;
      const action = legal.find(a => a.type === 'discipline' && a.formation === mine[k] && a.setting === next);
      if (!action) continue;
      const why = next !== want ? `the side's setting goes through ${next} on its way to ${want}, as the side's one switch does`
        : want === 'armor' ? 'the side holds its fire for armor' : 'the side is free to fire at anything that moves';
      return { action, why, gain: 0 };
    }
    return null;
  }

  /**
   * Where the whole side moves: a change of the side's fire discipline begun and not finished, to be finished before
   * anything else is weighed (its formations set unlike, or all at holding fire, which the planner passes through on the
   * side's switch but never wants). Null when none is under way, or when none is due now.
   */
  settingUnderWay(legal: readonly ImpulseAction[]): Chosen | null {
    if (!this.rules.sideProfile) return null;
    const at = (this.rules.sideFormations[this.side] as readonly number[]).map(f => (this.view.formations[f] as { discipline: Discipline }).discipline);
    if (at.length === 0 || (at.every(d => d === at[0]) && at[0] !== 'hold')) return null;
    return this.discipline(legal);
  }
}

/** The setting after `d` in the rules' order, the order the side's switch (H) goes through them. */
function afterIn(d: Discipline): Discipline {
  return DISCIPLINES[(DISCIPLINES.indexOf(d) + 1) % DISCIPLINES.length] as Discipline;
}

/**
 * The setting a press of the side's switch gives, from the side's formations' settings in order (`at`): the one after the
 * side's own; the first in the rules' order when they are set unlike. A press is one action a formation: part-way
 * through one, the first formations are at the setting after the one all the others are at, and the press goes on to it.
 * (A side that starts so set unlike is read as such a press: a person's first press would go to the first setting.)
 */
function pressTo(at: readonly Discipline[]): Discipline {
  const first = at[0] as Discipline;
  const k = at.findIndex(d => d !== first);
  if (k < 0) return afterIn(first);
  const rest = at[k] as Discipline;
  if (first === afterIn(rest) && at.slice(k).every(d => d === rest)) return first;
  return DISCIPLINES[0] as Discipline;
}
