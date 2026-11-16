/**
 * The geometry of the grid ink overlay: what the board's shader needs to find
 * the hex under a pixel, and where the hex numbers and the margin's rulers sit.
 * Plain arithmetic, no browser.
 *
 * No hex fact is written here. Every number comes from calls into the hex
 * module (engine/core/hex.ts), which the caller hands in: the shader gets the
 * grid as two rectangular lattices of hex centres (the even columns and the odd
 * columns) and the three steps from a centre to its neighbours, all read off
 * `centreAt`.
 */
import type { Point } from './camera';
import type { Rect } from './layout';

/** The one function of the hex module this file needs. */
export interface HexCentres {
  centreAt(col: number, row: number): readonly [number, number];
}

export interface GridGeometry {
  /** Centre of hex (0, 0). */
  origin: Point;
  /** The lattice of one parity of columns: its period along x (two columns) and along y (one row). */
  cell: Point;
  /** From a centre of an even column to the nearest centre of the next (odd) column. */
  odd: Point;
  /** From a centre to three of its neighbours; the other three are these reversed. A hexside is the line midway. */
  steps: [Point, Point, Point];
  /** Centre to the middle of a side. */
  apothem: number;
}

export function gridGeometry(hex: HexCentres): GridGeometry {
  const o = hex.centreAt(0, 0);
  const sub = (p: readonly [number, number]): Point => [p[0] - o[0], p[1] - o[1]];
  const down = sub(hex.centreAt(0, 1));
  const east = sub(hex.centreAt(1, 0));
  const north = sub(hex.centreAt(1, -1));
  return {
    origin: [o[0], o[1]],
    cell: [sub(hex.centreAt(2, 0))[0], down[1]],
    odd: east,
    steps: [down, east, north],
    apothem: Math.hypot(down[0], down[1]) / 2,
  };
}

/**
 * The hex whose centre is nearest a point, as [col, row] (it may be off the
 * board). This is the board shader's own arithmetic, written out here so that
 * tests/scene can hold it against the hex module: the nearer of the nearest
 * centre in the even columns' lattice and in the odd columns'.
 */
export function nearestHex(g: GridGeometry, x: number, y: number): [number, number] {
  const qx = x - g.origin[0];
  const qy = y - g.origin[1];
  const ia = Math.floor(qx / g.cell[0] + 0.5);
  const ja = Math.floor(qy / g.cell[1] + 0.5);
  const dax = qx - ia * g.cell[0];
  const day = qy - ja * g.cell[1];
  const ib = Math.floor((qx - g.odd[0]) / g.cell[0] + 0.5);
  const jb = Math.floor((qy - g.odd[1]) / g.cell[1] + 0.5);
  const dbx = qx - g.odd[0] - ib * g.cell[0];
  const dby = qy - g.odd[1] - jb * g.cell[1];
  return dax * dax + day * day <= dbx * dbx + dby * dby ? [2 * ia, ja] : [2 * ib + 1, jb];
}

// ---------------------------------------------------------------------------
// Hex numbers
// ---------------------------------------------------------------------------

/** Height of a hex number's digits, in h. */
export const LABEL_HEIGHT = 0.125;
/** A digit's cell is this wide for a height of 1. */
export const DIGIT_ASPECT = 0.6;
/** Gap between a hex's top side and the top of its number. */
export const LABEL_GAP = 0.065;
/** A label's published box is its four digit cells grown by this much, for the soft edge of the ink. */
export const LABEL_PAD = 0.012;
/** Digits in a hex number: two for the column, two for the row. */
export const LABEL_DIGITS = 4;

/** The four digit cells of a hex's number: x0, y0, x1, y1 in h. */
export function labelCells(g: GridGeometry, centre: readonly [number, number]): Rect {
  const w = LABEL_DIGITS * DIGIT_ASPECT * LABEL_HEIGHT;
  const top = centre[1] - g.apothem + LABEL_GAP;
  return [centre[0] - w / 2, top, centre[0] + w / 2, top + LABEL_HEIGHT];
}

/** The box a hex's number is drawn inside, as four board points: top left, top right, bottom right, bottom left. */
export function labelBox(g: GridGeometry, centre: readonly [number, number]): [Point, Point, Point, Point] {
  const [x0, y0, x1, y1] = labelCells(g, centre);
  return [
    [x0 - LABEL_PAD, y0 - LABEL_PAD],
    [x1 + LABEL_PAD, y0 - LABEL_PAD],
    [x1 + LABEL_PAD, y1 + LABEL_PAD],
    [x0 - LABEL_PAD, y1 + LABEL_PAD],
  ];
}

// ---------------------------------------------------------------------------
// Rulers in the margin (ruling 18; PLAN V9)
// ---------------------------------------------------------------------------

/** Height of a ruler number's digits, in h. */
export const RULER_HEIGHT = 0.19;
/** Digits in a ruler number. */
export const RULER_DIGITS = 2;

export interface RulerNumber {
  edge: 'top' | 'bottom' | 'left' | 'right';
  /** The column or the row it numbers, 0-based. */
  index: number;
  text: string;
  centre: Point;
  /** Its digit cells: x0, y0, x1, y1. */
  box: Rect;
}

/**
 * Every ruler number of a board: a column's two digits in the top and the bottom
 * margin at the column's x; a row's two digits in the left and the right margin
 * at that row's y in the column beside it. `label(col, row)` is the hex module's
 * four-digit label, from which the digits are cut.
 */
export function rulerNumbers(hex: HexCentres, cols: number, rows: number, board: Rect, margin: number, label: (col: number, row: number) => string): RulerNumber[] {
  const out: RulerNumber[] = [];
  const w = RULER_DIGITS * DIGIT_ASPECT * RULER_HEIGHT;
  const box = (c: Point): Rect => [c[0] - w / 2, c[1] - RULER_HEIGHT / 2, c[0] + w / 2, c[1] + RULER_HEIGHT / 2];
  const half = label(0, 0).length / 2;
  for (let col = 0; col < cols; col++) {
    const x = hex.centreAt(col, 0)[0];
    const text = label(col, 0).slice(0, half);
    for (const edge of ['top', 'bottom'] as const) {
      const centre: Point = [x, edge === 'top' ? board[1] - margin / 2 : board[3] + margin / 2];
      out.push({ edge, index: col, text, centre, box: box(centre) });
    }
  }
  for (let row = 0; row < rows; row++) {
    const text = label(0, row).slice(half);
    for (const edge of ['left', 'right'] as const) {
      const y = hex.centreAt(edge === 'left' ? 0 : cols - 1, row)[1];
      const centre: Point = [edge === 'left' ? board[0] - margin / 2 : board[2] + margin / 2, y];
      out.push({ edge, index: row, text, centre, box: box(centre) });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Line weights
// ---------------------------------------------------------------------------

/** Width of a grid line on the board, in h: a fine printed line. It is never drawn thinner than MIN_LINE_PX. */
export const LINE_WIDTH = 0.012;
/** The least width of a grid line on screen, in device pixels (ruling 7: never thinner than one pixel). */
export const MIN_LINE_PX = 1.2;
/** Width of the frame line round the map's rectangle, in h; it lies in the margin, against the map. */
export const FRAME_WIDTH = 0.012;
/** The least width of the frame line on screen, in device pixels. */
export const MIN_FRAME_PX = 1.2;
