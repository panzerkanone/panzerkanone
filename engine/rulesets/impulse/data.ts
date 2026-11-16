/**
 * The rules data of Formation Impulse (`format: impulse-ruleset/1`,
 * content/rulesets/v1.ruleset.yaml) and its check. Every number of
 * docs/rules/rules-v1.md is a key here (spec section 19); the terrain data the
 * board is compiled with is in the reference ruleset's shape. Checked by hand
 * in the manner of engine/core/map.ts: every key required, unknown keys
 * refused, nothing defaulted, every problem named with the file and the place.
 *
 *   format: impulse-ruleset/1
 *   id
 *   sequence:    { activation: formation | side }
 *   ready:       { when: end-phase | own-turn }   ruling 84: when units are made Ready (5.8, 5.10); own-turn needs side
 *   initiative:  { policy: alternate | fixed | bought }
 *   pass:        { rule: spends | free | final }
 *   command:     { range: a whole number or none, lossStep, min }
 *   stack:       { limit }
 *   move:        { alwaysOne }
 *   spot:        { distance }
 *   rangeSteps:  { adjacent, half, full, long, longFactor }
 *   support:     { steps: [..], within }
 *   fireTable:   { profile: two-dice | one-die, dice: { count, faces }, suppress, destroy }
 *   reaction:    { cap: a whole number or none, modifier, floor }
 *   assault:     { targets: hard | any, vsHard, coverVsHard: -1 | 0 | 1, moveShare, vsSuppressed, support: [..], afterMove }   the last support value repeats
 *   overrun:     { steps, cost }
 *   moveFire:    { class: none | hard, moveShare, steps }   a short move leaves a unit of the class able to fire once (6.8)
 *   artillery:   { vsHard }
 *   cover:       { <every cover of a map>: { fire, close, conceals, overrun } }
 *   score:       { killShare: [p, q] }
 *   break:       { share }
 *   suddenDeath: { lead }
 *   moverTypes:  [names]
 *   movement:    { road, enter: { <cover>: costs }, climb, ridge, river }   costs: one per mover type, a whole number or null
 *   seasons:     optional: { <season>: { road, enter, climb, ridge, river, lake, sea } }   ruling 83
 *   sight:       { coverAddsLevel: { <cover>: bool }, crestRule }
 *
 * `movement` is the table of a summer board (a map that names no season: engine/core/map.ts).
 * `seasons` gives, for each other season it names, the table a board of that season is compiled
 * with instead, whole (engine/core/board.ts): the five terms, and `lake` and `sea`, the cost of a
 * step into standing water of each (null: closed). Rules data without `seasons` prices summer
 * boards alone, and a board of another season is refused when it is compiled: that is no default,
 * and no season is ever priced as another.
 */
import { parse as parseText } from 'yaml';
import { BASE_SEASON, COVERS, OTHER_SEASONS, TerrainRules } from '../../core/board';
import type { Cover, Season } from '../../core/map';
import { Checker, ID_PATTERN } from '../../kernel/check';

export const RULES_FORMAT = 'impulse-ruleset/1';

export const ACTIVATIONS = ['formation', 'side'] as const;
/**
 * When units are made Ready (ruling 84): `end-phase`, every unit at the turn's end (5.8, the rule as it was); `own-turn`,
 * a side's units when its own turn begins (5.10), which only the whole-side game has.
 */
export const READY_TIMES = ['end-phase', 'own-turn'] as const;
export const POLICIES = ['alternate', 'fixed', 'bought'] as const;
export const PASS_RULES = ['spends', 'free', 'final'] as const;
export const PROFILES = ['two-dice', 'one-die'] as const;
/** What a close assault may be made on (12.1): a Hard unit only, or a unit of either class. */
export const ASSAULT_TARGETS = ['hard', 'any'] as const;
/** Whose short move leaves it able to fire once (6.8): no unit's (the rule as it was), or a Hard unit's. */
export const MOVE_FIRE_CLASSES = ['none', 'hard'] as const;
/** The number of dice each fire-table profile names (7.5): a file in which they disagree is refused. */
export const PROFILE_DICE: Readonly<Record<(typeof PROFILES)[number], number>> = { 'two-dice': 2, 'one-die': 1 };
/** The word that stands for "no number" in `command.range` and `reaction.cap`. */
export const NONE = 'none';

export type CostTable = Readonly<Record<string, number | null>>;

export interface CoverRules {
  readonly fire: number;
  readonly close: number;
  readonly conceals: boolean;
  /** Whether a hex of this cover may be overrun (12.8). */
  readonly overrun: boolean;
}

export interface MovementData {
  readonly road: CostTable;
  readonly enter: Readonly<Record<Cover, CostTable>>;
  readonly climb: CostTable;
  readonly ridge: CostTable;
  readonly river: CostTable;
}

/** A season's table (ruling 83): the five terms, and what a step into a lake's water and a sea's costs. */
export interface SeasonMovementData extends MovementData {
  readonly lake: CostTable;
  readonly sea: CostTable;
}

export interface RulesData {
  readonly format: typeof RULES_FORMAT;
  readonly id: string;
  readonly sequence: { readonly activation: (typeof ACTIVATIONS)[number] };
  /** 5.8, 5.10 (ruling 84): when units stop being Spent or Moved: every unit at the end phase, or a side's when its own turn begins. */
  readonly ready: { readonly when: (typeof READY_TIMES)[number] };
  readonly initiative: { readonly policy: (typeof POLICIES)[number] };
  readonly pass: { readonly rule: (typeof PASS_RULES)[number] };
  readonly command: { readonly range: number | typeof NONE; readonly lossStep: number; readonly min: number };
  readonly stack: { readonly limit: number };
  readonly move: { readonly alwaysOne: boolean };
  readonly spot: { readonly distance: number };
  readonly rangeSteps: { readonly adjacent: number; readonly half: number; readonly full: number; readonly long: number; readonly longFactor: number };
  readonly support: { readonly steps: readonly number[]; readonly within: number };
  readonly fireTable: {
    readonly profile: (typeof PROFILES)[number];
    readonly dice: { readonly count: number; readonly faces: number };
    readonly suppress: number;
    readonly destroy: number;
  };
  readonly reaction: { readonly cap: number | typeof NONE; readonly modifier: number; readonly floor: number };
  readonly assault: {
    /** 12.1: `hard`, a close assault is made on a Hard unit only; `any`, on a unit of either class. */
    readonly targets: (typeof ASSAULT_TARGETS)[number];
    /** 12.3: steps added to a unit's own column when the target is Hard. */
    readonly vsHard: number;
    /** 12.3: how many times the close cover of its hex counts for a Hard target: 1 as for a Soft one, 0 not at all, -1 for the attacker. */
    readonly coverVsHard: number;
    /** 12.1: the share of its allowance (rounded down) a unit's approach may cost; 0, no approach: every unit stands beside the target. */
    readonly moveShare: number;
    readonly vsSuppressed: number;
    readonly support: readonly number[];
    /** 6.8, 12.1: a move that leaves any of its allowance unused leaves a unit that can close assault Moved, able to make one close assault. */
    readonly afterMove: boolean;
  };
  readonly overrun: { readonly steps: number; readonly cost: number };
  readonly moveFire: {
    /** 6.8: the class whose units a short move leaves Moved, not Spent; `none`, no unit's. */
    readonly class: (typeof MOVE_FIRE_CLASSES)[number];
    /** 6.8: the share of its allowance (rounded down) a move may cost and leave the unit Moved. */
    readonly moveShare: number;
    /** 7.2, 8.4: steps on the own column of a Moved unit's fire, and of its reaction fire. */
    readonly steps: number;
  };
  readonly artillery: { readonly vsHard: number };
  readonly cover: Readonly<Record<Cover, CoverRules>>;
  readonly score: { readonly killShare: readonly [number, number] };
  readonly break: { readonly share: number };
  readonly suddenDeath: { readonly lead: number };
  readonly moverTypes: readonly string[];
  readonly movement: MovementData;
  /** Ruling 83: the movement table of a board of each season it names other than summer (whose table is `movement`). */
  readonly seasons?: Readonly<Partial<Record<Season, SeasonMovementData>>>;
  readonly sight: { readonly coverAddsLevel: Readonly<Record<Cover, boolean>>; readonly crestRule: boolean };
}

export const RULES_KEYS = [
  'format', 'id', 'sequence', 'ready', 'initiative', 'pass', 'command', 'stack', 'move', 'spot', 'rangeSteps', 'support', 'fireTable',
  'reaction', 'assault', 'overrun', 'moveFire', 'artillery', 'cover', 'score', 'break', 'suddenDeath', 'moverTypes', 'movement', 'sight',
] as const;

export interface RulesLoadResult {
  data: RulesData | null;
  problems: string[];
}

const NAME = /^[a-z][a-z0-9_]*$/;
const MAX_COST = 99;

/** A number (whole or not) in a range. */
function num(c: Checker, place: string, v: unknown, lo: number, hi: number, loOpen = false): number | undefined {
  if (typeof v !== 'number' || !Number.isFinite(v) || v > hi || (loOpen ? v <= lo : v < lo)) {
    c.add(place, `must be a number ${loOpen ? 'above' : 'from'} ${lo} ${loOpen ? 'up ' : ''}to ${hi}, got ${showValue(v)}`);
    return undefined;
  }
  return v;
}

function showValue(v: unknown): string {
  if (typeof v === 'string') return JSON.stringify(v);
  if (Array.isArray(v)) return 'a list';
  if (typeof v === 'object' && v !== null) return 'a mapping';
  return String(v);
}

/** A whole number in a range, or the word none. */
function intOrNone(c: Checker, place: string, v: unknown, lo: number, hi: number): number | typeof NONE | undefined {
  if (v === NONE) return NONE;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < lo || v > hi) {
    c.add(place, `must be a whole number from ${lo} to ${hi}, or ${NONE}, got ${showValue(v)}`);
    return undefined;
  }
  return v;
}

/** Check parsed rules data. `file` names it in every problem. */
export function checkRulesData(raw: unknown, file: string): RulesLoadResult {
  const c = new Checker(file);
  const top = c.record('', raw, RULES_KEYS, ['seasons']);
  if (!top) return { data: null, problems: c.problems };
  const f = (k: string): unknown => c.at(top, k);
  if (f('format') !== RULES_FORMAT) c.add('format', `must be '${RULES_FORMAT}', got ${JSON.stringify(f('format'))}`);
  c.str('id', f('id'), ID_PATTERN, 'lower-case letters, digits, _ and -');

  const group = (key: string, keys: readonly string[]): Record<string, unknown> | undefined => c.record(key, f(key), keys);

  const seq = group('sequence', ['activation']);
  const activation = seq ? c.oneOf('sequence.activation', c.at(seq, 'activation'), ACTIVATIONS, 'activation') : undefined;
  const ready = group('ready', ['when']);
  if (ready) {
    const when = c.oneOf('ready.when', c.at(ready, 'when'), READY_TIMES, 'time of readying');
    // 5.10: only the whole-side game has a turn of a side's own; the formation game's units are made Ready at the end phase.
    if (when === 'own-turn' && activation === 'formation') c.add('ready.when', `'own-turn' needs sequence.activation 'side': the formation game has no turn of a side's own (5.10); give 'end-phase'`);
  }
  const ini = group('initiative', ['policy']);
  if (ini) c.oneOf('initiative.policy', c.at(ini, 'policy'), POLICIES, 'initiative policy');
  const pass = group('pass', ['rule']);
  if (pass) c.oneOf('pass.rule', c.at(pass, 'rule'), PASS_RULES, 'pass rule');

  const cmd = group('command', ['range', 'lossStep', 'min']);
  if (cmd) {
    const range = intOrNone(c, 'command.range', c.at(cmd, 'range'), 0, 99);
    c.int('command.lossStep', c.at(cmd, 'lossStep'), 0, 99);
    const min = c.int('command.min', c.at(cmd, 'min'), 0, 99);
    if (typeof range === 'number' && min !== undefined && min > range) c.add('command.min', `(${min}) must not be above command.range (${range})`);
  }
  const stack = group('stack', ['limit']);
  if (stack) c.int('stack.limit', c.at(stack, 'limit'), 1, 9);
  const move = group('move', ['alwaysOne']);
  if (move) c.bool('move.alwaysOne', c.at(move, 'alwaysOne'));
  const spot = group('spot', ['distance']);
  if (spot) c.int('spot.distance', c.at(spot, 'distance'), 0, 99);

  const rs = group('rangeSteps', ['adjacent', 'half', 'full', 'long', 'longFactor']);
  if (rs) {
    for (const k of ['adjacent', 'half', 'full', 'long']) c.int(`rangeSteps.${k}`, c.at(rs, k), -99, 99);
    num(c, 'rangeSteps.longFactor', c.at(rs, 'longFactor'), 1, 10);
  }
  const sup = group('support', ['steps', 'within']);
  if (sup) {
    const steps = c.list('support.steps', c.at(sup, 'steps'), 1, 20);
    steps?.forEach((s, i) => c.int(`support.steps[${i + 1}]`, s, 0, 99));
    c.int('support.within', c.at(sup, 'within'), 0, 99);
  }

  const ft = group('fireTable', ['profile', 'dice', 'suppress', 'destroy']);
  if (ft) {
    const profile = c.oneOf('fireTable.profile', c.at(ft, 'profile'), PROFILES, 'fire-table profile');
    const dice = c.record('fireTable.dice', c.at(ft, 'dice'), ['count', 'faces']);
    let count: number | undefined;
    let faces: number | undefined;
    if (dice) {
      count = c.int('fireTable.dice.count', c.at(dice, 'count'), 1, 4);
      faces = c.int('fireTable.dice.faces', c.at(dice, 'faces'), 2, 20);
    }
    if (profile !== undefined && count !== undefined && PROFILE_DICE[profile as (typeof PROFILES)[number]] !== count) {
      c.add('fireTable.profile', `'${profile}' must have ${PROFILE_DICE[profile as (typeof PROFILES)[number]]} dice, but fireTable.dice.count is ${count}`);
    }
    const hi = (count ?? 4) * (faces ?? 20) + 99;
    const s = c.int('fireTable.suppress', c.at(ft, 'suppress'), -99, hi);
    const d = c.int('fireTable.destroy', c.at(ft, 'destroy'), -99, hi);
    if (s !== undefined && d !== undefined && s > d) c.add('fireTable', `suppress (${s}) must not be above destroy (${d})`);
  }

  const re = group('reaction', ['cap', 'modifier', 'floor']);
  if (re) {
    intOrNone(c, 'reaction.cap', c.at(re, 'cap'), 1, 999);
    c.int('reaction.modifier', c.at(re, 'modifier'), -99, 99);
    num(c, 'reaction.floor', c.at(re, 'floor'), 0, 1);
  }
  const as = group('assault', ['targets', 'vsHard', 'coverVsHard', 'moveShare', 'vsSuppressed', 'support', 'afterMove']);
  if (as) {
    c.oneOf('assault.targets', c.at(as, 'targets'), ASSAULT_TARGETS, 'class of target');
    c.int('assault.vsHard', c.at(as, 'vsHard'), -99, 99);
    c.int('assault.coverVsHard', c.at(as, 'coverVsHard'), -1, 1);
    num(c, 'assault.moveShare', c.at(as, 'moveShare'), 0, 1);
    c.int('assault.vsSuppressed', c.at(as, 'vsSuppressed'), -99, 99);
    const steps = c.list('assault.support', c.at(as, 'support'), 1, 20);
    steps?.forEach((s, i) => c.int(`assault.support[${i + 1}]`, s, 0, 99));
    c.bool('assault.afterMove', c.at(as, 'afterMove'));
  }
  const ov = group('overrun', ['steps', 'cost']);
  if (ov) {
    c.int('overrun.steps', c.at(ov, 'steps'), -99, 99);
    c.int('overrun.cost', c.at(ov, 'cost'), 0, 99);
  }
  const mf = group('moveFire', ['class', 'moveShare', 'steps']);
  if (mf) {
    c.oneOf('moveFire.class', c.at(mf, 'class'), MOVE_FIRE_CLASSES, 'class of unit');
    num(c, 'moveFire.moveShare', c.at(mf, 'moveShare'), 0, 1);
    c.int('moveFire.steps', c.at(mf, 'steps'), -99, 99);
  }
  const art = group('artillery', ['vsHard']);
  if (art) c.int('artillery.vsHard', c.at(art, 'vsHard'), -99, 99);

  const covers = COVERS as readonly string[];
  const cov = c.keyed('cover', f('cover'), covers, 'cover');
  if (cov) {
    for (const k of covers) {
      if (!Object.prototype.hasOwnProperty.call(cov, k)) continue;
      const v = c.record(`cover.${k}`, c.at(cov, k), ['fire', 'close', 'conceals', 'overrun']);
      if (!v) continue;
      c.int(`cover.${k}.fire`, c.at(v, 'fire'), -99, 99);
      c.int(`cover.${k}.close`, c.at(v, 'close'), -99, 99);
      c.bool(`cover.${k}.conceals`, c.at(v, 'conceals'));
      c.bool(`cover.${k}.overrun`, c.at(v, 'overrun'));
    }
  }

  const sc = group('score', ['killShare']);
  if (sc) checkKillShare(c, 'score.killShare', c.at(sc, 'killShare'));
  const br = group('break', ['share']);
  if (br) num(c, 'break.share', c.at(br, 'share'), 0, 1, true);
  const sd = group('suddenDeath', ['lead']);
  if (sd) c.int('suddenDeath.lead', c.at(sd, 'lead'), 1, 9999);

  // Terrain data, in the reference ruleset's shape.
  const movers: string[] = [];
  const mv = c.list('moverTypes', f('moverTypes'), 1, 16);
  mv?.forEach((m, i) => {
    const s = c.str(`moverTypes[${i + 1}]`, m, NAME, 'a lower-case name');
    if (s === undefined) return;
    if (movers.includes(s)) c.add(`moverTypes[${i + 1}]`, `'${s}' is listed twice`);
    movers.push(s);
  });
  const costTable = (place: string, v: unknown, lo: number): void => {
    const t = c.keyed(place, v, movers, 'mover type');
    if (!t) return;
    for (const m of movers) {
      if (Object.prototype.hasOwnProperty.call(t, m)) c.intOrNull(`${place}.${m}`, c.at(t, m), lo, MAX_COST, 'impassable');
    }
  };
  const table = (place: string, v: unknown, water: boolean): void => {
    const mt = c.record(place, v, ['road', 'enter', 'climb', 'ridge', 'river', ...(water ? ['lake', 'sea'] : [])]);
    if (!mt) return;
    costTable(`${place}.road`, c.at(mt, 'road'), 1);
    const enter = c.keyed(`${place}.enter`, c.at(mt, 'enter'), covers, 'cover');
    if (enter) for (const k of covers) if (Object.prototype.hasOwnProperty.call(enter, k)) costTable(`${place}.enter.${k}`, c.at(enter, k), 1);
    costTable(`${place}.climb`, c.at(mt, 'climb'), 0);
    costTable(`${place}.ridge`, c.at(mt, 'ridge'), 0);
    costTable(`${place}.river`, c.at(mt, 'river'), 0);
    if (water) {
      costTable(`${place}.lake`, c.at(mt, 'lake'), 1);
      costTable(`${place}.sea`, c.at(mt, 'sea'), 1);
    }
  };
  table('movement', f('movement'), false);
  // Ruling 83: a table for each season named, other than summer's, which is `movement` itself.
  if (Object.prototype.hasOwnProperty.call(top, 'seasons')) {
    const raw = f('seasons');
    if (raw !== null && typeof raw === 'object' && !Array.isArray(raw) && Object.prototype.hasOwnProperty.call(raw, BASE_SEASON)) {
      c.add(`seasons.${BASE_SEASON}`, `a ${BASE_SEASON} board is compiled with movement itself: seasons names only ${OTHER_SEASONS.join(', ')}`);
    }
    const seasons = c.record('seasons', raw, [], OTHER_SEASONS);
    if (seasons) for (const s of OTHER_SEASONS) if (Object.prototype.hasOwnProperty.call(seasons, s)) table(`seasons.${s}`, c.at(seasons, s), true);
  }
  const sight = c.record('sight', f('sight'), ['coverAddsLevel', 'crestRule']);
  if (sight) {
    const adds = c.keyed('sight.coverAddsLevel', c.at(sight, 'coverAddsLevel'), covers, 'cover');
    if (adds) for (const k of covers) if (Object.prototype.hasOwnProperty.call(adds, k)) c.bool(`sight.coverAddsLevel.${k}`, c.at(adds, k));
    c.bool('sight.crestRule', c.at(sight, 'crestRule'));
  }

  if (!c.ok) return { data: null, problems: c.problems };
  return { data: raw as RulesData, problems: [] };
}

/** `killShare`: a ratio of two whole numbers, the second above 0. */
export function checkKillShare(c: Checker, place: string, v: unknown): void {
  const l = c.list(place, v, 2, 2);
  if (!l) return;
  c.int(`${place}[1]`, l[0], 0, 9999);
  c.int(`${place}[2]`, l[1], 1, 9999);
}

/** Read rules data from its text (YAML or JSON) and check it. */
export function parseRulesData(text: string, file: string): RulesLoadResult {
  let raw: unknown;
  try {
    raw = parseText(text);
  } catch (err) {
    return { data: null, problems: [`${file}: not readable as YAML or JSON: ${(err as Error).message.split('\n')[0] ?? ''}`] };
  }
  return checkRulesData(raw, file);
}

/** The part of the rules data the board compile reads. */
export function terrainOf(data: RulesData): TerrainRules {
  return { moverTypes: data.moverTypes, movement: data.movement, ...(data.seasons !== undefined ? { seasons: data.seasons } : {}), sight: data.sight };
}
