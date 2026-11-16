/**
 * Lettering from glyph outlines taken from the font at build time (the outline
 * data in mapart/data/lettering/, OFL 1.1). The bake worker loads no font:
 * each glyph is a shape in the display list, placed by a transform.
 */
import { GlyphSet } from './params';

export interface TextRun {
  /** Shape keys, one per drawn glyph (spaces draw nothing). */
  shapes: string[];
  /** Six numbers per drawn glyph. */
  transforms: number[];
  /** Bounding box of the drawn outlines: [minX, minY, maxX, maxY]. */
  box: [number, number, number, number];
  /** Advance width of the whole run. */
  width: number;
}

const FALLBACK = 0x3f; // '?'

export function glyphKey(cp: number): string {
  return `glyph-${cp.toString(16).padStart(4, '0')}`;
}

/** Width of a text at a size, with extra tracking between letters. */
export function textWidth(glyphs: GlyphSet, text: string, size: number, tracking: number): number {
  let w = 0;
  const cps = [...text].map(ch => ch.codePointAt(0) as number);
  cps.forEach((cp, i) => {
    const g = glyphs.glyphs.get(cp) ?? glyphs.glyphs.get(FALLBACK);
    w += (g ? g.advance * size : size * 0.5) + (i < cps.length - 1 ? tracking : 0);
  });
  return w;
}

/**
 * Lay a text out from (x, baseline), straight. `use` is told every glyph shape
 * the run needs, so the caller can put its rings in the list's shape table.
 */
export function layoutText(
  glyphs: GlyphSet, text: string, size: number, tracking: number, x: number, baseline: number,
  use: (key: string, rings: readonly (readonly number[])[]) => void,
): TextRun {
  const shapes: string[] = [];
  const transforms: number[] = [];
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  let pen = x;
  const cps = [...text].map(ch => ch.codePointAt(0) as number);
  cps.forEach((raw, i) => {
    const cp = glyphs.glyphs.has(raw) ? raw : FALLBACK;
    const g = glyphs.glyphs.get(cp);
    if (g && g.rings.length > 0) {
      const key = glyphKey(cp);
      use(key, g.rings);
      shapes.push(key);
      transforms.push(size, 0, 0, size, pen, baseline);
      for (const r of g.rings) {
        for (let k = 0; k < r.length; k += 2) {
          const px = pen + (r[k] as number) * size;
          const py = baseline + (r[k + 1] as number) * size;
          if (px < x0) x0 = px;
          if (px > x1) x1 = px;
          if (py < y0) y0 = py;
          if (py > y1) y1 = py;
        }
      }
    }
    pen += (g ? g.advance * size : size * 0.5) + (i < cps.length - 1 ? tracking : 0);
  });
  if (x0 === Infinity) {
    x0 = x1 = x;
    y0 = y1 = baseline;
  }
  return { shapes, transforms, box: [x0, y0, x1, y1], width: pen - x };
}

/** Move a laid-out run by (dx, dy). */
export function shiftRun(run: TextRun, dx: number, dy: number): TextRun {
  const transforms = run.transforms.slice();
  for (let i = 0; i < transforms.length; i += 6) {
    transforms[i + 4] = (transforms[i + 4] as number) + dx;
    transforms[i + 5] = (transforms[i + 5] as number) + dy;
  }
  return { shapes: run.shapes, transforms, box: [run.box[0] + dx, run.box[1] + dy, run.box[2] + dx, run.box[3] + dy], width: run.width };
}
