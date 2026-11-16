/**
 * The ONE hex module. Every layout fact about the hex grid lives in this file.
 *
 * LAYOUT
 *   Flat-top hexes. Columns run straight up and down; a row steps up, down, up,
 *   down as you go across. Odd columns (0-based) sit half a hex lower.
 *
 * BOARD COORDINATES (the only coordinates the rest of the code may use)
 *   (col, row), 0-based, column 0 at the left, row 0 at the top.
 *   Hex number (HexId): row * cols + col.
 *   Label: four digits, 1-based, column then row. (col 3, row 11) is "0412".
 *
 * WORLD UNITS
 *   1 unit = h = one hex across flats = the distance between the centres of
 *   two hexes that share a side. x runs right, y runs down.
 *     centre x = col * COL_STEP              (COL_STEP = sqrt(3) / 2)
 *     centre y = row + (col odd ? 0.5 : 0)
 *     R (centre to corner) = 1 / sqrt(3)
 *
 * DIRECTIONS (sides), clockwise from north
 *   0 N, 1 NE, 2 SE, 3 S, 4 SW, 5 NW.      opposite(d) = (d + 3) % 6
 *
 * CORNERS, clockwise from east
 *   0 E, 1 SE, 2 SW, 3 W, 4 NW, 5 NE.
 *   Side d joins corners (d + 4) % 6 and (d + 5) % 6.
 *   Corner k is shared with the neighbours in directions (k + 1) % 6 and (k + 2) % 6.
 *
 * Skewed (cube) coordinates exist only inside this file. Nothing is exported
 * that takes or returns them.
 */

export interface Grid {
  readonly cols: number;
  readonly rows: number;
}

export type HexId = number;
export type Dir = 0 | 1 | 2 | 3 | 4 | 5;
export type Corner = 0 | 1 | 2 | 3 | 4 | 5;
export type Point = readonly [x: number, y: number];

export const DIRECTIONS: readonly Dir[] = [0, 1, 2, 3, 4, 5];
export const DIR_NAMES: readonly string[] = ['N', 'NE', 'SE', 'S', 'SW', 'NW'];
export const CORNER_NAMES: readonly string[] = ['E', 'SE', 'SW', 'W', 'NW', 'NE'];

/** Centre-to-corner distance, in world units. */
export const R = 1 / Math.sqrt(3);
/** Horizontal distance between the centres of neighbouring columns. */
export const COL_STEP = Math.sqrt(3) / 2;

/**
 * The standard map sizes (decision M6 in PLAN.md). `half` (added 2026-11-14 for battles at the Patrol
 * level) is half of one of the three mounted boards a standard map is laid on: a board is a third of
 * the standard map's columns (11) by all its rows (21), cut across its middle, so 11 by 10 (the
 * height of 10 rows is the nearest to half the board's, margins counted).
 */
export const MAP_SIZES = {
  half: { cols: 11, rows: 10 },
  small: { cols: 21, rows: 15 },
  standard: { cols: 33, rows: 21 },
  large: { cols: 45, rows: 27 },
} as const;

// ---------------------------------------------------------------------------
// Board coordinates
// ---------------------------------------------------------------------------

export function hexCount(g: Grid): number {
  return g.cols * g.rows;
}

export function inBounds(g: Grid, col: number, row: number): boolean {
  return Number.isInteger(col) && Number.isInteger(row) && col >= 0 && col < g.cols && row >= 0 && row < g.rows;
}

/** Hex number of (col, row). The caller must pass an on-board coordinate. */
export function indexOf(g: Grid, col: number, row: number): HexId {
  return row * g.cols + col;
}

/** Hex number of (col, row), or -1 when it is off the board. */
export function hexAt(g: Grid, col: number, row: number): HexId {
  return inBounds(g, col, row) ? row * g.cols + col : -1;
}

export function colOf(g: Grid, id: HexId): number {
  return id % g.cols;
}

export function rowOf(g: Grid, id: HexId): number {
  return Math.floor(id / g.cols);
}

/** [col, row] of a hex. */
export function coordOf(g: Grid, id: HexId): [number, number] {
  return [id % g.cols, Math.floor(id / g.cols)];
}

function labelDigits(g: Grid): number {
  return Math.max(2, String(Math.max(g.cols, g.rows)).length);
}

/** Printed hex label: column then row, 1-based, zero-padded ("0412"). */
export function labelOf(g: Grid, id: HexId): string {
  const n = labelDigits(g);
  return String(colOf(g, id) + 1).padStart(n, '0') + String(rowOf(g, id) + 1).padStart(n, '0');
}

/** Hex number for a printed label, or -1 if the label is malformed or off the board. */
export function parseLabel(g: Grid, label: string): HexId {
  const n = labelDigits(g);
  if (label.length !== 2 * n || !/^[0-9]+$/.test(label)) return -1;
  const col = Number(label.slice(0, n)) - 1;
  const row = Number(label.slice(n)) - 1;
  return hexAt(g, col, row);
}

// ---------------------------------------------------------------------------
// Neighbours and directions
// ---------------------------------------------------------------------------

/** [dCol, dRow] per direction, for even columns and for odd columns. */
const STEP_EVEN: readonly (readonly [number, number])[] = [
  [0, -1], [1, -1], [1, 0], [0, 1], [-1, 0], [-1, -1],
];
const STEP_ODD: readonly (readonly [number, number])[] = [
  [0, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0],
];

export function opposite(d: number): Dir {
  return ((((d + 3) % 6) + 6) % 6) as Dir;
}

/** Turn a direction by `steps` sixths of a circle (positive = clockwise). */
export function turn(d: number, steps: number): Dir {
  return ((((d + steps) % 6) + 6) % 6) as Dir;
}

/**
 * The coordinate one step from (col, row) in direction d. Works for off-board
 * coordinates too, so a line can be carried on past the board edge.
 */
export function stepAt(col: number, row: number, d: number): [number, number] {
  const step = (col & 1 ? STEP_ODD : STEP_EVEN)[(((d % 6) + 6) % 6)] as readonly [number, number];
  return [col + step[0], row + step[1]];
}

/** The neighbour of a hex in direction d, or -1 when it is off the board. */
export function neighbourOf(g: Grid, id: HexId, d: number): HexId {
  const col = id % g.cols;
  const row = Math.floor(id / g.cols);
  const step = (col & 1 ? STEP_ODD : STEP_EVEN)[(((d % 6) + 6) % 6)] as readonly [number, number];
  return hexAt(g, col + step[0], row + step[1]);
}

/** On-board neighbours of a hex, in direction order. */
export function neighboursOf(g: Grid, id: HexId): HexId[] {
  const out: HexId[] = [];
  for (let d = 0; d < 6; d++) {
    const n = neighbourOf(g, id, d);
    if (n >= 0) out.push(n);
  }
  return out;
}

/** Direction from hex a to the adjacent hex b, or -1 if they are not adjacent. */
export function directionTo(g: Grid, a: HexId, b: HexId): number {
  for (let d = 0; d < 6; d++) {
    if (neighbourOf(g, a, d) === b) return d;
  }
  return -1;
}

export function areAdjacent(g: Grid, a: HexId, b: HexId): boolean {
  return directionTo(g, a, b) >= 0;
}

// ---------------------------------------------------------------------------
// Skewed coordinates (private)
// ---------------------------------------------------------------------------

/** Cube q of a column. */
function cubeQ(col: number): number {
  return col;
}

/** Cube r of (col, row). */
function cubeR(col: number, row: number): number {
  return row - (col - (col & 1)) / 2;
}

function offsetRow(q: number, r: number): number {
  return r + (q - (q & 1)) / 2;
}

/** Round fractional cube coordinates to the nearest hex; returns [col, row]. */
function cubeRound(qf: number, rf: number): [number, number] {
  const sf = -qf - rf;
  let q = Math.round(qf);
  let r = Math.round(rf);
  const s = Math.round(sf);
  const dq = Math.abs(q - qf);
  const dr = Math.abs(r - rf);
  const ds = Math.abs(s - sf);
  if (dq > dr && dq > ds) q = -r - s;
  else if (dr > ds) r = -q - s;
  // Math.round can return -0; normalise so callers never see it.
  q = q + 0;
  r = r + 0;
  return [q, offsetRow(q, r)];
}

// ---------------------------------------------------------------------------
// Distance, rings, lines
// ---------------------------------------------------------------------------

/** Number of hex steps between two hexes. */
export function distance(g: Grid, a: HexId, b: HexId): number {
  const ac = a % g.cols;
  const bc = b % g.cols;
  const dq = cubeQ(ac) - cubeQ(bc);
  const dr = cubeR(ac, Math.floor(a / g.cols)) - cubeR(bc, Math.floor(b / g.cols));
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

/** All on-board hexes within n steps of a hex (including the hex itself). */
export function hexesWithin(g: Grid, id: HexId, n: number): HexId[] {
  const col = id % g.cols;
  const q0 = cubeQ(col);
  const r0 = cubeR(col, Math.floor(id / g.cols));
  const out: HexId[] = [];
  for (let dq = -n; dq <= n; dq++) {
    const lo = Math.max(-n, -dq - n);
    const hi = Math.min(n, -dq + n);
    for (let dr = lo; dr <= hi; dr++) {
      const q = q0 + dq;
      const h = hexAt(g, q, offsetRow(q, r0 + dr));
      if (h >= 0) out.push(h);
    }
  }
  return out;
}

/** All on-board hexes exactly n steps from a hex. */
export function ringOf(g: Grid, id: HexId, n: number): HexId[] {
  if (n === 0) return [id];
  return hexesWithin(g, id, n).filter((h) => distance(g, id, h) === n);
}

/**
 * The hexes a straight line between two hex centres passes through, in order,
 * including both ends. Each step is a list of one hex, or of two hexes when the
 * line runs exactly along the side they share (the caller decides what that
 * means; for sight, such a step blocks only if both hexes block). Off-board
 * hexes are left out, so a step can hold fewer entries near the board edge.
 */
export function lineOf(g: Grid, a: HexId, b: HexId): HexId[][] {
  const ac = a % g.cols;
  const bc = b % g.cols;
  const aq = cubeQ(ac);
  const ar = cubeR(ac, Math.floor(a / g.cols));
  const bq = cubeQ(bc);
  const br = cubeR(bc, Math.floor(b / g.cols));
  const n = (Math.abs(aq - bq) + Math.abs(ar - br) + Math.abs(aq - bq + ar - br)) / 2;
  if (n === 0) return [[a]];
  const out: HexId[][] = [];
  const EQ = 1e-6;
  const ER = 2e-6;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const qf = aq + (bq - aq) * t;
    const rf = ar + (br - ar) * t;
    const [c1, r1] = cubeRound(qf + EQ, rf + ER);
    const [c2, r2] = cubeRound(qf - EQ, rf - ER);
    const h1 = hexAt(g, c1, r1);
    const h2 = hexAt(g, c2, r2);
    const step: HexId[] = [];
    if (h1 >= 0) step.push(h1);
    if (h2 >= 0 && h2 !== h1) step.push(h2);
    if (step.length > 0) out.push(step);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Board edges and symmetry
// ---------------------------------------------------------------------------

/** How many hexes in from the nearest board edge (0 = on the edge). */
export function edgeDistance(g: Grid, id: HexId): number {
  const col = id % g.cols;
  const row = Math.floor(id / g.cols);
  return Math.min(col, g.cols - 1 - col, row, g.rows - 1 - row);
}

export function isBoundary(g: Grid, id: HexId): boolean {
  return edgeDistance(g, id) === 0;
}

export type BoardEdge = 'top' | 'bottom' | 'left' | 'right';

/** Which board edges a hex touches. Top and bottom are the stepped edges. */
export function boardEdgesOf(g: Grid, id: HexId): BoardEdge[] {
  const col = id % g.cols;
  const row = Math.floor(id / g.cols);
  const out: BoardEdge[] = [];
  if (row === 0) out.push('top');
  if (row === g.rows - 1) out.push('bottom');
  if (col === 0) out.push('left');
  if (col === g.cols - 1) out.push('right');
  return out;
}

/** True when a left-right mirror is an exact reflection of the grid (odd column count). */
export function canMirror(g: Grid): boolean {
  return g.cols % 2 === 1;
}

/**
 * Mirror a hex left to right: (col, row) -> (cols - 1 - col, row). Exact (it
 * keeps every adjacency) only when the column count is odd; returns -1 otherwise.
 */
export function mirrorOf(g: Grid, id: HexId): HexId {
  if (!canMirror(g)) return -1;
  return indexOf(g, g.cols - 1 - (id % g.cols), Math.floor(id / g.cols));
}

/** The middle column of a grid with an odd column count (the mirror seam). */
export function seamCol(g: Grid): number {
  return (g.cols - 1) / 2;
}

/** True when a half-turn about the map centre is exact (even column count). */
export function canRotate(g: Grid): boolean {
  return g.cols % 2 === 0;
}

/** Rotate a hex half a turn about the map centre; -1 when that is not exact. */
export function rotateOf(g: Grid, id: HexId): HexId {
  if (!canRotate(g)) return -1;
  return indexOf(g, g.cols - 1 - (id % g.cols), g.rows - 1 - Math.floor(id / g.cols));
}

// ---------------------------------------------------------------------------
// World geometry
// ---------------------------------------------------------------------------

/** Corner offsets from a hex centre, clockwise from east. */
const CORNER_OFFSETS: readonly Point[] = [
  [R, 0], [R / 2, 0.5], [-R / 2, 0.5], [-R, 0], [-R / 2, -0.5], [R / 2, -0.5],
];

/** World position of the centre of (col, row). Works for off-board coordinates too. */
export function centreAt(col: number, row: number): Point {
  return [col * COL_STEP, row + (col & 1 ? 0.5 : 0)];
}

export function centreOf(g: Grid, id: HexId): Point {
  return centreAt(id % g.cols, Math.floor(id / g.cols));
}

/** World position of corner k of a hex. */
export function cornerOf(g: Grid, id: HexId, k: number): Point {
  const [cx, cy] = centreOf(g, id);
  const o = CORNER_OFFSETS[(((k % 6) + 6) % 6)] as Point;
  return [cx + o[0], cy + o[1]];
}

/** The six corners of a hex, clockwise from east. */
export function cornersOf(g: Grid, id: HexId): Point[] {
  const [cx, cy] = centreOf(g, id);
  return CORNER_OFFSETS.map((o) => [cx + o[0], cy + o[1]] as const);
}

/** The two corner indices that side d joins, in clockwise order. */
export function sideCorners(d: number): [Corner, Corner] {
  const dd = ((d % 6) + 6) % 6;
  return [((dd + 4) % 6) as Corner, ((dd + 5) % 6) as Corner];
}

/** The two end points of side d of a hex, in clockwise order. */
export function sideOf(g: Grid, id: HexId, d: number): [Point, Point] {
  const [k1, k2] = sideCorners(d);
  return [cornerOf(g, id, k1), cornerOf(g, id, k2)];
}

/** Midpoint of side d of a hex. This is where roads and streams cross from hex to hex. */
export function sideMidpoint(g: Grid, id: HexId, d: number): Point {
  const [p, q] = sideOf(g, id, d);
  return [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
}

/** The hex containing a world point, as [col, row]. May be off the board. */
export function worldToCoord(x: number, y: number): [number, number] {
  const qf = x / COL_STEP;
  const rf = y - qf / 2;
  return cubeRound(qf, rf);
}

/** The hex containing a world point, or -1 when the point is off the board. */
export function worldToHex(g: Grid, x: number, y: number): HexId {
  const [col, row] = worldToCoord(x, y);
  return hexAt(g, col, row);
}

/** Bounding box of the whole grid in world units: [minX, minY, maxX, maxY]. */
export function worldBounds(g: Grid): [number, number, number, number] {
  return [-R, -0.5, (g.cols - 1) * COL_STEP + R, g.rows - 0.5 + (g.cols > 1 ? 0.5 : 0)];
}

// ---------------------------------------------------------------------------
// Canonical keys for sides and corners
// ---------------------------------------------------------------------------

/**
 * A number that identifies a hexside, the same whichever of its two hexes you
 * ask. The owner is the hex for which the side faces N, NE or SE; at the board
 * edge, where that hex does not exist, the on-board hex owns it.
 */
export function sideKey(g: Grid, id: HexId, d: number): number {
  const dd = ((d % 6) + 6) % 6;
  if (dd < 3) return id * 6 + dd;
  const n = neighbourOf(g, id, dd);
  return n >= 0 ? n * 6 + (dd - 3) : id * 6 + dd;
}

/** The hex and direction a side key stands for. */
export function sideFromKey(key: number): [id: HexId, d: Dir] {
  return [Math.floor(key / 6), (key % 6) as Dir];
}

/**
 * A number that identifies a hex corner, the same whichever of the (up to
 * three) hexes around it you ask: the smallest of id * 6 + corner over the
 * on-board hexes that share the point.
 */
export function cornerKey(g: Grid, id: HexId, k: number): number {
  const kk = ((k % 6) + 6) % 6;
  let key = id * 6 + kk;
  const n1 = neighbourOf(g, id, (kk + 1) % 6);
  if (n1 >= 0) key = Math.min(key, n1 * 6 + ((kk + 2) % 6));
  const n2 = neighbourOf(g, id, (kk + 2) % 6);
  if (n2 >= 0) key = Math.min(key, n2 * 6 + ((kk + 4) % 6));
  return key;
}

/**
 * The two corners at the ends of the hexside between adjacent hexes a and b,
 * as corner keys; null when a and b are not adjacent. Two hexsides meet end to
 * end exactly when they share one of these.
 */
export function sideEndKeys(g: Grid, a: HexId, b: HexId): [number, number] | null {
  const d = directionTo(g, a, b);
  if (d < 0) return null;
  const [k1, k2] = sideCorners(d);
  return [cornerKey(g, a, k1), cornerKey(g, a, k2)];
}
