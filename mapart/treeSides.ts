/**
 * Woods from tree sides: the planting for a map that has a `trees` layer.
 *
 * THE MODEL (the owner's). Woods are a hexside feature, as slopes are. The map
 * places TREE SIDES, each a hexside with a strength, and nothing else. A hex
 * all six of whose sides are set gets a HELPER at its centre, derived here and
 * never stored. Every set side is a source at the side's middle and every
 * helper a source at its hex's centre; THE FIELD at a place is the sum over
 * sources of strength * (1 - d^2 / r^2)^2 inside each source's radius r, and
 * THE WOOD IS WHERE THE FIELD REACHES THE THRESHOLD. So one set side carries a
 * group of trees that stands in both its hexes; three strong sides at a vertex
 * fill the space round the vertex; a group of hexes with every side set is one
 * mass that runs out beyond its outer sides. No hex is ever filled with trees,
 * and nothing here measures how much of a hex is covered. "Tree hex" is only a
 * label that follows (engine/core/map treeHexesOf): the planting never reads it.
 *
 * THE DRAW PASS visits a jittered lattice (the centres of a small hexagon
 * tiling, each moved by a seeded offset inside a disc) over a rectangle larger
 * than the field. At each lattice point it samples the field times the road
 * and stream mask; where that is at least the threshold plus a seeded noise,
 * one CLUMP is stamped there: a seeded pick from a fixed set, turned by a
 * seeded angle. The noise is never negative, so no clump is stamped outside
 * the threshold line; few lattice points pass where the field is a little over
 * the threshold and all pass where it is well over, which makes a wood's edge
 * and a lone side loose and its heart dense. A clump is 8 to 10 trees, each
 * drawn exactly as woods.ts's trees are drawn, and it is drawn whole: its
 * trees' outlines, their bodies, their highlights, before the next clump is
 * begun; clumps are painted down the sheet. No tree is thinned against
 * another clump.
 *
 * ROADS AND STREAMS mask the tree area: the field is multiplied by a mask that
 * is nothing along their corridor and comes back to full a little way beyond.
 * Beside that, a single tree is left out where any part of it as drawn would
 * come too near a road's casing or a stream's bank (the guard), a hill line or
 * a hill number (woods.ts's own clearances), a town building, or where its
 * centre lies off the board (plantTreeSides); and, once the town names are
 * placed, where it would come too near the box round a name (keepOffLabels).
 * A name is placed in between, counting these trees as it counts a wood's: it
 * keeps off the trees where it can, and the trees keep off it where it lands.
 *
 * THE GREEN SIDES. Every set side is drawn from corner to corner as a stroke
 * printed over the trees, which take no notice of it: the field alone decides
 * where trees go. Where a road or a stream crosses a side (it does so at the
 * side's middle) the stroke stops short of the casing or the bank.
 *
 * Every number is a dial of the `treeSides` block of the art parameters: the
 * base setting of Spike S7 (tools/spikes/S7-tree-points), ported number for
 * number, hash for hash (the seeded tags below are the trial's, so the same
 * sides on the same board give the trial's trees).
 *
 * Deterministic: every choice is a hash of (seed, tag, lattice cell or clump
 * number). Sides are taken in side-key order and the lattice is the world's,
 * so the result does not depend on the order hexes are visited in or sides
 * are listed in, and a change to one side moves trees only near it.
 */
import { COL_STEP, Grid, HexId, R, centreAt, centreOf, neighbourOf, sideKey, sideMidpoint, sideOf, worldBounds } from '../engine/core/hex';
import type { TreeSide } from '../engine/core/map';
import { nearestHex } from './board';
import { MapContext } from './context';
import { CentreLines, RIVER, ROAD } from './curves';
import { SegmentIndex } from './geom';
import { HillLineSet } from './hills';
import { ArtParams } from './params';
import { hash32, signedUnit, unit } from './random';
import { Building } from './towns';
import { Box, Canopy, boxDistance, canopyShape, shapeReach, valueNoise } from './woods';

type Dials = ArtParams['treeSides'];

// ---------------------------------------------------------------------------
// Helpers: derived, never stored
// ---------------------------------------------------------------------------

/** A helper: a hex all six of whose sides are set, and the mean strength of the six. */
export interface TreeHelper {
  hex: HexId;
  mean: number;
}

/** The helpers of a set of tree sides, in hex order. */
export function treeHelpersOf(g: Grid, sides: readonly TreeSide[]): TreeHelper[] {
  const strengthOf = new Map<number, number>();
  for (const s of sides) strengthOf.set(s.key, s.strength);
  const seen = new Set<HexId>();
  const out: TreeHelper[] = [];
  for (const s of sides) {
    for (const h of [s.hex, neighbourOf(g, s.hex, s.dir)]) {
      if (h < 0 || seen.has(h)) continue;
      seen.add(h);
      let sum = 0;
      let set = 0;
      for (let d = 0; d < 6; d++) {
        const k = strengthOf.get(sideKey(g, h, d));
        if (k === undefined) continue;
        sum += k;
        set++;
      }
      if (set === 6) out.push({ hex: h, mean: sum / 6 });
    }
  }
  return out.sort((a, b) => a.hex - b.hex);
}

// ---------------------------------------------------------------------------
// The field
// ---------------------------------------------------------------------------

/** A source of the field: a set side's middle, or a helper's hex centre. */
export interface TreeSource {
  x: number;
  y: number;
  strength: number;
  radius: number;
  helper: boolean;
}

export interface TreeField {
  sources: TreeSource[];
  /** The rectangle that holds every source's whole disc. */
  box: [number, number, number, number];
  /** The field at a place: the sum over sources of strength * (1 - d^2 / r^2)^2 inside each radius. */
  at(x: number, y: number): number;
}

/** The field of a set of tree sides and their helpers. */
export function makeTreeField(g: Grid, sides: readonly TreeSide[], helpers: readonly TreeHelper[], D: Dials): TreeField {
  const sources: TreeSource[] = [];
  for (const s of [...sides].sort((a, b) => a.key - b.key)) {
    const m = sideMidpoint(g, s.hex, s.dir);
    sources.push({ x: m[0], y: m[1], strength: s.strength * D.sideStrength * D.strengthScale, radius: D.sideRadius * R, helper: false });
  }
  for (const hp of [...helpers].sort((a, b) => a.hex - b.hex)) {
    const c = centreOf(g, hp.hex);
    sources.push({ x: c[0], y: c[1], strength: hp.mean * D.helperStrength * D.strengthScale, radius: D.helperRadius * R, helper: true });
  }
  // Sources bucketed on a grid as wide as the widest radius.
  const cell = Math.max(0.05, ...sources.map(s => s.radius));
  const cells = new Map<number, number[]>();
  const cellKey = (i: number, j: number) => (i + 32768) * 65536 + (j + 32768);
  const box: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity];
  sources.forEach((s, id) => {
    const k = cellKey(Math.floor(s.x / cell), Math.floor(s.y / cell));
    const have = cells.get(k);
    if (have) have.push(id);
    else cells.set(k, [id]);
    box[0] = Math.min(box[0], s.x - s.radius);
    box[1] = Math.min(box[1], s.y - s.radius);
    box[2] = Math.max(box[2], s.x + s.radius);
    box[3] = Math.max(box[3], s.y + s.radius);
  });
  return {
    sources,
    box,
    at(x, y) {
      let v = 0;
      const i0 = Math.floor(x / cell);
      const j0 = Math.floor(y / cell);
      for (let i = i0 - 1; i <= i0 + 1; i++) {
        for (let j = j0 - 1; j <= j0 + 1; j++) {
          const ids = cells.get(cellKey(i, j));
          if (!ids) continue;
          for (const id of ids) {
            const s = sources[id] as TreeSource;
            const dx = x - s.x;
            const dy = y - s.y;
            const ratio = (dx * dx + dy * dy) / (s.radius * s.radius);
            if (ratio < 1) v += s.strength * (1 - ratio) * (1 - ratio);
          }
        }
      }
      return v;
    },
  };
}

// ---------------------------------------------------------------------------
// The clumps
// ---------------------------------------------------------------------------

/** One tree of a clump: where it stands from the clump's middle, and its size, turn and squash. */
export interface ClumpTree {
  dx: number;
  dy: number;
  size: number;
  rot: number;
  sx: number;
  sy: number;
}

/**
 * The set of clumps: one fixed set, whatever the board (a stamp sheet, seeded
 * by its own dial, not by a map). Each is `clumpTreesMin` to `clumpTreesMax`
 * of woods.ts's trees (its canopy size, size variation, turn and squash),
 * their centres inside an ellipse whose long half is `clumpRadiusMin` to
 * `clumpRadiusMax` tree radii; no two centres nearer than `clumpSpacing` times
 * the woods' own spacing, eased until the trees fit. The ellipse's middle is
 * not the clump's: the trees are taken in a seeded order from seeded places,
 * so each clump is lopsided in its own way.
 */
export function makeClumps(params: ArtParams): ClumpTree[][] {
  const P = params.woods;
  const D = params.treeSides;
  const seed = D.clumpSeed;
  const tree = P.canopySize / 2;
  const turn = (P.turn * Math.PI) / 180;
  const out: ClumpTree[][] = [];
  for (let k = 0; k < D.clumps; k++) {
    const want = D.clumpTreesMin + (hash32(seed, 'clump-count', k) % (D.clumpTreesMax - D.clumpTreesMin + 1));
    const long = tree * (D.clumpRadiusMin + (D.clumpRadiusMax - D.clumpRadiusMin) * unit(seed, 'clump-radius', k));
    const short = long * (D.clumpAspect + (1 - D.clumpAspect) * unit(seed, 'clump-aspect', k));
    let spacing = P.spacing * D.clumpSpacing * (1 + D.clumpSpacingVariation * unit(seed, 'clump-spacing', k));
    let pts: [number, number][] = [];
    for (let attempt = 0; attempt < D.clumpAttempts && pts.length < want; attempt++, spacing *= D.clumpSpacingEase) {
      pts = [];
      for (let c = 0; c < D.clumpTries && pts.length < want; c++) {
        const ang = 2 * Math.PI * unit(seed, 'clump-angle', k, c);
        const rad = Math.sqrt(unit(seed, 'clump-reach', k, c));
        const x = long * rad * Math.cos(ang);
        const y = short * rad * Math.sin(ang);
        if (pts.every(p => Math.hypot(p[0] - x, p[1] - y) >= spacing)) pts.push([x, y]);
      }
    }
    const mx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
    const my = pts.reduce((s, p) => s + p[1], 0) / pts.length;
    out.push(pts.map((p, t) => {
      const squash = P.squash * signedUnit(seed, 'clump-squash', k, t);
      return {
        dx: p[0] - mx,
        dy: p[1] - my,
        size: P.canopySize * (1 + P.sizeVariation * signedUnit(seed, 'clump-size', k, t)),
        rot: turn * signedUnit(seed, 'clump-turn', k, t),
        sx: 1 + squash,
        sy: 1 - squash,
      };
    }));
  }
  return out;
}

// ---------------------------------------------------------------------------
// The green sides
// ---------------------------------------------------------------------------

/**
 * The strokes of the green sides, each [ax, ay, bx, by]: one along every set
 * side from corner to corner, in side-key order. Where a road or a stream
 * crosses a side the stroke is two pieces that stop short of the casing or the
 * bank (or nothing, where a piece would be too short to draw).
 */
export function treeSideStrokes(ctx: MapContext, sides: readonly TreeSide[], lines: CentreLines): number[][] {
  const D = ctx.art.params.treeSides;
  const RD = ctx.art.params.roads;
  const V = ctx.art.params.rivers;
  const full = D.sideHalfWidth + D.sideEdge;
  const pieces: number[][] = [];
  for (const s of [...sides].sort((a, b) => a.key - b.key)) {
    const [a, b] = sideOf(ctx.g, s.hex, s.dir);
    const mid = sideMidpoint(ctx.g, s.hex, s.dir);
    const road = lines.index.nearestTagged(mid[0], mid[1], D.sideCrossReach, ROAD) !== Infinity;
    const river = lines.index.nearestTagged(mid[0], mid[1], D.sideCrossReach, RIVER) !== Infinity;
    if (!road && !river) {
      pieces.push([a[0], a[1], b[0], b[1]]);
      continue;
    }
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const ux = (b[0] - a[0]) / len;
    const uy = (b[1] - a[1]) / len;
    const gap = Math.max(road ? RD.casingHalfWidth : 0, river ? V.bankHalfWidth : 0) + D.sideCrossGap + full;
    if (len / 2 - gap > D.sideStubMin) {
      pieces.push([a[0], a[1], mid[0] - ux * gap, mid[1] - uy * gap]);
      pieces.push([mid[0] + ux * gap, mid[1] + uy * gap, b[0], b[1]]);
    }
  }
  return pieces;
}

// ---------------------------------------------------------------------------
// The draw pass
// ---------------------------------------------------------------------------

/** What the trees keep clear of, beside the map itself. */
export interface TreeSideInputs {
  lines: CentreLines;
  /** The hill lines as drawn, and the outer crests where they lie. */
  hill: HillLineSet;
  /** The boxes kept clear round spot heights, clearance included (as woods.ts takes them). */
  spotClear: readonly Box[];
  buildings: readonly Building[];
}

export interface TreeSideStats {
  /** Lattice points visited. */
  sampled: number;
  /** Lattice points where field * mask reached the threshold plus the noise. */
  passed: number;
  /** Clumps of which at least one tree was drawn. */
  clumps: number;
  trees: number;
  /** Single trees left out, by the clearance they would have broken (`label` is counted by keepOffLabels). */
  left: { road: number; river: number; hillLine: number; number: number; building: number; label: number; offBoard: number };
}

export interface TreeSidePlanting {
  /** The set sides, in side-key order. */
  sides: TreeSide[];
  helpers: TreeHelper[];
  field: TreeField;
  /** The road and stream mask the field is multiplied by: 0 along a corridor, 1 away from it. */
  mask(x: number, y: number): number;
  /** The trees of each clump, in the order the clumps are painted. */
  clumps: Canopy[][];
  /** The lattice point each of those clumps was stamped at. */
  stamps: [number, number][];
  /** The green sides: see treeSideStrokes. */
  strokes: number[][];
  stats: TreeSideStats;
}

const CREST = 0;
const RIDGE = 1;
const SEPARATOR = 2;

const smooth = (t: number): number => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const grow = (b: Box, by: number): Box => [b[0] - by, b[1] - by, b[2] + by, b[3] + by];

function insideConvex(x: number, y: number, ring: readonly number[]): boolean {
  let sign = 0;
  const n = ring.length;
  for (let k = 0; k < n; k += 2) {
    const ax = ring[k] as number;
    const ay = ring[k + 1] as number;
    const bx = ring[(k + 2) % n] as number;
    const by = ring[(k + 3) % n] as number;
    const c = (bx - ax) * (y - ay) - (by - ay) * (x - ax);
    if (c === 0) continue;
    if (sign === 0) sign = Math.sign(c);
    else if (Math.sign(c) !== sign) return false;
  }
  return true;
}

/** How far a tree reaches from its centre as drawn: its outline stamp, with its own size and squash. */
function reachOf(P: ArtParams['woods'], shape: readonly number[], t: { size: number; sx: number; sy: number }): number {
  return t.size * P.outlineScale * shapeReach(shape, t.sx, t.sy);
}

/**
 * The planting with every tree taken out that would come nearer the box round
 * a town name than `labelClearance`; a clump left with no tree goes with them.
 * `labels` are the boxes of the names as drawn, with no clearance added.
 */
export function keepOffLabels(ctx: MapContext, planting: TreeSidePlanting, labels: readonly Box[]): TreeSidePlanting {
  const D = ctx.art.params.treeSides;
  const P = ctx.art.params.woods;
  const shape = canopyShape();
  const boxes = labels.map(b => grow(b, D.labelClearance));
  if (boxes.length === 0) return planting;
  const clumps: Canopy[][] = [];
  const stamps: [number, number][] = [];
  let label = 0;
  let trees = 0;
  planting.clumps.forEach((clump, k) => {
    const kept = clump.filter(c => !boxes.some(b => boxDistance(c.x, c.y, b) < reachOf(P, shape, c)));
    label += clump.length - kept.length;
    if (kept.length === 0) return;
    clumps.push(kept);
    stamps.push(planting.stamps[k] as [number, number]);
    trees += kept.length;
  });
  return { ...planting, clumps, stamps, stats: { ...planting.stats, clumps: clumps.length, trees, left: { ...planting.stats.left, label } } };
}

/**
 * Plant the woods of a map's tree sides (engine/core/map treeSidesOf), clear of
 * everything but the town names, which are placed afterwards: see keepOffLabels.
 */
export function plantTreeSides(ctx: MapContext, treeSides: readonly TreeSide[], inputs: TreeSideInputs): TreeSidePlanting {
  const { g, cover, level, seed } = ctx;
  const { lines } = inputs;
  const D = ctx.art.params.treeSides;
  const P = ctx.art.params.woods;
  const H = ctx.art.params.hillLines;
  const RD = ctx.art.params.roads;
  const V = ctx.art.params.rivers;
  const bounds = worldBounds(g);
  const sides = [...treeSides].sort((a, b) => a.key - b.key);
  const helpers = treeHelpersOf(g, sides);
  const field = makeTreeField(g, sides, helpers, D);
  const clumps = makeClumps(ctx.art.params);
  const shape = canopyShape();

  // ---- the mask beside roads and streams: nothing along the corridor, a soft band beside it ----
  const masked: [number, number][] = [[ROAD, D.roadCorridor], [RIVER, D.riverCorridor]];
  const mask = (x: number, y: number): number => {
    let m = 1;
    for (const [tag, d0] of masked) {
      const d = lines.index.nearestTagged(x, y, d0 + D.maskSoft, tag);
      if (d === Infinity) continue;
      if (d <= d0) return 0;
      m *= smooth((d - d0) / D.maskSoft);
    }
    return m;
  };

  // ---- the hill lines, and how far a tree as drawn keeps from each kind: woods.ts's clearances ----
  const hillIndex = new SegmentIndex(0.25);
  for (const l of [...inputs.hill.crest, ...inputs.hill.crestOuter, ...inputs.hill.crestOuterSides]) hillIndex.addPolyline(l, CREST);
  for (const l of inputs.hill.ridge) hillIndex.addPolyline(l, RIDGE);
  for (const l of inputs.hill.separator) hillIndex.addPolyline(l, SEPARATOR);
  const crestClear = H.crestHalfWidth + P.hillLineClearance;
  const ridgeClear = H.ridgeHalfWidth + P.hillLineClearance;
  const separatorClear = H.separatorHalfWidth + P.hillLineClearance;
  const topClear = Math.max(crestClear, P.hilltopInset);
  const numberedInset = Math.max(crestClear, P.numberedHilltopInset);
  const largest = P.canopySize * (1 + P.sizeVariation) * P.outlineScale * shapeReach(shape, 1 + P.squash, 1 + P.squash);
  const hillReach = largest + Math.max(topClear, ridgeClear, separatorClear);
  // A one-hex wooded hilltop that carries a hill number: woods.ts's own rule for it.
  const numbered = new Set<HexId>();
  for (const s of ctx.spots) {
    if (cover[s.hex] !== 'woods' || level[s.hex] !== 2) continue;
    let single = true;
    for (let d = 0; d < 6; d++) {
      const nb = neighbourOf(g, s.hex, d);
      if (nb >= 0 && level[nb] === 2) single = false;
    }
    if (single) numbered.add(s.hex);
  }

  // ---- buildings ----
  const buildingEdges = new SegmentIndex(0.25);
  for (const bd of inputs.buildings) {
    const r = bd.ring;
    for (let k = 0; k < r.length; k += 2) buildingEdges.add(r[k] as number, r[k + 1] as number, r[(k + 2) % r.length] as number, r[(k + 3) % r.length] as number);
  }

  // ---- the clearances, for one tree at a time ----
  const stats: TreeSideStats = { sampled: 0, passed: 0, clumps: 0, trees: 0, left: { road: 0, river: 0, hillLine: 0, number: 0, building: 0, label: 0, offBoard: 0 } };
  const roadClear = RD.casingHalfWidth + D.roadGap;
  const riverClear = V.bankHalfWidth + D.riverGap;
  /** Whether this tree may stand: the board hex nearest it, or -1. Counts why not. */
  const allowed = (x: number, y: number, t: ClumpTree): HexId => {
    if (x < bounds[0] || x > bounds[2] || y < bounds[1] || y > bounds[3]) {
      stats.left.offBoard++;
      return -1;
    }
    const reachOut = reachOf(P, shape, t);
    if (lines.index.nearestTagged(x, y, reachOut + roadClear, ROAD) !== Infinity) {
      stats.left.road++;
      return -1;
    }
    if (lines.index.nearestTagged(x, y, reachOut + riverClear, RIVER) !== Infinity) {
      stats.left.river++;
      return -1;
    }
    const h = nearestHex(g, x, y);
    if (hillIndex.size > 0 && hillIndex.nearest(x, y, hillReach) !== Infinity) {
      const near = (tag: number, clear: number) => hillIndex.nearestTagged(x, y, hillReach, tag) - reachOut < clear;
      const crest = level[h] === 2 ? (numbered.has(h) ? numberedInset : topClear) : crestClear;
      if (near(CREST, crest) || near(RIDGE, ridgeClear) || near(SEPARATOR, separatorClear)) {
        stats.left.hillLine++;
        return -1;
      }
    }
    for (const b of inputs.spotClear) {
      if (boxDistance(x, y, b) < reachOut) {
        stats.left.number++;
        return -1;
      }
    }
    if (buildingEdges.size > 0) {
      if (buildingEdges.nearest(x, y, reachOut + D.buildingClearance) !== Infinity || inputs.buildings.some(bd => Math.hypot(bd.cx - x, bd.cy - y) < bd.halfLen + bd.halfDepth && insideConvex(x, y, bd.ring))) {
        stats.left.building++;
        return -1;
      }
    }
    return h;
  };

  // ---- the lattice: the centres of a small hexagon tiling over a rectangle larger than the field, each moved inside a disc ----
  // The tiling is engine/core/hex's own, turned a quarter and scaled to the pitch: row j runs across the
  // sheet at j row steps, and its points stand a pitch apart, every other row half a pitch along.
  const pitch = D.latticePitch;
  const rowStep = pitch * COL_STEP;
  const noisePitch = D.noiseScale * pitch;
  interface Sample { i: number; j: number; x: number; y: number }
  const passed: Sample[] = [];
  if (field.sources.length > 0) {
    const reach = Math.max(...clumps.flatMap(c => c.map(t => Math.hypot(t.dx, t.dy)))) + pitch;
    const rect = [field.box[0] - reach, field.box[1] - reach, field.box[2] + reach, field.box[3] + reach] as const;
    for (let j = Math.floor(rect[1] / rowStep); j <= Math.ceil(rect[3] / rowStep); j++) {
      for (let i = Math.floor(rect[0] / pitch) - 1; i <= Math.ceil(rect[2] / pitch); i++) {
        const ang = 2 * Math.PI * unit(seed, 'tp-jitter-angle', i, j);
        const rad = D.jitter * pitch * Math.sqrt(unit(seed, 'tp-jitter-reach', i, j));
        const x = centreAt(j, i)[1] * pitch + rad * Math.cos(ang);
        const y = j * rowStep + rad * Math.sin(ang);
        stats.sampled++;
        const f = field.at(x, y);
        if (f <= 0) continue;
        const fm = f * mask(x, y);
        if (fm <= 0) continue;
        const noise = D.threshold * (D.noiseLow + (D.noiseHigh - D.noiseLow) * valueNoise(seed, 'tp-noise', x, y, noisePitch) ** D.noisePower);
        if (fm >= D.threshold + noise) passed.push({ i, j, x, y });
      }
    }
  }
  stats.passed = passed.length;
  // Painted down the sheet, so a clump lower on the sheet lies over the one above it.
  passed.sort((a, b) => a.y - b.y || a.x - b.x || a.j - b.j || a.i - b.i);

  // ---- the stamps: one clump at each point, whole ----
  const planted: Canopy[][] = [];
  const stamps: [number, number][] = [];
  for (const s of passed) {
    const clump = clumps[hash32(seed, 'tp-clump-pick', s.i, s.j) % clumps.length] as ClumpTree[];
    const turn = 2 * Math.PI * unit(seed, 'tp-clump-turn', s.i, s.j);
    const cos = Math.cos(turn);
    const sin = Math.sin(turn);
    const mine: Canopy[] = [];
    for (const t of clump) {
      const x = s.x + cos * t.dx - sin * t.dy;
      const y = s.y + sin * t.dx + cos * t.dy;
      const hex = allowed(x, y, t);
      if (hex < 0) continue;
      mine.push({ hex, x, y, size: t.size, rot: t.rot, sx: t.sx, sy: t.sy });
    }
    if (mine.length === 0) continue;
    // Within a clump a tree lower on the sheet lies over the one above it, as in woods.ts.
    mine.sort((a, b) => a.y - b.y || a.x - b.x);
    planted.push(mine);
    stamps.push([s.x, s.y]);
    stats.clumps++;
    stats.trees += mine.length;
  }

  return { sides, helpers, field, mask, clumps: planted, stamps, strokes: treeSideStrokes(ctx, sides, lines), stats };
}
