/**
 * A display list read the way the bar's checks read it (docs/bars/M3a.md,
 * "Terms" and "Tags"): canopies, buildings, centre lines, the wash, all from
 * the reserved `feature` tags, never from the generator's own working.
 */
import type { DisplayList, DisplayOp, FillOp, GlyphsOp, RibbonOp, StampOp } from '../displayList';
import { inRings } from '../geom';

export interface Pt {
  x: number;
  y: number;
}

export interface ListView {
  list: DisplayList;
  canopies: Pt[];
  canopyOps: number;
  buildings: number[][];
  /** Centre lines: the `line` of road-fill ribbons. */
  roadLines: number[][];
  /** Centre lines: the `line` of river-water ribbons. */
  riverLines: number[][];
  roadFill: { index: number; op: RibbonOp }[];
  roadCasing: { index: number; op: RibbonOp }[];
  riverWater: { index: number; op: RibbonOp }[];
  riverBank: { index: number; op: RibbonOp }[];
  washOps: { index: number; op: FillOp; box: [number, number, number, number] }[];
  glyphOps: { index: number; op: GlyphsOp }[];
  /** True when the point is washed: among wash ops whose rings contain it (even-odd, feather ignored), the last is in draw mode. */
  washed(x: number, y: number): boolean;
  /** The outline points of a glyph op, transformed. */
  glyphPoints(op: GlyphsOp): number[];
  /** Points of an op, as the bar reads them for "no point outside" tests. */
  opPoints(op: DisplayOp): number[];
}

function ringsBox(rings: readonly (readonly number[])[]): [number, number, number, number] {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const r of rings) {
    for (let i = 0; i + 1 < r.length; i += 2) {
      x0 = Math.min(x0, r[i] as number);
      x1 = Math.max(x1, r[i] as number);
      y0 = Math.min(y0, r[i + 1] as number);
      y1 = Math.max(y1, r[i + 1] as number);
    }
  }
  return [x0, y0, x1, y1];
}

export function stampPoints(list: DisplayList, op: StampOp): number[] {
  const rings = list.shapes[op.shape] ?? [];
  const out: number[] = [];
  const p = op.placements;
  for (let i = 0; i < p.length; i += 5) {
    const x = p[i] as number;
    const y = p[i + 1] as number;
    const rot = p[i + 2] as number;
    const sx = p[i + 3] as number;
    const sy = p[i + 4] as number;
    const c = Math.cos(rot);
    const s = Math.sin(rot);
    for (const r of rings) {
      for (let k = 0; k + 1 < r.length; k += 2) {
        const u = (r[k] as number) * sx;
        const v = (r[k + 1] as number) * sy;
        out.push(x + c * u - s * v, y + s * u + c * v);
      }
    }
  }
  return out;
}

/** The rings of a stamp as placed: one flat ring per placement and shape ring (scaled, then turned, then moved). */
export function stampRings(list: DisplayList, op: StampOp): number[][] {
  const rings = list.shapes[op.shape] ?? [];
  const out: number[][] = [];
  const p = op.placements;
  for (let i = 0; i < p.length; i += 5) {
    const x = p[i] as number;
    const y = p[i + 1] as number;
    const c = Math.cos(p[i + 2] as number);
    const s = Math.sin(p[i + 2] as number);
    const sx = p[i + 3] as number;
    const sy = p[i + 4] as number;
    for (const r of rings) {
      const ring: number[] = [];
      for (let k = 0; k + 1 < r.length; k += 2) {
        const u = (r[k] as number) * sx;
        const v = (r[k + 1] as number) * sy;
        ring.push(x + c * u - s * v, y + s * u + c * v);
      }
      out.push(ring);
    }
  }
  return out;
}

export function makeView(list: DisplayList): ListView {
  const canopies: Pt[] = [];
  let canopyOps = 0;
  const buildings: number[][] = [];
  const roadFill: { index: number; op: RibbonOp }[] = [];
  const roadCasing: { index: number; op: RibbonOp }[] = [];
  const riverWater: { index: number; op: RibbonOp }[] = [];
  const riverBank: { index: number; op: RibbonOp }[] = [];
  const washOps: { index: number; op: FillOp; box: [number, number, number, number] }[] = [];
  const glyphOps: { index: number; op: GlyphsOp }[] = [];
  list.ops.forEach((op, index) => {
    if (op.feature === 'canopy' && op.mode === 'draw') {
      canopyOps++;
      if (op.op === 'stamp') {
        for (let i = 0; i < op.placements.length; i += 5) canopies.push({ x: op.placements[i] as number, y: op.placements[i + 1] as number });
      } else if (op.op === 'fill') {
        for (const r of op.rings) {
          let sx = 0;
          let sy = 0;
          for (let i = 0; i < r.length; i += 2) {
            sx += r[i] as number;
            sy += r[i + 1] as number;
          }
          canopies.push({ x: sx / (r.length / 2), y: sy / (r.length / 2) });
        }
      }
    }
    if (op.feature === 'building' && op.op === 'fill') for (const r of op.rings) buildings.push(r.slice());
    if (op.op === 'ribbon') {
      if (op.feature === 'road-fill') roadFill.push({ index, op });
      if (op.feature === 'road-casing') roadCasing.push({ index, op });
      if (op.feature === 'river-water') riverWater.push({ index, op });
      if (op.feature === 'river-bank') riverBank.push({ index, op });
    }
    if (op.feature === 'wash' && op.op === 'fill') washOps.push({ index, op, box: ringsBox(op.rings) });
    if (op.op === 'glyphs') glyphOps.push({ index, op });
  });

  const glyphPoints = (op: GlyphsOp): number[] => {
    const out: number[] = [];
    op.shapes.forEach((key, g) => {
      const t = op.transforms.slice(g * 6, g * 6 + 6) as number[];
      for (const r of list.shapes[key] ?? []) {
        for (let k = 0; k + 1 < r.length; k += 2) {
          const x = r[k] as number;
          const y = r[k + 1] as number;
          out.push((t[0] as number) * x + (t[2] as number) * y + (t[4] as number), (t[1] as number) * x + (t[3] as number) * y + (t[5] as number));
        }
      }
    });
    return out;
  };

  const opPoints = (op: DisplayOp): number[] => {
    switch (op.op) {
      case 'fill':
        return op.rings.flatMap(r => [...r]);
      case 'ribbon':
        return [...op.line];
      case 'stamp':
        return stampPoints(list, op);
      case 'pattern':
        return op.clip.flatMap(r => [...r]);
      case 'glyphs':
        return glyphPoints(op);
    }
  };

  const washed = (x: number, y: number): boolean => {
    for (let k = washOps.length - 1; k >= 0; k--) {
      const w = washOps[k] as { op: FillOp; box: [number, number, number, number] };
      if (x < w.box[0] || x > w.box[2] || y < w.box[1] || y > w.box[3]) continue;
      if (inRings(x, y, w.op.rings)) return w.op.mode === 'draw';
    }
    return false;
  };

  return {
    list, canopies, canopyOps, buildings,
    roadLines: roadFill.map(r => [...r.op.line]),
    riverLines: riverWater.map(r => [...r.op.line]),
    roadFill, roadCasing, riverWater, riverBank, washOps, glyphOps, washed, glyphPoints, opPoints,
  };
}

/** Bounding box of flat point arrays. */
export function pointsBox(points: readonly number[]): [number, number, number, number] {
  return ringsBox([points]);
}
