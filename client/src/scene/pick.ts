/**
 * The hex under a point of the frame, by arithmetic: the ray through the point
 * to the plane z = 0, then the hex module (ruling 10). No pixel is read back.
 * Plain arithmetic, no browser.
 */
import { invert, ndcOf, planePoint, rayThrough } from './camera';
import type { Point } from './camera';
import { onBoards } from './layout';
import type { BoardLayout } from './layout';

/** The board point (plane z = 0) under a CSS-pixel point of a window `css` wide and high, or null. */
export function boardPointAt(inverseViewProj: readonly number[], cssX: number, cssY: number, css: readonly [number, number]): Point | null {
  const [nx, ny] = ndcOf(cssX, cssY, css);
  return planePoint(inverseViewProj, nx, ny, 0);
}

/**
 * The hex under a CSS-pixel point: -1 off the board, which includes the margin
 * and the parts of the board rectangle that lie in no hex. `worldToHex` is the
 * hex module's, with the grid already bound.
 */
export function pickHex(viewProj: readonly number[], cssX: number, cssY: number, css: readonly [number, number], worldToHex: (x: number, y: number) => number): number {
  const p = boardPointAt(invert(viewProj), cssX, cssY, css);
  return p ? worldToHex(p[0], p[1]) : -1;
}

export type Hit = 'table' | 'slab' | 'none';

/**
 * What the ray through a point of the frame (normalised device coordinates)
 * hits first: a board (`slab`: its top, its rounded edge or its wall), the table
 * top, or nothing. A ray down a gap between two boards hits the table.
 */
export function hitAt(inverseViewProj: readonly number[], ndcX: number, ndcY: number, layout: BoardLayout): Hit {
  const [a, b] = rayThrough(inverseViewProj, ndcX, ndcY);
  const dz = b[2] - a[2];
  if (!(dz < 0)) return 'none';
  const at = (z: number): Point => {
    const t = (z - a[2]) / dz;
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  };
  if (a[2] < layout.table.z) return 'none';
  const top = at(0);
  const foot = at(layout.table.z);
  // A board is its rounded rectangle carried down from z = 0 to the table. Between those heights the
  // ray's track on the plan is a straight line; it hits a board when any point of that line is inside
  // one. In a gap between two boards a ray that meets neither goes on down to the table.
  for (let k = 0; k <= 16; k++) {
    const t = k / 16;
    const x = top[0] + (foot[0] - top[0]) * t;
    const y = top[1] + (foot[1] - top[1]) * t;
    if (onBoards(layout, x, y)) return 'slab';
  }
  const r = layout.table.rect;
  return foot[0] >= r[0] && foot[0] <= r[2] && foot[1] >= r[1] && foot[1] <= r[3] ? 'table' : 'none';
}
