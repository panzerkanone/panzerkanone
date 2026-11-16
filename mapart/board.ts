/**
 * The board rectangle beyond the hexes: part-hexes.
 *
 * The board rectangle (worldBounds) is larger than the hexes: shifted columns
 * leave half-hexes along the top and bottom, and the corners of the hexes
 * leave triangles along the sides. A point of the rectangle in no board hex
 * belongs to the board hex NEAREST it (docs/bars/M3b.md, ruling 12 and line
 * M3b-L-25), and takes its cover. Nearest is by hex centre, which for points
 * of the rectangle is the same as nearest by distance to the hex itself: the
 * line between the parts of two neighbouring hexes is their shared side
 * carried on.
 *
 * So each board hex has a REGION: the hex and its part-hexes, a convex
 * polygon (the hex with every side that has no neighbour pushed out to where
 * the neighbouring sides, carried on, meet each other or the rectangle).
 */
import { Grid, HexId, centreAt, centreOf, cornerOf, hexAt, neighbourOf, sideCorners, worldBounds, worldToCoord } from '../engine/core/hex';

/** The board hex nearest a point (the hex that holds it, when one does). */
export function nearestHex(g: Grid, x: number, y: number): HexId {
  const [col, row] = worldToCoord(x, y);
  const inside = hexAt(g, col, row);
  if (inside >= 0) return inside;
  const c0 = Math.max(0, Math.min(g.cols - 1, col));
  const r0 = Math.max(0, Math.min(g.rows - 1, row));
  let best = -1;
  let bestD = Infinity;
  for (let c = Math.max(0, c0 - 1); c <= Math.min(g.cols - 1, c0 + 1); c++) {
    for (let r = Math.max(0, r0 - 1); r <= Math.min(g.rows - 1, r0 + 1); r++) {
      const p = centreAt(c, r);
      const d = (p[0] - x) * (p[0] - x) + (p[1] - y) * (p[1] - y);
      // Ties go to the lower hex number, so the answer never depends on the order of the search.
      const id = r * g.cols + c;
      if (d < bestD - 1e-12 || (Math.abs(d - bestD) <= 1e-12 && id < best)) {
        bestD = d;
        best = id;
      }
    }
  }
  return best;
}

/** Keep the part of a convex polygon where (p - a) . n >= 0. */
export function clipHalfPlane(poly: readonly number[], ax: number, ay: number, nx: number, ny: number): number[] {
  const out: number[] = [];
  const n = poly.length;
  for (let i = 0; i < n; i += 2) {
    const px = poly[i] as number;
    const py = poly[i + 1] as number;
    const qx = poly[(i + 2) % n] as number;
    const qy = poly[(i + 3) % n] as number;
    const sp = (px - ax) * nx + (py - ay) * ny;
    const sq = (qx - ax) * nx + (qy - ay) * ny;
    if (sp >= 0) out.push(px, py);
    if ((sp >= 0) !== (sq >= 0)) {
      const t = sp / (sp - sq);
      out.push(px + (qx - px) * t, py + (qy - py) * t);
    }
  }
  return out.length >= 6 ? out : [];
}

/** True when a hex has a side with no neighbour: its region is larger than the hex. */
export function hasPartHex(g: Grid, h: HexId): boolean {
  for (let d = 0; d < 6; d++) if (neighbourOf(g, h, d) < 0) return true;
  return false;
}

/**
 * The region of a board hex: every point of the board rectangle nearer to it
 * than to any other board hex, as a convex ring. For a hex with six
 * neighbours it is the hex.
 */
export function regionRing(g: Grid, h: HexId): number[] {
  const hex: number[] = [];
  for (let k = 0; k < 6; k++) {
    const p = cornerOf(g, h, k);
    hex.push(p[0], p[1]);
  }
  if (!hasPartHex(g, h)) return hex;
  const b = worldBounds(g);
  let poly: number[] = [b[0], b[1], b[2], b[1], b[2], b[3], b[0], b[3]];
  const c = centreOf(g, h);
  for (let d = 0; d < 6; d++) {
    if (neighbourOf(g, h, d) < 0) continue;
    const [k1] = sideCorners(d);
    const p = cornerOf(g, h, k1);
    const q = cornerOf(g, h, k1 + 1);
    // The side's line, keeping the hex's own side of it.
    let nx = -(q[1] - p[1]);
    let ny = q[0] - p[0];
    if ((c[0] - p[0]) * nx + (c[1] - p[1]) * ny < 0) {
      nx = -nx;
      ny = -ny;
    }
    poly = clipHalfPlane(poly, p[0], p[1], nx, ny);
  }
  return poly;
}

/** The part-hexes of a board hex: its region less the hex, one convex ring beyond each side that has no neighbour. */
export function partHexRings(g: Grid, h: HexId): number[][] {
  if (!hasPartHex(g, h)) return [];
  const region = regionRing(g, h);
  const c = centreOf(g, h);
  const out: number[][] = [];
  for (let d = 0; d < 6; d++) {
    if (neighbourOf(g, h, d) >= 0) continue;
    const [k1] = sideCorners(d);
    const p = cornerOf(g, h, k1);
    const q = cornerOf(g, h, k1 + 1);
    // Beyond this side, and between the lines from the hex centre through its two ends.
    let nx = -(q[1] - p[1]);
    let ny = q[0] - p[0];
    if ((c[0] - p[0]) * nx + (c[1] - p[1]) * ny > 0) {
      nx = -nx;
      ny = -ny;
    }
    let piece = clipHalfPlane(region, p[0], p[1], nx, ny);
    for (const [e, other] of [[p, q], [q, p]] as const) {
      if (piece.length === 0) break;
      let mx = -(e[1] - c[1]);
      let my = e[0] - c[0];
      if ((other[0] - c[0]) * mx + (other[1] - c[1]) * my < 0) {
        mx = -mx;
        my = -my;
      }
      piece = clipHalfPlane(piece, c[0], c[1], mx, my);
    }
    if (piece.length >= 6 && Math.abs(ringAreaOf(piece)) > 1e-9) out.push(piece);
  }
  return out;
}

function ringAreaOf(r: readonly number[]): number {
  let a = 0;
  const n = r.length;
  for (let i = 0; i < n; i += 2) a += (r[i] as number) * (r[(i + 3) % n] as number) - (r[(i + 2) % n] as number) * (r[i + 1] as number);
  return a / 2;
}
