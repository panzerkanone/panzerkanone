/**
 * Where the boards lie: three mounted boards side by side, the printed sheet on
 * each, the joints between them and the table top under them; or, for a map no
 * wider than one board (a half board, 11 x 10, for a battle at the Patrol level),
 * one mounted board on its own. Plain arithmetic, no browser.
 *
 * A mounted board (ruling 32) is a baseboard wrapped in covering paper with the
 * printed sheet glued on its top face. The sheet is cut a little short of the
 * board's edge on every side, so the wrap shows as a border all round it; two
 * boards do not quite touch, so there is a gap at each joint. Nothing printed
 * moves: the map is one picture, and the strip that two borders and a gap take
 * up at a joint is simply not printed.
 *
 * Board frame (docs/bars/M4a.md, Terms): x and y are the world coordinates of
 * engine/core/hex.ts in h (x right, y down the board); z is height in h above
 * the printed surface, so the boards' tops are the plane z = 0 and the table top
 * is z = -THICKNESS.
 *
 * Nothing here knows the hex layout: the caller hands in the board rectangle
 * (`worldBounds(grid)`) and the x of a column's centres (`centreAt(col, 0)[0]`).
 */

/** x0, y0, x1, y1 in h. */
export type Rect = readonly [x0: number, y0: number, x1: number, y1: number];

/** Unprinted stock round the map's rectangle, on the outer sides only (ruling 18). It is part of the sheet. */
export const MARGIN = 0.4;
/** A board's thickness: the table top is this far under the printed surface. */
export const THICKNESS = 0.16;
/** Radius of the small rounded bottom edge (the former construction's). */
export const BOTTOM_BEVEL = 0.012;
/** Radius of a mounted board's top arris: a hard core under paper, so crisp. Never more than 0.4 of the border. */
export const TOP_BEVEL = 0.007;
/** Radius of a mounted board's bottom arris: as hard as the top one, a little eased by the table. */
export const MOUNT_BOTTOM_BEVEL = 0.008;

/** The former construction (one sheet scored into three, printed to its edge): kept for comparison only. */
export const OLD_CORNER_RADIUS = 0.225;
export const OLD_RIM_WIDTH = 0.06;
export const OLD_GROOVE_WIDTH = 0.02;
export const OLD_TOP_BEVEL = 0.028;

export type Construction = 'mounted' | 'old';

/** The dials of the mounted boards' shape, in h. Chosen by looking (ruling 32). */
export interface MountDials {
  /** `old` draws the first build's board: one outline, the white margin to the edge, a groove at each seam. */
  construction: Construction;
  /** How far the sheet is cut short of the board's edge: the width of wrap that shows round it. */
  border: number;
  /** The space between two boards. */
  gap: number;
  /** Radius of each board's four corners. The sheet's corners follow, one border further in. */
  cornerRadius: number;
}

export const DEFAULT_MOUNT: MountDials = { construction: 'mounted', border: 0.055, gap: 0.025, cornerRadius: 0.24 };

/** The limits a dial is held to, so that a board always has a sheet, a border and four corners. */
export function clampMount(m: MountDials): MountDials {
  const hold = (v: number, lo: number, hi: number, otherwise: number): number => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : otherwise);
  const border = hold(m.border, 0.01, 0.3, DEFAULT_MOUNT.border);
  return {
    construction: m.construction === 'old' ? 'old' : 'mounted',
    border,
    gap: hold(m.gap, 0, 0.3, DEFAULT_MOUNT.gap),
    // A corner never reaches the map's rectangle: its radius stays within the margin and the border.
    cornerRadius: hold(m.cornerRadius, border + 0.01, MARGIN + border, Math.min(MARGIN + border, Math.max(border + 0.01, DEFAULT_MOUNT.cornerRadius))),
  };
}

export interface BoardLayout {
  /** The map's rectangle: `worldBounds(grid)`. */
  board: Rect;
  construction: Construction;
  /**
   * The boards, left to right: three, or one for a map no wider than a board
   * (`boardsAcross`). Mounted: each ends half a gap short of a joint's seam line,
   * and one border beyond the sheet on the outer sides. (In the former
   * construction they touch at the seams.)
   */
  slabs: Rect[];
  /** The printed sheet on each board: the board's rectangle inset by the border on all four sides. */
  sheets: Rect[];
  /** The rectangle that holds the boards. */
  outline: Rect;
  /** x of each seam line: the middle of each joint (none for one board). */
  seams: number[];
  margin: number;
  /** Width of wrap that shows round a sheet (0 in the former construction). */
  border: number;
  /** The space between two boards (0 in the former construction). */
  gap: number;
  /** Radius of each board's corners. */
  cornerRadius: number;
  /** Radius of each sheet's corners. */
  sheetCornerRadius: number;
  thickness: number;
  /** Radius of the rounded top arris. */
  topBevel: number;
  /** How far in from a board's edge its wear reaches: the border (formerly the worn rim of the margin). */
  rimWidth: number;
  /** The width of the dark line at a joint: the gap (formerly the groove's width at half depth). */
  grooveWidth: number;
  /** The table top: a rectangle at height z. */
  table: { rect: Rect; z: number };
}

/** First column of the second and of the third board: floor(cols / 3) and floor(2 cols / 3). */
export function slabColumns(cols: number): [number, number] {
  return [Math.floor(cols / 3), Math.floor((2 * cols) / 3)];
}

/** The columns of one mounted board of the standard map (33 columns on three boards). */
export const BOARD_COLS = 11;

/** The rows of one mounted board of the standard map. */
export const BOARD_ROWS = 21;

/**
 * How many mounted boards the table lays a map on: one when the map fits on one board (a half board,
 * 11 x 10, is half of one, cut across), else three. The layout itself makes three unless told (the
 * slab rule of bar M4a-06 holds for every board it is asked for).
 */
export function boardsAcross(grid: { cols: number; rows: number }): 1 | 3 {
  return grid.cols <= BOARD_COLS && grid.rows <= BOARD_ROWS ? 1 : 3;
}

/** The most boards a layout has: the shaders hold this many. */
export const MAX_BOARDS = 3;
/** Where a board the shaders hold but the layout has not is put: far off the table, where it touches nothing. */
const PARKED: Rect = [1e4, 1e4, 1e4 + 1, 1e4 + 1];

/**
 * The boards, the sheets and the two seams as the shaders hold them (always three boards and two
 * seams): a layout of one board has the other two parked far off the table and both seams beyond it,
 * so that every point of the table belongs to the one board and no joint is drawn.
 */
export function boardsForShaders(layout: BoardLayout): { boards: Rect[]; sheets: Rect[]; seams: [number, number] } {
  const boards = Array.from({ length: MAX_BOARDS }, (_, k) => layout.slabs[k] ?? PARKED);
  const sheets = Array.from({ length: MAX_BOARDS }, (_, k) => layout.sheets[k] ?? PARKED);
  return { boards, sheets, seams: [layout.seams[0] ?? PARKED[0], layout.seams[1] ?? PARKED[0]] };
}

/** The table top for a board: wide enough for every view the camera limits allow (see camera.ts). */
export function tableRect(board: Rect, small = false): Rect {
  const w = board[2] - board[0];
  const h = board[3] - board[1];
  // The planted fault `smalltable` cuts it to the board rectangle grown by 1 h.
  const grow = small ? 1 : Math.max(30, 2.5 * Math.max(w, h));
  return [board[0] - grow, board[1] - grow, board[2] + grow, board[3] + grow];
}

/**
 * Lay the boards out. `colX(col)` is the x of the centres of a column. A seam is
 * the straight line midway between two column centres (the bar's slab rule); a
 * joint's gap is centred on it. With `boards` 1, the map lies on one board of its own.
 */
export function layoutBoard(board: Rect, cols: number, colX: (col: number) => number, smallTable = false, dials: MountDials = DEFAULT_MOUNT, boards: 1 | 3 = 3): BoardLayout {
  if (boards === 1) return layoutOneBoard(board, smallTable, dials);
  const [b1, b2] = slabColumns(cols);
  const s1 = (colX(b1 - 1) + colX(b1)) / 2;
  const s2 = (colX(b2 - 1) + colX(b2)) / 2;
  const [x0, y0, x1, y1] = board;
  // The sheets together, were there no joints: the map's rectangle and its margin.
  const left = x0 - MARGIN;
  const right = x1 + MARGIN;
  const top = y0 - MARGIN;
  const bottom = y1 + MARGIN;
  const table = { rect: tableRect(board, smallTable), z: -THICKNESS };
  if (dials.construction === 'old') {
    const slabs: [Rect, Rect, Rect] = [
      [left, top, s1, bottom],
      [s1, top, s2, bottom],
      [s2, top, right, bottom],
    ];
    return {
      board,
      construction: 'old',
      slabs,
      sheets: slabs,
      outline: [left, top, right, bottom],
      seams: [s1, s2],
      margin: MARGIN,
      border: 0,
      gap: 0,
      cornerRadius: OLD_CORNER_RADIUS,
      sheetCornerRadius: OLD_CORNER_RADIUS,
      thickness: THICKNESS,
      topBevel: OLD_TOP_BEVEL,
      rimWidth: OLD_RIM_WIDTH,
      grooveWidth: OLD_GROOVE_WIDTH,
      table,
    };
  }
  const m = clampMount(dials);
  const b = m.border;
  const g = m.gap / 2;
  const slabs: [Rect, Rect, Rect] = [
    [left - b, top - b, s1 - g, bottom + b],
    [s1 + g, top - b, s2 - g, bottom + b],
    [s2 + g, top - b, right + b, bottom + b],
  ];
  const inset = (r: Rect): Rect => [r[0] + b, r[1] + b, r[2] - b, r[3] - b];
  return {
    board,
    construction: 'mounted',
    slabs,
    sheets: [inset(slabs[0]), inset(slabs[1]), inset(slabs[2])],
    outline: [left - b, top - b, right + b, bottom + b],
    seams: [s1, s2],
    margin: MARGIN,
    border: b,
    gap: m.gap,
    cornerRadius: m.cornerRadius,
    sheetCornerRadius: m.cornerRadius - b,
    thickness: THICKNESS,
    topBevel: Math.min(TOP_BEVEL, 0.4 * b),
    rimWidth: b,
    grooveWidth: m.gap,
    table,
  };
}

/**
 * One mounted board on its own, made as each of the three is: the map's rectangle and its margin is
 * the printed sheet, the wrap shows one border beyond it all round, and there is no joint.
 */
function layoutOneBoard(board: Rect, smallTable: boolean, dials: MountDials): BoardLayout {
  const [x0, y0, x1, y1] = board;
  const sheet: Rect = [x0 - MARGIN, y0 - MARGIN, x1 + MARGIN, y1 + MARGIN];
  const table = { rect: tableRect(board, smallTable), z: -THICKNESS };
  if (dials.construction === 'old') {
    return {
      board, construction: 'old', slabs: [sheet], sheets: [sheet], outline: sheet, seams: [], margin: MARGIN, border: 0, gap: 0,
      cornerRadius: OLD_CORNER_RADIUS, sheetCornerRadius: OLD_CORNER_RADIUS, thickness: THICKNESS, topBevel: OLD_TOP_BEVEL,
      rimWidth: OLD_RIM_WIDTH, grooveWidth: OLD_GROOVE_WIDTH, table,
    };
  }
  const m = clampMount(dials);
  const b = m.border;
  const slab: Rect = [sheet[0] - b, sheet[1] - b, sheet[2] + b, sheet[3] + b];
  return {
    board,
    construction: 'mounted',
    slabs: [slab],
    sheets: [sheet],
    outline: slab,
    seams: [],
    margin: MARGIN,
    border: b,
    gap: m.gap,
    cornerRadius: m.cornerRadius,
    sheetCornerRadius: m.cornerRadius - b,
    thickness: THICKNESS,
    topBevel: Math.min(TOP_BEVEL, 0.4 * b),
    rimWidth: b,
    grooveWidth: m.gap,
    table,
  };
}

/** Signed distance from a point to a rounded rectangle (negative inside). */
export function roundRectDistance(x: number, y: number, rect: Rect, radius: number): number {
  const cx = (rect[0] + rect[2]) / 2;
  const cy = (rect[1] + rect[3]) / 2;
  const qx = Math.abs(x - cx) - (rect[2] - rect[0]) / 2 + radius;
  const qy = Math.abs(y - cy) - (rect[3] - rect[1]) / 2 + radius;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - radius;
}

/**
 * The board whose ground a point is, by the slab rule alone (0, 1 or 2): left of
 * the first seam, between the seams, right of the second (0 on a layout of one
 * board). A point on a seam goes right. -1 outside the outline's rectangle. It
 * takes no notice of borders and gaps: a point in a gap still belongs to the
 * board on its side of the seam.
 */
export function slabAt(layout: BoardLayout, x: number, y: number): number {
  const o = layout.outline;
  if (x < o[0] || x > o[2] || y < o[1] || y > o[3]) return -1;
  let k = 0;
  while (k < layout.seams.length && x >= (layout.seams[k] as number)) k++;
  return k;
}

/** What lies at a point of the board plane: a printed sheet, a board's wrap, a gap between two boards, or the table. */
export type Ground = 'sheet' | 'border' | 'gap' | 'table';

/**
 * What a point of the plane z = 0 shows, and on which board (0, 1 or 2; -1 for a
 * gap or the table). A gap is the space between two boards along their facing
 * sides; the notches that rounded corners leave, and everything beyond the
 * outline, are table. The former construction has sheet and table only.
 */
export function groundAt(layout: BoardLayout, x: number, y: number): { ground: Ground; slab: number } {
  if (layout.construction === 'old') {
    // The slabs touch: only the outline's four corners are rounded.
    if (roundRectDistance(x, y, layout.outline, layout.cornerRadius) <= 0) return { ground: 'sheet', slab: slabAt(layout, x, y) };
    return { ground: 'table', slab: -1 };
  }
  for (let k = 0; k < layout.slabs.length; k++) {
    if (roundRectDistance(x, y, layout.slabs[k] as Rect, layout.cornerRadius) <= 0) {
      return { ground: roundRectDistance(x, y, layout.sheets[k] as Rect, layout.sheetCornerRadius) <= 0 ? 'sheet' : 'border', slab: k };
    }
  }
  const o = layout.outline;
  const inJoint = layout.seams.some(s => Math.abs(x - s) < layout.gap / 2);
  return { ground: inJoint && y > o[1] && y < o[3] ? 'gap' : 'table', slab: -1 };
}

/** Whether a point of the plane z = 0 is on a board (its sheet or its wrap). */
export function onBoards(layout: BoardLayout, x: number, y: number): boolean {
  const g = groundAt(layout, x, y).ground;
  return g === 'sheet' || g === 'border';
}

export function inRect(x: number, y: number, r: Rect): boolean {
  return x >= r[0] && x <= r[2] && y >= r[1] && y <= r[3];
}
