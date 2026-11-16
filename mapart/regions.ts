/**
 * Hexsides as drawing: outlines of sets of hexes, and chains of hexside edges
 * joined end to end. Every corner and side comes from engine/core/hex.
 */
import { Dir, Grid, HexId, Point, cornerKey, cornerOf, directionTo, neighbourOf, sideCorners, sideEndKeys, sideOf } from '../engine/core/hex';

/** One side of the outline of a set of hexes, from its first corner to its second (clockwise round the set). */
interface OutlineSide {
  from: number;
  to: number;
  /** The side's first corner. */
  p: Point;
}

/**
 * The outline of a set of hexes as closed rings (flat x, y arrays): every side
 * between a hex of the set and a hex outside it, or the board edge, chained
 * corner to corner. Rings are found in a fixed order (lowest hex first), so
 * the result depends only on the set.
 */
export function hexSetOutline(g: Grid, set: ReadonlySet<HexId>): number[][] {
  const sides: OutlineSide[] = [];
  const sorted = [...set].sort((a, b) => a - b);
  for (const h of sorted) {
    for (let d = 0; d < 6; d++) {
      const nb = neighbourOf(g, h, d);
      if (nb >= 0 && set.has(nb)) continue;
      const [k1, k2] = sideCorners(d);
      sides.push({ from: cornerKey(g, h, k1), to: cornerKey(g, h, k2), p: cornerOf(g, h, k1) });
    }
  }
  const byFrom = new Map<number, number[]>();
  sides.forEach((s, i) => {
    const list = byFrom.get(s.from);
    if (list) list.push(i);
    else byFrom.set(s.from, [i]);
  });
  const used = new Uint8Array(sides.length);
  const rings: number[][] = [];
  for (let i = 0; i < sides.length; i++) {
    if (used[i]) continue;
    const ring: number[] = [];
    let k = i;
    while (!used[k]) {
      used[k] = 1;
      const s = sides[k] as OutlineSide;
      ring.push(s.p[0], s.p[1]);
      const next = (byFrom.get(s.to) ?? []).find(j => !used[j]);
      if (next === undefined) break;
      k = next;
    }
    if (ring.length >= 6) rings.push(ring);
  }
  return rings;
}

/** The six corners of a hex as a flat ring. */
export function hexRing(g: Grid, h: HexId): number[] {
  const out: number[] = [];
  for (let k = 0; k < 6; k++) {
    const p = cornerOf(g, h, k);
    out.push(p[0], p[1]);
  }
  return out;
}

/** The two end points of the side between adjacent hexes a and b. */
export function edgeSegment(g: Grid, a: HexId, b: HexId): [number, number, number, number] {
  const [p, q] = sideOf(g, a, directionTo(g, a, b));
  return [p[0], p[1], q[0], q[1]];
}

/**
 * Join hexside edges (pairs of adjacent hexes) end to end into polylines.
 * Open chains start at their lowest free end; closed loops repeat their first
 * point at the end. Edges are taken in sorted order, so the input order does
 * not matter.
 */
export function chainEdges(g: Grid, edges: readonly (readonly [HexId, HexId])[]): number[][] {
  return chainSegments(edges
    .map(([a, b]) => (a < b ? [a, b] : [b, a]) as [HexId, HexId])
    .sort((x, y) => x[0] - y[0] || x[1] - y[1])
    .map(([a, b]) => {
      const keys = sideEndKeys(g, a, b) as [number, number];
      return { k1: keys[0], k2: keys[1], seg: edgeSegment(g, a, b) };
    }));
}

/**
 * Join sides that face off the board ([hex, direction]: the outer crests of
 * engine/core/hillLines.ts) end to end into polylines, as chainEdges does.
 * Sides are taken in hex, then direction order, so the input order does not
 * matter.
 */
export function chainOuterSides(g: Grid, sides: readonly (readonly [HexId, Dir])[]): number[][] {
  return chainSegments([...sides]
    .sort((x, y) => x[0] - y[0] || x[1] - y[1])
    .map(([h, d]) => {
      const [k1, k2] = sideCorners(d);
      const [p, q] = sideOf(g, h, d);
      return { k1: cornerKey(g, h, k1), k2: cornerKey(g, h, k2), seg: [p[0], p[1], q[0], q[1]] as [number, number, number, number] };
    }));
}

/** A hexside to chain: its two end corners as corner keys, and its end points. */
interface ChainSide {
  k1: number;
  k2: number;
  seg: [number, number, number, number];
}

/**
 * Join sides end to end through the corners they share. Open chains start at
 * their lowest free end; closed loops repeat their first point at the end; a
 * chain stops at a corner where it would branch.
 */
function chainSegments(list: readonly ChainSide[]): number[][] {
  type E = ChainSide;
  const at = new Map<number, number[]>();
  list.forEach((e, i) => {
    for (const k of [e.k1, e.k2]) {
      const l = at.get(k);
      if (l) l.push(i);
      else at.set(k, [i]);
    }
  });
  const used = new Uint8Array(list.length);
  const chains: number[][] = [];
  const walk = (startKey: number, first: number): number[] => {
    const pts: number[] = [];
    let key = startKey;
    let i = first;
    for (;;) {
      used[i] = 1;
      const e = list[i] as E;
      const forward = e.k1 === key;
      const [x1, y1, x2, y2] = e.seg;
      if (pts.length === 0) {
        if (forward) pts.push(x1, y1);
        else pts.push(x2, y2);
      }
      if (forward) pts.push(x2, y2);
      else pts.push(x1, y1);
      key = forward ? e.k2 : e.k1;
      const next = (at.get(key) ?? []).find(j => !used[j]);
      if (next === undefined) break;
      // Only carry on through a corner where the chain does not branch.
      if ((at.get(key) ?? []).length > 2) break;
      i = next;
    }
    return pts;
  };
  // Open ends first: corners used by exactly one edge, lowest key first.
  const ends = [...at.entries()].filter(([, l]) => l.length !== 2).map(([k]) => k).sort((a, b) => a - b);
  for (const k of ends) {
    for (const i of at.get(k) ?? []) if (!used[i]) chains.push(walk(k, i));
  }
  for (let i = 0; i < list.length; i++) {
    if (!used[i]) chains.push(walk((list[i] as E).k1, i));
  }
  return chains;
}
