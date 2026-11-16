/**
 * Hills: the slope wash, the crest, ridge and separator lines, spot heights.
 *
 * The owner's hill model (PLAN.md decision M7): a slope is not a hex; it is
 * the hill area round a crest, and a crest is a hexside. So the wash is one
 * soft fill round the crest edges of each hill (hilltop edges and ridge
 * chains), cut back by an erase op over the hilltop hexes: full at the crest,
 * gone about 0.55 h out, never inside a hilltop, with no outline where it
 * fades (the lead's ruling 7). The hill lines drawn are exactly the derived
 * set of engine/core/hillLines.ts.
 *
 * Every side of a hilltop is a crest, the sides on the board edge too (round 3
 * ruling of docs/bars/M3a.md): those are the outer crests of
 * engine/core/hillLines.ts, drawn as crest lines under a feature of their own
 * (`crest-outer`), so a hilltop at the board edge has a closed outline. The
 * wash runs round them as round any other crest, into the part-hexes between
 * the hilltop and the board rectangle, and is cut back only over the hilltop
 * hexes, whose outline is inked all round; the board rectangle cuts the rest.
 *
 * An outer crest is drawn wholly inside the board (docs/bars/M3b.md, line
 * M3b-L-24): where a hilltop's side lies on the board rectangle itself, the
 * line's points are moved in by the line's half-width and its plate's offset,
 * so the trim never halves it, and the cut-back of the wash follows the line.
 */
import { HexId, neighbourOf, sideOf, worldBounds } from '../engine/core/hex';
import { MapContext } from './context';
import { SegmentIndex, segDist, simplifyRing, zeroContours } from './geom';
import { chainEdges, chainOuterSides, edgeSegment, hexSetOutline } from './regions';

export interface WashGroup {
  /** Rings of the soft fill. */
  rings: number[][];
  /** Rings of what it is cut back over (may be empty: a ridge): the hilltop hexes. */
  tops: number[][];
  /** Lowest edge key, for ordering. */
  key: number;
}

interface Unit {
  edges: [number, number, number, number][];
  tops: HexId[];
  key: number;
}

function segSegDist(a: readonly number[], b: readonly number[]): number {
  return Math.min(
    segDist(a[0] as number, a[1] as number, b[0] as number, b[1] as number, b[2] as number, b[3] as number),
    segDist(a[2] as number, a[3] as number, b[0] as number, b[1] as number, b[2] as number, b[3] as number),
    segDist(b[0] as number, b[1] as number, a[0] as number, a[1] as number, a[2] as number, a[3] as number),
    segDist(b[2] as number, b[3] as number, a[0] as number, a[1] as number, a[2] as number, a[3] as number),
  );
}

/** How far inside the board rectangle the points of an outer crest are kept: its half-width, its plate's offset and a hair. */
export function outerCrestMargin(ctx: MapContext): number {
  const plate = ctx.art.inks.plates.find(p => p.id === ctx.art.params.plates.crest);
  const off = plate ? Math.max(Math.abs(plate.offset[0]), Math.abs(plate.offset[1])) : 0;
  return ctx.art.params.hillLines.crestHalfWidth + off + 0.002;
}

/** A line with every point moved the least distance that puts it `margin` inside the board rectangle. */
function keptInside(line: readonly number[], bounds: readonly number[], margin: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < line.length; i += 2) {
    out.push(
      Math.min((bounds[2] as number) - margin, Math.max((bounds[0] as number) + margin, line[i] as number)),
      Math.min((bounds[3] as number) - margin, Math.max((bounds[1] as number) + margin, line[i + 1] as number)),
    );
  }
  return out;
}

/** The wash of every hill, grouped so that washes that would touch share one op. */
export function buildWash(ctx: MapContext): WashGroup[] {
  const { g, level } = ctx;
  const P = ctx.art.params.wash;
  const boardBounds = worldBounds(g);
  const crestMargin = outerCrestMargin(ctx);

  // ---- units: each hilltop mass with its crest edges, and each ridge edge ----
  const units: Unit[] = [];
  const seen = new Uint8Array(ctx.n);
  for (const start of ctx.order) {
    if (level[start] !== 2 || seen[start]) continue;
    const mass: HexId[] = [start];
    seen[start] = 1;
    for (let i = 0; i < mass.length; i++) {
      for (let d = 0; d < 6; d++) {
        const nb = neighbourOf(g, mass[i] as HexId, d);
        if (nb >= 0 && level[nb] === 2 && !seen[nb]) {
          seen[nb] = 1;
          mass.push(nb);
        }
      }
    }
    mass.sort((a, b) => a - b);
    const inMass = new Set(mass);
    const crest = ctx.crestEdges.filter(([top]) => inMass.has(top));
    // The mass's sides on the board edge are crests too: the wash runs round them.
    const outer = ctx.hill.outerCrests.filter(([top]) => inMass.has(top)).sort((x, y) => x[0] - y[0] || x[1] - y[1]);
    units.push({
      edges: [
        ...crest.map(([a, b]) => edgeSegment(g, a, b)),
        ...outer.map(([h, d]): [number, number, number, number] => {
          const [p, q] = sideOf(g, h, d);
          return [p[0], p[1], q[0], q[1]];
        }),
      ],
      tops: mass,
      key: (mass[0] as HexId) * 8,
    });
  }
  for (const [a, b] of ctx.ridgeEdges) {
    units.push({ edges: [edgeSegment(g, a, b)], tops: [], key: Math.min(a, b) * 8 + 1 + (Math.max(a, b) % 6) });
  }
  units.sort((x, y) => x.key - y.key || (x.edges[0]?.[0] ?? 0) - (y.edges[0]?.[0] ?? 0));

  // ---- merge units whose crests come within mergeDistance ----
  const parent = units.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) i = parent[i] = parent[parent[i] as number] as number;
    return i;
  };
  for (let i = 0; i < units.length; i++) {
    for (let j = i + 1; j < units.length; j++) {
      const ui = units[i] as Unit;
      const uj = units[j] as Unit;
      let close = false;
      for (const a of ui.edges) {
        for (const b of uj.edges) {
          if (segSegDist(a, b) < P.mergeDistance) {
            close = true;
            break;
          }
        }
        if (close) break;
      }
      if (close) {
        const ri = find(i);
        const rj = find(j);
        if (ri !== rj) parent[Math.max(ri, rj)] = Math.min(ri, rj);
      }
    }
  }
  const groups = new Map<number, Unit[]>();
  units.forEach((u, i) => {
    const r = find(i);
    const list = groups.get(r);
    if (list) list.push(u);
    else groups.set(r, [u]);
  });

  const out: WashGroup[] = [];
  for (const [, members] of [...groups.entries()].sort((x, y) => x[0] - y[0])) {
    const edges = members.flatMap(u => u.edges);
    const tops = new Set(members.flatMap(u => u.tops));
    if (edges.length === 0) continue;
    const crestIndex = new SegmentIndex(0.25);
    for (const e of edges) crestIndex.add(e[0], e[1], e[2], e[3]);
    const topRings = tops.size > 0 ? hexSetOutline(g, tops) : [];
    // The cut-back follows the hilltop's outline as it is inked: drawn in from the board rectangle.
    const cutRings = topRings.map(r => keptInside(r, boardBounds, crestMargin));
    // Bounding box of the crests and tops, grown by the ring and a margin.
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    const grow = (x: number, y: number) => {
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    };
    for (const e of edges) {
      grow(e[0], e[1]);
      grow(e[2], e[3]);
    }
    for (const r of topRings) for (let i = 0; i < r.length; i += 2) grow(r[i] as number, r[i + 1] as number);
    const step = P.gridStep;
    const pad = P.ringOffset + 4 * step;
    const i0 = Math.floor((x0 - pad) / step);
    const i1 = Math.ceil((x1 + pad) / step);
    const j0 = Math.floor((y0 - pad) / step);
    const j1 = Math.ceil((y1 + pad) / step);
    const nx = i1 - i0 + 1;
    const ny = j1 - j0 + 1;
    const values = new Float64Array(nx * ny);
    const reach = P.ringOffset + 3 * step;
    for (let j = 0; j < ny; j++) {
      const y = (j0 + j) * step;
      for (let i = 0; i < nx; i++) {
        const x = (i0 + i) * step;
        // The hill area round the crests: everything within ringOffset of a crest, outer crest or
        // ridge edge. This ring also runs over the hilltops; the erase op over them cuts it back.
        const dc = crestIndex.nearest(x, y, reach);
        values[j * nx + i] = (dc === Infinity ? reach : dc) - P.ringOffset;
      }
    }
    const rings = zeroContours(values, nx, ny, i0 * step, j0 * step, step).map(r => simplifyRing(r, P.simplify));
    out.push({ rings, tops: cutRings, key: members[0]?.key ?? 0 });
  }
  return out;
}

export interface HillLineSet {
  crest: number[][];
  /** The sides of hilltops on the board edge: crests, drawn under a feature of their own, wholly inside the board rectangle. */
  crestOuter: number[][];
  /** The same sides where they lie, on the hexsides (the geometry Milestone 3a planted woods against). */
  crestOuterSides: number[][];
  ridge: number[][];
  separator: number[][];
}

/** The hill lines as polylines along hexsides: exactly the derived set. */
export function buildHillLines(ctx: MapContext): HillLineSet {
  return {
    crest: chainEdges(ctx.g, ctx.crestEdges),
    crestOuter: chainOuterSides(ctx.g, ctx.hill.outerCrests).map(l => keptInside(l, worldBounds(ctx.g), outerCrestMargin(ctx))),
    crestOuterSides: chainOuterSides(ctx.g, ctx.hill.outerCrests),
    ridge: chainEdges(ctx.g, ctx.ridgeEdges),
    separator: chainEdges(ctx.g, ctx.separators),
  };
}
