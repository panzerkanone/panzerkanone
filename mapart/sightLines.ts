/**
 * The lines that bar sight, as data.
 *
 * A table that draws these lines itself, above its grid, asks for a list without them
 * (`BuildOptions.hillLines` and `treeSideLines`) and for this instead: each kind as the hexsides it
 * lies on, the ink of the plate the art prints it from, and its width as the art draws it. Nothing
 * here decides what bars sight: the sides are the board's own (the derived hill lines, the map's
 * tree sides), exactly the ones the art would print.
 */
import { HexId, directionTo, sideKey } from '../engine/core/hex';
import { seasonOf, treeSidesOf } from '../engine/core/map';
import type { MapContext } from './context';
import { seasonArt } from './params';
import type { ArtData } from './params';

/** A crest is a hilltop's side or a ridge's; a separator is a line-of-sight edge on a slope; a tree side is a wood's green side. */
export type SightLineKind = 'tree' | 'crest' | 'ridge' | 'separator';

export interface SightLineClass {
  kind: SightLineKind;
  /** The ink of the plate the art prints this kind from, sRGB 0..255. */
  ink: [number, number, number];
  /** The width of the line as the art draws it, in h. */
  width: number;
  /** The hexsides, each by its side key (engine/core/hex `sideKey`), in rising order, none twice. */
  sides: number[];
}

/** The ink of a plate of the table, by the plate's name, as sRGB 0..255. */
function inkOf(art: Pick<ArtData, 'inks'>, plate: string): [number, number, number] {
  const found = [...art.inks.plates, ...art.inks.extraPlates].find(p => p.id === plate);
  if (!found) throw new Error(`the ink table has no plate called ${plate}`);
  const v = Number.parseInt(found.ink.slice(1), 16);
  return [Math.floor(v / 65536) % 256, Math.floor(v / 256) % 256, v % 256];
}

/**
 * The lines that bar sight on a board, kind by kind, in the order tree, crest, ridge, separator. A kind the
 * board has none of has no sides. Each ink is the one the board's season prints it in.
 */
export function sightLinesOf(ctx: MapContext, artIn: ArtData): SightLineClass[] {
  const { g } = ctx;
  const art = seasonArt(artIn, seasonOf(ctx.map));
  const P = art.params;
  const between = (pairs: readonly (readonly [HexId, HexId])[]): number[] => pairs.map(([a, b]) => sideKey(g, a, directionTo(g, a, b)));
  const tidy = (keys: number[]): number[] => [...new Set(keys)].sort((a, b) => a - b);
  return [
    { kind: 'tree', ink: inkOf(art, P.treeSides.plate), width: 2 * P.treeSides.sideHalfWidth, sides: tidy(treeSidesOf(ctx.map).map(t => t.key)) },
    {
      kind: 'crest',
      ink: inkOf(art, P.plates.crest),
      width: 2 * P.hillLines.crestHalfWidth,
      // A hilltop's sides on the board's own edge are crests too.
      sides: tidy([...between(ctx.crestEdges), ...ctx.hill.outerCrests.map(([hex, dir]) => sideKey(g, hex, dir))]),
    },
    { kind: 'ridge', ink: inkOf(art, P.plates.ridge), width: 2 * P.hillLines.ridgeHalfWidth, sides: tidy(between(ctx.ridgeEdges)) },
    { kind: 'separator', ink: inkOf(art, P.plates.separator), width: 2 * P.hillLines.separatorHalfWidth, sides: tidy(between(ctx.separators)) },
  ];
}
