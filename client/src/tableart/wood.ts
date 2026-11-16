/**
 * The table top's wood (the owner, 2026-11-14: "better and more convincing wood for the table, perhaps clearcoat for
 * the wood grain and polyurethane"; and that evening "several high quality wood pbr textures"): one of the scanned
 * sets in assets/scene/wood/ (client/src/scene/woods.ts names them; the ledger says where each came from and what was
 * done to it), its colour, its relief (an OpenGL normal map) and its roughness. Outside the scene, as the tray's art
 * is: the scene fetches and decodes nothing itself, so the page's entry calls `loadWood(name)` and hands what comes back
 * to the table. Only the chosen wood is fetched.
 */
import teakColour from '../../../assets/scene/wood/teak.color.webp?url';
import teakNormal from '../../../assets/scene/wood/teak.normal.webp?url';
import teakRough from '../../../assets/scene/wood/teak.rough.webp?url';
import cherryColour from '../../../assets/scene/wood/cherry.color.webp?url';
import cherryNormal from '../../../assets/scene/wood/cherry.normal.webp?url';
import cherryRough from '../../../assets/scene/wood/cherry.rough.webp?url';
import tableColour from '../../../assets/scene/wood/table.color.webp?url';
import tableNormal from '../../../assets/scene/wood/table.normal.webp?url';
import tableRough from '../../../assets/scene/wood/table.rough.webp?url';
import { WOODS } from '../scene/woods';
import type { WoodName } from '../scene/woods';

const URLS: Record<WoodName, [string, string, string]> = {
  teak: [teakColour, teakNormal, teakRough],
  cherry: [cherryColour, cherryNormal, cherryRough],
  table: [tableColour, tableNormal, tableRough],
};

/** What the table's scene is handed for its wood. */
export interface LoadedWood {
  name: WoodName;
  colour: HTMLImageElement;
  normal: HTMLImageElement;
  rough: HTMLImageElement;
  /** The side of the square the pictures show, in millimetres (the scan's own size). */
  sideMm: number;
}

async function picture(url: string): Promise<HTMLImageElement> {
  const image = new Image();
  image.decoding = 'async';
  image.src = url;
  await image.decode();
  return image;
}

/** A wood, fetched and decoded. Resolves with null when any part of it fails (the table keeps the wood it draws itself). Never rejects. */
export async function loadWood(name: WoodName = 'teak'): Promise<LoadedWood | null> {
  try {
    const [colour, normal, rough] = await Promise.all(URLS[name].map(picture));
    return { name, colour: colour as HTMLImageElement, normal: normal as HTMLImageElement, rough: rough as HTMLImageElement, sideMm: WOODS[name].sideMm };
  } catch (err) {
    console.error(err);
    return null;
  }
}
