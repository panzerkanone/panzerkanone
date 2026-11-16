/**
 * The paper's grain (docs/bars/M3b.md, the owner's O5; mapart/displayList.ts,
 * `Paper`): a fine speckle over the whole sheet, laid on a finished cell of
 * the bake after its last plate. It is drawn only when the display list
 * carries a `paper` entry, and from that entry alone.
 *
 * The grain belongs to the board, not to a tile or a pass: the value of a
 * pixel depends on its place on the board, the seed and the level's pixels
 * per h, never on which rectangle was asked for. It is built from cells that
 * halve from `scale` h down to one pixel: a cell keeps `carry` of its parent
 * cell's value and adds a fresh value of its own, so the grain of one level,
 * averaged two by two, is close to the grain of the level below it.
 *
 * It moves no flat colour: every value has mean 0, is the same on the three
 * channels, and is added to the sheet as whole steps of 255 (lighter where it
 * is above 0, then darker where it is below), with no read-back of pixels.
 */
import type { Paper } from '@mapart/displayList';
import { grainOf } from './grainField';

type Ctx2D = OffscreenCanvasRenderingContext2D;

/**
 * Lay the grain on one finished cell of the bake. `sheet` holds the cell;
 * `scratch` is a canvas of the same size, free to be written over.
 */
export function drawGrain(sheet: Ctx2D, scratch: OffscreenCanvas, paper: Paper, ppx: number, x: number, y: number, w: number, h: number): void {
  if (!(paper.amplitude > 0)) return;
  const grain = grainOf(paper, ppx, x, y, w, h);
  const lighter = new ImageData(w, h);
  const darker = new ImageData(w, h);
  const L = lighter.data;
  const D = darker.data;
  for (let i = 0; i < w * h; i++) {
    const v = grain[i] as number;
    const o = i * 4;
    L[o + 3] = 255;
    D[o + 3] = 255;
    if (v > 0) {
      L[o] = v;
      L[o + 1] = v;
      L[o + 2] = v;
    } else if (v < 0) {
      D[o] = -v;
      D[o + 1] = -v;
      D[o + 2] = -v;
    }
  }
  const c = scratch.getContext('2d', { alpha: false }) as Ctx2D;
  c.setTransform(1, 0, 0, 1, 0, 0);
  sheet.save();
  sheet.setTransform(1, 0, 0, 1, 0, 0);
  sheet.globalAlpha = 1;
  c.putImageData(lighter, 0, 0);
  sheet.globalCompositeOperation = 'lighter';
  sheet.drawImage(scratch, 0, 0, w, h, 0, 0, w, h);
  c.putImageData(darker, 0, 0);
  sheet.globalCompositeOperation = 'difference';
  sheet.drawImage(scratch, 0, 0, w, h, 0, 0, w, h);
  sheet.restore();
  sheet.globalCompositeOperation = 'source-over';
}
