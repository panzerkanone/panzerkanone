/**
 * Plane geometry for the map art, in hex units. Nothing here knows about the
 * hex layout: hex centres, corners and sides come from engine/core/hex.
 */

export type Vec = [number, number];

export function add(a: readonly number[], b: readonly number[]): Vec {
  return [(a[0] as number) + (b[0] as number), (a[1] as number) + (b[1] as number)];
}
export function sub(a: readonly number[], b: readonly number[]): Vec {
  return [(a[0] as number) - (b[0] as number), (a[1] as number) - (b[1] as number)];
}
export function scale(a: readonly number[], k: number): Vec {
  return [(a[0] as number) * k, (a[1] as number) * k];
}
export function dot(a: readonly number[], b: readonly number[]): number {
  return (a[0] as number) * (b[0] as number) + (a[1] as number) * (b[1] as number);
}
export function len(a: readonly number[]): number {
  return Math.hypot(a[0] as number, a[1] as number);
}
export function dist(a: readonly number[], b: readonly number[]): number {
  return Math.hypot((a[0] as number) - (b[0] as number), (a[1] as number) - (b[1] as number));
}
export function norm(a: readonly number[]): Vec {
  const l = len(a);
  return l === 0 ? [0, 0] : [(a[0] as number) / l, (a[1] as number) / l];
}
/** The left normal (x right, y down: a quarter turn anticlockwise on screen). */
export function perp(a: readonly number[]): Vec {
  return [a[1] as number, -(a[0] as number)];
}
export function lerp(a: readonly number[], b: readonly number[], t: number): Vec {
  return [(a[0] as number) + ((b[0] as number) - (a[0] as number)) * t, (a[1] as number) + ((b[1] as number) - (a[1] as number)) * t];
}

/** Distance from (px, py) to the segment (ax, ay)-(bx, by). */
export function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const abx = bx - ax;
  const aby = by - ay;
  const l2 = abx * abx + aby * aby;
  let t = l2 === 0 ? 0 : ((px - ax) * abx + (py - ay) * aby) / l2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(px - (ax + t * abx), py - (ay + t * aby));
}

/** Distance from a point to an open polyline given as x0, y0, x1, y1, ... */
export function polylineDist(px: number, py: number, line: readonly number[]): number {
  let best = Infinity;
  if (line.length === 2) return Math.hypot(px - (line[0] as number), py - (line[1] as number));
  for (let i = 0; i + 3 < line.length; i += 2) {
    const d = segDist(px, py, line[i] as number, line[i + 1] as number, line[i + 2] as number, line[i + 3] as number);
    if (d < best) best = d;
  }
  return best;
}

/** Even-odd containment of a point in a set of rings. */
export function inRings(px: number, py: number, rings: readonly (readonly number[])[]): boolean {
  let inside = false;
  for (const r of rings) {
    const n = r.length;
    for (let i = 0, j = n - 2; i < n; j = i, i += 2) {
      const yi = r[i + 1] as number;
      const yj = r[j + 1] as number;
      if ((yi > py) !== (yj > py)) {
        const xi = r[i] as number;
        const xj = r[j] as number;
        if (px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
      }
    }
  }
  return inside;
}

/** Signed area of a ring (positive when it runs clockwise on screen, x right and y down). */
export function ringArea(r: readonly number[]): number {
  let a = 0;
  const n = r.length;
  for (let i = 0; i < n; i += 2) {
    const j = (i + 2) % n;
    a += (r[i] as number) * (r[j + 1] as number) - (r[j] as number) * (r[i + 1] as number);
  }
  return a / 2;
}

/** Bounding box of flat coordinate arrays: [minX, minY, maxX, maxY]. */
export function boundsOf(arrays: readonly (readonly number[])[]): [number, number, number, number] {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const a of arrays) {
    for (let i = 0; i + 1 < a.length; i += 2) {
      const x = a[i] as number;
      const y = a[i + 1] as number;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return [x0, y0, x1, y1];
}

// ---------------------------------------------------------------------------
// Spatial index of segments and points
// ---------------------------------------------------------------------------

/**
 * Segments bucketed on a square grid, for "distance to the nearest segment
 * within r" queries. Buckets are keyed by integer cell, so the index does not
 * depend on the order segments are added in (queries take a minimum).
 */
export class SegmentIndex {
  private readonly cells = new Map<number, number[]>();
  private readonly segs: number[] = [];
  constructor(private readonly cell: number) {}

  private key(i: number, j: number): number {
    return (i + 32768) * 65536 + (j + 32768);
  }

  add(ax: number, ay: number, bx: number, by: number, tag = 0): void {
    const id = this.segs.length / 5;
    this.segs.push(ax, ay, bx, by, tag);
    const c = this.cell;
    const i0 = Math.floor(Math.min(ax, bx) / c);
    const i1 = Math.floor(Math.max(ax, bx) / c);
    const j0 = Math.floor(Math.min(ay, by) / c);
    const j1 = Math.floor(Math.max(ay, by) / c);
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const k = this.key(i, j);
        const list = this.cells.get(k);
        if (list) list.push(id);
        else this.cells.set(k, [id]);
      }
    }
  }

  addPolyline(line: readonly number[], tag = 0): void {
    for (let i = 0; i + 3 < line.length; i += 2) {
      this.add(line[i] as number, line[i + 1] as number, line[i + 2] as number, line[i + 3] as number, tag);
    }
  }

  get size(): number {
    return this.segs.length / 5;
  }

  /** Distance to the nearest segment, looking no further than `reach` (Infinity when none is that close). */
  nearest(px: number, py: number, reach: number): number {
    let best = Infinity;
    const c = this.cell;
    const i0 = Math.floor((px - reach) / c);
    const i1 = Math.floor((px + reach) / c);
    const j0 = Math.floor((py - reach) / c);
    const j1 = Math.floor((py + reach) / c);
    const s = this.segs;
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const list = this.cells.get(this.key(i, j));
        if (!list) continue;
        for (const id of list) {
          const o = id * 5;
          const d = segDist(px, py, s[o] as number, s[o + 1] as number, s[o + 2] as number, s[o + 3] as number);
          if (d < best) best = d;
        }
      }
    }
    return best <= reach ? best : Infinity;
  }

  /** Like nearest, but only segments whose tag is `tag`. */
  nearestTagged(px: number, py: number, reach: number, tag: number): number {
    let best = Infinity;
    const c = this.cell;
    const i0 = Math.floor((px - reach) / c);
    const i1 = Math.floor((px + reach) / c);
    const j0 = Math.floor((py - reach) / c);
    const j1 = Math.floor((py + reach) / c);
    const s = this.segs;
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const list = this.cells.get(this.key(i, j));
        if (!list) continue;
        for (const id of list) {
          const o = id * 5;
          if (s[o + 4] !== tag) continue;
          const d = segDist(px, py, s[o] as number, s[o + 1] as number, s[o + 2] as number, s[o + 3] as number);
          if (d < best) best = d;
        }
      }
    }
    return best <= reach ? best : Infinity;
  }
}

/** Points bucketed on a square grid, for "is any point closer than r" queries. */
export class PointIndex {
  private readonly cells = new Map<number, number[]>();
  constructor(private readonly cell: number) {}

  private key(i: number, j: number): number {
    return (i + 32768) * 65536 + (j + 32768);
  }

  add(x: number, y: number): void {
    const k = this.key(Math.floor(x / this.cell), Math.floor(y / this.cell));
    const list = this.cells.get(k);
    if (list) list.push(x, y);
    else this.cells.set(k, [x, y]);
  }

  /** True when some point lies closer than r to (x, y). */
  anyWithin(x: number, y: number, r: number): boolean {
    const c = this.cell;
    const i0 = Math.floor((x - r) / c);
    const i1 = Math.floor((x + r) / c);
    const j0 = Math.floor((y - r) / c);
    const j1 = Math.floor((y + r) / c);
    const r2 = r * r;
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const list = this.cells.get(this.key(i, j));
        if (!list) continue;
        for (let k = 0; k < list.length; k += 2) {
          const dx = (list[k] as number) - x;
          const dy = (list[k + 1] as number) - y;
          if (dx * dx + dy * dy < r2) return true;
        }
      }
    }
    return false;
  }
}

// ---------------------------------------------------------------------------
// Curves
// ---------------------------------------------------------------------------

/** Points of a cubic Bezier at n + 1 even steps of t (both ends included). */
export function cubicPoints(p0: Vec, c1: Vec, c2: Vec, p1: Vec, n: number): Vec[] {
  const out: Vec[] = [];
  for (let k = 0; k <= n; k++) {
    const t = k / n;
    const u = 1 - t;
    const a = u * u * u;
    const b = 3 * u * u * t;
    const c = 3 * u * t * t;
    const d = t * t * t;
    out.push([a * p0[0] + b * c1[0] + c * c2[0] + d * p1[0], a * p0[1] + b * c1[1] + c * c2[1] + d * p1[1]]);
  }
  return out;
}

/** Point and unit tangent of a cubic Bezier at t. */
export function cubicAt(p0: Vec, c1: Vec, c2: Vec, p1: Vec, t: number): { p: Vec; tangent: Vec } {
  const u = 1 - t;
  const p: Vec = [
    u * u * u * p0[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * p1[0],
    u * u * u * p0[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * p1[1],
  ];
  const d: Vec = [
    3 * u * u * (c1[0] - p0[0]) + 6 * u * t * (c2[0] - c1[0]) + 3 * t * t * (p1[0] - c2[0]),
    3 * u * u * (c1[1] - p0[1]) + 6 * u * t * (c2[1] - c1[1]) + 3 * t * t * (p1[1] - c2[1]),
  ];
  return { p, tangent: norm(d) };
}

// ---------------------------------------------------------------------------
// Rings
// ---------------------------------------------------------------------------

/** Douglas-Peucker on an open polyline of points; keeps both ends. */
function simplifyOpen(pts: readonly Vec[], tol: number): Vec[] {
  if (pts.length <= 2) return pts.slice();
  const keep = new Uint8Array(pts.length);
  keep[0] = 1;
  keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length > 0) {
    const [a, b] = stack.pop() as [number, number];
    const pa = pts[a] as Vec;
    const pb = pts[b] as Vec;
    let worst = -1;
    let worstD = tol;
    for (let i = a + 1; i < b; i++) {
      const p = pts[i] as Vec;
      const d = segDist(p[0], p[1], pa[0], pa[1], pb[0], pb[1]);
      if (d > worstD) {
        worstD = d;
        worst = i;
      }
    }
    if (worst >= 0) {
      keep[worst] = 1;
      stack.push([a, worst], [worst, b]);
    }
  }
  return pts.filter((_, i) => keep[i] === 1);
}

/** Douglas-Peucker on a closed ring (flat array), anchored at its first point and the point farthest from it. */
export function simplifyRing(ring: readonly number[], tol: number): number[] {
  const n = ring.length / 2;
  if (n <= 4) return ring.slice();
  const pts: Vec[] = [];
  for (let i = 0; i < n; i++) pts.push([ring[2 * i] as number, ring[2 * i + 1] as number]);
  let far = 0;
  let farD = -1;
  for (let i = 1; i < n; i++) {
    const d = dist(pts[i] as Vec, pts[0] as Vec);
    if (d > farD) {
      farD = d;
      far = i;
    }
  }
  const first = simplifyOpen(pts.slice(0, far + 1), tol);
  const second = simplifyOpen([...pts.slice(far), pts[0] as Vec], tol);
  const out: number[] = [];
  for (const p of first) out.push(p[0], p[1]);
  for (let i = 1; i < second.length - 1; i++) out.push((second[i] as Vec)[0], (second[i] as Vec)[1]);
  return out;
}

/**
 * Closed contours of the zero level of a field sampled on a square grid
 * (marching squares with linear interpolation). Inside is where the field is
 * at or below zero. `values[j * nx + i]` is the field at (x0 + i * step,
 * y0 + j * step). The grid must be large enough that the region does not
 * touch its border. Contours are traced in a fixed scan order, so the result
 * depends only on the values.
 */
export function zeroContours(values: Float64Array, nx: number, ny: number, x0: number, y0: number, step: number): number[][] {
  const inside = (i: number, j: number) => (values[j * nx + i] as number) <= 0;
  // An edge crossing point, keyed by edge: horizontal edge (i, j)-(i+1, j) -> j * nx + i;
  // vertical edge (i, j)-(i, j+1) -> VERT + j * nx + i.
  const VERT = nx * ny;
  const crossing = (key: number): Vec => {
    const vertical = key >= VERT;
    const node = vertical ? key - VERT : key;
    const i = node % nx;
    const j = (node - i) / nx;
    const a = values[node] as number;
    if (!vertical) {
      const b = values[node + 1] as number;
      const t = a / (a - b);
      return [x0 + (i + t) * step, y0 + j * step];
    }
    const b = values[node + nx] as number;
    const t = a / (a - b);
    return [x0 + i * step, y0 + (j + t) * step];
  };
  // For each cell, the segments as pairs of edge keys, oriented so the inside is on the right
  // (clockwise on screen around inside regions).
  const next = new Map<number, number>();
  for (let j = 0; j < ny - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const tl = inside(i, j);
      const tr = inside(i + 1, j);
      const br = inside(i + 1, j + 1);
      const bl = inside(i, j + 1);
      const code = (tl ? 8 : 0) | (tr ? 4 : 0) | (br ? 2 : 0) | (bl ? 1 : 0);
      if (code === 0 || code === 15) continue;
      const top = j * nx + i;
      const bottom = (j + 1) * nx + i;
      const left = VERT + j * nx + i;
      const right = VERT + j * nx + i + 1;
      const link = (from: number, to: number) => next.set(from, to);
      // Orientation: walking from `from` to `to` keeps the inside on the right.
      switch (code) {
        case 1: link(left, bottom); break;
        case 2: link(bottom, right); break;
        case 3: link(left, right); break;
        case 4: link(right, top); break;
        case 5: {
          // Saddle: decide by the centre value.
          const c = ((values[j * nx + i] as number) + (values[j * nx + i + 1] as number) + (values[(j + 1) * nx + i] as number) + (values[(j + 1) * nx + i + 1] as number)) / 4;
          if (c <= 0) {
            link(left, top);
            link(right, bottom);
          } else {
            link(left, bottom);
            link(right, top);
          }
          break;
        }
        case 6: link(bottom, top); break;
        case 7: link(left, top); break;
        case 8: link(top, left); break;
        case 9: link(top, bottom); break;
        case 10: {
          const c = ((values[j * nx + i] as number) + (values[j * nx + i + 1] as number) + (values[(j + 1) * nx + i] as number) + (values[(j + 1) * nx + i + 1] as number)) / 4;
          if (c <= 0) {
            link(top, right);
            link(bottom, left);
          } else {
            link(top, left);
            link(bottom, right);
          }
          break;
        }
        case 11: link(top, right); break;
        case 12: link(right, left); break;
        case 13: link(right, bottom); break;
        case 14: link(bottom, left); break;
        default: break;
      }
    }
  }
  const starts = [...next.keys()].sort((a, b) => a - b);
  const used = new Set<number>();
  const rings: number[][] = [];
  for (const s of starts) {
    if (used.has(s)) continue;
    const ring: number[] = [];
    let k = s;
    let guard = 0;
    while (!used.has(k) && guard++ < 1_000_000) {
      used.add(k);
      const p = crossing(k);
      ring.push(p[0], p[1]);
      const n = next.get(k);
      if (n === undefined) break;
      k = n;
    }
    if (ring.length >= 6) rings.push(ring);
  }
  return rings;
}

// ---------------------------------------------------------------------------
// Convex polygons and rectangles
// ---------------------------------------------------------------------------

/** Clip a segment to a convex polygon (flat ring, either orientation). Null when nothing is left. */
export function clipSegmentToConvex(ax: number, ay: number, bx: number, by: number, poly: readonly number[]): [number, number, number, number] | null {
  let t0 = 0;
  let t1 = 1;
  const n = poly.length / 2;
  const sign = ringArea(poly) > 0 ? 1 : -1;
  const dx = bx - ax;
  const dy = by - ay;
  for (let i = 0; i < n; i++) {
    const px = poly[2 * i] as number;
    const py = poly[2 * i + 1] as number;
    const qx = poly[(2 * i + 2) % poly.length] as number;
    const qy = poly[(2 * i + 3) % poly.length] as number;
    // Inside is where cross(q - p, x - p) has the sign of the ring's orientation.
    const ex = qx - px;
    const ey = qy - py;
    const fa = sign * (ex * (ay - py) - ey * (ax - px));
    const fd = sign * (ex * dy - ey * dx);
    if (fd === 0) {
      if (fa < 0) return null;
      continue;
    }
    const t = -fa / fd;
    if (fd > 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
    if (t0 > t1) return null;
  }
  return [ax + dx * t0, ay + dy * t0, ax + dx * t1, ay + dy * t1];
}

/** Split a convex polygon by the line through p with direction d; returns the two sides (either may be empty). */
export function splitConvex(poly: readonly number[], p: Vec, d: Vec, gap: number): [number[], number[]] {
  const nrm: Vec = perp(norm(d));
  const side = (x: number, y: number) => (x - p[0]) * nrm[0] + (y - p[1]) * nrm[1];
  const cut = (offset: number, keepPositive: boolean): number[] => {
    const out: number[] = [];
    const n = poly.length / 2;
    for (let i = 0; i < n; i++) {
      const ax = poly[2 * i] as number;
      const ay = poly[2 * i + 1] as number;
      const bx = poly[(2 * i + 2) % poly.length] as number;
      const by = poly[(2 * i + 3) % poly.length] as number;
      const sa = (side(ax, ay) - offset) * (keepPositive ? 1 : -1);
      const sb = (side(bx, by) - offset) * (keepPositive ? 1 : -1);
      if (sa >= 0) out.push(ax, ay);
      if ((sa >= 0) !== (sb >= 0)) {
        const t = sa / (sa - sb);
        out.push(ax + (bx - ax) * t, ay + (by - ay) * t);
      }
    }
    return out.length >= 6 ? out : [];
  };
  return [cut(gap / 2, true), cut(-gap / 2, false)];
}

/** Shrink a convex polygon towards its centroid so its edges move in by `inset`. */
export function insetConvex(poly: readonly number[], inset: number): number[] {
  const n = poly.length / 2;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < n; i++) {
    cx += poly[2 * i] as number;
    cy += poly[2 * i + 1] as number;
  }
  cx /= n;
  cy /= n;
  // Distance from the centroid to the nearest edge line.
  let apothem = Infinity;
  for (let i = 0; i < n; i++) {
    const d = segDist(cx, cy, poly[2 * i] as number, poly[2 * i + 1] as number, poly[(2 * i + 2) % poly.length] as number, poly[(2 * i + 3) % poly.length] as number);
    apothem = Math.min(apothem, d);
  }
  const k = Math.max(0, (apothem - inset) / apothem);
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(cx + ((poly[2 * i] as number) - cx) * k, cy + ((poly[2 * i + 1] as number) - cy) * k);
  return out;
}

/** The four corners of a rectangle: centre, half-length along `angle`, half-depth across it. */
export function rectCorners(cx: number, cy: number, halfLen: number, halfDepth: number, angle: number): number[] {
  const ux = Math.cos(angle);
  const uy = Math.sin(angle);
  const vx = -uy;
  const vy = ux;
  return [
    cx - ux * halfLen - vx * halfDepth, cy - uy * halfLen - vy * halfDepth,
    cx + ux * halfLen - vx * halfDepth, cy + uy * halfLen - vy * halfDepth,
    cx + ux * halfLen + vx * halfDepth, cy + uy * halfLen + vy * halfDepth,
    cx - ux * halfLen + vx * halfDepth, cy - uy * halfLen + vy * halfDepth,
  ];
}

/** Separating-axis test for two convex polygons; `pad` grows the gap that counts as touching. */
export function convexOverlap(a: readonly number[], b: readonly number[], pad: number): boolean {
  const axes = (p: readonly number[]): Vec[] => {
    const out: Vec[] = [];
    const n = p.length / 2;
    for (let i = 0; i < n; i++) {
      const ex = (p[(2 * i + 2) % p.length] as number) - (p[2 * i] as number);
      const ey = (p[(2 * i + 3) % p.length] as number) - (p[2 * i + 1] as number);
      out.push(norm([-ey, ex]));
    }
    return out;
  };
  const project = (p: readonly number[], ax: Vec): [number, number] => {
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < p.length; i += 2) {
      const v = (p[i] as number) * ax[0] + (p[i + 1] as number) * ax[1];
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    return [lo, hi];
  };
  for (const ax of [...axes(a), ...axes(b)]) {
    const [a0, a1] = project(a, ax);
    const [b0, b1] = project(b, ax);
    if (a1 + pad <= b0 || b1 + pad <= a0) return false;
  }
  return true;
}

/** Smallest distance between a convex polygon (flat ring) and an open polyline. Zero when they cross. */
export function polygonPolylineDist(poly: readonly number[], line: readonly number[]): number {
  let best = Infinity;
  const n = poly.length / 2;
  for (let i = 0; i < line.length; i += 2) {
    const px = line[i] as number;
    const py = line[i + 1] as number;
    if (inRings(px, py, [poly])) return 0;
  }
  for (let k = 0; k < n; k++) {
    const ax = poly[2 * k] as number;
    const ay = poly[2 * k + 1] as number;
    const bx = poly[(2 * k + 2) % poly.length] as number;
    const by = poly[(2 * k + 3) % poly.length] as number;
    for (let i = 0; i + 3 < line.length; i += 2) {
      const cx = line[i] as number;
      const cy = line[i + 1] as number;
      const dx = line[i + 2] as number;
      const dy = line[i + 3] as number;
      if (segmentsCross(ax, ay, bx, by, cx, cy, dx, dy)) return 0;
      best = Math.min(best, segDist(ax, ay, cx, cy, dx, dy), segDist(bx, by, cx, cy, dx, dy), segDist(cx, cy, ax, ay, bx, by), segDist(dx, dy, ax, ay, bx, by));
    }
  }
  return best;
}

/** True when two segments properly cross. */
export function segmentsCross(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number): boolean {
  const o = (px: number, py: number, qx: number, qy: number, rx: number, ry: number) => (qx - px) * (ry - py) - (qy - py) * (rx - px);
  const d1 = o(cx, cy, dx, dy, ax, ay);
  const d2 = o(cx, cy, dx, dy, bx, by);
  const d3 = o(ax, ay, bx, by, cx, cy);
  const d4 = o(ax, ay, bx, by, dx, dy);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/** Where two segments cross, as parameters along each; null when they do not. */
export function segmentIntersection(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number): [number, number] | null {
  const rx = bx - ax;
  const ry = by - ay;
  const sx = dx - cx;
  const sy = dy - cy;
  const den = rx * sy - ry * sx;
  if (den === 0) return null;
  const t = ((cx - ax) * sy - (cy - ay) * sx) / den;
  const u = ((cx - ax) * ry - (cy - ay) * rx) / den;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return [t, u];
}
