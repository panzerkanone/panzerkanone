/**
 * buildMapArt: a map description and the art data in, a display list out.
 *
 * Pure and deterministic: the same inputs give the same list, byte for byte,
 * whatever order hexes are visited in and whatever order the map file lists
 * its roads, rivers, ridges, towns, spot heights, exits and bridges in.
 *
 * Paint order (list order; within a plate a later tone replaces an earlier one,
 * and plates multiply onto white stock in the ink table's order):
 *   ground; field and swamp tints; slope wash, cut back over hilltops and over
 *   standing water; rough, furrows, swamp marks; the shore of standing water;
 *   rivers (banks, then water); standing water (its tint, then what its
 *   treatment adds: a river that reaches it ends under it); canopies (outlines,
 *   bodies, highlights); on a map with tree sides, the clumps planted from
 *   them (each clump whole: its outlines, bodies, highlights) and then the
 *   green sides (the canopy ink cut away under each stroke, then the stroke
 *   on its own plate); buildings (roofs by colour, roof lines, outlines);
 *   separator, ridge and crest lines, then
 *   the crest lines of hilltop sides on the board edge; roads
 *   (every casing, then every fill, then the knock-outs that make a road bare
 *   stock); bridges; spot heights; town names.
 */
import { DisplayList, DisplayOp, FillOp, GlyphsOp, Paper, PatternOp, Plate, RibbonOp, StampOp } from './displayList';
import { HexId, centreOf, worldBounds } from '../engine/core/hex';
import { MapDescription, seasonOf, treeSidesOf, waterBodiesOf } from '../engine/core/map';
import { nearestHex } from './board';
import { MapContext, makeContext } from './context';
import { CentreLines, Stroke, buildCentreLines } from './curves';
import { Vec, boundsOf, rectCorners } from './geom';
import { FieldHex, buildFields, buildRough, buildSwamps, dashShape, dotShape, reedShape, stoneShape } from './ground';
import { buildHillLines, buildWash } from './hills';
import { TextRun, layoutText } from './lettering';
import { ArtData, PillowShade, seasonArt } from './params';
import { Building, TownPlan, buildTowns } from './towns';
import { TreeSidePlanting, keepOffLabels, plantTreeSides } from './treeSides';
import { buildWater } from './water';
import {
  LUNES, Mound, Piece, capPlacements, capShape, hilltopClouds, hilltopFlecks, hilltopStreaks, iceCracks, litSides, lumpPlacements, luneIndex, luneShape,
  moundShadowRing, pieceRing, pieceShapeKey, pieceShapes, placeDrifts, placeMounds, placedRing, plainClouds, riverFloes, riverSnowDashes, roofPlacement, roofShadePlacement,
  roofSnowHalfShape, roofSnowShape, roofSquareShape, slopeClouds, slopeFrost, underTrees,
} from './winter';
import { Box, Canopy, canopyShape, plantWoods } from './woods';

export interface BuildOptions {
  /** Visit hexes in this order (a permutation of every hex number). The list must not change. */
  hexOrder?: readonly HexId[];
  /**
   * Whether the green sides of a map's tree sides are drawn (default: drawn). With `false` the list
   * holds the trees and no stroke, no knock-out under one and no plate for them: for a table that
   * draws the lines that bar sight itself, above its grid.
   */
  treeSideLines?: boolean;
  /**
   * Whether the hill lines are drawn (default: drawn): the crests of hilltops and ridges and the
   * separators. With `false` the list holds none of them and is otherwise the same: for a table that
   * draws the lines that bar sight itself, above its grid (`sightLinesOf` gives it them as data).
   */
  hillLines?: boolean;
}

/** Everything the generator worked out on the way, for checks and reports. */
export interface BuildResult {
  list: DisplayList;
  ctx: MapContext;
  lines: CentreLines;
  canopies: Canopy[];
  buildings: Building[];
  /** The trees Milestone 3b adds to the 3a planting (part-hexes, numbered hilltops), and how many it took out. */
  addedCanopies: Canopy[];
  removedCanopies: { besideOuterCrest: number; strays: number };
  fields: FieldHex[];
  towns: TownPlan[];
  /** The boxes kept clear round spot heights. */
  spotClear: Box[];
  /** The woods planted from the map's tree sides (treeSides.ts); null for a map that has none. */
  treeSides: TreeSidePlanting | null;
  /** A winter board's chunks of ice on its rivers (winter.ts); none on a summer board. */
  floes: Piece[];
  /** A winter board's pieces of banked snow on open ground, when the winter set has any (winter.ts); none on a summer board. */
  drifts: Piece[];
  /** The second round's freestanding mounds of snow, when the winter set switches them on (winter.ts); none otherwise. */
  mounds: Mound[];
}

/** A thing snow lies on in the pillow manner: the stamp it is cleared with (a shape's name, its outline, a placement of five numbers) and its outline on the board. */
interface Lying {
  key: string;
  unit: readonly number[];
  placement: readonly number[];
  ring: number[];
}

const SQRT_HALF = Math.SQRT1_2;

function ribbon(feature: string, plate: string, mode: 'draw' | 'erase', tone: number, line: readonly number[], halfWidth: number): RibbonOp {
  return { op: 'ribbon', feature, plate, mode, tone, line: line.slice(), halfWidths: new Array<number>(line.length / 2).fill(halfWidth) };
}

/**
 * Half-widths of a stream that rises at a spring: from a fifth of its width at the spring, along a
 * smooth ramp, to its whole width `taper` h along the line from there.
 */
function springWidths(line: readonly number[], widths: readonly number[], at: 'start' | 'end', taper: number): number[] {
  const m = line.length / 2;
  const along = new Array<number>(m).fill(0);
  for (let k = 1; k < m; k++) {
    along[k] = (along[k - 1] as number) + Math.hypot((line[2 * k] as number) - (line[2 * k - 2] as number), (line[2 * k + 1] as number) - (line[2 * k - 1] as number));
  }
  const total = along[m - 1] as number;
  return widths.map((hw, k) => {
    const s = at === 'start' ? (along[k] as number) : total - (along[k] as number);
    const t = Math.min(1, s / taper);
    return hw * (0.2 + 0.8 * t * t * (3 - 2 * t));
  });
}

function fill(feature: string, plate: string, mode: 'draw' | 'erase', tone: number, rings: readonly (readonly number[])[], feather?: number): FillOp {
  const op: FillOp = { op: 'fill', feature, plate, mode, tone, rings: rings.map(r => r.slice()) };
  if (feather !== undefined) op.feather = feather;
  return op;
}

function stamp(feature: string, plate: string, tone: number, shape: string, placements: readonly number[]): StampOp {
  return { op: 'stamp', feature, plate, mode: 'draw', tone, shape, placements: placements.slice() };
}

function boxesOverlap(a: Box, b: Box): boolean {
  return a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
}

export function buildMapArtFull(map: MapDescription, artIn: ArtData, options: BuildOptions = {}): BuildResult {
  // The board is printed for its season: a winter board from the winter set (refused when it was not loaded).
  const seasonal = seasonArt(artIn, seasonOf(map));
  const art: ArtData = { ...artIn, params: seasonal.params, inks: seasonal.inks };
  /** What winter draws besides; null on a summer board, which draws exactly what it always did. */
  const WD = seasonal.winter;
  const ctx = makeContext(map, art, options.hexOrder);
  const { g, params } = { g: ctx.g, params: art.params };
  const PL = params.plates;
  const shapes: Record<string, number[][]> = {};
  const useShape = (key: string, rings: readonly (readonly number[])[]) => {
    if (!(key in shapes)) shapes[key] = rings.map(r => r.slice());
  };
  const ops: DisplayOp[] = [];
  const bounds = worldBounds(g);

  // ---- centre lines first: everything else keeps clear of them ----
  const lines = buildCentreLines(ctx);

  // ---- spot heights: laid out early, so woods can keep clear of them ----
  const S = params.spotHeight;
  const spotMarks: { triangle: number[]; run: TextRun; text: string; box: Box }[] = [];
  for (const s of ctx.spots) {
    const c = centreOf(g, s.hex);
    const text = String(s.height);
    const run0 = layoutText(art.glyphs, text, S.numberSize, S.numberSize * 0.06, 0, 0, () => undefined);
    const numW = run0.box[2] - run0.box[0];
    const capH = -run0.box[1];
    const total = S.triangleWidth + S.gap + numW;
    const boxH = Math.max(S.triangleHeight, capH);
    const left = c[0] - total / 2;
    const baseline = c[1] + boxH / 2;
    const triangle = [left, baseline, left + S.triangleWidth, baseline, left + S.triangleWidth / 2, baseline - S.triangleHeight];
    const run = layoutText(art.glyphs, text, S.numberSize, S.numberSize * 0.06, left + S.triangleWidth + S.gap - run0.box[0], baseline, useShape);
    spotMarks.push({ triangle, run, text, box: [left, baseline - boxH, left + total, baseline] });
  }
  const spotClear: Box[] = spotMarks.map(m => [m.box[0] - S.clearance, m.box[1] - S.clearance, m.box[2] + S.clearance, m.box[3] + S.clearance]);

  // ---- the elements ----
  const wash = buildWash(ctx);
  const hillLines = buildHillLines(ctx);
  const spotBoxes = new Map<HexId, Box>();
  ctx.spots.forEach((s, i) => spotBoxes.set(s.hex, (spotMarks[i] as { box: Box }).box));
  // The 3a planting is made against the outer crests where they lie; what 3b adds, against the lines as drawn.
  const planting = plantWoods(ctx, lines, spotClear, { ...hillLines, crestOuter: hillLines.crestOuterSides }, { hill: hillLines, spotBoxes, woodedClearance: S.woodedClearance });
  const canopies = planting.canopies;
  const towns = buildTowns(ctx, lines);
  const buildings = towns.flatMap(t => t.buildings);
  const fields = buildFields(ctx, lines);
  const swamps = buildSwamps(ctx, lines);
  const rough = buildRough(ctx, lines);
  const water = buildWater(ctx);

  // ---- woods from tree sides (a map with a `trees` layer): planted clear of all the above ----
  const sides = treeSidesOf(map);
  const sidePlanting = sides.length > 0 ? plantTreeSides(ctx, sides, { lines, hill: hillLines, spotClear, buildings }) : null;

  // ---- town names: the least crowded of a few places round the town ----
  // Placed here, before any op is listed: a name counts the trees of tree sides as it counts a wood's
  // canopies, and those trees then keep off the name where it lands. The names' ops go at the end of
  // the list, where they always went.
  const nameOps: GlyphsOp[] = [];
  const nameBoxes: Box[] = [];
  const L = params.lettering;
  const placedBoxes: Box[] = spotMarks.map(m => m.box);
  const roadPts = lines.roads.flatMap(r => {
    const out: Vec[] = [];
    for (let i = 0; i < r.line.length; i += 2) out.push([r.line[i] as number, r.line[i + 1] as number]);
    return out;
  });
  const riverPts = lines.rivers.flatMap(r => {
    const out: Vec[] = [];
    for (let i = 0; i < r.line.length; i += 2) out.push([r.line[i] as number, r.line[i + 1] as number]);
    return out;
  });
  // Every hill line, separators and the hilltop sides on the board edge too: a name keeps off them.
  const hillPts = [...hillLines.crest, ...hillLines.crestOuter, ...hillLines.ridge, ...hillLines.separator].flatMap(l => {
    const out: Vec[] = [];
    for (let i = 0; i + 3 < l.length; i += 2) {
      for (let k = 0; k < 4; k++) {
        out.push([(l[i] as number) + ((l[i + 2] as number) - (l[i] as number)) * (k / 4), (l[i + 1] as number) + ((l[i + 3] as number) - (l[i + 1] as number)) * (k / 4)]);
      }
    }
    return out;
  });
  const CANDIDATES: [number, number][] = [
    [0, L.townOffset], [0, -L.townOffset], [0, L.townOffset + 0.25], [0, -L.townOffset - 0.25],
    [0.62, 0.45], [-0.62, 0.45], [0.62, -0.45], [-0.62, -0.45], [0, 0],
    // Further out, for a town whose own hexes are full of buildings.
    [0, L.townOffset + 0.5], [0, -L.townOffset - 0.5], [1.0, 0.5], [-1.0, 0.5], [1.0, -0.5], [-1.0, -0.5],
  ];
  for (const town of ctx.towns) {
    const run0 = layoutText(art.glyphs, town.name, L.townSize, L.tracking, 0, 0, () => undefined);
    const w = run0.box[2] - run0.box[0];
    const hgt = run0.box[3] - run0.box[1];
    let best: { score: number; cx: number; cy: number } | null = null;
    let rank = 0;
    for (const h of town.hexes) {
      const c = centreOf(g, h);
      for (const [dx, dy] of CANDIDATES) {
        rank++;
        const cx = c[0] + dx;
        const cy = c[1] + dy;
        const box: Box = [cx - w / 2, cy - hgt / 2, cx + w / 2, cy + hgt / 2];
        if (box[0] < bounds[0] + L.margin || box[1] < bounds[1] + L.margin || box[2] > bounds[2] - L.margin || box[3] > bounds[3] - L.margin) continue;
        const grown: Box = [box[0] - 0.04, box[1] - 0.04, box[2] + 0.04, box[3] + 0.04];
        const inBox = (p: readonly number[]) => (p[0] as number) >= grown[0] && (p[0] as number) <= grown[2] && (p[1] as number) >= grown[1] && (p[1] as number) <= grown[3];
        let score = rank * 0.3;
        for (const p of roadPts) if (inBox(p)) score += 3;
        for (const p of riverPts) if (inBox(p)) score += 3;
        for (const p of hillPts) if (inBox(p)) score += 3;
        for (const bd of buildings) {
          let hit = inBox([bd.cx, bd.cy]);
          for (let k = 0; k < 8 && !hit; k += 2) hit = inBox([bd.ring[k] as number, bd.ring[k + 1] as number]);
          if (hit) score += 4;
        }
        for (const cn of canopies) if (inBox([cn.x, cn.y])) score += 0.4;
        for (const cn of planting.added) if (inBox([cn.x, cn.y])) score += 0.4;
        if (sidePlanting) for (const clump of sidePlanting.clumps) for (const cn of clump) if (inBox([cn.x, cn.y])) score += 0.4;
        for (const pb of placedBoxes) if (boxesOverlap(grown, pb)) score += 60;
        if (!best || score < best.score) best = { score, cx, cy };
      }
    }
    if (!best) {
      const c = centreOf(g, town.hexes[0] as HexId);
      best = { score: 0, cx: c[0], cy: c[1] };
    }
    const run = layoutText(art.glyphs, town.name, L.townSize, L.tracking, best.cx - w / 2 - run0.box[0], best.cy - hgt / 2 - run0.box[1], useShape);
    placedBoxes.push(run.box);
    nameBoxes.push(run.box);
    const op: GlyphsOp = { op: 'glyphs', feature: 'town-name', text: town.name, plate: PL.townName, mode: 'draw', tone: 1, shapes: run.shapes.slice(), transforms: run.transforms.slice() };
    nameOps.push(op);
  }

  // ---- the trees of tree sides keep off the names as placed ----
  const treeSides = sidePlanting ? keepOffLabels(ctx, sidePlanting, nameBoxes) : null;
  const drawSides = options.treeSideLines !== false && treeSides !== null && treeSides.strokes.length > 0;

  // ---- ground ----
  const b = params.ground.bleed;
  ops.push(fill('ground', PL.ground, 'draw', 1, [[bounds[0] - b, bounds[1] - b, bounds[2] + b, bounds[1] - b, bounds[2] + b, bounds[3] + b, bounds[0] - b, bounds[3] + b]]));

  // ---- tints ----
  for (const f of fields) if (f.plots.length > 0) ops.push(fill('field-tint', PL.fieldTint, 'draw', params.fields.tintTone, f.plots));
  for (const s of swamps) ops.push(fill('swamp-tint', PL.swampTint, 'draw', params.swamp.tintTone, [s.ring]));

  // ---- slope wash: one soft fill per hill group, then the cut-backs over the hilltops ----
  for (const w of wash) if (w.rings.length > 0) ops.push(fill('wash', PL.wash, 'draw', params.wash.tone, w.rings, params.wash.feather));
  for (const w of wash) if (w.tops.length > 0) ops.push(fill('wash', PL.wash, 'erase', 1, w.tops, params.wash.eraseFeather > 0 ? params.wash.eraseFeather : undefined));
  // ---- winter: the set of shapes its pieces of ice and of lying snow are stamped from, and the stamping ----
  /** The set's shapes (winter.ts); a board lists those it stamps. */
  const PIECES = WD ? pieceShapes() : [];
  /** Pieces grouped by the hex each lies in, the groups in hex order. */
  const piecesByHex = (pieces: readonly Piece[]): Piece[][] => {
    const groups = new Map<HexId, Piece[]>();
    for (const p of pieces) {
      const h = nearestHex(g, p.x, p.y);
      const list = groups.get(h);
      if (list) list.push(p);
      else groups.set(h, [p]);
    }
    return [...groups.keys()].sort((x, y) => x - y).map(h => groups.get(h) as Piece[]);
  };
  /** Flat pieces, each clearing `tone` of `plate` under it: one op for the pieces of one shape in one hex. */
  const erasePieces = (feature: string, pieces: readonly Piece[], plate: string, tone: number) => {
    for (const group of piecesByHex(pieces)) {
      for (let s = 0; s < PIECES.length; s++) {
        const mine = group.filter(p => p.shape === s);
        if (mine.length === 0) continue;
        useShape(pieceShapeKey(s), [PIECES[s] as number[]]);
        ops.push({ ...stamp(feature, plate, tone, pieceShapeKey(s), mine.flatMap(p => [p.x, p.y, p.rot, p.sx, p.sy])), mode: 'erase' });
      }
    }
  };
  if (WD) {
    // Winter: the speckled, icy snow of the hills, every piece of it flat and seeded.
    const FR = WD.frost;
    const frostGround = { hill: hillLines, trees: [...canopies, ...planting.added, ...(treeSides ? treeSides.clumps.flat() : [])], outlineScale: params.woods.outlineScale };
    const strength = (lo: number, hi: number, u: number): number => lo + (hi - lo) * u;
    // On the slopes: snow showing through the haze in soft clouds, then flecks of frost, white on it, thickest
    // by the crest and thinning outward.
    const SC = FR.slopes.clouds;
    for (const c of slopeClouds(ctx, SC, frostGround, PIECES)) ops.push(fill('slope-snow', PL.wash, 'erase', strength(SC.liftMin, SC.liftMax, c.u), [c.ring], SC.feather));
    const SF = FR.slopes.flecks;
    const onSlopes = slopeFrost(ctx, SF, frostGround);
    erasePieces('slope-frost', onSlopes, PL.wash, SF.lift);
    if (SF.whiten > 0) erasePieces('slope-frost', onSlopes, PL.ground, SF.whiten);
    // On the hilltops, inside their crests: a faint tint of the shade, mottled with soft darker clouds of it and
    // soft whiter ones (each with a soft edge, and all of it then cut back to the hilltops, as the haze is cut
    // back over them); fine streaks along the wind; flecks.
    const HT = FR.hilltops;
    const tops = wash.flatMap(w => w.tops);
    if (tops.length > 0) {
      if (HT.tint > 0) for (const w of wash) if (w.tops.length > 0) ops.push(fill('hilltop-ice', WD.shadePlate, 'draw', HT.tint, w.tops));
      for (const p of hilltopClouds(ctx, 'hilltop-patch', HT.patches, tops, PIECES)) {
        ops.push(fill('hilltop-ice', WD.shadePlate, 'draw', strength(HT.patches.toneMin, HT.patches.toneMax, p.u), [p.ring], HT.patches.feather));
      }
      for (const c of hilltopClouds(ctx, 'hilltop-cloud', HT.clouds, tops, PIECES)) {
        ops.push(fill('hilltop-snow', WD.shadePlate, 'erase', strength(HT.clouds.liftMin, HT.clouds.liftMax, c.u), [c.ring], HT.clouds.feather));
      }
      ops.push(fill('hilltop-ice-cut', WD.shadePlate, 'erase', 1, [[bounds[0] - b, bounds[1] - b, bounds[2] + b, bounds[1] - b, bounds[2] + b, bounds[3] + b, bounds[0] - b, bounds[3] + b], ...tops]));
      const ST = HT.streaks;
      for (const w of wash) {
        const strokes = hilltopStreaks(ctx, ST, WD.wind, w.tops);
        if (strokes.length === 0) continue;
        for (const [plate, tone] of [[WD.shadePlate, ST.lift], [PL.ground, ST.whiten]] as const) {
          if (tone <= 0) continue;
          const op: PatternOp = { op: 'pattern', feature: 'hilltop-streak', plate, mode: 'erase', tone, clip: w.tops, strokes, width: ST.width };
          ops.push(op);
        }
      }
      const onTops = hilltopFlecks(ctx, HT.flecks, frostGround);
      erasePieces('hilltop-frost', onTops, WD.shadePlate, 1);
      if (HT.flecks.whiten > 0) erasePieces('hilltop-frost', onTops, PL.ground, HT.flecks.whiten);
    }
    // A trial, switched off in the winter set: faint soft clouds of the shade on the open snow of the plain (after
    // the hilltops' cut-back, which clears the shade everywhere else).
    for (const c of plainClouds(ctx, FR.plain, PIECES)) ops.push(fill('plain-cloud', WD.shadePlate, 'draw', strength(FR.plain.toneMin, FR.plain.toneMax, c.u), [c.ring], FR.plain.feather));
  }
  // No slope wash lies on standing water: a hill's wash fades out over about a hex, and water may lie that near.
  if (water && wash.some(w => w.rings.length > 0)) ops.push(fill('water-knockout', PL.wash, 'erase', 1, water.shore));

  // ---- ground marks ----
  for (const r of rough) {
    if (r.dots.length > 0) ops.push(stamp('rough-mark', PL.rough, params.rough.tone, 'dot', r.dots.flatMap(p => [p.x, p.y, p.rot, p.sx, p.sy])));
    if (r.stones.length > 0) ops.push(stamp('rough-mark', PL.rough, params.rough.tone, 'stone', r.stones.flatMap(p => [p.x, p.y, p.rot, p.sx, p.sy])));
  }
  if (rough.length > 0) {
    useShape('dot', dotShape());
    useShape('stone', stoneShape());
  }
  for (const f of fields) {
    if (f.furrows.length === 0) continue;
    const strokes = f.furrows.map(s => s.slice());
    const op: PatternOp = {
      op: 'pattern', feature: 'furrow', plate: PL.furrow, mode: 'draw', tone: params.fields.furrowTone,
      clip: f.plots.map(p => p.slice()), strokes, width: params.fields.strokeWidth,
    };
    ops.push(op);
  }
  for (const s of swamps) {
    if (s.dashes.length > 0) ops.push(stamp('swamp-mark', PL.swampWater, params.swamp.dashTone, 'swamp-dash', s.dashes.flatMap(p => [p.x, p.y, p.rot, p.sx, p.sy])));
    if (s.reeds.length > 0) ops.push(stamp('swamp-mark', PL.swampReed, params.swamp.reedTone, 'swamp-reed', s.reeds.flatMap(p => [p.x, p.y, p.rot, p.sx, p.sy])));
  }
  if (swamps.length > 0) {
    useShape('swamp-dash', dashShape());
    useShape('swamp-reed', reedShape());
  }

  // ---- rivers: every bank, then every water ----
  // The shore of standing water goes down first, so that a river's water opens its own mouth in it.
  const WT = params.water;
  const closed = (ring: readonly number[]): number[] => [...ring, ring[0] as number, ring[1] as number];
  if (water) for (const ring of water.shore) ops.push(ribbon('water-shore', PL.river, 'draw', WT.shoreTone, closed(ring), WT.shoreHalfWidth));
  const V = params.rivers;
  // Every bank before any water: where a tributary meets its river the river's water opens the
  // stream's mouth and the stream's water opens the river's bank, so no bank line crosses water.
  // A stream that rises at a spring widens from nothing there (and so does its ice, in winter).
  const riverRibbon = (feature: string, tone: number, r: Stroke, halfWidth: number, plate: string = PL.river, mode: 'draw' | 'erase' = 'draw'): RibbonOp => {
    const op = ribbon(feature, plate, mode, tone, r.line, r.width === undefined ? halfWidth : halfWidth * r.width);
    if (r.spring !== undefined) op.halfWidths = springWidths(r.line, op.halfWidths, r.spring, V.springTaper);
    return op;
  };
  for (const r of lines.rivers) ops.push(riverRibbon('river-bank', V.bankTone, r, V.bankHalfWidth));
  for (const r of lines.rivers) ops.push(riverRibbon('river-water', V.waterTone, r, V.waterHalfWidth));
  const floes: Piece[] = [];
  if (WD) {
    // Winter: each river's water frozen over, the ice laid where the water was, with chunks of ice on it: flat
    // pieces a little lighter than the ice round them, every corner of each on the river's own water.
    const I = WD.ice;
    for (const r of lines.rivers) ops.push(riverRibbon('river-ice-knockout', 1, r, V.waterHalfWidth, PL.river, 'erase'));
    const ice = lines.rivers.map(r => riverRibbon('river-ice', I.riverTone, r, V.waterHalfWidth, WD.shadePlate, 'draw'));
    for (const op of ice) ops.push(op);
    if (I.river === 'floes') {
      lines.rivers.forEach((r, k) => floes.push(...riverFloes(ctx.seed, r.line, (ice[k] as RibbonOp).halfWidths, I.floes, PIECES.length)));
      erasePieces('river-floe', floes, WD.shadePlate, I.floes.lift);
    } else {
      // Kept from the second round, switched off in the winter set: snow lying on the ice in dashes.
      for (const r of lines.rivers) ops.push({ ...riverRibbon('river-snow', 1, r, V.waterHalfWidth, WD.shadePlate, 'erase'), dash: riverSnowDashes(ctx.seed, r.line, I.dashes) });
    }
  }

  // ---- standing water: the tint, then what the treatment adds ----
  if (water) {
    const tone = WT.treatment === 'flat' ? WT.flat.tone : WT.treatment === 'lines' ? WT.lines.tone : WT.depth.shallowTone;
    ops.push(fill('water', PL.river, 'draw', tone, water.shore));
    if (WT.treatment === 'lines') {
      WT.lines.offsets.forEach((d, k) => {
        for (const ring of water.offshore(d)) {
          ops.push(ribbon('water-line', PL.river, 'draw', WT.lines.tones[k] as number, closed(ring), WT.lines.halfWidths[k] as number));
        }
      });
    } else if (WT.treatment === 'depth' || WT.treatment === 'deep') {
      // In bands, each a flat tone over the last: the pale band along the shore is the tint itself, then
      // the water beyond it, then (treatment `deep`) open water away from land, where there is any.
      const offshore = water.offshore(WT.depth.offshoreFrom);
      if (offshore.length > 0) ops.push(fill('water-offshore', PL.river, 'draw', WT.depth.offshoreTone, offshore));
      if (WT.treatment === 'deep') {
        const deep = water.deep();
        if (deep.length > 0) ops.push(fill('water-deep', PL.river, 'draw', WT.deep.tone, deep));
      }
    }
  }
  if (water && WD) {
    // Winter: ice over the summer water. Inside the shore's keyline the water is cleared: a rim of snow, whiter
    // than the plain, then the ice with a line along its edge and fine cracks cleared out of it. A sea keeps its
    // open water (the summer art's deep water) as summer draws it, the ice ending at it.
    const I = WD.ice;
    const seaHex = new Set(waterBodiesOf(map).filter(body => body.sea).flatMap(body => body.hexes as number[]));
    const open = water.deep().filter(ring => seaHex.has(nearestHex(g, ring[0] as number, ring[1] as number)));
    const inner = water.offshore(WT.shoreHalfWidth);
    const ice = water.offshore(I.rim);
    if (inner.length > 0) ops.push(fill('ice-knockout', PL.river, 'erase', 1, [...inner, ...open]));
    if (inner.length > 0 && I.rimLift > 0) ops.push(fill('ice-rim', PL.ground, 'erase', I.rimLift, [...inner, ...ice]));
    if (ice.length > 0) {
      ops.push(fill('ice', WD.shadePlate, 'draw', I.tone, [...ice, ...open]));
      const cracks = iceCracks(ctx, I, h => centreOf(g, h) as [number, number]);
      const clip = water.offshore(I.rim + I.crackClear);
      if (cracks.length > 0 && clip.length > 0) {
        const crackOp: PatternOp = { op: 'pattern', feature: 'ice-crack', plate: WD.shadePlate, mode: 'erase', tone: I.crackTone, clip: [...clip, ...open], strokes: cracks, width: I.crackWidth };
        ops.push(crackOp);
      }
      for (const ring of [...ice, ...open]) ops.push(ribbon('ice-edge', WD.shadePlate, 'draw', I.edgeTone, closed(ring), I.edgeHalfWidth));
    }
  }

  // ---- winter: how snow is drawn where it lies on a thing ----
  // The one light of the board: degrees clockwise from north (up, -y). A highlight sits towards it.
  const lightX = Math.sin((params.light.azimuth * Math.PI) / 180);
  const lightY = -Math.cos((params.light.azimuth * Math.PI) / 180);
  const light: [number, number] = [lightX, lightY];
  /**
   * Rounded forms of snow, as the second round drew them: the caps on tree crowns, and the lumps of its mounds
   * (x, y, turn, length, width, five numbers each). Their lit tops are cleared (by `clearTone`) on every plate of
   * `clear`, then their sides away from the light are shaded in the winter set's bands, at `scale` of the bands' tones.
   */
  const lumpOps = (feature: string, placements: readonly number[], clear: readonly string[], scale: number, clearTone = 1) => {
    if (!WD || placements.length === 0) return;
    useShape('pillow', [capShape()]);
    for (const plate of clear) ops.push({ ...stamp(feature, plate, clearTone, 'pillow', placements), mode: 'erase' });
    const byLune = new Map<number, number[]>();
    for (let i = 0; i < placements.length; i += 5) {
      const k = luneIndex(placements[i + 2] as number, placements[i + 3] as number, placements[i + 4] as number, light);
      const list = byLune.get(k) ?? [];
      list.push(...placements.slice(i, i + 5));
      byLune.set(k, list);
    }
    WD.bands.lunes.forEach((lune, band) => {
      for (let k = 0; k < LUNES; k++) {
        const list = byLune.get(k);
        if (!list) continue;
        useShape(`pillow-lune-${band}-${k}`, [luneShape(lune, k)]);
        ops.push(stamp(`${feature}-shade`, WD.shadePlate, (WD.bands.tones[band] as number) * scale, `pillow-lune-${band}-${k}`, list));
      }
    });
  };
  /**
   * Kept from the second round, and drawn only when the winter set switches its mounds on: a set of freestanding
   * mounds, grouped by the hex each lies in: every shadow, then every mound's lumps and their lower sides.
   */
  const freeMounds = (set: readonly Mound[]) => {
    if (!WD || set.length === 0) return;
    const M = WD.mounds;
    const groups = new Map<HexId, Mound[]>();
    for (const p of set) {
      const h = nearestHex(g, p.x, p.y);
      const list = groups.get(h) ?? [];
      list.push(p);
      groups.set(h, list);
    }
    const hexes = [...groups.keys()].sort((x, y) => x - y);
    const low = (p: Mound) => p.kind === 'drift';
    for (const h of hexes) {
      for (const drift of [false, true]) {
        const mine = (groups.get(h) as Mound[]).filter(p => low(p) === drift);
        if (mine.length > 0) ops.push(fill('pillow-shadow', WD.shadePlate, 'draw', drift ? M.open.castTone : M.castTone, mine.map(p => moundShadowRing(p, light, M.castOffset, M.castGrow)), M.castFeather));
      }
    }
    // Each mound's lumps in layers, the lump furthest from the light first: within a layer no two lumps touch.
    for (const h of hexes) {
      for (const drift of [false, true]) {
        const lumps = (groups.get(h) as Mound[]).filter(p => low(p) === drift).map(p => lumpPlacements(ctx.seed, p, M.most, light));
        for (let layer = 0; layer < M.most; layer++) {
          lumpOps(drift ? 'snow-drift' : 'snow-pillow', lumps.flatMap(l => l[layer] ?? []), WD.snowPlates, drift ? M.open.shadeScale : 1);
        }
      }
    }
  };
  /** What a freestanding thing on open ground is placed against and kept clear of. */
  const openGround = () => ({
    lines, hill: hillLines,
    trees: [...canopies, ...planting.added, ...(treeSides ? treeSides.clumps.flat() : [])],
    outlineScale: params.woods.outlineScale,
    treeStrokes: treeSides ? treeSides.strokes : [],
    sideHalfWidth: params.treeSides.sideHalfWidth + params.treeSides.sideEdge,
    shore: water ? water.shore : [],
    boxes: [...spotClear, ...nameBoxes],
    roadCasing: params.roads.casingHalfWidth,
    riverBank: params.rivers.bankHalfWidth,
    lineHalfWidth: Math.max(params.hillLines.crestHalfWidth, params.hillLines.ridgeHalfWidth, params.hillLines.separatorHalfWidth),
  });
  // The second round's mounds, when switched on: placed now and drawn in two passes, those on the lee of woods
  // here, under the trees; the rest after the buildings.
  const mounds: Mound[] = WD && WD.mounds.on ? placeMounds(ctx, WD, openGround()) : [];
  freeMounds(mounds.filter(underTrees));
  /**
   * Snow lying on things in the pillow manner (the group of one hex): each a flat shape, a little lighter than
   * what it lies on (`lift` of every plate of `plates` cleared under it), with a slight highlight inside its
   * sides toward the light (a band `edge` wide, cleared by `light` more) and a thin shadow along its other sides
   * (a line `shadow` wide, half of it outside the shape, at `shadowTone` of the shade). Nothing is mounded.
   */
  const pillowOps = (feature: string, lying: readonly Lying[], plates: readonly string[], S: PillowShade) => {
    if (!WD || lying.length === 0) return;
    for (const key of [...new Set(lying.map(l => l.key))].sort()) {
      const mine = lying.filter(l => l.key === key);
      useShape(key, [(mine[0] as Lying).unit]);
      for (const plate of plates) ops.push({ ...stamp(feature, plate, S.lift, key, mine.flatMap(l => l.placement)), mode: 'erase' });
    }
    const rings = lying.map(l => l.ring);
    const sides = rings.map(r => litSides(r, light, S.facing));
    const lit = sides.flatMap(s => s.lit);
    const far = sides.flatMap(s => s.shaded);
    if (lit.length > 0 && S.edge > 0 && S.light > 0) {
      for (const plate of plates) {
        const op: PatternOp = { op: 'pattern', feature: `${feature}-light`, plate, mode: 'erase', tone: S.light, clip: rings, strokes: lit, width: 2 * S.edge };
        ops.push(op);
      }
    }
    if (far.length > 0 && S.shadow > 0 && S.shadowTone > 0) {
      const [x0, y0, x1, y1] = boundsOf(rings);
      const pad = S.shadow + 0.004;
      const op: PatternOp = {
        op: 'pattern', feature: `${feature}-shade`, plate: WD.shadePlate, mode: 'draw', tone: S.shadowTone,
        clip: [[x0 - pad, y0 - pad, x1 + pad, y0 - pad, x1 + pad, y1 + pad, x0 - pad, y1 + pad]], strokes: far, width: S.shadow,
      };
      ops.push(op);
    }
  };

  // ---- woods: every outline, then every body, then every highlight; one op per hex ----
  const W = params.woods;
  if (canopies.length > 0) useShape('canopy', [canopyShape()]);
  const byHex = new Map<HexId, Canopy[]>();
  for (const c of canopies) {
    const list = byHex.get(c.hex);
    if (list) list.push(c);
    else byHex.set(c.hex, [c]);
  }
  const woodHexes = [...byHex.keys()].sort((x, y) => x - y);
  const place = (list: Canopy[], k: number, shift: number) => list.flatMap(c => [
    c.x + lightX * shift * c.size, c.y + lightY * shift * c.size, c.rot, c.size * c.sx * k, c.size * c.sy * k,
  ]);
  // The trees 3b adds go in ops of their own, after the 3a ops of each pass: within a pass every op has one tone,
  // so the order of ops there changes no pixel, and the 3a ops stay as they were, placement for placement.
  const addedByHex = new Map<HexId, Canopy[]>();
  for (const c of planting.added) {
    const list = addedByHex.get(c.hex);
    if (list) list.push(c);
    else addedByHex.set(c.hex, [c]);
  }
  const addedHexes = [...addedByHex.keys()].sort((x, y) => x - y);
  if (planting.added.length > 0) useShape('canopy', [canopyShape()]);
  for (const h of woodHexes) ops.push(stamp('canopy-outline', PL.canopy, W.outlineTone, 'canopy', place(byHex.get(h) as Canopy[], W.outlineScale, 0)));
  for (const h of addedHexes) ops.push(stamp('canopy-outline', PL.canopy, W.outlineTone, 'canopy', place(addedByHex.get(h) as Canopy[], W.outlineScale, 0)));
  for (const h of woodHexes) ops.push(stamp('canopy', PL.canopy, W.bodyTone, 'canopy', place(byHex.get(h) as Canopy[], 1, 0)));
  for (const h of addedHexes) ops.push(stamp('canopy', PL.canopy, W.bodyTone, 'canopy', place(addedByHex.get(h) as Canopy[], 1, 0)));
  for (const h of woodHexes) ops.push(stamp('canopy-highlight', PL.canopy, W.highlightTone, 'canopy', place(byHex.get(h) as Canopy[], W.highlightScale, W.highlightShift)));
  for (const h of addedHexes) ops.push(stamp('canopy-highlight', PL.canopy, W.highlightTone, 'canopy', place(addedByHex.get(h) as Canopy[], W.highlightScale, W.highlightShift)));

  // ---- woods from tree sides: the clumps, one after another, each whole (its trees' outlines, their bodies,
  // their highlights); all on the canopy's plate, where a later tone replaces an earlier one, so a later clump
  // lies over an earlier one. A tree is the stamp woods draw; its features are its own, because the checks
  // that judge `canopy` ops judge them by woods hexes, and these trees have none.
  if (treeSides) {
    if (treeSides.clumps.length > 0) useShape('canopy', [canopyShape()]);
    for (const clump of treeSides.clumps) {
      ops.push(stamp('tree-outline', PL.canopy, W.outlineTone, 'canopy', place(clump, W.outlineScale, 0)));
      ops.push(stamp('tree', PL.canopy, W.bodyTone, 'canopy', place(clump, 1, 0)));
      ops.push(stamp('tree-highlight', PL.canopy, W.highlightTone, 'canopy', place(clump, W.highlightScale, W.highlightShift)));
    }
  }

  if (WD) {
    // A cap of snow on many of the trees, after every tree: one group of ops for each hex the trees stand in.
    const C = WD.caps;
    const all = [...canopies, ...planting.added, ...(treeSides ? treeSides.clumps.flat() : [])];
    const capsByHex = new Map<HexId, Canopy[]>();
    for (const c of all) {
      const h = nearestHex(g, c.x, c.y);
      const list = capsByHex.get(h) ?? [];
      list.push(c);
      capsByHex.set(h, list);
    }
    for (const h of [...capsByHex.keys()].sort((x, y) => x - y)) {
      lumpOps('snow-cap', capPlacements(ctx.seed, capsByHex.get(h) as Canopy[], C, light), C.knockout, C.shadeScale, C.clear);
    }
  }
  // ---- the green sides, printed after the trees: one stroke along each set side, on a plate of its own. Under
  // the stroke the canopy ink is replaced: a tone of it is left under the hairline edge and none under the rest,
  // so the stroke is the same olive on open ground and through the trees.
  if (treeSides && drawSides) {
    const TS = params.treeSides;
    const full = TS.sideHalfWidth + TS.sideEdge;
    if (TS.sideEdge > 0) for (const l of treeSides.strokes) ops.push(ribbon('tree-side-edge', PL.canopy, 'draw', TS.sideEdgeTone, l, full));
    for (const l of treeSides.strokes) ops.push(ribbon('tree-side-knockout', PL.canopy, 'erase', 1, l, TS.sideHalfWidth));
    for (const l of treeSides.strokes) ops.push(ribbon('tree-side', TS.plate, 'draw', 1, l, full));
  }

  // ---- buildings: footprints, then their outlines ----
  const T = params.towns;
  const bByHex = new Map<HexId, Building[]>();
  for (const bd of buildings) {
    const list = bByHex.get(bd.hex);
    if (list) list.push(bd);
    else bByHex.set(bd.hex, [bd]);
  }
  const townHexes = [...bByHex.keys()].sort((x, y) => x - y);
  // Footprints: one op per hex and family of buildings. Then the flat tops of hip roofs, the roof lines of
  // each family (drawn as the owner's set draws them), and the outlines over all.
  const families = Object.keys(T.inks).sort() as (keyof typeof T.inks)[];
  for (const family of families) {
    const ink = T.inks[family];
    for (const h of townHexes) {
      const rings = (bByHex.get(h) as Building[]).filter(bd => bd.family === family).map(bd => bd.ring);
      if (rings.length > 0) ops.push(fill('building', ink.plate, 'draw', ink.tone, rings));
    }
  }
  /** A point of a building from its own axes: su along its width, sv across, each from -1 to 1 at its sides. */
  const at = (bd: Building, su: number, sv: number): [number, number] => {
    const c = Math.cos(bd.angle);
    const s = Math.sin(bd.angle);
    return [bd.cx + c * su * bd.halfLen - s * sv * bd.halfDepth, bd.cy + s * su * bd.halfLen + c * sv * bd.halfDepth];
  };
  // Summer lists each hex's roof tops and then its roof lines; winter lists every roof top, then the snow on the
  // roofs, then every roof line, so that the lines lie on the snow.
  const roofLines: PatternOp[] = [];
  for (const family of families) {
    const ink = T.inks[family];
    for (const h of townHexes) {
      const mine = (bByHex.get(h) as Building[]).filter(bd => bd.family === family);
      const tops: number[][] = [];
      const strokes: number[][] = [];
      for (const bd of mine) {
        const w = 2 * bd.halfLen;
        const d = 2 * bd.halfDepth;
        // Along the long axis: l runs along it, x across it, each as a share of the half-size.
        const wide = w >= d;
        const pt = (l: number, x: number) => (wide ? at(bd, l, x) : at(bd, x, l));
        const long = Math.max(w, d);
        const short = Math.min(w, d);
        switch (bd.roof) {
          case 'gable':
            strokes.push([...pt(-1 + 0.012 / (long / 2), 0), ...pt(1 - 0.012 / (long / 2), 0)]);
            break;
          case 'gable_ends': {
            const e = (0.3 * short) / (long / 2);
            strokes.push([...pt(-1 + e, 0), ...pt(1 - e, 0)]);
            strokes.push([...pt(-1, -1), ...pt(-1 + e, 0), ...pt(-1, 1)]);
            strokes.push([...pt(1, -1), ...pt(1 - e, 0), ...pt(1, 1)]);
            break;
          }
          case 'hip': {
            const iu = 1 - (0.25 * short) / bd.halfLen;
            const iv = 1 - (0.25 * short) / bd.halfDepth;
            const top = [...at(bd, -iu, -iv), ...at(bd, iu, -iv), ...at(bd, iu, iv), ...at(bd, -iu, iv)];
            tops.push(top);
            strokes.push([...top, top[0] as number, top[1] as number]);
            // A line from each corner of the building to the corner of its flat top.
            for (let k = 0; k < 8; k += 2) strokes.push([bd.ring[k] as number, bd.ring[k + 1] as number, top[k] as number, top[k + 1] as number]);
            break;
          }
          case 'cross':
            strokes.push([...at(bd, -0.5, 0), ...at(bd, 0.5, 0)]);
            strokes.push([...at(bd, 0, -2 / 3), ...at(bd, 0, 2 / 3)]);
            break;
          case 'flat':
            break;
        }
      }
      if (tops.length > 0) ops.push(fill('roof-top', ink.plate, 'draw', Math.min(1, ink.tone + T.hipTopTone), tops));
      if (strokes.length > 0) {
        const lineOp: PatternOp = {
          op: 'pattern', feature: 'roof-line', plate: PL.buildingOutline, mode: 'draw', tone: ink.roofLine,
          clip: mine.map(bd => bd.ring.slice()), strokes, width: T.roofLineWidth,
        };
        if (WD) roofLines.push(lineOp);
        else ops.push(lineOp);
      }
    }
  }
  if (WD && townHexes.length > 0) {
    // Winter: snow on every roof, inset from its edge, under the roof lines and the outlines. What lies under it:
    // every plate snow clears, and the key too (a grey roof prints from the key).
    const R = WD.roofs;
    const plates = [...WD.snowPlates, PL.buildingOutline].filter((p, i, all) => all.indexOf(p) === i);
    if (R.style === 'ridge') {
      // As the second round drew it: the roof cleared to bare stock, and the half of it away from the light,
      // across the ridge, in shade. One op per hex.
      useShape('roof-snow', [roofSnowShape()]);
      useShape('roof-snow-half', [roofSnowHalfShape()]);
      for (const plate of plates) {
        for (const h of townHexes) ops.push({ ...stamp('roof-snow', plate, 1, 'roof-snow', (bByHex.get(h) as Building[]).flatMap(bd => roofPlacement(bd, R.inset))), mode: 'erase' });
      }
      for (const h of townHexes) {
        const halves = (bByHex.get(h) as Building[]).filter(bd => bd.roof !== 'flat').flatMap(bd => roofShadePlacement(bd, R.inset, light));
        if (halves.length > 0) ops.push(stamp('roof-snow-shade', WD.shadePlate, R.shadeTone, 'roof-snow-half', halves));
      }
    } else {
      // The trial: the roof's square in the pillow manner.
      const square = roofSquareShape();
      for (const h of townHexes) {
        pillowOps('roof-snow', (bByHex.get(h) as Building[]).map(bd => {
          const p = roofPlacement(bd, R.inset);
          return { key: 'roof-square', unit: square, placement: p, ring: placedRing(square, p[0] as number, p[1] as number, p[2] as number, p[3] as number, p[4] as number) };
        }), plates, R.pillow);
      }
    }
  }
  for (const op of roofLines) ops.push(op);
  for (const h of townHexes) {
    // Outlines are strokes round each footprint, clipped to one ring round the hex's buildings: the houses
    // of a packed row stand closer than a line's width, and filled frames would cancel where they overlap.
    const mine = bByHex.get(h) as Building[];
    const o = T.outlineHalfWidth;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    const strokes: number[][] = [];
    for (const bd of mine) {
      const r = rectCorners(bd.cx, bd.cy, bd.halfLen, bd.halfDepth, bd.angle);
      for (let k = 0; k < 8; k += 2) {
        x0 = Math.min(x0, r[k] as number);
        x1 = Math.max(x1, r[k] as number);
        y0 = Math.min(y0, r[k + 1] as number);
        y1 = Math.max(y1, r[k + 1] as number);
      }
      strokes.push([...r, r[0] as number, r[1] as number, r[2] as number, r[3] as number]);
    }
    const pad = 2 * o + 0.004;
    const outlineOp: PatternOp = {
      op: 'pattern', feature: 'building-outline', plate: PL.buildingOutline, mode: 'draw', tone: T.outlineTone,
      clip: [[x0 - pad, y0 - pad, x1 + pad, y0 - pad, x1 + pad, y1 + pad, x0 - pad, y1 + pad]], strokes, width: 2 * o,
    };
    ops.push(outlineOp);
  }

  // ---- winter, each switched off in the winter set until asked for: the second round's other mounds (along
  // crests, against banks, and its drifts); a few flat pieces of banked snow on open ground, and snow on the
  // stones of rough ground, both in the pillow manner ----
  freeMounds(mounds.filter(p => !underTrees(p)));
  const drifts: Piece[] = WD ? placeDrifts(ctx, WD, openGround(), PIECES) : [];
  if (WD) {
    for (const group of piecesByHex(drifts)) {
      pillowOps('snow-piece', group.map(p => ({ key: pieceShapeKey(p.shape), unit: PIECES[p.shape] as number[], placement: [p.x, p.y, p.rot, p.sx, p.sy], ring: pieceRing(PIECES, p) })), WD.drifts.plates, WD.drifts.pillow);
    }
    if (WD.stones.on) {
      const stone = stoneShape()[0] as number[];
      for (const r of rough) {
        pillowOps('stone-snow', r.stones.map(p => ({ key: 'stone', unit: stone, placement: [p.x, p.y, p.rot, p.sx, p.sy], ring: placedRing(stone, p.x, p.y, p.rot, p.sx, p.sy) })), WD.stones.plates, WD.stones.pillow);
      }
    }
  }

  // ---- hill lines: exactly the derived set, and the hilltop sides on the board edge ----
  // No canopy comes near a hill line (woods.ts keeps them clear), so a line is its own ink.
  const H = params.hillLines;
  if (options.hillLines !== false) {
    for (const l of hillLines.separator) ops.push(ribbon('separator', PL.separator, 'draw', 1, l, H.separatorHalfWidth));
    for (const l of hillLines.ridge) ops.push(ribbon('ridge', PL.ridge, 'draw', 1, l, H.ridgeHalfWidth));
    for (const l of hillLines.crest) ops.push(ribbon('crest', PL.crest, 'draw', 1, l, H.crestHalfWidth));
    for (const l of hillLines.crestOuter) ops.push(ribbon('crest-outer', PL.crest, 'draw', 1, l, H.crestHalfWidth));
  }

  // ---- roads: every casing, then every fill; the fill knocks the road out to bare stock ----
  const RD = params.roads;
  for (const r of lines.roads) ops.push(ribbon('road-casing', PL.roadCasing, 'draw', RD.casingTone, r.line, RD.casingHalfWidth));
  for (const r of lines.roads) ops.push(ribbon('road-fill', PL.roadCasing, 'erase', 1, r.line, RD.fillHalfWidth));
  for (const plate of PL.roadKnockout) {
    if (plate === PL.roadCasing) continue;
    for (const r of lines.roads) ops.push(ribbon('road-knockout', plate, 'erase', 1, r.line, RD.fillHalfWidth));
  }

  // ---- bridges: two rails with flared ends at the crossing ----
  const BR = params.bridges;
  for (const br of lines.bridges) {
    const t = br.roadTangent;
    const n: Vec = [-t[1], t[0]];
    const off = RD.casingHalfWidth + BR.railGap;
    const half = BR.railLength / 2;
    const f = BR.flare * SQRT_HALF;
    for (const side of [1, -1]) {
      const cx = br.point[0] + n[0] * off * side;
      const cy = br.point[1] + n[1] * off * side;
      const ax = cx - t[0] * half;
      const ay = cy - t[1] * half;
      const bx = cx + t[0] * half;
      const by = cy + t[1] * half;
      const line = [
        ax - t[0] * f + n[0] * side * f, ay - t[1] * f + n[1] * side * f,
        ax, ay, bx, by,
        bx + t[0] * f + n[0] * side * f, by + t[1] * f + n[1] * side * f,
      ];
      ops.push(ribbon('bridge', PL.bridge, 'draw', 1, line, BR.railHalfWidth));
    }
  }

  // ---- spot heights ----
  for (const m of spotMarks) {
    ops.push(fill('spot-triangle', PL.spotHeight, 'draw', 1, [m.triangle]));
    const g1: GlyphsOp = { op: 'glyphs', feature: 'spot-number', text: m.text, plate: PL.spotHeight, mode: 'draw', tone: 1, shapes: m.run.shapes.slice(), transforms: m.run.transforms.slice() };
    ops.push(g1);
  }

  // ---- town names: placed above, drawn last ----
  for (const op of nameOps) ops.push(op);

  // ---- the list: plates from the ink table, shapes sorted by key, every number rounded ----
  const plates: Plate[] = art.inks.plates.map(p => ({ id: p.id, ink: p.ink, offset: [p.offset[0], p.offset[1]] as const }));
  // An extra plate of the ink table is listed only by a board that prints from it: the green sides' own.
  if (drawSides) {
    const extra = art.inks.extraPlates.find(p => p.id === params.treeSides.plate);
    if (!extra) throw new Error(`the ink table has no extra plate '${params.treeSides.plate}' for the green sides`);
    plates.push({ id: extra.id, ink: extra.ink, offset: [extra.offset[0], extra.offset[1]] as const });
  }
  const sortedShapes: Record<string, number[][]> = {};
  for (const key of Object.keys(shapes).sort()) sortedShapes[key] = shapes[key] as number[][];
  const whole: DisplayList = { units: 'hex', bounds: [bounds[0], bounds[1], bounds[2], bounds[3]], plates, shapes: sortedShapes, ops };
  // The paper's grain: drawn by the bake, from this entry alone.
  const paper: Paper | null = params.paper.amplitude > 0
    ? { seed: map.artSeed >>> 0, amplitude: params.paper.amplitude, scale: params.paper.scale, carry: params.paper.carry } : null;
  const list = roundList(paper ? { ...whole, paper } : whole, params.precision);
  return { list, ctx, lines, canopies, buildings, addedCanopies: planting.added, removedCanopies: planting.removed, fields, towns, spotClear, treeSides, floes, drifts, mounds };
}

/** buildMapArt(description, art data): the display list. */
export function buildMapArt(map: MapDescription, art: ArtData, options: BuildOptions = {}): DisplayList {
  return buildMapArtFull(map, art, options).list;
}

// ---------------------------------------------------------------------------
// Rounding and serialising
// ---------------------------------------------------------------------------

function roundList(list: DisplayList, places: number): DisplayList {
  const m = 10 ** places;
  const r = (v: number): number => {
    const x = Math.round(v * m) / m;
    return x === 0 ? 0 : x;
  };
  const arr = (a: readonly number[]) => a.map(r);
  const ops: DisplayOp[] = list.ops.map((op): DisplayOp => {
    switch (op.op) {
      case 'fill': {
        const out: FillOp = { op: 'fill', feature: op.feature, plate: op.plate, mode: op.mode, tone: r(op.tone), rings: op.rings.map(arr) };
        if (op.feather !== undefined) out.feather = r(op.feather);
        return out;
      }
      case 'ribbon': {
        const out: RibbonOp = { op: 'ribbon', feature: op.feature, plate: op.plate, mode: op.mode, tone: r(op.tone), line: arr(op.line), halfWidths: arr(op.halfWidths) };
        if (op.dash !== undefined) out.dash = arr(op.dash);
        return out;
      }
      case 'stamp':
        return { op: 'stamp', feature: op.feature, plate: op.plate, mode: op.mode, tone: r(op.tone), shape: op.shape, placements: arr(op.placements) };
      case 'pattern':
        return { op: 'pattern', feature: op.feature, plate: op.plate, mode: op.mode, tone: r(op.tone), clip: op.clip.map(arr), strokes: op.strokes.map(arr), width: r(op.width) };
      case 'glyphs':
        return { op: 'glyphs', feature: op.feature, text: op.text, plate: op.plate, mode: op.mode, tone: r(op.tone), shapes: op.shapes.slice(), transforms: arr(op.transforms) };
    }
  });
  const shapes: Record<string, readonly (readonly number[])[]> = {};
  for (const [k, rings] of Object.entries(list.shapes)) shapes[k] = rings.map(arr);
  const out: DisplayList = { units: 'hex', bounds: list.bounds, plates: list.plates, shapes, ops };
  return list.paper ? { ...out, paper: { ...list.paper } } : out;
}

/** The list as the exact text written to a file and hashed. */
export function serializeList(list: DisplayList): string {
  return JSON.stringify(list);
}
