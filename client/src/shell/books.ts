/**
 * The game's effect pictures as the title screen uses them: the flipbooks of fire, blast and smoke
 * of assets/fx/v1/fx.json (written by `npm run fx`; the table's scene reads the same file).
 * What the screen needs of each book is read strictly; plain arithmetic, no browser.
 */

export interface Book {
  id: string;
  /** Which atlas, and where its first frame's corner lies in it. */
  atlas: number;
  at: readonly [number, number];
  /** A frame's size; columns and rows; how many frames. */
  cell: readonly [number, number];
  grid: readonly [number, number];
  frames: number;
  /** Frames a second at its natural speed; whether its end meets its start. */
  rate: number;
  loop: boolean;
  /** The point of a frame that stands on the effect's place, as shares from the frame's top-left. */
  pivot: readonly [number, number];
}

/** The books the screen draws from. */
export const BOOK_NAMES = ['blast', 'burst', 'smoke', 'flame', 'cloud', 'wisp'] as const;
export type BookName = (typeof BOOK_NAMES)[number];
export type Books = Readonly<Record<BookName, Book>>;

const fail = (why: string): never => {
  throw new Error(`fx.json: ${why}`);
};
const pair = (v: unknown, what: string): [number, number] =>
  Array.isArray(v) && v.length === 2 && v.every(n => typeof n === 'number' && Number.isFinite(n) && n >= 0) ? [v[0] as number, v[1] as number] : fail(`${what} must be two numbers, 0 or more`);
const count = (v: unknown, what: string): number => (typeof v === 'number' && Number.isInteger(v) && v >= 1 ? v : fail(`${what} must be a whole number, 1 or more`));

/** The books by name, and the atlases' file names in their order. */
export function readBooks(source: unknown): { books: Books; atlases: { file: string; width: number; height: number }[] } {
  const top = (typeof source === 'object' && source !== null ? source : fail('the file must be a mapping')) as Record<string, unknown>;
  if (top.format !== 'fx/1') fail('format must be fx/1');
  if (!Array.isArray(top.atlases) || !Array.isArray(top.flipbooks)) fail('atlases and flipbooks must be lists');
  const atlases = (top.atlases as Record<string, unknown>[]).map((a, i) => ({
    file: typeof a.file === 'string' && a.file !== '' ? a.file : fail(`atlases[${i}].file must be a name`),
    width: count(a.width, `atlases[${i}].width`),
    height: count(a.height, `atlases[${i}].height`),
  }));
  const found = new Map<string, Book>();
  for (const raw of top.flipbooks as Record<string, unknown>[]) {
    const id = typeof raw.id === 'string' ? raw.id : fail('a flipbook has no id');
    if (!(BOOK_NAMES as readonly string[]).includes(id)) continue;
    const what = `flipbook "${id}"`;
    const book: Book = {
      id,
      atlas: typeof raw.atlas === 'number' && Number.isInteger(raw.atlas) && raw.atlas >= 0 && raw.atlas < atlases.length ? raw.atlas : fail(`${what}: atlas must name one of the atlases`),
      at: pair(raw.at, `${what}.at`),
      cell: pair(raw.cell, `${what}.cell`),
      grid: pair(raw.grid, `${what}.grid`),
      frames: count(raw.frames, `${what}.frames`),
      rate: typeof raw.rate === 'number' && raw.rate > 0 ? raw.rate : fail(`${what}.rate must be above 0`),
      loop: typeof raw.loop === 'boolean' ? raw.loop : fail(`${what}.loop must be true or false`),
      pivot: pair(raw.pivot, `${what}.pivot`),
    };
    const sheet = atlases[book.atlas] as { width: number; height: number };
    if (book.frames > book.grid[0] * book.grid[1]) fail(`${what} has more frames than its grid holds`);
    if (book.at[0] + book.grid[0] * book.cell[0] > sheet.width || book.at[1] + book.grid[1] * book.cell[1] > sheet.height) fail(`${what} runs over its atlas's edge`);
    found.set(id, book);
  }
  const books = {} as Record<BookName, Book>;
  for (const name of BOOK_NAMES) books[name] = found.get(name) ?? fail(`there is no flipbook "${name}"`);
  return { books, atlases };
}

/** Where frame `n` of a book lies in its own sheet of frames (its grid, from the first frame's corner): x, y. Frames run along the rows. */
export function frameAt(book: Book, n: number): [number, number] {
  const k = Math.min(book.frames - 1, Math.max(0, Math.floor(n)));
  const col = k % book.grid[0];
  return [col * book.cell[0], ((k - col) / book.grid[0]) * book.cell[1]];
}

/** The frame a book shows `age` seconds after its start, at `speed` times its natural speed: a looping book goes round, another holds its last frame. */
export function frameOf(book: Book, age: number, speed = 1, startAt = 0): number {
  const n = Math.floor(startAt + age * book.rate * speed);
  return book.loop ? ((n % book.frames) + book.frames) % book.frames : Math.min(book.frames - 1, Math.max(0, n));
}
