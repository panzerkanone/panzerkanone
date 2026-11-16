/**
 * The display-list parts of the Milestone 3a bar, lines M3a-06 and M3a-10 to
 * M3a-28 (11 and 12 as round 3 restates them), M3a-43, and round 3's M3a-47 to
 * M3a-50 (docs/bars/M3a.md), measured on a list and its map description with
 * the bar's own definitions. `npm run artcheck` prints these rows; the tests
 * under tests/mapart run them on the standard board, the fixture and the two
 * edge boards of M3a-47.
 *
 * Milestone 3b, stage 1 (docs/bars/M3b.md, as the lead's rulings of
 * 2026-11-11 leave it) restates four of these rows and adds six of its own:
 * M3a-12 (a) reads a canopy's hex as the board hex NEAREST its centre, so a
 * wood may run on into the part-hexes at the board's edge (M3b-L-25); M3a-19
 * gives way to M3b-L-19 and keeps here only what still applies to any town
 * (three buildings a town hex, each wholly in its town's hexes); M3a-26 keeps
 * swamp and rough marks, a field's furrows giving way to M3b-L-17; M3a-47
 * finds an outer crest within 0.045 h of its side (M3b-L-24), not 0.02. The
 * rows M3b-L-17, 18, 19, 24, 25 and 26 are in base.ts and follow these.
 *
 * Each row: the line id, pass or fail, the measured figure and where the
 * worst case is.
 */
import type { DisplayList, DisplayOp, RibbonOp } from '../displayList';
import {
  Grid, HexId, centreOf, coordOf, cornerOf, cornersOf, directionTo, hexCount, labelOf, neighbourOf, sideKey, sideMidpoint,
  sideOf, stepAt, worldBounds, worldToHex,
} from '../../engine/core/hex';
import { deriveHillLines } from '../../engine/core/hillLines';
import { MapDescription, coversOf, gridOf, hexOf, levelsOf, offMapStep, ridgeEdgesOf } from '../../engine/core/map';
import { convexOverlap, inRings, polygonPolylineDist, polylineDist, segDist, segmentIntersection } from '../geom';
import { nearestHex } from '../board';
import type { Explain } from '../explain';
import { validateDisplayList } from '../validate';
import { checkBase } from './base';
import { ListView, makeView, pointsBox, stampRings } from './listview';

export interface Row {
  id: string;
  pass: boolean;
  figure: string;
  worst: string;
}

const f3 = (v: number) => (Number.isFinite(v) ? v.toFixed(3) : String(v));

function hexPoly(g: Grid, h: HexId): number[] {
  return cornersOf(g, h).flatMap(p => [p[0], p[1]]);
}

function minLineDist(x: number, y: number, lines: readonly (readonly number[])[]): number {
  let best = Infinity;
  for (const l of lines) best = Math.min(best, polylineDist(x, y, l));
  return best;
}

/** Distance from a point to a polygon (0 inside). */
function polyDist(x: number, y: number, poly: readonly number[]): number {
  if (inRings(x, y, [poly])) return 0;
  let best = Infinity;
  const n = poly.length;
  for (let i = 0; i < n; i += 2) best = Math.min(best, segDist(x, y, poly[i] as number, poly[i + 1] as number, poly[(i + 2) % n] as number, poly[(i + 3) % n] as number));
  return best;
}

function centroid(ring: readonly number[]): [number, number] {
  let x = 0;
  let y = 0;
  for (let i = 0; i < ring.length; i += 2) {
    x += ring[i] as number;
    y += ring[i + 1] as number;
  }
  return [x / (ring.length / 2), y / (ring.length / 2)];
}

function rectDistOutside(x: number, y: number, b: readonly number[]): number {
  const dx = Math.max((b[0] as number) - x, 0, x - (b[2] as number));
  const dy = Math.max((b[1] as number) - y, 0, y - (b[3] as number));
  return Math.hypot(dx, dy);
}

/** The point of a polyline nearest to (x, y): its distance and its position along the line (arc length from the start). */
function nearestOnLine(x: number, y: number, line: readonly number[]): { d: number; pos: number } {
  let best = Infinity;
  let bestPos = 0;
  let run = 0;
  for (let i = 0; i + 3 < line.length; i += 2) {
    const ax = line[i] as number;
    const ay = line[i + 1] as number;
    const bx = line[i + 2] as number;
    const by = line[i + 3] as number;
    const l = Math.hypot(bx - ax, by - ay);
    const t = l === 0 ? 0 : Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / (l * l)));
    const d = Math.hypot(ax + (bx - ax) * t - x, ay + (by - ay) * t - y);
    if (d < best) {
      best = d;
      bestPos = run + t * l;
    }
    run += l;
  }
  if (line.length === 2) {
    best = Math.hypot((line[0] as number) - x, (line[1] as number) - y);
    bestPos = 0;
  }
  return { d: best, pos: bestPos };
}

/** The vertices of a polyline whose position along it lies from `lo` to `hi` (arc length), as flat x, y. */
function verticesBetween(line: readonly number[], lo: number, hi: number): number[] {
  const out: number[] = [];
  let run = 0;
  for (let i = 0; i < line.length; i += 2) {
    if (i > 0) run += Math.hypot((line[i] as number) - (line[i - 2] as number), (line[i + 1] as number) - (line[i - 1] as number));
    if (run >= lo - 1e-9 && run <= hi + 1e-9) out.push(line[i] as number, line[i + 1] as number);
  }
  return out;
}

/**
 * How far from (x, y) the farthest point an op marks lies: a ribbon's line
 * points with their half-widths, a pattern's clip rings, the outline points of
 * fills, stamps and glyphs.
 */
function reachFrom(v: ListView, op: DisplayOp, x: number, y: number): number {
  let far = 0;
  if (op.op === 'ribbon') {
    for (let k = 0; k < op.line.length; k += 2) far = Math.max(far, Math.hypot((op.line[k] as number) - x, (op.line[k + 1] as number) - y) + (op.halfWidths[k / 2] as number));
    return far;
  }
  const pts = v.opPoints(op);
  for (let k = 0; k < pts.length; k += 2) far = Math.max(far, Math.hypot((pts[k] as number) - x, (pts[k + 1] as number) - y));
  return far;
}

/**
 * Every check of the display list. `explain` is the explain file of the build
 * that made the list (mapart/explain.ts): the rows about lots and building
 * types need it, and fail without it on a map that has a town.
 */
export function checkDisplayList(map: MapDescription, list: DisplayList, explain: Explain | null = null): Row[] {
  const rows: Row[] = [];
  const row = (id: string, pass: boolean, figure: string, worst: string) => rows.push({ id, pass, figure, worst });
  const g = gridOf(map);
  const n = hexCount(g);
  const level = levelsOf(map);
  const cover = coversOf(map);
  const hl = deriveHillLines(g, level, ridgeEdgesOf(map));
  const bounds = worldBounds(g);
  const L = (h: HexId) => labelOf(g, h);

  // ---- M3a-06 ----
  const structural = validateDisplayList(list);
  if (structural.length > 0) {
    row('M3a-06', false, `${structural.length} structural problem(s)`, structural[0] as string);
    return rows;
  }
  const v: ListView = makeView(list);

  {
    const problems: string[] = [];
    const bOk = list.bounds.every((b, i) => Math.abs(b - (bounds[i] as number)) < 1e-9);
    if (!bOk) problems.push(`bounds ${list.bounds.join(',')} are not the board rectangle`);
    let farthest = 0;
    let farOp = -1;
    let biggest = 0;
    let bigOp = -1;
    list.ops.forEach((op, i) => {
      const pts = v.opPoints(op);
      for (let k = 0; k < pts.length; k += 2) {
        const d = rectDistOutside(pts[k] as number, pts[k + 1] as number, bounds);
        if (d > farthest) {
          farthest = d;
          farOp = i;
        }
      }
      const count = op.op === 'fill' ? op.rings.length : op.op === 'stamp' ? op.placements.length / 5 : op.op === 'pattern' ? op.strokes.length : op.op === 'glyphs' ? op.shapes.length : 1;
      if (count > biggest) {
        biggest = count;
        bigOp = i;
      }
    });
    if (farthest > 1.5) problems.push(`op ${farOp} reaches ${f3(farthest)} h outside the board`);
    if (biggest > 500) problems.push(`op ${bigOp} holds ${biggest} rings, placements or strokes`);
    const lens = list.plates.map(p => Math.hypot(p.offset[0], p.offset[1]));
    for (const [i, l] of lens.entries()) if (l !== 0 && (l < 0.005 - 1e-9 || l > 0.011 + 1e-9)) problems.push(`plate ${list.plates[i]?.id} offset ${f3(l)} h`);
    if (lens.every(l => l === 0)) problems.push('every plate offset is 0');
    const ratio = v.canopyOps === 0 ? Infinity : v.canopies.length / v.canopyOps;
    if (ratio < 8) problems.push(`${v.canopies.length} canopies in ${v.canopyOps} canopy ops`);
    row('M3a-06', problems.length === 0,
      `farthest point ${f3(farthest)} h outside; largest op ${biggest}; offsets ${lens.map(f3).join('/')}; canopies per canopy op ${Number.isFinite(ratio) ? ratio.toFixed(1) : '-'}`,
      problems[0] ?? `op ${farOp} (farthest), op ${bigOp} (largest)`);
  }

  // ---- shared facts ----
  const roadHex = new Set<HexId>();
  const roadChains = map.roads.map(c => c.map(l => hexOf(map, l)));
  for (const c of roadChains) for (const h of c) roadHex.add(h);
  const riverChains = map.rivers.map(c => c.map(l => hexOf(map, l)));
  const riverHex = new Set<HexId>();
  for (const c of riverChains) for (const h of c) riverHex.add(h);
  const spotHex = new Set(map.spotHeights.map(s => hexOf(map, s.hex)));
  const arms = new Map<HexId, Set<HexId>>();
  for (const c of roadChains) {
    for (let k = 1; k < c.length; k++) {
      const a = c[k - 1] as HexId;
      const b = c[k] as HexId;
      if (!arms.has(a)) arms.set(a, new Set());
      if (!arms.has(b)) arms.set(b, new Set());
      (arms.get(a) as Set<HexId>).add(b);
      (arms.get(b) as Set<HexId>).add(a);
    }
  }
  const junction = (h: HexId) => (arms.get(h)?.size ?? 0) >= 3;
  const isWood = (h: HexId) => h >= 0 && cover[h] === 'woods';
  const clearWood = (h: HexId) => isWood(h) && !roadHex.has(h) && !riverHex.has(h) && !spotHex.has(h);
  const canopyHex = v.canopies.map(c => worldToHex(g, c.x, c.y));
  // Hill lines (round 3 terms): crest edges, ridge edges, separators and outer sides, as side keys.
  const hillSide = new Set<number>();
  for (const [a, b] of [...hl.hilltopCrests, ...hl.ridgeCrests, ...hl.separators]) hillSide.add(sideKey(g, a, directionTo(g, a, b)));
  for (const [h, d] of hl.outerCrests) hillSide.add(sideKey(g, h, d));
  /** A clear wood hex that is not a hilltop and has no hill line on any of its sides. */
  const hillFreeWood = (h: HexId) => {
    if (!clearWood(h) || level[h] === 2) return false;
    for (let d = 0; d < 6; d++) if (hillSide.has(sideKey(g, h, d))) return false;
    return true;
  };

  // ---- M3a-10 ----
  {
    let worst = Infinity;
    let at = -1;
    let tested = 0;
    for (let h = 0; h < n; h++) {
      if (!clearWood(h)) continue;
      tested++;
      const c = centreOf(g, h);
      let count = 0;
      for (const p of v.canopies) if (Math.hypot(p.x - c[0], p.y - c[1]) <= 0.2) count++;
      if (count < worst) {
        worst = count;
        at = h;
      }
    }
    row('M3a-10', tested === 0 || worst >= 6, tested === 0 ? 'no clear wood hex' : `fewest canopy centres within 0.2 h of a clear wood hex centre: ${worst} (${tested} hexes)`, at >= 0 ? `hex ${L(at)}` : '-');
  }

  // ---- M3a-11 ----
  {
    const counts: string[] = [];
    let ok = true;
    let worstDev = -1;
    let at = '-';
    // Round 3: full wood hexes that are hill-free.
    for (let h = 0; h < n; h++) {
      if (!hillFreeWood(h)) continue;
      let full = true;
      for (let d = 0; d < 6; d++) if (!isWood(neighbourOf(g, h, d))) full = false;
      if (!full) continue;
      let count = 0;
      canopyHex.forEach(ch => {
        if (ch === h) count++;
      });
      counts.push(`${L(h)}:${count}`);
      if (count < 103 || count > 139) ok = false;
      const dev = Math.abs(count - 121);
      if (dev > worstDev) {
        worstDev = dev;
        at = `hex ${L(h)} (${count})`;
      }
    }
    row('M3a-11', ok, counts.length === 0 ? 'no hill-free full wood hex' : `canopies per hill-free full wood hex (${counts.length}): ${counts.length > 8 ? `${counts.slice(0, 8).join(' ')} ...` : counts.join(' ')}`, at);
  }

  // ---- M3a-12 ----
  {
    const problems: string[] = [];
    let bad = 0;
    // (a) as M3b-L-25 restates it: the board hex nearest the canopy's centre is a woods hex.
    v.canopies.forEach((c, i) => {
      if (!isWood(nearestHex(g, c.x, c.y))) {
        bad++;
        if (problems.length === 0) problems.push(`canopy at ${f3((v.canopies[i] as { x: number }).x)},${f3((v.canopies[i] as { y: number }).y)} is not in a woods hex, nor in a part-hex of one`);
      }
    });
    // (b) distance to wood-edge hexsides (between a woods hex and an on-board hex that is not woods).
    const edgeSegs: number[][] = [];
    for (let h = 0; h < n; h++) {
      if (!isWood(h)) continue;
      for (let d = 0; d < 6; d++) {
        const nb = neighbourOf(g, h, d);
        if (nb < 0 || isWood(nb)) continue;
        const [p, q] = sideOf(g, h, d);
        edgeSegs.push([p[0], p[1], q[0], q[1]]);
      }
    }
    let minEdge = Infinity;
    let minAt = '-';
    for (const c of v.canopies) {
      for (const s of edgeSegs) {
        const d = segDist(c.x, c.y, s[0] as number, s[1] as number, s[2] as number, s[3] as number);
        if (d < minEdge) {
          minEdge = d;
          minAt = `canopy ${f3(c.x)},${f3(c.y)} in ${L(nearestHex(g, c.x, c.y))}`;
        }
      }
    }
    if (minEdge < 0.066) problems.push(`canopy ${f3(minEdge)} h from a wood edge (${minAt})`);
    // (c) canopies near every hexside between two clear wood hexes that carries no hill line (round 3).
    let fewest = Infinity;
    let fewAt = '-';
    for (let h = 0; h < n; h++) {
      if (!clearWood(h)) continue;
      for (let d = 0; d < 3; d++) {
        const nb = neighbourOf(g, h, d);
        if (nb < 0 || !clearWood(nb) || hillSide.has(sideKey(g, h, d))) continue;
        const [p, q] = sideOf(g, h, d);
        let count = 0;
        for (const c of v.canopies) if (segDist(c.x, c.y, p[0], p[1], q[0], q[1]) <= 0.096) count++;
        if (count < fewest) {
          fewest = count;
          fewAt = `side ${L(h)}|${L(nb)}`;
        }
      }
    }
    if (fewest < 4) problems.push(`only ${fewest} canopies within 0.096 h of the side ${fewAt}`);
    row('M3a-12', problems.length === 0,
      `(a) ${bad} canopies outside woods; (b) nearest to a wood edge ${f3(minEdge)} h; (c) fewest along an inner side ${Number.isFinite(fewest) ? fewest : '-'}`,
      problems[0] ?? `${minAt}; ${fewAt}`);
  }

  // ---- M3a-13 ----
  {
    let minRoad = Infinity;
    let minRiver = Infinity;
    let roadAt = '-';
    let riverAt = '-';
    for (const c of v.canopies) {
      const dr = minLineDist(c.x, c.y, v.roadLines);
      const dv = minLineDist(c.x, c.y, v.riverLines);
      if (dr < minRoad) {
        minRoad = dr;
        roadAt = `${L(worldToHex(g, c.x, c.y))}`;
      }
      if (dv < minRiver) {
        minRiver = dv;
        riverAt = `${L(worldToHex(g, c.x, c.y))}`;
      }
    }
    let fewest = Infinity;
    let fewAt = '-';
    for (let h = 0; h < n; h++) {
      if (!isWood(h) || spotHex.has(h) || junction(h)) continue;
      if (roadHex.has(h) === riverHex.has(h)) continue;
      let count = 0;
      canopyHex.forEach(ch => {
        if (ch === h) count++;
      });
      if (count < fewest) {
        fewest = count;
        fewAt = `hex ${L(h)}`;
      }
    }
    const ok = minRoad >= 0.24 && minRiver >= 0.28 && (fewest === Infinity || fewest >= 6);
    row('M3a-13', ok, `(a) nearest canopy to a road ${f3(minRoad)} h, to a river ${f3(minRiver)} h; (b) fewest canopies in a wood hex with a road or river ${Number.isFinite(fewest) ? fewest : '-'}`,
      `road ${roadAt}; river ${riverAt}; ${fewAt}`);
  }

  // ---- M3a-14 ----
  {
    const edges: [HexId, HexId][] = [];
    for (const [top, low] of hl.hilltopCrests) edges.push([low, top]);
    for (const [a, b] of hl.ridgeCrests) {
      edges.push([a, b]);
      edges.push([b, a]);
    }
    let fails = 0;
    let first = '-';
    for (const [low, other] of edges) {
      const d = directionTo(g, low, other);
      const [p, q] = sideOf(g, low, d);
      const mid = sideMidpoint(g, low, d);
      const c = centreOf(g, low);
      const nl = Math.hypot(c[0] - mid[0], c[1] - mid[1]);
      const nx = (c[0] - mid[0]) / nl;
      const ny = (c[1] - mid[1]) / nl;
      for (const t of [0.25, 0.75]) {
        for (const dd of [0.05, 0.15]) {
          const x = p[0] + (q[0] - p[0]) * t + nx * dd;
          const y = p[1] + (q[1] - p[1]) * t + ny * dd;
          if (!v.washed(x, y)) {
            fails++;
            if (first === '-') first = `edge ${L(low)}|${L(other)} at t ${t}, d ${dd}`;
          }
        }
      }
    }
    row('M3a-14', fails === 0, `${edges.length} edge sides tested, ${fails} of ${edges.length * 4} points not washed`, first);
  }

  // ---- M3a-15 ----
  {
    let insideFails = 0;
    let firstIn = '-';
    for (let h = 0; h < n; h++) {
      if (level[h] !== 2) continue;
      const c = centreOf(g, h);
      const pts: [number, number][] = [[c[0], c[1]]];
      for (let d = 0; d < 6; d++) {
        const m = sideMidpoint(g, h, d);
        const l = Math.hypot(c[0] - m[0], c[1] - m[1]);
        pts.push([m[0] + ((c[0] - m[0]) / l) * 0.1, m[1] + ((c[1] - m[1]) / l) * 0.1]);
        const k = cornerOf(g, h, d);
        const lk = Math.hypot(c[0] - k[0], c[1] - k[1]);
        pts.push([k[0] + ((c[0] - k[0]) / lk) * 0.1, k[1] + ((c[1] - k[1]) / lk) * 0.1]);
      }
      for (const [x, y] of pts) {
        if (v.washed(x, y)) {
          insideFails++;
          if (firstIn === '-') firstIn = `hilltop ${L(h)} at ${f3(x)},${f3(y)}`;
        }
      }
    }
    // (b) Every side of a hilltop is a crest (round 3 ruling), the sides on the board edge too, so
    // the distance is to the nearest crest edge, ridge edge or outer side. The distance to crest
    // and ridge edges alone is reported beside it.
    const crestSegs: number[][] = [];
    for (const [a, b] of [...hl.hilltopCrests, ...hl.ridgeCrests]) {
      const [p, q] = sideOf(g, a, directionTo(g, a, b));
      crestSegs.push([p[0], p[1], q[0], q[1]]);
    }
    const outerSegs: number[][] = hl.outerCrests.map(([h, d]) => {
      const [p, q] = sideOf(g, h, d);
      return [p[0], p[1], q[0], q[1]];
    });
    let farthest = 0;
    let farAt = '-';
    let farthestEdges = 0;
    let farEdgesAt = '-';
    let washedCount = 0;
    for (let y = bounds[1]; y <= bounds[3] + 1e-9; y += 0.1) {
      for (let x = bounds[0]; x <= bounds[2] + 1e-9; x += 0.1) {
        if (!v.washed(x, y)) continue;
        washedCount++;
        let d = Infinity;
        for (const s of crestSegs) d = Math.min(d, segDist(x, y, s[0] as number, s[1] as number, s[2] as number, s[3] as number));
        if (d > farthestEdges) {
          farthestEdges = d;
          farEdgesAt = `${f3(x)},${f3(y)}`;
        }
        for (const s of outerSegs) d = Math.min(d, segDist(x, y, s[0] as number, s[1] as number, s[2] as number, s[3] as number));
        if (d > farthest) {
          farthest = d;
          farAt = `${f3(x)},${f3(y)}`;
        }
      }
    }
    row('M3a-15', insideFails === 0 && farthest <= 0.75,
      `(a) ${insideFails} washed points inside hilltops; (b) farthest washed lattice point ${f3(farthest)} h from a crest, ridge or outer side (${washedCount} washed); from crest and ridge edges alone ${f3(farthestEdges)} h`,
      insideFails > 0 ? firstIn : `${farAt}; ${farEdgesAt}`);
  }

  // ---- M3a-16 (a) ----
  {
    let least = Infinity;
    let at = -1;
    for (const w of v.washOps) {
      const f = w.op.feather ?? 0;
      if (f < least) {
        least = f;
        at = w.index;
      }
    }
    row('M3a-16', v.washOps.length === 0 || least >= 0.05, v.washOps.length === 0 ? '(a) no wash op' : `(a) smallest wash feather ${f3(least)} h (${v.washOps.length} wash ops)`, at >= 0 ? `op ${at}` : '-');
  }

  // ---- M3a-17 ----
  {
    const feat = (name: string) => list.ops.filter(o => o.op === 'ribbon' && o.feature === name).map(o => (o as { line: readonly number[] }).line);
    const sets: Record<string, readonly (readonly number[])[]> = { crest: feat('crest'), ridge: feat('ridge'), separator: feat('separator') };
    const want: Record<string, Set<number>> = { crest: new Set(), ridge: new Set(), separator: new Set() };
    const key = (a: HexId, b: HexId) => sideKey(g, a, directionTo(g, a, b));
    for (const [a, b] of hl.hilltopCrests) (want.crest as Set<number>).add(key(a, b));
    for (const [a, b] of hl.ridgeCrests) (want.ridge as Set<number>).add(key(a, b));
    for (const [a, b] of hl.separators) (want.separator as Set<number>).add(key(a, b));
    const diffs: string[] = [];
    const counts: string[] = [];
    for (const name of ['crest', 'ridge', 'separator']) {
      const lines = sets[name] as readonly (readonly number[])[];
      const got = new Set<number>();
      const seen = new Set<number>();
      for (let h = 0; h < n; h++) {
        for (let d = 0; d < 6; d++) {
          const k = sideKey(g, h, d);
          if (seen.has(k)) continue;
          seen.add(k);
          const [p, q] = sideOf(g, h, d);
          const a: [number, number] = [p[0] + (q[0] - p[0]) * 0.25, p[1] + (q[1] - p[1]) * 0.25];
          const b: [number, number] = [p[0] + (q[0] - p[0]) * 0.75, p[1] + (q[1] - p[1]) * 0.75];
          if (minLineDist(a[0], a[1], lines) <= 0.07 && minLineDist(b[0], b[1], lines) <= 0.07) got.add(k);
        }
      }
      const w = want[name] as Set<number>;
      const extra = [...got].filter(k => !w.has(k));
      const missing = [...w].filter(k => !got.has(k));
      if (extra.length > 0) diffs.push(`${name}: ${extra.length} side(s) drawn but not derived`);
      if (missing.length > 0) diffs.push(`${name}: ${missing.length} derived side(s) not drawn`);
      // Vertices near a side of their own set.
      const segs = [...w].map(k => {
        const id = Math.floor(k / 6);
        const d = k % 6;
        const [p, q] = sideOf(g, id, d);
        return [p[0], p[1], q[0], q[1]];
      });
      let far = 0;
      for (const l of lines) {
        for (let i = 0; i < l.length; i += 2) {
          let dmin = Infinity;
          for (const s of segs) dmin = Math.min(dmin, segDist(l[i] as number, l[i + 1] as number, s[0] as number, s[1] as number, s[2] as number, s[3] as number));
          far = Math.max(far, dmin);
        }
      }
      if (far > 0.1) diffs.push(`${name}: a vertex lies ${f3(far)} h from its own sides`);
      counts.push(`${name} ${got.size}/${w.size}`);
    }
    row('M3a-17', diffs.length === 0, `drawn/derived: ${counts.join(', ')}`, diffs[0] ?? 'set differences empty');
  }

  // ---- M3a-18 ----
  {
    const problems: string[] = [];
    const tris = list.ops.map((o, i) => ({ o, i })).filter(({ o }) => o.feature === 'spot-triangle');
    const nums = v.glyphOps.filter(({ op }) => op.feature === 'spot-number');
    const crestPlates = new Set(list.ops.filter(o => o.feature === 'crest').map(o => o.plate));
    const triRings: { ring: number[]; plate: string; tone: number; mode: string }[] = [];
    for (const { o } of tris) {
      if (o.op !== 'fill') {
        problems.push('a spot-triangle op is not a fill');
        continue;
      }
      for (const r of o.rings) triRings.push({ ring: [...r], plate: o.plate, tone: o.tone, mode: o.mode });
    }
    let worstCentre = 0;
    let worstAt = '-';
    for (const s of map.spotHeights) {
      const h = hexOf(map, s.hex);
      const c = centreOf(g, h);
      const poly = hexPoly(g, h);
      const mine = triRings.filter(t => worldToHex(g, ...centroid(t.ring)) === h);
      const myNums = nums.filter(({ op }) => {
        const b = pointsBox(v.glyphPoints(op));
        return worldToHex(g, (b[0] + b[2]) / 2, (b[1] + b[3]) / 2) === h;
      });
      if (mine.length !== 1) problems.push(`${s.hex}: ${mine.length} triangles`);
      if (myNums.length !== 1) problems.push(`${s.hex}: ${myNums.length} numbers`);
      if (mine.length !== 1 || myNums.length !== 1) continue;
      const t = mine[0] as { ring: number[]; plate: string; tone: number; mode: string };
      const num = (myNums[0] as { op: { text: string; plate: string } }).op;
      if (t.ring.length !== 6) problems.push(`${s.hex}: the triangle has ${t.ring.length / 2} points`);
      const tb = pointsBox(t.ring);
      const tw = tb[2] - tb[0];
      if (tw < 0.1 || tw > 0.2) problems.push(`${s.hex}: the triangle is ${f3(tw)} h wide`);
      if (t.tone !== 1 || t.mode !== 'draw') problems.push(`${s.hex}: the triangle is not tone 1, draw`);
      if (num.text !== String(s.height)) problems.push(`${s.hex}: the number reads ${num.text}, the height is ${s.height}`);
      if (!crestPlates.has(t.plate) || !crestPlates.has(num.plate)) problems.push(`${s.hex}: not on the plate of the crest lines`);
      const nb = pointsBox(v.glyphPoints((myNums[0] as { op: Parameters<ListView['glyphPoints']>[0] }).op));
      const box = [Math.min(tb[0], nb[0]), Math.min(tb[1], nb[1]), Math.max(tb[2], nb[2]), Math.max(tb[3], nb[3])];
      for (const [x, y] of [[box[0], box[1]], [box[2], box[1]], [box[2], box[3]], [box[0], box[3]]] as [number, number][]) {
        if (!inRings(x, y, [poly])) problems.push(`${s.hex}: the mark's box leaves the hex`);
      }
      const dc = Math.hypot(((box[0] as number) + (box[2] as number)) / 2 - c[0], ((box[1] as number) + (box[3] as number)) / 2 - c[1]);
      if (dc > worstCentre) {
        worstCentre = dc;
        worstAt = s.hex;
      }
      if (dc > 0.1) problems.push(`${s.hex}: the mark is centred ${f3(dc)} h from the hex centre`);
    }
    if (triRings.length !== map.spotHeights.length) problems.push(`${triRings.length} triangles for ${map.spotHeights.length} spot heights`);
    if (nums.length !== map.spotHeights.length) problems.push(`${nums.length} numbers for ${map.spotHeights.length} spot heights`);
    // The crest plate's ink is red.
    for (const id of crestPlates) {
      const plate = list.plates.find(p => p.id === id);
      if (!plate) continue;
      const r = parseInt(plate.ink.slice(1, 3), 16);
      const gg = parseInt(plate.ink.slice(3, 5), 16);
      const b = parseInt(plate.ink.slice(5, 7), 16);
      if (r - gg < 60 || r - b < 60) problems.push(`the crest plate ${id} (${plate.ink}) is not red`);
    }
    // Every single-hex hilltop has an entry.
    const spotted = new Set(map.spotHeights.map(s => hexOf(map, s.hex)));
    for (let h = 0; h < n; h++) {
      if (level[h] !== 2) continue;
      let alone = true;
      for (let d = 0; d < 6; d++) {
        const nb = neighbourOf(g, h, d);
        if (nb >= 0 && level[nb] === 2) alone = false;
      }
      if (alone && !spotted.has(h)) problems.push(`single-hex hilltop ${L(h)} has no spot height`);
    }
    row('M3a-18', problems.length === 0, `${map.spotHeights.length} spot heights; farthest mark centre ${f3(worstCentre)} h from its hex centre`, problems[0] ?? worstAt);
  }

  // ---- M3a-19 and M3a-20 ----
  const bHex = v.buildings.map(r => worldToHex(g, ...centroid(r)));
  {
    const problems: string[] = [];
    let fewest = Infinity;
    let fewAt = '-';
    for (let h = 0; h < n; h++) {
      if (cover[h] !== 'town') continue;
      const count = bHex.filter(x => x === h).length;
      if (count < fewest) {
        fewest = count;
        fewAt = L(h);
      }
    }
    if (fewest < 3) problems.push(`town hex ${fewAt} has ${fewest} buildings`);
    v.buildings.forEach((r, i) => {
      const hs = new Set<HexId>();
      for (let k = 0; k < r.length; k += 2) hs.add(worldToHex(g, r[k] as number, r[k + 1] as number));
      // A town of several hexes is one place: a building may lie across two of its hexes, never outside them.
      const mine = map.towns.find(t => t.hexes.some(l => hexOf(map, l) === bHex[i]));
      const own = new Set((mine?.hexes ?? []).map(l => hexOf(map, l)));
      if (!mine || [...hs].some(h => !own.has(h))) problems.push(`building ${i} at ${f3(centroid(r)[0])},${f3(centroid(r)[1])} is not wholly in the hexes of one town`);
    });
    // Rows of buildings along roads and hexsides gave way to lots (M3b-L-18) and the owner's building set
    // (M3b-L-19); what stands here is what holds of any town.
    const townSummary: string[] = [];
    for (const town of map.towns) {
      const hexes = new Set(town.hexes.map(l => hexOf(map, l)));
      const idx = v.buildings.map((_, i) => i).filter(i => hexes.has(bHex[i] as HexId));
      townSummary.push(`${town.name} ${idx.length}b`);
    }
    row('M3a-19', problems.length === 0, `(as M3b-L-19 restates it) fewest buildings in a town hex ${Number.isFinite(fewest) ? fewest : '-'}; ${townSummary.join(', ')}`, problems[0] ?? `hex ${fewAt}`);
  }
  {
    const problems: string[] = [];
    const casingOf = (line: readonly number[]) => {
      const m = v.roadCasing.find(c => c.op.line.length === line.length && c.op.line.every((x, i) => x === line[i]));
      const all = m ? m.op.halfWidths : v.roadCasing.flatMap(c => [...c.op.halfWidths]);
      return Math.max(0, ...all);
    };
    const bankOf = (line: readonly number[]) => {
      const m = v.riverBank.find(c => c.op.line.length === line.length && c.op.line.every((x, i) => x === line[i]));
      const all = m ? m.op.halfWidths : v.riverBank.flatMap(c => [...c.op.halfWidths]);
      return Math.max(0, ...all);
    };
    let tightest = Infinity;
    let tightAt = '-';
    v.buildings.forEach((r, i) => {
      const c = centroid(r);
      for (const [lines, widthOf, what] of [[v.roadLines, casingOf, 'road'], [v.riverLines, bankOf, 'river']] as const) {
        for (const l of lines) {
          // Only lines that come near the building matter.
          if (polylineDist(c[0], c[1], l) > 1) continue;
          const d = polygonPolylineDist(r, l);
          const margin = d - widthOf(l);
          if (margin < tightest) {
            tightest = margin;
            tightAt = `building ${i} in ${L(bHex[i] as HexId)} to a ${what}`;
          }
          if (margin <= 0) problems.push(`building ${i} in ${L(bHex[i] as HexId)} is crossed by a ${what} (${f3(d)} h from its centre line)`);
        }
      }
    });
    let overlaps = 0;
    for (let a = 0; a < v.buildings.length; a++) {
      for (let b = a + 1; b < v.buildings.length; b++) {
        const ra = v.buildings[a] as number[];
        const rb = v.buildings[b] as number[];
        const ca = centroid(ra);
        const cb = centroid(rb);
        if (Math.hypot(ca[0] - cb[0], ca[1] - cb[1]) > 0.5) continue;
        if (convexOverlap(ra, rb, -1e-9)) overlaps++;
      }
    }
    if (overlaps > 0) problems.push(`${overlaps} overlapping pair(s) of buildings`);
    const key = (l: readonly number[]) => l.join(',');
    const same = (a: { op: { line: readonly number[] } }[], b: { op: { line: readonly number[] } }[]) => {
      const ka = a.map(x => key(x.op.line)).sort();
      const kb = b.map(x => key(x.op.line)).sort();
      return ka.length === kb.length && ka.every((k, i) => k === kb[i]);
    };
    if (!same(v.roadCasing, v.roadFill)) problems.push('road-casing and road-fill lines differ');
    if (!same(v.riverBank, v.riverWater)) problems.push('river-bank and river-water lines differ');
    row('M3a-20', problems.length === 0, `smallest clearance beyond the casing or bank ${f3(tightest)} h; ${overlaps} overlaps; casing/fill lines ${same(v.roadCasing, v.roadFill) ? 'same' : 'differ'}, bank/water ${same(v.riverBank, v.riverWater) ? 'same' : 'differ'}`, problems[0] ?? tightAt);
  }

  // ---- M3a-21 ----
  {
    let worstRoad = 0;
    let worstRoadAt = '-';
    let worstRiver = 0;
    let worstRiverAt = '-';
    const mid = (a: HexId, b: HexId) => sideMidpoint(g, a, directionTo(g, a, b));
    for (const c of roadChains) {
      for (let k = 1; k < c.length; k++) {
        const m = mid(c[k - 1] as HexId, c[k] as HexId);
        const d = minLineDist(m[0], m[1], v.roadLines);
        if (d > worstRoad) {
          worstRoad = d;
          worstRoadAt = `${L(c[k - 1] as HexId)}|${L(c[k] as HexId)}`;
        }
      }
    }
    for (const c of riverChains) {
      for (let k = 1; k < c.length; k++) {
        const m = mid(c[k - 1] as HexId, c[k] as HexId);
        const d = minLineDist(m[0], m[1], v.riverLines);
        if (d > worstRiver) {
          worstRiver = d;
          worstRiverAt = `${L(c[k - 1] as HexId)}|${L(c[k] as HexId)}`;
        }
      }
    }
    // (b) hexes a road enters and leaves by sides two apart.
    let leastCentre = Infinity;
    let leastAt = '-';
    for (const c of roadChains) {
      for (let k = 1; k + 1 < c.length; k++) {
        const h = c[k] as HexId;
        if (junction(h)) continue;
        const d1 = directionTo(g, h, c[k - 1] as HexId);
        const d2 = directionTo(g, h, c[k + 1] as HexId);
        const gap = (((d1 - d2) % 6) + 6) % 6;
        if (gap !== 2 && gap !== 4) continue;
        const cc = centreOf(g, h);
        const d = minLineDist(cc[0], cc[1], v.roadLines);
        if (d < leastCentre) {
          leastCentre = d;
          leastAt = L(h);
        }
      }
    }
    // (c) straight runs of four or more crossing midpoints.
    let worstRun = 0;
    let runAt = '-';
    for (const c of roadChains) {
      const mids: [number, number][] = [];
      for (let k = 1; k < c.length; k++) {
        const m = mid(c[k - 1] as HexId, c[k] as HexId);
        mids.push([m[0], m[1]]);
      }
      let s = 0;
      while (s < mids.length) {
        let e = s + 1;
        if (e >= mids.length) break;
        const a = mids[s] as [number, number];
        const b = mids[e] as [number, number];
        const dx = b[0] - a[0];
        const dy = b[1] - a[1];
        const l = Math.hypot(dx, dy);
        while (e + 1 < mids.length) {
          const p = mids[e + 1] as [number, number];
          const cross = Math.abs((p[0] - a[0]) * dy - (p[1] - a[1]) * dx) / l;
          if (cross > 1e-6) break;
          e++;
        }
        const count = e - s + 1;
        if (count >= 4) {
          // The run's line, and its second and second-last midpoints.
          const p2 = mids[s + 1] as [number, number];
          const pq = mids[e - 1] as [number, number];
          const ux = dx / l;
          const uy = dy / l;
          const across = (x: number, y: number) => Math.abs((x - a[0]) * uy - (y - a[1]) * ux);
          // Every centre-line vertex between the second midpoint and the second-last, none left
          // out however far it strays: on the road line that passes nearest both, the vertices
          // between the points of it nearest to the two. When no one line passes within 0.05 h
          // of both (the run is drawn in pieces), the same hex by hex along the run.
          const spans: [number, number][] = [[s + 1, e - 1]];
          let bestLine: readonly number[] | null = null;
          let bestFit = Infinity;
          for (const line of v.roadLines) {
            const fit = Math.max(nearestOnLine(p2[0], p2[1], line).d, nearestOnLine(pq[0], pq[1], line).d);
            if (fit < bestFit) {
              bestFit = fit;
              bestLine = line;
            }
          }
          if (!bestLine || bestFit > 0.05) {
            spans.length = 0;
            for (let k = s + 1; k < e - 1; k++) spans.push([k, k + 1]);
          }
          for (const [i0, i1] of spans) {
            const ma = mids[i0] as [number, number];
            const mb = mids[i1] as [number, number];
            let line: readonly number[] | null = null;
            let fit = Infinity;
            for (const cand of v.roadLines) {
              const f = Math.max(nearestOnLine(ma[0], ma[1], cand).d, nearestOnLine(mb[0], mb[1], cand).d);
              if (f < fit) {
                fit = f;
                line = cand;
              }
            }
            if (!line) continue;
            const pa = nearestOnLine(ma[0], ma[1], line).pos;
            const pb = nearestOnLine(mb[0], mb[1], line).pos;
            const pts = verticesBetween(line, Math.min(pa, pb), Math.max(pa, pb));
            for (let k = 0; k < pts.length; k += 2) {
              const d = across(pts[k] as number, pts[k + 1] as number);
              if (d > worstRun) {
                worstRun = d;
                runAt = `${L(c[s] as HexId)}..${L(c[e + 1] as HexId)}`;
              }
            }
          }
        }
        s = Math.max(s + 1, e);
      }
    }
    const ok = worstRoad <= 0.03 && worstRiver <= 0.08 && (leastCentre === Infinity || leastCentre >= 0.08) && worstRun <= 0.1;
    row('M3a-21', ok,
      `(a) road ${f3(worstRoad)} h, river ${f3(worstRiver)} h from crossing midpoints; (b) nearest pass to a hex centre ${f3(leastCentre)} h; (c) zigzag runs stray ${f3(worstRun)} h`,
      `road ${worstRoadAt}; river ${worstRiverAt}; centre ${leastAt}; run ${runAt}`);
  }

  // ---- M3a-22 ----
  {
    const problems: string[] = [];
    const ends: { kind: 'road' | 'river'; chain: HexId[]; atStart: boolean }[] = [];
    const exits = new Set(map.exits.map(l => hexOf(map, l)));
    for (const c of roadChains) {
      if (exits.has(c[0] as HexId)) ends.push({ kind: 'road', chain: c, atStart: true });
      if (exits.has(c[c.length - 1] as HexId)) ends.push({ kind: 'road', chain: c, atStart: false });
    }
    for (const c of riverChains) {
      ends.push({ kind: 'river', chain: c, atStart: true });
      ends.push({ kind: 'river', chain: c, atStart: false });
    }
    let worstMid = 0;
    let leastOut = Infinity;
    let worstAt = '-';
    for (const e of ends) {
      const end = (e.atStart ? e.chain[0] : e.chain[e.chain.length - 1]) as HexId;
      const step = offMapStep(g, e.chain, e.atStart);
      if (!step) {
        problems.push(`${e.kind} end ${L(end)}: offMapStep gives no step`);
        continue;
      }
      let d = -1;
      const [col, rowN] = coordOf(g, end);
      for (let k = 0; k < 6; k++) {
        const [c2, r2] = stepAt(col, rowN, k);
        if (c2 === step[0] && r2 === step[1]) d = k;
      }
      if (d < 0) {
        problems.push(`${e.kind} end ${L(end)}: no side faces the off-map step`);
        continue;
      }
      const m = sideMidpoint(g, end, d);
      const lines = e.kind === 'road' ? v.roadLines : v.riverLines;
      let best: readonly number[] | null = null;
      let bestD = Infinity;
      for (const l of lines) {
        const dd = polylineDist(m[0], m[1], l);
        if (dd < bestD) {
          bestD = dd;
          best = l;
        }
      }
      const tol = e.kind === 'road' ? 0.03 : 0.08;
      if (bestD > tol) problems.push(`${e.kind} end ${L(end)}: the centre line passes ${f3(bestD)} h from the outward side midpoint`);
      let out = 0;
      if (best) for (let i = 0; i < best.length; i += 2) out = Math.max(out, rectDistOutside(best[i] as number, best[i + 1] as number, bounds));
      if (out < 0.05) problems.push(`${e.kind} end ${L(end)}: the centre line reaches only ${f3(out)} h outside the board`);
      if (bestD > worstMid) {
        worstMid = bestD;
        worstAt = `${e.kind} end ${L(end)}`;
      }
      leastOut = Math.min(leastOut, out);
    }
    // (b) river half-width where it crosses the board edge.
    let thinnest = Infinity;
    for (const { op } of v.riverWater) {
      for (let i = 0; i + 3 < op.line.length; i += 2) {
        const a = rectDistOutside(op.line[i] as number, op.line[i + 1] as number, bounds) > 0;
        const b = rectDistOutside(op.line[i + 2] as number, op.line[i + 3] as number, bounds) > 0;
        if (a !== b) thinnest = Math.min(thinnest, op.halfWidths[i / 2] as number, op.halfWidths[i / 2 + 1] as number);
      }
    }
    if (thinnest < 0.01) problems.push(`a river is ${f3(thinnest)} h half-wide where it leaves the board`);
    // (c) dead ends.
    let worstDead = 0;
    for (const c of roadChains) {
      for (const h of [c[0] as HexId, c[c.length - 1] as HexId]) {
        if (exits.has(h) || junction(h) || (arms.get(h)?.size ?? 0) !== 1) continue;
        const cc = centreOf(g, h);
        let bestEnd = Infinity;
        for (const l of v.roadLines) {
          bestEnd = Math.min(bestEnd, Math.hypot((l[0] as number) - cc[0], (l[1] as number) - cc[1]), Math.hypot((l[l.length - 2] as number) - cc[0], (l[l.length - 1] as number) - cc[1]));
        }
        worstDead = Math.max(worstDead, bestEnd);
        if (bestEnd > 0.25) problems.push(`dead end ${L(h)}: no road line ends within 0.25 h of its centre (${f3(bestEnd)})`);
      }
    }
    row('M3a-22', problems.length === 0,
      `(a) ${ends.length} ends: worst ${f3(worstMid)} h from the outward midpoint, least reach past the board ${f3(leastOut)} h; (b) thinnest river at the edge ${f3(thinnest)} h; (c) dead ends end within ${f3(worstDead)} h of their centres`,
      problems[0] ?? worstAt);
  }

  // ---- M3a-23 (a) ----
  {
    const lastCasing = Math.max(-1, ...v.roadCasing.map(c => c.index));
    const firstFill = Math.min(Infinity, ...v.roadFill.map(c => c.index));
    const problems: string[] = [];
    if (lastCasing > firstFill) problems.push(`casing op ${lastCasing} comes after fill op ${firstFill}`);
    let narrowest = Infinity;
    for (const fl of v.roadFill) {
      const cs = v.roadCasing.find(c => c.op.line.length === fl.op.line.length && c.op.line.every((x, i) => x === fl.op.line[i]));
      if (!cs) {
        problems.push(`road-fill op ${fl.index} has no casing of the same line`);
        continue;
      }
      fl.op.halfWidths.forEach((w, i) => {
        const margin = (cs.op.halfWidths[i] as number) - w;
        narrowest = Math.min(narrowest, margin);
        if (margin <= 0) problems.push(`road-fill op ${fl.index} is as wide as its casing at point ${i}`);
      });
    }
    row('M3a-23', problems.length === 0, `(a) last casing op ${lastCasing}, first fill op ${Number.isFinite(firstFill) ? firstFill : '-'}; casing wider by at least ${f3(narrowest)} h`, problems[0] ?? '-');
  }

  // ---- M3a-24 (list part) ----
  {
    const problems: string[] = [];
    const bridgeOps = list.ops.filter(o => o.feature === 'bridge');
    let worst = 0;
    let worstAt = '-';
    for (const label of map.bridges) {
      const h = hexOf(map, label);
      const c = centreOf(g, h);
      let point: [number, number] | null = null;
      let bestD = Infinity;
      for (const a of v.roadLines) {
        for (const b of v.riverLines) {
          for (let i = 0; i + 3 < a.length; i += 2) {
            if (Math.hypot((a[i] as number) - c[0], (a[i + 1] as number) - c[1]) > 1) continue;
            for (let j = 0; j + 3 < b.length; j += 2) {
              if (Math.hypot((b[j] as number) - c[0], (b[j + 1] as number) - c[1]) > 1) continue;
              const hit = segmentIntersection(a[i] as number, a[i + 1] as number, a[i + 2] as number, a[i + 3] as number, b[j] as number, b[j + 1] as number, b[j + 2] as number, b[j + 3] as number);
              if (!hit) continue;
              const p: [number, number] = [(a[i] as number) + ((a[i + 2] as number) - (a[i] as number)) * hit[0], (a[i + 1] as number) + ((a[i + 3] as number) - (a[i + 1] as number)) * hit[0]];
              const d = Math.hypot(p[0] - c[0], p[1] - c[1]);
              if (d < bestD) {
                bestD = d;
                point = p;
              }
            }
          }
        }
      }
      if (!point) {
        problems.push(`bridge ${label}: the road and river centre lines do not cross`);
        continue;
      }
      let near = Infinity;
      for (const o of bridgeOps) near = Math.min(near, reachFrom(v, o, point[0], point[1]));
      if (near > worst) {
        worst = near;
        worstAt = `bridge ${label}`;
      }
      if (near > 0.12) problems.push(`bridge ${label}: no bridge op lies within 0.12 h of the crossing (${f3(near)})`);
    }
    row('M3a-24', problems.length === 0, `(list part) ${map.bridges.length} bridges; every point of the nearest bridge op, its half-width included, within ${f3(worst)} h of the crossing`, problems[0] ?? worstAt);
  }

  // ---- M3a-25 (a) ----
  {
    const problems: string[] = [];
    for (const w of v.washOps) {
      for (const r of [...v.riverBank, ...v.riverWater]) {
        if (r.op.plate === w.op.plate && r.index < w.index) problems.push(`river op ${r.index} on the wash plate before wash op ${w.index}`);
      }
    }
    row('M3a-25', problems.length === 0, `(a) ${v.washOps.length} wash ops against ${v.riverBank.length + v.riverWater.length} river ops: ${problems.length} conflicts`, problems[0] ?? '-');
  }

  // ---- M3a-26 ----
  {
    const problems: string[] = [];
    interface Mark {
      hex: HexId;
      angle: number | null;
    }
    const marks: Record<string, Mark[]> = { furrow: [], 'swamp-mark': [], 'rough-mark': [] };
    const coverOf: Record<string, string> = { furrow: 'field', 'swamp-mark': 'swamp', 'rough-mark': 'rough' };
    let worstOut = 0;
    let outAt = '-';
    const checkPoints = (pts: readonly number[], want: string) => {
      for (let k = 0; k < pts.length; k += 2) {
        const x = pts[k] as number;
        const y = pts[k + 1] as number;
        // A part-hex takes the cover of the board hex nearest it (M3b-L-25).
        const h = nearestHex(g, x, y);
        if (h >= 0 && cover[h] === want) continue;
        let d = Infinity;
        const near = h >= 0 ? [h, ...[0, 1, 2, 3, 4, 5].map(dd => neighbourOf(g, h, dd))] : [];
        for (const q of near) if (q >= 0 && cover[q] === want) d = Math.min(d, polyDist(x, y, hexPoly(g, q)));
        if (d > worstOut) {
          worstOut = d;
          outAt = `${f3(x)},${f3(y)}`;
        }
      }
    };
    for (const op of list.ops) {
      const name = op.feature;
      if (!(name in marks)) continue;
      const want = coverOf[name] as string;
      const out = marks[name] as Mark[];
      if (op.op === 'pattern') {
        checkPoints(op.clip.flatMap(r => [...r]), want);
        for (const s of op.strokes) {
          const mx = ((s[0] as number) + (s[s.length - 2] as number)) / 2;
          const my = ((s[1] as number) + (s[s.length - 1] as number)) / 2;
          out.push({ hex: nearestHex(g, mx, my), angle: ((Math.atan2((s[s.length - 1] as number) - (s[1] as number), (s[s.length - 2] as number) - (s[0] as number)) * 180) / Math.PI + 360) % 180 });
        }
      } else if (op.op === 'stamp') {
        for (let i = 0; i < op.placements.length; i += 5) out.push({ hex: nearestHex(g, op.placements[i] as number, op.placements[i + 1] as number), angle: null });
        checkPoints(v.opPoints(op), want);
      } else if (op.op === 'fill') {
        for (const r of op.rings) out.push({ hex: worldToHex(g, ...centroid(r)), angle: null });
        checkPoints(v.opPoints(op), want);
      } else if (op.op === 'ribbon') {
        out.push({ hex: worldToHex(g, ...centroid(op.line)), angle: null });
        checkPoints(op.line, want);
      }
    }
    if (worstOut > 0.03) problems.push(`a mark's point lies ${f3(worstOut)} h outside its cover (${outAt})`);
    const least: Record<string, [number, string]> = {};
    for (let h = 0; h < n; h++) {
      const c = cover[h];
      // A field's furrows are judged by the plot rules of M3b-L-17.
      const name = c === 'swamp' ? 'swamp-mark' : c === 'rough' ? 'rough-mark' : null;
      if (!name) continue;
      const mine = (marks[name] as Mark[]).filter(m => m.hex === h);
      const need = name === 'swamp-mark' ? 3 : 10;
      if (!least[name] || mine.length < (least[name] as [number, string])[0]) least[name] = [mine.length, L(h)];
      if (mine.length < need) problems.push(`${c} hex ${L(h)} holds ${mine.length} ${name} marks`);
    }
    row('M3a-26', problems.length === 0,
      `fewest marks: ${Object.entries(least).map(([k, [c, at]]) => `${k} ${c} (${at})`).join(', ') || 'no marked cover'}; farthest point outside its cover ${f3(worstOut)} h`,
      problems[0] ?? outAt);
  }

  // ---- M3a-27 (a) ----
  {
    const problems: string[] = [];
    const names = v.glyphOps.filter(({ op }) => op.feature === 'town-name');
    const summary: string[] = [];
    for (const town of map.towns) {
      const mine = names.filter(({ op }) => op.text === town.name);
      if (mine.length !== 1) {
        problems.push(`${town.name}: ${mine.length} name ops`);
        continue;
      }
      const b = pointsBox(v.glyphPoints((mine[0] as { op: Parameters<ListView['glyphPoints']>[0] }).op));
      const h = b[3] - b[1];
      if (b[0] < bounds[0] || b[1] < bounds[1] || b[2] > bounds[2] || b[3] > bounds[3]) problems.push(`${town.name}: outlines leave the board`);
      if (h < 0.1 || h > 0.4) problems.push(`${town.name}: ${f3(h)} h tall`);
      const cx = (b[0] + b[2]) / 2;
      const cy = (b[1] + b[3]) / 2;
      let near = Infinity;
      for (const l of town.hexes) {
        const c = centreOf(g, hexOf(map, l));
        near = Math.min(near, Math.hypot(cx - c[0], cy - c[1]));
      }
      if (near > 1.5) problems.push(`${town.name}: centred ${f3(near)} h from its nearest hex`);
      summary.push(`${town.name} ${f3(h)}h@${f3(near)}`);
    }
    if (names.length !== map.towns.length) problems.push(`${names.length} town-name ops for ${map.towns.length} towns`);
    row('M3a-27', problems.length === 0, `(a) ${summary.join(', ') || 'no towns'}`, problems[0] ?? '-');
  }

  // ---- M3a-28 (a) ----
  {
    const other = v.glyphOps.filter(({ op }) => op.feature !== 'town-name' && op.feature !== 'spot-number');
    const features = [...new Set(v.glyphOps.map(({ op }) => op.feature))].sort();
    row('M3a-28', other.length === 0, `(a) glyph features: ${features.join(', ') || 'none'}`, other.length > 0 ? `op ${other[0]?.index} is ${other[0]?.op.feature}` : '-');
  }

  // ---- M3a-43: bridges with room to spare ----
  {
    const bridgeOps = list.ops.filter(o => o.feature === 'bridge');
    let worst = 0;
    let worstAt = '-';
    const problems: string[] = [];
    for (const label of map.bridges) {
      const h = hexOf(map, label);
      const c = centreOf(g, h);
      // The crossing: where the road and river centre lines meet nearest the hex centre.
      let point: [number, number] | null = null;
      let bestD = Infinity;
      for (const a of v.roadLines) {
        for (const b of v.riverLines) {
          for (let i = 0; i + 3 < a.length; i += 2) {
            for (let j = 0; j + 3 < b.length; j += 2) {
              const hit = segmentIntersection(a[i] as number, a[i + 1] as number, a[i + 2] as number, a[i + 3] as number, b[j] as number, b[j + 1] as number, b[j + 2] as number, b[j + 3] as number);
              if (!hit) continue;
              const p: [number, number] = [(a[i] as number) + ((a[i + 2] as number) - (a[i] as number)) * hit[0], (a[i + 1] as number) + ((a[i + 3] as number) - (a[i + 1] as number)) * hit[0]];
              const d = Math.hypot(p[0] - c[0], p[1] - c[1]);
              if (d < bestD) {
                bestD = d;
                point = p;
              }
            }
          }
        }
      }
      if (!point) {
        problems.push(`bridge ${label}: the road and river centre lines do not cross`);
        continue;
      }
      // Every bridge op that comes within 0.3 h of the crossing is part of its symbol.
      const p = point;
      const mine = bridgeOps.filter(o => {
        const pts = v.opPoints(o);
        for (let k = 0; k < pts.length; k += 2) if (Math.hypot((pts[k] as number) - p[0], (pts[k + 1] as number) - p[1]) <= 0.3) return true;
        return false;
      });
      if (mine.length === 0) {
        problems.push(`bridge ${label}: no bridge op near the crossing`);
        continue;
      }
      const far = Math.max(...mine.map(o => reachFrom(v, o, p[0], p[1])));
      if (far > worst) {
        worst = far;
        worstAt = `bridge ${label}`;
      }
      if (far > 0.11) problems.push(`bridge ${label}: the symbol reaches ${f3(far)} h from the crossing`);
    }
    row('M3a-43', problems.length === 0, `${map.bridges.length} bridges; the farthest point of a bridge symbol, half-width included, ${f3(worst)} h from its crossing`, problems[0] ?? worstAt);
  }

  // ---- round 3: shared facts ----
  const ribbonsOf = (names: readonly string[]) => list.ops.filter((o): o is RibbonOp => o.op === 'ribbon' && o.mode === 'draw' && names.includes(o.feature));
  const crestRibbons = ribbonsOf(['crest']);
  const outerRibbons = ribbonsOf(['crest-outer']);
  const hillRibbons = ribbonsOf(['crest', 'crest-outer', 'ridge', 'separator']);
  const outerSides = hl.outerCrests.map(([h, d]) => {
    const [p, q] = sideOf(g, h, d);
    const c = centreOf(g, h);
    const m = sideMidpoint(g, h, d);
    const l = Math.hypot(m[0] - c[0], m[1] - c[1]);
    // The unit normal pointing away from the hilltop.
    return { h, d, p, q, nx: (m[0] - c[0]) / l, ny: (m[1] - c[1]) / l };
  });
  const insideBy = (x: number, y: number, m: number) => x >= bounds[0] + m && x <= bounds[2] - m && y >= bounds[1] + m && y <= bounds[3] - m;
  /** Points every `step` h along a polyline (closed when `closed`), its vertices included. */
  const samplesAlong = (line: readonly number[], step: number, closed: boolean): number[] => {
    const out: number[] = [];
    const m = line.length / 2;
    const segs = closed ? m : m - 1;
    for (let i = 0; i < segs; i++) {
      const ax = line[2 * i] as number;
      const ay = line[2 * i + 1] as number;
      const bx = line[(2 * i + 2) % line.length] as number;
      const by = line[(2 * i + 3) % line.length] as number;
      const k = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / step));
      for (let j = 0; j < k; j++) out.push(ax + ((bx - ax) * j) / k, ay + ((by - ay) * j) / k);
    }
    if (!closed && m > 0) out.push(line[line.length - 2] as number, line[line.length - 1] as number);
    return out;
  };
  /** Hill-line ribbon segments in a coarse grid: each with its ribbon's half-width (largest of its two ends). */
  interface HillSeg {
    s: [number, number, number, number];
    hw: number;
  }
  const CELL = 0.5;
  const hillGrid = new Map<string, HillSeg[]>();
  for (const o of hillRibbons) {
    for (let i = 0; i + 3 < o.line.length; i += 2) {
      const s: [number, number, number, number] = [o.line[i] as number, o.line[i + 1] as number, o.line[i + 2] as number, o.line[i + 3] as number];
      const seg: HillSeg = { s, hw: Math.max(o.halfWidths[i / 2] as number, o.halfWidths[i / 2 + 1] as number) };
      for (let a = Math.floor(Math.min(s[0], s[2]) / CELL); a <= Math.floor(Math.max(s[0], s[2]) / CELL); a++) {
        for (let b = Math.floor(Math.min(s[1], s[3]) / CELL); b <= Math.floor(Math.max(s[1], s[3]) / CELL); b++) {
          const key = `${a},${b}`;
          const l = hillGrid.get(key);
          if (l) l.push(seg);
          else hillGrid.set(key, [seg]);
        }
      }
    }
  }
  const hillSegsNear = (box: readonly number[], reach: number): HillSeg[] => {
    const out = new Set<HillSeg>();
    for (let a = Math.floor(((box[0] as number) - reach) / CELL); a <= Math.floor(((box[2] as number) + reach) / CELL); a++) {
      for (let b = Math.floor(((box[1] as number) - reach) / CELL); b <= Math.floor(((box[3] as number) + reach) / CELL); b++) {
        for (const s of hillGrid.get(`${a},${b}`) ?? []) out.add(s);
      }
    }
    return [...out];
  };
  const nearHillLine = (x: number, y: number, within: number): boolean => {
    for (const hs of hillSegsNear([x, y, x, y], within)) {
      if (segDist(x, y, hs.s[0], hs.s[1], hs.s[2], hs.s[3]) <= within) return true;
    }
    return false;
  };
  /**
   * Every canopy as drawn: its outline ring and its centre. `body` is the bar's canopy (feature
   * `canopy`); the generator also draws a `canopy-outline` stamp a little larger under it, whose
   * rings are held to the same lines (`drawn`).
   */
  interface CanopyRing {
    x: number;
    y: number;
    ring: number[];
    body: boolean;
  }
  const canopyRings: CanopyRing[] = [];
  for (const op of list.ops) {
    if (op.mode !== 'draw' || (op.feature !== 'canopy' && op.feature !== 'canopy-outline')) continue;
    const body = op.feature === 'canopy';
    if (op.op === 'stamp') {
      const rings = stampRings(list, op);
      const per = rings.length / (op.placements.length / 5);
      rings.forEach((ring, k) => {
        const i = Math.floor(k / per) * 5;
        canopyRings.push({ x: op.placements[i] as number, y: op.placements[i + 1] as number, ring, body });
      });
    } else if (op.op === 'fill') {
      for (const r of op.rings) canopyRings.push({ x: centroid(r)[0], y: centroid(r)[1], ring: [...r], body });
    }
  }
  const ringBox = (r: readonly number[]) => pointsBox(r);

  // ---- M3a-47: a hilltop's outline is closed at the board edge ----
  {
    const problems: string[] = [];
    const outerLines = outerRibbons.map(o => o.line);
    let worstFit = 0;
    let fitAt = '-';
    for (const s of outerSides) {
      for (const t of [0.25, 0.75]) {
        const d = minLineDist(s.p[0] + (s.q[0] - s.p[0]) * t, s.p[1] + (s.q[1] - s.p[1]) * t, outerLines);
        if (d > worstFit) {
          worstFit = d;
          fitAt = `outer side ${L(s.h)} dir ${s.d}`;
        }
      }
    }
    // M3b-L-24 restates the distance: an outer crest is drawn inside the board, within 0.045 h of its side.
    if (worstFit > 0.045) problems.push(`no crest-outer ribbon runs along ${fitAt} (${f3(worstFit)} h)`);
    let stray = 0;
    let strayAt = '-';
    for (const o of outerRibbons) {
      const pts = samplesAlong(o.line, 0.05, false);
      for (let k = 0; k < pts.length; k += 2) {
        let d = Infinity;
        for (const s of outerSides) d = Math.min(d, segDist(pts[k] as number, pts[k + 1] as number, s.p[0], s.p[1], s.q[0], s.q[1]));
        if (d > stray) {
          stray = d;
          strayAt = `${f3(pts[k] as number)},${f3(pts[k + 1] as number)}`;
        }
      }
    }
    if (stray > 0.045) problems.push(`a crest-outer ribbon runs ${f3(stray)} h from every outer side (at ${strayAt})`);
    const style = (o: RibbonOp) => `${o.plate} tone ${o.tone} half-width ${[...new Set(o.halfWidths)].join('/')}`;
    const crestStyles = new Set(crestRibbons.map(style));
    for (const o of outerRibbons) {
      if (!crestStyles.has(style(o))) {
        problems.push(`a crest-outer ribbon is ${style(o)}; the crest ribbons are ${[...crestStyles].join(', ') || 'none'}`);
        break;
      }
    }
    row('M3a-47', problems.length === 0,
      `${outerSides.length} outer sides, ${outerRibbons.length} crest-outer ribbons (${[...new Set(outerRibbons.map(style))].join(', ') || '-'}); farthest outer-side point from them ${f3(worstFit)} h; farthest ribbon point from an outer side ${f3(stray)} h`,
      problems[0] ?? fitAt);
  }

  // ---- M3a-48 (a, b): the wash goes round a board-edge hilltop, and is cut back only along inked lines ----
  {
    const problems: string[] = [];
    let tested = 0;
    let unwashed = 0;
    let firstDry = '-';
    for (const s of outerSides) {
      for (const t of [0.25, 0.75]) {
        for (const dd of [0.05, 0.15]) {
          const x = s.p[0] + (s.q[0] - s.p[0]) * t + s.nx * dd;
          const y = s.p[1] + (s.q[1] - s.p[1]) * t + s.ny * dd;
          if (!insideBy(x, y, 0.02)) continue;
          tested++;
          if (!v.washed(x, y)) {
            unwashed++;
            if (firstDry === '-') firstDry = `beyond ${L(s.h)} dir ${s.d}, t ${t}, d ${dd} (${f3(x)},${f3(y)})`;
          }
        }
      }
    }
    if (unwashed > 0) problems.push(`${unwashed} point(s) beyond an outer side not washed: ${firstDry}`);
    const cutLines = ribbonsOf(['crest', 'crest-outer', 'ridge']).map(o => o.line);
    let edges = 0;
    let worstCut = 0;
    let cutAt = '-';
    for (const w of v.washOps) {
      if (w.op.mode !== 'erase') continue;
      for (const r of w.op.rings) {
        for (let i = 0; i < r.length; i += 2) {
          const seg = [r[i] as number, r[i + 1] as number, r[(i + 2) % r.length] as number, r[(i + 3) % r.length] as number];
          const all = samplesAlong(seg, 0.02, false);
          let inside = false;
          for (let k = 0; k < all.length; k += 2) {
            const x = all[k] as number;
            const y = all[k + 1] as number;
            if (!insideBy(x, y, 0)) continue;
            inside = true;
            const d = minLineDist(x, y, cutLines);
            if (d > worstCut) {
              worstCut = d;
              cutAt = `erase op ${w.index} at ${f3(x)},${f3(y)}`;
            }
          }
          if (inside) edges++;
        }
      }
    }
    if (worstCut > 0.03) problems.push(`the wash is cut back ${f3(worstCut)} h from any crest, outer crest or ridge line (${cutAt})`);
    row('M3a-48', problems.length === 0,
      `(a) ${tested} points beyond ${outerSides.length} outer sides, ${unwashed} not washed; (b) ${edges} erase-ring edges inside the board, farthest point ${f3(worstCut)} h from a crest, outer-crest or ridge line`,
      problems[0] ?? cutAt);
  }

  // ---- M3a-49 (a, b, c): canopies keep clear of hill lines ----
  {
    const problems: string[] = [];
    // (a) erase ops on the canopy's plate that follow a hill line (0.25 h or more of them within 0.03 h of one).
    const canopyPlates = new Set(list.ops.filter(o => o.feature === 'canopy').map(o => o.plate));
    let followers = 0;
    let firstFollower = '-';
    let erasers = 0;
    list.ops.forEach((op, i) => {
      if (op.mode !== 'erase' || !canopyPlates.has(op.plate)) return;
      erasers++;
      const paths: { line: readonly number[]; closed: boolean }[] = op.op === 'ribbon' ? [{ line: op.line, closed: false }]
        : op.op === 'fill' ? op.rings.map(r => ({ line: r, closed: true }))
          : op.op === 'pattern' ? op.strokes.map(s => ({ line: s, closed: false })) : [];
      let along = 0;
      for (const p of paths) {
        const pts = samplesAlong(p.line, 0.01, p.closed);
        for (let k = 0; k < pts.length; k += 2) if (nearHillLine(pts[k] as number, pts[k + 1] as number, 0.03)) along += 0.01;
      }
      if (along >= 0.25) {
        followers++;
        if (firstFollower === '-') firstFollower = `${op.feature} op ${i} (${f3(along)} h along hill lines)`;
      }
    });
    if (followers > 0) problems.push(`${followers} erase op(s) on the canopy's plate follow a hill line: ${firstFollower}`);
    // (b) every canopy's outline against every hill line, less that line's half-width.
    let leastBody = Infinity;
    let leastDrawn = Infinity;
    let leastAt = '-';
    for (const c of canopyRings) {
      const box = ringBox(c.ring);
      for (const hs of hillSegsNear(box, 0.3)) {
        const margin = polygonPolylineDist(c.ring, hs.s) - hs.hw;
        if (c.body && margin < leastBody) {
          leastBody = margin;
          leastAt = `canopy ${f3(c.x)},${f3(c.y)} in ${L(worldToHex(g, c.x, c.y))}`;
        }
        if (margin < leastDrawn) leastDrawn = margin;
      }
    }
    if (leastBody < 0.02) problems.push(`a canopy's outline comes ${f3(leastBody)} h beyond a hill line's half-width (${leastAt})`);
    if (leastDrawn < 0.02) problems.push(`a canopy-outline stamp comes ${f3(leastDrawn)} h beyond a hill line's half-width`);
    // (c) canopies centred in a hilltop hex against that hex's own crest and outer-crest sides.
    const ownSides = new Map<HexId, number[][]>();
    for (const [a, b] of hl.hilltopCrests) {
      const [p, q] = sideOf(g, a, directionTo(g, a, b));
      ownSides.set(a, [...(ownSides.get(a) ?? []), [p[0], p[1], q[0], q[1]]]);
    }
    for (const s of outerSides) ownSides.set(s.h, [...(ownSides.get(s.h) ?? []), [s.p[0], s.p[1], s.q[0], s.q[1]]]);
    let leastTop = Infinity;
    let topAt = '-';
    let onTops = 0;
    for (const c of canopyRings) {
      const h = worldToHex(g, c.x, c.y);
      if (h < 0 || level[h] !== 2) continue;
      if (c.body) onTops++;
      for (const s of ownSides.get(h) ?? []) {
        const d = polygonPolylineDist(c.ring, s);
        if (d < leastTop) {
          leastTop = d;
          topAt = `${c.body ? 'canopy' : 'canopy-outline'} ${f3(c.x)},${f3(c.y)} in hilltop ${L(h)}`;
        }
      }
    }
    if (leastTop < 0.07) problems.push(`a canopy on a hilltop comes ${f3(leastTop)} h from its hex's crest line (${topAt})`);
    row('M3a-49', problems.length === 0,
      `(a) ${erasers} erase ops on the canopy's plate, ${followers} follow a hill line; (b) least distance from a canopy's outline to a hill line, beyond its half-width: ${f3(leastBody)} h (with the canopy-outline stamps ${f3(leastDrawn)} h); (c) ${onTops} canopies on hilltops, least distance to their hex's crest lines ${f3(leastTop)} h`,
      problems[0] ?? `${leastAt}; ${topAt}`);
  }

  // ---- M3a-50 (list part): a hill number is never under trees ----
  {
    const problems: string[] = [];
    const tris = list.ops.filter(o => o.feature === 'spot-triangle' && o.op === 'fill').flatMap(o => (o.op === 'fill' ? o.rings.map(r => [...r]) : []));
    const nums = v.glyphOps.filter(({ op }) => op.feature === 'spot-number');
    const summary: string[] = [];
    let least = Infinity;
    for (const s of map.spotHeights) {
      const h = hexOf(map, s.hex);
      const tri = tris.filter(r => worldToHex(g, ...centroid(r)) === h);
      const num = nums.filter(({ op }) => {
        const b = pointsBox(v.glyphPoints(op));
        return worldToHex(g, (b[0] + b[2]) / 2, (b[1] + b[3]) / 2) === h;
      });
      if (tri.length === 0 && num.length === 0) {
        problems.push(`${s.hex}: no mark`);
        continue;
      }
      const pts = [...tri.flat(), ...num.flatMap(({ op }) => v.glyphPoints(op))];
      const b = pointsBox(pts);
      const grown = [b[0] - 0.03, b[1] - 0.03, b[2] + 0.03, b[3] + 0.03];
      const boxLine = [grown[0], grown[1], grown[2], grown[1], grown[2], grown[3], grown[0], grown[3], grown[0], grown[1]] as number[];
      let mine = Infinity;
      for (const c of canopyRings) {
        const cb = ringBox(c.ring);
        if (cb[0] > (grown[2] as number) + 0.5 || cb[2] < (grown[0] as number) - 0.5 || cb[1] > (grown[3] as number) + 0.5 || cb[3] < (grown[1] as number) - 0.5) continue;
        let d = polygonPolylineDist(c.ring, boxLine);
        for (let k = 0; k < c.ring.length && d > 0; k += 2) {
          const x = c.ring[k] as number;
          const y = c.ring[k + 1] as number;
          if (x >= (grown[0] as number) && x <= (grown[2] as number) && y >= (grown[1] as number) && y <= (grown[3] as number)) d = 0;
        }
        mine = Math.min(mine, d);
      }
      least = Math.min(least, mine);
      summary.push(`${s.hex} ${Number.isFinite(mine) ? f3(mine) : '-'}`);
      if (mine <= 0) problems.push(`${s.hex}: a canopy's outline lies inside the mark's box grown by 0.03 h`);
    }
    row('M3a-50', problems.length === 0,
      `least distance from a canopy's outline to the mark's box grown by 0.03 h, per spot height: ${summary.join(', ') || 'no spot heights'}`,
      problems[0] ?? (Number.isFinite(least) ? `least ${f3(least)} h` : 'no canopy near a mark'));
  }

  rows.push(...checkBase(map, list, explain));
  return rows;
}
