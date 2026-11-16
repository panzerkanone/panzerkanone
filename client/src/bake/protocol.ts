/**
 * Messages between the page and the bake worker.
 *
 * The worker holds one display list at a time: built from a map (by id from
 * assets/maps, or from map text) or given whole. Every bake is of a rectangle
 * in level pixels, (0, 0) being the top-left corner of the board rectangle.
 */

/**
 * Level pixels per h: level 0 at most (it comes down on a large board, see
 * level0Px), levels 1 and 2 always.
 */
export const LEVEL_PX = [128, 256, 512] as const;
export type Level = 0 | 1 | 2;
/**
 * Level 0 holds the whole board in at most this many pixels (the round 2
 * ruling of docs/bars/M3a.md): 128 px per h when that fits, otherwise 64,
 * otherwise 32. A megapixel here is a million pixels.
 */
export const LEVEL0_MAX_PIXELS = 24_000_000;
const LEVEL0_CHOICES = [128, 64] as const;
const LEVEL0_FLOOR = 32;
/** Tiles of levels 1 and 2 are this many level pixels on a side. */
export const TILE = 1024;
/** No baked image is larger than this on a side (docs/art/map-art-spec.md, section 4). */
export const MAX_SIDE = 4096;

export type Rect = [x: number, y: number, w: number, h: number];

export type Request =
  /**
   * `sightLines: false` leaves out of the art the lines that bar sight which the table draws itself,
   * above its grid: today the green sides of a map's tree sides. The hill lines stay in the art (the
   * map art can leave them out too, `BuildOptions.hillLines`, when the table is ready to draw them).
   */
  | { id: number; kind: 'build-map'; mapId: string; sightLines?: boolean }
  | { id: number; kind: 'build-text'; mapText: string; sightLines?: boolean }
  | { id: number; kind: 'list'; listText: string }
  | { id: number; kind: 'hash' }
  /** `extraBreaks` is a check, not a setting: it must not change a pixel (raster.ts, `extraBreak`). */
  | { id: number; kind: 'bake'; level: Level; rect: Rect; format: 'bitmap' | 'png'; extraBreaks?: boolean };

export interface BuiltReply {
  id: number;
  kind: 'built';
  /** The board rectangle in h. */
  bounds: [number, number, number, number];
  /** Level pixels per h of levels 0, 1 and 2 for this board. */
  levelPx: [number, number, number];
  ops: number;
  buildMs: number;
  /**
   * The lines that bar sight on the map, kind by kind (tree sides, crests, ridges, separators), whether
   * or not the art drew them: each with the art's ink for it (sRGB 0..255), its width in h, and its
   * hexsides by side key (engine/core/hex `sideKey`). Empty for a list given whole.
   */
  sightLines: SightLines[];
  /**
   * What the table prints of the sheet round and over the map, in the map's season (sRGB 0..255): the
   * margin's stock, and the key plate's ink, in which the grid and the hex numbers are printed. For a
   * list given whole, the summer set's.
   */
  sheet: Sheet;
}

/** The sheet's margin and the key plate's ink, sRGB 0..255. */
export interface Sheet {
  margin: [number, number, number];
  key: [number, number, number];
}

export interface SightLines {
  kind: string;
  ink: [number, number, number];
  width: number;
  sides: number[];
}

export interface HashReply {
  id: number;
  kind: 'hash';
  hash: string;
  ms: number;
}

export interface BakedReply {
  id: number;
  kind: 'baked';
  level: Level;
  rect: Rect;
  /** The whole request: the drawing, then the image handed over (for a PNG, the GPU's work finished and the image encoded). */
  ms: number;
  /** The drawing alone, as the worker's thread spent it (the GPU may still be working when it ends). */
  drawMs: number;
  bitmap?: ImageBitmap;
  png?: ArrayBuffer;
}

export interface ErrorReply {
  id: number;
  kind: 'error';
  message: string;
}

export type Reply = BuiltReply | HashReply | BakedReply | ErrorReply;

/** Board size in pixels for bounds in h at a resolution. */
function sizeAt(bounds: readonly number[], ppx: number): [number, number] {
  return [
    Math.ceil(((bounds[2] as number) - (bounds[0] as number)) * ppx - 1e-6),
    Math.ceil(((bounds[3] as number) - (bounds[1] as number)) * ppx - 1e-6),
  ];
}

/** Level-0 pixels per h of a board: 128 when the whole board comes to at most LEVEL0_MAX_PIXELS, else 64, else 32. */
export function level0Px(bounds: readonly number[]): number {
  for (const ppx of LEVEL0_CHOICES) {
    const [w, h] = sizeAt(bounds, ppx);
    if (w * h <= LEVEL0_MAX_PIXELS) return ppx;
  }
  return LEVEL0_FLOOR;
}

/** Level pixels per h of a level on a board. */
export function levelPx(bounds: readonly number[], level: Level): number {
  return level === 0 ? level0Px(bounds) : LEVEL_PX[level];
}

/** Board size in level pixels for bounds in h. */
export function levelSize(bounds: readonly number[], level: Level): [number, number] {
  return sizeAt(bounds, levelPx(bounds, level));
}

/**
 * The rectangles of level 0: one image when the board fits in MAX_SIDE, else
 * equal chunks (widths and heights multiples of 4) that tile it with no gap
 * and no overlap.
 */
export function level0Chunks(bounds: readonly number[]): Rect[] {
  const [w, h] = levelSize(bounds, 0);
  const cols = Math.ceil(w / MAX_SIDE);
  const rows = Math.ceil(h / MAX_SIDE);
  const cw = Math.ceil(w / cols / 4) * 4;
  const ch = Math.ceil(h / rows / 4) * 4;
  const out: Rect[] = [];
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const x = i * cw;
      const y = j * ch;
      out.push([x, y, Math.min(cw, w - x), Math.min(ch, h - y)]);
    }
  }
  return out;
}

/** The tile rectangles of a level (1 or 2). */
export function tileRect(bounds: readonly number[], level: Level, i: number, j: number): Rect {
  const [w, h] = levelSize(bounds, level);
  const x = i * TILE;
  const y = j * TILE;
  return [x, y, Math.min(TILE, w - x), Math.min(TILE, h - y)];
}

export function tileCounts(bounds: readonly number[], level: Level): [number, number] {
  const [w, h] = levelSize(bounds, level);
  return [Math.ceil(w / TILE), Math.ceil(h / TILE)];
}
