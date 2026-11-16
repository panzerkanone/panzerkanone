/**
 * The map art generator: description file + art data -> display list.
 *
 * Pure: no DOM, no worker, no platform API, no clock, no unseeded randomness. The same
 * code runs in Node (`npm run mapart`) and in the client's bake worker.
 */
import { DisplayList } from './displayList';
import { serializeList } from './build';
import { sha256Text } from './sha256';

export { buildMapArt, buildMapArtFull, serializeList } from './build';
export { buildExplain } from './explain';
export type { Explain } from './explain';
export type { BuildOptions, BuildResult } from './build';
export { loadArtData, parseGlyphs, parseInks, parseParams, parseSeasonParams, seasonArt, validateGlyphs, validateInks, validateParams } from './params';
export type { ArtData, ArtParams, GlyphSet, InkTable, WinterArt, WinterDraw } from './params';
export { shuffledOrder } from './random';
export { sightLinesOf } from './sightLines';
export type { SightLineClass, SightLineKind } from './sightLines';
export { sha256Text } from './sha256';
export { validateDisplayList } from './validate';

/** Where the default data files live, relative to the repository root. */
export const DEFAULT_PARAMS_FILE = 'mapart/data/params.yaml';
export const DEFAULT_INKS_FILE = 'mapart/data/inks-a2.yaml';
export const DEFAULT_GLYPHS_FILE = 'mapart/data/lettering/board-lettering.json';
/** The winter set: what winter changes of the parameters and draws besides, and its ink table (`loadArtData`'s `winter`). */
export const DEFAULT_WINTER_PARAMS_FILE = 'mapart/data/params-winter.yaml';
export const DEFAULT_WINTER_INKS_FILE = 'mapart/data/inks-winter.yaml';

/** The content hash of a display list: SHA-256 of exactly the text a file of it holds. */
export function listHash(list: DisplayList): string {
  return sha256Text(serializeList(list));
}
