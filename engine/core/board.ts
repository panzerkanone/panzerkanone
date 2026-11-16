/**
 * Board compile: a map description (map.ts) plus a ruleset's terrain data
 * become a compiled board, the rules' fast view of the map. The board is
 * static content: it is never part of a game state. A state refers to it by
 * the map's id and content hash.
 *
 *   const board = compileBoard(map, terrain);   // map: a validated MapDescription
 *
 * WHAT A COMPILED BOARD ANSWERS
 *
 *   board.cost(mover, a, b)   movement cost from hex a to the adjacent hex b for
 *                             a mover type: a whole number, or null (impassable).
 *                             Also board.stepCost[moverIndex][a * 6 + d], -1 when
 *                             impassable, for the path search.
 *   board.sees(a, b)          line of sight between any two hexes (sight.ts).
 *   board.seesPast(a, b, f)   the same with further blocking hexes named by f (smoke).
 *   board.coverOf(h)          the cover of a hex: as the description gives it, except that a tree
 *                             hex (any of its six sides is a tree side) on open ground is woods.
 *   board.levelOf(h)          0 level ground, 2 hilltop.
 *   board.hillLines           the hill lines, exactly as deriveHillLines gives
 *                             them for this description (never derived here).
 *   board.id, board.hash      the map's id and content hash (mapHash below).
 *   board.terrainHash         the content hash of the terrain data it was compiled
 *                             with (terrainHash below). A board is static content
 *                             made from two inputs, and names both: whoever is
 *                             handed a compiled board checks both hashes against
 *                             the map and the terrain data it expects, and refuses
 *                             it otherwise (the reference ruleset and the content
 *                             loader do).
 *
 *   compileBoard(map, terrain, { sight: 'all-pairs' | 'by-row' })
 *                             chooses how the sight table is built (sight.ts);
 *                             by default all pairs at compile time up to
 *                             ALL_PAIRS_LIMIT hexes, row by row on first use above.
 *
 * THE MOVEMENT COST RULE (the lead's ruling 6 of 2026-11-11)
 *
 * The terrain data gives five terms, each keyed by mover type; a missing key
 * is an error and null means impassable. For a step from hex a to the
 * adjacent hex b:
 *
 *   - road:  if the hexside a|b is on a road chain (a and b are consecutive
 *            hexes of one of the map's roads, in either order), the cost is
 *            road[mover] and nothing else is added. A bridge is a road step
 *            onto a river hex.
 *   - otherwise the cost is enter[cover of b][mover]
 *            + climb[mover]  when a is level ground and b is a hilltop
 *                            (stepping down adds nothing)
 *            + ridge[mover]  when the hexside a|b is a ridge crest edge
 *            + river[mover]  when b is a river hex (on any river chain).
 *            If any term that applies is null, the step is impassable.
 *
 * Separators cost nothing (they are sight lines only); slope area costs
 * nothing by itself. Costs are whole numbers so that the path search can use
 * a bucket queue and every sum is exact.
 *
 * THE SEASON'S TABLE (the lead's ruling 83 of 2026-11-14)
 *
 * The five terms above are `movement`: the table of a summer board (a map that
 * names no season is one: map.ts). The terrain data may also give `seasons`, a
 * table for each other season, and a board printed for that season (the map's
 * `season`) is compiled with that table instead, whole: the same five terms,
 * and two more, `lake` and `sea`, the cost of a step into standing water of a
 * lake or of a sea (a body of water that touches the board's edge:
 * waterBodiesOf). The board reads no season's name: it takes `movement` for
 * the season of a map that names none, and `seasons[<the map's season>]` for
 * any other, and refuses a board whose season the terrain data has no table
 * for. Sight is the same in every season.
 *
 *   board.season              the season the board was compiled for (the map's).
 *   board.seaHex              1 where a hex is water of a sea.
 *
 * In a season's table a step into water costs `lake[mover]` or `sea[mover]`
 * and nothing else (water lies on level ground, no road runs through it, and
 * a river's mouth in it is water); null is closed, as it is for every mover
 * on a summer board.
 *
 * THE SIGHT DATA
 *
 * coverAddsLevel[cover] says which covers add one level to a hex's sight
 * height; crestRule switches the crest rule (sight.ts, step 6).
 *
 * STANDING WATER (the map's `water` cover; the owner's "an ocean or a lake", 2026-11-13)
 *
 * On a summer board water is ground no mover type enters: every step into a
 * water hex is impassable, road or no road, whatever the rules data says of
 * anything else. It adds no level and bars no sight (one sees across a lake),
 * and since nothing enters it, no unit is set up in it, stands in it or is
 * overrun in it. That is what open water IS, not a cost a ruleset chooses, so
 * `movement` has no entry for it: COVERS, the covers the data prices, is every
 * cover but water, and a ruleset written before water existed compiles a board
 * with water as it stands, with the same terrain hash. Only a season's table
 * (above) may open water, a frozen lake say, by its `lake` and `sea` terms.
 *
 * So that every table a ruleset keys by cover has an answer for every hex,
 * board.coverOf gives a water hex the cover `open` (no cover, no concealment).
 * On a summer board no unit is ever there; on a board whose season's table
 * opens it, a unit on the ice stands in the open. board.waterHex says which
 * hexes are water; anything that names a hex's ground to a player should ask it.
 *
 * TREE SIDES (the map's `trees` layer; the lead's provisional ruling of 2026-11-11)
 *
 * A tree side bars sight as a line does (sight.ts, step 10). A tree hex on open
 * ground is woods to move into and to stand in (board.coverOf, the cost to
 * enter), but its sight height is its level alone: only woods the description
 * itself gives a hex add a level. board.treeHex and board.treeSide say which.
 */
import { Grid, HexId, directionTo, hexCount, neighbourOf, opposite } from './hex';
import {
  COVER_CODES, Cover, MapDescription, SEASONS, Season, coversOf, gridOf, hexOf, levelsOf, ridgeEdgesOf, seasonOf, treeHexesOf, treeSidesOf,
  waterBodiesOf,
} from './map';
import { HillLines, deriveHillLines } from './hillLines';
import { ALL_PAIRS_LIMIT, SightTable, sightContext } from './sight';
import { canonicalJson, contentHash } from './canonical';
import { sha256Text } from './sha256';

/** A cost term for one mover type: a whole number, or null for impassable. */
export type Cost = number | null;
export type CostByMover = Readonly<Record<string, Cost>>;

/** A cover the rules data prices: every cover a map can hold but standing water, which the board closes itself. */
export type LandCover = Exclude<Cover, 'water'>;

/** Every cover the rules data must price, in map.ts order: all a map can hold but standing water. */
export const COVERS: readonly LandCover[] = Object.values(COVER_CODES).filter((c): c is LandCover => c !== 'water');

/** The five movement terms of the cost rule (ruling 6), each keyed by mover type. */
export interface MovementTable {
  readonly road: CostByMover;
  readonly enter: Readonly<Record<LandCover, CostByMover>>;
  readonly climb: CostByMover;
  readonly ridge: CostByMover;
  readonly river: CostByMover;
}

/** A season's movement table (ruling 83): the five terms, whole, and the cost of a step into a lake's water and a sea's. */
export interface SeasonMovement extends MovementTable {
  readonly lake: CostByMover;
  readonly sea: CostByMover;
}

/**
 * The season of a map that names none (map.ts: a summer board). A board of it is compiled with
 * `movement`; a board of any other season with that season's table in `seasons`.
 */
export const BASE_SEASON: Season = seasonOf({});

/** The seasons a terrain table may be given for in `seasons`: every season but the base one, whose table is `movement`. */
export const OTHER_SEASONS: readonly Season[] = SEASONS.filter(s => s !== BASE_SEASON);

/** The part of a ruleset's data that the board compile reads. */
export interface TerrainRules {
  /** Mover type names, in a fixed order (the order of stepCost). */
  readonly moverTypes: readonly string[];
  /** The table of a board of the base season (a map that names no season). */
  readonly movement: MovementTable;
  /** Optional: the table of a board of each other season it names (ruling 83). A board of a season it does not name is refused. */
  readonly seasons?: Readonly<Partial<Record<Season, SeasonMovement>>>;
  readonly sight: {
    readonly coverAddsLevel: Readonly<Record<LandCover, boolean>>;
    readonly crestRule: boolean;
  };
}

/** The content hash of a map: SHA-256 of the canonical JSON of its validated description. */
export function mapHash(map: MapDescription): string {
  return contentHash(map);
}

/** The five terms of a table, and nothing else it holds. */
function tableParts(mv: MovementTable): MovementTable {
  return { road: mv.road, enter: mv.enter, climb: mv.climb, ridge: mv.ridge, river: mv.river };
}

/** Exactly the parts of terrain data that the compile reads, as plain data. Terrain data without `seasons` has the parts (and the hash) it always had. */
function terrainParts(t: TerrainRules): TerrainRules {
  const parts: { -readonly [K in keyof TerrainRules]: TerrainRules[K] } = {
    moverTypes: t.moverTypes,
    movement: tableParts(t.movement),
    sight: { coverAddsLevel: t.sight.coverAddsLevel, crestRule: t.sight.crestRule },
  };
  if (t.seasons !== undefined) {
    const seasons: Partial<Record<Season, SeasonMovement>> = {};
    for (const [s, mv] of Object.entries(t.seasons) as [Season, SeasonMovement | undefined][]) {
      if (mv !== undefined) seasons[s] = { ...tableParts(mv), lake: mv.lake, sea: mv.sea };
    }
    parts.seasons = seasons;
  }
  return parts;
}

/**
 * The table a board of `season` is compiled with: `movement` for the base season, with water closed;
 * the season's own table otherwise, with its `lake` and `sea`. Throws when the terrain data has none.
 */
function tableFor(t: TerrainRules, season: Season, board: string): { mv: MovementTable; lake: CostByMover | null; sea: CostByMover | null } {
  if (season === BASE_SEASON) return { mv: t.movement, lake: null, sea: null };
  const mv = t.seasons?.[season];
  if (mv === undefined) {
    throw new Error(`board ${board}: a ${season} board, and the terrain data has no table for it (seasons.${season}: ruling 83)`);
  }
  return { mv, lake: mv.lake, sea: mv.sea };
}

/**
 * The content hash of terrain data: SHA-256 of the canonical JSON of the parts
 * the compile reads (mover types, the five movement terms, the sight data).
 * Terrain data that differ only in what the compile does not read (a rule
 * written out in words, say) have one hash; any change to what it reads
 * changes the hash.
 */
export function terrainHash(t: TerrainRules): string {
  return contentHash(terrainParts(t));
}

/** How to compile a board. */
export interface CompileOptions {
  /** Build the sight table for all pairs at compile time, or row by row on first use; default by size (ALL_PAIRS_LIMIT). */
  readonly sight?: 'all-pairs' | 'by-row';
}

function costOf(table: CostByMover, mover: string, where: string): Cost {
  if (!Object.prototype.hasOwnProperty.call(table, mover)) throw new Error(`terrain data: ${where} has no cost for mover type '${mover}'`);
  const v = table[mover];
  if (v === undefined) throw new Error(`terrain data: ${where} has no cost for mover type '${mover}'`);
  if (v !== null && (!Number.isInteger(v) || v < 0)) throw new Error(`terrain data: ${where}.${mover} must be a whole number or null, got ${String(v)}`);
  return v;
}

export class CompiledBoard {
  readonly id: string;
  readonly name: string;
  readonly hash: string;
  readonly grid: Grid;
  readonly n: number;
  readonly moverTypes: readonly string[];
  readonly level: Uint8Array;
  /** Sight height: level plus one where the cover adds a level. */
  readonly height: Uint8Array;
  /**
   * The cover of every hex as the rules data prices it: the description's, except that a tree hex
   * on open ground is woods, and standing water (waterHex) is open: no unit is ever in it.
   */
  readonly covers: readonly LandCover[];
  /** The season the board was compiled for: the map's (seasonOf), which chose its movement table. */
  readonly season: Season;
  /** 1 when the hex is standing water: on a summer board no mover type enters it; a season's table may open it (lake, sea). */
  readonly waterHex: Uint8Array;
  /** 1 when the hex is water of a sea (a body of water that touches the board's edge); 0 for a lake's water and for land. */
  readonly seaHex: Uint8Array;
  /** 1 when any of the hex's six sides is a tree side. */
  readonly treeHex: Uint8Array;
  /** treeSide[h * 6 + d] = 1 when the hexside is a tree side. */
  readonly treeSide: Uint8Array;
  /** neighbour[h * 6 + d]: neighbour of h in direction d, or -1 off the board. */
  readonly neighbour: Int32Array;
  /** roadSide[h * 6 + d] = 1 when the hexside is on a road chain. */
  readonly roadSide: Uint8Array;
  /** 1 when the hex is on a road chain. */
  readonly roadHex: Uint8Array;
  /** 1 when the hex is on a river chain. */
  readonly riverHex: Uint8Array;
  /** ridgeSide[h * 6 + d] = 1 when the hexside is a ridge crest edge. */
  readonly ridgeSide: Uint8Array;
  /** Per mover type (by index): the cost of the step from h in direction d at [h * 6 + d], -1 if impassable. */
  readonly stepCost: readonly Int32Array[];
  /** Per mover type: the dearest passable step on this board (at least 1). */
  readonly maxStep: readonly number[];
  readonly hillLines: HillLines;
  readonly sight: SightTable;
  /** The board's own copy of the terrain data it was compiled with (the parts the compile reads). */
  readonly terrain: TerrainRules;
  /** The content hash of that terrain data (terrainHash). */
  readonly terrainHash: string;

  constructor(map: MapDescription, given: TerrainRules, opts: CompileOptions = {}) {
    const g = gridOf(map);
    const n = hexCount(g);
    this.id = map.id;
    this.name = map.name;
    this.hash = mapHash(map);
    this.grid = g;
    this.n = n;
    // Compile from a copy made of the very text that is hashed, so the board and its
    // terrain hash always agree, whatever later happens to the caller's object.
    const text = canonicalJson(terrainParts(given));
    const terrain = JSON.parse(text) as TerrainRules;
    this.terrain = terrain;
    this.terrainHash = sha256Text(text);
    this.moverTypes = terrain.moverTypes.slice();
    if (this.moverTypes.length === 0) throw new Error('terrain data: no mover types');

    const levels = levelsOf(map);
    const givenCovers = coversOf(map);
    this.level = Uint8Array.from(levels);
    this.height = new Uint8Array(n);
    for (let h = 0; h < n; h++) {
      // Sight height comes from the cover the description gives the hex: trees placed as sides
      // bar sight along their sides (sight.ts, step 10) and add no level to a hex.
      const c = givenCovers[h] as Cover;
      // Standing water adds no level: one sees across a lake.
      const adds = c === 'water' ? false : terrain.sight.coverAddsLevel[c];
      if (adds === undefined) throw new Error(`terrain data: sight.coverAddsLevel has no entry for cover '${c}'`);
      this.height[h] = (this.level[h] as number) + (adds ? 1 : 0);
    }
    const sides = treeSidesOf(map);
    this.treeHex = Uint8Array.from(treeHexesOf(map), f => (f ? 1 : 0));
    this.treeSide = new Uint8Array(n * 6);
    // A tree hex on open ground is woods to move into and to stand in.
    this.waterHex = Uint8Array.from(givenCovers, c => (c === 'water' ? 1 : 0));
    this.seaHex = new Uint8Array(n);
    for (const body of waterBodiesOf(map)) if (body.sea) for (const h of body.hexes) this.seaHex[h] = 1;
    const covers: LandCover[] = givenCovers.map((c, h): LandCover => (c === 'water' ? 'open' : c === 'open' && this.treeHex[h] === 1 ? 'woods' : c));
    this.covers = covers;
    this.neighbour = new Int32Array(n * 6);
    for (let h = 0; h < n; h++) for (let d = 0; d < 6; d++) this.neighbour[h * 6 + d] = neighbourOf(g, h, d);

    const markSide = (flags: Uint8Array, a: HexId, b: HexId): void => {
      const d = directionTo(g, a, b);
      if (d < 0) throw new Error(`board ${map.id}: hexes ${a} and ${b} are not neighbours`);
      flags[a * 6 + d] = 1;
      flags[b * 6 + opposite(d)] = 1;
    };
    this.roadSide = new Uint8Array(n * 6);
    this.roadHex = new Uint8Array(n);
    for (const chain of map.roads) {
      const ids = chain.map(label => hexOf(map, label));
      for (let k = 0; k < ids.length; k++) {
        this.roadHex[ids[k] as HexId] = 1;
        if (k > 0) markSide(this.roadSide, ids[k - 1] as HexId, ids[k] as HexId);
      }
    }
    this.riverHex = new Uint8Array(n);
    for (const chain of map.rivers) for (const label of chain) this.riverHex[hexOf(map, label)] = 1;
    const ridges = ridgeEdgesOf(map);
    this.ridgeSide = new Uint8Array(n * 6);
    for (const chain of ridges) for (const [a, b] of chain) markSide(this.ridgeSide, a, b);

    // ---- movement cost per mover type: the table of the board's season (ruling 83) ----
    this.season = seasonOf(map);
    const { mv, lake: lakeTable, sea: seaTable } = tableFor(terrain, this.season, map.id);
    const at = this.season === BASE_SEASON ? 'movement' : `seasons.${this.season}`;
    const stepCost: Int32Array[] = [];
    const maxStep: number[] = [];
    for (const mover of this.moverTypes) {
      const road = costOf(mv.road, mover, `${at}.road`);
      const climb = costOf(mv.climb, mover, `${at}.climb`);
      const ridge = costOf(mv.ridge, mover, `${at}.ridge`);
      const river = costOf(mv.river, mover, `${at}.river`);
      // A step into water: closed on a summer board; the season's lake or sea cost otherwise.
      const lake = lakeTable === null ? null : costOf(lakeTable, mover, `${at}.lake`);
      const sea = seaTable === null ? null : costOf(seaTable, mover, `${at}.sea`);
      const enterBy = new Map<LandCover, Cost>();
      for (const c of COVERS) {
        const table = mv.enter[c];
        if (table === undefined) throw new Error(`terrain data: ${at}.enter has no entry for cover '${c}'`);
        enterBy.set(c, costOf(table, mover, `${at}.enter.${c}`));
      }
      const costs = new Int32Array(n * 6).fill(-1);
      let most = 1;
      for (let a = 0; a < n; a++) {
        for (let d = 0; d < 6; d++) {
          const b = this.neighbour[a * 6 + d] as number;
          if (b < 0) continue;
          let c: Cost;
          if (this.waterHex[b] === 1) {
            c = this.seaHex[b] === 1 ? sea : lake;       // standing water: its own cost alone, closed on a summer board
          } else if (this.roadSide[a * 6 + d] === 1) {
            c = road;
          } else {
            const enter = enterBy.get(covers[b] as LandCover);
            if (enter === undefined) throw new Error(`terrain data: no cost to enter cover '${String(covers[b])}'`);
            c = enter;
            if (c !== null && this.level[a] === 0 && this.level[b] === 2) c = climb === null ? null : c + climb;
            if (c !== null && this.ridgeSide[a * 6 + d] === 1) c = ridge === null ? null : c + ridge;
            if (c !== null && this.riverHex[b] === 1) c = river === null ? null : c + river;
          }
          if (c !== null) {
            if (c < 1) throw new Error(`terrain data: a step for mover type '${mover}' costs ${c}; every passable step must cost at least 1`);
            costs[a * 6 + d] = c;
            if (c > most) most = c;
          }
        }
      }
      stepCost.push(costs);
      maxStep.push(most);
    }
    this.stepCost = stepCost;
    this.maxStep = maxStep;

    // ---- hill lines and sight ----
    this.hillLines = deriveHillLines(g, levels, ridges);
    const lines: (readonly [HexId, HexId])[] = [
      ...this.hillLines.hilltopCrests, ...this.hillLines.ridgeCrests, ...this.hillLines.separators,
    ];
    const allPairs = opts.sight === undefined ? n <= ALL_PAIRS_LIMIT : opts.sight === 'all-pairs';
    for (const t of sides) {
      this.treeSide[t.hex * 6 + t.dir] = 1;
      const other = this.neighbour[t.hex * 6 + t.dir] as number;
      if (other >= 0) this.treeSide[other * 6 + opposite(t.dir)] = 1;
    }
    this.sight = new SightTable(sightContext({
      grid: g, level: this.level, height: this.height, hillLines: lines, crestRule: terrain.sight.crestRule,
      treeSides: sides.map(t => [t.hex, t.dir] as const),
    }), allPairs);
  }

  /** Index of a mover type in moverTypes, or -1. */
  moverIndex(mover: string): number {
    return this.moverTypes.indexOf(mover);
  }

  /** Movement cost from a to the adjacent hex b for a mover type; null when impassable. Throws if they are not adjacent. */
  cost(mover: string | number, a: HexId, b: HexId): number | null {
    const m = typeof mover === 'number' ? mover : this.moverIndex(mover);
    const table = this.stepCost[m];
    if (table === undefined) throw new Error(`board ${this.id}: unknown mover type '${String(mover)}'`);
    const d = directionTo(this.grid, a, b);
    if (d < 0) throw new Error(`board ${this.id}: hexes ${a} and ${b} are not adjacent`);
    const c = table[a * 6 + d] as number;
    return c < 0 ? null : c;
  }

  sees(a: HexId, b: HexId): boolean {
    return this.sight.sees(a, b);
  }

  /** Line of sight when the hexes `blocked` names block too, wherever the line passes through them (smoke: sight.ts). */
  seesPast(a: HexId, b: HexId, blocked: (h: HexId) => boolean): boolean {
    return this.sight.seesPast(a, b, blocked);
  }

  coverOf(h: HexId): LandCover {
    const c = this.covers[h];
    if (c === undefined) throw new Error(`board ${this.id}: no hex ${h}`);
    return c;
  }

  levelOf(h: HexId): number {
    const v = this.level[h];
    if (v === undefined) throw new Error(`board ${this.id}: no hex ${h}`);
    return v;
  }

  /** True when h is a hex of this board. */
  has(h: number): boolean {
    return Number.isInteger(h) && h >= 0 && h < this.n;
  }
}

/** Compile a validated map description with a ruleset's terrain data. */
export function compileBoard(map: MapDescription, terrain: TerrainRules, opts: CompileOptions = {}): CompiledBoard {
  return new CompiledBoard(map, terrain, opts);
}

/**
 * Why a compiled board is not the one expected, or null when it is: the map's
 * id and content hash, and the content hash of the terrain data, must all be
 * the expected ones. The message names what differs and both hashes.
 */
export function boardMismatch(board: CompiledBoard, expect: { readonly mapId: string; readonly mapHash: string; readonly terrainHash: string }): string | null {
  if (board.id !== expect.mapId || board.hash !== expect.mapHash) {
    return `board ${board.id}: compiled from map ${board.id} with content hash ${board.hash}, expected map ${expect.mapId} with content hash ${expect.mapHash}`;
  }
  if (board.terrainHash !== expect.terrainHash) {
    return `board ${board.id}: compiled from terrain data with content hash ${board.terrainHash}, expected terrain data with content hash ${expect.terrainHash}`;
  }
  return null;
}
