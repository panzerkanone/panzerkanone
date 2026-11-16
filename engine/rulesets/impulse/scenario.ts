/**
 * A Formation Impulse scenario (`format: impulse-scenario/1`) and its check:
 * what bar M2a ruling 18 and PLAN 9.2 list.
 *
 *   format: impulse-scenario/1
 *   id, name
 *   ruleset:        the rules data's id
 *   units:          the unit file's id (content/units/<id>.units.yaml)
 *   map:            { id, hash }   the map by id and content hash (board.ts mapHash)
 *   initiative:     the id of the side with the initiative on turn 1 (5.1)
 *   freeDeployment: true when play begins with a free deployment (4.2)
 *   objectives:     [{ hex, points, holder }]   holder: a side id, or none (15.1)
 *   ending:         { turns, killShare?, breakShare?, suddenDeathLead? }
 *                   the last turn; and, where the scenario overrides the rules data (spec 19),
 *                   score.killShare, break.share and suddenDeath.lead
 *   sides:          two sides, the first first (2.4):
 *                   [{ id, name, counters, orders, zone: [[corner, corner], ...],
 *                      formations: [{ id, discipline, units: [{ id, type, hex | carriedBy }] }] }]
 *                   counters: the counter stock the side is drawn with (never read by the rules)
 *                   orders: orders a turn (5.3); zone: rectangles, each by two opposite corners (4.2);
 *                   discipline: free, armor or hold (3.5);
 *                   hex: the unit's set-up hex, or carriedBy: the id of the transport of its own side
 *                   that carries it at the start; exactly one of the two (4.1)
 *   battle, level:  (optional, both or neither; no rule reads them; added 2026-11-14) the battle this
 *                   scenario is one level of, and which level: battle is the id the game's list and its
 *                   address name the battle by (lower-case letters, digits and -), level one of patrol,
 *                   skirmish, battle or offensive. The levels of one battle are separate scenarios on one
 *                   board, each with its own units and starting places (the game's list,
 *                   client/src/game/scenarios.ts, holds them together). Or level campaign (2026-11-14):
 *                   the battle as a campaign plays it, one side being a campaign's force at full strength,
 *                   from which each game draws what the force has left (client/src/campaign/); the game's
 *                   list never lists a campaign level, and a campaign file names its battles
 *   briefing:       (optional; a scenario without one has no briefing) what a player is told before the
 *                   first turn. No rule reads it. When it is there, every key of it is required:
 *                   { title, date, place, picture, background, situation, note,
 *                     sides: [{ side, short, mark, aim, formations: [{ id, role }] }],
 *                     objectives: [{ hex, name }] }
 *                   title: the scenario's short name; date, place: for the line under it;
 *                   picture: the id of its picture (whoever shows the briefing may have one by that id);
 *                   background, situation: a paragraph each; note: one line of small print;
 *                   sides: one entry for each side, in the sides' order. short: the side in a word, for a
 *                   small plate; mark: the mark it is shown with (cross, hammer-sickle or none); aim: what it
 *                   is there to do, in a sentence; formations: one entry for each of its formations, in
 *                   order, with a few words for what it is;
 *                   objectives: one entry for each objective, in order, with its name
 *
 * 3.1: a formation has two to five units that are not transports, and may have
 * transports besides, no more of them than it has units that can be carried,
 * listed last. 4.1: no unit starts in a hex its mover type may not enter: one
 * into which no step from a hex beside it is open to that mover type, on the
 * compiled board (cover, rivers, roads and hexsides all count: enterableHexes).
 * 4.2: the scenario's own set-up keeps within the stacking limit, and, where
 * the scenario allows free deployment, places every unit inside its side's
 * zones (a side may take it in place of its own placements): one that does not
 * is refused, naming the unit and the hex.
 */
import { parse as parseText } from 'yaml';
import { coversOf, gridOf, hexOf, MapDescription } from '../../core/map';
import { colOf, HexId, indexOf, rowOf } from '../../core/hex';
import { CompiledBoard, compileBoard, mapHash } from '../../core/board';
import { Checker, HASH_PATTERN, ID_PATTERN, isRecord } from '../../kernel/check';
import { checkKillShare, RulesData, terrainOf } from './data';
import type { UnitFile } from './units';
import { DISCIPLINES, Discipline } from './types';

export const SCENARIO_FORMAT = 'impulse-scenario/1';

/**
 * 4.1: 1 for every hex a unit of mover type `mover` (a board index) may enter,
 * that is, a hex into which at least one step from a hex beside it is not
 * impassable on the board (6.1: the board's step costs, which count cover,
 * rivers, roads and hexsides). A river hex is closed to a mover type for which
 * every step into it is; a swamp hex that a road crosses is open to one that
 * may follow the road into it. The scenario check and the ruleset (starts,
 * placements, the deployment list) both read this.
 */
export function enterableHexes(board: CompiledBoard, mover: number): Uint8Array {
  const steps = board.stepCost[mover];
  if (!steps) throw new Error(`enterableHexes: unknown mover index ${mover}`);
  const nb = board.neighbour;
  const out = new Uint8Array(board.n);
  for (let a = 0; a < board.n; a++) {
    for (let d = 0; d < 6; d++) {
      const h = nb[a * 6 + d] as number;
      if (h >= 0 && (steps[a * 6 + d] as number) >= 0) out[h] = 1;
    }
  }
  return out;
}

export interface ScenarioUnit {
  readonly id: string;
  readonly type: string;
  /** The set-up hex (4.1); absent exactly when the unit starts carried. */
  readonly hex?: string;
  /** The id of the transport of its own side that carries it at the start (4.1). */
  readonly carriedBy?: string;
}

export interface ScenarioFormation {
  readonly id: string;
  readonly discipline: Discipline;
  readonly units: readonly ScenarioUnit[];
}

export interface ScenarioSide {
  readonly id: string;
  readonly name: string;
  readonly counters: string;
  readonly orders: number;
  readonly zone: readonly (readonly [string, string])[];
  readonly formations: readonly ScenarioFormation[];
}

export interface ScenarioEnding {
  readonly turns: number;
  readonly killShare?: readonly [number, number];
  readonly breakShare?: number;
  readonly suddenDeathLead?: number;
}

/** The levels of battle a scenario may be, smallest first (a scenario's `level`), as the game's list offers them. */
export const SCENARIO_LEVELS = ['patrol', 'skirmish', 'battle', 'offensive'] as const;
export type ScenarioLevel = (typeof SCENARIO_LEVELS)[number];
/** The level of a battle as a campaign plays it (client/src/campaign/): a scenario's `level` besides the list's four. */
export const CAMPAIGN_LEVEL = 'campaign' as const;
/** A battle's id, as an address names it: lower-case letters, digits and -, a letter first. */
export const BATTLE_PATTERN = /^[a-z][a-z0-9-]*$/;

/** The marks a side may be shown with (a briefing's `mark`); `none` is no mark. */
export const SIDE_MARKS = ['cross', 'hammer-sickle', 'none'] as const;
export type SideMark = (typeof SIDE_MARKS)[number];

/** What a player is told before the first turn. No rule reads any of it. */
export interface ScenarioBriefing {
  readonly title: string;
  readonly date: string;
  readonly place: string;
  /** The id of the scenario's picture. */
  readonly picture: string;
  readonly background: string;
  readonly situation: string;
  readonly note: string;
  /** One entry for each side, in the sides' order. */
  readonly sides: readonly {
    readonly side: string;
    readonly short: string;
    readonly mark: SideMark;
    readonly aim: string;
    /** One entry for each of the side's formations, in order. */
    readonly formations: readonly { readonly id: string; readonly role: string }[];
  }[];
  /** One entry for each objective, in order. */
  readonly objectives: readonly { readonly hex: string; readonly name: string }[];
}

export interface ScenarioData {
  readonly format: typeof SCENARIO_FORMAT;
  readonly id: string;
  readonly name: string;
  readonly ruleset: string;
  readonly units: string;
  readonly map: { readonly id: string; readonly hash: string };
  readonly initiative: string;
  readonly freeDeployment: boolean;
  /** holder: the side holding it at the start, by id, or none (15.1). */
  readonly objectives: readonly { readonly hex: string; readonly points: number; readonly holder: string }[];
  readonly ending: ScenarioEnding;
  readonly sides: readonly ScenarioSide[];
  /** The battle this scenario is one level of, and its level; both absent when it belongs to no battle. No rule reads them. */
  readonly battle?: string;
  readonly level?: ScenarioLevel | typeof CAMPAIGN_LEVEL;
  /** Absent: the scenario has no briefing. */
  readonly briefing?: ScenarioBriefing;
}

export interface ScenarioLoadResult {
  scenario: ScenarioData | null;
  problems: string[];
}

const LABEL = /^[0-9]{4}$/;
const UNIT_ID = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

/** The hexes of a zone: the rectangles of columns and rows between each pair of corners. */
export function zoneHexes(map: { cols: number; rows: number }, zone: readonly (readonly [string, string])[]): HexId[] {
  const g = gridOf(map);
  const out = new Set<HexId>();
  for (const [p, q] of zone) {
    const a = hexOf(map, p);
    const b = hexOf(map, q);
    if (a < 0 || b < 0) continue;
    const c0 = Math.min(colOf(g, a), colOf(g, b));
    const c1 = Math.max(colOf(g, a), colOf(g, b));
    const r0 = Math.min(rowOf(g, a), rowOf(g, b));
    const r1 = Math.max(rowOf(g, a), rowOf(g, b));
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) out.add(indexOf(g, c, r));
  }
  return [...out].sort((x, y) => x - y);
}

/** Check a parsed scenario against the rules data, the unit file and the map it is played with. */
export function checkScenario(raw: unknown, file: string, rules: RulesData, units: UnitFile, map: MapDescription): ScenarioLoadResult {
  const c = new Checker(file);
  const top = c.record('', raw, ['format', 'id', 'name', 'ruleset', 'units', 'map', 'initiative', 'freeDeployment', 'objectives', 'ending', 'sides'], ['battle', 'level', 'briefing']);
  if (!top) return { scenario: null, problems: c.problems };
  const f = (k: string): unknown => c.at(top, k);
  // A level of a battle: both keys or neither.
  const hasBattle = Object.prototype.hasOwnProperty.call(top, 'battle');
  const hasLevel = Object.prototype.hasOwnProperty.call(top, 'level');
  if (hasBattle !== hasLevel) c.add(hasBattle ? 'battle' : 'level', `is given without ${hasBattle ? 'level' : 'battle'}: a scenario names both the battle it is a level of and its level, or neither`);
  if (hasBattle) c.str('battle', f('battle'), BATTLE_PATTERN, 'a battle id: lower-case letters, digits and -, a letter first');
  if (hasLevel) c.oneOf('level', f('level'), [...SCENARIO_LEVELS, CAMPAIGN_LEVEL], 'level');
  if (f('format') !== SCENARIO_FORMAT) c.add('format', `must be '${SCENARIO_FORMAT}', got ${JSON.stringify(f('format'))}`);
  c.str('id', f('id'), ID_PATTERN, 'lower-case letters, digits, _ and -');
  c.str('name', f('name'));
  const rs = c.str('ruleset', f('ruleset'), ID_PATTERN, 'a rules data id');
  if (rs !== undefined && rs !== rules.id) c.add('ruleset', `names the rules data '${rs}', but is being loaded with '${rules.id}'`);
  const us = c.str('units', f('units'), ID_PATTERN, 'a unit file id');
  if (us !== undefined && us !== units.id) c.add('units', `names the unit file '${us}', but is being loaded with '${units.id}'`);
  const m = c.record('map', f('map'), ['id', 'hash']);
  if (m) {
    const id = c.str('map.id', c.at(m, 'id'), ID_PATTERN, 'a map id');
    const hash = c.str('map.hash', c.at(m, 'hash'), HASH_PATTERN, 'a SHA-256 hash (64 lower-case hex digits)');
    if (id !== undefined && id !== map.id) c.add('map.id', `names the map '${id}', but the map given is '${map.id}'`);
    const actual = mapHash(map);
    if (hash !== undefined && id === map.id && hash !== actual) c.add('map.hash', `map ${map.id}: the scenario was made for content hash ${hash}, the map given has ${actual}`);
  }
  const free = c.bool('freeDeployment', f('freeDeployment'));

  const g = gridOf(map);
  const label = (place: string, v: unknown): HexId => {
    const s = c.str(place, v, LABEL, 'a four-digit hex label like "0412"');
    if (s === undefined) return -1;
    const h = hexOf(map, s);
    if (h < 0) c.add(place, `hex ${s} is off the board (${g.cols} columns, ${g.rows} rows)`);
    return h;
  };

  const objectives = c.list('objectives', f('objectives'), 0, 50);
  const holders: [string, unknown][] = [];
  const seenObjectives = new Set<HexId>();
  objectives?.forEach((o, i) => {
    const place = `objectives[${i + 1}]`;
    const v = c.record(place, o, ['hex', 'points', 'holder']);
    if (!v) return;
    const h = label(`${place}.hex`, c.at(v, 'hex'));
    if (h >= 0 && seenObjectives.has(h)) c.add(`${place}.hex`, 'is listed twice');
    seenObjectives.add(h);
    c.int(`${place}.points`, c.at(v, 'points'), 0, 999);
    holders.push([`${place}.holder`, c.at(v, 'holder')]);
  });

  const end = c.record('ending', f('ending'), ['turns'], ['killShare', 'breakShare', 'suddenDeathLead']);
  if (end) {
    c.int('ending.turns', c.at(end, 'turns'), 1, 99);
    if (Object.prototype.hasOwnProperty.call(end, 'killShare')) checkKillShare(c, 'ending.killShare', c.at(end, 'killShare'));
    if (Object.prototype.hasOwnProperty.call(end, 'breakShare')) {
      const v = c.at(end, 'breakShare');
      if (typeof v !== 'number' || !(v > 0 && v <= 1)) c.add('ending.breakShare', `must be a number above 0 up to 1, got ${JSON.stringify(v)}`);
    }
    if (Object.prototype.hasOwnProperty.call(end, 'suddenDeathLead')) c.int('ending.suddenDeathLead', c.at(end, 'suddenDeathLead'), 1, 9999);
  }

  const typeIds = units.types.map(t => t.id);
  const typeOf = new Map(units.types.map(t => [t.id, t]));
  const covers = coversOf(map);
  // 4.1 is judged on the compiled board (cover, rivers, roads, hexsides), made once and only if a unit has a hex.
  let board: CompiledBoard | null = null;
  const enterable = new Map<string, Uint8Array | null>();
  const enterOf = (mover: string): Uint8Array | null => {
    if (!enterable.has(mover)) {
      board ??= compileBoard(map, terrainOf(rules));
      const k = board.moverTypes.indexOf(mover);
      enterable.set(mover, k < 0 ? null : enterableHexes(board, k));
    }
    return enterable.get(mover) ?? null;
  };
  const sides = c.list('sides', f('sides'), 2, 2);
  /** Each side's formation ids in order, for the briefing's check. */
  const formationsOf: string[][] = [];
  const sideIds: string[] = [];
  const unitIds = new Set<string>();
  const formationIds = new Set<string>();
  const zones: Set<HexId>[] = [];
  const occupant = new Map<HexId, { side: number; n: number }>();
  /** Every unit read: its place, side and type, and the transport it names. */
  const read = new Map<string, { place: string; side: number; type: string | undefined; carrier: string | undefined }>();
  sides?.forEach((s, si) => {
    const place = `sides[${si + 1}]`;
    const v = c.record(place, s, ['id', 'name', 'counters', 'orders', 'zone', 'formations']);
    if (!v) return;
    const id = c.str(`${place}.id`, c.at(v, 'id'), ID_PATTERN, 'lower-case letters, digits, _ and -');
    const at = id !== undefined ? `sides[${si + 1}] (${id})` : place;
    if (id !== undefined) {
      if (sideIds.includes(id)) c.add(`${at}.id`, `'${id}' is used twice`);
      sideIds.push(id);
    }
    c.str(`${at}.name`, c.at(v, 'name'));
    c.str(`${at}.counters`, c.at(v, 'counters'));
    c.int(`${at}.orders`, c.at(v, 'orders'), 1, 99);
    const zone = c.list(`${at}.zone`, c.at(v, 'zone'), 1, 20);
    const rects: [string, string][] = [];
    zone?.forEach((r, k) => {
      const corners = c.list(`${at}.zone[${k + 1}]`, r, 2, 2);
      if (!corners) return;
      const a = label(`${at}.zone[${k + 1}][1]`, corners[0]);
      const b = label(`${at}.zone[${k + 1}][2]`, corners[1]);
      if (a >= 0 && b >= 0) rects.push([corners[0] as string, corners[1] as string]);
    });
    zones.push(new Set(zoneHexes(map, rects)));
    let count = 0;
    const mine: string[] = [];
    formationsOf[si] = mine;
    const forms = c.list(`${at}.formations`, c.at(v, 'formations'), 1, 20);
    forms?.forEach((fm, fi) => {
      const fp = `${at}.formations[${fi + 1}]`;
      const fv = c.record(fp, fm, ['id', 'discipline', 'units']);
      if (!fv) return;
      const fid = c.str(`${fp}.id`, c.at(fv, 'id'), UNIT_ID, 'letters, digits, _ and -');
      if (fid !== undefined) {
        if (formationIds.has(fid)) c.add(`${fp}.id`, `'${fid}' is used twice`);
        formationIds.add(fid);
        mine.push(fid);
      }
      c.oneOf(`${fp}.discipline`, c.at(fv, 'discipline'), DISCIPLINES, 'fire discipline');
      const us = c.list(`${fp}.units`, c.at(fv, 'units'), 1, 40);
      // 3.1: two to five units that are not transports; transports besides, no more than the units that can be carried, listed last.
      let plain = 0;
      let transports = 0;
      let riders = 0;
      let transportSeen = false;
      us?.forEach((u, ui) => {
        const up = `${fp}.units[${ui + 1}]`;
        const uv = c.record(up, u, ['id', 'type'], ['hex', 'carriedBy']);
        if (!uv) return;
        const typeId = c.oneOf(`${up}.type`, c.at(uv, 'type'), typeIds, 'unit type');
        const type = typeId !== undefined ? typeOf.get(typeId) : undefined;
        if (type) {
          if (type.carries > 0) {
            transports++;
            transportSeen = true;
          } else {
            plain++;
            if (transportSeen) c.add(`${up}`, `a ${type.id} is listed after a transport: a formation lists its transports last (3.1)`);
          }
          if (type.rides) riders++;
        }
        const uid = c.str(`${up}.id`, c.at(uv, 'id'), UNIT_ID, 'letters, digits, _ and -');
        if (uid !== undefined) {
          if (unitIds.has(uid)) c.add(`${up}.id`, `'${uid}' is used twice`);
          unitIds.add(uid);
        }
        const hasHex = Object.prototype.hasOwnProperty.call(uv, 'hex');
        const hasCarrier = Object.prototype.hasOwnProperty.call(uv, 'carriedBy');
        if (hasHex === hasCarrier) {
          c.add(up, hasHex ? 'has both a hex and carriedBy: a unit starts in a hex or carried, not both (4.1)' : 'needs a hex, or carriedBy naming the transport that carries it at the start (4.1)');
        }
        let carrier: string | undefined;
        if (hasCarrier) carrier = c.str(`${up}.carriedBy`, c.at(uv, 'carriedBy'), UNIT_ID, 'a unit id');
        if (uid !== undefined) read.set(uid, { place: up, side: si, type: typeId, carrier });
        if (hasHex) {
          count++;
          const h = label(`${up}.hex`, c.at(uv, 'hex'));
          if (h >= 0) {
            if (type && enterOf(type.mover)?.[h] === 0) {
              c.add(`${up}.hex`, `a ${type.id} (${type.mover}) may not enter hex ${String(c.at(uv, 'hex'))} (${String(covers[h])}): no step into it is open to that mover type, and no unit starts in a hex its mover type may not enter (4.1)`);
            }
            // 4.2: under free deployment the scenario's own set-up must itself place every unit inside its side's zones
            // (a side may take it in place of its own placements), and within the stacking limit (below, for every scenario).
            const who = uid !== undefined ? `unit ${uid}` : 'the unit';
            if (free === true && !(zones[si] as Set<HexId>).has(h)) {
              c.add(`${up}.hex`, `${who} is set up in hex ${String(c.at(uv, 'hex'))}, outside its side's zones: under free deployment the scenario's own set-up places every unit inside its side's zones (4.2)`);
            }
            const o = occupant.get(h);
            if (o && o.side !== si) c.add(`${up}.hex`, `hex ${String(c.at(uv, 'hex'))} holds units of both sides`);
            else if (o && o.n >= rules.stack.limit) c.add(`${up}.hex`, `${who} is set up in hex ${String(c.at(uv, 'hex'))}, which would hold more than stack.limit (${rules.stack.limit}) units (4.2, 11.1)`);
            occupant.set(h, { side: si, n: (o?.n ?? 0) + 1 });
          }
        }
      });
      if (us) {
        if (plain < 2 || plain > 5) c.add(`${fp}.units`, `has ${plain} units that are not transports: a formation has two to five (3.1)`);
        if (transports > riders) c.add(`${fp}.units`, `has ${transports} transports but ${riders} units that can be carried: no more transports than that (3.1)`);
      }
    });
    const zoneSize = zones[zones.length - 1]?.size ?? 0;
    if (zoneSize > 0 && zoneSize * rules.stack.limit < count) c.add(`${at}.zone`, `holds ${zoneSize} hexes, too few for ${count} units at ${rules.stack.limit} a hex`);
  });
  // 4.1, 14.1: each transport named at the start carries one unit of its own side, which rides.
  const named = new Map<string, string>();
  for (const [uid, r] of read) {
    if (r.carrier === undefined) continue;
    const place = `${r.place}.carriedBy`;
    const t = read.get(r.carrier);
    const tt = t?.type !== undefined ? typeOf.get(t.type) : undefined;
    const ut = r.type !== undefined ? typeOf.get(r.type) : undefined;
    if (r.carrier === uid) c.add(place, 'a unit cannot carry itself');
    else if (!t) c.add(place, `names ${r.carrier}, which is no unit of this scenario`);
    else if (t.side !== r.side) c.add(place, `names ${r.carrier}, a unit of the other side (14.1)`);
    else if (tt && tt.carries === 0) c.add(place, `names ${r.carrier}, a ${tt.id}, which carries nothing (14.1)`);
    else if (named.has(r.carrier)) c.add(place, `names ${r.carrier}, which already carries ${String(named.get(r.carrier))}: a transport carries one unit (14.1)`);
    if (t) named.set(r.carrier, uid);
    if (ut && !ut.rides) c.add(place, `a ${ut.id} does not ride, so it cannot start carried (14.1)`);
  }
  const ini = c.str('initiative', f('initiative'), ID_PATTERN, 'a side id');
  if (ini !== undefined && sideIds.length === 2 && !sideIds.includes(ini)) c.add('initiative', `'${ini}' is not a side of this scenario (${sideIds.join(', ')})`);
  for (const [place, v] of holders) {
    if (v !== 'none' && (typeof v !== 'string' || !sideIds.includes(v))) c.add(place, `must be a side id (${sideIds.join(', ')}) or none, got ${JSON.stringify(v)}`);
  }
  if (zones.length === 2) {
    for (const h of zones[0] as Set<HexId>) {
      if ((zones[1] as Set<HexId>).has(h)) {
        c.add('sides', 'the two set-up zones overlap');
        break;
      }
    }
  }
  if (Object.prototype.hasOwnProperty.call(top, 'briefing')) {
    checkBriefing(c, f('briefing'), sideIds, formationsOf, (objectives ?? []).map(o => (isRecord(o) && typeof o.hex === 'string' ? o.hex : '')));
  }
  if (!c.ok) return { scenario: null, problems: c.problems };
  return { scenario: raw as ScenarioData, problems: [] };
}

/**
 * A scenario's briefing: every key required, none unknown, and its lists the same length and in the
 * same order as what they speak of (the sides, each side's formations, the objectives), so that a
 * briefing cannot name a formation or an objective the scenario does not have, nor leave one out.
 */
function checkBriefing(c: Checker, raw: unknown, sideIds: readonly string[], formationsOf: readonly (readonly string[])[], objectiveHexes: readonly string[]): void {
  const b = c.record('briefing', raw, ['title', 'date', 'place', 'picture', 'background', 'situation', 'note', 'sides', 'objectives']);
  if (!b) return;
  for (const key of ['title', 'date', 'place', 'background', 'situation', 'note']) c.str(`briefing.${key}`, c.at(b, key));
  c.str('briefing.picture', c.at(b, 'picture'), ID_PATTERN, 'a picture id: lower-case letters, digits, _ and -');
  const sides = c.list('briefing.sides', c.at(b, 'sides'), sideIds.length, sideIds.length);
  sides?.forEach((s, si) => {
    const place = `briefing.sides[${si + 1}]`;
    const v = c.record(place, s, ['side', 'short', 'mark', 'aim', 'formations']);
    if (!v) return;
    const id = c.str(`${place}.side`, c.at(v, 'side'), ID_PATTERN, 'a side id');
    if (id !== undefined && id !== sideIds[si]) c.add(`${place}.side`, `is '${id}', but side ${si + 1} of the scenario is '${String(sideIds[si])}': the briefing lists the sides in their order`);
    c.str(`${place}.short`, c.at(v, 'short'));
    c.oneOf(`${place}.mark`, c.at(v, 'mark'), SIDE_MARKS, 'mark');
    c.str(`${place}.aim`, c.at(v, 'aim'));
    const wanted = formationsOf[si] ?? [];
    const forms = c.list(`${place}.formations`, c.at(v, 'formations'), wanted.length, wanted.length);
    forms?.forEach((fm, fi) => {
      const fp = `${place}.formations[${fi + 1}]`;
      const fv = c.record(fp, fm, ['id', 'role']);
      if (!fv) return;
      const fid = c.str(`${fp}.id`, c.at(fv, 'id'), UNIT_ID, 'a formation id');
      if (fid !== undefined && fid !== wanted[fi]) c.add(`${fp}.id`, `is '${fid}', but formation ${fi + 1} of that side is '${String(wanted[fi])}': the briefing lists a side's formations in their order`);
      c.str(`${fp}.role`, c.at(fv, 'role'));
    });
  });
  const goals = c.list('briefing.objectives', c.at(b, 'objectives'), objectiveHexes.length, objectiveHexes.length);
  goals?.forEach((o, i) => {
    const place = `briefing.objectives[${i + 1}]`;
    const v = c.record(place, o, ['hex', 'name']);
    if (!v) return;
    const hex = c.str(`${place}.hex`, c.at(v, 'hex'), LABEL, 'a four-digit hex label like "0412"');
    if (hex !== undefined && hex !== objectiveHexes[i]) c.add(`${place}.hex`, `is ${hex}, but objective ${i + 1} of the scenario is at ${String(objectiveHexes[i])}: the briefing lists the objectives in their order`);
    c.str(`${place}.name`, c.at(v, 'name'));
  });
}

/** Read a scenario from its text and check it. */
export function parseScenario(text: string, file: string, rules: RulesData, units: UnitFile, map: MapDescription): ScenarioLoadResult {
  let raw: unknown;
  try {
    raw = parseText(text);
  } catch (err) {
    return { scenario: null, problems: [`${file}: not readable as YAML or JSON: ${(err as Error).message.split('\n')[0] ?? ''}`] };
  }
  return checkScenario(raw, file, rules, units, map);
}

/** The rules data id, unit file id and map id a scenario names, read before the full check (to find those files). */
export function scenarioNames(raw: unknown): { ruleset: string | null; units: string | null; map: string | null } {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ruleset: null, units: null, map: null };
  const r = raw as Record<string, unknown>;
  const m = r.map;
  const mapId = typeof m === 'object' && m !== null ? (m as Record<string, unknown>).id : undefined;
  return {
    ruleset: typeof r.ruleset === 'string' ? r.ruleset : null,
    units: typeof r.units === 'string' ? r.units : null,
    map: typeof mapId === 'string' ? mapId : null,
  };
}
