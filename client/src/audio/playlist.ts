/**
 * The music's playlist: plain data and plain sums, with no browser in it (the
 * Node tests read it).
 *
 * The data is assets/music/v1/music.json, which `npm run music` writes from
 * tools/music/tracks.yaml: the regular pieces in playing order with their
 * measured loudness, the loudness every piece is brought to, the wait before
 * the first note, and the quiet stretches between pieces with the ambient
 * pieces played softly in them.
 *
 * A stretch is `rest` seconds of silence, one ambient piece for a spell, and
 * `rest` seconds of silence again. The ambient pieces take turns; the spell's
 * length is drawn for each stretch from the visit's seed and the stretch's
 * number (a hash, never the platform's random numbers), so that the regular
 * pieces come at irregular times, the same for the same seed.
 */

/** A piece's file and what was measured of it. */
export interface MusicFile {
  readonly id: string;
  readonly title: string;
  readonly seconds: number;
  /** Integrated loudness as measured, LUFS. */
  readonly lufs: number;
  readonly peakDb: number;
  /** File names beside the playlist: the Ogg Opus file, and the AAC copy. */
  readonly opus: string;
  readonly m4a: string;
}

/** A regular piece. */
export interface MusicTrack extends MusicFile {
  /** The piece is sung. */
  readonly words: boolean;
}

export interface AmbientData {
  /** The ambient pieces' level against the regular pieces, once both are at the common loudness (0 to 1). */
  readonly level: number;
  /** Seconds of the spell's fade in and fade out. */
  readonly fadeIn: number;
  readonly fadeOut: number;
  /** A spell (when it is not the whole piece) lasts between these, in seconds; `whole` is the piece's own length. */
  readonly spell: { readonly least: number; readonly most: number | 'whole' };
  /** The share of stretches (0 to 1) that play their piece through to its end. */
  readonly toEnd: number;
  /** Seconds of silence before the spell and after it. */
  readonly rest: number;
  readonly pieces: readonly MusicFile[];
}

export interface MusicData {
  readonly targetLufs: number;
  /** Seconds before the first piece. */
  readonly leadIn: number;
  readonly tracks: readonly MusicTrack[];
  readonly ambient: AmbientData;
}

const fail = (why: string): never => {
  throw new Error(`music.json: ${why}`);
};
const mapping = (v: unknown, what: string): Record<string, unknown> => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : fail(`${what} must be a mapping`));
const numberOf = (v: unknown, what: string): number => (typeof v === 'number' && Number.isFinite(v) ? v : fail(`${what} must be a number`));
const textOf = (v: unknown, what: string): string => (typeof v === 'string' && v !== '' ? v : fail(`${what} must be a non-empty string`));
function exactly(m: Record<string, unknown>, keys: readonly string[], what: string): void {
  for (const k of Object.keys(m)) if (!keys.includes(k)) fail(`${what} has an unknown key "${k}"`);
  for (const k of keys) if (!(k in m)) fail(`${what} lacks "${k}"`);
}

function readFile(t: Record<string, unknown>, what: string, ids: Set<string>): MusicFile {
  const id = textOf(t.id, `${what}.id`);
  if (ids.has(id)) fail(`${what}.id "${id}" is used twice`);
  ids.add(id);
  const seconds = numberOf(t.seconds, `${what}.seconds`);
  if (seconds <= 0) fail(`${what}.seconds must be more than 0`);
  return {
    id,
    title: textOf(t.title, `${what}.title`),
    seconds,
    lufs: numberOf(t.lufs, `${what}.lufs`),
    peakDb: numberOf(t.peakDb, `${what}.peakDb`),
    opus: textOf(t.opus, `${what}.opus`),
    m4a: textOf(t.m4a, `${what}.m4a`),
  };
}

function readAmbient(source: unknown, ids: Set<string>): AmbientData {
  const a = mapping(source, 'ambient');
  exactly(a, ['level', 'fadeIn', 'fadeOut', 'spell', 'toEnd', 'rest', 'pieces'], 'ambient');
  const level = numberOf(a.level, 'ambient.level');
  if (level <= 0 || level > 1) fail('ambient.level must be more than 0 and at most 1');
  const fadeIn = numberOf(a.fadeIn, 'ambient.fadeIn');
  const fadeOut = numberOf(a.fadeOut, 'ambient.fadeOut');
  if (fadeIn <= 0 || fadeOut <= 0) fail('ambient.fadeIn and ambient.fadeOut must be more than 0');
  const spell = mapping(a.spell, 'ambient.spell');
  exactly(spell, ['least', 'most'], 'ambient.spell');
  const least = numberOf(spell.least, 'ambient.spell.least');
  if (least < fadeIn + fadeOut) fail('ambient.spell.least must leave room for both fades');
  const most = spell.most === 'whole' ? 'whole' : numberOf(spell.most, 'ambient.spell.most');
  if (most !== 'whole' && most < least) fail('ambient.spell must have least <= most');
  const toEnd = numberOf(a.toEnd, 'ambient.toEnd');
  if (toEnd < 0 || toEnd > 1) fail('ambient.toEnd must be from 0 to 1');
  const rest = numberOf(a.rest, 'ambient.rest');
  if (rest < 0) fail('ambient.rest must not be negative');
  if (!Array.isArray(a.pieces) || a.pieces.length === 0) fail('ambient.pieces must be a list with a piece in it');
  const pieces = (a.pieces as unknown[]).map((raw, i): MusicFile => {
    const what = `ambient.pieces[${i}]`;
    const t = mapping(raw, what);
    exactly(t, ['id', 'title', 'seconds', 'lufs', 'peakDb', 'opus', 'm4a'], what);
    return readFile(t, what, ids);
  });
  return { level, fadeIn, fadeOut, spell: { least, most }, toEnd, rest, pieces };
}

/** The playlist, read strictly: a missing or unknown key, or a value of the wrong kind, is an error. */
export function readMusic(source: unknown): MusicData {
  const top = mapping(source, 'the file');
  exactly(top, ['format', 'targetLufs', 'leadIn', 'tracks', 'ambient'], 'the file');
  if (top.format !== 'music/2') fail('format must be music/2');
  const leadIn = numberOf(top.leadIn, 'leadIn');
  if (leadIn < 0) fail('leadIn must not be negative');
  if (!Array.isArray(top.tracks) || top.tracks.length === 0) fail('tracks must be a list with a piece in it');
  const ids = new Set<string>();
  const tracks = (top.tracks as unknown[]).map((raw, i): MusicTrack => {
    const what = `tracks[${i}]`;
    const t = mapping(raw, what);
    exactly(t, ['id', 'title', 'words', 'seconds', 'lufs', 'peakDb', 'opus', 'm4a'], what);
    if (typeof t.words !== 'boolean') fail(`${what}.words must be true or false`);
    return { ...readFile(t, what, ids), words: t.words as boolean };
  });
  return { targetLufs: numberOf(top.targetLufs, 'targetLufs'), leadIn, tracks, ambient: readAmbient(top.ambient, ids) };
}

/** What a piece is multiplied by to bring it to the common loudness: at most 1 (a quiet piece is left as it is). */
export function gainOf(piece: { readonly lufs: number }, targetLufs: number): number {
  return Math.min(1, 10 ** ((targetLufs - piece.lufs) / 20));
}

/** The player's volume (0 to 1, as a control shows it) as a multiplier of the sound: a square law, so the low half of the control is useful. */
export function amplitude(volume: number): number {
  const v = Math.min(1, Math.max(0, volume));
  return v * v;
}

/** The piece after this one; the list goes round. */
export function after(data: MusicData, index: number): number {
  return (index + 1) % data.tracks.length;
}

/** Seeds are whole numbers from 0 to 2^32 - 1. */
export const isSeed = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 0xffffffff;

/** A number in [0, 1) for a seed, a tag and a whole number: a hash, the same every time. */
export function draw(seed: number, tag: string, n: number): number {
  let h = 2166136261 ^ seed;
  for (let i = 0; i < tag.length; i++) {
    h ^= tag.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= Math.imul(n + 1, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** One quiet stretch: `rest` seconds of silence, an ambient piece for `spell` seconds from its first note, `rest` seconds of silence. */
export interface Stretch {
  /** The ambient piece (its place in data.ambient.pieces). */
  readonly ambient: number;
  readonly spell: number;
  /** The spell is the whole piece: it plays through to its end. */
  readonly toEnd: boolean;
  readonly rest: number;
  /** The whole stretch: rest, spell, rest. */
  readonly seconds: number;
}

/**
 * The n-th quiet stretch of a visit (n from 0). The ambient pieces take turns (which one comes first is
 * the seed's); the spell is drawn between the data's bounds, or now and then is the whole piece.
 */
export function stretchOf(data: MusicData, seed: number, n: number): Stretch {
  const a = data.ambient;
  const ambient = (n + (seed % a.pieces.length)) % a.pieces.length;
  const whole = (a.pieces[ambient] as MusicFile).seconds;
  const most = Math.min(whole, a.spell.most === 'whole' ? whole : a.spell.most);
  const least = Math.min(a.spell.least, most);
  const spell = draw(seed, 'music.toEnd', n) < a.toEnd ? whole : Math.min(whole, Math.round(least + (most - least) * draw(seed, 'music.spell', n)));
  return { ambient, spell, toEnd: spell >= whole, rest: a.rest, seconds: a.rest + spell + a.rest };
}

/**
 * The ambient piece's own fade (0 to 1, before its level and the player's volume) `into` seconds into
 * its spell: silent before the spell and from its end on, a soft curve in over `fadeIn` and out over
 * `fadeOut`, whole in between.
 */
export function ambientFade(data: MusicData, stretch: Stretch, into: number): number {
  if (!(into > 0) || into >= stretch.spell) return 0;
  const x = Math.min(1, into / data.ambient.fadeIn, (stretch.spell - into) / data.ambient.fadeOut);
  return x * x * (3 - 2 * x);
}

/** Where the music is: `left` seconds from starting piece `index` ('wait'), or `at` seconds into it ('play'). */
export interface Place {
  index: number;
  phase: 'wait' | 'play';
  left: number;
  at: number;
  /** How many quiet stretches there have been. A wait with none before it is the lead-in; any other wait is stretch number `stretch - 1`. */
  stretch: number;
  /** The visit's seed, from which every stretch's spell is drawn. */
  seed: number;
}

/** The start of a visit: the lead-in, then the piece after the last one that was played to its end (the first, when there is none). */
export function firstPlace(data: MusicData, lastId: string | null, seed: number): Place {
  const last = data.tracks.findIndex(t => t.id === lastId);
  return { index: last < 0 ? 0 : after(data, last), phase: 'wait', left: data.leadIn, at: 0, stretch: 0, seed };
}

/** The start of a visit that begins with a given piece (by id), from its first note after the lead-in. An id the playlist does not have is an error. */
export function placeOfPiece(data: MusicData, id: string, seed: number): Place {
  const index = data.tracks.findIndex(t => t.id === id);
  if (index < 0) throw new Error(`music: the piece to begin with, "${id}", is not in the playlist (${data.tracks.map(t => t.id).join(', ')})`);
  return { index, phase: 'wait', left: data.leadIn, at: 0, stretch: 0, seed };
}

/** After a piece: a quiet stretch, then the next piece. */
export function afterPiece(data: MusicData, place: Place): Place {
  return { index: after(data, place.index), phase: 'wait', left: stretchOf(data, place.seed, place.stretch).seconds, at: 0, stretch: place.stretch + 1, seed: place.seed };
}

/** The quiet stretch the place is in, and how far into its spell it is (negative before the spell): null in the lead-in or in a piece. */
export function inStretch(data: MusicData, place: Place): { stretch: Stretch; into: number } | null {
  if (place.phase !== 'wait' || place.stretch < 1) return null;
  const stretch = stretchOf(data, place.seed, place.stretch - 1);
  return { stretch, into: stretch.seconds - place.left - stretch.rest };
}

/** A place as it was kept (JSON text), if it is one and still fits the playlist; else null. */
export function readPlace(data: MusicData, text: string | null): Place | null {
  if (text === null) return null;
  let p: Partial<Record<keyof Place, unknown>>;
  try {
    const parsed = JSON.parse(text) as unknown;
    if (typeof parsed !== 'object' || parsed === null) return null;
    p = parsed as Partial<Record<keyof Place, unknown>>;
  } catch {
    return null;
  }
  const whole = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;
  const amount = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;
  if (!whole(p.index) || p.index >= data.tracks.length || !whole(p.stretch) || !amount(p.left) || !amount(p.at) || !isSeed(p.seed)) return null;
  if (p.phase !== 'wait' && p.phase !== 'play') return null;
  return { index: p.index, phase: p.phase, left: p.left, at: p.at, stretch: p.stretch, seed: p.seed };
}
