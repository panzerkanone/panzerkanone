/**
 * The explain file: what the drawing decided that the display list does not
 * show (docs/bars/M3b.md, "The explain file", as the lead's ruling of
 * 2026-11-11 leaves it: fields and towns; the woods are Milestone 3a's and
 * need no explaining beyond the count of trees added and taken out).
 *
 *   format   'mapart-explain/1'
 *   map      the map's id; artSeed; precision (decimal places of every coordinate, as the list's)
 *   fields   one entry per field hex, in hex order:
 *              hex      its label
 *              layout   'halves' | 'strips' | 'ell' | 'single'
 *              turn     the group's turn, degrees from 0 to 90
 *              plots    [{ ring: [x, y, ...4 corners], furrowAngle: degrees 0 to 180, area }]
 *   towns    one entry per town, in the order of their lowest hex:
 *              name, hexes (labels)
 *              blocks   the town's ground between its roads, rivers and outer sides: [ring, ...]
 *              lots     [{ hex, ring, area, fronts (true when it fronts a road), buildings: [index, ...] }]
 *              buildings [{ hex, lot, type, family, roof, row (-1, or the number its packed row shares),
 *                           ring: [4 corners], width, height, angle (degrees) }]
 *   woods    added (trees 3b adds to the 3a planting), removed { besideOuterCrest, strays }
 *
 * Rings are flat x, y lists in hex units. Building and plot rings are the
 * same numbers the display list carries.
 */
import { labelOf } from '../engine/core/hex';
import type { BuildResult } from './build';
import { ringArea } from './geom';

export interface Explain {
  format: 'mapart-explain/1';
  map: string;
  artSeed: number;
  precision: number;
  fields: { hex: string; layout: string; turn: number; plots: { ring: number[]; furrowAngle: number; area: number }[] }[];
  towns: {
    name: string;
    hexes: string[];
    blocks: number[][];
    lots: { hex: string; ring: number[]; area: number; fronts: boolean; buildings: number[] }[];
    buildings: {
      hex: string; lot: number; type: string; family: string; roof: string; row: number; ring: number[]; width: number; height: number; angle: number;
    }[];
  }[];
  woods: { added: number; removed: { besideOuterCrest: number; strays: number } };
}

export function buildExplain(result: BuildResult): Explain {
  const { ctx } = result;
  const places = ctx.art.params.precision;
  const m = 10 ** places;
  const r = (v: number): number => {
    const x = Math.round(v * m) / m;
    return x === 0 ? 0 : x;
  };
  const ring = (a: readonly number[]) => a.map(r);
  const L = (h: number) => labelOf(ctx.g, h);
  return {
    format: 'mapart-explain/1',
    map: ctx.map.id,
    artSeed: ctx.map.artSeed,
    precision: places,
    fields: result.fields.map(f => ({
      hex: L(f.hex), layout: f.layout, turn: r(f.turn),
      plots: f.plots.map((p, k) => ({ ring: ring(p), furrowAngle: r(f.furrowAngles[k] as number), area: r(Math.abs(ringArea(p))) })),
    })),
    towns: result.towns.map(t => ({
      name: t.name,
      hexes: t.hexes.map(L),
      blocks: t.blocks.map(ring),
      lots: t.lots.map(l => ({ hex: L(l.hex), ring: ring(l.ring), area: r(l.area), fronts: l.fronts, buildings: [...l.buildings] })),
      buildings: t.buildings.map(b => ({
        hex: L(b.hex), lot: b.lot, type: b.type, family: b.family, roof: b.roof, row: b.row, ring: ring(b.ring),
        width: r(2 * b.halfLen), height: r(2 * b.halfDepth), angle: r((b.angle * 180) / Math.PI),
      })),
    })),
    woods: { added: result.addedCanopies.length, removed: { ...result.removedCanopies } },
  };
}
