/**
 * The reference ruleset's data file (content/rulesets/reference.ruleset.yaml)
 * and its check. Checked in the manner of engine/core/map.ts: hand-written,
 * every key required, unknown keys refused, nothing defaulted, every problem
 * named with the file and the place.
 *
 *   format: ruleset/1
 *   id, version, name, note
 *   dice:          { count, faces }
 *   sequence:      the phases of a player-turn, in order: each of PHASE_KINDS once
 *   moverTypes:    mover type names
 *   targetClasses: target class names
 *   movement:      { rule (words), road, enter (one entry per cover), climb, ridge, river }
 *                  every cost table has one entry per mover type: a whole number, or null
 *                  for impassable (board.ts states the rule)
 *   sight:         { coverAddsLevel (one entry per cover), crestRule }
 *   fire:          { rule (words), coverDefense (one entry per cover), columns }
 *   unitTypes:     [{ id, name, mover, class, firepower (one entry per class), defense,
 *                     range, allowance, value }]
 */
import { parse as parseText } from 'yaml';
import { COVERS, TerrainRules } from '../../core/board';
import type { Cover } from '../../core/map';
import { contentHash } from '../../core/canonical';
import { Checker, ID_PATTERN } from '../../kernel/check';

export const RULESET_FORMAT = 'ruleset/1';
/** The kinds of phase the reference ruleset's code knows. */
export const PHASE_KINDS = ['gunnery', 'manoeuvre'] as const;
export type PhaseKind = (typeof PHASE_KINDS)[number];

export type CostTable = Readonly<Record<string, number | null>>;

export interface FireColumn {
  /** The column applies when attack / defense >= atLeast[0] / atLeast[1]. */
  readonly atLeast: readonly [number, number];
  /** Dice sum at or above which the target is destroyed; null: never. */
  readonly destroy: number | null;
  /** Dice sum at or above which the target is suppressed (when not destroyed); null: never. */
  readonly suppress: number | null;
}

export interface UnitTypeData {
  readonly id: string;
  readonly name: string;
  readonly mover: string;
  readonly class: string;
  readonly firepower: Readonly<Record<string, number>>;
  readonly defense: number;
  readonly range: number;
  readonly allowance: number;
  readonly value: number;
}

export interface RulesetData {
  readonly format: typeof RULESET_FORMAT;
  readonly id: string;
  readonly version: number;
  readonly name: string;
  readonly note: string;
  readonly dice: { readonly count: number; readonly faces: number };
  readonly sequence: readonly PhaseKind[];
  readonly moverTypes: readonly string[];
  readonly targetClasses: readonly string[];
  readonly movement: {
    readonly rule: string;
    readonly road: CostTable;
    readonly enter: Readonly<Record<Cover, CostTable>>;
    readonly climb: CostTable;
    readonly ridge: CostTable;
    readonly river: CostTable;
  };
  readonly sight: { readonly coverAddsLevel: Readonly<Record<Cover, boolean>>; readonly crestRule: boolean };
  readonly fire: {
    readonly rule: string;
    readonly coverDefense: Readonly<Record<Cover, number>>;
    readonly columns: readonly FireColumn[];
  };
  readonly unitTypes: readonly UnitTypeData[];
}

const MAX_COST = 99;
const NAME_LIST = /^[a-z][a-z0-9_]*$/;

export interface RulesetLoadResult {
  data: RulesetData | null;
  problems: string[];
}

/** Check parsed ruleset data. `file` names it in every problem. */
export function checkRulesetData(raw: unknown, file: string): RulesetLoadResult {
  const c = new Checker(file);
  const top = c.record('', raw, ['format', 'id', 'version', 'name', 'note', 'dice', 'sequence', 'moverTypes', 'targetClasses', 'movement', 'sight', 'fire', 'unitTypes']);
  if (!top) return { data: null, problems: c.problems };
  const f = (k: string): unknown => c.at(top, k);
  if (f('format') !== RULESET_FORMAT) c.add('format', `must be '${RULESET_FORMAT}', got ${JSON.stringify(f('format'))}`);
  c.str('id', f('id'), ID_PATTERN, 'lower-case letters, digits, _ and -');
  c.int('version', f('version'), 1, 9999);
  c.str('name', f('name'));
  c.str('note', f('note'));

  const dice = c.record('dice', f('dice'), ['count', 'faces']);
  const diceCount = dice ? c.int('dice.count', c.at(dice, 'count'), 1, 4) : undefined;
  const diceFaces = dice ? c.int('dice.faces', c.at(dice, 'faces'), 2, 20) : undefined;

  const seq = c.list('sequence', f('sequence'), 1, PHASE_KINDS.length);
  seq?.forEach((p, i) => c.oneOf(`sequence[${i + 1}]`, p, PHASE_KINDS, 'phase'));
  if (seq) {
    for (const k of PHASE_KINDS) {
      const n = seq.filter(p => p === k).length;
      if (n !== 1) c.add('sequence', `must hold the phase '${k}' exactly once, holds it ${n} times`);
    }
  }

  const names = (key: string): string[] => {
    const v = c.list(key, f(key), 1, 16);
    if (!v) return [];
    const out: string[] = [];
    v.forEach((item, i) => {
      const s = c.str(`${key}[${i + 1}]`, item, NAME_LIST, 'a lower-case name');
      if (s === undefined) return;
      if (out.includes(s)) c.add(`${key}[${i + 1}]`, `'${s}' is listed twice`);
      out.push(s);
    });
    return out;
  };
  const movers = names('moverTypes');
  const classes = names('targetClasses');
  const covers = COVERS as readonly string[];

  const costTable = (place: string, v: unknown, lo: number): void => {
    const t = c.keyed(place, v, movers, 'mover type');
    if (!t) return;
    for (const m of movers) {
      if (Object.prototype.hasOwnProperty.call(t, m)) c.intOrNull(`${place}.${m}`, c.at(t, m), lo, MAX_COST, 'impassable');
    }
  };
  const mv = c.record('movement', f('movement'), ['rule', 'road', 'enter', 'climb', 'ridge', 'river']);
  if (mv) {
    c.str('movement.rule', c.at(mv, 'rule'));
    costTable('movement.road', c.at(mv, 'road'), 1);
    const enter = c.keyed('movement.enter', c.at(mv, 'enter'), covers, 'cover');
    if (enter) for (const cov of covers) if (Object.prototype.hasOwnProperty.call(enter, cov)) costTable(`movement.enter.${cov}`, c.at(enter, cov), 1);
    costTable('movement.climb', c.at(mv, 'climb'), 0);
    costTable('movement.ridge', c.at(mv, 'ridge'), 0);
    costTable('movement.river', c.at(mv, 'river'), 0);
  }

  const sight = c.record('sight', f('sight'), ['coverAddsLevel', 'crestRule']);
  if (sight) {
    const adds = c.keyed('sight.coverAddsLevel', c.at(sight, 'coverAddsLevel'), covers, 'cover');
    if (adds) for (const cov of covers) if (Object.prototype.hasOwnProperty.call(adds, cov)) c.bool(`sight.coverAddsLevel.${cov}`, c.at(adds, cov));
    c.bool('sight.crestRule', c.at(sight, 'crestRule'));
  }

  const lowest = diceCount ?? 1;
  const highest = (diceCount ?? 1) * (diceFaces ?? 6);
  const fire = c.record('fire', f('fire'), ['rule', 'coverDefense', 'columns']);
  if (fire) {
    c.str('fire.rule', c.at(fire, 'rule'));
    const cd = c.keyed('fire.coverDefense', c.at(fire, 'coverDefense'), covers, 'cover');
    if (cd) for (const cov of covers) if (Object.prototype.hasOwnProperty.call(cd, cov)) c.int(`fire.coverDefense.${cov}`, c.at(cd, cov), 0, 99);
    const cols = c.list('fire.columns', c.at(fire, 'columns'), 1, 40);
    let previous: [number, number] | null = null;
    cols?.forEach((col, i) => {
      const place = `fire.columns[${i + 1}]`;
      const v = c.record(place, col, ['atLeast', 'destroy', 'suppress']);
      if (!v) {
        previous = null;
        return;
      }
      const ratio = c.list(`${place}.atLeast`, c.at(v, 'atLeast'), 2, 2);
      let r: [number, number] | null = null;
      if (ratio) {
        const p = c.int(`${place}.atLeast[1]`, ratio[0], 1, 999);
        const q = c.int(`${place}.atLeast[2]`, ratio[1], 1, 999);
        if (p !== undefined && q !== undefined) r = [p, q];
      }
      if (r && previous && r[0] * previous[1] <= previous[0] * r[1]) {
        c.add(`${place}.atLeast`, `${r[0]}/${r[1]} must be above the column before it (${previous[0]}/${previous[1]})`);
      }
      previous = r;
      const d = c.intOrNull(`${place}.destroy`, c.at(v, 'destroy'), lowest, highest, 'never');
      const s = c.intOrNull(`${place}.suppress`, c.at(v, 'suppress'), lowest, highest, 'never');
      if (typeof d === 'number' && typeof s === 'number' && s > d) c.add(place, `suppress (${s}) must not be above destroy (${d})`);
    });
  }

  const types = c.list('unitTypes', f('unitTypes'), 1, 200);
  const typeIds: string[] = [];
  types?.forEach((t, i) => {
    const place = `unitTypes[${i + 1}]`;
    const v = c.record(place, t, ['id', 'name', 'mover', 'class', 'firepower', 'defense', 'range', 'allowance', 'value']);
    if (!v) return;
    const id = c.str(`${place}.id`, c.at(v, 'id'), NAME_LIST, 'a lower-case name');
    const at = id ? `unitTypes[${i + 1}] (${id})` : place;
    if (id !== undefined) {
      if (typeIds.includes(id)) c.add(`${at}.id`, `'${id}' is used twice`);
      typeIds.push(id);
    }
    c.str(`${at}.name`, c.at(v, 'name'));
    c.oneOf(`${at}.mover`, c.at(v, 'mover'), movers, 'mover type');
    c.oneOf(`${at}.class`, c.at(v, 'class'), classes, 'target class');
    const fp = c.keyed(`${at}.firepower`, c.at(v, 'firepower'), classes, 'target class');
    if (fp) for (const k of classes) if (Object.prototype.hasOwnProperty.call(fp, k)) c.int(`${at}.firepower.${k}`, c.at(fp, k), 0, 99);
    c.int(`${at}.defense`, c.at(v, 'defense'), 1, 99);
    c.int(`${at}.range`, c.at(v, 'range'), 1, 40);
    c.int(`${at}.allowance`, c.at(v, 'allowance'), 0, 999);
    c.int(`${at}.value`, c.at(v, 'value'), 0, 999);
  });

  if (!c.ok) return { data: null, problems: c.problems };
  return { data: raw as RulesetData, problems: [] };
}

/** Read a ruleset data file's text (YAML or JSON) and check it. */
export function parseRulesetData(text: string, file: string): RulesetLoadResult {
  let raw: unknown;
  try {
    raw = parseText(text);
  } catch (err) {
    return { data: null, problems: [`${file}: not readable as YAML or JSON: ${(err as Error).message.split('\n')[0] ?? ''}`] };
  }
  return checkRulesetData(raw, file);
}

/** The content hash of ruleset data: SHA-256 of its canonical JSON. */
export function rulesetHash(data: RulesetData): string {
  return contentHash(data);
}

/** The part of the data the board compile reads. */
export function terrainOf(data: RulesetData): TerrainRules {
  return { moverTypes: data.moverTypes, movement: data.movement, sight: data.sight };
}
