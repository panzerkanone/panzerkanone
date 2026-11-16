/**
 * The effects' pictures as the scene is handed them: a manifest (assets/fx/v1/fx.json, written by
 * `npm run fx`) and the atlases it names, already fetched and decoded by whoever started the page
 * (the scene downloads nothing). Read strictly: a manifest with a key missing, an unknown one or a
 * flipbook over its atlas's edge is refused whole, and the table then runs with the effects it
 * draws itself. Plain arithmetic, no browser.
 */

/** How a flipbook is laid over what is behind it: it covers; it covers and glows; it is light only. */
export type Blend = 'over' | 'emissive' | 'add';

export interface Flipbook {
  id: string;
  /** Which atlas, and where in it (pixels from its top-left corner). */
  atlas: number;
  at: [number, number];
  /** A frame's size in pixels; columns and rows. */
  cell: [number, number];
  grid: [number, number];
  frames: number;
  /** Frames a second at its natural speed. */
  rate: number;
  loop: boolean;
  blend: Blend;
  /** The point of a frame that stands on the effect's place, from the frame's top-left, as shares. */
  pivot: [number, number];
  /** The share of a frame's width the picture fills at its fullest. */
  fill: number;
}

export interface Manifest {
  atlases: { file: string; width: number; height: number }[];
  flipbooks: Flipbook[];
}

/** The flipbooks the effects use, by name. A manifest without one of them is refused. */
export const BOOKS = ['explosion', 'blast', 'burst', 'smoke', 'flame', 'cloud', 'fireball', 'wisp'] as const;
export type BookName = (typeof BOOKS)[number];
/** The most atlases the effects' shader takes. */
export const MAX_ATLASES = 2;

const fail = (why: string): never => {
  throw new Error(`effects manifest: ${why}`);
};
const map = (v: unknown, what: string): Record<string, unknown> => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : fail(`${what} must be a mapping`));
const whole = (v: unknown, what: string, least: number): number => (typeof v === 'number' && Number.isInteger(v) && v >= least ? v : fail(`${what} must be a whole number, ${least} or more`));
const share = (v: unknown, what: string): number => (typeof v === 'number' && v >= 0 && v <= 1 ? v : fail(`${what} must be from 0 to 1`));
function pair(v: unknown, what: string, each: (x: unknown, what: string) => number): [number, number] {
  if (!Array.isArray(v) || v.length !== 2) fail(`${what} must be two numbers`);
  const a = v as unknown[];
  return [each(a[0], what), each(a[1], what)];
}
function only(m: Record<string, unknown>, keys: readonly string[], what: string): void {
  for (const k of Object.keys(m)) if (!keys.includes(k)) fail(`${what} has an unknown key "${k}"`);
  for (const k of keys) if (!(k in m)) fail(`${what} lacks "${k}"`);
}

export function parseManifest(source: unknown): Manifest {
  const top = map(source, 'the file');
  only(top, ['format', 'atlases', 'flipbooks'], 'the file');
  if (top.format !== 'fx/1') fail('format must be fx/1');
  if (!Array.isArray(top.atlases) || top.atlases.length === 0 || top.atlases.length > MAX_ATLASES) fail(`atlases must be a list of one to ${MAX_ATLASES}`);
  const atlases = (top.atlases as unknown[]).map((raw, i) => {
    const what = `atlases[${i}]`;
    const a = map(raw, what);
    only(a, ['file', 'width', 'height', 'alpha'], what);
    if (typeof a.file !== 'string' || a.file === '') fail(`${what}.file must be a name`);
    // Plain colour beside its cover, which the view has the browser multiply as it hands the picture to the GPU; nothing else is taken.
    if (a.alpha !== 'straight') fail(`${what}.alpha must be straight`);
    return { file: a.file as string, width: whole(a.width, `${what}.width`, 1), height: whole(a.height, `${what}.height`, 1) };
  });
  if (!Array.isArray(top.flipbooks)) fail('flipbooks must be a list');
  const seen = new Set<string>();
  const flipbooks = (top.flipbooks as unknown[]).map((raw, i): Flipbook => {
    const what = `flipbooks[${i}]`;
    const b = map(raw, what);
    only(b, ['id', 'atlas', 'at', 'cell', 'grid', 'frames', 'rate', 'loop', 'blend', 'pivot', 'fill'], what);
    if (typeof b.id !== 'string' || b.id === '') fail(`${what}.id must be a name`);
    const id = b.id as string;
    if (seen.has(id)) fail(`${what}.id "${id}" is used twice`);
    seen.add(id);
    const atlas = whole(b.atlas, `${what}.atlas`, 0);
    const sheet = atlases[atlas] ?? fail(`${what}.atlas names no atlas`);
    const at = pair(b.at, `${what}.at`, (x, w) => whole(x, w, 0));
    const cell = pair(b.cell, `${what}.cell`, (x, w) => whole(x, w, 1));
    const grid = pair(b.grid, `${what}.grid`, (x, w) => whole(x, w, 1));
    const frames = whole(b.frames, `${what}.frames`, 1);
    if (frames > grid[0] * grid[1]) fail(`${what}: ${frames} frames do not fit a grid of ${grid[0]} x ${grid[1]}`);
    if (at[0] + grid[0] * cell[0] > sheet.width || at[1] + grid[1] * cell[1] > sheet.height) fail(`${what} runs over the edge of its atlas`);
    if (typeof b.rate !== 'number' || !(b.rate > 0)) fail(`${what}.rate must be more than 0`);
    if (typeof b.loop !== 'boolean') fail(`${what}.loop must be true or false`);
    if (b.blend !== 'over' && b.blend !== 'emissive' && b.blend !== 'add') fail(`${what}.blend must be over, emissive or add`);
    return { id, atlas, at, cell, grid, frames, rate: b.rate as number, loop: b.loop as boolean, blend: b.blend as Blend, pivot: pair(b.pivot, `${what}.pivot`, share), fill: share(b.fill, `${what}.fill`) };
  });
  for (const name of BOOKS) if (!seen.has(name)) fail(`there is no flipbook "${name}"`);
  return { atlases, flipbooks };
}

/** Where frame `n` of a flipbook lies in its atlas, as the top-left corner of its cell in texture coordinates (0..1, from the picture's top-left). */
export function frameCorner(book: Flipbook, sheet: { width: number; height: number }, n: number, into: [number, number]): void {
  const col = n - Math.floor(n / book.grid[0]) * book.grid[0];
  const row = Math.floor(n / book.grid[0]);
  into[0] = (book.at[0] + col * book.cell[0]) / sheet.width;
  into[1] = (book.at[1] + row * book.cell[1]) / sheet.height;
}
