/**
 * A scenario for the reference ruleset (content/scenarios/*.scenario.yaml) and
 * its check, in the manner of engine/core/map.ts: every key required, unknown
 * keys refused, nothing defaulted, every problem named with file and place.
 *
 *   format: scenario/1
 *   id, name
 *   ruleset:     the ruleset id
 *   map:         { id, hash }   the map by id and content hash (board.ts mapHash)
 *   turns:       the turn limit
 *   brokenAt:    a side with this many live units or fewer has lost (0: only when none is left)
 *   objectives:  [{ hex, points }]   points to a side that alone holds the hex at the end of a turn
 *   sides:       two sides, in order of play: [{ id, name, stacking, zone, force }]
 *                stacking: units of this side a hex may hold
 *                zone: two hex labels, opposite corners of the side's set-up rectangle
 *                force: [{ type, count }] in the order its units are placed
 *
 * Both sides set up at the same time, each hidden from the other until both
 * have submitted (PLAN R3).
 */
import { parse as parseText } from 'yaml';
import { MapDescription, gridOf, hexOf } from '../../core/map';
import { HexId, colOf, indexOf, rowOf } from '../../core/hex';
import { contentHash } from '../../core/canonical';
import { mapHash } from '../../core/board';
import { Checker, HASH_PATTERN, ID_PATTERN } from '../../kernel/check';
import type { RulesetData } from './data';

export const SCENARIO_FORMAT = 'scenario/1';

export interface ForceEntry {
  readonly type: string;
  readonly count: number;
}

export interface ScenarioSide {
  readonly id: string;
  readonly name: string;
  readonly stacking: number;
  readonly zone: readonly [string, string];
  readonly force: readonly ForceEntry[];
}

export interface ScenarioObjective {
  readonly hex: string;
  readonly points: number;
}

export interface ScenarioData {
  readonly format: typeof SCENARIO_FORMAT;
  readonly id: string;
  readonly name: string;
  readonly ruleset: string;
  readonly map: { readonly id: string; readonly hash: string };
  readonly turns: number;
  readonly brokenAt: number;
  readonly objectives: readonly ScenarioObjective[];
  readonly sides: readonly ScenarioSide[];
}

export interface ScenarioLoadResult {
  scenario: ScenarioData | null;
  problems: string[];
}

const LABEL = /^[0-9]{4}$/;

/** The hexes of a zone: the rectangle of columns and rows between its two corner labels. */
export function zoneHexes(map: { cols: number; rows: number }, zone: readonly [string, string]): HexId[] {
  const g = gridOf(map);
  const a = hexOf(map, zone[0]);
  const b = hexOf(map, zone[1]);
  if (a < 0 || b < 0) return [];
  const c0 = Math.min(colOf(g, a), colOf(g, b));
  const c1 = Math.max(colOf(g, a), colOf(g, b));
  const r0 = Math.min(rowOf(g, a), rowOf(g, b));
  const r1 = Math.max(rowOf(g, a), rowOf(g, b));
  const out: HexId[] = [];
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) out.push(indexOf(g, c, r));
  return out;
}

/**
 * Check a parsed scenario against the ruleset data it plays under and the map
 * it names. The map's content hash must equal the one the scenario gives.
 */
export function checkScenario(raw: unknown, file: string, data: RulesetData, map: MapDescription): ScenarioLoadResult {
  const c = new Checker(file);
  const top = c.record('', raw, ['format', 'id', 'name', 'ruleset', 'map', 'turns', 'brokenAt', 'objectives', 'sides']);
  if (!top) return { scenario: null, problems: c.problems };
  const f = (k: string): unknown => c.at(top, k);
  if (f('format') !== SCENARIO_FORMAT) c.add('format', `must be '${SCENARIO_FORMAT}', got ${JSON.stringify(f('format'))}`);
  c.str('id', f('id'), ID_PATTERN, 'lower-case letters, digits, _ and -');
  c.str('name', f('name'));
  const rs = c.str('ruleset', f('ruleset'), ID_PATTERN, 'a ruleset id');
  if (rs !== undefined && rs !== data.id) c.add('ruleset', `names the ruleset '${rs}', but is being loaded with '${data.id}'`);

  const m = c.record('map', f('map'), ['id', 'hash']);
  if (m) {
    const id = c.str('map.id', c.at(m, 'id'), ID_PATTERN, 'a map id');
    const hash = c.str('map.hash', c.at(m, 'hash'), HASH_PATTERN, 'a SHA-256 hash (64 lower-case hex digits)');
    if (id !== undefined && id !== map.id) c.add('map.id', `names the map '${id}', but the map given is '${map.id}'`);
    const actual = mapHash(map);
    if (hash !== undefined && id === map.id && hash !== actual) {
      c.add('map.hash', `map ${map.id}: the scenario was made for content hash ${hash}, the map given has ${actual}`);
    }
  }
  c.int('turns', f('turns'), 1, 99);
  const brokenAt = c.int('brokenAt', f('brokenAt'), 0, 999);

  const g = gridOf(map);
  const label = (place: string, v: unknown): HexId => {
    const s = c.str(place, v, LABEL, 'a four-digit hex label like "0412"');
    if (s === undefined) return -1;
    const h = hexOf(map, s);
    if (h < 0) c.add(place, `hex ${s} is off the board (${g.cols} columns, ${g.rows} rows)`);
    return h;
  };

  const objectives = c.list('objectives', f('objectives'), 0, 50);
  const objectiveHexes = new Set<HexId>();
  objectives?.forEach((o, i) => {
    const place = `objectives[${i + 1}]`;
    const v = c.record(place, o, ['hex', 'points']);
    if (!v) return;
    const h = label(`${place}.hex`, c.at(v, 'hex'));
    if (h >= 0 && objectiveHexes.has(h)) c.add(`${place}.hex`, 'is listed twice');
    objectiveHexes.add(h);
    c.int(`${place}.points`, c.at(v, 'points'), 1, 999);
  });

  const typeIds = data.unitTypes.map(t => t.id);
  const sides = c.list('sides', f('sides'), 2, 2);
  const sideIds: string[] = [];
  const zoneOf: Set<HexId>[] = [];
  const unitsPerSide: number[] = [];
  sides?.forEach((s, i) => {
    const place = `sides[${i + 1}]`;
    const v = c.record(place, s, ['id', 'name', 'stacking', 'zone', 'force']);
    if (!v) return;
    const id = c.str(`${place}.id`, c.at(v, 'id'), ID_PATTERN, 'lower-case letters, digits, _ and -');
    const at = id ? `sides[${i + 1}] (${id})` : place;
    if (id !== undefined) {
      if (sideIds.includes(id)) c.add(`${at}.id`, `'${id}' is used twice`);
      sideIds.push(id);
    }
    c.str(`${at}.name`, c.at(v, 'name'));
    const stacking = c.int(`${at}.stacking`, c.at(v, 'stacking'), 1, 9);
    const zone = c.list(`${at}.zone`, c.at(v, 'zone'), 2, 2);
    let hexes: HexId[] = [];
    if (zone) {
      const a = label(`${at}.zone[1]`, zone[0]);
      const b = label(`${at}.zone[2]`, zone[1]);
      if (a >= 0 && b >= 0) hexes = zoneHexes(map, [zone[0] as string, zone[1] as string]);
    }
    zoneOf.push(new Set(hexes));
    const force = c.list(`${at}.force`, c.at(v, 'force'), 1, 64);
    let units = 0;
    force?.forEach((e, k) => {
      const fp = `${at}.force[${k + 1}]`;
      const fv = c.record(fp, e, ['type', 'count']);
      if (!fv) return;
      c.oneOf(`${fp}.type`, c.at(fv, 'type'), typeIds, 'unit type');
      const n = c.int(`${fp}.count`, c.at(fv, 'count'), 1, 64);
      if (n !== undefined) units += n;
    });
    unitsPerSide.push(units);
    if (units > 64) c.add(`${at}.force`, `holds ${units} units; a side may have at most 64`);
    if (stacking !== undefined && hexes.length > 0 && hexes.length * stacking < units) {
      c.add(`${at}.zone`, `holds ${hexes.length} hexes, too few for ${units} units at ${stacking} a hex`);
    }
  });
  if (zoneOf.length === 2) {
    const [z0, z1] = zoneOf as [Set<HexId>, Set<HexId>];
    for (const h of z0) {
      if (z1.has(h)) {
        c.add('sides', 'the two set-up zones overlap');
        break;
      }
    }
  }
  if (brokenAt !== undefined) {
    unitsPerSide.forEach((n, i) => {
      if (n > 0 && brokenAt >= n) c.add('brokenAt', `is ${brokenAt}, so side ${i + 1} (${n} units) would have lost before play begins`);
    });
  }

  if (!c.ok) return { scenario: null, problems: c.problems };
  return { scenario: raw as ScenarioData, problems: [] };
}

/** Read a scenario file's text (YAML or JSON) and check it. */
export function parseScenario(text: string, file: string, data: RulesetData, map: MapDescription): ScenarioLoadResult {
  let raw: unknown;
  try {
    raw = parseText(text);
  } catch (err) {
    return { scenario: null, problems: [`${file}: not readable as YAML or JSON: ${(err as Error).message.split('\n')[0] ?? ''}`] };
  }
  return checkScenario(raw, file, data, map);
}

/** The ruleset id and map id a scenario file names, read before the full check (to find those files). */
export function scenarioRefs(raw: unknown): { ruleset: string | null; map: string | null } {
  if (typeof raw !== 'object' || raw === null) return { ruleset: null, map: null };
  const r = raw as Record<string, unknown>;
  const m = r.map;
  return {
    ruleset: typeof r.ruleset === 'string' ? r.ruleset : null,
    map: typeof m === 'object' && m !== null && typeof (m as Record<string, unknown>).id === 'string' ? (m as Record<string, unknown>).id as string : null,
  };
}

/** The content hash of a scenario: SHA-256 of its canonical JSON. */
export function scenarioHash(s: ScenarioData): string {
  return contentHash(s);
}
