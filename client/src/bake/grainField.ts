/**
 * The paper's grain as numbers (docs/bars/M3b.md, the owner's O5;
 * mapart/displayList.ts, `Paper`): for every pixel of a rectangle of a bake
 * level, how many steps of 255 it is lightened or darkened. grain.ts lays it
 * on the sheet; this file touches no canvas, so the unit tests can load it.
 *
 * The grain belongs to the board, not to a tile or a pass: the value of a
 * pixel depends on its place on the board, the seed and the level's pixels
 * per h, never on which rectangle was asked for. It is built from cells that
 * halve from `scale` h down to one pixel: a cell keeps `carry` of its parent
 * cell's value and adds a fresh value of its own, so the grain of one level,
 * averaged two by two, is close to the grain of the level below it. Every
 * value has mean 0.
 */
// Plain paths, not the @mapart alias, so that the unit tests (which have no such alias) can load this file.
import type { Paper } from '../../../mapart/displayList';
import { cellHasher } from '../../../mapart/random';

const SQRT6 = Math.sqrt(6);

/** Mean 0, variance 1, from one 32-bit hash: the sum of its two halves, a triangle on (-1, 1) scaled. */
function fresh(h: number): number {
  return (((h & 0xffff) + (h >>> 16)) / 65536 - 1) * SQRT6;
}

/** How many times the coarsest cell is halved to reach one pixel at `ppx` pixels per h. */
export function grainDepth(paper: Paper, ppx: number): number {
  return Math.max(0, Math.round(Math.log2(ppx * paper.scale)));
}

/**
 * The grain of a rectangle of level pixels, in steps of 255 (whole numbers,
 * positive lighter), row by row. Pure: used by the bake and by its tests.
 */
export function grainOf(paper: Paper, ppx: number, x: number, y: number, w: number, h: number): Int16Array {
  const depth = grainDepth(paper, ppx);
  const own = Math.sqrt(1 - paper.carry * paper.carry);
  let prev: Float32Array | null = null;
  let px0 = 0;
  let py0 = 0;
  let pw = 0;
  for (let k = 0; k <= depth; k++) {
    const shift = depth - k;
    const cx0 = x >> shift;
    const cy0 = y >> shift;
    const cw = ((x + w - 1) >> shift) - cx0 + 1;
    const ch = ((y + h - 1) >> shift) - cy0 + 1;
    const hash = cellHasher(paper.seed, `paper-grain-${k}`);
    const cur = new Float32Array(cw * ch);
    for (let j = 0; j < ch; j++) {
      for (let i = 0; i < cw; i++) {
        const v = fresh(hash(cx0 + i, cy0 + j));
        if (prev) {
          const parent = prev[(((cy0 + j) >> 1) - py0) * pw + (((cx0 + i) >> 1) - px0)] as number;
          cur[j * cw + i] = paper.carry * parent + own * v;
        } else cur[j * cw + i] = v;
      }
    }
    prev = cur;
    px0 = cx0;
    py0 = cy0;
    pw = cw;
  }
  const out = new Int16Array(w * h);
  const amp = paper.amplitude * 255;
  const g = prev as Float32Array;
  for (let i = 0; i < w * h; i++) out[i] = Math.round((g[i] as number) * amp);
  return out;
}
