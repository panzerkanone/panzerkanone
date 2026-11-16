/**
 * The narration's index (assets/narration/v1/narration.json, written by `npm run narration`): each piece's file,
 * length, measured loudness and peak, and the words it says. Read strictly; nothing of the page's here, so that the
 * checks can read it too.
 */

/** A piece as the index has it: its file, length, measured loudness and peak, and the words it says. */
export interface NarrationPiece {
  readonly id: string;
  readonly seconds: number;
  readonly lufs: number;
  readonly peakDb: number;
  readonly mp3: string;
  readonly says: string;
}

export interface NarrationIndex {
  readonly format: 'narration/1';
  /** The loudness every piece is evened to as it is said. */
  readonly targetLufs: number;
  readonly pieces: readonly NarrationPiece[];
}

/** The index, read strictly: an unknown key, a missing one or a wrong kind of value is an error. */
export function readNarration(raw: unknown): NarrationIndex {
  const fail = (why: string): never => {
    throw new Error(`assets/narration/v1/narration.json: ${why}`);
  };
  const isMap = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
  const exactly = (m: Record<string, unknown>, keys: readonly string[], what: string): void => {
    for (const k of Object.keys(m)) if (!keys.includes(k)) fail(`${what} has an unknown key "${k}"`);
    for (const k of keys) if (!(k in m)) fail(`${what} lacks "${k}"`);
  };
  const num = (v: unknown, what: string): number => (typeof v === 'number' && Number.isFinite(v) ? v : fail(`${what} must be a number`));
  const str = (v: unknown, what: string): string => (typeof v === 'string' && v !== '' ? v : fail(`${what} must be a non-empty string`));
  if (!isMap(raw)) return fail('must be a mapping');
  exactly(raw, ['format', 'targetLufs', 'pieces'], 'the index');
  if (raw['format'] !== 'narration/1') fail('format must be narration/1');
  const targetLufs = num(raw['targetLufs'], 'targetLufs');
  if (!Array.isArray(raw['pieces']) || raw['pieces'].length === 0) fail('pieces must be a list with a piece in it');
  const seen = new Set<string>();
  const pieces = (raw['pieces'] as unknown[]).map((p, i): NarrationPiece => {
    const what = `pieces[${i}]`;
    if (!isMap(p)) return fail(`${what} must be a mapping`);
    exactly(p, ['id', 'seconds', 'lufs', 'peakDb', 'mp3', 'says'], what);
    const id = str(p['id'], `${what}.id`);
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(id)) fail(`${what}.id must be lower-case words joined by hyphens`);
    if (seen.has(id)) fail(`${what}.id "${id}" is used twice`);
    seen.add(id);
    const seconds = num(p['seconds'], `${what}.seconds`);
    if (seconds <= 0) fail(`${what}.seconds must be more than 0`);
    const mp3 = str(p['mp3'], `${what}.mp3`);
    if (mp3 !== `${id}.mp3`) fail(`${what}.mp3 must be "${id}.mp3"`);
    return { id, seconds, lufs: num(p['lufs'], `${what}.lufs`), peakDb: num(p['peakDb'], `${what}.peakDb`), mp3, says: str(p['says'], `${what}.says`) };
  });
  return { format: 'narration/1', targetLufs, pieces };
}
