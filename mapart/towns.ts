/**
 * Towns (the owner's O4 and his directive of 2026-11-11: "recursive lot
 * subdivision between obstacles like roads ... Use our standard imagery").
 *
 * A town is one place, however many hexes it has.
 *
 *   BLOCKS. The town's ground is the outline of all its hexes together, drawn
 *   in by a margin from its OUTER sides (two hexes of one town meet with no
 *   gap). Every road and river through it (the true centre line, straightened
 *   to within 0.02 h) is cut out of that ground as a corridor as wide as the
 *   casing or bank and its clearance. What is left is the town's blocks: the
 *   ground between its obstacles.
 *
 *   LOTS. Each block is divided in two, and its parts again and again, in the
 *   frame of the road it lies nearest: parallel to the road while a piece is
 *   deeper than a lot (the first cut one lot's depth back from the road, so a
 *   row of lots fronts it), across while it is longer than a lot's frontage.
 *   A piece small enough is a lot; a few stop one division early and are
 *   large lots.
 *
 *   BUILDINGS. The owner's own building set, ported from the old client
 *   (legacy/client/src/components/TownLayer.tsx, BUILDING_TYPES): thirteen
 *   types, each with its proportions, its roof style and two weights. The
 *   first building of a lot stands on its frontage (the road side, or the
 *   lot's long side) and is drawn by the types' first weights; any others
 *   stand in the lot's interior and are drawn by the other weights. A house
 *   type may stand as a packed row of two or three. The types and their inks
 *   are data (mapart/data/params.yaml, towns.types and towns.inks); no colour
 *   is taken from the old client.
 *
 * A building is accepted only if it lies inside its lot and a hex of its own
 * town, clear of every road casing and river bank, and overlaps no other.
 * Buildings never stand on a part-hex at the board's edge. Everything is
 * hashed from the art seed and from where a piece of ground lies, and a town
 * is worked from its own hexes only, so neither the order hexes are visited
 * in nor a change elsewhere on the board moves a building.
 */
import { COL_STEP, HexId, worldToHex } from '../engine/core/hex';
import { MapContext } from './context';
import { CentreLines } from './curves';
import { convexOverlap, inRings, polygonPolylineDist, segDist } from './geom';
import { hash32, unit } from './random';
import { hexSetOutline } from './regions';

export type RoofStyle = 'gable' | 'gable_ends' | 'hip' | 'flat' | 'cross';

export interface BuildingType {
  id: string;
  /** Which ink family it prints in (towns.inks). */
  family: string;
  /** Width and height as multiples of towns.baseSize. */
  width: number;
  height: number;
  /** Weight when it is the first building of a lot, on its frontage; and when it stands in a lot's interior. */
  first: number;
  other: number;
  roof: RoofStyle;
}

export interface Building {
  /** The hex its centre lies in. */
  hex: HexId;
  /** Four corners, flat. */
  ring: number[];
  cx: number;
  cy: number;
  /** Direction of its width, in radians. */
  angle: number;
  /** Half its width (along `angle`) and half its height (across). */
  halfLen: number;
  halfDepth: number;
  type: string;
  family: string;
  roof: RoofStyle;
  /** Index of its town (ctx.towns), and of its lot in that town's lots. */
  town: number;
  lot: number;
  /** Houses of one packed row share a row number (unique within the town); -1 for a building on its own. */
  row: number;
}

export interface Lot {
  /** The hex its middle lies in. */
  hex: HexId;
  ring: number[];
  area: number;
  /** Whether it fronts a road. */
  fronts: boolean;
  /** Indices into the town's buildings. */
  buildings: number[];
}

export interface TownPlan {
  name: string;
  hexes: HexId[];
  /** The blocks the lots were divided from. */
  blocks: number[][];
  lots: Lot[];
  buildings: Building[];
}

interface Cutter {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  clear: number;
  road: boolean;
}

/** The area of a hex, in square h: one across flats, so the same number as the step between columns. */
const HEX_AREA = COL_STEP;
/** How far the end of a line that joins another is carried on: across that line's corridor edge. */
const JOIN = 0.2;

function signedArea(ring: readonly number[]): number {
  let a = 0;
  const n = ring.length;
  for (let i = 0; i < n; i += 2) a += (ring[i] as number) * (ring[(i + 3) % n] as number) - (ring[(i + 2) % n] as number) * (ring[i + 1] as number);
  return a / 2;
}

function centroidOf(ring: readonly number[]): [number, number] {
  let a = 0;
  let cx = 0;
  let cy = 0;
  const n = ring.length;
  for (let i = 0; i < n; i += 2) {
    const x0 = ring[i] as number;
    const y0 = ring[i + 1] as number;
    const x1 = ring[(i + 2) % n] as number;
    const y1 = ring[(i + 3) % n] as number;
    const w = x0 * y1 - x1 * y0;
    a += w;
    cx += (x0 + x1) * w;
    cy += (y0 + y1) * w;
  }
  if (Math.abs(a) < 1e-12) return [ring[0] as number, ring[1] as number];
  return [cx / (3 * a), cy / (3 * a)];
}

/** A ring with every side moved in by `inset` (corners are where the moved sides meet). For outlines of hexes: no two sides in a row are parallel. */
function insetRing(ring: readonly number[], inset: number): number[] {
  const n = ring.length / 2;
  const sign = signedArea(ring) > 0 ? 1 : -1;
  const lines: [number, number, number, number][] = [];
  for (let i = 0; i < n; i++) {
    const px = ring[2 * i] as number;
    const py = ring[2 * i + 1] as number;
    const qx = ring[(2 * i + 2) % ring.length] as number;
    const qy = ring[(2 * i + 3) % ring.length] as number;
    const l = Math.hypot(qx - px, qy - py);
    // Inward normal: to the left of the edge when the ring's area is positive.
    const nx = (-(qy - py) / l) * sign;
    const ny = ((qx - px) / l) * sign;
    lines.push([px + nx * inset, py + ny * inset, qx - px, qy - py]);
  }
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = lines[(i + n - 1) % n] as [number, number, number, number];
    const b = lines[i] as [number, number, number, number];
    const den = a[2] * b[3] - a[3] * b[2];
    if (Math.abs(den) < 1e-12) {
      out.push(b[0], b[1]);
      continue;
    }
    const t = ((b[0] - a[0]) * b[3] - (b[1] - a[1]) * b[2]) / den;
    out.push(a[0] + a[2] * t, a[1] + a[3] * t);
  }
  return out;
}

/**
 * Cut a simple ring along the line through (px, py) with normal (nx, ny).
 * The line may cross the ring several times; each stretch of it inside the
 * ring is a cut, and with `span` only the stretches that overlap that part of
 * the line (measured along it from the point) are made. Null when nothing is cut.
 */
function splitRing(ring: readonly number[], px: number, py: number, nx: number, ny: number, span?: readonly [number, number]): number[][] | null {
  const n = ring.length / 2;
  const dx = -ny;
  const dy = nx;
  interface V {
    x: number;
    y: number;
    tag: number;
    t: number;
  }
  const side: number[] = [];
  for (let i = 0; i < n; i++) {
    const s = ((ring[2 * i] as number) - px) * nx + ((ring[2 * i + 1] as number) - py) * ny;
    side.push(Math.abs(s) < 1e-9 ? 1e-9 : s);
  }
  const verts: V[] = [];
  const cuts: V[] = [];
  for (let i = 0; i < n; i++) {
    const x = ring[2 * i] as number;
    const y = ring[2 * i + 1] as number;
    verts.push({ x, y, tag: -1, t: 0 });
    const j = (i + 1) % n;
    const si = side[i] as number;
    const sj = side[j] as number;
    if (si * sj < 0) {
      const k = si / (si - sj);
      const cxp = x + ((ring[2 * j] as number) - x) * k;
      const cyp = y + ((ring[2 * j + 1] as number) - y) * k;
      const v: V = { x: cxp, y: cyp, tag: -1, t: (cxp - px) * dx + (cyp - py) * dy };
      verts.push(v);
      cuts.push(v);
    }
  }
  // A line crosses a ring an even number of times; anything else is a graze, and nothing is cut.
  if (cuts.length < 2 || !Number.isInteger(cuts.length / 2)) return null;
  cuts.sort((a, b) => a.t - b.t);
  let made = 0;
  for (let k = 0; k + 1 < cuts.length; k += 2) {
    const a = cuts[k] as V;
    const b = cuts[k + 1] as V;
    if (b.t - a.t < 1e-6) continue;
    if (span && (b.t < span[0] || a.t > span[1])) continue;
    if (!inRings((a.x + b.x) / 2, (a.y + b.y) / 2, [ring])) continue;
    a.tag = made;
    b.tag = made;
    made++;
  }
  if (made === 0) return null;
  const out: number[][] = [];
  const carve = (list: V[]): void => {
    const i = list.findIndex(v => v.tag >= 0);
    if (i < 0) {
      if (list.length >= 3) {
        const flat = list.flatMap(v => [v.x, v.y]);
        if (Math.abs(signedArea(flat)) > 1e-7) out.push(flat);
      }
      return;
    }
    const tag = (list[i] as V).tag;
    const j = list.findIndex((v, k) => k !== i && v.tag === tag);
    if (j < 0) {
      (list[i] as V).tag = -1;
      carve(list);
      return;
    }
    const lo = Math.min(i, j);
    const hi = Math.max(i, j);
    const plain = (v: V): V => ({ x: v.x, y: v.y, tag: -1, t: v.t });
    const a = list.slice(lo, hi + 1).map((v, k, arr) => (k === 0 || k === arr.length - 1 ? plain(v) : v));
    const b = [...list.slice(hi), ...list.slice(0, lo + 1)].map((v, k, arr) => (k === 0 || k === arr.length - 1 ? plain(v) : v));
    carve(a);
    carve(b);
  };
  carve(verts);
  return out.length >= 2 ? out : null;
}

/**
 * Cut a simple ring along an open line that crosses it: each stretch of the
 * line that runs through the ring from side to side parts it in two. A line
 * that only reaches into the ring, or ends in it, cuts nothing there.
 */
function cutAlong(ring: readonly number[], line: readonly number[]): number[][] {
  const n = ring.length / 2;
  const m = line.length / 2;
  interface Hit {
    /** Place along the line: segment number plus the share of it. */
    s: number;
    /** The ring edge it lies on, and the share of that edge. */
    edge: number;
    u: number;
    x: number;
    y: number;
  }
  const hits: Hit[] = [];
  for (let k = 0; k + 1 < m; k++) {
    const ax = line[2 * k] as number;
    const ay = line[2 * k + 1] as number;
    const dx = (line[2 * k + 2] as number) - ax;
    const dy = (line[2 * k + 3] as number) - ay;
    for (let e = 0; e < n; e++) {
      const px = ring[2 * e] as number;
      const py = ring[2 * e + 1] as number;
      const ex = (ring[(2 * e + 2) % ring.length] as number) - px;
      const ey = (ring[(2 * e + 3) % ring.length] as number) - py;
      const den = dx * ey - dy * ex;
      if (Math.abs(den) < 1e-12) continue;
      const t = ((px - ax) * ey - (py - ay) * ex) / den;
      const u = ((px - ax) * dy - (py - ay) * dx) / den;
      if (t < 0 || t >= 1 || u < 0 || u >= 1) continue;
      hits.push({ s: k + t, edge: e, u, x: ax + dx * t, y: ay + dy * t });
    }
  }
  if (hits.length < 2) return [ring.slice()];
  hits.sort((a, b) => a.s - b.s);
  const pointAt = (s: number): [number, number] => {
    const k = Math.min(m - 2, Math.floor(s));
    const t = s - k;
    return [(line[2 * k] as number) + ((line[2 * k + 2] as number) - (line[2 * k] as number)) * t, (line[2 * k + 1] as number) + ((line[2 * k + 3] as number) - (line[2 * k + 1] as number)) * t];
  };
  for (let h = 0; h + 1 < hits.length; h++) {
    const a = hits[h] as Hit;
    const b = hits[h + 1] as Hit;
    if (b.s - a.s < 1e-6) continue;
    const mid = pointAt((a.s + b.s) / 2);
    if (!inRings(mid[0], mid[1], [ring])) continue;
    // The line's own points between the two crossings.
    const path: number[] = [];
    for (let k = Math.floor(a.s) + 1; k <= Math.floor(b.s); k++) {
      if (k > a.s + 1e-9 && k < b.s - 1e-9) path.push(line[2 * k] as number, line[2 * k + 1] as number);
    }
    const back: number[] = [];
    for (let k = path.length - 2; k >= 0; k -= 2) back.push(path[k] as number, path[k + 1] as number);
    /** The ring's corners met going on round it from a point on edge e1 (at share u1) to a point on edge e2 (at u2). */
    const walk = (e1: number, u1: number, e2: number, u2: number): number[] => {
      const out: number[] = [];
      if (e1 === e2 && u1 < u2) return out;
      let e = (e1 + 1) % n;
      for (let guard = 0; guard <= n; guard++) {
        out.push(ring[2 * e] as number, ring[2 * e + 1] as number);
        if (e === e2) break;
        e = (e + 1) % n;
      }
      return out;
    };
    const one = [a.x, a.y, ...path, b.x, b.y, ...walk(b.edge, b.u, a.edge, a.u)];
    const two = [b.x, b.y, ...back, a.x, a.y, ...walk(a.edge, a.u, b.edge, b.u)];
    if (Math.abs(signedArea(one)) < 1e-7 || Math.abs(signedArea(two)) < 1e-7) continue;
    // The rest of the line may cut either part again.
    const rest: number[] = [...pointAt(b.s + 1e-4)];
    for (let k = Math.floor(b.s + 1e-4) + 1; k < m; k++) rest.push(line[2 * k] as number, line[2 * k + 1] as number);
    if (rest.length < 4) return [one, two];
    return [...cutAlong(one, rest), ...cutAlong(two, rest)];
  }
  return [ring.slice()];
}

/** A line moved sideways by `off` (to its left when positive), its first and last points carried on by `extend0` and `extend1`. */
function offsetLine(pts: readonly (readonly [number, number])[], off: number, extend0: number, extend1: number): number[] {
  const n = pts.length;
  const out: number[] = [];
  const dir = (i: number): [number, number] => {
    const a = pts[i] as readonly [number, number];
    const b = pts[i + 1] as readonly [number, number];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
  };
  for (let i = 0; i < n; i++) {
    const d0 = dir(Math.max(0, i - 1));
    const d1 = dir(Math.min(n - 2, i));
    // The mitre of the two normals.
    let mx = -d0[1] - d1[1];
    let my = d0[0] + d1[0];
    const ml = Math.hypot(mx, my) || 1;
    mx /= ml;
    my /= ml;
    const k = off / Math.max(0.5, mx * -d1[1] + my * d1[0]);
    let x = (pts[i] as readonly [number, number])[0] + mx * k;
    let y = (pts[i] as readonly [number, number])[1] + my * k;
    if (i === 0) {
      x -= d1[0] * extend0;
      y -= d1[1] * extend0;
    }
    if (i === n - 1) {
      x += d0[0] * extend1;
      y += d0[1] * extend1;
    }
    out.push(x, y);
  }
  return out;
}

/** Douglas-Peucker on an open line of points. */
function simplify(pts: readonly (readonly [number, number])[], tol: number): [number, number][] {
  if (pts.length <= 2) return pts.map(p => [p[0], p[1]]);
  const keep = new Uint8Array(pts.length);
  keep[0] = 1;
  keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length > 0) {
    const [a, b] = stack.pop() as [number, number];
    let worst = -1;
    let worstD = tol;
    const pa = pts[a] as readonly [number, number];
    const pb = pts[b] as readonly [number, number];
    for (let i = a + 1; i < b; i++) {
      const p = pts[i] as readonly [number, number];
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
  const out: [number, number][] = [];
  pts.forEach((p, i) => {
    if (keep[i]) out.push([p[0], p[1]]);
  });
  return out;
}

/** Whole numbers that say where a point lies, for hashing (a thousandth of h). */
const place = (v: number) => Math.round(v * 1000);

export function buildTowns(ctx: MapContext, lines: CentreLines): TownPlan[] {
  const { g, seed } = ctx;
  const T = ctx.art.params.towns;
  const roadHW = ctx.art.params.roads.casingHalfWidth;
  const bankHW = ctx.art.params.rivers.bankHalfWidth;
  const types: BuildingType[] = Object.entries(T.types).map(([id, t]) => ({ id, ...t })) as BuildingType[];
  const plans: TownPlan[] = [];

  ctx.towns.forEach((town, ti) => {
    const inTown = new Set(town.hexes);
    const townId = town.hexes[0] as HexId;
    const townTurn = unit(seed, 'town-turn', townId) * Math.PI;

    // ---- the true lines through and beside the town ----
    const outline = hexSetOutline(g, inTown);
    let bx0 = Infinity;
    let by0 = Infinity;
    let bx1 = -Infinity;
    let by1 = -Infinity;
    for (const r of outline) {
      for (let i = 0; i < r.length; i += 2) {
        bx0 = Math.min(bx0, r[i] as number);
        bx1 = Math.max(bx1, r[i] as number);
        by0 = Math.min(by0, r[i + 1] as number);
        by1 = Math.max(by1, r[i + 1] as number);
      }
    }
    const trueLines: { line: number[]; road: boolean }[] = [];
    for (const [strokes, road] of [[lines.roads, true], [lines.rivers, false]] as const) {
      for (const st of strokes) {
        let run: number[] = [];
        for (let i = 0; i < st.line.length; i += 2) {
          const x = st.line[i] as number;
          const y = st.line[i + 1] as number;
          if (x > bx0 - 0.4 && x < bx1 + 0.4 && y > by0 - 0.4 && y < by1 + 0.4) run.push(x, y);
          else if (run.length > 0) {
            if (run.length >= 4) trueLines.push({ line: run, road });
            run = [];
          }
        }
        if (run.length >= 4) trueLines.push({ line: run, road });
      }
    }
    const cutters: Cutter[] = [];
    const corridors: { simple: [number, number][]; clear: number; extend: [number, number] }[] = [];
    /**
     * How far a line's end is carried on before the ground is cut along it: a little where it joins
     * another line (to reach that line's own corridor); right across the town where it ends in the
     * town's ground (a dead end: the lane runs on as the line between two blocks); a little otherwise.
     */
    const carryOn = (x: number, y: number, own: readonly number[]): number => {
      for (const other of trueLines) {
        if (other.line === own) continue;
        for (let i = 0; i + 3 < other.line.length; i += 2) {
          if (segDist(x, y, other.line[i] as number, other.line[i + 1] as number, other.line[i + 2] as number, other.line[i + 3] as number) < 0.1) return JOIN;
        }
      }
      return inTown.has(worldToHex(g, x, y)) ? 1.4 : 0.35;
    };
    for (const tl of trueLines) {
      const pts: [number, number][] = [];
      for (let i = 0; i < tl.line.length; i += 2) pts.push([tl.line[i] as number, tl.line[i + 1] as number]);
      const simple = simplify(pts, 0.02);
      const clear = tl.road ? roadHW + T.roadGap : bankHW + T.riverClearance;
      if (simple.length >= 2) {
        const n = tl.line.length;
        corridors.push({ simple, clear, extend: [carryOn(tl.line[0] as number, tl.line[1] as number, tl.line), carryOn(tl.line[n - 2] as number, tl.line[n - 1] as number, tl.line)] });
      }
      for (let i = 0; i + 1 < simple.length; i++) {
        const a = simple[i] as [number, number];
        const b = simple[i + 1] as [number, number];
        if (Math.hypot(b[0] - a[0], b[1] - a[1]) > 1e-6) cutters.push({ ax: a[0], ay: a[1], bx: b[0], by: b[1], clear, road: tl.road });
      }
    }

    /** The road nearest a point: its direction there, how far off it is, and the point of it. */
    const roadAt = (x: number, y: number): { angle: number; dist: number; px: number; py: number } => {
      let best = Infinity;
      let angle = townTurn;
      let px = x;
      let py = y;
      for (const tl of trueLines) {
        if (!tl.road) continue;
        const l = tl.line;
        for (let i = 0; i + 3 < l.length; i += 2) {
          const ax = l[i] as number;
          const ay = l[i + 1] as number;
          const ex = (l[i + 2] as number) - ax;
          const ey = (l[i + 3] as number) - ay;
          const l2 = ex * ex + ey * ey;
          let t = l2 === 0 ? 0 : ((x - ax) * ex + (y - ay) * ey) / l2;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const d = Math.hypot(ax + ex * t - x, ay + ey * t - y);
          if (d < best) {
            best = d;
            angle = Math.atan2(ey, ex);
            px = ax + ex * t;
            py = ay + ey * t;
          }
        }
      }
      return { angle, dist: best, px, py };
    };
    const ringRoadDist = (ring: readonly number[]): number => {
      let best = Infinity;
      for (const tl of trueLines) if (tl.road) best = Math.min(best, polygonPolylineDist(ring, tl.line));
      return best;
    };

    // ---- blocks: the town's ground, less its roads and rivers ----
    const mainSign = outline.reduce((best, r) => (Math.abs(signedArea(r)) > Math.abs(best) ? signedArea(r) : best), 0) > 0 ? 1 : -1;
    let pieces: number[][] = outline.filter(r => Math.sign(signedArea(r)) === mainSign).map(r => insetRing(r, T.inset));
    // Each road and river is cut out as a corridor: the ground is parted along the line's two edges
    // (the centre line moved out by the casing or bank and its clearance), and what lies between goes.
    // A line that ends on another is cut after the lines that run through, so that it has an edge to end on.
    const joins = (k: { extend: [number, number] }) => (k.extend[0] === JOIN ? 1 : 0) + (k.extend[1] === JOIN ? 1 : 0);
    const inOrder = corridors.map((k, i) => ({ k, i })).sort((a, b) => joins(a.k) - joins(b.k) || a.i - b.i).map(e => e.k);
    // An edge that cuts nothing yet (the line it ends on is not cut out so far) is tried again after the others.
    let waiting = inOrder.flatMap(k => [1, -1].map(sideSign => offsetLine(k.simple, sideSign * k.clear, k.extend[0], k.extend[1])));
    for (let round = 0; round < 4 && waiting.length > 0; round++) {
      const still: number[][] = [];
      for (const edge of waiting) {
        const before = pieces.length;
        pieces = pieces.flatMap(p => cutAlong(p, edge));
        if (pieces.length === before) still.push(edge);
      }
      if (still.length === waiting.length) break;
      waiting = still;
    }
    const blocks = pieces.filter(p => {
      if (Math.abs(signedArea(p)) < 0.006) return false;
      // A piece of a corridor lies wholly along its road or river: every corner of it within reach of the line.
      let farthest = 0;
      for (let i = 0; i < p.length; i += 2) {
        let near = Infinity;
        for (const k of cutters) near = Math.min(near, segDist(p[i] as number, p[i + 1] as number, k.ax, k.ay, k.bx, k.by) / k.clear);
        farthest = Math.max(farthest, near);
      }
      return farthest > 1.6;
    }).sort((a, b) => {
      const ca = centroidOf(a);
      const cb = centroidOf(b);
      return place(ca[1]) - place(cb[1]) || place(ca[0]) - place(cb[0]);
    });

    // ---- lots: each block divided again and again ----
    const lotRings: { ring: number[]; fronts: boolean; frame: number }[] = [];
    /**
     * Divide a piece of a block. `frame` is the block's own direction (that of the road nearest its middle),
     * kept all the way down, so that the lots of a block are square to one another. `a` is the frame's axis
     * that runs with the road the piece lies nearest, `b` the axis into the block from it.
     */
    const divide = (ring: number[], depth: number, frame: number): void => {
      const area = Math.abs(signedArea(ring));
      if (area < 0.006) return;
      const c = centroidOf(ring);
      const id = [place(c[0]), place(c[1]), depth];
      const road = roadAt(c[0], c[1]);
      const fronts = road.dist !== Infinity && ringRoadDist(ring) <= roadHW + T.roadGap + 0.03;
      let ax = Math.cos(frame);
      let ay = Math.sin(frame);
      if (fronts && Math.abs(ax * Math.cos(road.angle) + ay * Math.sin(road.angle)) < Math.SQRT1_2) [ax, ay] = [-ay, ax];
      const bx = -ay;
      const by = ax;
      let a0 = Infinity;
      let a1 = -Infinity;
      let b0 = Infinity;
      let b1 = -Infinity;
      for (let i = 0; i < ring.length; i += 2) {
        const da = ((ring[i] as number) - c[0]) * ax + ((ring[i + 1] as number) - c[1]) * ay;
        const db = ((ring[i] as number) - c[0]) * bx + ((ring[i + 1] as number) - c[1]) * by;
        a0 = Math.min(a0, da);
        a1 = Math.max(a1, da);
        b0 = Math.min(b0, db);
        b1 = Math.max(b1, db);
      }
      const big = unit(seed, 'town-lot-big', ...id) < T.bigLotShare ? 1.45 : 1;
      const depthMax = T.lotDepthMax * big;
      const roll = unit(seed, 'town-lot-cut', ...id);
      // A lot on a road is longer along it than a lot inside a block: room for a row of houses side by side.
      const frontMax = (T.lotFrontMin + (T.lotFrontMax - T.lotFrontMin) * unit(seed, 'town-lot-front', ...id)) * big * (fronts ? T.frontageStretch : 1);
      const db = b1 - b0;
      const da = a1 - a0;
      let cut: { x: number; y: number; nx: number; ny: number } | null = null;
      const alongRoad = (): void => {
        // Parallel to the road: one lot's depth back from it when the piece fronts it, else near the middle.
        let at = b0 + db * (0.4 + 0.2 * roll);
        if (fronts) {
          const lotDepth = T.lotDepth * (0.94 + 0.16 * roll) * big;
          const roadSide = (road.px - c[0]) * bx + (road.py - c[1]) * by < 0 ? -1 : 1;
          at = roadSide < 0 ? b0 + lotDepth : b1 - lotDepth;
        }
        cut = { x: c[0] + bx * at, y: c[1] + by * at, nx: bx, ny: by };
      };
      const across = (): void => {
        // Across the road's direction: into as many parts as the frontage holds, the cut nearest the middle.
        const parts = Math.max(2, Math.ceil(da / frontMax));
        const at = a0 + da * (Math.floor(parts / 2) / parts + 0.06 * (roll - 0.5));
        cut = { x: c[0] + ax * at, y: c[1] + ay * at, nx: ax, ny: ay };
      };
      // A piece is cut parallel to the road only if both parts stay deep enough for a building (a lot a little
      // deeper than the rest is better than two too shallow to build on).
      const deep = db > depthMax && (fronts ? db - T.lotDepth * 1.1 * big >= T.lotDepthMin : db >= 2 * T.lotDepthMin + 0.02);
      if (depth < 14) {
        if (deep && db / depthMax >= da / frontMax) alongRoad();
        else if (da > frontMax) across();
        else if (deep) alongRoad();
      }
      const parts = cut ? splitRing(ring, (cut as { x: number }).x, (cut as { y: number }).y, (cut as { nx: number }).nx, (cut as { ny: number }).ny) : null;
      if (!parts) {
        lotRings.push({ ring, fronts, frame });
        return;
      }
      for (const p of parts) divide(p, depth + 1, frame);
    };
    for (const b of blocks) {
      const bc = centroidOf(b);
      divide(b, 0, roadAt(bc[0], bc[1]).angle);
    }
    lotRings.sort((a, b) => {
      const ca = centroidOf(a.ring);
      const cb = centroidOf(b.ring);
      return place(ca[1]) - place(cb[1]) || place(ca[0]) - place(cb[0]);
    });
    const lots: Lot[] = [];
    const lotFrames: number[] = [];
    // The town's own edge: a lot that lies along it is an outer lot.
    const townEdge = outline.filter(r => Math.sign(signedArea(r)) === mainSign).map(r => insetRing(r, T.inset));
    for (const l of lotRings) {
      const c = centroidOf(l.ring);
      let h = worldToHex(g, c[0], c[1]);
      if (!inTown.has(h)) {
        // A lot bent round a corner may have its middle outside it: the hex of its first corner inside the town, then.
        h = -1;
        for (let i = 0; i < l.ring.length && h < 0; i += 2) {
          const hh = worldToHex(g, (l.ring[i] as number) * 0.98 + c[0] * 0.02, (l.ring[i + 1] as number) * 0.98 + c[1] * 0.02);
          if (inTown.has(hh)) h = hh;
        }
        if (h < 0) continue;
      }
      lots.push({ hex: h, ring: l.ring, area: Math.abs(signedArea(l.ring)), fronts: l.fronts, buildings: [] });
      lotFrames.push(l.frame);
    }

    // ---- buildings ----
    const buildings: Building[] = [];
    const covered = new Map<HexId, number>();
    const cover = (h: HexId) => (covered.get(h) ?? 0) / HEX_AREA;
    const perType = new Map<string, number>();
    let rows = 0;
    let rowsOfThree = 0;
    const special = (t: BuildingType) => t.roof === 'cross' || t.roof === 'hip';
    const specialsAllowed = (t: BuildingType): boolean => {
      if (t.roof === 'cross') return (perType.get(t.id) ?? 0) < 1;
      if (t.roof === 'hip') return (perType.get(t.id) ?? 0) < Math.max(1, Math.ceil(town.hexes.length / 3));
      return true;
    };

    /** Stand buildings on one lot. `topUp`: a second visit, to a lot left open in a hex that came out too bare. */
    const workLot = (lot: Lot, li: number, topUp: boolean, firstSlot = 0): void => {
      if (lot.area < 0.012) return;
      const c = centroidOf(lot.ring);
      const id = [place(c[0]), place(c[1])];
      if (!topUp && unit(seed, 'town-lot-empty', ...id) < T.emptyShare) return;
      // The edge of the built ground straggles: of the lots along the town's own edge and off any road, some
      // stay open, so that the buildings do not trace the outline of the hexes.
      if (!lot.fronts && !topUp) {
        let onEdge = false;
        for (const e of townEdge) {
          for (let i = 0; i < lot.ring.length && !onEdge; i += 2) {
            const mx = ((lot.ring[i] as number) + (lot.ring[(i + 2) % lot.ring.length] as number)) / 2;
            const my = ((lot.ring[i + 1] as number) + (lot.ring[(i + 3) % lot.ring.length] as number)) / 2;
            for (let k = 0; k < e.length; k += 2) {
              if (segDist(mx, my, e[k] as number, e[k + 1] as number, e[(k + 2) % e.length] as number, e[(k + 3) % e.length] as number) < 0.01) onEdge = true;
            }
          }
        }
        if (onEdge && unit(seed, 'town-lot-edge', ...id) < (town.hexes.length >= 3 ? T.edgeOpenShare : T.edgeOpenShare / 2)) return;
      }
      // The lot's frame: u along its frontage, v from the frontage into the lot. The frontage is the side
      // of the lot that lies along the road (the longest of its sides nearest the road), or, off any road,
      // its longest side.
      let frontDist = Infinity;
      const sides: { len: number; dist: number; dx: number; dy: number }[] = [];
      for (let i = 0; i < lot.ring.length; i += 2) {
        const px = lot.ring[i] as number;
        const py = lot.ring[i + 1] as number;
        const qx = lot.ring[(i + 2) % lot.ring.length] as number;
        const qy = lot.ring[(i + 3) % lot.ring.length] as number;
        const len = Math.hypot(qx - px, qy - py);
        if (len < 1e-6) continue;
        const dist = lot.fronts ? roadAt((px + qx) / 2, (py + qy) / 2).dist : 0;
        frontDist = Math.min(frontDist, dist);
        sides.push({ len, dist, dx: (qx - px) / len, dy: (qy - py) / len });
      }
      // Off the road, a side that runs with the nearest road (or square to it) is taken before a longer one that does not,
      // so the buildings of a block keep to its streets' directions.
      const roadHere = roadAt(c[0], c[1]);
      const squareness = (s: { dx: number; dy: number }): number => {
        if (roadHere.dist === Infinity) return 1;
        const along = Math.abs(s.dx * Math.cos(roadHere.angle) + s.dy * Math.sin(roadHere.angle));
        return Math.max(along, Math.sqrt(Math.max(0, 1 - along * along))) > 0.985 ? 1 : 0.6;
      };
      const frontage = sides
        .filter(s => s.dist <= frontDist + 0.03)
        .sort((a, b) => (lot.fronts ? b.len - a.len : b.len * squareness(b) - a.len * squareness(a)))[0] as { dx: number; dy: number };
      let ux = frontage.dx;
      let uy = frontage.dy;
      if (!lot.fronts) {
        // Off the road a building stands square to its block: along the block's frame, the way the lot is longer.
        const f = lotFrames[li] as number;
        ux = Math.cos(f);
        uy = Math.sin(f);
        let du = 0;
        let dv = 0;
        for (const sd of sides) {
          du += Math.abs(sd.dx * ux + sd.dy * uy) * sd.len;
          dv += Math.abs(-sd.dx * uy + sd.dy * ux) * sd.len;
        }
        if (dv > du) [ux, uy] = [-uy, ux];
      }
      let vx = -uy;
      let vy = ux;
      const extents = (): [number, number, number, number] => {
        let u0 = Infinity;
        let u1 = -Infinity;
        let v0 = Infinity;
        let v1 = -Infinity;
        for (let i = 0; i < lot.ring.length; i += 2) {
          const du = ((lot.ring[i] as number) - c[0]) * ux + ((lot.ring[i + 1] as number) - c[1]) * uy;
          const dv = ((lot.ring[i] as number) - c[0]) * vx + ((lot.ring[i + 1] as number) - c[1]) * vy;
          u0 = Math.min(u0, du);
          u1 = Math.max(u1, du);
          v0 = Math.min(v0, dv);
          v1 = Math.max(v1, dv);
        }
        return [u0, u1, v0, v1];
      };
      let [u0, u1, v0, v1] = extents();
      if (lot.fronts) {
        // v points away from the road.
        const road = roadAt(c[0], c[1]);
        if ((road.px - c[0]) * vx + (road.py - c[1]) * vy > 0) {
          vx = -vx;
          vy = -vy;
          ux = -ux;
          uy = -uy;
          [u0, u1, v0, v1] = extents();
        }
      }
      // What already stands on the lot (a second visit adds to it).
      const mine: number[][] = lot.buildings.map(i => (buildings[i] as Building).ring);
      const m = T.lotMargin;

      /**
       * Whether a row of `count` buildings, each w wide and d deep, sharing their side walls, may stand with its
       * middle at (pu, pv) of the lot's frame; their rings if so. Houses of a row share their corners to the last digit.
       */
      const stand = (pu: number, pv: number, w: number, d: number, count: number): number[][] | null => {
        const corner = (su: number, sv: number): [number, number] => [c[0] + ux * (pu + su) + vx * (pv + sv), c[1] + uy * (pu + su) + vy * (pv + sv)];
        const hw = (count * w) / 2;
        const hd = d / 2;
        // The row's rectangle grown by the lot's margin lies in the lot and in the town: its corners and points along its sides.
        const along = count === 1 ? [-1, -0.5, 0, 0.5, 1] : [-1, -0.75, -0.5, -0.25, 0, 0.25, 0.5, 0.75, 1];
        for (const sv of [-1, 1]) {
          for (const su of along) {
            const p = corner(su * (hw + m), sv * (hd + m));
            if (!inRings(p[0], p[1], [lot.ring]) || !inTown.has(worldToHex(g, p[0], p[1]))) return null;
          }
        }
        for (const su of [-1, 1]) {
          const p = corner(su * (hw + m), 0);
          if (!inRings(p[0], p[1], [lot.ring])) return null;
        }
        const whole = [...corner(-hw, -hd), ...corner(hw, -hd), ...corner(hw, hd), ...corner(-hw, hd)];
        for (const o of mine) if (convexOverlap(whole, o, T.buildingGap)) return null;
        for (const tl of trueLines) {
          const clear = tl.road ? roadHW + T.roadGap * 0.5 : bankHW + T.riverClearance;
          if (polygonPolylineDist(whole, tl.line) <= clear) return null;
        }
        const cuts: number[] = [];
        for (let k = 0; k <= count; k++) cuts.push(-hw + k * w);
        cuts[count] = hw;
        const low = cuts.map(su => corner(su, -hd));
        const high = cuts.map(su => corner(su, hd));
        const rings: number[][] = [];
        for (let k = 0; k < count; k++) rings.push([...(low[k] as number[]), ...(low[k + 1] as number[]), ...(high[k + 1] as number[]), ...(high[k] as number[])]);
        return rings;
      };
      const addBuilding = (ring: number[], t: BuildingType, w: number, d: number, row: number): void => {
        const cx = ((ring[0] as number) + (ring[4] as number)) / 2;
        const cy = ((ring[1] as number) + (ring[5] as number)) / 2;
        lot.buildings.push(buildings.length);
        buildings.push({
          hex: worldToHex(g, cx, cy), ring, cx, cy, angle: Math.atan2(uy, ux), halfLen: w / 2, halfDepth: d / 2,
          type: t.id, family: t.family, roof: t.roof, town: ti, lot: li, row,
        });
        mine.push(ring);
        // Counted to the hex the building's own middle lies in (a lot may lie across two hexes).
        const bh = worldToHex(g, cx, cy);
        covered.set(bh, (covered.get(bh) ?? 0) + w * d);
        perType.set(t.id, (perType.get(t.id) ?? 0) + 1);
      };
      const rowable = (t: BuildingType) => !special(t) && t.width <= 1.6 && t.roof !== 'flat';

      for (let slot = firstSlot; slot < firstSlot + 4; slot++) {
        if (cover(lot.hex) >= T.coverMax) break;
        // The frontage of a lot on a road takes the frontage types (the first weights: rows of houses, long
        // buildings), close to the road and along it; every other place takes the looser types (the other weights).
        const frontage = slot <= 2 && lot.fronts;
        const needRow = frontage && town.hexes.length >= 3 && rowsOfThree === 0;
        const order = types
          .map(t => ({ t, w: frontage ? t.first : t.other }))
          .filter(e => e.w > 0 && specialsAllowed(e.t))
          .map(e => ({ t: e.t, key: -Math.log(1 - unit(seed, 'town-type', ...id, slot, hash32(seed, e.t.id) % 100000)) / e.w }))
          .sort((a, b) => (needRow ? Number(rowable(b.t)) - Number(rowable(a.t)) : 0) || a.key - b.key || (a.t.id < b.t.id ? -1 : 1));
        // The special buildings (the town centre, the church) are large and few: a town of two hexes or more that
        // has none yet tries one first wherever a lot is large enough for it (a church: four hexes or more).
        if (slot === 0) {
          for (const sp of types.filter(t => special(t) && (perType.get(t.id) ?? 0) === 0 && town.hexes.length >= (t.roof === 'cross' ? 4 : 2))) {
            if (u1 - u0 >= sp.width * T.baseSize + 2 * m && v1 - v0 >= sp.height * T.baseSize + 2 * m) order.unshift({ t: sp, key: -1 });
          }
        }
        let stood = false;
        for (const { t } of order.slice(0, slot === 0 ? order.length : 8)) {
          for (const shrink of [1, 0.87]) {
            if (stood) break;
            const scale = (1 + T.scaleVariation * (2 * unit(seed, 'town-scale', ...id, slot) - 1)) * shrink;
            const w = t.width * T.baseSize * scale;
            const d = t.height * T.baseSize * scale;
            // A house type stands as a packed row of two or three where the frontage is long enough: most often
            // on a road, now and then inside a block.
            let count = 1;
            if (rowable(t)) {
              const room = u1 - u0 - 2 * m;
              const most = room >= 3 * w ? 3 : room >= 2 * w ? 2 : 1;
              const roll = unit(seed, 'town-row', ...id, slot);
              if (frontage) count = needRow || roll < T.rowShare ? most : 1;
              else count = roll < T.rowShare * 0.2 ? Math.min(2, most) : 1;
            }
            for (; count >= 1 && !stood; count--) {
              // A town still in want of its row of three tries the house a little smaller before it settles for two.
              if (needRow && rowable(t) && shrink === 1 && count < 3) break;
              const total = count * w;
              if (u1 - u0 < total + 2 * m || v1 - v0 < d + 2 * m) continue;
              // Places: on the frontage first, as near it as may be; the middle of the frontage before its ends.
              const places: [number, number][] = [];
              const STEP = 0.014;
              for (let pv = v0 + m + d / 2; pv <= v1 - m - d / 2 + 1e-9; pv += STEP) {
                const row: [number, number][] = [];
                for (let pu = u0 + m + total / 2; pu <= u1 - m - total / 2 + 1e-9; pu += STEP) row.push([pu, pv]);
                // On a road the buildings pack along the frontage from one end, with even gaps; elsewhere the middle first.
                const mid = (u0 + u1) / 2;
                if (!frontage) row.sort((a, b) => Math.abs(a[0] - mid) - Math.abs(b[0] - mid) || a[0] - b[0]);
                places.push(...row);
              }
              for (const [pu, pv] of places) {
                const rings = stand(pu, pv, w, d, count);
                if (!rings) continue;
                const row = count > 1 ? rows++ : -1;
                if (count === 3) rowsOfThree++;
                for (const r of rings) addBuilding(r, t, w, d, row);
                stood = true;
                break;
              }
            }
          }
          if (stood) break;
        }
        if (!stood) break;
      }
    };
    lots.forEach((lot, li) => workLot(lot, li, false));
    // A hex left too bare (its lots mostly open, or mostly road) has its open lots built on after all.
    // (A lot may lie across two hexes: it is visited for any hex a corner of it lies in.)
    const bare = (lot: Lot): boolean => {
      if (cover(lot.hex) < T.coverMin) return true;
      for (let i = 0; i < lot.ring.length; i += 2) {
        const h = worldToHex(g, lot.ring[i] as number, lot.ring[i + 1] as number);
        if (inTown.has(h) && cover(h) < T.coverMin) return true;
      }
      return false;
    };
    lots.forEach((lot, li) => {
      if (lot.buildings.length === 0 && bare(lot)) workLot(lot, li, true);
    });
    // And if that was not enough (a hex that is mostly road), the lots that hold a building take another behind it.
    lots.forEach((lot, li) => {
      if (lot.buildings.length > 0 && bare(lot)) workLot(lot, li, true, 4);
    });
    plans.push({ name: town.name, hexes: [...town.hexes], blocks, lots, buildings });
  });
  return plans;
}
