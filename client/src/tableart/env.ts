/**
 * The room round the table (the owner, 2026-11-14: "several HDRI's ... (CC)"): one of four Poly Haven HDRIs (CC0),
 * each as a panorama in two opaque lossless WebP pictures and its numbers in env.json (assets/scene/env/, made by
 * tools/tableart/env.py; the ledger says where each came from). Outside the scene, as the tray's art and the wood
 * are: the scene fetches and decodes nothing itself, so the page's entry calls `loadRoom()` when the address says
 * `env=<name>` and hands what comes back to the table. Only the chosen room is fetched.
 */
import factsUrl from '../../../assets/scene/env/env.json?url';
import loungeRgb from '../../../assets/scene/env/lounge.rgb.webp?url';
import loungeE from '../../../assets/scene/env/lounge.e.webp?url';
import studio03Rgb from '../../../assets/scene/env/studio03.rgb.webp?url';
import studio03E from '../../../assets/scene/env/studio03.e.webp?url';
import colorfulRgb from '../../../assets/scene/env/colorful.rgb.webp?url';
import colorfulE from '../../../assets/scene/env/colorful.e.webp?url';
import studio15Rgb from '../../../assets/scene/env/studio15.rgb.webp?url';
import studio15E from '../../../assets/scene/env/studio15.e.webp?url';
import { isRoomName, readRoomFacts } from '../scene/rooms';
import type { RoomArt } from '../scene/env';

const URLS: Record<string, { rgb: string; e: string }> = {
  lounge: { rgb: loungeRgb, e: loungeE },
  studio03: { rgb: studio03Rgb, e: studio03E },
  colorful: { rgb: colorfulRgb, e: colorfulE },
  studio15: { rgb: studio15Rgb, e: studio15E },
};

/**
 * A picture as the browser decodes it, exactly as stored: no colour conversion (the pictures are opaque, so nothing is
 * premultiplied). It goes to the graphics card as it is and is turned into light there (scene/env.ts). It is never
 * drawn on a 2D canvas and read back: the client reads no pixels back (tests/mapart/purity.test.ts), and browsers that
 * guard against fingerprinting change such readings on purpose, which would throw single texels' exponents off by one,
 * a doubling of their light.
 */
async function picture(url: string, width: number, height: number): Promise<ImageBitmap> {
  const blob = await (await fetch(url)).blob();
  const bitmap = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  if (bitmap.width !== width || bitmap.height !== height) {
    const found = `${bitmap.width} x ${bitmap.height}`;
    bitmap.close();
    throw new Error(`${url}: ${found}, not ${width} x ${height}`);
  }
  return bitmap;
}

/** A room, fetched, its two pictures decoded by the browser. Resolves with null when any part of it fails (the table keeps the old sky). Never rejects. */
export async function loadRoom(name: string): Promise<RoomArt | null> {
  try {
    if (!isRoomName(name)) throw new Error(`no room ${name}`);
    const facts = readRoomFacts(await (await fetch(factsUrl)).json(), name);
    const urls = URLS[name] as { rgb: string; e: string };
    const [rgb, e] = await Promise.all([picture(urls.rgb, facts.width, facts.height), picture(urls.e, facts.width, facts.height)]);
    return { name, rgb, e, facts };
  } catch (err) {
    console.error(err);
    return null;
  }
}
