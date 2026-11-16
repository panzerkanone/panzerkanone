/**
 * A simple heuristic agent for the reference ruleset. It sees a view, the
 * legal actions and its own random stream; from the ruleset it is made with it
 * reads only static content (the board, unit types, objectives) and the
 * outcome distribution of an attack, which is the only place it takes odds
 * from (research-ai section 4.0: the AI never holds a fire table).
 *
 *   set-up:     each unit goes to the hex of its zone nearest an objective,
 *               with a preference for cover and a little noise
 *   gunnery:    declare the shot that adds the most expected value to the
 *               fire already declared on its target; end the phase when no
 *               shot adds enough
 *   manoeuvre:  make the move that most improves its unit's position (nearer
 *               an objective and within its own range of an enemy it can hurt,
 *               in cover, out of the enemy's sight); end the phase when no move
 *               improves enough
 */
import { HexId, distance } from '../core/hex';
import type { RandomStream } from '../core/random';
import type { ReferenceRuleset, TypeInfo } from '../rulesets/reference/rules';
import type { RefAction, RefView, UnitState } from '../rulesets/reference/types';
import type { Agent } from './agent';

/** An enemy unit as the manoeuvre scoring reads it. */
interface Enemy {
  readonly hex: HexId;
  readonly type: TypeInfo;
}

/** How much a suppression is worth, as a share of the target's value. */
const SUPPRESS_SHARE = 0.35;
/** The least expected gain for which a shot is declared. */
const FIRE_THRESHOLD = 0.35;
/** The least improvement for which a move is made. */
const MOVE_THRESHOLD = 0.25;

export class HeuristicAgent implements Agent<RefView, RefAction> {
  readonly id = 'heuristic';
  private readonly rules: ReferenceRuleset;

  constructor(rules: ReferenceRuleset) {
    this.rules = rules;
  }

  decide(view: RefView, legal: readonly RefAction[], stream: RandomStream): RefAction {
    const first = legal[0];
    if (first === undefined) throw new Error('heuristic agent: asked to decide with no legal action');
    const end = legal.find(a => a.type === 'end');
    if (first.type === 'submit') return first;
    if (first.type === 'place') return this.place(legal, stream);
    if (view.phase === 'gunnery') return this.gunnery(view, legal, stream) ?? end ?? first;
    if (view.phase === 'manoeuvre') return this.manoeuvre(view, legal, stream) ?? end ?? first;
    return end ?? first;
  }

  private nearestObjective(hex: HexId): number {
    let best = Number.MAX_SAFE_INTEGER;
    for (const o of this.rules.objectives) best = Math.min(best, distance(this.rules.board.grid, hex, o.hex));
    return this.rules.objectives.length === 0 ? 0 : best;
  }

  private place(legal: readonly RefAction[], stream: RandomStream): RefAction {
    let best: RefAction = legal[0] as RefAction;
    let bestScore = -Infinity;
    for (const a of legal) {
      if (a.type !== 'place') continue;
      const score = -this.nearestObjective(a.hex) + 0.5 * this.rules.coverDefenseAt(a.hex) + 2 * stream.unit();
      if (score > bestScore) {
        bestScore = score;
        best = a;
      }
    }
    return best;
  }

  /** Expected value of an attack by a group on a target, from the ruleset's outcome distribution. */
  private expected(view: RefView, attackers: readonly number[], target: number): number {
    if (attackers.length === 0) return 0;
    const t = view.units[target] as UnitState;
    const value = this.rules.typeOf(t).value;
    let ev = 0;
    for (const o of this.rules.outcomes(view, { attackers, target })) {
      if (o.result === 'destroyed') ev += o.p * value;
      else if (o.result === 'suppressed' && !t.suppressed) ev += o.p * value * SUPPRESS_SHARE;
    }
    return ev;
  }

  private gunnery(view: RefView, legal: readonly RefAction[], stream: RandomStream): RefAction | null {
    const declared = new Map<number, number[]>();
    for (const u of view.units) {
      if (u.side === view.viewer && u.target >= 0) declared.set(u.target, [...(declared.get(u.target) ?? []), u.id]);
    }
    let best: RefAction | null = null;
    let bestGain = FIRE_THRESHOLD;
    for (const a of legal) {
      if (a.type !== 'fire') continue;
      const group = declared.get(a.target) ?? [];
      const gain = this.expected(view, [...group, a.unit], a.target) - this.expected(view, group, a.target) + 1e-3 * stream.unit();
      if (gain > bestGain) {
        bestGain = gain;
        best = a;
      }
    }
    return best;
  }

  /** How good a hex is for a unit of type `me`, given where the enemy stands. */
  private positionScore(enemies: readonly Enemy[], me: TypeInfo, hex: HexId): number {
    const rules = this.rules;
    const board = rules.board;
    let score = -0.6 * this.nearestObjective(hex);
    for (const o of rules.objectives) if (o.hex === hex) score += 2.5;
    score += 0.4 * rules.coverDefenseAt(hex);
    let nearest = Number.MAX_SAFE_INTEGER;
    let chances = 0;
    let threats = 0;
    for (const e of enemies) {
      const d = distance(board.grid, hex, e.hex);
      const canHurt = (me.firepower[e.type.classIndex] as number) > 0;
      if (canHurt && d < nearest) nearest = d;
      if (d > me.range && d > e.type.range) continue;
      if (!board.sees(hex, e.hex)) continue;
      if (canHurt && d <= me.range) chances++;
      const theirs = e.type.firepower[me.classIndex] as number;
      if (theirs > 0 && d <= e.type.range) threats += theirs / me.defense;
    }
    if (nearest < Number.MAX_SAFE_INTEGER) score -= 0.4 * Math.max(0, nearest - me.range);
    score += 0.8 * Math.min(chances, 2);
    score -= 0.35 * threats;
    return score;
  }

  private manoeuvre(view: RefView, legal: readonly RefAction[], stream: RandomStream): RefAction | null {
    const rules = this.rules;
    const enemies: Enemy[] = [];
    for (const e of view.units) if (e.side !== view.viewer && !e.destroyed && e.hex >= 0) enemies.push({ hex: e.hex, type: rules.typeOf(e) });
    // A hex scores the same for every unit of one type: score each (type, hex) once.
    const scores = new Map<string, number>();
    const score = (me: TypeInfo, hex: HexId): number => {
      const key = `${me.id}/${hex}`;
      let v = scores.get(key);
      if (v === undefined) {
        v = this.positionScore(enemies, me, hex);
        scores.set(key, v);
      }
      return v;
    };
    let best: RefAction | null = null;
    let bestGain = MOVE_THRESHOLD;
    for (const a of legal) {
      if (a.type !== 'move') continue;
      const unit = view.units[a.unit] as UnitState;
      const me = rules.typeOf(unit);
      const dest = a.path[a.path.length - 1] as HexId;
      const gain = score(me, dest) - score(me, unit.hex) + 1e-3 * stream.unit();
      if (gain > bestGain) {
        bestGain = gain;
        best = a;
      }
    }
    return best;
  }
}
