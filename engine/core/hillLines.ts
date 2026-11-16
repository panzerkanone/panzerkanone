/**
 * Hill lines: everything about a hill that is derived from where its hilltops
 * and ridge crests are.
 *
 * The owner's hill model (2026-11-11):
 *   - A hilltop is a hex.
 *   - A SLOPE is not a hex. It is placed by placing its CREST, and a crest is a
 *     hexside. The slope is the hill area around that crest.
 *   - Where a slope borders a hilltop, its crest is the hilltop's edge.
 *   - A ridge (a hill with no top) is a chain of crest edges across level
 *     ground, with slope on both sides.
 *   - SEPARATORS are the line-of-sight edges on the slope round a hilltop:
 *     short lines that run out from the hilltop's corners, only where the hill
 *     turns outward.
 *
 * Separators are found by evaluating sight between adjacent hexes, not by a
 * corner pattern:
 *
 *   The hill mass is the centres of the hilltop hexes and the straight lines
 *   that join the centres of neighbouring hilltop hexes. The slope falls evenly
 *   away from it. Take two adjacent slope hexes and the straight line between
 *   their centres. If the ground under the middle of that line stands above
 *   the line, the hill is in the way: the two hexes do not see each other
 *   along the slope, and the hexside between them is a separator.
 *
 * What falls out of that one test:
 *   - an outward (convex) turn of the hill has separators: the line between the
 *     two hexes cuts the corner, and the hill bulges into it;
 *   - a straight run of hilltop hexes has none: the line runs level along the
 *     face. The zigzag of the hex outline is not a turn of the hill;
 *   - an inward (concave) turn has none: the hexes round a hollow lie against
 *     its faces, and the line between them runs level or over lower ground.
 *
 * Only a pair of level hexes that both touch the same hilltop hex can have the
 * hill between them, so only those pairs are evaluated. The numbers that come
 * out are exact multiples of one step (SIGHT_STEP), so the threshold is not
 * delicate.
 *
 * Levels: 0 level ground, 2 hilltop. An edge is the pair of hexes it runs
 * between.
 */
import { COL_STEP, DIRECTIONS, Dir, Grid, HexId, Point, centreOf, hexCount, neighbourOf, neighboursOf, sideEndKeys, turn } from './hex';

export type Edge = [HexId, HexId];

/** A side of a hex that has no hex beyond it: the hex and the direction the side faces. */
export type OuterSide = [hex: HexId, dir: Dir];

/**
 * One step of hillBetween. With hex centres one unit apart a slope hex is
 * either 1 from the hill mass (it sits off a corner of the hill) or COL_STEP
 * from it (it sits against a face), and the middle of the line between two
 * such hexes is COL_STEP from their shared hilltop hex.
 */
export const SIGHT_STEP = (1 - COL_STEP) / 2;

function segmentDistance(p: Point, a: Point, b: Point): number {
  const abx = b[0] - a[0];
  const aby = b[1] - a[1];
  const len2 = abx * abx + aby * aby;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * abx + (p[1] - a[1]) * aby) / len2));
  return Math.hypot(p[0] - (a[0] + t * abx), p[1] - (a[1] + t * aby));
}

/**
 * Distance from p to the hill mass, looking only at the hilltop hexes in `tops`
 * and the lines from each of them to its hilltop neighbours.
 */
function massDistance(g: Grid, level: ArrayLike<number>, p: Point, tops: readonly HexId[]): number {
  let best = Infinity;
  for (const t of tops) {
    const c = centreOf(g, t);
    best = Math.min(best, Math.hypot(p[0] - c[0], p[1] - c[1]));
    for (const u of neighboursOf(g, t)) {
      if (level[u] === 2) best = Math.min(best, segmentDistance(p, c, centreOf(g, u)));
    }
  }
  return best;
}

/**
 * How far the ground under the middle of the line a-c stands above that line,
 * per unit of slope fall. For two adjacent hexes that both touch the same
 * hilltop hex it is zero along a straight face and one or two SIGHT_STEPs
 * round an outward turn of that hill; that holds in a one-hex gap between two
 * hills too, where the two hexes sit round the end corner of each. For any
 * other pair the value is not used (it is zero or negative when no hilltop is
 * shared, and -Infinity when neither hex touches a hilltop).
 */
export function hillBetween(g: Grid, level: ArrayLike<number>, a: HexId, c: HexId): number {
  const tops = [...new Set([...neighboursOf(g, a), ...neighboursOf(g, c)])].filter(h => level[h] === 2);
  if (tops.length === 0) return -Infinity;
  const pa = centreOf(g, a);
  const pc = centreOf(g, c);
  const mid: Point = [(pa[0] + pc[0]) / 2, (pa[1] + pc[1]) / 2];
  const line = (massDistance(g, level, pa, tops) + massDistance(g, level, pc, tops)) / 2;
  return line - massDistance(g, level, mid, tops);
}

/** Separator edges of the whole board, each once, lower hex number first, in hex order. */
export function separatorsOf(g: Grid, level: ArrayLike<number>): Edge[] {
  const out: Edge[] = [];
  const n = hexCount(g);
  for (let a = 0; a < n; a++) {
    if (level[a] !== 0) continue;
    for (let d = 0; d < 6; d++) {
      const c = neighbourOf(g, a, d);
      if (c < 0 || c < a || level[c] !== 0) continue;
      // Only a pair that shares a hilltop neighbour can have the hill between them.
      // The two hexes that touch both a and c lie one turn either side of d.
      const left = neighbourOf(g, a, turn(d, 1));
      const right = neighbourOf(g, a, turn(d, -1));
      const shared = (left >= 0 && level[left] === 2) || (right >= 0 && level[right] === 2);
      if (shared && hillBetween(g, level, a, c) > SIGHT_STEP / 2) out.push([a, c]);
    }
  }
  return out;
}

/**
 * True when two hexsides meet end to end (they share a corner). Each edge is
 * the pair of adjacent hexes it runs between. A ridge is a chain of crest edges
 * in which each one meets the one before it.
 */
export function edgesTouch(g: Grid, e1: readonly [HexId, HexId], e2: readonly [HexId, HexId]): boolean {
  const a = sideEndKeys(g, e1[0], e1[1]);
  const c = sideEndKeys(g, e2[0], e2[1]);
  if (!a || !c) return false;
  return a[0] === c[0] || a[0] === c[1] || a[1] === c[0] || a[1] === c[1];
}

/** The crest edges along hilltop boundaries, as [hilltop hex, lower hex], in hex order. */
export function hilltopCrestsOf(g: Grid, level: ArrayLike<number>): Edge[] {
  const out: Edge[] = [];
  const n = hexCount(g);
  for (let a = 0; a < n; a++) {
    if (level[a] !== 2) continue;
    for (let d = 0; d < 6; d++) {
      const c = neighbourOf(g, a, d);
      if (c >= 0 && level[c] === 0) out.push([a, c]);
    }
  }
  return out;
}

/**
 * The sides of hilltop hexes that lie on the edge of the board, in hex order
 * and then direction order. Every edge of a hilltop is a crest, and that
 * includes an edge with nothing beyond it. No sight line and no move crosses
 * such a side, so it is kept apart from hilltopCrests: it matters only to the
 * drawing, which must close a hilltop's outline where the hill meets the edge.
 */
export function outerCrestsOf(g: Grid, level: ArrayLike<number>): OuterSide[] {
  const out: OuterSide[] = [];
  const n = hexCount(g);
  for (let a = 0; a < n; a++) {
    if (level[a] !== 2) continue;
    for (const d of DIRECTIONS) {
      if (neighbourOf(g, a, d) < 0) out.push([a, d]);
    }
  }
  return out;
}

/**
 * Slope area: 1 for every level hex that touches a crest edge, which means it
 * is beside a hilltop or on either side of a ridge crest edge.
 */
export function slopeAreaOf(g: Grid, level: ArrayLike<number>, ridges: readonly (readonly Edge[])[]): Uint8Array {
  const n = hexCount(g);
  const slope = new Uint8Array(n);
  for (let a = 0; a < n; a++) {
    if (level[a] !== 0) continue;
    if (neighboursOf(g, a).some(h => level[h] === 2)) slope[a] = 1;
  }
  for (const ridge of ridges) {
    for (const [a, c] of ridge) {
      if (level[a] === 0) slope[a] = 1;
      if (level[c] === 0) slope[c] = 1;
    }
  }
  return slope;
}

export interface HillLines {
  /** 1 where a level hex holds slope area. */
  slope: Uint8Array;
  /** Crest edges along hilltop boundaries: [hilltop hex, lower hex]. */
  hilltopCrests: Edge[];
  /** Crest edges of ridges, chain by chain, as given. */
  ridgeCrests: Edge[];
  /** Line-of-sight edges on the slope round hilltops. */
  separators: Edge[];
  /** Sides of hilltop hexes on the board's edge: crests for the drawing only. */
  outerCrests: OuterSide[];
}

/** Everything derived from the hilltops and ridge crests of a board. */
export function deriveHillLines(g: Grid, level: ArrayLike<number>, ridges: readonly (readonly Edge[])[]): HillLines {
  return {
    slope: slopeAreaOf(g, level, ridges),
    hilltopCrests: hilltopCrestsOf(g, level),
    ridgeCrests: ridges.flatMap(r => r.map(([a, c]) => [a, c] as Edge)),
    separators: separatorsOf(g, level),
    outerCrests: outerCrestsOf(g, level),
  };
}
