/**
 * Which level of the baked map a view shows, and which of its tiles. Plain
 * arithmetic, no browser.
 *
 * The rule (docs/bars/M4a.md, M4a-08): V is the part of the board rectangle the
 * frame shows. s is the smallest level whose pixels per h are at least 0.8 times
 * the largest screen density over V (2 if none is). A level fits when the tiles
 * of it that meet V, times one tile's megapixels, come to at most the store's
 * cap. The level shown is s if s is 0 or fits, else the largest level below s
 * that is 0 or fits. So the tiles in view always fit the store, and nothing stays
 * on magnified coarse art while sharper tiles would fit.
 *
 * The numbers of the bake worker (client/src/bake/protocol.ts) are repeated here
 * so that this file needs no browser type; the page checks them against the
 * worker's at start-up and tests/scene checks them against that file's text.
 */
import { density, toClip } from './camera';
import type { Point } from './camera';
import type { Rect } from './layout';

export type Level = 0 | 1 | 2;

/** A tile of levels 1 and 2 is this many level pixels on a side. */
export const TILE = 1024;
/** Level pixels per h of levels 1 and 2; level 0's comes down on a large board. */
export const LEVEL_PX = [128, 256, 512] as const;
/** Level 0 holds the whole board in at most this many pixels. */
export const LEVEL0_MAX_PIXELS = 24_000_000;
/**
 * Each tile is baked with this many extra pixels on every side that the board
 * has room for, so that filtering at a tile's edge reads its neighbour's art
 * and no line shows between tiles in a tilted view.
 */
export const GUTTER = 2;
/** At most this many tiles are kept. */
export const TILE_CAP = 48;
/** One tile with its gutters, in megapixels (a megapixel is a million pixels). */
export const TILE_MEGAPIXELS = ((TILE + 2 * GUTTER) * (TILE + 2 * GUTTER)) / 1e6;
/** The store's cap: TILE_CAP tiles with their gutters. */
export const CAP_MEGAPIXELS = TILE_CAP * TILE_MEGAPIXELS;
/** A level is sharp enough when it has this many of its pixels to a screen pixel (PLAN 6.3). */
export const SHARP = 0.8;

/** Level-0 pixels per h of a board: 128 when the whole board comes to at most LEVEL0_MAX_PIXELS, else 64, else 32. */
export function level0PxPerHex(board: Rect): number {
  for (const ppx of [128, 64]) {
    const [w, h] = levelSize(board, ppx);
    if (w * h <= LEVEL0_MAX_PIXELS) return ppx;
  }
  return 32;
}

/** Board size in level pixels at a resolution. */
export function levelSize(board: Rect, pxPerHex: number): [number, number] {
  return [Math.ceil((board[2] - board[0]) * pxPerHex - 1e-6), Math.ceil((board[3] - board[1]) * pxPerHex - 1e-6)];
}

/** Level pixels per h of the three levels on a board. */
export function levelDensities(board: Rect): [number, number, number] {
  return [level0PxPerHex(board), LEVEL_PX[1], LEVEL_PX[2]];
}

export function tileKey(level: Level, i: number, j: number): string {
  return `${level}:${i}:${j}`;
}

export function parseTileKey(key: string): { level: Level; i: number; j: number } {
  const [l, i, j] = key.split(':').map(Number) as [number, number, number];
  return { level: l as Level, i, j };
}

/** A tile's rectangle in level pixels: x, y, width, height. Tiles at the right and bottom edges are smaller. */
export function tilePixels(board: Rect, pxPerHex: number, i: number, j: number): [number, number, number, number] {
  const [w, h] = levelSize(board, pxPerHex);
  const x = i * TILE;
  const y = j * TILE;
  return [x, y, Math.min(TILE, w - x), Math.min(TILE, h - y)];
}

/** The same tile grown by its gutters where the level has pixels for them: what is baked and held. */
export function tilePixelsWithGutter(board: Rect, pxPerHex: number, i: number, j: number): [number, number, number, number] {
  const [w, h] = levelSize(board, pxPerHex);
  const [x, y, tw, th] = tilePixels(board, pxPerHex, i, j);
  const x0 = Math.max(0, x - GUTTER);
  const y0 = Math.max(0, y - GUTTER);
  const x1 = Math.min(w, x + tw + GUTTER);
  const y1 = Math.min(h, y + th + GUTTER);
  return [x0, y0, x1 - x0, y1 - y0];
}

/** A tile's rectangle on the board, in h, cut to the board rectangle. */
export function tileRect(board: Rect, pxPerHex: number, i: number, j: number): Rect {
  const [x, y, w, h] = tilePixels(board, pxPerHex, i, j);
  return [board[0] + x / pxPerHex, board[1] + y / pxPerHex, Math.min(board[2], board[0] + (x + w) / pxPerHex), Math.min(board[3], board[1] + (y + h) / pxPerHex)];
}

// ---------------------------------------------------------------------------
// The part of the board in view
// ---------------------------------------------------------------------------

interface ClipVertex {
  x: number;
  y: number;
  c: [number, number, number, number];
}

/**
 * V: the part of the board rectangle (on the plane z = 0) that the frame shows,
 * as a convex polygon; empty when none of it is in the frame. The rectangle is
 * cut in clip space against the four sides of the frame, where a point of the
 * plane and its clip coordinates go together in a straight line.
 */
export function visibleBoard(viewProj: readonly number[], board: Rect): Point[] {
  let poly: ClipVertex[] = ([[board[0], board[1]], [board[2], board[1]], [board[2], board[3]], [board[0], board[3]]] as const).map(([x, y]) => ({ x, y, c: toClip(viewProj, x, y, 0) }));
  // Inside each plane: w + x >= 0, w - x >= 0, w + y >= 0, w - y >= 0, and in front of the camera.
  const planes: ((c: readonly number[]) => number)[] = [
    c => (c[3] as number) - 1e-9,
    c => (c[3] as number) + (c[0] as number),
    c => (c[3] as number) - (c[0] as number),
    c => (c[3] as number) + (c[1] as number),
    c => (c[3] as number) - (c[1] as number),
  ];
  for (const side of planes) {
    const out: ClipVertex[] = [];
    for (let k = 0; k < poly.length; k++) {
      const a = poly[k] as ClipVertex;
      const b = poly[(k + 1) % poly.length] as ClipVertex;
      const da = side(a.c);
      const db = side(b.c);
      if (da >= 0) out.push(a);
      if ((da >= 0) !== (db >= 0)) {
        const t = da / (da - db);
        out.push({
          x: a.x + (b.x - a.x) * t,
          y: a.y + (b.y - a.y) * t,
          c: [a.c[0] + (b.c[0] - a.c[0]) * t, a.c[1] + (b.c[1] - a.c[1]) * t, a.c[2] + (b.c[2] - a.c[2]) * t, a.c[3] + (b.c[3] - a.c[3]) * t],
        });
      }
    }
    poly = out;
    if (poly.length === 0) return [];
  }
  return poly.map(v => [v.x, v.y] as Point);
}

function polygonArea(poly: readonly Point[]): number {
  let a = 0;
  for (let k = 0; k < poly.length; k++) {
    const p = poly[k] as Point;
    const q = poly[(k + 1) % poly.length] as Point;
    a += p[0] * q[1] - q[0] * p[1];
  }
  return Math.abs(a) / 2;
}

/** A convex polygon cut to a rectangle. */
function clipToRect(poly: readonly Point[], r: Rect): Point[] {
  let cur: Point[] = poly.map(p => [p[0], p[1]]);
  const sides: [number, number, number][] = [
    [1, 0, -r[0]],
    [-1, 0, r[2]],
    [0, 1, -r[1]],
    [0, -1, r[3]],
  ];
  for (const [nx, ny, off] of sides) {
    const out: Point[] = [];
    for (let k = 0; k < cur.length; k++) {
      const a = cur[k] as Point;
      const b = cur[(k + 1) % cur.length] as Point;
      const da = nx * a[0] + ny * a[1] + off;
      const db = nx * b[0] + ny * b[1] + off;
      if (da >= 0) out.push(a);
      if ((da >= 0) !== (db >= 0)) {
        const t = da / (da - db);
        out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      }
    }
    cur = out;
    if (cur.length === 0) return [];
  }
  return cur;
}

/**
 * The largest screen density over V, in device pixels per h. Over a convex piece
 * of the plane the density is largest at a corner (it grows toward the camera
 * along every straight line; tests/scene checks that against a dense sampling),
 * so the corners of V are enough.
 */
export function largestDensity(viewProj: readonly number[], device: readonly [number, number], v: readonly Point[]): number {
  let d = 0;
  for (const p of v) d = Math.max(d, density(viewProj, device, p[0], p[1]));
  return d;
}

/** need(L): the tiles of a level that meet V, as [i, j] pairs, row by row. */
export function tilesMeeting(v: readonly Point[], board: Rect, pxPerHex: number): [number, number][] {
  if (v.length < 3) return [];
  const [lw, lh] = levelSize(board, pxPerHex);
  const nx = Math.ceil(lw / TILE);
  const ny = Math.ceil(lh / TILE);
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of v) {
    x0 = Math.min(x0, p[0]);
    x1 = Math.max(x1, p[0]);
    y0 = Math.min(y0, p[1]);
    y1 = Math.max(y1, p[1]);
  }
  const span = TILE / pxPerHex;
  const i0 = Math.max(0, Math.floor((x0 - board[0]) / span) - 1);
  const i1 = Math.min(nx - 1, Math.floor((x1 - board[0]) / span) + 1);
  const j0 = Math.max(0, Math.floor((y0 - board[1]) / span) - 1);
  const j1 = Math.min(ny - 1, Math.floor((y1 - board[1]) / span) + 1);
  const out: [number, number][] = [];
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      // A tile meets V when the two share ground, not when they only touch along a line.
      if (polygonArea(clipToRect(v, tileRect(board, pxPerHex, i, j))) > 1e-12) out.push([i, j]);
    }
  }
  return out;
}

export interface LevelChoice {
  /** The level shown: L* of the rule. */
  level: Level;
  /** The level the screen asks for: s of the rule. */
  wanted: Level;
  /** The largest density over V. */
  density: number;
  /** need(level): the tiles of the level shown that meet V, as keys `level:i:j`; none at level 0. */
  need: string[];
  /** V. */
  visible: Point[];
}

/** What the store can hold, and the level densities of the board. */
export interface LevelEnv {
  board: Rect;
  /** Level pixels per h of levels 0, 1 and 2 on this board. */
  densities: readonly [number, number, number];
  capMegapixels: number;
  tileMegapixels: number;
  /** The planted fault `coarse`: level 0 only. */
  coarse?: boolean;
}

/** The level a view shows, by the rule at the head of this file. */
export function chooseLevel(viewProj: readonly number[], device: readonly [number, number], env: LevelEnv): LevelChoice {
  const visible = visibleBoard(viewProj, env.board);
  const d = largestDensity(viewProj, device, visible);
  let wanted: Level = 2;
  for (const l of [0, 1, 2] as const) {
    if (env.densities[l] >= SHARP * d) {
      wanted = l;
      break;
    }
  }
  if (env.coarse || visible.length < 3) return { level: 0, wanted, density: d, need: [], visible };
  let level: Level = 0;
  let need: [number, number][] = [];
  for (let l = wanted; l >= 1; l--) {
    const tiles = tilesMeeting(visible, env.board, env.densities[l as Level]);
    if (tiles.length * env.tileMegapixels <= env.capMegapixels) {
      level = l as Level;
      need = tiles;
      break;
    }
  }
  return { level, wanted, density: d, need: need.map(([i, j]) => tileKey(level, i, j)), visible };
}
