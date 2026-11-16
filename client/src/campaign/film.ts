/**
 * The briefing room's films (assets/film/v1/, cut from public-domain footage by tools/film/): the index (film.json:
 * each loop's files, its length, and its brightness track) and the bundled addresses of its files. Nothing is
 * fetched here: the room sets an address on its video when it is shown.
 */
import indexText from '../../../assets/film/v1/film.json?raw';

const FILES = import.meta.glob<string>('../../../assets/film/v1/*.{webm,mp4,webp}', { query: '?url', import: 'default', eager: true });

export interface FilmLoop {
  readonly id: string;
  /** Bundled addresses: the loop twice (the kind a browser plays first is its choice) and a still of it. */
  readonly webm: string;
  readonly mp4: string;
  readonly still: string;
  readonly seconds: number;
  readonly fps: number;
  /** The picture's mean brightness (0 to 1) over each `1 / hz` of a second of the loop: the projector's beam follows it. */
  readonly luma: { readonly hz: number; readonly values: readonly number[] };
}

const fail = (why: string): never => {
  throw new Error(`assets/film/v1/film.json: ${why}`);
};

function addressOf(file: unknown, loop: string): string {
  if (typeof file !== 'string') return fail(`the loop '${loop}' names a file that is not text`);
  const address = FILES[`../../../assets/film/v1/${file}`];
  if (address === undefined) return fail(`no file is bundled for ${file}`);
  return address;
}

function readIndex(): ReadonlyMap<string, FilmLoop> {
  const raw: unknown = JSON.parse(indexText);
  const loops = typeof raw === 'object' && raw !== null ? (raw as { format?: unknown; loops?: unknown }) : fail('not an object');
  if (loops.format !== 'film/1') fail(`format is ${String(loops.format)}, not film/1`);
  if (typeof loops.loops !== 'object' || loops.loops === null) fail('no loops');
  const out = new Map<string, FilmLoop>();
  for (const [id, value] of Object.entries(loops.loops as Record<string, unknown>)) {
    const l = value as { webm?: unknown; mp4?: unknown; still?: unknown; seconds?: unknown; fps?: unknown; luma?: unknown };
    const luma = l.luma as { hz?: unknown; values?: unknown } | undefined;
    if (typeof l.seconds !== 'number' || !(l.seconds > 0) || typeof l.fps !== 'number' || !(l.fps > 0)) fail(`the loop '${id}' has no length or rate`);
    if (!luma || typeof luma.hz !== 'number' || !(luma.hz > 0) || !Array.isArray(luma.values) || luma.values.length === 0 || !luma.values.every(v => typeof v === 'number' && v >= 0 && v <= 1)) {
      fail(`the loop '${id}' has no brightness track`);
    }
    out.set(id, {
      id,
      webm: addressOf(l.webm, id),
      mp4: addressOf(l.mp4, id),
      still: addressOf(l.still, id),
      seconds: l.seconds as number,
      fps: l.fps as number,
      luma: { hz: (luma as { hz: number }).hz, values: (luma as { values: number[] }).values },
    });
  }
  return out;
}

export const FILMS: ReadonlyMap<string, FilmLoop> = readIndex();

/** The picture's brightness at `t` seconds into the loop (0 to 1), eased between the track's values. */
export function lumaAt(loop: FilmLoop, t: number): number {
  const v = loop.luma.values;
  const at = (((t % loop.seconds) + loop.seconds) % loop.seconds) * loop.luma.hz - 0.5;
  const i = Math.floor(at);
  const f = at - i;
  const a = v[((i % v.length) + v.length) % v.length] ?? 0;
  const b = v[(((i + 1) % v.length) + v.length) % v.length] ?? a;
  const s = f * f * (3 - 2 * f);
  return a + (b - a) * s;
}
