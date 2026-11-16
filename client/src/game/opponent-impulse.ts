/**
 * A stand-in computer opponent for Formation Impulse, so that a person has a
 * game to play. The project's real opponents are a later package and replace
 * it. It follows the engine's agent contract (engine/ai/agent.ts): a view,
 * the legal list and its own random stream in, one of the listed actions out;
 * no memory between calls; no randomness but the stream.
 *
 * How it decides. Every action a unit could take is given a value in the
 * rules' own currency, unit cost:
 *
 *   fire             the target's cost times the chance of destroying it, and a share of it
 *                    for suppressing it; less a little for every firer (a unit that fires
 *                    is Spent and no longer covers its front)
 *   a move           what the place is worth more than where the unit stands (nearer its
 *                    objective, on it, in cover, out of the enemy's fire, with a shot of its
 *                    own), less what the previewed reaction fire is expected to cost it
 *                    (the ruleset's own plan of the move, rule 8.8)
 *   a close assault  as fire, by the assault's column with every unit arriving; less what
 *                    being thrown back costs, and the reaction fire on each approach
 *   an overrun       as fire for each unit it would attack, less the reaction fire on the
 *                    way and at the exit
 *   mounting         when the unit is far from its objective and its transport is at hand
 *   dismounting      when the transport has brought it near its objective or the enemy
 *   a fire mission   the cost of what stands in the hex times the chance of an effect and
 *                    of its still being there when the mission lands
 *
 * In an activation it takes the best action while one is worth taking, then
 * ends the activation, leaving the rest Ready to fire on the enemy's moves.
 * With an order to give it looks one step ahead for each formation it could
 * activate: the position after the activation (the ruleset's own branches),
 * that position's legal list, and the sum of the best action of each unit;
 * it activates the formation that promises most, and passes when none
 * promises anything.
 *
 * It does not plan beyond the one action, does not use smoke, never changes
 * fire discipline, and does not weigh what the enemy will do next beyond the
 * fire it would come under where it stands.
 */
import { distance } from '../../../engine/core/hex';
import type { RandomStream } from '../../../engine/core/random';
import type { Agent } from '../../../engine/ai/agent';
import type { ImpulseRuleset, UnitInfo } from '../../../engine/rulesets/impulse/rules';
import type { ImpulseAction, ImpulseView, PlannedShot, UnitState } from '../../../engine/rulesets/impulse/types';

type Act<T extends ImpulseAction['type']> = Extract<ImpulseAction, { type: T }>;

/** The weights of the opponent's judgement: all in unit cost. */
export interface Tuning {
  /** A suppressed enemy is worth this share of a destroyed one. */
  readonly suppressShare: number;
  /** What a unit gives up by acting (it is Spent: no reaction fire from it this turn). */
  readonly spentCost: number;
  /** Each hex nearer the unit's objective. */
  readonly perHex: number;
  /** Standing on an objective, per point of it. */
  readonly onObjective: number;
  /** Each step of cover against fire, and a hex that conceals. */
  readonly cover: number;
  readonly concealed: number;
  /** The share of the harm the enemy's fire could do to the unit where it would stand. */
  readonly underFire: number;
  /** The share of the harm the unit's own best shot could do from where it would stand. */
  readonly firingPosition: number;
  /** An action must be worth this much to be taken. */
  readonly worthIt: number;
  /** How many places a unit could move to are weighed with their reaction fire. */
  readonly movesWeighed: number;
}

export const DEFAULT_TUNING: Tuning = {
  suppressShare: 0.4, spentCost: 0.3, perHex: 0.38, onObjective: 1.4, cover: 0.35, concealed: 0.4, underFire: 0.22, firingPosition: 0.12, worthIt: 0.3, movesWeighed: 10,
};

interface Scored {
  readonly action: ImpulseAction;
  readonly value: number;
  readonly units: readonly number[];
}

interface Enemy {
  readonly index: number;
  readonly info: UnitInfo;
  readonly hex: number;
  readonly state: UnitState;
}

/** What one decision reads of a view, worked out once. */
interface Context {
  readonly view: ImpulseView;
  readonly side: number;
  readonly enemies: readonly Enemy[];
  /** Per unit: the objective hex it is making for, or -1. */
  readonly goal: Map<number, number>;
  /** hex -> points, for objective hexes. */
  readonly objective: Map<number, number>;
  /** Friendly combat units standing on each hex (for "is the objective already held"). */
  readonly friendsAt: Map<number, number>;
}

function supportOf(steps: readonly number[], n: number): number {
  let total = 0;
  for (let k = 0; k < n - 1; k++) total += steps[Math.min(k, steps.length - 1)] ?? 0;
  return total;
}

export class ImpulseOpponent implements Agent<ImpulseView, ImpulseAction> {
  readonly id = 'impulse-stand-in/1';
  readonly rules: ImpulseRuleset;
  readonly tuning: Tuning;

  constructor(rules: ImpulseRuleset, tuning: Partial<Tuning> = {}) {
    this.rules = rules;
    this.tuning = { ...DEFAULT_TUNING, ...tuning };
  }

  decide(view: ImpulseView, legal: readonly ImpulseAction[], stream: RandomStream): ImpulseAction {
    const first = (type: ImpulseAction['type']): ImpulseAction | undefined => legal.find(a => a.type === type);
    const fallback = first('end') ?? first('pass') ?? first('takeSetup') ?? (legal[0] as ImpulseAction);
    if (view.stage === 'deploy') return first('takeSetup') ?? first('submit') ?? fallback;
    const land = first('land');
    if (land) return land;
    const side = view.viewer === null ? -1 : this.rules.seats.indexOf(view.viewer);
    if (side < 0) return fallback;
    if (!view.activation) return this.order(view, side, legal, stream) ?? fallback;
    const best = this.best(this.scored(this.context(view, side), legal), stream);
    return best && best.value >= this.tuning.worthIt ? best.action : fallback;
  }

  /** The action of most value; equal ones are told apart by the stream. */
  private best(list: readonly Scored[], stream: RandomStream): Scored | null {
    let best: Scored | null = null;
    let bestValue = -Infinity;
    for (const s of list) {
      const v = s.value + stream.unit() * 0.02;
      if (v > bestValue) {
        best = s;
        bestValue = v;
      }
    }
    return best;
  }

  /** An order to give: the activation whose units' best actions sum to most; a pass when none is worth an order. */
  private order(view: ImpulseView, side: number, legal: readonly ImpulseAction[], stream: RandomStream): ImpulseAction | null {
    let best: ImpulseAction | null = null;
    let bestValue = -Infinity;
    for (const a of legal) {
      if (a.type !== 'activate' && a.type !== 'activateUnit' && a.type !== 'activateSide') continue;
      const after = this.rules.branches(view, a)[0]?.view;
      let value = 0;
      if (after && after.activation && after.impulse === side) {
        const acts = this.scored(this.context(after, side), this.rules.legalActions(after)).filter(s => s.value >= this.tuning.worthIt);
        acts.sort((x, y) => y.value - x.value);
        const used = new Set<number>();
        for (const s of acts) {
          if (s.units.some(u => used.has(u))) continue;
          for (const u of s.units) used.add(u);
          value += s.value;
        }
      }
      value += stream.unit() * 0.02;
      if (value > bestValue) {
        best = a;
        bestValue = value;
      }
    }
    return best !== null && bestValue >= this.tuning.worthIt ? best : null;
  }

  // ---------------------------------------------------------------------------
  // what a decision reads of the view
  // ---------------------------------------------------------------------------

  private context(view: ImpulseView, side: number): Context {
    const rules = this.rules;
    const enemies: Enemy[] = [];
    for (const i of rules.sideUnits[1 - side] ?? []) {
      const state = view.units[i] as UnitState;
      if (!state.destroyed && state.hex >= 0) enemies.push({ index: i, info: rules.unitInfo[i] as UnitInfo, hex: state.hex, state });
    }
    const objective = new Map<number, number>(rules.objectives.map(o => [o.hex, o.points]));
    const friendsAt = new Map<number, number>();
    for (const i of rules.sideUnits[side] ?? []) {
      const u = view.units[i] as UnitState;
      if (!u.destroyed && u.hex >= 0 && (rules.unitInfo[i] as UnitInfo).combat) friendsAt.set(u.hex, (friendsAt.get(u.hex) ?? 0) + 1);
    }
    const g = rules.board.grid;
    const goal = new Map<number, number>();
    for (const i of rules.sideUnits[side] ?? []) {
      const at = rules.whereIs(view, i);
      if (at < 0) continue;
      let bestHex = -1;
      let bestWeight = -Infinity;
      rules.objectives.forEach((o, k) => {
        // An objective the side holds with a unit on it already pulls less; one the enemy stands on pulls more.
        const mine = view.holders[k] === side && (friendsAt.get(o.hex) ?? 0) > 0 && (view.units[i] as UnitState).hex !== o.hex;
        const weight = (o.points / (distance(g, at, o.hex) + 3)) * (mine ? 0.35 : 1);
        if (weight > bestWeight) {
          bestWeight = weight;
          bestHex = o.hex;
        }
      });
      goal.set(i, bestHex);
    }
    return { view, side, enemies, goal, objective, friendsAt };
  }

  private info(i: number): UnitInfo {
    return this.rules.unitInfo[i] as UnitInfo;
  }

  private worth(ctx: Context, i: number): number {
    const u = ctx.view.units[i] as UnitState;
    const passenger = this.rules.passengerOf(ctx.view, i);
    return this.info(i).type.cost + (u.hex >= 0 && ctx.objective.has(u.hex) ? 1.5 : 0) + (passenger >= 0 ? 0.6 * this.info(passenger).type.cost : 0);
  }

  /** The chance (0 to 1) of any effect, and of destroying, at a column. */
  private chances(column: number, suppressed: boolean): { effect: number; destroy: number } {
    const w = this.rules.table.ways(column, suppressed);
    const total = this.rules.table.total;
    return { effect: (w.suppressed + w.destroyed) / total, destroy: w.destroyed / total };
  }

  /** What an attack at a column is worth against a unit. */
  private harm(ctx: Context, target: number, column: number): number {
    const c = this.chances(column, (ctx.view.units[target] as UnitState).suppressed);
    return this.worth(ctx, target) * (c.destroy + (c.effect - c.destroy) * this.tuning.suppressShare);
  }

  /** The column of a shot by a unit of type `from` standing in `a` at a unit of type `at` standing in `b`, or null when it has none. */
  private columnFrom(view: ImpulseView, from: UnitInfo, a: number, at: UnitInfo, b: number): number | null {
    const fire = at.type.class === 'hard' ? from.type.ap : from.type.he;
    if (fire <= 0 || from.battery) return null;
    const step = this.rules.rangeStep(distance(this.rules.board.grid, a, b), from.type.range);
    if (step === null || !this.rules.sees(view, a, b)) return null;
    return fire - at.type.defense - (this.rules.coverFire[b] ?? 0) + step;
  }

  /** What standing in a hex is worth to a unit: nearer its objective, on it, in cover, out of fire, with a shot. */
  private place(ctx: Context, i: number, hex: number): number {
    const t = this.tuning;
    const rules = this.rules;
    const info = this.info(i);
    const g = rules.board.grid;
    const view = ctx.view;
    const here = (view.units[i] as UnitState).hex;
    let value = 0;
    const carrying = rules.passengerOf(view, i);
    const fights = info.combat || carrying >= 0;
    const goal = ctx.goal.get(i) ?? -1;
    if (goal >= 0 && fights) {
      // A loaded transport stops short: it carries its passenger near, not onto, the objective.
      const d = distance(g, hex, goal);
      value -= t.perHex * (carrying >= 0 && !info.type.overruns ? Math.abs(d - 1) : d);
    }
    const points = ctx.objective.get(hex);
    if (points !== undefined && info.combat && (ctx.friendsAt.get(hex) ?? 0) - (here === hex ? 1 : 0) === 0) value += t.onObjective * points;
    value += t.cover * (rules.coverFire[hex] ?? 0) + (rules.conceals[hex] === 1 ? t.concealed : 0);
    // The fire it would be under there, and the best shot it would have.
    const mine = info.type.cost + (carrying >= 0 ? 0.6 * this.info(carrying).type.cost : 0);
    const hidden = rules.conceals[hex] === 1 && !ctx.enemies.some(e => e.info.combat && !e.state.suppressed
      && distance(g, e.hex, hex) <= rules.rules.spot.distance && rules.sees(view, e.hex, hex));
    let shot = 0;
    for (const e of ctx.enemies) {
      if (!hidden && !e.state.suppressed) {
        const col = this.columnFrom(view, e.info, e.hex, info, hex);
        if (col !== null) {
          const c = this.chances(col, false);
          value -= t.underFire * mine * (c.destroy + (c.effect - c.destroy) * 0.5) * (e.state.spent ? 0.5 : 1);
        }
      }
      const out = this.columnFrom(view, info, hex, e.info, e.hex);
      if (out !== null && rules.mayBeFiredAt(view, 1 - ctx.side, e.hex, e.state.revealed > 0)) shot = Math.max(shot, this.harm(ctx, e.index, out));
    }
    return value + t.firingPosition * shot;
  }

  /** What the previewed reaction fire is expected to cost a mover: each shot in turn, while it is still coming on. */
  private underShots(shots: readonly PlannedShot[], worth: number): number {
    let coming = 1;
    let cost = 0;
    for (const s of shots) {
      const effect = s.effect / s.of;
      const destroy = s.destroy / s.of;
      cost += coming * worth * (destroy + (effect - destroy) * 0.55);
      coming *= 1 - effect;
    }
    return cost;
  }

  // ---------------------------------------------------------------------------
  // the value of every action of an open activation
  // ---------------------------------------------------------------------------

  private scored(ctx: Context, legal: readonly ImpulseAction[]): Scored[] {
    const t = this.tuning;
    const rules = this.rules;
    const view = ctx.view;
    const g = rules.board.grid;
    const seat = rules.seats[ctx.side] as string;
    const out: Scored[] = [];
    const moves = new Map<number, { action: Act<'move'>; to: number }[]>();
    const missions = new Map<number, Act<'mission'>[]>();
    const occupied = new Set(ctx.enemies.map(e => e.hex));

    for (const a of legal) {
      switch (a.type) {
        case 'fire': {
          const target = view.units[a.target] as UnitState;
          let bestOwn = -Infinity;
          for (const f of a.firers) bestOwn = Math.max(bestOwn, rules.ownColumn(view, f, a.target, target.hex) ?? -Infinity);
          const column = bestOwn + supportOf(rules.rules.support.steps, a.firers.length);
          out.push({ action: a, value: this.harm(ctx, a.target, column) - t.spentCost * a.firers.length, units: a.firers });
          break;
        }
        case 'move': {
          const to = a.path[a.path.length - 1] as number;
          const list = moves.get(a.unit);
          if (list) list.push({ action: a, to });
          else moves.set(a.unit, [{ action: a, to }]);
          break;
        }
        case 'assault': {
          const all = a.units.map(u => u.unit);
          let bestOwn = -Infinity;
          for (const u of all) bestOwn = Math.max(bestOwn, rules.assaultColumn(view, u, a.target));
          const column = bestOwn + supportOf(rules.rules.assault.support, all.length);
          const target = view.units[a.target] as UnitState;
          const c = this.chances(column, target.suppressed);
          let value = this.harm(ctx, a.target, column) - t.spentCost * all.length;
          // Thrown back, every unit that assaulted is suppressed.
          for (const u of all) value -= (1 - c.effect) * 0.45 * this.info(u).type.cost;
          for (const plan of rules.preview(view, seat, a) ?? []) value -= this.underShots(plan.shots, this.info(plan.unit).type.cost);
          // Going in after is worth what the target's hex is worth more than where the first unit stands.
          if (a.advance.length > 0) {
            const lead = a.advance[0] as number;
            const from = a.units.find(u => u.unit === lead);
            const stand = from && from.path.length > 0 ? (from.path[from.path.length - 1] as number) : (view.units[lead] as UnitState).hex;
            value += c.destroy * Math.max(-1, this.place(ctx, lead, target.hex) - this.place(ctx, lead, stand)) + 0.01;
          }
          out.push({ action: a, value, units: all });
          break;
        }
        case 'overrun': {
          let value = -t.spentCost;
          for (const e of ctx.enemies) {
            if (e.hex !== a.target || e.info.type.class !== 'soft') continue;
            if (e.info.transport && !e.info.combat && rules.passengerOf(view, e.index) < 0) value += e.info.type.cost;
            else value += this.harm(ctx, e.index, rules.overrunColumn(a.unit, e.index, a.target));
          }
          const plan = rules.preview(view, seat, a)?.[0];
          if (plan) {
            value -= this.underShots(plan.shots, this.worth(ctx, a.unit));
            const exit = plan.path[plan.path.length - 1] as number;
            value += 0.5 * (this.place(ctx, a.unit, exit) - this.place(ctx, a.unit, (view.units[a.unit] as UnitState).hex));
          }
          out.push({ action: a, value, units: [a.unit] });
          break;
        }
        case 'mount': {
          // Worth it when the unit is far from where it is going and the transport can still move this turn or the next.
          const goal = ctx.goal.get(a.unit) ?? -1;
          const at = (view.units[a.unit] as UnitState).hex;
          const far = goal >= 0 ? distance(g, at, goal) : 0;
          const near = ctx.enemies.some(e => e.info.combat && distance(g, e.hex, at) <= 3);
          const carrier = this.info(a.transport);
          const value = far >= 6 && !near && carrier.type.move > this.info(a.unit).type.move ? 0.3 * (far - 4) : -1;
          out.push({ action: a, value, units: [a.unit] });
          break;
        }
        case 'dismount': {
          const carrier = (view.units[a.unit] as UnitState).carriedBy;
          const at = carrier >= 0 ? (view.units[carrier] as UnitState).hex : -1;
          const goal = ctx.goal.get(a.unit) ?? -1;
          const near = goal >= 0 && at >= 0 && distance(g, at, goal) <= 2;
          const pressed = at >= 0 && ctx.enemies.some(e => e.info.combat && distance(g, e.hex, at) <= 3);
          let value = near || pressed ? 1.2 + this.place(ctx, a.unit, a.hex) - (at >= 0 ? this.place(ctx, a.unit, at) : 0) : -1;
          if (value > 0) value -= this.underShots(rules.preview(view, seat, a)?.[0]?.shots ?? [], this.info(a.unit).type.cost);
          out.push({ action: a, value, units: [a.unit] });
          break;
        }
        case 'mission': {
          if (a.kind !== 'he' || !occupied.has(a.hex)) break;
          const list = missions.get(a.unit);
          if (list) list.push(a);
          else missions.set(a.unit, [a]);
          break;
        }
        default:
          break;
      }
    }

    // Missions: what stands in the hex, the chance of an effect on it, and of its still being there when the shells land.
    for (const [battery, list] of missions) {
      const he = this.info(battery).type.he;
      for (const a of list) {
        let value = -0.1;
        view.units.forEach((u, i) => {
          if (u.destroyed || u.hex !== a.hex) return;
          const info = this.info(i);
          const column = he - info.type.defense - (rules.coverFire[a.hex] ?? 0) + (info.type.class === 'hard' ? rules.rules.artillery.vsHard : 0);
          const stays = info.type.move === 0 || u.suppressed ? 0.9 : u.spent ? 0.7 : ctx.objective.has(a.hex) || rules.conceals[a.hex] === 1 ? 0.55 : 0.3;
          const harm = this.harm(ctx, i, column) * stays;
          value += info.side === ctx.side ? -1.5 * harm : harm;
        });
        out.push({ action: a, value, units: [battery] });
      }
    }

    // Moves: every place by what it is worth, then the best few with the reaction fire each would draw.
    for (const [unit, list] of moves) {
      const info = this.info(unit);
      const here = (view.units[unit] as UnitState).hex;
      // An empty transport without firepower stays where it is.
      if (!info.combat && rules.passengerOf(view, unit) < 0) continue;
      const stay = this.place(ctx, unit, here);
      const byPlace = new Map<number, number>();
      for (const m of list) if (!byPlace.has(m.to)) byPlace.set(m.to, this.place(ctx, unit, m.to) - stay);
      const ranked = [...byPlace.entries()].sort((x, y) => y[1] - x[1]).slice(0, t.movesWeighed);
      const keep = new Set(ranked.filter(([, gain]) => gain - t.spentCost >= t.worthIt).map(([to]) => to));
      const worth = this.worth(ctx, unit);
      for (const m of list) {
        if (!keep.has(m.to)) continue;
        const shots = rules.planPath(view, unit, m.action.path).shots;
        out.push({ action: m.action, value: (byPlace.get(m.to) as number) - t.spentCost - this.underShots(shots, worth), units: [unit] });
      }
    }
    return out;
  }
}
