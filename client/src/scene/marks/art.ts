/**
 * The marks' pictures as the table draws them: every picture drawn into one atlas, where cells.ts puts it. Nothing
 * here loads a picture: they are handed in, decoded (client/src/marksart).
 */
import { PRINT_CELL, atlasLayout } from './cells';
import type { AtlasLayout } from './cells';
import type { MarkPicture } from './model';

/** The marks' art, ready for the table: the pictures' list, and the atlas (a canvas) with its layout. */
export interface MarkAtlases {
  pictures: readonly MarkPicture[];
  print: { canvas: HTMLCanvasElement; layout: AtlasLayout };
}

/** The atlas drawn from the decoded pictures (by their files' names, as the list names them). */
export function makeMarkAtlas(pictures: readonly MarkPicture[], images: ReadonlyMap<string, CanvasImageSource>): MarkAtlases {
  const layout = atlasLayout(pictures);
  const canvas = document.createElement('canvas');
  canvas.width = layout.cols * PRINT_CELL;
  canvas.height = layout.rows * PRINT_CELL;
  const g = canvas.getContext('2d') as CanvasRenderingContext2D;
  g.imageSmoothingQuality = 'high';
  for (const p of pictures) {
    const image = images.get(p.file);
    if (!image) throw new Error(`the marks' art: no picture for ${p.file}`);
    const c = layout.cells.get(p.id) as NonNullable<ReturnType<AtlasLayout['cells']['get']>>;
    g.drawImage(image, c.u0 * canvas.width, c.v0 * canvas.height, (c.u1 - c.u0) * canvas.width, (c.v1 - c.v0) * canvas.height);
  }
  return { pictures, print: { canvas, layout } };
}
