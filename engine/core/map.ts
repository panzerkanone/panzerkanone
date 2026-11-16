/**
 * The map description: what a map file holds, and nothing else reads a map
 * file but this module.
 *
 * A map file holds MEANING, never pictures: an elevation layer, a cover layer,
 * ridges, roads, rivers, bridges, towns and spot heights. The art is derived
 * from it, and so is everything about a hill that follows from where its
 * hilltops and crests are (slope area, line-of-sight edges: see hillLines.ts).
 *
 * Layout is flat-top and the file must say so. A file without `layout` is
 * refused; it is never guessed. Every key is required except `source`,
 * `trees` and `season`, and an unknown key is refused: there are no silent
 * defaults.
 *
 * `trees` is a layer a map may have: tree sides. Woods are then a hexside
 * feature, as slopes are: the file sets hexsides for trees, each with a
 * strength, and nothing else. A hex is a tree hex when any of its six sides is
 * set (treeHexesOf); where the trees stand is the art's to derive. A map
 * without the layer means exactly what it meant before the layer existed.
 *
 * Loading also holds a map to the board's own rules, for hand-made maps as
 * much as generated ones: a ridge is hexsides that meet end to end; a road
 * never runs along a slope, and crosses a river only on a bridge; a river runs
 * from one board edge to a different one, touches no edge hex in between,
 * keeps off hilltops, slopes and towns, and never crosses another river (it
 * may join one: below); a hill number is used once. What the terrain generator does beyond
 * that is its own habit, not a rule of the file: it keeps towns on roads,
 * marks every single-hex hilltop, and puts only woods on a hilltop.
 *
 * `water` is a cover a map may have: standing water, a lake or a sea, which
 * nothing crosses (a river is a chain of hexes that infantry may wade; water
 * is ground of its own). A body of water is hexes of it that touch, at least
 * MIN_WATER_BODY of them; one that touches the board's edge is a sea and runs
 * off the map. Water keeps off hilltops and slopes; a road never runs through
 * it (a causeway is land); a river that reaches it ends there, so a river's
 * end is on the board edge or in water. A map without water means exactly
 * what it meant before the cover existed, and is written as it was.
 *
 * A stream may RISE inland, at a SPRING: `springs` is a list a map may have, of
 * hexes where a river begins away from the board edge and from water. Each is
 * the first hex of exactly one river, on no other river and no road, and that
 * river's first hex is then not on the board edge (its other end is where any
 * river's may be). A river's first hex is on the board edge, in water, or a
 * spring; nothing else. A map without the key has no springs and means exactly
 * what it meant before the key existed, and is written as it was. In play a
 * stream is a river; the art draws one that rises at a spring narrow, tapering
 * from nothing at its spring.
 *
 * A river may JOIN another: its last hex is then a hex of the river it joins,
 * one that is not an end of that river. That is a junction, and nothing else
 * says so or needs to: the junction hex is a river hex like any other, on both
 * chains. The stream comes into the junction beside one of the two sides by
 * which the other river passes through the hex and not beside the other, and
 * the water runs on by that other side: the shape of a junction is the way its
 * rivers flow (`riverJunctionsOf`). One stream to a junction; no road through
 * one; no ring of rivers that end in each other. A map whose rivers do not
 * join means exactly what it meant before, and is written as it was.
 *
 * `season` says what time of year the board is printed for: `summer` or
 * `winter`. It is a key a map may have, as `trees` is, and its absence has
 * one meaning fixed here, in the format's own definition: a map that does not
 * name a season is a SUMMER board, because every map file written before the
 * key existed is one and means exactly what it meant then. That is not a
 * default the loader supplies: the loaded description holds `season` only
 * when the file states it, and `seasonOf` is the one place that reads the
 * absence, as summer. Any other value is refused. The season is meaning,
 * never a picture: the art prints a winter board from a winter palette with
 * snow on the ground; the rules price movement on it from the season's own table (ruling 83:
 * `seasons` in the ruleset, read by engine/core/board.ts).
 *
 * Hexes are named by the four-digit label printed on the board, column then
 * row, both counted from 1: "0412" is column 4, row 12.
 *
 * YAML and JSON both load. In YAML the two layers are block scalars, one text
 * row per board row.
 */
import { parse as parseText } from 'yaml';
import {
  DIR_NAMES, Dir, Grid, HexId, areAdjacent, boardEdgesOf, coordOf, directionTo, hexCount, isBoundary, labelOf, neighbourOf,
  parseLabel, sideFromKey, sideKey, stepAt, turn,
} from './hex';
import { edgesTouch, slopeAreaOf } from './hillLines';

export const MAP_FORMAT = 'map/1';

export type Cover = 'open' | 'woods' | 'town' | 'field' | 'swamp' | 'rough' | 'water';
export type Level = 0 | 2;

/** Elevation layer codes. */
export const ELEVATION_CODES: Readonly<Record<string, Level>> = { '.': 0, H: 2 };
/** Cover layer codes. */
export const COVER_CODES: Readonly<Record<string, Cover>> = {
  '.': 'open', w: 'woods', t: 'town', f: 'field', s: 'swamp', r: 'rough', '~': 'water',
};

/** A body of water is at least this many hexes. */
export const MIN_WATER_BODY = 3;

/** The seasons a board may be printed for. A map that names none is a summer board (see the header). */
export const SEASONS = ['summer', 'winter'] as const;
export type Season = (typeof SEASONS)[number];

const CODE_OF_LEVEL: Readonly<Record<number, string>> = { 0: '.', 2: 'H' };
const CODE_OF_COVER: Readonly<Record<Cover, string>> = {
  open: '.', woods: 'w', town: 't', field: 'f', swamp: 's', rough: 'r', water: '~',
};

export function elevationCode(level: number): string {
  const code = CODE_OF_LEVEL[level];
  if (code === undefined) throw new Error(`no elevation code for level ${level}`);
  return code;
}

export function coverCode(cover: Cover): string {
  return CODE_OF_COVER[cover];
}

/** A hex label: four digits, column then row, 1-based ("0412"). */
export type HexLabel = string;

/** How a generated map was made. Optional, and never read by the game. */
export interface MapSource {
  generator: string;
  seed: number;
  country: string;
  density: number;
  mirror: boolean;
  /** The command that reproduces the file. */
  command?: string;
}

export interface MapTown {
  name: string;
  hexes: HexLabel[];
}

export interface MapSpotHeight {
  hex: HexLabel;
  height: number;
}

/** One of a hex's six sides, clockwise from north (engine/core/hex DIR_NAMES). N and S are the level ones. */
export type SideName = 'N' | 'NE' | 'SE' | 'S' | 'SW' | 'NW';

/** A tree side's strength is above 0 and at most this. 1 is an ordinary side. */
export const MAX_TREE_STRENGTH = 3;

/**
 * A tree side: one hexside set for trees, and how strongly.
 *
 * A ridge side is named by the two hexes it runs between; a tree side may lie
 * on the board's own edge, where there is no second hex, so it is named by a
 * hex and one of that hex's six sides. A file may name a side from either of
 * its two hexes. A loaded description always holds the ONE name of the side:
 * the hex for which it faces N, NE or SE, or, on the board's edge where that
 * hex does not exist, the hex it belongs to (engine/core/hex sideKey).
 */
export interface MapTreeSide {
  hex: HexLabel;
  side: SideName;
  strength: number;
}

export interface MapDescription {
  format: typeof MAP_FORMAT;
  layout: 'flat-top';
  id: string;
  name: string;
  cols: number;
  rows: number;
  /** Seed for everything the art invents (where each tree stands, how a road wobbles). */
  artSeed: number;
  /**
   * The time of year the board is printed for. Optional, and present only when the file states it;
   * a map without it is a summer board (`seasonOf`).
   */
  season?: Season;
  /** One string per board row, top row first; one character per column. See ELEVATION_CODES. */
  elevation: string[];
  /** One string per board row, top row first; one character per column. See COVER_CODES. */
  cover: string[];
  /**
   * Hills with no top. Each ridge is a chain of crest edges across level
   * ground; an edge is the pair of hexes it runs between.
   */
  ridges: [HexLabel, HexLabel][][];
  /** Road chains, hex by hex. */
  roads: HexLabel[][];
  /** Edge hexes where a road leaves the map. Each ends a road chain. */
  exits: HexLabel[];
  /** Rivers, hex by hex. An end on the board edge runs off the map; an end in water is a mouth. */
  rivers: HexLabel[][];
  /**
   * Hexes where a stream rises inland: each the first hex of one river. Optional, and present only
   * when the file states it; a map without it has no springs.
   */
  springs?: HexLabel[];
  /** Hexes where a road crosses a river on a bridge. */
  bridges: HexLabel[];
  towns: MapTown[];
  /** Hill numbers printed on hilltops ("Hill 92"). */
  spotHeights: MapSpotHeight[];
  /**
   * Tree sides: the hexsides set for trees. Optional. No side is listed twice;
   * none is a side of a town, field, swamp, rough or water hex or of a hilltop,
   * and none is a ridge crest.
   */
  trees?: MapTreeSide[];
  source?: MapSource;
}

const TOP_KEYS = [
  'format', 'layout', 'id', 'name', 'cols', 'rows', 'artSeed', 'season', 'elevation', 'cover', 'ridges', 'roads', 'exits',
  'rivers', 'springs', 'bridges', 'towns', 'spotHeights', 'trees', 'source',
] as const;
const REQUIRED_KEYS = TOP_KEYS.filter(k => k !== 'source' && k !== 'trees' && k !== 'season' && k !== 'springs');
const SOURCE_KEYS = ['generator', 'seed', 'country', 'density', 'mirror', 'command'] as const;

export const MIN_MAP_SIDE = 5;
export const MAX_MAP_SIDE = 99;

export interface MapLoadResult {
  /** The validated description, or null when there is any problem. */
  map: MapDescription | null;
  problems: string[];
}

// ---------------------------------------------------------------------------
// accessors
// ---------------------------------------------------------------------------

export function gridOf(map: { cols: number; rows: number }): Grid {
  return { cols: map.cols, rows: map.rows };
}

/** The season the board is printed for: what the file states, and summer for a file that states none (the format's own definition). */
export function seasonOf(map: { season?: Season }): Season {
  return map.season ?? 'summer';
}

/** The code at (row, col) of a layer whose shape the caller has already checked. */
function codeAt(layer: readonly string[], row: number, col: number): string {
  return (layer[row] as string)[col] as string;
}

/** Elevation level of every hex, indexed by hex number. */
export function levelsOf(map: MapDescription): Level[] {
  const out: Level[] = [];
  for (let r = 0; r < map.rows; r++) for (let c = 0; c < map.cols; c++) out.push(ELEVATION_CODES[codeAt(map.elevation, r, c)] as Level);
  return out;
}

/** Cover of every hex, indexed by hex number. */
export function coversOf(map: MapDescription): Cover[] {
  const out: Cover[] = [];
  for (let r = 0; r < map.rows; r++) for (let c = 0; c < map.cols; c++) out.push(COVER_CODES[codeAt(map.cover, r, c)] as Cover);
  return out;
}

/** Hex number of a label on this map. The map must be valid. */
export function hexOf(map: { cols: number; rows: number }, label: HexLabel): HexId {
  return parseLabel(gridOf(map), label);
}

/** Ridges as chains of hex-number pairs. */
export function ridgeEdgesOf(map: MapDescription): [HexId, HexId][][] {
  return map.ridges.map(chain => chain.map(([a, c]) => [hexOf(map, a), hexOf(map, c)] as [HexId, HexId]));
}

/** A tree side by hex number: its side key (engine/core/hex sideKey), the hex and direction that name it, its strength. */
export interface TreeSide {
  key: number;
  hex: HexId;
  dir: Dir;
  strength: number;
}

/**
 * The map's tree sides, sorted by side key, so the order of the file's list
 * never matters. Empty for a map without the layer.
 */
export function treeSidesOf(map: MapDescription): TreeSide[] {
  const g = gridOf(map);
  return (map.trees ?? [])
    .map(t => {
      const key = sideKey(g, hexOf(map, t.hex), DIR_NAMES.indexOf(t.side));
      const [hex, dir] = sideFromKey(key);
      return { key, hex, dir, strength: t.strength };
    })
    .sort((a, b) => a.key - b.key);
}

/**
 * Which hexes are tree hexes, indexed by hex number. A hex is a tree hex when
 * any of its six sides is set, so a set side makes tree hexes of both the
 * hexes it lies between. Derived, never stored; all false for a map without
 * the layer.
 */
export function treeHexesOf(map: MapDescription): boolean[] {
  const g = gridOf(map);
  const out = new Array<boolean>(hexCount(g)).fill(false);
  for (const t of treeSidesOf(map)) {
    out[t.hex] = true;
    const other = neighbourOf(g, t.hex, t.dir);
    if (other >= 0) out[other] = true;
  }
  return out;
}

/** A body of water: its hexes, lowest first, and whether it touches the board's edge (a sea) or not (a lake). */
export interface WaterBody {
  hexes: HexId[];
  sea: boolean;
}

/** The map's bodies of water, each a group of water hexes that touch, in order of their lowest hex. Empty for a map without water. */
export function waterBodiesOf(map: MapDescription): WaterBody[] {
  return waterBodies(gridOf(map), coversOf(map));
}

function waterBodies(g: Grid, cover: readonly Cover[]): WaterBody[] {
  const n = hexCount(g);
  const seen = new Uint8Array(n);
  const out: WaterBody[] = [];
  for (let h = 0; h < n; h++) {
    if (seen[h] || cover[h] !== 'water') continue;
    const hexes: HexId[] = [];
    const queue = [h];
    seen[h] = 1;
    while (queue.length > 0) {
      const x = queue.pop() as HexId;
      hexes.push(x);
      for (const d of [0, 1, 2, 3, 4, 5]) {
        const y = neighbourOf(g, x, d);
        if (y >= 0 && !seen[y] && cover[y] === 'water') {
          seen[y] = 1;
          queue.push(y);
        }
      }
    }
    hexes.sort((a, b) => a - b);
    out.push({ hexes, sea: hexes.some(x => isBoundary(g, x)) });
  }
  return out;
}

/**
 * A junction: the river `river` (an index into the map's rivers) ends on the river `into`, in
 * `hex`, coming from its own hex `from`. (`junctionSidesOf` says which way the water runs on.)
 */
export interface RiverJunction {
  river: number;
  into: number;
  hex: HexId;
  from: HexId;
}

/**
 * The junctions of a map's rivers, in the order of the rivers that join: a river whose last hex
 * is a hex another river passes through between its ends. (A loaded map has at most one stream
 * to a junction.)
 */
export function riverJunctionsOf(map: MapDescription): RiverJunction[] {
  const chains = map.rivers.map(chain => chain.map(l => hexOf(map, l)));
  const out: RiverJunction[] = [];
  chains.forEach((ids, i) => {
    if (ids.length < 2) return;
    const last = ids[ids.length - 1] as HexId;
    const into = chains.findIndex((other, j) => j !== i && other.indexOf(last) > 0 && other.indexOf(last) < other.length - 1);
    if (into >= 0) out.push({ river: i, into, hex: last, from: ids[ids.length - 2] as HexId });
  });
  return out;
}

/**
 * The sides of a junction's hex by which the river joined passes through it: `upstream`, the one
 * the stream comes in beside, and `downstream`, the other, by which the water of both runs on.
 * Directions out of the hex. Null for a junction no loaded map has (the stream beside both sides,
 * or beside neither).
 */
export function junctionSidesOf(map: MapDescription, j: RiverJunction): { upstream: number; downstream: number; stream: number } | null {
  const g = gridOf(map);
  const through = (map.rivers[j.into] as HexLabel[]).map(l => hexOf(map, l));
  const k = through.indexOf(j.hex);
  if (k <= 0 || k >= through.length - 1) return null;
  const s1 = directionTo(g, j.hex, through[k - 1] as HexId);
  const s2 = directionTo(g, j.hex, through[k + 1] as HexId);
  const stream = directionTo(g, j.hex, j.from);
  const beside = (side: number): boolean => (stream - side + 6) % 6 === 1 || (stream - side + 6) % 6 === 5;
  if (stream === s1 || stream === s2 || beside(s1) === beside(s2)) return null;
  return beside(s1) ? { upstream: s1, downstream: s2, stream } : { upstream: s2, downstream: s1, stream };
}

/**
 * Where a line that ends on a boundary hex goes next: the off-board coordinate
 * one step beyond the end, chosen to carry the line straight on where it can.
 * `path` is the line hex by hex; `atStart` picks which end. Null when that end
 * is not on the board edge.
 */
export function offMapStep(g: Grid, path: readonly HexId[], atStart: boolean): [number, number] | null {
  const d = offMapDir(g, path, atStart);
  if (d < 0) return null;
  const [col, row] = coordOf(g, (atStart ? path[0] : path[path.length - 1]) as HexId);
  return stepAt(col, row, d);
}

/** The direction of offMapStep: the side by which a line leaves the board at that end, or -1. */
export function offMapDir(g: Grid, path: readonly HexId[], atStart: boolean): number {
  if (path.length === 0) return -1;
  const end = (atStart ? path[0] : path[path.length - 1]) as HexId;
  const inner = path.length > 1 ? ((atStart ? path[1] : path[path.length - 2]) as HexId) : -1;
  const inward = inner >= 0 ? directionTo(g, end, inner) : -1;
  const order = inward >= 0
    ? [turn(inward, 3), turn(inward, 2), turn(inward, 4), turn(inward, 1), turn(inward, 5)]
    : [0, 1, 2, 3, 4, 5];
  for (const d of order) if (neighbourOf(g, end, d) < 0) return d;
  return -1;
}

// ---------------------------------------------------------------------------
// validation
// ---------------------------------------------------------------------------

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function show(v: unknown): string {
  const s = typeof v === 'string' ? JSON.stringify(v) : Array.isArray(v) ? 'a list' : isRecord(v) ? 'a mapping' : String(v);
  return s.length > 40 ? `${s.slice(0, 37)}...` : s;
}

/**
 * Check parsed file content and return it as a MapDescription. Every problem is
 * reported with the place it was found; if there is any, `map` is null.
 */
export function validateMap(raw: unknown): MapLoadResult {
  const problems: string[] = [];
  const fail = (): MapLoadResult => ({ map: null, problems });
  if (!isRecord(raw)) {
    problems.push(`a map file must be a mapping of keys to values, got ${show(raw)}`);
    return fail();
  }

  for (const key of Object.keys(raw)) {
    if (!(TOP_KEYS as readonly string[]).includes(key)) problems.push(`unknown key '${key}'`);
  }
  if (!('layout' in raw)) {
    problems.push("layout is missing: a map file must say 'layout: flat-top'. It is never guessed");
  } else if (raw.layout !== 'flat-top') {
    problems.push(`layout must be 'flat-top', got ${show(raw.layout)}`);
  }
  for (const key of REQUIRED_KEYS) {
    if (key !== 'layout' && !(key in raw)) problems.push(`${key} is missing`);
  }
  if ('format' in raw && raw.format !== MAP_FORMAT) problems.push(`format must be '${MAP_FORMAT}', got ${show(raw.format)}`);

  const str = (key: string, pattern?: RegExp, what?: string): string => {
    const v = raw[key];
    if (!(key in raw)) return '';
    if (typeof v !== 'string' || v.trim().length === 0) {
      problems.push(`${key} must be a non-empty string, got ${show(v)}`);
      return '';
    }
    if (pattern && !pattern.test(v)) problems.push(`${key} must be ${what}, got ${show(v)}`);
    return v;
  };
  const int = (key: string, lo: number, hi: number): number => {
    const v = raw[key];
    if (!(key in raw)) return NaN;
    if (typeof v !== 'number' || !Number.isInteger(v) || v < lo || v > hi) {
      problems.push(`${key} must be a whole number from ${lo} to ${hi}, got ${show(v)}`);
      return NaN;
    }
    return v;
  };

  const id = str('id', /^[a-z0-9][a-z0-9_-]*$/, 'lower-case letters, digits, _ and -');
  const name = str('name');
  const cols = int('cols', MIN_MAP_SIDE, MAX_MAP_SIDE);
  const rows = int('rows', MIN_MAP_SIDE, MAX_MAP_SIDE);
  const artSeed = int('artSeed', 0, 0xffffffff);
  // The season: stated, or absent (a summer board). Never guessed from anything else in the file.
  let season: Season | undefined;
  if ('season' in raw) {
    const v = raw.season;
    if (typeof v === 'string' && (SEASONS as readonly string[]).includes(v)) season = v as Season;
    else problems.push(`season must be one of ${SEASONS.join(', ')} (or left out, for a summer board), got ${show(v)}`);
  }
  if (Number.isNaN(cols) || Number.isNaN(rows)) return fail();
  const g: Grid = { cols, rows };

  // ---- the two layers ----
  const layer = (key: 'elevation' | 'cover', codes: Readonly<Record<string, unknown>>): string[] => {
    const v = raw[key];
    if (!(key in raw)) return [];
    let lines: string[];
    if (typeof v === 'string') {
      lines = v.split('\n').map(line => line.trimEnd());
      while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
    } else if (Array.isArray(v) && v.every(line => typeof line === 'string')) {
      lines = v as string[];
    } else {
      problems.push(`${key} must be a block of text rows or a list of strings, got ${show(v)}`);
      return [];
    }
    if (lines.length !== rows) problems.push(`${key} has ${lines.length} rows, the map has ${rows}`);
    lines.forEach((line, r) => {
      if (line.length !== cols) {
        problems.push(`${key} row ${r + 1} has ${line.length} characters, the map has ${cols} columns`);
        return;
      }
      for (let c = 0; c < cols; c++) {
        const ch = line[c] as string;
        if (!(ch in codes)) {
          problems.push(`${key} row ${r + 1}, column ${c + 1}: unknown code '${ch}' (known: ${Object.keys(codes).join(' ')})`);
        }
      }
    });
    return lines;
  };
  const elevation = layer('elevation', ELEVATION_CODES);
  const cover = layer('cover', COVER_CODES);
  // True when both layers are complete and clean, so a hex can be looked up in them.
  const layersOk =
    elevation.length === rows && cover.length === rows &&
    elevation.every(l => l.length === cols && [...l].every(ch => ch in ELEVATION_CODES)) &&
    cover.every(l => l.length === cols && [...l].every(ch => ch in COVER_CODES));
  // Only called when layersOk, so every lookup is of a checked code.
  const levelAt = (h: HexId): Level => ELEVATION_CODES[codeAt(elevation, Math.floor(h / cols), h % cols)] as Level;
  const coverAt = (h: HexId): Cover => COVER_CODES[codeAt(cover, Math.floor(h / cols), h % cols)] as Cover;

  // ---- hex labels ----
  /** Hex number of a label, or -1 after reporting what is wrong with it. */
  const hex = (where: string, v: unknown): HexId => {
    if (typeof v === 'number') {
      problems.push(`${where}: a hex is a quoted four-digit label like "0412", got the number ${v}`);
      return -1;
    }
    if (typeof v !== 'string' || !/^[0-9]{4}$/.test(v)) {
      problems.push(`${where}: a hex is a four-digit label like "0412" (column then row), got ${show(v)}`);
      return -1;
    }
    const h = parseLabel(g, v);
    if (h < 0) problems.push(`${where}: hex ${v} is off the board (${cols} columns, ${rows} rows)`);
    return h;
  };
  const list = (key: string): unknown[] => {
    const v = raw[key];
    if (!(key in raw)) return [];
    if (!Array.isArray(v)) {
      problems.push(`${key} must be a list, got ${show(v)}`);
      return [];
    }
    return v;
  };
  const chain = (where: string, v: unknown, what: string): HexId[] => {
    if (!Array.isArray(v) || v.length < 2) {
      problems.push(`${where}: a ${what} is a list of two or more hexes, got ${show(v)}`);
      return [];
    }
    const ids = v.map((item, k) => hex(`${where}, hex ${k + 1}`, item));
    if (ids.some(h => h < 0)) return [];
    for (let k = 1; k < ids.length; k++) {
      if (!areAdjacent(g, ids[k - 1] as HexId, ids[k] as HexId)) {
        problems.push(`${where}: ${v[k - 1]} and ${v[k]} are not neighbours`);
        return [];
      }
    }
    return ids;
  };

  // ---- ridges ----
  const ridges: [HexLabel, HexLabel][][] = [];
  const ridgeIds: [HexId, HexId][][] = [];
  const seenEdges = new Set<string>();
  const edgeKeyOf = (a: HexId, c: HexId) => (a < c ? `${a}|${c}` : `${c}|${a}`);
  const before = problems.length;
  list('ridges').forEach((item, i) => {
    const where = `ridges[${i + 1}]`;
    if (!Array.isArray(item) || item.length === 0) {
      problems.push(`${where}: a ridge is a list of one or more crest edges, got ${show(item)}`);
      return;
    }
    const out: [HexLabel, HexLabel][] = [];
    const ids: [HexId, HexId][] = [];
    let previous: [HexId, HexId] | null = null;
    item.forEach((edge: unknown, k: number) => {
      const at = `${where}, edge ${k + 1}`;
      // An edge that cannot be read is not held against the edge after it.
      const last = previous;
      previous = null;
      if (!Array.isArray(edge) || edge.length !== 2) {
        problems.push(`${at}: a crest edge is the pair of hexes it runs between, got ${show(edge)}`);
        return;
      }
      const a = hex(at, edge[0]);
      const c = hex(at, edge[1]);
      if (a < 0 || c < 0) return;
      if (!areAdjacent(g, a, c)) {
        problems.push(`${at}: ${edge[0]} and ${edge[1]} are not neighbours, so there is no hexside between them`);
        return;
      }
      if (layersOk && (levelAt(a) !== 0 || levelAt(c) !== 0)) {
        problems.push(`${at}: a ridge crest runs between two level hexes, but ${levelAt(a) !== 0 ? edge[0] : edge[1]} is a hilltop`);
      }
      const key = edgeKeyOf(a, c);
      if (seenEdges.has(key)) problems.push(`${at}: the edge between ${edge[0]} and ${edge[1]} is listed twice`);
      seenEdges.add(key);
      if (k > 0 && last && !edgesTouch(g, last, [a, c])) {
        problems.push(`${at}: does not meet the edge before it end to end (a ridge is one connected chain of hexsides)`);
      }
      previous = [a, c];
      out.push([edge[0] as HexLabel, edge[1] as HexLabel]);
      ids.push([a, c]);
    });
    ridges.push(out);
    ridgeIds.push(ids);
  });
  const ridgesOk = problems.length === before;

  // Slope area, for the road and river rules below: derived exactly as the game derives it.
  const slope = layersOk && ridgesOk
    ? slopeAreaOf(g, Array.from({ length: hexCount(g) }, (_, h) => levelAt(h)), ridgeIds)
    : null;

  // ---- water ----
  // The owner's "an ocean or a lake" (2026-11-13): standing water is ground of its own. It keeps off
  // hilltops and slopes, and a body of it is at least MIN_WATER_BODY hexes.
  /** Which body of water each hex belongs to (an index), or -1. Empty when the layers cannot be read. */
  const bodyOf = new Map<HexId, number>();
  if (layersOk) {
    const covers = Array.from({ length: hexCount(g) }, (_, h) => coverAt(h));
    waterBodies(g, covers).forEach((body, i) => {
      for (const h of body.hexes) {
        bodyOf.set(h, i);
        if (levelAt(h) === 2) problems.push(`cover: water on the hilltop ${labelOf(g, h)} (water lies on level ground)`);
        else if (slope && slope[h]) problems.push(`cover: water at ${labelOf(g, h)} is on the slope of a hill (water keeps off hills)`);
      }
      if (body.hexes.length < MIN_WATER_BODY) {
        problems.push(`cover: the water at ${labelOf(g, body.hexes[0] as HexId)} is a body of ${body.hexes.length} (a lake or a sea is at least ${MIN_WATER_BODY} hexes that touch)`);
      }
    });
  }
  const hasWater = bodyOf.size > 0;
  const inWater = (h: HexId): boolean => bodyOf.has(h);

  /** The first hex a chain passes through twice, or -1. A closed loop may end where it began. */
  const repeatedIn = (ids: HexId[], mayClose: boolean): HexId => {
    const body = mayClose && ids.length > 3 && ids[0] === ids[ids.length - 1] ? ids.slice(0, -1) : ids;
    const seen = new Set<HexId>();
    for (const h of body) {
      if (seen.has(h)) return h;
      seen.add(h);
    }
    return -1;
  };

  // ---- roads and exits ----
  const roads: HexLabel[][] = [];
  const roadHex = new Set<HexId>();
  const roadEnds = new Set<HexId>();
  const roadStretch = new Map<string, number>();
  let roadsOk = true;
  list('roads').forEach((item, i) => {
    const where = `roads[${i + 1}]`;
    const ids = chain(where, item, 'road');
    if (ids.length === 0) {
      roadsOk = false;
      return;
    }
    const twice = repeatedIn(ids, true);
    if (twice >= 0) problems.push(`${where}: passes through ${labelOf(g, twice)} twice`);
    for (let k = 1; k < ids.length; k++) {
      const a = ids[k - 1] as HexId;
      const c = ids[k] as HexId;
      const key = edgeKeyOf(a, c);
      const other = roadStretch.get(key);
      if (other !== undefined && other !== i) {
        problems.push(`${where}: the stretch from ${labelOf(g, a)} to ${labelOf(g, c)} is already on roads[${other + 1}]`);
      }
      roadStretch.set(key, i);
      // The owner's rule: a road goes up or down a slope, or straight over a ridge crest, never along a slope.
      if (slope && slope[a] && slope[c] && !seenEdges.has(key)) {
        problems.push(`${where}: runs along a slope from ${labelOf(g, a)} to ${labelOf(g, c)} (a road goes up or down a slope, or straight over a ridge crest, never along it)`);
      }
    }
    for (const h of ids) {
      if (inWater(h)) problems.push(`${where}: runs through water at ${labelOf(g, h)} (a road keeps to land; a causeway is land)`);
    }
    ids.forEach(h => roadHex.add(h));
    roadEnds.add(ids[0] as HexId);
    roadEnds.add(ids[ids.length - 1] as HexId);
    roads.push((item as HexLabel[]).slice());
  });
  const exits: HexLabel[] = [];
  const exitSeen = new Set<HexId>();
  list('exits').forEach((item, i) => {
    const where = `exits[${i + 1}]`;
    const h = hex(where, item);
    if (h < 0) return;
    if (exitSeen.has(h)) problems.push(`${where}: ${item} is listed twice`);
    exitSeen.add(h);
    if (!isBoundary(g, h)) problems.push(`${where}: ${item} is not on the board edge`);
    // Only when every road was read cleanly: otherwise a broken road would be blamed on its exit.
    else if (roadsOk && !roadEnds.has(h)) problems.push(`${where}: no road ends at ${item}`);
    exits.push(item as HexLabel);
  });

  // ---- rivers and bridges ----
  // The owner's rules: a river runs from one board edge to a different one, or ends in water,
  // or ends on another river, at a junction; between its ends it touches no edge hex and no
  // water; it is never on a hilltop, on slope area or in a town; and rivers do not cross.
  const rivers: HexLabel[][] = [];
  const riverOf = new Map<HexId, number>();
  let riversOk = true;
  // Springs, read ahead of the rivers: a river may begin at one.
  let springs: HexLabel[] | undefined;
  const springAt = new Set<HexId>();
  if ('springs' in raw) {
    springs = [];
    list('springs').forEach((item, i) => {
      const where = `springs[${i + 1}]`;
      const h = hex(where, item);
      if (h < 0) return;
      if (springAt.has(h)) problems.push(`${where}: ${item as string} is listed twice`);
      springAt.add(h);
      if (isBoundary(g, h)) problems.push(`${where}: ${item as string} is on the board edge (a spring is inland: a river that comes in from the edge does not rise on the board)`);
      if (inWater(h)) problems.push(`${where}: ${item as string} is in water (a spring is on land)`);
      (springs as HexLabel[]).push(item as HexLabel);
    });
  }
  /** Rivers that begin at each spring. */
  const risingAt = new Map<HexId, number[]>();
  // The hexes each river passes through between its two ends, read ahead of the rules: a river
  // may end on such a hex of another river, whichever of the two the file lists first.
  const throughOf = new Map<HexId, number[]>();
  const lastOf: HexId[] = [];
  list('rivers').forEach((item, i) => {
    const labels = Array.isArray(item) ? item : [];
    const idOf = (label: unknown): HexId => (typeof label === 'string' && /^\d{4}$/.test(label) ? parseLabel(g, label) : -1);
    lastOf[i] = labels.length > 1 ? idOf(labels[labels.length - 1]) : -1;
    labels.slice(1, -1).forEach(label => {
      const h = idOf(label);
      if (h < 0) return;
      const on = throughOf.get(h);
      if (on) on.push(i);
      else throughOf.set(h, [i]);
    });
  });
  /** The river that river i joins at its last hex, or -1. */
  const joinedBy = (i: number): number => ((lastOf[i] as HexId) < 0 ? -1 : (throughOf.get(lastOf[i] as HexId) ?? []).find(j => j !== i) ?? -1);
  const anyJunction = lastOf.some((_h, i) => joinedBy(i) >= 0);
  const riverIds: HexId[][] = [];
  const junctions: RiverJunction[] = [];
  list('rivers').forEach((item, i) => {
    const where = `rivers[${i + 1}]`;
    const ids = chain(where, item, 'river');
    riverIds[i] = ids;
    if (ids.length === 0) {
      riversOk = false;
      return;
    }
    const twice = repeatedIn(ids, false);
    if (twice >= 0) problems.push(`${where}: passes through ${labelOf(g, twice)} twice`);
    const first = ids[0] as HexId;
    const last = ids[ids.length - 1] as HexId;
    // A river that ends on another river joins it there.
    const into = ids.length > 1 ? joinedBy(i) : -1;
    if (into >= 0) junctions.push({ river: i, into, hex: last, from: ids[ids.length - 2] as HexId });
    if (springAt.has(first)) {
      const at = risingAt.get(first);
      if (at) at.push(i);
      else risingAt.set(first, [i]);
    }
    for (const [end, word] of [[first, 'starts'], [last, 'ends']] as [HexId, string][]) {
      if (word === 'ends' && into >= 0) continue;
      // A river may begin at a spring, inland.
      if (word === 'starts' && springAt.has(end)) continue;
      if (!isBoundary(g, end) && !inWater(end)) {
        problems.push(hasWater
          ? `${where}: ${word} at ${labelOf(g, end)}, which is neither on the board edge nor in water${word === 'starts' && springs !== undefined ? ' nor a spring' : ''} (a river runs from the board edge or from water to the board edge or to water)`
          : `${where}: ${word} at ${labelOf(g, end)}, which is not on the board edge${word === 'starts' && springs !== undefined ? ' nor a spring' : ''} (a river runs from one board edge to another)`);
      }
    }
    if (inWater(first) && inWater(last) && bodyOf.get(first) === bodyOf.get(last)) {
      problems.push(`${where}: starts and ends in the same body of water`);
    }
    // An end in water is a mouth, wherever the water lies; two ends on the board edge are on different edges.
    if (isBoundary(g, first) && isBoundary(g, last) && !inWater(first) && !inWater(last)) {
      // A corner hex is on two edges; the two ends must have no edge in common.
      const from = boardEdgesOf(g, first);
      const shared = from.find(a => boardEdgesOf(g, last).includes(a));
      if (shared !== undefined) {
        problems.push(`${where}: starts and ends on the ${shared} edge (a river runs from one board edge to a different one)`);
      }
    }
    for (const h of ids.slice(1, -1)) {
      if (inWater(h)) problems.push(`${where}: runs through water at ${labelOf(g, h)} (a river that reaches water ends there)`);
      else if (isBoundary(g, h)) problems.push(`${where}: runs along the board edge at ${labelOf(g, h)} (only a river's two ends are edge hexes)`);
    }
    for (const h of ids) {
      if (layersOk && levelAt(h) === 2) problems.push(`${where}: crosses the hilltop ${labelOf(g, h)}`);
      else if (slope && slope[h]) problems.push(`${where}: is on the slope of a hill at ${labelOf(g, h)} (a river keeps off hills)`);
      if (layersOk && coverAt(h) === 'town') problems.push(`${where}: runs through the town hex ${labelOf(g, h)}`);
      const other = riverOf.get(h);
      if (other !== undefined && other !== i) {
        // Two rivers share a hex only at a junction: one of them ends there and the other passes through.
        const meets = (h === last && into === other) || (h === lastOf[other] && joinedBy(other) === i);
        if (!meets) {
          problems.push(`${where}: ${labelOf(g, h)} is already on rivers[${other + 1}] (${anyJunction
            ? 'rivers do not cross; one joins another only by ending on a hex the other passes through'
            : 'rivers do not join or cross'})`);
        }
      }
      // A junction hex is the hex of the river that passes through it.
      if (!(h === last && into >= 0)) riverOf.set(h, i);
    }
    rivers.push((item as HexLabel[]).slice());
  });
  // ---- junctions ----
  if (riversOk && junctions.length > 0) {
    const taken = new Map<HexId, number>();
    for (const j of junctions) {
      const where = `rivers[${j.river + 1}]`;
      const at = labelOf(g, j.hex);
      const before = taken.get(j.hex);
      if (before !== undefined) {
        problems.push(`${where}: joins rivers[${j.into + 1}] at ${at}, where rivers[${before + 1}] joins it already (one stream to a junction)`);
        continue;
      }
      taken.set(j.hex, j.river);
      if (roadsOk && roadHex.has(j.hex)) problems.push(`${where}: joins rivers[${j.into + 1}] at ${at}, which is a road hex (no road goes through a junction)`);
      // The two sides by which the river joined passes through the hex, and the side the stream comes in by.
      const through = riverIds[j.into] as HexId[];
      const k = through.indexOf(j.hex);
      const s1 = directionTo(g, j.hex, through[k - 1] as HexId);
      const s2 = directionTo(g, j.hex, through[k + 1] as HexId);
      const a = directionTo(g, j.hex, j.from);
      const beside = (side: number): boolean => (a - side + 6) % 6 === 1 || (a - side + 6) % 6 === 5;
      if (a !== s1 && a !== s2 && beside(s1) === beside(s2)) {
        problems.push(`${where}: joins rivers[${j.into + 1}] at ${at} ${beside(s1) ? 'from inside its bend' : 'head-on'} (a river comes into a junction beside one of the two sides by which the other passes through the hex, and the water runs on by the other side)`);
      }
    }
    // No ring: following each river to the one it joins comes to a river that joins none.
    for (const j of junctions) {
      let at = j.into;
      for (let step = 0; step < junctions.length && at >= 0 && at !== j.river; step++) at = junctions.find(x => x.river === at)?.into ?? -1;
      if (at === j.river) problems.push(`rivers[${j.river + 1}]: joins rivers[${j.into + 1}] in a ring of rivers that end in each other`);
    }
  }
  // ---- springs ----
  // Each is the first hex of exactly one river, and on no other; no road passes one.
  if (riversOk && springs !== undefined) {
    springs.forEach((label, i) => {
      const where = `springs[${i + 1}]`;
      const h = parseLabel(g, label);
      const rising = risingAt.get(h) ?? [];
      if (rising.length === 0) problems.push(`${where}: no river begins at ${label} (a spring is the first hex of the river that rises there)`);
      else if (rising.length > 1) problems.push(`${where}: ${rising.length} rivers begin at ${label} (one stream rises at a spring)`);
      const on = riverOf.get(h);
      if (on !== undefined && !rising.includes(on)) problems.push(`${where}: ${label} is on rivers[${on + 1}], which does not rise there`);
      if (roadsOk && roadHex.has(h)) problems.push(`${where}: ${label} is a road hex (no road passes a spring)`);
    });
  }
  const bridges: HexLabel[] = [];
  const bridgeSeen = new Set<HexId>();
  list('bridges').forEach((item, i) => {
    const where = `bridges[${i + 1}]`;
    const h = hex(where, item);
    if (h < 0) return;
    if (bridgeSeen.has(h)) problems.push(`${where}: ${item} is listed twice`);
    bridgeSeen.add(h);
    if (roadsOk && riversOk && (!roadHex.has(h) || !riverOf.has(h))) {
      problems.push(`${where}: ${item} is not on both a road and a river`);
    }
    bridges.push(item as HexLabel);
  });
  if (roadsOk && riversOk && 'bridges' in raw && Array.isArray(raw.bridges)) {
    for (const h of [...roadHex].sort((x, y) => x - y)) {
      if (riverOf.has(h) && !bridgeSeen.has(h)) {
        problems.push(`bridges: a road crosses a river at ${labelOf(g, h)} with no bridge (there is no ford yet)`);
      }
    }
  }
  // A road meets a river only to cross it. Where they share a hex, the road must pass from one
  // bank to the other: the two sides by which the river goes through the hex lie on opposite
  // sides of the road. Side by side in one hex there is nothing for a bridge to bridge and no
  // room to draw the two; and a road never follows a river from hex to hex.
  if (roadsOk && riversOk && problems.length === before) {
    const sidesOf = (chains: HexLabel[][], exitsOnly: boolean): Map<HexId, Set<number>> => {
      const out = new Map<HexId, Set<number>>();
      const add = (h: HexId, d: number): void => {
        if (d < 0) return;
        let set = out.get(h);
        if (!set) out.set(h, set = new Set<number>());
        set.add(d);
      };
      for (const labels of chains) {
        const ids = labels.map(l => parseLabel(g, l));
        for (let k = 1; k < ids.length; k++) {
          add(ids[k - 1] as HexId, directionTo(g, ids[k - 1] as HexId, ids[k] as HexId));
          add(ids[k] as HexId, directionTo(g, ids[k] as HexId, ids[k - 1] as HexId));
        }
        // An end on the board edge runs off the map: a river's always, a road's where it is an exit.
        for (const atStart of [true, false]) {
          const end = (atStart ? ids[0] : ids[ids.length - 1]) as HexId;
          if (isBoundary(g, end) && (!exitsOnly || exitSeen.has(end))) add(end, offMapDir(g, ids, atStart));
        }
      }
      return out;
    };
    const roadSides = sidesOf(roads, true);
    const riverSides = sidesOf(rivers, false);
    for (const h of [...roadHex].sort((x, y) => x - y)) {
      const river = riverSides.get(h);
      if (!river || river.size !== 2) continue;
      const [r1, r2] = [...river] as [number, number];
      const road = [...(roadSides.get(h) ?? [])];
      const along = road.find(d => d === r1 || d === r2);
      if (along !== undefined) {
        const to = neighbourOf(g, h, along);
        if (to >= 0 && roadHex.has(to) && riverOf.has(to)) {
          if (h < to) problems.push(`roads: a road follows a river from ${labelOf(g, h)} to ${labelOf(g, to)} (a road meets a river only to cross it)`);
          continue;
        }
      }
      // Which bank a road side is on: going round the hex from r1, before r2 or after it.
      const bank = (d: number): number => ((d - r1 + 6) % 6 < (r2 - r1 + 6) % 6 ? 0 : 1);
      const banks = new Set(road.filter(d => d !== r1 && d !== r2).map(bank));
      if (banks.size < 2) {
        problems.push(`bridges: at ${labelOf(g, h)} a road and a river share the hex without crossing (a road meets a river only to cross it)`);
      }
    }
  }

  // ---- towns ----
  const towns: MapTown[] = [];
  const townOf = new Map<HexId, string>();
  const townNames = new Set<string>();
  let townsOk = true;                  // false once a town entry could not be read: its hexes are then unknown
  list('towns').forEach((item, i) => {
    const where = `towns[${i + 1}]`;
    if (!isRecord(item)) {
      problems.push(`${where}: a town is { name, hexes }, got ${show(item)}`);
      townsOk = false;
      return;
    }
    for (const key of Object.keys(item)) if (key !== 'name' && key !== 'hexes') problems.push(`${where}: unknown key '${key}'`);
    const townName = item.name;
    if (typeof townName !== 'string' || townName.trim().length === 0) {
      problems.push(`${where}: name must be a non-empty string, got ${show(townName)}`);
      townsOk = false;
      return;
    }
    if (townNames.has(townName)) problems.push(`${where}: the name ${show(townName)} is used twice`);
    townNames.add(townName);
    if (!Array.isArray(item.hexes) || item.hexes.length === 0) {
      problems.push(`${where} (${townName}): hexes must be a list of one or more hexes, got ${show(item.hexes)}`);
      townsOk = false;
      return;
    }
    const hexes: HexLabel[] = [];
    item.hexes.forEach((label: unknown, k: number) => {
      const h = hex(`${where} (${townName}), hex ${k + 1}`, label);
      if (h < 0) {
        townsOk = false;
        return;
      }
      if (layersOk && coverAt(h) !== 'town') problems.push(`${where} (${townName}): ${label} is not a town hex in the cover layer`);
      if (townOf.has(h)) problems.push(`${where} (${townName}): ${label} already belongs to ${townOf.get(h)}`);
      townOf.set(h, townName);
      hexes.push(label as HexLabel);
    });
    towns.push({ name: townName, hexes });
  });
  if (layersOk && townsOk && 'towns' in raw) {
    for (let h = 0; h < hexCount(g); h++) {
      if (coverAt(h) === 'town' && !townOf.has(h)) problems.push(`towns: town hex ${labelOf(g, h)} belongs to no town`);
    }
  }

  // ---- spot heights ----
  const spotHeights: MapSpotHeight[] = [];
  const spotted = new Set<HexId>();
  const numbersUsed = new Set<number>();
  list('spotHeights').forEach((item, i) => {
    const where = `spotHeights[${i + 1}]`;
    if (!isRecord(item)) {
      problems.push(`${where}: a spot height is { hex, height }, got ${show(item)}`);
      return;
    }
    for (const key of Object.keys(item)) if (key !== 'hex' && key !== 'height') problems.push(`${where}: unknown key '${key}'`);
    const h = hex(where, item.hex);
    const height = item.height;
    if (typeof height !== 'number' || !Number.isInteger(height) || height < 1 || height > 9999) {
      problems.push(`${where}: height must be a whole number from 1 to 9999, got ${show(height)}`);
      return;
    }
    if (h < 0) return;
    if (layersOk && levelAt(h) !== 2) problems.push(`${where}: ${item.hex} is not a hilltop`);
    if (spotted.has(h)) problems.push(`${where}: ${item.hex} already has a spot height`);
    spotted.add(h);
    if (numbersUsed.has(height)) problems.push(`${where}: the number ${height} is used twice (a hill is known by its number)`);
    numbersUsed.add(height);
    spotHeights.push({ hex: item.hex as HexLabel, height });
  });

  // ---- trees (optional): tree sides ----
  // The owner's model: woods are a hexside feature, as slopes are. A tree side is a hexside with a
  // strength, and it may lie on the board's own edge. The layer's rules: no side twice; none a side
  // of a town, field, swamp or rough hex or of a hilltop; none a ridge crest.
  let trees: MapTreeSide[] | undefined;
  if ('trees' in raw) {
    const out: MapTreeSide[] = [];
    const sideSeen = new Map<number, number>();
    list('trees').forEach((item, i) => {
      const where = `trees[${i + 1}]`;
      if (!isRecord(item)) {
        problems.push(`${where}: a tree side is { hex, side, strength }, got ${show(item)}`);
        return;
      }
      for (const key of Object.keys(item)) {
        if (key !== 'hex' && key !== 'side' && key !== 'strength') problems.push(`${where}: unknown key '${key}'`);
      }
      const h = hex(where, item.hex);
      const d = typeof item.side === 'string' ? DIR_NAMES.indexOf(item.side) : -1;
      if (d < 0) problems.push(`${where}: side must be one of ${DIR_NAMES.join(', ')}, got ${show(item.side)}`);
      const strength = item.strength;
      const strengthOk = typeof strength === 'number' && Number.isFinite(strength) && strength > 0 && strength <= MAX_TREE_STRENGTH;
      if (!strengthOk) problems.push(`${where}: strength must be a number above 0 and at most ${MAX_TREE_STRENGTH}, got ${show(strength)}`);
      if (h < 0 || d < 0) return;
      const said = `${item.hex as string} ${item.side as string}`;
      const key = sideKey(g, h, d);
      const [owner, ownerDir] = sideFromKey(key);
      const first = sideSeen.get(key);
      if (first !== undefined) problems.push(`${where}: the side ${said} is listed twice (it is trees[${first + 1}] too; a side has one strength)`);
      else sideSeen.set(key, i);
      const other = neighbourOf(g, h, d);
      for (const x of other >= 0 ? [h, other] : [h]) {
        if (!layersOk) continue;
        const cv = coverAt(x);
        if (cv === 'town' || cv === 'field' || cv === 'swamp' || cv === 'rough' || cv === 'water') {
          problems.push(`${where}: ${said} is a side of ${labelOf(g, x)}, which is ${cv} (a tree side lies between hexes of open ground or woods)`);
        }
        if (levelAt(x) === 2) problems.push(`${where}: ${said} is a side of the hilltop ${labelOf(g, x)} (a hilltop's sides are crests)`);
      }
      if (other >= 0 && seenEdges.has(edgeKeyOf(h, other))) problems.push(`${where}: ${said} is a ridge crest`);
      if (strengthOk) out.push({ hex: labelOf(g, owner), side: DIR_NAMES[ownerDir] as SideName, strength: strength as number });
    });
    trees = out;
  }

  // ---- source ----
  let source: MapSource | undefined;
  if ('source' in raw) {
    const s = raw.source;
    if (!isRecord(s)) {
      problems.push(`source must be a mapping, got ${show(s)}`);
    } else {
      for (const key of Object.keys(s)) {
        if (!(SOURCE_KEYS as readonly string[]).includes(key)) problems.push(`source: unknown key '${key}'`);
      }
      const ok =
        typeof s.generator === 'string' && typeof s.seed === 'number' && Number.isInteger(s.seed) &&
        typeof s.country === 'string' && typeof s.density === 'number' && typeof s.mirror === 'boolean' &&
        (s.command === undefined || typeof s.command === 'string');
      if (!ok) {
        problems.push('source must hold generator (text), seed (whole number), country (text), density (number), mirror (true or false) and optionally command (text)');
      } else {
        source = {
          generator: s.generator as string, seed: s.seed as number, country: s.country as string,
          density: s.density as number, mirror: s.mirror as boolean,
          ...(s.command !== undefined ? { command: s.command as string } : {}),
        };
      }
    }
  }

  if (problems.length > 0) return fail();
  return {
    map: {
      format: MAP_FORMAT, layout: 'flat-top', id, name, cols, rows, artSeed,
      ...(season !== undefined ? { season } : {}),
      elevation, cover, ridges, roads, exits, rivers,
      ...(springs !== undefined ? { springs } : {}),
      bridges, towns, spotHeights,
      ...(trees ? { trees } : {}),
      ...(source ? { source } : {}),
    },
    problems,
  };
}

/** Read a map file's text (YAML or JSON) and validate it. */
export function parseMap(text: string): MapLoadResult {
  let raw: unknown;
  try {
    raw = parseText(text);
  } catch (err) {
    return { map: null, problems: [`not readable as YAML or JSON: ${(err as Error).message.split('\n')[0]}`] };
  }
  return validateMap(raw);
}

// ---------------------------------------------------------------------------
// writing
// ---------------------------------------------------------------------------

const q = (s: string): string => JSON.stringify(s);
const labels = (hexes: readonly HexLabel[]): string => `[${hexes.map(q).join(', ')}]`;

/**
 * The map as YAML text. The output is fixed for a given map (same keys, same
 * order, same spacing), so files diff cleanly. `header` lines go at the top as
 * comments.
 */
export function mapToYaml(map: MapDescription, header: readonly string[] = []): string {
  const out: string[] = [];
  for (const line of header) out.push(`# ${line}`);
  if (header.length > 0) out.push('');
  out.push(`format: ${map.format}`);
  out.push(`layout: ${map.layout}`);
  out.push(`id: ${map.id}`);
  out.push(`name: ${q(map.name)}`);
  out.push(`cols: ${map.cols}`);
  out.push(`rows: ${map.rows}`);
  out.push(`artSeed: ${map.artSeed}`);
  // Written only when the map states it: a map without a season is written as it always was.
  if (map.season !== undefined) {
    out.push('# season: the time of year the board is printed for, summer or winter (a map without the key is summer).');
    out.push(`season: ${map.season}`);
  }
  out.push('');
  out.push('# The two layers: one text row per board row, top row first; one character per');
  out.push('# column, column 01 first. On the board, even-numbered columns sit half a hex lower.');
  out.push('#   elevation:  .  level ground   H  hilltop');
  out.push('elevation: |');
  for (const line of map.elevation) out.push(`  ${line}`);
  // The legend names water only on a map that has it: a map without is written as it always was.
  out.push(`#   cover:  .  open   w  woods   t  town   f  field   s  swamp   r  rough${map.cover.some(row => row.includes('~')) ? '   ~  water' : ''}`);
  out.push('cover: |');
  for (const line of map.cover) out.push(`  ${line}`);
  out.push('');
  out.push('# A hex is named by the label printed on it: column then row ("0412" is column 4, row 12).');
  out.push('# A slope is not a hex. It is the hill area around a crest, and a crest is a hexside:');
  out.push('# every edge of a hilltop is one, and a ridge is a chain of them across level ground.');
  out.push('# ridges: each ridge is its chain of crest edges; an edge is the pair of hexes it runs between.');
  const block = (key: string, items: string[]) => {
    if (items.length === 0) {
      out.push(`${key}: []`);
    } else {
      out.push(`${key}:`);
      for (const item of items) out.push(`  - ${item}`);
    }
  };
  block('ridges', map.ridges.map(chain => `[${chain.map(([a, c]) => `[${q(a)}, ${q(c)}]`).join(', ')}]`));
  out.push('');
  out.push('# roads and rivers run hex to hex. A road leaves the map at each exit; a river end on the');
  out.push('# board edge runs off the map.');
  if (riverJunctionsOf(map).length > 0) out.push('# A river whose last hex is a hex of another river joins it there: a junction.');
  block('roads', map.roads.map(labels));
  out.push(`exits: ${labels(map.exits)}`);
  block('rivers', map.rivers.map(labels));
  // Written only when the map has the key: a map without springs is written as it always was.
  if (map.springs !== undefined) {
    out.push('# springs: where a stream rises inland, each the first hex of the river that rises there.');
    out.push(`springs: ${labels(map.springs)}`);
  }
  out.push(`bridges: ${labels(map.bridges)}`);
  out.push('');
  block('towns', map.towns.map(t => `{ name: ${q(t.name)}, hexes: ${labels(t.hexes)} }`));
  out.push('# spotHeights: the hill numbers printed on hilltops ("Hill 92").');
  block('spotHeights', map.spotHeights.map(s => `{ hex: ${q(s.hex)}, height: ${s.height} }`));
  if (map.trees !== undefined) {
    out.push('');
    out.push('# trees: tree sides. Woods are a hexside feature, as slopes are: each entry sets one hexside');
    out.push(`# for trees, with a strength (above 0, at most ${MAX_TREE_STRENGTH}; 1 is an ordinary side). A side is named by a`);
    out.push('# hex and one of its six sides, N NE SE S SW NW (N and S are the level ones): by the hex for');
    out.push("# which it faces N, NE or SE, or on the board's own edge by the hex it belongs to. Nothing else");
    out.push('# is stored: a hex is a tree hex when any of its sides is set, and the art derives the rest.');
    block('trees', map.trees.map(t => `{ hex: ${q(t.hex)}, side: ${q(t.side)}, strength: ${t.strength} }`));
  }
  if (map.source) {
    out.push('');
    out.push('source:');
    out.push(`  generator: ${q(map.source.generator)}`);
    out.push(`  seed: ${map.source.seed}`);
    out.push(`  country: ${map.source.country}`);
    out.push(`  density: ${map.source.density}`);
    out.push(`  mirror: ${map.source.mirror}`);
    if (map.source.command !== undefined) out.push(`  command: ${q(map.source.command)}`);
  }
  return out.join('\n') + '\n';
}

/** The map as JSON text, keys in the same order as the YAML. */
export function mapToJson(map: MapDescription): string {
  const ordered: Record<string, unknown> = {};
  for (const key of TOP_KEYS) {
    const v = (map as unknown as Record<string, unknown>)[key];
    if (v !== undefined) ordered[key] = v;
  }
  return JSON.stringify(ordered, null, 2) + '\n';
}
