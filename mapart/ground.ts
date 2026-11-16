/**
 * Ground marks: field plots with furrows, swamp tint with reeds and water
 * dashes, rough ground with stipple and stones (docs/art/map-art-spec.md,
 * section 5; techniques-procgen-drawing.md 4.5). Marks are whole: a reed, a
 * dash, a stone or a dot is drawn complete inside its hex or not at all.
 *
 * Fields (the owner's O3, docs/bars/M3b.md line M3b-L-17): a field hex holds
 * two or three rectangular plots of furrows, the furrows of neighbouring
 * plots at right angles, the whole group turned as one. There are three
 * layouts: two halves, three strips, and an L of three. The group is made as
 * large as its hex allows at its turn, clear of roads and rivers.
 *
 * Ground cover runs on to the board rectangle (line M3b-L-25): a hex at the
 * board's edge is worked as its region (board.ts), the hex with its part-hexes.
 */
import { COL_STEP, HexId, centreOf, cornerOf, neighbourOf, sideCorners } from '../engine/core/hex';
import { clipHalfPlane, nearestHex, regionRing } from './board';
import { MapContext } from './context';
import { CentreLines, RIVER, ROAD } from './curves';
import { inRings, insetConvex, polygonPolylineDist, ringArea } from './geom';
import { between, unit } from './random';

export type FieldLayout = 'halves' | 'strips' | 'ell' | 'single';

export interface FieldHex {
  hex: HexId;
  layout: FieldLayout;
  /** The group's turn, in degrees from 0 to 90. */
  turn: number;
  /** The plots: four-cornered rings. */
  plots: number[][];
  /** The direction of each plot's furrows, in degrees from 0 to 180. */
  furrowAngles: number[];
  furrows: number[][];
}

export interface Placement {
  x: number;
  y: number;
  rot: number;
  sx: number;
  sy: number;
}

export interface SwampHex {
  hex: HexId;
  ring: number[];
  dashes: Placement[];
  reeds: Placement[];
}

export interface RoughHex {
  hex: HexId;
  dots: Placement[];
  stones: Placement[];
}

/** A plot in its group's own frame: a box from (u0, v0) to (u1, v1) of the unit square, and whether its furrows run along u. */
interface PlotBox {
  u0: number;
  v0: number;
  u1: number;
  v1: number;
  alongU: boolean;
}

/** The plots of a layout in the unit square; neighbouring plots have their furrows at right angles. */
function layoutBoxes(layout: FieldLayout, f: number, f2: number, firstAlongU: boolean): PlotBox[] {
  switch (layout) {
    case 'single':
      return [{ u0: 0, v0: 0, u1: 1, v1: 1, alongU: firstAlongU }];
    case 'halves': {
      const cut = 0.42 + 0.16 * f;
      return [{ u0: 0, v0: 0, u1: cut, v1: 1, alongU: firstAlongU }, { u0: cut, v0: 0, u1: 1, v1: 1, alongU: !firstAlongU }];
    }
    case 'strips': {
      const c1 = 0.3 + 0.07 * f;
      const c2 = 0.63 + 0.07 * f2;
      return [
        { u0: 0, v0: 0, u1: c1, v1: 1, alongU: firstAlongU }, { u0: c1, v0: 0, u1: c2, v1: 1, alongU: !firstAlongU },
        { u0: c2, v0: 0, u1: 1, v1: 1, alongU: firstAlongU },
      ];
    }
    case 'ell': {
      // Two plots side by side, and a third below the second: the first and third touch only at a corner.
      const cu = 0.42 + 0.12 * f;
      const cv = 0.46 + 0.12 * f2;
      return [
        { u0: 0, v0: 0, u1: cu, v1: cv, alongU: firstAlongU }, { u0: cu, v0: 0, u1: 1, v1: cv, alongU: !firstAlongU },
        { u0: cu, v0: cv, u1: 1, v1: 1, alongU: firstAlongU },
      ];
    }
  }
}

const LAYOUTS: readonly FieldLayout[] = ['halves', 'strips', 'ell'];
/** The area of a hex, in square h: one across flats, so the same number as the step between columns. */
const HEX_AREA = COL_STEP;

export function buildFields(ctx: MapContext, lines: CentreLines): FieldHex[] {
  const { g, seed } = ctx;
  const F = ctx.art.params.fields;
  const roadClear = ctx.art.params.roads.casingHalfWidth + F.roadGap;
  const riverClear = ctx.art.params.rivers.bankHalfWidth + F.roadGap;
  const out: FieldHex[] = [];
  for (const h of ctx.order) {
    if (ctx.cover[h] !== 'field') continue;
    const c = centreOf(g, h);
    // The ground a plot may stand on: the hex's region, in from every side it shares with a board hex.
    let free = regionRing(g, h);
    for (let d = 0; d < 6 && free.length > 0; d++) {
      if (neighbourOf(g, h, d) < 0) continue;
      const [k1, k2] = sideCorners(d);
      const p = cornerOf(g, h, k1);
      const q = cornerOf(g, h, k2);
      let nx = -(q[1] - p[1]);
      let ny = q[0] - p[0];
      const l = Math.hypot(nx, ny);
      nx /= l;
      ny /= l;
      if ((c[0] - p[0]) * nx + (c[1] - p[1]) * ny < 0) {
        nx = -nx;
        ny = -ny;
      }
      free = clipHalfPlane(free, p[0] + nx * F.inset, p[1] + ny * F.inset, nx, ny);
    }
    if (free.length < 6) {
      out.push({ hex: h, layout: 'single', turn: 0, plots: [], furrowAngles: [], furrows: [] });
      continue;
    }
    let fx = 0;
    let fy = 0;
    for (let i = 0; i < free.length; i += 2) {
      fx += free[i] as number;
      fy += free[i + 1] as number;
    }
    fx /= free.length / 2;
    fy /= free.length / 2;
    // Roads and rivers near this hex, as the runs of their points within reach of it.
    const near: { line: number[]; clear: number }[] = [];
    for (const [strokes, clear] of [[lines.roads, roadClear], [lines.rivers, riverClear]] as const) {
      for (const st of strokes) {
        let first = -1;
        let last = -1;
        for (let i = 0; i < st.line.length; i += 2) {
          if (Math.hypot((st.line[i] as number) - c[0], (st.line[i + 1] as number) - c[1]) < 0.8) {
            if (first < 0) first = i;
            last = i;
          }
        }
        // Every third point is enough to keep a plot clear of it (the line bends little in 0.15 h).
        if (first >= 0) {
          const run = st.line.slice(Math.max(0, first - 2), last + 4);
          const thin: number[] = [];
          for (let i = 0; i < run.length; i += 6) thin.push(run[i] as number, run[i + 1] as number);
          if ((run.length - 2) % 6 !== 0) thin.push(run[run.length - 2] as number, run[run.length - 1] as number);
          near.push({ line: thin, clear: clear + 0.004 });
        }
      }
    }
    const crossed = near.some(n => polygonPolylineDist(free, n.line) <= n.clear);
    // The group's turn: seeded; in a hex a road or river crosses, along that line where it passes nearest the centre.
    let turn = unit(seed, 'field-turn', h) * 90;
    if (crossed) {
      let best = Infinity;
      for (const n of near) {
        for (let i = 0; i + 3 < n.line.length; i += 2) {
          const mx = ((n.line[i] as number) + (n.line[i + 2] as number)) / 2;
          const my = ((n.line[i + 1] as number) + (n.line[i + 3] as number)) / 2;
          const dd = Math.hypot(mx - c[0], my - c[1]);
          if (dd < best) {
            best = dd;
            const deg = (Math.atan2((n.line[i + 3] as number) - (n.line[i + 1] as number), (n.line[i + 2] as number) - (n.line[i] as number)) * 180) / Math.PI;
            turn = ((deg % 90) + 90) % 90;
          }
        }
      }
    }
    const a = (turn * Math.PI) / 180;
    const ux = Math.cos(a);
    const uy = Math.sin(a);
    const vx = -uy;
    const vy = ux;
    const f1 = unit(seed, 'field-cut', h);
    const f2 = unit(seed, 'field-cut-2', h);
    const firstAlongU = unit(seed, 'field-furrow', h) < 0.5;
    const gap = F.gap;

    /** The plots of a layout at a centre, size and shape; null unless every plot stands on free ground. */
    const place = (boxes: readonly PlotBox[], cx: number, cy: number, w: number, hgt: number): number[][] | null => {
      const rings: number[][] = [];
      for (const b of boxes) {
        // Half the gap comes off every side a plot shares with another.
        const u0 = (b.u0 - 0.5) * w + (b.u0 > 0 ? gap / 2 : 0);
        const u1 = (b.u1 - 0.5) * w - (b.u1 < 1 ? gap / 2 : 0);
        const v0 = (b.v0 - 0.5) * hgt + (b.v0 > 0 ? gap / 2 : 0);
        const v1 = (b.v1 - 0.5) * hgt - (b.v1 < 1 ? gap / 2 : 0);
        if (u1 - u0 < 4 * F.spacing || v1 - v0 < 4 * F.spacing) return null;
        const ring: number[] = [];
        for (const [pu, pv] of [[u0, v0], [u1, v0], [u1, v1], [u0, v1]] as const) ring.push(cx + ux * pu + vx * pv, cy + uy * pu + vy * pv);
        for (let i = 0; i < 8; i += 2) if (!inRings(ring[i] as number, ring[i + 1] as number, [free])) return null;
        for (const n of near) if (polygonPolylineDist(ring, n.line) < n.clear) return null;
        rings.push(ring);
      }
      return rings;
    };
    const areaOf = (rings: readonly number[][]) => rings.reduce((sum, r) => sum + Math.abs(ringArea(r)), 0);

    /** The largest group of a layout that fits: over a few centres and shapes, the size grown until it no longer fits. */
    const fit = (layout: FieldLayout): number[][] | null => {
      const boxes = layoutBoxes(layout, f1, f2, firstAlongU);
      let best: number[][] | null = null;
      let bestArea = 0;
      const span = crossed ? 4 : 1;
      const step = crossed ? 0.085 : 0.05;
      for (let oi = -span; oi <= span; oi++) {
        for (let oj = -span; oj <= span; oj++) {
          const cx = fx + ux * oi * step + vx * oj * step;
          const cy = fy + uy * oi * step + vy * oj * step;
          for (const aspect of crossed ? [0.5, 0.8, 1.25, 2] : [0.62, 0.8, 1, 1.25, 1.6]) {
            let lo = 0;
            let hi = 1.3;
            let got: number[][] | null = null;
            for (let k = 0; k < 9; k++) {
              const size = (lo + hi) / 2;
              const rings = place(boxes, cx, cy, size * Math.sqrt(aspect), size / Math.sqrt(aspect));
              if (rings) {
                got = rings;
                lo = size;
              } else hi = size;
            }
            if (got) {
              const ar = areaOf(got);
              if (ar > bestArea + 1e-9) {
                bestArea = ar;
                best = got;
              }
            }
          }
        }
      }
      return best;
    };

    // The layout: seeded by the weights; another when that one would leave the hex too bare.
    const weights = F.layoutWeights;
    let roll = unit(seed, 'field-layout', h) * weights.reduce((x, y) => x + y, 0);
    let pick = 0;
    for (let k = 0; k < 3; k++) {
      pick = k;
      if (roll < (weights[k] as number)) break;
      roll -= weights[k] as number;
    }
    const order: FieldLayout[] = [LAYOUTS[pick] as FieldLayout, ...LAYOUTS.filter((_, k) => k !== pick)];
    let layout: FieldLayout = order[0] as FieldLayout;
    let plots: number[][] | null = null;
    for (const l of order) {
      const rings = fit(l);
      if (rings && (!plots || areaOf(rings) > areaOf(plots))) {
        plots = rings;
        layout = l;
      }
      if (plots && areaOf(plots) >= 0.41 * HEX_AREA) break;
    }
    if (crossed && (!plots || areaOf(plots) < 0.12)) {
      const one = fit('single');
      if (one && (!plots || areaOf(one) > areaOf(plots) * 1.5)) {
        plots = one;
        layout = 'single';
      }
    }
    if (!plots) {
      out.push({ hex: h, layout, turn, plots: [], furrowAngles: [], furrows: [] });
      continue;
    }
    const boxes = layoutBoxes(layout, f1, f2, firstAlongU);
    const furrows: number[][] = [];
    const furrowAngles: number[] = [];
    plots.forEach((ring, k) => {
      const alongU = (boxes[k] as PlotBox).alongU;
      // Corner 0 is (u0, v0), 1 is (u1, v0), 3 is (u0, v1).
      const ox = ring[0] as number;
      const oy = ring[1] as number;
      const eu = [(ring[2] as number) - ox, (ring[3] as number) - oy];
      const ev = [(ring[6] as number) - ox, (ring[7] as number) - oy];
      const along = alongU ? eu : ev;
      const across = alongU ? ev : eu;
      const width = Math.hypot(across[0] as number, across[1] as number);
      const count = Math.floor((width - 2 * 0.018) / F.spacing) + 1;
      const first = (width - (count - 1) * F.spacing) / 2;
      for (let i = 0; i < count; i++) {
        const t = (first + i * F.spacing) / width;
        const sx = ox + (across[0] as number) * t;
        const sy = oy + (across[1] as number) * t;
        furrows.push([sx, sy, sx + (along[0] as number), sy + (along[1] as number)]);
      }
      const deg = (Math.atan2(along[1] as number, along[0] as number) * 180) / Math.PI;
      furrowAngles.push(((deg % 180) + 180) % 180);
    });
    out.push({ hex: h, layout, turn, plots, furrowAngles, furrows });
  }
  return out.sort((x, y) => x.hex - y.hex);
}

/** Anchors on a jittered world lattice whose points fall in hex h. */
function anchorsIn(ctx: MapContext, h: HexId, pitch: number, tag: string): { x: number; y: number; i: number; j: number }[] {
  const c = centreOf(ctx.g, h);
  const out: { x: number; y: number; i: number; j: number }[] = [];
  // A hex at the board's edge is its region, part-hexes and all: up to a hex further out on every side.
  const i0 = Math.floor((c[0] - 1.2) / pitch);
  const i1 = Math.floor((c[0] + 1.2) / pitch);
  const j0 = Math.floor((c[1] - 1.05) / pitch);
  const j1 = Math.floor((c[1] + 1.05) / pitch);
  for (let i = i0; i <= i1; i++) {
    for (let j = j0; j <= j1; j++) {
      const x = (i + 0.15 + 0.7 * unit(ctx.seed, `${tag}-x`, i, j)) * pitch;
      const y = (j + 0.15 + 0.7 * unit(ctx.seed, `${tag}-y`, i, j)) * pitch;
      if (nearestHex(ctx.g, x, y) === h) out.push({ x, y, i, j });
    }
  }
  return out;
}

function clearOfLines(lines: CentreLines, x: number, y: number, road: number, river: number): boolean {
  return lines.index.nearestTagged(x, y, road, ROAD) === Infinity && lines.index.nearestTagged(x, y, river, RIVER) === Infinity;
}

export function buildSwamps(ctx: MapContext, lines: CentreLines): SwampHex[] {
  const S = ctx.art.params.swamp;
  const out: SwampHex[] = [];
  for (const h of ctx.order) {
    if (ctx.cover[h] !== 'swamp') continue;
    const ring = regionRing(ctx.g, h);
    const inner = insetConvex(ring, S.inset);
    const dashes: Placement[] = [];
    const reeds: Placement[] = [];
    for (const a of anchorsIn(ctx, h, S.pitch, 'swamp')) {
      const len = between(S.dashLengthMin, S.dashLengthMax, ctx.seed, 'swamp-dash', a.i, a.j);
      const hasReed = unit(ctx.seed, 'swamp-reed', a.i, a.j) < S.reedShare;
      // The whole mark: the dash, and the tuft standing on it.
      const top = hasReed ? S.reedHeight : S.dashHalfWidth;
      const halfW = Math.max(len / 2, hasReed ? S.reedHeight * 0.6 : 0);
      const corners = [a.x - halfW, a.y - top, a.x + halfW, a.y - top, a.x + halfW, a.y + S.dashHalfWidth, a.x - halfW, a.y + S.dashHalfWidth];
      let inside = true;
      for (let k = 0; k < corners.length; k += 2) if (!inRings(corners[k] as number, corners[k + 1] as number, [inner])) inside = false;
      if (!inside) continue;
      if (!clearOfLines(lines, a.x, a.y, S.roadClearance + halfW, S.riverClearance + halfW)) continue;
      dashes.push({ x: a.x, y: a.y, rot: 0, sx: len, sy: 2 * S.dashHalfWidth });
      if (hasReed) {
        const flip = unit(ctx.seed, 'swamp-reed-flip', a.i, a.j) < 0.5 ? -1 : 1;
        reeds.push({ x: a.x, y: a.y - S.dashHalfWidth, rot: 0, sx: S.reedHeight * flip, sy: S.reedHeight });
      }
    }
    out.push({ hex: h, ring, dashes, reeds });
  }
  return out.sort((a, b) => a.hex - b.hex);
}

export function buildRough(ctx: MapContext, lines: CentreLines): RoughHex[] {
  const Q = ctx.art.params.rough;
  const out: RoughHex[] = [];
  for (const h of ctx.order) {
    if (ctx.cover[h] !== 'rough') continue;
    const ring = regionRing(ctx.g, h);
    const dots: Placement[] = [];
    const stones: Placement[] = [];
    for (const a of anchorsIn(ctx, h, Q.pitch, 'rough')) {
      const stone = unit(ctx.seed, 'rough-stone', a.i, a.j) < Q.stoneShare;
      const r = stone
        ? between(Q.stoneRadiusMin, Q.stoneRadiusMax, ctx.seed, 'rough-size', a.i, a.j)
        : between(Q.dotRadiusMin, Q.dotRadiusMax, ctx.seed, 'rough-size', a.i, a.j);
      const inner = insetConvex(ring, Q.inset + r);
      if (!inRings(a.x, a.y, [inner])) continue;
      if (!clearOfLines(lines, a.x, a.y, Q.roadClearance + r, Q.riverClearance + r)) continue;
      const rot = unit(ctx.seed, 'rough-turn', a.i, a.j) * Math.PI * 2;
      if (stone) stones.push({ x: a.x, y: a.y, rot, sx: 2 * r, sy: 2 * r * 0.75 });
      else dots.push({ x: a.x, y: a.y, rot, sx: 2 * r, sy: 2 * r });
    }
    out.push({ hex: h, dots, stones });
  }
  return out.sort((a, b) => a.hex - b.hex);
}

/** A tuft of five blades standing on (0, 0), 1 tall, as one ring per blade. */
export function reedShape(): number[][] {
  const blades: number[][] = [];
  const spec: [number, number, number][] = [[-0.55, -0.62, 0.8], [-0.25, -0.3, 0.95], [0, 0, 1], [0.25, 0.3, 0.92], [0.55, 0.6, 0.78]];
  for (const [lean, base, height] of spec) {
    const w = 0.09;
    const tipX = lean * 0.75;
    blades.push([base * 0.18 - w, 0, base * 0.18 + w, 0, tipX + w * 0.15, -height, tipX - w * 0.15, -height]);
  }
  return blades;
}

/** A unit square centred on the origin (scaled to a dash). */
export function dashShape(): number[][] {
  return [[-0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5, 0.5]];
}

/** A disc 1 across, as a 12-gon. */
export function dotShape(): number[][] {
  const r: number[] = [];
  for (let k = 0; k < 12; k++) r.push(0.5 * Math.cos((k / 12) * Math.PI * 2), 0.5 * Math.sin((k / 12) * Math.PI * 2));
  return [r];
}

/** A rounded, slightly irregular stone 1 across. */
export function stoneShape(): number[][] {
  const r: number[] = [];
  const rad = [0.5, 0.46, 0.52, 0.44, 0.49, 0.5, 0.43];
  for (let k = 0; k < rad.length; k++) {
    const a = (k / rad.length) * Math.PI * 2;
    r.push((rad[k] as number) * Math.cos(a), (rad[k] as number) * Math.sin(a));
  }
  return [r];
}
