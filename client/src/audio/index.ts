/**
 * The game's sound, for the page: so far the music.
 *
 * Outside the game layer and the scene, as the unit art and the table's art
 * are: neither of them fetches or plays anything. The page's entry calls
 * `loadMusic(params)` and hands what comes back to whoever shows its controls.
 *
 * Everything comes from assets/music/v1/, which `npm run music` writes from
 * the owner's own pieces (tools/music/tracks.yaml): the playlist (bundled with
 * this file) and, for each piece (the regular ones and the ambient ones), an
 * Ogg Opus file and an AAC copy for a browser that does not play the first.
 * The bundler turns the files into addresses; a file is fetched only when its
 * piece is about to play.
 */
import listText from '../../../assets/music/v1/music.json?raw';
import { readMusic } from './playlist';
import type { MusicData } from './playlist';
import { startMusic } from './music';
import type { Music } from './music';

export type { Music, MusicState } from './music';

declare global {
  interface Window {
    /** The music's controls, for checks and for the console. */
    __music?: Music;
  }
}

const FILES = import.meta.glob<string>('../../../assets/music/v1/*.{opus,m4a}', { query: '?url', import: 'default', eager: true });
const addressOf = (name: string): string | null => FILES[`../../../assets/music/v1/${name}`] ?? null;

/**
 * For checks only (tests/audio/browser/music.mjs): `musicspell=<seconds>` in the address makes every quiet
 * stretch play its ambient piece for that many seconds (its fades as they are), so that a check need not wait
 * minutes for one.
 */
function withSpell(data: MusicData, text: string | null): MusicData {
  if (text === null) return data;
  const seconds = Number(text);
  if (!Number.isInteger(seconds) || seconds < 1) throw new Error(`music: musicspell=${text} in the address must be a whole number of seconds`);
  return { ...data, ambient: { ...data.ambient, spell: { least: seconds, most: seconds }, toEnd: 0 } };
}

/**
 * The music, started. `music=0` in the address keeps it off for this page and `music=1` on, without
 * touching the player's own choice; otherwise that choice holds (on, the first time). `begin`: a regular
 * piece (by id) to begin with, from its first note (the title screen's theme); an id the playlist does not
 * have is an error.
 * Null when the playlist cannot be read, a piece has no file, or `begin` names no piece: the page is then as
 * it was without music, and the reason is in the console.
 */
export function loadMusic(params: URLSearchParams, options: { readonly begin?: string } = {}): Music | null {
  try {
    const data = withSpell(readMusic(JSON.parse(listText) as unknown), params.get('musicspell'));
    const opus = new Audio().canPlayType('audio/ogg; codecs="opus"') !== '';
    for (const t of [...data.tracks, ...data.ambient.pieces]) if (addressOf(opus ? t.opus : t.m4a) === null) throw new Error(`music: no file for "${t.id}"`);
    const asked = params.get('music');
    return startMusic({
      data,
      address: t => addressOf(opus ? t.opus : t.m4a) as string,
      startOn: asked === '0' ? false : asked === '1' ? true : null,
      ...(options.begin !== undefined ? { begin: options.begin } : {}),
    });
  } catch (err) {
    console.error(err);
    return null;
  }
}
