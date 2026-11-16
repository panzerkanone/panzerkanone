/**
 * What every part of the map art reads about a map: the grid, the two layers,
 * the derived hill lines, and the lists of the map file turned into sets with
 * no order of their own (so reversing a list in the file changes nothing).
 *
 * `order` is the order in which the generator visits hexes. It defaults to hex
 * number order; the `--hex-order` check passes a shuffled one, and the result
 * must not change. Every loop over hexes in the generator walks `order`.
 */
import { Grid, HexId, hexCount } from '../engine/core/hex';
import { HillLines, deriveHillLines } from '../engine/core/hillLines';
import { Cover, Level, MapDescription, coversOf, gridOf, hexOf, levelsOf, ridgeEdgesOf } from '../engine/core/map';
import { ArtData } from './params';

export interface Town {
  name: string;
  hexes: HexId[];
}

export interface SpotHeight {
  hex: HexId;
  height: number;
}

export interface MapContext {
  map: MapDescription;
  art: ArtData;
  g: Grid;
  n: number;
  seed: number;
  level: Level[];
  cover: Cover[];
  hill: HillLines;
  /** The order hexes are visited in. */
  order: readonly HexId[];
  /** Road edges as [lower hex, higher hex], sorted. */
  roadEdges: [HexId, HexId][];
  /** Exit hexes, sorted. */
  exits: HexId[];
  /** Rivers as hex chains, each oriented so its first hex is the lower-numbered end, sorted by first hex. */
  rivers: HexId[][];
  /** Hexes where a stream rises inland (the map's `springs`; empty for a map without). */
  springs: Set<HexId>;
  bridges: Set<HexId>;
  /** Towns sorted by their lowest hex number; each town's hexes sorted. */
  towns: Town[];
  townOfHex: Map<HexId, number>;
  /** Spot heights sorted by hex. */
  spots: SpotHeight[];
  spotOfHex: Map<HexId, number>;
  /** Ridge edges, each [lower hex, higher hex], sorted. */
  ridgeEdges: [HexId, HexId][];
  /** Hilltop crest edges [hilltop hex, lower hex], in hex order. */
  crestEdges: [HexId, HexId][];
  /** Separator edges [lower hex, higher hex], sorted. */
  separators: [HexId, HexId][];
}

const byPair = (a: readonly [number, number], b: readonly [number, number]) => a[0] - b[0] || a[1] - b[1];

export function makeContext(map: MapDescription, art: ArtData, hexOrder?: readonly HexId[]): MapContext {
  const g = gridOf(map);
  const n = hexCount(g);
  const level = levelsOf(map);
  const cover = coversOf(map);
  const ridges = ridgeEdgesOf(map);
  const hill = deriveHillLines(g, level, ridges);
  if (hexOrder) {
    if (hexOrder.length !== n || new Set(hexOrder).size !== n || hexOrder.some(h => !Number.isInteger(h) || h < 0 || h >= n)) {
      throw new Error(`hex order must list every hex of the ${n} once`);
    }
  }
  const order = hexOrder ? [...hexOrder] : Array.from({ length: n }, (_, i) => i);

  const edgeSet = new Map<string, [HexId, HexId]>();
  for (const chain of map.roads) {
    const ids = chain.map(l => hexOf(map, l));
    for (let k = 1; k < ids.length; k++) {
      const a = ids[k - 1] as HexId;
      const b = ids[k] as HexId;
      const e: [HexId, HexId] = a < b ? [a, b] : [b, a];
      edgeSet.set(`${e[0]}|${e[1]}`, e);
    }
  }
  const roadEdges = [...edgeSet.values()].sort(byPair);
  const exits = [...new Set(map.exits.map(l => hexOf(map, l)))].sort((a, b) => a - b);
  const rivers = map.rivers
    .map(chain => chain.map(l => hexOf(map, l)))
    .map(ids => ((ids[0] as HexId) <= (ids[ids.length - 1] as HexId) ? ids : [...ids].reverse()))
    .sort((a, b) => (a[0] as HexId) - (b[0] as HexId) || (a[a.length - 1] as HexId) - (b[b.length - 1] as HexId));
  const bridges = new Set(map.bridges.map(l => hexOf(map, l)));
  const springs = new Set((map.springs ?? []).map(l => hexOf(map, l)));
  const towns = map.towns
    .map(t => ({ name: t.name, hexes: t.hexes.map(l => hexOf(map, l)).sort((a, b) => a - b) }))
    .sort((a, b) => (a.hexes[0] as HexId) - (b.hexes[0] as HexId));
  const townOfHex = new Map<HexId, number>();
  towns.forEach((t, i) => t.hexes.forEach(h => townOfHex.set(h, i)));
  const spots = map.spotHeights.map(s => ({ hex: hexOf(map, s.hex), height: s.height })).sort((a, b) => a.hex - b.hex);
  const spotOfHex = new Map<HexId, number>();
  spots.forEach((s, i) => spotOfHex.set(s.hex, i));
  const ridgeEdges = hill.ridgeCrests.map(([a, c]) => (a < c ? [a, c] : [c, a]) as [HexId, HexId]).sort(byPair);
  const separators = hill.separators.map(([a, c]) => (a < c ? [a, c] : [c, a]) as [HexId, HexId]).sort(byPair);

  return {
    map, art, g, n, seed: map.artSeed, level, cover, hill, order, roadEdges, exits, rivers, springs, bridges, towns, townOfHex,
    spots, spotOfHex, ridgeEdges, crestEdges: hill.hilltopCrests, separators,
  };
}
