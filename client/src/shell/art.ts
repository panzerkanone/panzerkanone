/**
 * The title screen's art, for the page: the index (bundled with this file) and the addresses the
 * bundler gives the pictures and the typeface of assets/shell/v1/, which `npm run shellart` writes
 * from the owner's sheets. Nothing is fetched here but what `loadPicture` is asked for.
 */
import manifestText from '../../../assets/shell/v1/shell.json?raw';
import { readShellArt } from './manifest';
import type { ShellArt } from './manifest';

const FILES = import.meta.glob<string>('../../../assets/shell/v1/*.{webp,woff2}', { query: '?url', import: 'default', eager: true });

export const ART: ShellArt = readShellArt(JSON.parse(manifestText) as unknown);

/** The address of one of the index's files. */
export function addressOf(file: string): string {
  const address = FILES[`../../../assets/shell/v1/${file}`];
  if (address === undefined) throw new Error(`the title screen's art: no file is bundled for ${file}`);
  return address;
}

/** A picture of the index, fetched and decoded. */
export async function loadPicture(file: string): Promise<HTMLImageElement> {
  const image = new Image();
  image.decoding = 'async';
  image.src = addressOf(file);
  await image.decode();
  return image;
}
