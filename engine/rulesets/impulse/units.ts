/**
 * A unit file of Formation Impulse (`format: impulse-units/1`,
 * content/units/<id>.units.yaml) and its check: the unit types of spec 2.1.
 *
 *   format: impulse-units/1
 *   id
 *   types: [{ id, name, kind, count, ap, he, range, defense, class, move, mover, close, cost,
 *             assaults, overruns, rides, carries, indirect?: { minRange } }]
 *
 * `kind` and `count` are for the counter's face and the opponents; the rules
 * read neither. `indirect` is present on batteries only (2.1). `assaults`,
 * `overruns` and `rides` are true or false and `carries` is 0 or 1, given for
 * every type (2.1: all four are given for every type). A type that overruns has `he` above 0, one
 * that assaults has `close` above 0, a transport (`carries` 1) does not
 * ride, and a type with `move` 0 has the mover type `towed`. A mover type is
 * otherwise a lower-case name here; that
 * it is one of the rules data's mover types is checked when a match is built
 * (load.ts), where both files are at hand.
 */
import { parse as parseText } from 'yaml';
import { Checker, ID_PATTERN } from '../../kernel/check';

export const UNITS_FORMAT = 'impulse-units/1';
export const UNIT_KINDS = ['tank', 'assault_gun', 'self_propelled_gun', 'towed_gun', 'mortar', 'infantry', 'machine_gun', 'truck', 'half_track', 'wagon'] as const;
export const CLASSES = ['hard', 'soft'] as const;
export type UnitClass = (typeof CLASSES)[number];

export interface UnitType {
  readonly id: string;
  readonly name: string;
  readonly kind: (typeof UNIT_KINDS)[number];
  readonly count: number;
  readonly ap: number;
  readonly he: number;
  readonly range: number;
  readonly defense: number;
  readonly class: UnitClass;
  readonly move: number;
  readonly mover: string;
  readonly close: number;
  readonly cost: number;
  /** May make a close assault (12.1). */
  readonly assaults: boolean;
  /** May overrun (12.7). */
  readonly overruns: boolean;
  /** A transport can carry it (section 14). */
  readonly rides: boolean;
  /** How many units it can carry: 1 for a transport, 0 for every other unit (14.1). */
  readonly carries: number;
  readonly indirect?: { readonly minRange: number };
}

export interface UnitFile {
  readonly format: typeof UNITS_FORMAT;
  readonly id: string;
  readonly types: readonly UnitType[];
}

export interface UnitsLoadResult {
  units: UnitFile | null;
  problems: string[];
}

const TYPE_ID = /^[a-z][a-z0-9_]*$/;
const MOVER = /^[a-z][a-z0-9_]*$/;
/** The mover type of a unit that cannot move at all, by the specification's own name for it (2.1). */
const TOWED = 'towed';
/** The keys of a unit type (2.1); `indirect` may be added. */
export const TYPE_KEYS: readonly string[] = [
  'id', 'name', 'kind', 'count', 'ap', 'he', 'range', 'defense', 'class', 'move', 'mover', 'close', 'cost', 'assaults', 'overruns', 'rides', 'carries',
];

/** Check a parsed unit file. `file` names it in every problem. */
export function checkUnitFile(raw: unknown, file: string): UnitsLoadResult {
  const c = new Checker(file);
  const top = c.record('', raw, ['format', 'id', 'types']);
  if (!top) return { units: null, problems: c.problems };
  if (c.at(top, 'format') !== UNITS_FORMAT) c.add('format', `must be '${UNITS_FORMAT}', got ${JSON.stringify(c.at(top, 'format'))}`);
  c.str('id', c.at(top, 'id'), ID_PATTERN, 'lower-case letters, digits, _ and -');
  const types = c.list('types', c.at(top, 'types'), 1, 200);
  const ids: string[] = [];
  types?.forEach((t, i) => {
    // The type's id, when it has a good one, names it in every message (types[2] (fast_tank).range).
    const rawId = typeof t === 'object' && t !== null && !Array.isArray(t) ? (t as Record<string, unknown>).id : undefined;
    const named = typeof rawId === 'string' && TYPE_ID.test(rawId) ? `types[${i + 1}] (${rawId})` : `types[${i + 1}]`;
    const v = c.record(named, t, TYPE_KEYS, ['indirect']);
    if (!v) return;
    const id = c.str(`types[${i + 1}].id`, c.at(v, 'id'), TYPE_ID, 'lower-case letters, digits and _');
    const at = id !== undefined ? `types[${i + 1}] (${id})` : named;
    if (id !== undefined) {
      if (ids.includes(id)) c.add(`${at}.id`, `'${id}' is used twice`);
      ids.push(id);
    }
    c.str(`${at}.name`, c.at(v, 'name'));
    c.oneOf(`${at}.kind`, c.at(v, 'kind'), UNIT_KINDS, 'kind');
    c.int(`${at}.count`, c.at(v, 'count'), 1, 9999);
    c.int(`${at}.ap`, c.at(v, 'ap'), 0, 99);
    const he = c.int(`${at}.he`, c.at(v, 'he'), 0, 99);
    c.int(`${at}.range`, c.at(v, 'range'), 0, 99);
    c.int(`${at}.defense`, c.at(v, 'defense'), 0, 99);
    c.oneOf(`${at}.class`, c.at(v, 'class'), CLASSES, 'class');
    const move = c.int(`${at}.move`, c.at(v, 'move'), 0, 999);
    const mover = c.str(`${at}.mover`, c.at(v, 'mover'), MOVER, 'a mover type (a lower-case name)');
    // 2.1: a unit with move 0 cannot move at all, and its mover type is towed.
    if (move === 0 && mover !== undefined && mover !== TOWED) c.add(`${at}.mover`, `a type with move 0 has the mover type '${TOWED}' (2.1), got '${mover}'`);
    const close = c.int(`${at}.close`, c.at(v, 'close'), 0, 99);
    c.int(`${at}.cost`, c.at(v, 'cost'), 1, 9999);
    const assaults = c.bool(`${at}.assaults`, c.at(v, 'assaults'));
    const overruns = c.bool(`${at}.overruns`, c.at(v, 'overruns'));
    const rides = c.bool(`${at}.rides`, c.at(v, 'rides'));
    const carries = c.at(v, 'carries');
    if (carries !== 0 && carries !== 1) c.add(`${at}.carries`, `must be 0 or 1 (2.1: a transport carries one unit), got ${JSON.stringify(carries)}`);
    // 2.1: a type that overruns has he above 0; one that assaults has close above 0; a transport does not ride.
    if (overruns === true && he === 0) c.add(`${at}.overruns`, 'a type that overruns must have he above 0 (2.1)');
    if (assaults === true && close === 0) c.add(`${at}.assaults`, 'a type that assaults must have close above 0 (2.1)');
    if (carries === 1 && rides === true) c.add(`${at}.rides`, 'a transport (carries 1) does not ride (2.1)');
    if (Object.prototype.hasOwnProperty.call(v, 'indirect')) {
      const ind = c.record(`${at}.indirect`, c.at(v, 'indirect'), ['minRange']);
      if (ind) c.int(`${at}.indirect.minRange`, c.at(ind, 'minRange'), 0, 99);
    }
  });
  if (!c.ok) return { units: null, problems: c.problems };
  return { units: raw as UnitFile, problems: [] };
}

/** Read a unit file from its text and check it. */
export function parseUnitFile(text: string, file: string): UnitsLoadResult {
  let raw: unknown;
  try {
    raw = parseText(text);
  } catch (err) {
    return { units: null, problems: [`${file}: not readable as YAML or JSON: ${(err as Error).message.split('\n')[0] ?? ''}`] };
  }
  return checkUnitFile(raw, file);
}

/** The mover types a unit file uses, each with the first place that names it. */
export function moversOf(units: UnitFile): { mover: string; place: string }[] {
  const out: { mover: string; place: string }[] = [];
  units.types.forEach((t, i) => {
    out.push({ mover: t.mover, place: `types[${i + 1}] (${t.id}).mover` });
  });
  return out;
}
