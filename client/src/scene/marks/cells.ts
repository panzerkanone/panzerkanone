/**
 * Where each mark's picture lies in the table's one atlas of them (art.ts draws it): plain arithmetic, no browser.
 * Each picture is centred in a square cell of its own, at its own shape, with clear card round it, so that the
 * atlas's coarser levels, which a mark's shadow is read from, keep each picture's soft cover to its own cell.
 */
import type { MarkPicture } from './model';

/** The atlas's cell, in pixels, and the share of it on each side left clear round its picture. */
export const PRINT_CELL = 448;
export const CELL_PAD = 0.08;

export interface AtlasLayout {
  cols: number;
  rows: number;
  /** Each picture's rectangle in the atlas, in 0 to 1 (u across, v down from the top), and its cell. */
  cells: ReadonlyMap<string, { col: number; row: number; u0: number; v0: number; u1: number; v1: number }>;
}

/** Where each picture lies in an atlas of square cells: in the list's order, five to a row at the most, each centred in its cell at its own shape inside a clear margin of `pad` of the cell. */
export function atlasLayout(pictures: readonly MarkPicture[], pad = CELL_PAD): AtlasLayout {
  const cols = Math.max(1, Math.min(5, pictures.length));
  const rows = Math.max(1, Math.ceil(pictures.length / cols));
  const cells = new Map<string, { col: number; row: number; u0: number; v0: number; u1: number; v1: number }>();
  pictures.forEach((p, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const long = Math.max(p.width, p.height);
    const inner = 1 - 2 * pad;
    const w = (inner * p.width) / long;
    const h = (inner * p.height) / long;
    cells.set(p.id, { col, row, u0: (col + (1 - w) / 2) / cols, v0: (row + (1 - h) / 2) / rows, u1: (col + (1 + w) / 2) / cols, v1: (row + (1 + h) / 2) / rows });
  });
  return { cols, rows, cells };
}
