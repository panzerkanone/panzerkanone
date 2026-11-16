/**
 * The one centre line of every road and river (PLAN.md 6.3: drawing,
 * clearings, building clearance, bridges and labels all read it).
 *
 * Recipe (docs/research/2026-11/techniques-procgen-drawing.md 4.1, with the
 * owner's rulings in docs/bars/M3a.md):
 *   - knots on hexside midpoints, so a line crosses every hexside at its middle;
 *   - the tangent at a knot blends the chord between its neighbouring knots
 *     with the side normal (tangentBlend 0.5 straightens a zigzag run without
 *     losing the arcs);
 *   - a cubic Bezier between knots, handles a fixed share of the knot spacing;
 *   - in a junction hex the two most opposite arms make the through curve and
 *     every other arm joins it halfway along;
 *   - a dead-end road stops at its hex centre;
 *   - a road at an exit, and a river at both ends, crosses the side that faces
 *     offMapStep (engine/core/map.ts) and runs straight on past the board;
 *   - a small wobble (roads) or meander (rivers) inside a hex, zero at the knots.
 *
 * Everything is built from sets (road edges, sorted), in canonical directions,
 * so neither the order of the map file's lists nor the direction a chain is
 * written in changes a single point.
 */
import {
  Dir, HexId, centreOf, coordOf, directionTo, neighbourOf, sideKey, sideMidpoint, stepAt,
} from '../engine/core/hex';
import { hexOf, offMapStep } from '../engine/core/map';
import { MapContext } from './context';
import { SegmentIndex, Vec, cubicAt, cubicPoints, dist, dot, norm, perp, segmentIntersection, sub } from './geom';
import { signedUnit, unit } from './random';

export interface Stroke {
  /** Flat x0, y0, x1, y1, ... */
  line: number[];
  /** A river only, and only a tributary or a stream that rises at a spring: the share of a river's widths it is drawn at. */
  width?: number;
  /** A river only, one that rises at a spring: which end of the line the spring is at (it widens from nothing there). */
  spring?: 'start' | 'end';
}

export interface Bridge {
  hex: HexId;
  point: Vec;
  /** Unit tangent of the road at the crossing. */
  roadTangent: Vec;
}

export interface CentreLines {
  roads: Stroke[];
  rivers: Stroke[];
  /** Hexes with three or more road arms. */
  junctions: Set<HexId>;
  /** Hexes where a road ends inside the board. */
  deadEnds: Set<HexId>;
  bridges: Bridge[];
  /** Every road and river segment, tagged 1 (road) or 2 (river). */
  index: SegmentIndex;
}

export const ROAD = 1;
export const RIVER = 2;

interface Arm {
  dir: Dir;
  exit: boolean;
}

/** The direction from `h` whose off-board step is the given coordinate. */
function dirToward(ctx: MapContext, h: HexId, target: [number, number]): Dir {
  const [col, row] = coordOf(ctx.g, h);
  for (let d = 0; d < 6; d++) {
    const [c, r] = stepAt(col, row, d);
    if (c === target[0] && r === target[1]) return d as Dir;
  }
  throw new Error(`no direction from hex ${h} reaches ${target[0]},${target[1]}`);
}

function unitBetween(a: Vec, b: Vec): Vec {
  return norm(sub(b, a));
}

/** Apply a sideways displacement (amplitude * shape(u)) along the left normal of a cubic. */
function bentCubic(p0: Vec, c1: Vec, c2: Vec, p1: Vec, n: number, amplitude: number, shape: (u: number) => number): Vec[] {
  if (amplitude === 0) return cubicPoints(p0, c1, c2, p1, n);
  const out: Vec[] = [];
  for (let k = 0; k <= n; k++) {
    const u = k / n;
    const { p, tangent } = cubicAt(p0, c1, c2, p1, u);
    const nrm = perp(tangent);
    const s = amplitude * shape(u);
    out.push([p[0] + nrm[0] * s, p[1] + nrm[1] * s]);
  }
  return out;
}

// Sideways shapes along one hex's run, from u = 0 to 1: zero, and level, at both knots, so a
// line keeps its direction from one hex to the next (no kink at a hexside).
const halfWave = (u: number) => Math.sin(Math.PI * u) ** 2;
const fullWave = (u: number) => Math.sin(2 * Math.PI * u) * Math.sin(Math.PI * u);

interface Piece {
  a: string;
  b: string;
  pts: Vec[];
}

/**
 * Join pieces (each a run of points between two end keys) into strokes. Knot
 * keys join exactly two pieces; terminal keys end strokes. Strokes start at
 * their lower-ranked terminal and are listed in that order.
 */
function joinPieces(pieces: Piece[], terminalRank: (key: string) => number | null): Vec[][] {
  const at = new Map<string, number[]>();
  pieces.forEach((p, i) => {
    for (const k of [p.a, p.b]) {
      const list = at.get(k);
      if (list) list.push(i);
      else at.set(k, [i]);
    }
  });
  const used = new Uint8Array(pieces.length);
  const strokes: Vec[][] = [];
  const walk = (start: string, first: number): Vec[] => {
    const pts: Vec[] = [];
    let key = start;
    let i = first;
    for (;;) {
      used[i] = 1;
      const piece = pieces[i] as Piece;
      const forward = piece.a === key;
      const run = forward ? piece.pts : [...piece.pts].reverse();
      if (pts.length === 0) pts.push(...run);
      else pts.push(...run.slice(1));
      key = forward ? piece.b : piece.a;
      if (terminalRank(key) !== null) break;
      const next = (at.get(key) ?? []).find(j => !used[j]);
      if (next === undefined) break;
      i = next;
    }
    return pts;
  };
  const terminals = [...at.keys()].filter(k => terminalRank(k) !== null).sort((x, y) => (terminalRank(x) as number) - (terminalRank(y) as number));
  for (const t of terminals) {
    for (const i of at.get(t) ?? []) if (!used[i]) strokes.push(walk(t, i));
  }
  // Closed loops, which have no terminal: start at the lowest knot.
  const rest = pieces.map((p, i) => ({ p, i })).filter(({ i }) => !used[i]);
  rest.sort((x, y) => (x.p.a < y.p.a ? -1 : x.p.a > y.p.a ? 1 : 0));
  for (const { p, i } of rest) if (!used[i]) strokes.push(walk(p.a, i));
  return strokes;
}

function flat(pts: readonly Vec[]): number[] {
  const out: number[] = [];
  for (const p of pts) out.push(p[0], p[1]);
  return out;
}

export function buildCentreLines(ctx: MapContext): CentreLines {
  const { g, art, seed } = ctx;
  const R = art.params.roads;
  const V = art.params.rivers;

  // ---------------- roads ----------------
  const arms = new Map<HexId, Arm[]>();
  const addArm = (h: HexId, a: Arm) => {
    const list = arms.get(h);
    if (list) list.push(a);
    else arms.set(h, [a]);
  };
  for (const [a, b] of ctx.roadEdges) {
    addArm(a, { dir: directionTo(g, a, b) as Dir, exit: false });
    addArm(b, { dir: directionTo(g, b, a) as Dir, exit: false });
  }
  for (const e of ctx.exits) {
    const own = arms.get(e) ?? [];
    const inner = own.map(a => neighbourOf(g, e, a.dir)).filter(h => h >= 0).sort((x, y) => x - y)[0];
    const step = offMapStep(g, inner === undefined ? [e] : [e, inner], true);
    if (step) addArm(e, { dir: dirToward(ctx, e, step), exit: true });
  }
  for (const list of arms.values()) list.sort((x, y) => x.dir - y.dir);

  const junctions = new Set<HexId>();
  const deadEnds = new Set<HexId>();
  const normalOf = (h: HexId, d: number): Vec => unitBetween(centreOf(g, h) as Vec, sideMidpoint(g, h, d) as Vec);
  // How each hex joins its arms: pairs of arms that make through curves (the first is the
  // main one), every other arm joining the main curve halfway along. A road chain of the map
  // that passes straight through a junction keeps its own curve there, the one in the longest
  // straight run of crossings first, so a junction never puts a kink in a straight road.
  const pairsOf = new Map<HexId, [number, number][]>();
  const chains = ctx.map.roads.map(c => c.map(l => hexOf(ctx.map, l)));
  const crossing = (a: HexId, b: HexId): Vec => sideMidpoint(g, a, directionTo(g, a, b)) as Vec;
  const collinear = (p: Vec, q: Vec, r: Vec) => Math.abs((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])) < 1e-6;
  /** Length of the straight run of crossing midpoints holding both crossings of chain c at its k-th hex. */
  const runLength = (c: readonly HexId[], k: number): number => {
    const mids: Vec[] = [];
    for (let j = 1; j < c.length; j++) mids.push(crossing(c[j - 1] as HexId, c[j] as HexId));
    // The k-th hex has crossings k - 1 and k (0-based in mids).
    const a = mids[k - 1] as Vec;
    const b = mids[k] as Vec;
    let lo = k - 1;
    let hi = k;
    while (lo - 1 >= 0 && collinear(a, b, mids[lo - 1] as Vec)) lo--;
    while (hi + 1 < mids.length && collinear(a, b, mids[hi + 1] as Vec)) hi++;
    return hi - lo + 1;
  };
  for (const [h, list] of [...arms.entries()].sort((x, y) => x[0] - y[0])) {
    if (list.length === 1) deadEnds.add(h);
    if (list.length === 2) pairsOf.set(h, [[0, 1]]);
    if (list.length < 3) continue;
    junctions.add(h);
    const armOf = (d: number) => list.findIndex(a => a.dir === d && !a.exit);
    const exitArm = list.findIndex(a => a.exit);
    const candidates: { i: number; j: number; run: number; dot: number }[] = [];
    const consider = (i: number, j: number, run: number) => {
      if (i < 0 || j < 0 || i === j) return;
      const [x, y] = i < j ? [i, j] : [j, i];
      if (candidates.some(c => c.i === x && c.j === y)) {
        const c = candidates.find(cc => cc.i === x && cc.j === y) as { run: number };
        c.run = Math.max(c.run, run);
        return;
      }
      candidates.push({ i: x, j: y, run, dot: dot(normalOf(h, (list[x] as Arm).dir), normalOf(h, (list[y] as Arm).dir)) });
    };
    for (const c of chains) {
      for (let k = 0; k < c.length; k++) {
        if (c[k] !== h) continue;
        if (k > 0 && k + 1 < c.length) {
          consider(armOf(directionTo(g, h, c[k - 1] as HexId)), armOf(directionTo(g, h, c[k + 1] as HexId)), runLength(c, k));
        } else if (exitArm >= 0 && c.length > 1) {
          const inner = (k === 0 ? c[1] : c[k - 1]) as HexId;
          consider(armOf(directionTo(g, h, inner)), exitArm, 2);
        }
      }
    }
    candidates.sort((a, b) => b.run - a.run || a.dot - b.dot || a.i - b.i || a.j - b.j);
    const used = new Set<number>();
    const pairs: [number, number][] = [];
    for (const c of candidates) {
      if (used.has(c.i) || used.has(c.j)) continue;
      used.add(c.i);
      used.add(c.j);
      pairs.push([c.i, c.j]);
    }
    if (pairs.length === 0) {
      // No chain passes through: the two most nearly opposite arms make the through curve.
      let best: [number, number] = [0, 1];
      let bestDot = Infinity;
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          const d = dot(normalOf(h, (list[i] as Arm).dir), normalOf(h, (list[j] as Arm).dir));
          if (d < bestDot - 1e-9) {
            bestDot = d;
            best = [i, j];
          }
        }
      }
      pairs.push(best);
    }
    pairsOf.set(h, pairs);
  }

  const knot = (h: HexId, d: number): Vec => sideMidpoint(g, h, d) as Vec;
  /** The far end, inside h, of the curve that leaves arm d. */
  const continuation = (h: HexId, d: number): Vec => {
    const list = arms.get(h) ?? [];
    if (list.length === 1) return centreOf(g, h) as Vec;
    if (list.length === 2) {
      const other = list.find(a => a.dir !== d) as Arm;
      return knot(h, other.dir);
    }
    const i = list.findIndex(a => a.dir === d);
    for (const pair of pairsOf.get(h) ?? []) {
      if (i === pair[0]) return knot(h, (list[pair[1]] as Arm).dir);
      if (i === pair[1]) return knot(h, (list[pair[0]] as Arm).dir);
    }
    return centreOf(g, h) as Vec;
  };
  /** Tangent at the knot on side d of h, pointing into h. */
  const tangentInto = (h: HexId, d: number, exit: boolean, blend: number): Vec => {
    if (exit) {
      const n = normalOf(h, d);
      return [-n[0], -n[1]];
    }
    const o = neighbourOf(g, h, d);
    const a = Math.min(h, o);
    const b = Math.max(h, o);
    const da = directionTo(g, a, b);
    const n = unitBetween(centreOf(g, a) as Vec, centreOf(g, b) as Vec);
    const chord = unitBetween(continuation(a, da), continuation(b, (da + 3) % 6));
    const t = norm([(1 - blend) * chord[0] + blend * n[0], (1 - blend) * chord[1] + blend * n[1]]);
    // t runs from a to b; into h means towards h.
    return h === b ? t : [-t[0], -t[1]];
  };

  const knotKey = (h: HexId, d: number, exit: boolean): string => (exit ? `x${h * 6 + d}` : `k${sideKey(g, h, d)}`);
  const pieces: Piece[] = [];
  for (const [h, list] of [...arms.entries()].sort((x, y) => x[0] - y[0])) {
    const centre = centreOf(g, h) as Vec;
    // The straight run past the board at an exit.
    for (const a of list) {
      if (!a.exit) continue;
      const k = knot(h, a.dir);
      const n = normalOf(h, a.dir);
      const pts: Vec[] = [];
      for (let s = 0; s <= 4; s++) pts.push([k[0] + n[0] * R.offMapLength * (s / 4), k[1] + n[1] * R.offMapLength * (s / 4)]);
      pieces.push({ a: knotKey(h, a.dir, true), b: `o${h}`, pts });
    }
    if (list.length === 1) {
      const a = list[0] as Arm;
      const p0 = knot(h, a.dir);
      const t0 = tangentInto(h, a.dir, a.exit, R.tangentBlend);
      const L = R.handle * dist(p0, centre);
      const arrive = unitBetween(p0, centre);
      const pts = cubicPoints(p0, [p0[0] + t0[0] * L, p0[1] + t0[1] * L], [centre[0] - arrive[0] * L, centre[1] - arrive[1] * L], centre, Math.max(4, R.segmentsPerHex >> 1));
      pieces.push({ a: knotKey(h, a.dir, a.exit), b: `c${h}`, pts });
      continue;
    }
    const pairs = pairsOf.get(h) as [number, number][];
    const inPair = new Set(pairs.flat());
    let P: Vec = centre;
    let T: Vec = [1, 0];
    pairs.forEach((pair, pi) => {
      const A = list[pair[0]] as Arm;
      const B = list[pair[1]] as Arm;
      const p0 = knot(h, A.dir);
      const p1 = knot(h, B.dir);
      const t0 = tangentInto(h, A.dir, A.exit, R.tangentBlend);
      const tIn1 = tangentInto(h, B.dir, B.exit, R.tangentBlend);
      const t1: Vec = [-tIn1[0], -tIn1[1]];
      const L = R.handle * dist(p0, p1);
      const c1: Vec = [p0[0] + t0[0] * L, p0[1] + t0[1] * L];
      const c2: Vec = [p1[0] - t1[0] * L, p1[1] - t1[1] * L];
      const plain = list.length === 2 && !A.exit && !B.exit;
      const amp = plain ? R.wobble * signedUnit(seed, 'road-wobble', h) : 0;
      pieces.push({ a: knotKey(h, A.dir, A.exit), b: knotKey(h, B.dir, B.exit), pts: bentCubic(p0, c1, c2, p1, R.segmentsPerHex, amp, halfWave) });
      if (pi === 0) {
        const mid = cubicAt(p0, c1, c2, p1, 0.5);
        P = mid.p;
        T = mid.tangent;
      }
    });
    list.forEach((m, i) => {
      if (inPair.has(i)) return;
      const q0 = knot(h, m.dir);
      const tq = tangentInto(h, m.dir, m.exit, R.tangentBlend);
      const u = unitBetween(q0, P);
      const ut = dot(u, T);
      const s = ut >= 0 ? 1 : -1;
      const arrive = Math.abs(ut) < 0.2 ? u : norm([u[0] + 0.6 * s * T[0], u[1] + 0.6 * s * T[1]]);
      const Lq = R.handle * dist(q0, P);
      const pts = cubicPoints(q0, [q0[0] + tq[0] * Lq, q0[1] + tq[1] * Lq], [P[0] - arrive[0] * Lq, P[1] - arrive[1] * Lq], P, Math.max(6, Math.round(R.segmentsPerHex * 0.75)));
      pieces.push({ a: knotKey(h, m.dir, m.exit), b: `j${h}`, pts });
    });
  }
  const terminalRank = (key: string): number | null => {
    const v = Number(key.slice(1));
    switch (key[0]) {
      case 'c': return v * 3;
      case 'j': return v * 3 + 1;
      case 'o': return v * 3 + 2;
      default: return null;
    }
  };
  const roads: Stroke[] = joinPieces(pieces, terminalRank).map(pts => ({ line: flat(pts) }));

  // ---------------- rivers ----------------
  // A river that ends on another river (a junction: engine/core/map.ts) is drawn after the river
  // it joins. Its line ends ON that river's line inside the junction hex, having turned part of
  // the way into the river's flow, and it is drawn narrower. Which way the river flows there is
  // the junction's own shape: the stream comes in beside one of the two sides the river passes
  // by, and the water runs on by the other.
  type Join = { into: number; hex: HexId };
  const joinAt = (r: number, atStart: boolean): Join | null => {
    const own = ctx.rivers[r] as HexId[];
    if (own.length < 2) return null;
    const hex = (atStart ? own[0] : own[own.length - 1]) as HexId;
    for (let q = 0; q < ctx.rivers.length; q++) {
      if (q === r) continue;
      const at = (ctx.rivers[q] as HexId[]).indexOf(hex);
      if (at > 0 && at < (ctx.rivers[q] as HexId[]).length - 1) return { into: q, hex };
    }
    return null;
  };
  const joins: [Join | null, Join | null][] = ctx.rivers.map((_ids, r) => [joinAt(r, true), joinAt(r, false)]);
  // The line of each river drawn so far, hex by hex, in its own (canonical) direction.
  const runsOf: (Map<HexId, Vec[]> | undefined)[] = ctx.rivers.map(() => undefined);
  /** Where a stream coming from its hex `own` meets the river `into` in `hex`: the point on the river's line, and the way the water runs on there. */
  const meet = (join: Join, own: HexId): { point: Vec; flow: Vec } | null => {
    const run = runsOf[join.into]?.get(join.hex);
    if (!run || run.length < 3) return null;
    const through = ctx.rivers[join.into] as HexId[];
    const k = through.indexOf(join.hex);
    const before = directionTo(g, join.hex, through[k - 1] as HexId);
    const stream = directionTo(g, join.hex, own);
    // Beside the side the river's line comes in by: the water runs on the way the line is drawn. Beside the other: against it.
    const along = (stream - before + 6) % 6 === 1 || (stream - before + 6) % 6 === 5 ? 1 : -1;
    const mid = Math.floor(run.length / 2);
    const a = run[mid - 1] as Vec;
    const c = run[mid + 1] as Vec;
    const flow = unitBetween(a, c);
    return { point: run[mid] as Vec, flow: [flow[0] * along, flow[1] * along] };
  };
  const rivers: Stroke[] = ctx.rivers.map(() => ({ line: [] }));
  // Rivers that join none first, in their order; then each one whose river is drawn. (A ring of
  // rivers that end in each other, which no loaded map has, is drawn as it comes.)
  const riverOrder: number[] = [];
  const waiting = ctx.rivers.map((_ids, r) => r);
  while (waiting.length > 0) {
    let at = waiting.findIndex(r => (joins[r] as [Join | null, Join | null]).every(j => j === null || riverOrder.includes(j.into)));
    if (at < 0) at = 0;
    riverOrder.push(...waiting.splice(at, 1));
  }
  for (const r of riverOrder) {
    const ids = ctx.rivers[r] as HexId[];
    const m = ids.length;
    const [joinIn, joinOut] = joins[r] as [Join | null, Join | null];
    const meetIn = m > 1 && joinIn ? meet(joinIn, ids[1] as HexId) : null;
    const meetOut = m > 1 && joinOut ? meet(joinOut, ids[m - 2] as HexId) : null;
    // Directions out of each hex: towards the next hex and towards the previous one (or off the map at the ends).
    const startStep = offMapStep(g, ids, true);
    const endStep = offMapStep(g, ids, false);
    const exitIn: Dir | null = startStep ? dirToward(ctx, ids[0] as HexId, startStep) : null;
    const exitOut: Dir | null = endStep ? dirToward(ctx, ids[m - 1] as HexId, endStep) : null;
    // Knot points along the river, including the two outward ones.
    const knots: Vec[] = [];
    const normals: Vec[] = [];
    const first = ids[0] as HexId;
    const last = ids[m - 1] as HexId;
    if (exitIn !== null) {
      knots.push(knot(first, exitIn));
      const n = normalOf(first, exitIn);
      normals.push([-n[0], -n[1]]);
    } else if (meetIn) {
      knots.push(meetIn.point);
      normals.push([0, 0]);
    } else {
      knots.push(centreOf(g, first) as Vec);
      normals.push([0, 0]);
    }
    for (let k = 1; k < m; k++) {
      const a = ids[k - 1] as HexId;
      const b = ids[k] as HexId;
      knots.push(knot(a, directionTo(g, a, b)));
      normals.push(unitBetween(centreOf(g, a) as Vec, centreOf(g, b) as Vec));
    }
    if (exitOut !== null) {
      knots.push(knot(last, exitOut));
      normals.push(normalOf(last, exitOut));
    } else if (meetOut) {
      knots.push(meetOut.point);
      normals.push([0, 0]);
    } else {
      knots.push(centreOf(g, last) as Vec);
      normals.push([0, 0]);
    }
    // At a junction the stream has turned part of the way into the river's flow. (The line is drawn
    // in the river's canonical direction: at its start it is leaving the junction.)
    const turned = (from: Vec, at: Vec, flow: Vec): Vec => {
      const straight = unitBetween(from, at);
      return norm([V.confluence * flow[0] + (1 - V.confluence) * straight[0], V.confluence * flow[1] + (1 - V.confluence) * straight[1]]);
    };
    if (meetIn) {
      const t = turned(knots[1] as Vec, knots[0] as Vec, meetIn.flow);
      normals[0] = [-t[0], -t[1]];
    }
    if (meetOut) normals[normals.length - 1] = turned(knots[knots.length - 2] as Vec, knots[knots.length - 1] as Vec, meetOut.flow);
    // Tangents, along the river's (canonical) direction.
    const tangents: Vec[] = knots.map((_k, i) => {
      const nrm = normals[i] as Vec;
      if (i === 0 || i === knots.length - 1) return nrm[0] === 0 && nrm[1] === 0 ? unitBetween(knots[Math.max(0, i - 1)] as Vec, knots[Math.min(knots.length - 1, i + 1)] as Vec) : nrm;
      const chord = unitBetween(knots[i - 1] as Vec, knots[i + 1] as Vec);
      return norm([(1 - V.tangentBlend) * chord[0] + V.tangentBlend * nrm[0], (1 - V.tangentBlend) * chord[1] + V.tangentBlend * nrm[1]]);
    });
    const pts: Vec[] = [];
    const runs = new Map<HexId, Vec[]>();
    // Run in from beyond the start.
    if (exitIn !== null) {
      const k0 = knots[0] as Vec;
      const t0 = tangents[0] as Vec;
      for (let s = 4; s >= 1; s--) pts.push([k0[0] - t0[0] * R.offMapLength * (s / 4), k0[1] - t0[1] * R.offMapLength * (s / 4)]);
    }
    for (let k = 0; k < m; k++) {
      const h = ids[k] as HexId;
      const p0 = knots[k] as Vec;
      const p1 = knots[k + 1] as Vec;
      const t0 = tangents[k] as Vec;
      const t1 = tangents[k + 1] as Vec;
      const L = V.handle * dist(p0, p1);
      const quiet = ctx.bridges.has(h) || k === 0 || k === m - 1;
      // The meander's sign is taken along the river's canonical direction, which ctx.rivers fixes.
      const amp = quiet ? 0 : V.meander * signedUnit(seed, 'river-meander', h);
      const shape = unit(seed, 'river-wave', h) < 0.35 ? fullWave : halfWave;
      const run = bentCubic(p0, [p0[0] + t0[0] * L, p0[1] + t0[1] * L], [p1[0] - t1[0] * L, p1[1] - t1[1] * L], p1, V.segmentsPerHex, amp, shape);
      if (pts.length === 0) pts.push(...run);
      else pts.push(...run.slice(1));
      runs.set(h, run);
    }
    if (exitOut !== null) {
      const k1 = knots[knots.length - 1] as Vec;
      const t1 = tangents[tangents.length - 1] as Vec;
      for (let s = 1; s <= 4; s++) pts.push([k1[0] + t1[0] * R.offMapLength * (s / 4), k1[1] + t1[1] * R.offMapLength * (s / 4)]);
    }
    runsOf[r] = runs;
    // A stream that rises at a spring is narrower than a river, and widens from nothing at its spring.
    const spring: 'start' | 'end' | undefined = ctx.springs.has(first) ? 'start' : ctx.springs.has(last) ? 'end' : undefined;
    rivers[r] = spring !== undefined
      ? { line: flat(pts), width: meetIn || meetOut ? Math.min(V.tributaryWidth, V.springWidth) : V.springWidth, spring }
      : meetIn || meetOut ? { line: flat(pts), width: V.tributaryWidth } : { line: flat(pts) };
  }

  // ---------------- index and bridges ----------------
  const index = new SegmentIndex(0.25);
  for (const r of roads) index.addPolyline(r.line, ROAD);
  for (const r of rivers) index.addPolyline(r.line, RIVER);

  const bridges: Bridge[] = [];
  for (const h of [...ctx.bridges].sort((x, y) => x - y)) {
    const c = centreOf(g, h);
    let best: Bridge | null = null;
    let bestD = Infinity;
    for (const road of roads) {
      for (const river of rivers) {
        const a = road.line;
        const b = river.line;
        for (let i = 0; i + 3 < a.length; i += 2) {
          const ax = a[i] as number;
          const ay = a[i + 1] as number;
          if (Math.hypot(ax - c[0], ay - c[1]) > 0.8) continue;
          for (let j = 0; j + 3 < b.length; j += 2) {
            const bx = b[j] as number;
            const by = b[j + 1] as number;
            if (Math.hypot(bx - c[0], by - c[1]) > 0.8) continue;
            const hit = segmentIntersection(ax, ay, a[i + 2] as number, a[i + 3] as number, bx, by, b[j + 2] as number, b[j + 3] as number);
            if (!hit) continue;
            const p: Vec = [ax + ((a[i + 2] as number) - ax) * hit[0], ay + ((a[i + 3] as number) - ay) * hit[0]];
            const d = Math.hypot(p[0] - c[0], p[1] - c[1]);
            if (d < bestD) {
              bestD = d;
              best = { hex: h, point: p, roadTangent: unitBetween([ax, ay], [a[i + 2] as number, a[i + 3] as number]) };
            }
          }
        }
      }
    }
    if (best) bridges.push(best);
  }

  return { roads, rivers, junctions, deadEnds, bridges, index };
}
