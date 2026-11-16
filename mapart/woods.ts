/**
 * Woods: canopies planted right through every wood, with a margin only along
 * the wood's outline (no bare lanes inside a wood), clear of roads, rivers and
 * spot heights (docs/art/map-art-spec.md, section 6, rows 1 to 3).
 *
 * Trees never cover a hill line (round 3 ruling of docs/bars/M3a.md): no part
 * of a canopy as drawn comes nearer to a crest, outer crest, ridge or
 * separator line than that line's half-width and a clearance, and in a
 * hilltop hex the trees stand in from the hilltop's crest lines by a larger
 * inset, a clump inside its outline. Each canopy is tested with its own size
 * and shape, so the edge a hill line leaves in a wood is scalloped, not ruled.
 * No part of a canopy comes inside the box kept clear round a spot height.
 *
 * Candidates come from a world lattice: cell (i, j) offers one point placed by
 * hash(seed, i, j). They are accepted in hashed priority order when no
 * accepted canopy is nearer than the spacing. The result depends on the seed,
 * the lattice and the map only, never on the order hexes are visited in, and
 * a change to one hex can move canopies only near that hex.
 *
 * Milestone 3b keeps that planting exactly, tree for tree (the owner: "the
 * trees ... look very very good right at this moment"), and adds to it, never
 * moving a tree that stands (docs/bars/M3b.md, lines M3b-L-25 and M3b-L-26):
 *
 *   - at the board's edge the same packing runs on into the part-hexes (the
 *     ground of the board rectangle that lies in no hex, each point counting
 *     as its nearest board hex), and up to the sides that have no neighbour,
 *     so a wood runs off the board and leaves no bare scallop;
 *   - a one-hex wooded hilltop that carries a hill number is planted as full
 *     as its lines allow: trees stand in to within `numberedHilltopInset` of
 *     its crest lines and `spotHeight.woodedClearance` of the number's box,
 *     and a tree left touching no other is taken out;
 *   - an outer crest is now drawn inside the board rectangle (hills.ts), so a
 *     tree that would stand too near where it is drawn is taken out.
 *
 * The added trees come from the same lattice in the same priority order, and
 * are accepted only where no tree already stands within the spacing.
 */
import { HexId, centreOf, cornersOf, neighbourOf, sideOf, worldToHex } from '../engine/core/hex';
import { hasPartHex, nearestHex, regionRing } from './board';
import { MapContext } from './context';
import { RIVER, ROAD, CentreLines } from './curves';
import { PointIndex, SegmentIndex, convexOverlap } from './geom';
import { hash32, signedUnit, unit } from './random';

export interface Canopy {
  hex: HexId;
  x: number;
  y: number;
  /** Across, in h. */
  size: number;
  rot: number;
  sx: number;
  sy: number;
}

/** A box the woods keep clear of: [minX, minY, maxX, maxY]. */
export type Box = readonly [number, number, number, number];

/** Smooth value noise in [0, 1) on a lattice of the given pitch. */
export function valueNoise(seed: number, tag: string, x: number, y: number, pitch: number): number {
  const fx = x / pitch;
  const fy = y / pitch;
  const i = Math.floor(fx);
  const j = Math.floor(fy);
  const tx = fx - i;
  const ty = fy - j;
  const sx = tx * tx * (3 - 2 * tx);
  const sy = ty * ty * (3 - 2 * ty);
  const v00 = unit(seed, tag, i, j);
  const v10 = unit(seed, tag, i + 1, j);
  const v01 = unit(seed, tag, i, j + 1);
  const v11 = unit(seed, tag, i + 1, j + 1);
  return (v00 * (1 - sx) + v10 * sx) * (1 - sy) + (v01 * (1 - sx) + v11 * sx) * sy;
}

/** The hill lines the woods keep clear of, as polylines. */
export interface HillLinePaths {
  crest: readonly (readonly number[])[];
  crestOuter: readonly (readonly number[])[];
  ridge: readonly (readonly number[])[];
  separator: readonly (readonly number[])[];
}

const CREST = 0;
const RIDGE = 1;
const SEPARATOR = 2;

/** The largest distance from a stamp's placement point to a point of its shape scaled by (sx, sy); turning does not change it. */
export function shapeReach(shape: readonly number[], sx: number, sy: number): number {
  let r = 0;
  for (let k = 0; k + 1 < shape.length; k += 2) r = Math.max(r, Math.hypot((shape[k] as number) * sx, (shape[k + 1] as number) * sy));
  return r;
}

/** Distance from a point to a box, 0 inside it. */
export function boxDistance(x: number, y: number, b: Box): number {
  return Math.hypot(Math.max(b[0] - x, 0, x - b[2]), Math.max(b[1] - y, 0, y - b[3]));
}

/** What Milestone 3b's additions need beside the 3a inputs. */
export interface LaterInputs {
  /** The hill lines as they are drawn (outer crests moved inside the board rectangle). */
  hill: HillLinePaths;
  /** The box of each spot height's mark, by hex, with no clearance added. */
  spotBoxes: ReadonlyMap<HexId, Box>;
  /** Clearance round the mark of a numbered one-hex wooded hilltop. */
  woodedClearance: number;
}

export interface Planting {
  /** The 3a planting, less any tree taken out (see `removed`). In paint order. */
  canopies: Canopy[];
  /** The trees Milestone 3b adds: in part-hexes and up to the board's edge, and on numbered one-hex wooded hilltops. In paint order. */
  added: Canopy[];
  /** Trees of the 3a planting taken out: beside an outer crest now drawn inside the board, and strays on a numbered hilltop. */
  removed: { besideOuterCrest: number; strays: number };
}

/** The 3a planting alone: `plantWoods(...).canopies` before anything is taken out is exactly this. */
export function plantWoods(ctx: MapContext, lines: CentreLines, keepClear: readonly Box[], hill: HillLinePaths, later: LaterInputs): Planting {
  const { g, cover, level, seed } = ctx;
  const P = ctx.art.params.woods;
  const H = ctx.art.params.hillLines;
  const isWood = (h: HexId) => h >= 0 && cover[h] === 'woods';

  // The hill lines, and how far the outline of a canopy keeps from each kind.
  const hillIndex = new SegmentIndex(0.25);
  for (const l of [...hill.crest, ...hill.crestOuter]) hillIndex.addPolyline(l, CREST);
  for (const l of hill.ridge) hillIndex.addPolyline(l, RIDGE);
  for (const l of hill.separator) hillIndex.addPolyline(l, SEPARATOR);
  const crestClear = H.crestHalfWidth + P.hillLineClearance;
  const ridgeClear = H.ridgeHalfWidth + P.hillLineClearance;
  const separatorClear = H.separatorHalfWidth + P.hillLineClearance;
  const topClear = Math.max(crestClear, P.hilltopInset);
  // The canopy as drawn: its shape at the outline's scale, the largest of its stamps.
  const shape = canopyShape();
  const largest = P.canopySize * (1 + P.sizeVariation) * P.outlineScale * shapeReach(shape, 1 + P.squash, 1 + P.squash);
  const hillReach = largest + Math.max(topClear, ridgeClear, separatorClear);

  // The wood's outline: every side between a wood hex and a hex that is not woods, or the board edge.
  const outline = new SegmentIndex(0.25);
  const woodHexes = ctx.order.filter(h => cover[h] === 'woods');
  for (const h of [...woodHexes].sort((a, b) => a - b)) {
    for (let d = 0; d < 6; d++) {
      if (isWood(neighbourOf(g, h, d))) continue;
      const [p, q] = sideOf(g, h, d);
      outline.add(p[0], p[1], q[0], q[1]);
    }
  }

  interface Candidate {
    i: number;
    j: number;
    x: number;
    y: number;
    hex: HexId;
    pri: number;
  }
  const candidates: Candidate[] = [];
  const pitch = P.latticePitch;
  const maxMargin = P.edgeMargin + P.edgeMarginVariation;
  for (const h of woodHexes) {
    const c = centreOf(g, h);
    // The hex's extent, from its corners: the lattice cells it can hold, and how far it reaches from its centre.
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    let reach = 0;
    for (const k of cornersOf(g, h)) {
      x0 = Math.min(x0, k[0]);
      y0 = Math.min(y0, k[1]);
      x1 = Math.max(x1, k[0]);
      y1 = Math.max(y1, k[1]);
      reach = Math.max(reach, Math.hypot(k[0] - c[0], k[1] - c[1]));
    }
    const i0 = Math.floor(x0 / pitch);
    const i1 = Math.floor(x1 / pitch);
    const j0 = Math.floor(y0 / pitch);
    const j1 = Math.floor(y1 / pitch);
    // Whether any road or river comes near this hex at all (most wood hexes have none).
    const linesNear = lines.index.nearest(c[0], c[1], reach + Math.max(P.roadClearance, P.riverClearance)) !== Infinity;
    // The same for hill lines and the boxes kept clear round spot heights.
    const hillNear = hillIndex.size > 0 && hillIndex.nearest(c[0], c[1], reach + hillReach) !== Infinity;
    const boxes = keepClear.filter(b => boxDistance(c[0], c[1], b) < reach + largest);
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const x = (i + unit(seed, 'canopy-x', i, j)) * pitch;
        const y = (j + unit(seed, 'canopy-y', i, j)) * pitch;
        if (worldToHex(g, x, y) !== h) continue;
        // Margin along the wood's outline, varied smoothly so the edge is not ruled.
        const edge = outline.nearest(x, y, maxMargin);
        if (edge !== Infinity && edge < P.edgeMargin + P.edgeMarginVariation * valueNoise(seed, 'wood-edge', x, y, 0.35)) continue;
        if (linesNear && lines.index.nearestTagged(x, y, P.roadClearance, ROAD) < P.roadClearance) continue;
        if (linesNear && lines.index.nearestTagged(x, y, P.riverClearance, RIVER) < P.riverClearance) continue;
        if (hillNear || boxes.length > 0) {
          // How far this canopy reaches from its centre as drawn (its own size and squash).
          const squash = P.squash * signedUnit(seed, 'canopy-squash', i, j);
          const size = P.canopySize * (1 + P.sizeVariation * signedUnit(seed, 'canopy-size', i, j));
          const reachOut = size * P.outlineScale * shapeReach(shape, 1 + squash, 1 - squash);
          if (boxes.some(b => boxDistance(x, y, b) < reachOut)) continue;
          // Most candidates lie nowhere near a hill line: one untagged look first.
          if (hillNear && hillIndex.nearest(x, y, hillReach) !== Infinity) {
            const near = (tag: number, clear: number) => hillIndex.nearestTagged(x, y, hillReach, tag) - reachOut < clear;
            if (near(CREST, level[h] === 2 ? topClear : crestClear) || near(RIDGE, ridgeClear) || near(SEPARATOR, separatorClear)) continue;
          }
        }
        candidates.push({ i, j, x, y, hex: h, pri: hash32(seed, 'canopy-priority', i, j) });
      }
    }
  }
  candidates.sort((a, b) => b.pri - a.pri || a.i - b.i || a.j - b.j);

  const accepted = new PointIndex(P.spacing);
  const out: Canopy[] = [];
  const turn = (P.turn * Math.PI) / 180;
  for (const c of candidates) {
    if (accepted.anyWithin(c.x, c.y, P.spacing)) continue;
    accepted.add(c.x, c.y);
    // The same size and squash the clearances above were tested with.
    const squash = P.squash * signedUnit(seed, 'canopy-squash', c.i, c.j);
    out.push({
      hex: c.hex,
      x: c.x,
      y: c.y,
      size: P.canopySize * (1 + P.sizeVariation * signedUnit(seed, 'canopy-size', c.i, c.j)),
      rot: turn * signedUnit(seed, 'canopy-turn', c.i, c.j),
      sx: 1 + squash,
      sy: 1 - squash,
    });
  }
  // Painted top to bottom, then left to right, so a canopy lower on the sheet lies over the one above it.
  out.sort((a, b) => a.hex - b.hex || a.y - b.y || a.x - b.x);

  // =========================================================================
  // Milestone 3b: additions to the planting above, which stays where it is.
  // =========================================================================
  const reachOf = (c: Canopy) => c.size * P.outlineScale * shapeReach(shape, c.sx, c.sy);
  const removed = { besideOuterCrest: 0, strays: 0 };

  // ---- the hill lines as drawn: outer crests now lie inside the board rectangle ----
  const drawn = new SegmentIndex(0.25);
  for (const l of [...later.hill.crest, ...later.hill.crestOuter]) drawn.addPolyline(l, CREST);
  for (const l of later.hill.ridge) drawn.addPolyline(l, RIDGE);
  for (const l of later.hill.separator) drawn.addPolyline(l, SEPARATOR);
  const drawnOuter = new SegmentIndex(0.25);
  for (const l of later.hill.crestOuter) drawnOuter.addPolyline(l, CREST);
  let kept = out;
  if (drawnOuter.size > 0) {
    kept = out.filter(c => {
      const d = drawnOuter.nearest(c.x, c.y, hillReach);
      const ok = d === Infinity || d - reachOf(c) >= (level[c.hex] === 2 ? topClear : crestClear);
      if (!ok) removed.besideOuterCrest++;
      return ok;
    });
  }

  // ---- where more trees may stand ----
  // A numbered one-hex wooded hilltop: woods, a hilltop with no hilltop beside it, carrying a spot height.
  const numbered = new Set<HexId>();
  for (const s of ctx.spots) {
    const h = s.hex;
    if (cover[h] !== 'woods' || level[h] !== 2) continue;
    let single = true;
    for (let d = 0; d < 6; d++) {
      const nb = neighbourOf(g, h, d);
      if (nb >= 0 && level[nb] === 2) single = false;
    }
    if (single) numbered.add(h);
  }
  // The wood's outline for the trees added at the board's edge: only the sides towards a board hex
  // that is not woods, each carried on past an end where the next side round has no neighbour (the
  // line between two hexes' part-hexes). A side with no neighbour is no outline: the wood runs off.
  const outline2 = new SegmentIndex(0.25);
  for (const h of [...woodHexes].sort((a, b) => a - b)) {
    for (let d = 0; d < 6; d++) {
      const nb = neighbourOf(g, h, d);
      if (nb < 0 || isWood(nb)) continue;
      const [p, q] = sideOf(g, h, d);
      let ax = p[0];
      let ay = p[1];
      let bx = q[0];
      let by = q[1];
      if (neighbourOf(g, h, (d + 5) % 6) < 0) {
        ax -= q[0] - p[0];
        ay -= q[1] - p[1];
      }
      if (neighbourOf(g, h, (d + 1) % 6) < 0) {
        bx += q[0] - p[0];
        by += q[1] - p[1];
      }
      outline2.add(ax, ay, bx, by);
    }
  }
  const more: Candidate[] = [];
  const numberedInset = Math.max(crestClear, P.numberedHilltopInset);
  for (const h of woodHexes) {
    const isNumbered = numbered.has(h);
    if (!isNumbered && !hasPartHex(g, h)) continue;
    const c = centreOf(g, h);
    const ring = regionRing(g, h);
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    let reach = 0;
    for (let k = 0; k < ring.length; k += 2) {
      x0 = Math.min(x0, ring[k] as number);
      y0 = Math.min(y0, ring[k + 1] as number);
      x1 = Math.max(x1, ring[k] as number);
      y1 = Math.max(y1, ring[k + 1] as number);
      reach = Math.max(reach, Math.hypot((ring[k] as number) - c[0], (ring[k + 1] as number) - c[1]));
    }
    const linesNear = lines.index.nearest(c[0], c[1], reach + Math.max(P.roadClearance, P.riverClearance)) !== Infinity;
    const hillNear = drawn.size > 0 && drawn.nearest(c[0], c[1], reach + hillReach) !== Infinity;
    const spot = later.spotBoxes.get(h);
    const boxes: Box[] = isNumbered && spot
      ? [[spot[0] - later.woodedClearance, spot[1] - later.woodedClearance, spot[2] + later.woodedClearance, spot[3] + later.woodedClearance]]
      : keepClear.filter(b => boxDistance(c[0], c[1], b) < reach + largest);
    for (let i = Math.floor(x0 / pitch); i <= Math.floor(x1 / pitch); i++) {
      for (let j = Math.floor(y0 / pitch); j <= Math.floor(y1 / pitch); j++) {
        const x = (i + unit(seed, 'canopy-x', i, j)) * pitch;
        const y = (j + unit(seed, 'canopy-y', i, j)) * pitch;
        if (nearestHex(g, x, y) !== h) continue;
        // In a hex the margin wanders as in 3a; in a part-hex, so small a piece, it is the least margin, unvaried.
        const edge = outline2.nearest(x, y, maxMargin);
        const wander = worldToHex(g, x, y) === h ? P.edgeMarginVariation * valueNoise(seed, 'wood-edge', x, y, 0.35) : 0;
        if (edge !== Infinity && edge < P.edgeMargin + wander) continue;
        if (linesNear && lines.index.nearestTagged(x, y, P.roadClearance, ROAD) < P.roadClearance) continue;
        if (linesNear && lines.index.nearestTagged(x, y, P.riverClearance, RIVER) < P.riverClearance) continue;
        if (hillNear || boxes.length > 0) {
          const squash = P.squash * signedUnit(seed, 'canopy-squash', i, j);
          const size = P.canopySize * (1 + P.sizeVariation * signedUnit(seed, 'canopy-size', i, j));
          const reachOut = size * P.outlineScale * shapeReach(shape, 1 + squash, 1 - squash);
          if (boxes.some(b => boxDistance(x, y, b) < reachOut)) continue;
          if (hillNear && drawn.nearest(x, y, hillReach) !== Infinity) {
            const near = (tag: number, clear: number) => drawn.nearestTagged(x, y, hillReach, tag) - reachOut < clear;
            if (near(CREST, level[h] === 2 ? (isNumbered ? numberedInset : topClear) : crestClear) || near(RIDGE, ridgeClear) || near(SEPARATOR, separatorClear)) continue;
          }
        }
        more.push({ i, j, x, y, hex: h, pri: hash32(seed, 'canopy-priority', i, j) });
      }
    }
  }
  more.sort((a, b) => b.pri - a.pri || a.i - b.i || a.j - b.j);
  // Every tree of the 3a planting holds its ground, the ones taken out too: nothing new stands within the spacing of it.
  let added: Canopy[] = [];
  for (const c of more) {
    if (accepted.anyWithin(c.x, c.y, P.spacing)) continue;
    accepted.add(c.x, c.y);
    const squash = P.squash * signedUnit(seed, 'canopy-squash', c.i, c.j);
    added.push({
      hex: c.hex, x: c.x, y: c.y,
      size: P.canopySize * (1 + P.sizeVariation * signedUnit(seed, 'canopy-size', c.i, c.j)),
      rot: turn * signedUnit(seed, 'canopy-turn', c.i, c.j),
      sx: 1 + squash, sy: 1 - squash,
    });
  }

  // ---- no stray on a numbered hilltop: a tree whose outline touches no other is taken out ----
  if (numbered.size > 0) {
    const outlineOf = (c: Canopy): number[] => {
      const cos = Math.cos(c.rot);
      const sin = Math.sin(c.rot);
      const ring: number[] = [];
      for (let k = 0; k < shape.length; k += 2) {
        const u = (shape[k] as number) * c.size * c.sx * P.outlineScale;
        const v = (shape[k + 1] as number) * c.size * c.sy * P.outlineScale;
        ring.push(c.x + cos * u - sin * v, c.y + sin * u + cos * v);
      }
      return ring;
    };
    for (const h of numbered) {
      let group = [...kept.filter(c => c.hex === h), ...added.filter(c => c.hex === h)];
      const gone = new Set<Canopy>();
      for (let pass = 0; pass < 8; pass++) {
        const rings = group.map(outlineOf);
        const stray = group.filter((_, a) => !group.some((__, b) => b !== a && convexOverlap(rings[a] as number[], rings[b] as number[], 0.008)));
        if (stray.length === 0) break;
        for (const s of stray) gone.add(s);
        group = group.filter(c => !gone.has(c));
      }
      if (gone.size > 0) {
        removed.strays += kept.filter(c => gone.has(c)).length;
        kept = kept.filter(c => !gone.has(c));
        added = added.filter(c => !gone.has(c));
      }
    }
  }
  added.sort((a, b) => a.hex - b.hex || a.y - b.y || a.x - b.x);
  return { canopies: kept, added, removed };
}

/** The canopy outline: a slightly irregular ten-sided blob, 1 across. */
export function canopyShape(): number[] {
  const ring: number[] = [];
  const k = 10;
  for (let i = 0; i < k; i++) {
    const a = (i / k) * Math.PI * 2;
    const r = 0.5 * (1 + 0.06 * Math.sin(3 * a + 0.7) + 0.04 * Math.cos(5 * a));
    ring.push(r * Math.cos(a), r * Math.sin(a));
  }
  return ring;
}
